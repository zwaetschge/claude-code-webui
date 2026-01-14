import type { Server } from 'socket.io';
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  InterServerEvents,
  SocketData,
  BufferedMessage,
  SessionMode,
} from '@claude-code-webui/shared';
import { getDatabase } from '../../db';
import { nanoid } from 'nanoid';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ChildProcess, spawn as cpSpawn } from 'child_process';
import { config } from '../../config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Circular buffer for storing messages for reconnection
const BUFFER_SIZE = 5000;
const DISCONNECT_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

class CircularBuffer<T> {
  private buffer: T[] = [];
  private maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  push(item: T): void {
    if (this.buffer.length >= this.maxSize) {
      this.buffer.shift();
    }
    this.buffer.push(item);
  }

  getAll(): T[] {
    return [...this.buffer];
  }

  getSince(predicate: (item: T) => boolean): T[] {
    const startIndex = this.buffer.findIndex(predicate);
    if (startIndex === -1) return [];
    return this.buffer.slice(startIndex);
  }

  clear(): void {
    this.buffer = [];
  }
}

interface FileAttachmentData {
  data: string; // base64
  mimeType: string;
  filename?: string;
}


// Helper to determine attachment type
function getAttachmentType(mimeType: string, filename?: string): 'image' | 'text' | 'pdf' | 'document' {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType === 'application/pdf') return 'pdf';
  if (
    mimeType.startsWith('text/') ||
    mimeType === 'application/json' ||
    mimeType === 'application/xml' ||
    mimeType === 'application/javascript' ||
    (filename && /\.(md|txt|json|yaml|yml|js|ts|tsx|jsx|py|rb|go|rs|java|sql|sh|html|css|xml|csv|toml|ini|cfg|conf|env|gitignore)$/i.test(filename))
  ) {
    return 'text';
  }
  return 'document';
}

// Helper to get file extension from mimeType and filename
function getFileExtension(mimeType: string, filename?: string): string {
  // Try to get extension from filename first
  if (filename) {
    const ext = filename.split('.').pop()?.toLowerCase();
    if (ext) return ext;
  }
  // Fallback to mimeType
  const mimeMap: Record<string, string> = {
    'text/plain': 'txt',
    'text/markdown': 'md',
    'text/html': 'html',
    'text/css': 'css',
    'text/csv': 'csv',
    'application/json': 'json',
    'application/xml': 'xml',
    'application/pdf': 'pdf',
    'application/javascript': 'js',
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
  };
  return mimeMap[mimeType] || mimeType.split('/')[1] || 'bin';
}

interface UsageInfo {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

interface StreamEventMessage {
  type: string;
  message?: {
    model?: string;
    usage?: UsageInfo;
  };
  delta?: {
    type?: string;
    text?: string;
    stop_reason?: string;
    stop_sequence?: string | null;
  };
  usage?: UsageInfo;
  context_management?: unknown;
  index?: number;
}

interface ModelUsageInfo {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  contextWindow: number;
  costUSD: number;
}

// Permission denial from Claude CLI
interface PermissionDenial {
  tool_name: string;
  tool_use_id: string;
  tool_input: Record<string, unknown>;
}

interface StreamJsonMessage {
  type: string;
  content?: string;
  message?: string | {
    role: string;
    model?: string;
    content: string | { type: string; text?: string }[];
    usage?: UsageInfo;
  };
  tool_use?: {
    name: string;
    id: string;
  };
  result?: string;
  session_id?: string;
  subtype?: string;
  // For partial message streaming
  content_block?: {
    type: string;
    text?: string;
  };
  delta?: {
    type: string;
    text?: string;
  };
  index?: number;
  // For stream_event wrapper
  event?: StreamEventMessage;
  // For result message
  total_cost_usd?: number;
  usage?: UsageInfo;
  modelUsage?: Record<string, ModelUsageInfo>;
  // Permission denials
  permission_denials?: PermissionDenial[];
}

interface ClaudeProcess {
  process: ChildProcess;
  sessionId: string;
  // Per-turn token usage (for context display)
  turnInputTokens: number;
  turnCacheReadTokens: number;
  turnCacheCreationTokens: number;
  turnOutputTokens: number;
  userId: string;
  workingDirectory: string;
  claudeSessionId: string | null;
  buffer: string;
  streamingText: string; // Accumulates text during streaming
  isStreaming: boolean;
  // Permission mode
  mode: SessionMode;
  // Tool tracking
  currentToolName: string | null;
  currentToolId: string | null; // Tool use ID from Claude
  currentToolInput: string; // Accumulates JSON input during tool use
  pendingToolResults: Map<string, { toolName: string; input: unknown }>; // Track tools awaiting results
  // Agent tracking
  currentAgentType: string | null;
  // Usage tracking
  model: string;
  contextWindow: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalCostUsd: number;
  previousTotalCostUsd: number; // For calculating per-turn cost
  // Context reminder flag for resumed sessions
  needsWorkingDirReminder: boolean;
  // Reconnect buffer
  outputBuffer: CircularBuffer<BufferedMessage>;
  lastActivityAt: number;
  disconnectedAt: number | null;
  // Permission approval tracking
  lastUserMessage: string | null;
  lastAttachments: FileAttachmentData[] | null;
  pendingPermissionDenials: PermissionDenial[] | null;
}

export class ClaudeProcessManager {
  private processes: Map<string, ClaudeProcess> = new Map();
  private pendingModes: Map<string, SessionMode> = new Map(); // Store modes for sessions not yet started
  private io: Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

  constructor(
    io: Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>
  ) {
    this.io = io;

    // Start cleanup timer for disconnected sessions (every 60 seconds)
    setInterval(() => {
      this.cleanupDisconnectedSessions();
    }, 60 * 1000);
  }

  // Map UI modes to Claude CLI permission flags (legacy flow)
  private getPermissionFlags(mode: SessionMode): string[] {
    switch (mode) {
      case 'planning':
        return ['--permission-mode', 'plan'];
      case 'auto-accept':
        return ['--permission-mode', 'acceptEdits'];
      case 'manual':
        return ['--permission-mode', 'default'];
      case 'danger':
        return ['--dangerously-skip-permissions'];
      case 'orchestration':
        return [
          '--dangerously-skip-permissions',
          '--append-system-prompt', this.getOrchestrationPrompt()
        ];
      default:
        return ['--permission-mode', 'acceptEdits'];
    }
  }

  // Get the path to the permission prompt wrapper script (hooks-based flow)
  private getPermissionPromptScriptPath(): string {
    // The shell script is always in the source directory (packages/backend/src/cli/)
    // We need to find it relative to the current file location
    // In dev (tsx): __dirname = packages/backend/src/services/claude
    // In prod (compiled): __dirname = packages/backend/dist/services/claude

    // First, try relative to source (development)
    const devPath = path.resolve(__dirname, '../cli/permission-prompt-wrapper.sh');
    if (fsSync.existsSync(devPath)) {
      return devPath;
    }

    // If running from dist, the script is in src (parallel to dist)
    // __dirname = packages/backend/dist/services/claude
    // We want: packages/backend/src/cli/permission-prompt-wrapper.sh
    const prodPath = path.resolve(__dirname, '../../../src/cli/permission-prompt-wrapper.sh');
    if (fsSync.existsSync(prodPath)) {
      return prodPath;
    }

    // Fallback: try to find it from the package root
    const packageRoot = path.resolve(__dirname, '../../../../');
    const fallbackPath = path.join(packageRoot, 'src/cli/permission-prompt-wrapper.sh');
    if (fsSync.existsSync(fallbackPath)) {
      return fallbackPath;
    }

    console.warn(`[HOOKS] Could not find permission-prompt-wrapper.sh, tried: ${devPath}, ${prodPath}, ${fallbackPath}`);
    return devPath; // Return dev path as default
  }

  // Generate settings JSON with PermissionRequest hook configured (hooks-based flow)
  private getHookSettings(): string {
    const scriptPath = this.getPermissionPromptScriptPath();
    console.log(`[HOOKS] Using permission hook script: ${scriptPath}`);

    // New hook format with matchers
    // PreToolUse hooks run before every tool execution
    const settings = {
      hooks: {
        PreToolUse: [
          {
            matcher: '*',  // Match all tools
            hooks: [
              {
                type: 'command',
                command: scriptPath,
              },
            ],
          },
        ],
      },
    };

    const json = JSON.stringify(settings);
    console.log(`[HOOKS] Settings JSON: ${json}`);
    return json;
  }

  // Get orchestration mode system prompt
  private getOrchestrationPrompt(): string {
    return `
## ORCHESTRATION MODE ACTIVE

You are operating in Orchestration Mode. Your PRIMARY role is to coordinate and delegate work to specialized subagents rather than doing everything yourself.

### Core Principles:
1. **Delegate First**: Before implementing anything yourself, consider which specialized agent is best suited for the task
2. **Use the Task Tool**: Invoke subagents using the Task tool with appropriate subagent_type
3. **Coordinate Results**: Synthesize outputs from multiple agents when needed
4. **Maintain Overview**: Keep track of the overall goal while delegating subtasks

### Available Subagent Types and When to Use:
- **Explore** - Codebase exploration, finding files, understanding structure
- **Plan** - Creating implementation plans, breaking down complex tasks
- **research-bot** - Researching solutions, best practices, documentation
- **frontend-developer** - React, CSS, UI components, client-side work
- **backend-dev** - APIs, database operations, server-side logic
- **fullstack-dev** - Cross-cutting features spanning frontend and backend
- **api-designer** - API design, OpenAPI specs, endpoint planning
- **ui-designer** - UI/UX design decisions, component layouts
- **devops-engineer** - CI/CD, Docker, Kubernetes, infrastructure
- **database-specialist** - SQL, schema design, migrations, query optimization
- **git-operations** - Complex git workflows, merge conflicts, rebasing
- **debugging-expert** - Error diagnosis, profiling, root cause analysis
- **system-architect** - System design, architecture decisions, technical specs

### Delegation Guidelines:
- **Small, focused tasks**: Delegate to a single specialist
- **Complex features**: Break down and delegate to multiple agents in sequence
- **Cross-cutting concerns**: Use fullstack-dev or coordinate multiple specialists
- **Always provide clear context** and objectives to subagents

### When NOT to Delegate:
- Simple questions or explanations that don't require code changes
- Quick file reads or searches (use Read/Grep directly)
- Trivial edits (< 5 lines of obvious changes)
- Direct clarifying questions to the user

### Example Delegation:
For "Add authentication to the API":
1. Use Plan agent to create implementation plan
2. Use database-specialist for schema/migrations
3. Use backend-dev for API endpoints
4. Use frontend-developer for login UI
5. Synthesize and verify the complete solution
`;
  }

  // Helper method to buffer a message
  private bufferMessage(sessionId: string, type: BufferedMessage['type'], data: unknown): void {
    const proc = this.processes.get(sessionId);
    if (!proc) return;

    const bufferedMsg: BufferedMessage = {
      type,
      data,
      timestamp: Date.now(),
    };
    proc.outputBuffer.push(bufferedMsg);
    proc.lastActivityAt = Date.now();
  }

  // Wrapper to emit and buffer status
  private emitStatus(sessionId: string, data: { sessionId: string; status: 'running' | 'stopped' | 'error' }): void {
    this.bufferMessage(sessionId, 'status', data);
    this.io.to(`session:${sessionId}`).emit('session:status', data);
  }

  // Wrapper to emit and buffer tool_use events
  private emitToolUse(sessionId: string, data: {
    sessionId: string;
    toolName: string;
    status: 'started' | 'completed' | 'error';
    toolId?: string;
    input?: unknown;
    result?: string;
    error?: string;
  }): void {
    this.bufferMessage(sessionId, 'tool_use', data);
    this.io.to(`session:${sessionId}`).emit('session:tool_use', data);
  }

  // Get buffered messages since a timestamp for reconnection
  getSessionBuffer(sessionId: string, sinceTimestamp?: number): BufferedMessage[] {
    const proc = this.processes.get(sessionId);
    if (!proc) return [];

    if (sinceTimestamp) {
      return proc.outputBuffer.getSince((msg) => msg.timestamp > sinceTimestamp);
    }
    return proc.outputBuffer.getAll();
  }

  // Check if a session is running (for reconnection)
  isSessionRunning(sessionId: string): boolean {
    return this.processes.has(sessionId);
  }

  // Mark session as disconnected (client disconnected but process keeps running)
  markSessionDisconnected(sessionId: string): void {
    const proc = this.processes.get(sessionId);
    if (proc && !proc.disconnectedAt) {
      proc.disconnectedAt = Date.now();
      console.log(`Session ${sessionId} marked as disconnected`);
    }
  }

  // Mark session as reconnected
  markSessionReconnected(sessionId: string): void {
    const proc = this.processes.get(sessionId);
    if (proc) {
      proc.disconnectedAt = null;
      console.log(`Session ${sessionId} marked as reconnected`);
    }
  }

  // Cleanup sessions that have been disconnected too long
  private cleanupDisconnectedSessions(): void {
    const now = Date.now();
    for (const [sessionId, proc] of this.processes.entries()) {
      if (proc.disconnectedAt && (now - proc.disconnectedAt) > DISCONNECT_TIMEOUT_MS) {
        console.log(`Cleaning up disconnected session ${sessionId} (timeout exceeded)`);
        this.stopSessionInternal(sessionId);
      }
    }
  }

  private stopSessionInternal(sessionId: string): void {
    const proc = this.processes.get(sessionId);
    if (!proc) return;

    proc.process.stdin?.end();
    setTimeout(() => {
      if (this.processes.has(sessionId)) {
        proc.process.kill();
        this.cleanupProcess(sessionId);
      }
    }, 2000);
  }

  async startSession(sessionId: string, userId: string, mode?: SessionMode): Promise<void> {
    const db = getDatabase();

    const session = db
      .prepare('SELECT * FROM sessions WHERE id = ? AND user_id = ?')
      .get(sessionId, userId) as { working_directory: string; claude_session_id: string | null; allowed_directories: string | null } | undefined;

    if (!session) {
      throw new Error('Session not found');
    }

    if (this.processes.has(sessionId)) {
      return;
    }

    // Use provided mode, or pending mode, or default to 'auto-accept'
    const effectiveMode = mode ?? this.pendingModes.get(sessionId) ?? 'auto-accept';
    this.pendingModes.delete(sessionId); // Clear pending mode once used
    console.log(`[MODE] Starting session ${sessionId} with mode ${effectiveMode}`);

    // Build command args for stream-json mode
    // IMPORTANT: Always use --dangerously-skip-permissions so our hook is the ONLY permission layer
    // Without this, Claude's internal permission system would still prompt after our hook approves
    const args: string[] = [
      '--print',
      '--verbose',
      '--debug', 'hooks',  // Debug hook execution
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      '--include-partial-messages',
      '--dangerously-skip-permissions',  // Let our hook handle all permissions
    ];

    // Add allowed directories
    const allowedDirs: string[] = session.allowed_directories
      ? JSON.parse(session.allowed_directories)
      : [];
    for (const dir of allowedDirs) {
      args.push('--add-dir', dir);
    }

    // Add permission hook settings for all modes except 'danger'
    // In danger mode, skip hooks entirely (tools run without any checks)
    // In other modes, our hook surfaces permission requests to the UI
    if (effectiveMode !== 'danger') {
      const hookSettings = this.getHookSettings();
      args.push('--settings', hookSettings);
    }

    const isResuming = !!session.claude_session_id;
    if (isResuming && session.claude_session_id) {
      args.push('--resume', session.claude_session_id);
    }

    console.log(`[SESSION] ========== Starting Claude Session ==========`);
    console.log(`[SESSION] Session ID: ${sessionId}`);
    console.log(`[SESSION] Working directory: ${session.working_directory}`);
    console.log(`[SESSION] Mode: ${effectiveMode}`);
    console.log(`[SESSION] Allowed directories: ${allowedDirs.join(', ') || 'none'}`);
    console.log(`[SESSION] Resuming: ${isResuming}`);
    console.log(`[SESSION] Args: ${args.join(' ')}`);
    console.log(`[SESSION] Env WEBUI_SESSION_ID: ${sessionId}`);
    console.log(`[SESSION] Env WEBUI_BACKEND_URL: http://localhost:${config.port}`);
    console.log(`[SESSION] Env WEBUI_PROJECT_PATH: ${session.working_directory}`);
    console.log(`[SESSION] ==============================================`)

    // Use regular spawn instead of PTY for stream-json mode
    const proc = cpSpawn('claude', args, {
      cwd: session.working_directory,
      env: {
        ...process.env,
        // Pass session ID so Claude can use it for image generation and permissions
        WEBUI_SESSION_ID: sessionId,
        // Pass backend URL for permission-prompt script
        WEBUI_BACKEND_URL: `http://localhost:${config.port}`,
        // Pass project path for loading project-specific settings
        WEBUI_PROJECT_PATH: session.working_directory,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const claudeProcess: ClaudeProcess = {
      process: proc,
      sessionId,
      userId,
      workingDirectory: session.working_directory,
      claudeSessionId: session.claude_session_id,
      buffer: '',
      streamingText: '',
      isStreaming: false,
      // Permission mode
      mode: effectiveMode,
      // Tool tracking
      currentToolName: null,
      currentToolId: null,
      currentToolInput: '',
      pendingToolResults: new Map(),
      // Agent tracking
      currentAgentType: null,
      // Usage tracking defaults
      model: 'unknown',
      contextWindow: 200000, // Default for Opus
      // Per-turn usage (for context display)
      turnInputTokens: 0,
      turnCacheReadTokens: 0,
      turnCacheCreationTokens: 0,
      turnOutputTokens: 0,
      // Cumulative session usage (for cost tracking)
      totalInputTokens: 0,
      totalOutputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      totalCostUsd: 0,
      previousTotalCostUsd: 0,
      // Only need reminder for resumed sessions
      needsWorkingDirReminder: isResuming,
      // Reconnect buffer
      outputBuffer: new CircularBuffer<BufferedMessage>(BUFFER_SIZE),
      lastActivityAt: Date.now(),
      disconnectedAt: null,
      // Permission approval tracking
      lastUserMessage: null,
      lastAttachments: null,
      pendingPermissionDenials: null,
    };

    this.processes.set(sessionId, claudeProcess);

    db.prepare('UPDATE sessions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
      'running',
      sessionId
    );

    this.emitStatus(sessionId, {
      sessionId,
      status: 'running',
    });

    // Handle stdout - JSON messages
    proc.stdout?.on('data', (data: Buffer) => {
      this.handleJsonOutput(sessionId, data.toString());
    });

    // Handle stderr
    proc.stderr?.on('data', (data: Buffer) => {
      console.error(`Claude stderr [${sessionId}]:`, data.toString());
    });

    proc.on('exit', (exitCode) => {
      console.log(`Claude process for session ${sessionId} exited with code ${exitCode}`);
      this.cleanupProcess(sessionId);
    });

    proc.on('error', (err) => {
      console.error(`Claude process error [${sessionId}]:`, err);
      this.cleanupProcess(sessionId);
    });
  }

  private handleJsonOutput(sessionId: string, data: string): void {
    const proc = this.processes.get(sessionId);
    if (!proc) return;

    proc.buffer += data;

    // Process complete JSON lines
    const lines = proc.buffer.split('\n');
    proc.buffer = lines.pop() || ''; // Keep incomplete line in buffer

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const msg: StreamJsonMessage = JSON.parse(line);
        this.processStreamMessage(sessionId, msg);
      } catch (e) {
        // Not valid JSON, emit as raw output for debugging
        console.log(`Non-JSON output [${sessionId}]:`, line);
        this.io.to(`session:${sessionId}`).emit('session:output', {
          sessionId,
          content: line + '\n',
          isComplete: false,
        });
      }
    }
  }

  private emitUsage(sessionId: string, proc: ClaudeProcess): void {
    // Context usage only counts INPUT tokens (including cache), NOT output tokens
    // Use per-turn values for context display (not cumulative session values)
    const contextTokens = proc.turnInputTokens + proc.turnCacheReadTokens + proc.turnCacheCreationTokens;
    const contextUsedPercent = Math.round((contextTokens / proc.contextWindow) * 100);

    this.io.to(`session:${sessionId}`).emit('session:usage', {
      sessionId,
      // Per-turn values for context display
      inputTokens: proc.turnInputTokens,
      outputTokens: proc.turnOutputTokens,
      cacheReadTokens: proc.turnCacheReadTokens,
      cacheCreationTokens: proc.turnCacheCreationTokens,
      totalTokens: contextTokens, // Context tokens only (no output) for display
      contextWindow: proc.contextWindow,
      contextUsedPercent,
      // Cumulative session cost
      totalCostUsd: proc.totalCostUsd,
      model: proc.model,
    });
    // Note: DB saving moved to saveUsageToDatabase() called only on turn completion
  }

  // Calculate cost for tokens based on model pricing
  // Prices per 1M tokens (as of 2025)
  private static readonly MODEL_PRICING: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
    'claude-opus-4-5-20251101': { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
    'claude-sonnet-4-20250514': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    'claude-3-5-sonnet-20241022': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    'claude-3-5-haiku-20241022': { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
  };

  private calculateTurnCost(proc: ClaudeProcess): number {
    // Get pricing for model, fallback to opus pricing
    const defaultPricing = { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 };
    const pricing = ClaudeProcessManager.MODEL_PRICING[proc.model] ?? defaultPricing;

    // Calculate cost (prices are per 1M tokens)
    const inputCost = (proc.turnInputTokens / 1_000_000) * pricing.input;
    const outputCost = (proc.turnOutputTokens / 1_000_000) * pricing.output;
    const cacheReadCost = (proc.turnCacheReadTokens / 1_000_000) * pricing.cacheRead;
    const cacheWriteCost = (proc.turnCacheCreationTokens / 1_000_000) * pricing.cacheWrite;

    return inputCost + outputCost + cacheReadCost + cacheWriteCost;
  }

  // Save usage to database - called ONCE per turn when result is received
  private saveUsageToDatabase(sessionId: string, proc: ClaudeProcess): void {
    const turnTotalTokens = proc.turnInputTokens + proc.turnOutputTokens + proc.turnCacheReadTokens + proc.turnCacheCreationTokens;

    if (turnTotalTokens <= 0) return;

    // Calculate cost from tokens (not from CLI cumulative value)
    const turnCostUsd = this.calculateTurnCost(proc);

    try {
      const db = getDatabase();
      db.prepare(`
        INSERT INTO usage_history (user_id, session_id, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, total_tokens, cost_usd, model)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        proc.userId,
        sessionId,
        proc.turnInputTokens,
        proc.turnOutputTokens,
        proc.turnCacheReadTokens,
        proc.turnCacheCreationTokens,
        turnTotalTokens,
        turnCostUsd,
        proc.model
      );
      console.log(`[USAGE] Saved turn usage: ${turnTotalTokens} tokens, $${turnCostUsd.toFixed(4)}`);
    } catch (error) {
      console.error('[USAGE] Failed to save usage to database:', error);
    }
  }

  private processStreamMessage(sessionId: string, msg: StreamJsonMessage): void {
    const proc = this.processes.get(sessionId);
    if (!proc) return;

    console.log(`[MSG] type=${msg.type} subtype=${msg.subtype || ''} event.type=${msg.event?.type || ''}`);

    // Debug: Log full message for stream_event
    if (msg.type === 'stream_event') {
      console.log(`[MSG] stream_event details:`, JSON.stringify(msg.event).substring(0, 200));
    }

    // Capture session ID and model from init message
    if (msg.type === 'system' && msg.subtype === 'init') {
      if (msg.session_id) {
        proc.claudeSessionId = msg.session_id;
        const db = getDatabase();
        db.prepare('UPDATE sessions SET claude_session_id = ? WHERE id = ?').run(
          msg.session_id,
          sessionId
        );
      }
      // Extract model from init message (it's in the raw JSON)
      const rawMsg = msg as { model?: string };
      if (rawMsg.model) {
        proc.model = rawMsg.model;
      }
    }

    // Handle stream_event wrapper (contains usage info)
    if (msg.type === 'stream_event' && msg.event) {
      const event = msg.event;

      // message_start contains initial usage and model - also means new response is starting
      if (event.type === 'message_start') {
        console.log(`[MSG] message_start - new response beginning`);
        // A new message is starting, Claude is responding
        this.io.to(`session:${sessionId}`).emit('session:thinking', {
          sessionId,
          isThinking: false,
        });
        if (event.message) {
          if (event.message.model) {
            proc.model = event.message.model;
          }
          if (event.message.usage) {
            // Set per-turn usage (this is the actual context used for this turn)
            proc.turnInputTokens = event.message.usage.input_tokens || 0;
            proc.turnOutputTokens = event.message.usage.output_tokens || 0;
            proc.turnCacheReadTokens = event.message.usage.cache_read_input_tokens || 0;
            proc.turnCacheCreationTokens = event.message.usage.cache_creation_input_tokens || 0;
            this.emitUsage(sessionId, proc);
          }
        }
      }

      // message_delta contains updated usage and stop_reason
      if (event.type === 'message_delta') {
        if (event.usage) {
          // Update per-turn usage with delta values
          proc.turnInputTokens = event.usage.input_tokens || proc.turnInputTokens;
          proc.turnOutputTokens = event.usage.output_tokens || proc.turnOutputTokens;
          proc.turnCacheReadTokens = event.usage.cache_read_input_tokens || proc.turnCacheReadTokens;
          proc.turnCacheCreationTokens = event.usage.cache_creation_input_tokens || proc.turnCacheCreationTokens;
          this.emitUsage(sessionId, proc);
        }
        // If stop_reason is tool_use, Claude is about to use a tool - show thinking
        if (event.delta?.stop_reason === 'tool_use') {
          console.log(`[TOOL] Claude is using a tool, showing thinking indicator`);
          // Save any pending streaming content
          if (proc.streamingText.trim().length > 0) {
            this.saveAssistantMessage(sessionId, proc.streamingText.trim());
            proc.streamingText = '';
            proc.isStreaming = false;
          }
          this.io.to(`session:${sessionId}`).emit('session:thinking', {
            sessionId,
            isThinking: true,
          });
        }
      }

      // Handle content_block_start inside stream_event
      if (event.type === 'content_block_start') {
        // Check if this is a tool_use block or text block
        const contentBlock = (event as { content_block?: { type: string; name?: string; id?: string } }).content_block;
        if (contentBlock?.type === 'tool_use') {
          // Tool is being called - track it and show indicator
          proc.currentToolName = contentBlock.name || null;
          proc.currentToolId = contentBlock.id || nanoid();
          proc.currentToolInput = '';
          console.log(`[TOOL] Tool starting: ${contentBlock.name} (id: ${proc.currentToolId})`);
          this.io.to(`session:${sessionId}`).emit('session:thinking', {
            sessionId,
            isThinking: true,
          });
          if (contentBlock.name) {
            this.emitToolUse(sessionId, {
              sessionId,
              toolName: contentBlock.name,
              toolId: proc.currentToolId || undefined,
              status: 'started',
            });
          }
        } else {
          // Text block - start streaming
          proc.isStreaming = true;
          proc.streamingText = '';
          proc.currentToolName = null;
          proc.currentToolId = null;
          proc.currentToolInput = '';
          // Clear any active agent when text response starts
          if (proc.currentAgentType) {
            console.log(`[AGENT] Agent completed: ${proc.currentAgentType}`);
            this.io.to(`session:${sessionId}`).emit('session:agent', {
              sessionId,
              agentType: proc.currentAgentType,
              status: 'completed',
            });
            proc.currentAgentType = null;
          }
          this.io.to(`session:${sessionId}`).emit('session:thinking', {
            sessionId,
            isThinking: false,
          });
        }
      }

      // Handle content_block_delta inside stream_event
      if (event.type === 'content_block_delta') {
        const delta = event.delta as { type?: string; text?: string; partial_json?: string } | undefined;

        // Handle text streaming
        if (delta?.type === 'text_delta' && delta.text) {
          proc.streamingText += delta.text;
          console.log(`[STREAM] Emitting session:output with text: "${delta.text.substring(0, 50)}..."`);
          this.io.to(`session:${sessionId}`).emit('session:output', {
            sessionId,
            content: delta.text,
            isComplete: false,
          });
        }

        // Handle tool input JSON streaming
        if (delta?.type === 'input_json_delta' && delta.partial_json) {
          proc.currentToolInput += delta.partial_json;
        }
      }

      // Handle content_block_stop inside stream_event
      if (event.type === 'content_block_stop') {
        // Save any streaming text
        if (proc.streamingText.trim().length > 0) {
          this.saveAssistantMessage(sessionId, proc.streamingText.trim());
        }

        // Process completed tool input and emit completion
        if (proc.currentToolName && proc.currentToolInput) {
          console.log(`[TOOL] ${proc.currentToolName} completed with input length: ${proc.currentToolInput.length}`);

          // Emit tool completion with full input data
          try {
            const inputData = JSON.parse(proc.currentToolInput);

            // Store tool info for matching with result later
            if (proc.currentToolId) {
              proc.pendingToolResults = proc.pendingToolResults || new Map();
              proc.pendingToolResults.set(proc.currentToolId, {
                toolName: proc.currentToolName,
                input: inputData,
              });
            }

            // Note: The actual result will be captured from tool_result message
            // For now, we just show the input was accepted
            this.emitToolUse(sessionId, {
              sessionId,
              toolName: proc.currentToolName,
              toolId: proc.currentToolId || undefined,
              status: 'completed',
              input: inputData,
            });
          } catch {
            // If parsing fails, just emit with raw input
            this.emitToolUse(sessionId, {
              sessionId,
              toolName: proc.currentToolName,
              toolId: proc.currentToolId || undefined,
              status: 'completed',
              input: proc.currentToolInput,
            });
          }

          // Handle TodoWrite tool
          if (proc.currentToolName === 'TodoWrite') {
            try {
              const todoInput = JSON.parse(proc.currentToolInput) as { todos?: Array<{ content: string; status: string; activeForm?: string }> };
              if (todoInput.todos && Array.isArray(todoInput.todos)) {
                console.log(`[TODOS] Emitting ${todoInput.todos.length} todos`);
                this.io.to(`session:${sessionId}`).emit('session:todos', {
                  sessionId,
                  todos: todoInput.todos.map((t) => ({
                    content: t.content,
                    status: t.status as 'pending' | 'in_progress' | 'completed',
                    activeForm: t.activeForm,
                  })),
                });
              }
            } catch (err) {
              console.error(`[TODOS] Failed to parse TodoWrite input:`, err);
            }
          }

          // Handle Task tool (agents)
          if (proc.currentToolName === 'Task') {
            try {
              const taskInput = JSON.parse(proc.currentToolInput) as { subagent_type?: string; description?: string };
              if (taskInput.subagent_type) {
                console.log(`[AGENT] Agent starting: ${taskInput.subagent_type} - ${taskInput.description || ''}`);
                proc.currentAgentType = taskInput.subagent_type;
                this.io.to(`session:${sessionId}`).emit('session:agent', {
                  sessionId,
                  agentType: taskInput.subagent_type,
                  description: taskInput.description,
                  status: 'started',
                });
              }
            } catch (err) {
              console.error(`[AGENT] Failed to parse Task input:`, err);
            }
          }
        }

        // Reset state
        proc.isStreaming = false;
        proc.streamingText = '';
        proc.currentToolName = null;
        proc.currentToolId = null;
        proc.currentToolInput = '';
      }
    }

    // Handle result message with final usage
    if (msg.type === 'result') {
      // Check for permission denials
      if (msg.permission_denials && msg.permission_denials.length > 0) {
        console.log(`[PERMISSION] Permission denied for tools:`, msg.permission_denials.map(d => d.tool_name).join(', '));
        proc.pendingPermissionDenials = msg.permission_denials;

        // Emit permission request event to frontend
        this.io.to(`session:${sessionId}`).emit('session:permission_request', {
          sessionId,
          denials: msg.permission_denials,
          originalMessage: proc.lastUserMessage || '',
        });

        // Stop thinking indicator - user needs to approve
        this.io.to(`session:${sessionId}`).emit('session:thinking', {
          sessionId,
          isThinking: false,
        });
      }

      // Clear any active agent on result (safety net)
      if (proc.currentAgentType) {
        console.log(`[AGENT] Agent completed (on result): ${proc.currentAgentType}`);
        this.io.to(`session:${sessionId}`).emit('session:agent', {
          sessionId,
          agentType: proc.currentAgentType,
          status: 'completed',
        });
        proc.currentAgentType = null;
      }

      if (msg.total_cost_usd !== undefined) {
        proc.totalCostUsd = msg.total_cost_usd;
      }
      if (msg.usage) {
        // Store cumulative session usage (for total cost calculation)
        // Don't update turn values here - result contains cumulative session totals
        proc.totalInputTokens = msg.usage.input_tokens || proc.totalInputTokens;
        proc.totalOutputTokens = msg.usage.output_tokens || proc.totalOutputTokens;
        proc.cacheReadTokens = msg.usage.cache_read_input_tokens || proc.cacheReadTokens;
        proc.cacheCreationTokens = msg.usage.cache_creation_input_tokens || proc.cacheCreationTokens;
      }
      // Get context window from modelUsage if available
      if (msg.modelUsage) {
        const primaryModel = Object.entries(msg.modelUsage).find(([key]) =>
          key.includes('opus') || key.includes('sonnet')
        );
        if (primaryModel && primaryModel[1].contextWindow) {
          proc.contextWindow = primaryModel[1].contextWindow;
        }
      }
      this.emitUsage(sessionId, proc);

      // Save usage to database - ONLY HERE at the end of the turn
      // Cost is calculated from tokens, not from CLI cumulative value
      this.saveUsageToDatabase(sessionId, proc);
    }

    // Handle content_block_start - begin streaming text
    if (msg.type === 'content_block_start') {
      proc.isStreaming = true;
      proc.streamingText = '';
      // Stop thinking, start showing content
      this.io.to(`session:${sessionId}`).emit('session:thinking', {
        sessionId,
        isThinking: false,
      });
    }

    // Handle content_block_delta - stream text in real-time
    if (msg.type === 'content_block_delta' && msg.delta?.text) {
      proc.streamingText += msg.delta.text;
      // Emit streaming content to frontend
      this.io.to(`session:${sessionId}`).emit('session:output', {
        sessionId,
        content: msg.delta.text,
        isComplete: false,
      });
    }

    // Handle content_block_stop - save complete message
    if (msg.type === 'content_block_stop') {
      if (proc.streamingText.trim().length > 0) {
        this.saveAssistantMessage(sessionId, proc.streamingText.trim());
      }
      proc.isStreaming = false;
      proc.streamingText = '';
    }

    // Handle complete assistant messages (non-streaming fallback)
    if (msg.type === 'assistant' && msg.message && typeof msg.message !== 'string' && !proc.isStreaming) {
      let content = '';
      if (typeof msg.message.content === 'string') {
        content = msg.message.content;
      } else if (Array.isArray(msg.message.content)) {
        content = msg.message.content
          .filter((c: { type: string; text?: string }) => c.type === 'text' && c.text)
          .map((c: { type: string; text?: string }) => c.text)
          .join('');
      }

      if (content && content.trim().length > 0) {
        // Stop thinking, show the message
        this.io.to(`session:${sessionId}`).emit('session:thinking', {
          sessionId,
          isThinking: false,
        });

        // Save immediately as separate message
        this.saveAssistantMessage(sessionId, content.trim());
      }
    }

    // Handle tool use - show thinking while tool runs
    if (msg.type === 'tool_use' && msg.tool_use) {
      // Save any pending streaming content before tool use
      if (proc.streamingText.trim().length > 0) {
        this.saveAssistantMessage(sessionId, proc.streamingText.trim());
        proc.streamingText = '';
        proc.isStreaming = false;
      }
      this.io.to(`session:${sessionId}`).emit('session:thinking', {
        sessionId,
        isThinking: true,
      });
      this.emitToolUse(sessionId, {
        sessionId,
        toolName: msg.tool_use.name,
        status: 'started',
      });
    }

    // Handle user messages in stream (from subagent interactions) - show thinking
    // Also extract tool_result content to update tool executions
    if (msg.type === 'user') {
      this.io.to(`session:${sessionId}`).emit('session:thinking', {
        sessionId,
        isThinking: true,
      });

      // Extract tool results from user message content
      const userMsg = msg as { message?: { content?: Array<{ type: string; tool_use_id?: string; content?: string | Array<{ type: string; text?: string }> }> } };
      if (userMsg.message?.content && Array.isArray(userMsg.message.content)) {
        for (const block of userMsg.message.content) {
          if (block.type === 'tool_result' && block.tool_use_id) {
            // Extract result text
            let resultText = '';
            if (typeof block.content === 'string') {
              resultText = block.content;
            } else if (Array.isArray(block.content)) {
              resultText = block.content
                .filter((c) => c.type === 'text' && c.text)
                .map((c) => c.text)
                .join('\n');
            }

            // Emit tool result update
            if (resultText) {
              console.log(`[TOOL] Result for ${block.tool_use_id}: ${resultText.substring(0, 100)}...`);
              this.io.to(`session:${sessionId}`).emit('session:tool_use', {
                sessionId,
                toolId: block.tool_use_id,
                toolName: proc.pendingToolResults?.get(block.tool_use_id)?.toolName || 'Unknown',
                status: 'completed',
                result: resultText,
              });
              // Clean up pending
              proc.pendingToolResults?.delete(block.tool_use_id);
            }
          }
        }
      }
    }

    // Handle compact/summarization events
    // Claude sends these when auto-compacting context
    if (msg.type === 'system' && (msg.subtype === 'compact' || msg.subtype === 'pre_compact' ||
        (msg.message && typeof msg.message === 'string' && msg.message.toLowerCase().includes('compact')))) {
      console.log(`[COMPACT] Context compaction detected for session ${sessionId}`);
      // Reset token counts since context was compacted
      proc.totalInputTokens = 0;
      proc.totalOutputTokens = 0;
      proc.cacheReadTokens = 0;
      proc.cacheCreationTokens = 0;
      // Notify frontend about compaction
      this.io.to(`session:${sessionId}`).emit('session:compact', {
        sessionId,
        message: 'Context was auto-compacted to reduce token usage',
      });
      this.emitUsage(sessionId, proc);
    }

    // Handle result/completion
    if (msg.type === 'result' || (msg.type === 'system' && msg.subtype === 'turn_end')) {
      // Save any remaining streaming content
      if (proc.streamingText.trim().length > 0) {
        this.saveAssistantMessage(sessionId, proc.streamingText.trim());
        proc.streamingText = '';
        proc.isStreaming = false;
      }
      // Stop thinking indicator
      this.io.to(`session:${sessionId}`).emit('session:thinking', {
        sessionId,
        isThinking: false,
      });
    }
  }

  private saveAssistantMessage(sessionId: string, content: string): void {
    const db = getDatabase();
    const messageId = nanoid();
    const createdAt = new Date().toISOString();

    db.prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?, ?, ?, ?)').run(
      messageId,
      sessionId,
      'assistant',
      content
    );
    db.prepare('UPDATE sessions SET last_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
      content.substring(0, 200),
      sessionId
    );

    this.io.to(`session:${sessionId}`).emit('session:message', {
      id: messageId,
      sessionId,
      role: 'assistant',
      content,
      createdAt,
    });

    console.log(`Saved assistant message [${sessionId}]: ${content.substring(0, 100)}...`);
  }

  async sendMessage(
    sessionId: string,
    userId: string,
    message: string,
    attachments?: FileAttachmentData[]
  ): Promise<void> {
    let proc = this.processes.get(sessionId);

    if (!proc) {
      await this.startSession(sessionId, userId);
      proc = this.processes.get(sessionId);
      if (!proc) {
        throw new Error('Failed to start session');
      }
      // Wait for Claude to initialize
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    if (proc.userId !== userId) {
      throw new Error('Unauthorized');
    }

    // Process attachments by type
    const filePaths: { path: string; filename: string; type: 'image' | 'text' | 'pdf' | 'document'; mimeType: string }[] = [];
    const inlineTextContents: { filename: string; content: string }[] = [];

    if (attachments && attachments.length > 0) {
      const attachmentDir = path.join(proc.workingDirectory, '.claude-webui-attachments');
      await fs.mkdir(attachmentDir, { recursive: true });

      for (const [index, attachment] of attachments.entries()) {
        const type = getAttachmentType(attachment.mimeType, attachment.filename);
        const ext = getFileExtension(attachment.mimeType, attachment.filename);
        const buffer = Buffer.from(attachment.data, 'base64');

        // For text files, we can optionally inline the content
        if (type === 'text' && buffer.length < 50000) {
          // Inline small text files (< 50KB)
          const textContent = buffer.toString('utf-8');
          inlineTextContents.push({
            filename: attachment.filename || `file_${Date.now()}_${index}.${ext}`,
            content: textContent,
          });
        } else {
          // Save larger text files, images, PDFs, and other documents to disk
          const timestamp = Date.now();
          const baseFilename = attachment.filename
            ? attachment.filename.replace(/[^a-zA-Z0-9._-]/g, '_')
            : `file_${timestamp}_${index}.${ext}`;
          const filepath = path.join(attachmentDir, `${timestamp}_${baseFilename}`);
          await fs.writeFile(filepath, buffer);
          filePaths.push({
            path: filepath,
            filename: path.basename(filepath),
            type,
            mimeType: attachment.mimeType,
          });
        }
      }
    }

    // Build message for Claude (with attachment instructions and/or working dir reminder if needed)
    let messageForClaude = message;

    // Add working directory reminder for resumed sessions (only once)
    if (proc.needsWorkingDirReminder) {
      const workingDirReminder = `<system-reminder>
IMPORTANT: Your current working directory is: ${proc.workingDirectory}
This is the project you should be working on. All file operations should be relative to this directory.
</system-reminder>

`;
      messageForClaude = workingDirReminder + messageForClaude;
      proc.needsWorkingDirReminder = false;
      console.log(`Added working directory reminder for resumed session [${sessionId}]`);
    }

    // Add inline text content directly to the message
    if (inlineTextContents.length > 0) {
      const textParts = inlineTextContents.map(
        (tc) => `<attached-file name="${tc.filename}">\n${tc.content}\n</attached-file>`
      );
      messageForClaude = `${textParts.join('\n\n')}\n\n${messageForClaude}`;
    }

    // Add file references for files that need to be read from disk
    if (filePaths.length > 0) {
      const imageFiles = filePaths.filter((f) => f.type === 'image');
      const pdfFiles = filePaths.filter((f) => f.type === 'pdf');
      const otherFiles = filePaths.filter((f) => f.type !== 'image' && f.type !== 'pdf');

      const instructions: string[] = [];

      if (imageFiles.length > 0) {
        const refs = imageFiles.map((f) => `- ${f.path}`).join('\n');
        instructions.push(`Please analyze the following image files:\n${refs}\nUse the Read tool on these paths.`);
      }

      if (pdfFiles.length > 0) {
        const refs = pdfFiles.map((f) => `- ${f.path}`).join('\n');
        instructions.push(`Please read and analyze the following PDF files:\n${refs}\nUse the Read tool on these paths.`);
      }

      if (otherFiles.length > 0) {
        const refs = otherFiles.map((f) => `- ${f.path}`).join('\n');
        instructions.push(`Please read the following files:\n${refs}\nUse the Read tool on these paths.`);
      }

      if (instructions.length > 0) {
        messageForClaude = instructions.join('\n\n') + '\n\n' + messageForClaude;
      }
    }

    // Build attachment metadata for frontend (for backwards compatibility, images go in 'images' field)
    const imageMetadata = filePaths
      .filter((f) => f.type === 'image')
      .map((f) => ({
        path: f.path,
        filename: f.filename,
      }));

    // All attachments metadata (for new attachments field)
    const attachmentMetadata = [
      ...filePaths.map((f) => ({
        path: f.path,
        filename: f.filename,
        mimeType: f.mimeType,
        type: f.type,
      })),
      ...inlineTextContents.map((tc) => ({
        path: '',
        filename: tc.filename,
        mimeType: 'text/plain',
        type: 'text' as const,
      })),
    ];

    // Save user message and emit to frontend (show original message, images as metadata)
    const db = getDatabase();
    const messageId = nanoid();
    const createdAt = new Date().toISOString();
    db.prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?, ?, ?, ?)').run(
      messageId,
      sessionId,
      'user',
      message // Store only the user's original message
    );

    // Emit user message to frontend so it appears in chat
    this.io.to(`session:${sessionId}`).emit('session:message', {
      id: messageId,
      sessionId,
      role: 'user',
      content: message,
      createdAt,
      images: imageMetadata.length > 0 ? imageMetadata : undefined,
      attachments: attachmentMetadata.length > 0 ? attachmentMetadata : undefined,
    });

    // Track last message for permission approval resend
    proc.lastUserMessage = message;
    proc.lastAttachments = attachments || null;
    proc.pendingPermissionDenials = null; // Clear any previous denials

    // Emit thinking indicator
    this.io.to(`session:${sessionId}`).emit('session:thinking', {
      sessionId,
      isThinking: true,
    });

    // Send as stream-json input (with full message including image instructions)
    const inputMsg = {
      type: 'user',
      message: {
        role: 'user',
        content: messageForClaude,
      },
    };

    proc.process.stdin?.write(JSON.stringify(inputMsg) + '\n');
    console.log(`Sent message [${sessionId}]: ${messageForClaude.substring(0, 100)}...`);
  }

  interrupt(sessionId: string, userId: string): void {
    const proc = this.processes.get(sessionId);
    if (!proc) {
      throw new Error('Session not running');
    }

    if (proc.userId !== userId) {
      throw new Error('Unauthorized');
    }

    console.log(`Interrupting session [${sessionId}]`);

    // Clear any pending streaming content
    if (proc.streamingText.trim().length > 0) {
      // Save partial response before interrupt
      this.saveAssistantMessage(sessionId, proc.streamingText.trim() + '\n\n[Interrupted]');
      proc.streamingText = '';
      proc.isStreaming = false;
    }

    // Stop thinking indicator
    this.io.to(`session:${sessionId}`).emit('session:thinking', {
      sessionId,
      isThinking: false,
    });

    // Send interrupt signal
    proc.process.kill('SIGINT');
  }

  async sendRawInput(sessionId: string, userId: string, input: string): Promise<void> {
    // In stream-json mode, raw input is treated as a user message
    await this.sendMessage(sessionId, userId, input);
  }

  stopSession(sessionId: string, userId: string): void {
    const proc = this.processes.get(sessionId);
    if (!proc) {
      return;
    }

    if (proc.userId !== userId) {
      throw new Error('Unauthorized');
    }

    // Close stdin to signal end
    proc.process.stdin?.end();

    setTimeout(() => {
      if (this.processes.has(sessionId)) {
        proc.process.kill();
        this.cleanupProcess(sessionId);
      }
    }, 2000);
  }

  // Restart a session (stop and start fresh)
  async restartSession(sessionId: string, userId: string): Promise<void> {
    console.log(`[SESSION] Restarting session ${sessionId}`);

    const proc = this.processes.get(sessionId);
    const currentMode = proc?.mode ?? this.pendingModes.get(sessionId) ?? 'auto-accept';

    // Stop if running
    if (proc) {
      if (proc.userId !== userId) {
        throw new Error('Unauthorized');
      }

      // Kill the process immediately
      proc.process.kill('SIGTERM');
      this.processes.delete(sessionId);
    }

    // Clear claude_session_id to start fresh (not resume)
    const db = getDatabase();
    db.prepare('UPDATE sessions SET status = ?, claude_session_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
      'stopped',
      sessionId
    );
    console.log(`[SESSION] Cleared claude_session_id for fresh start`);

    // Wait a moment for cleanup
    await new Promise(resolve => setTimeout(resolve, 500));

    // Start fresh with the same mode
    await this.startSession(sessionId, userId, currentMode);

    console.log(`[SESSION] Session ${sessionId} restarted`);
  }

  // Set permission mode for a session
  setMode(sessionId: string, userId: string, mode: SessionMode): void {
    const proc = this.processes.get(sessionId);

    // If no process running, store the mode for when it starts
    if (!proc) {
      console.log(`[MODE] No running process for ${sessionId}, storing mode ${mode} for next start`);
      this.pendingModes.set(sessionId, mode);
      return;
    }

    if (proc.userId !== userId) {
      throw new Error('Unauthorized');
    }

    if (proc.mode === mode) {
      console.log(`[MODE] Session ${sessionId} already in mode ${mode}`);
      return;
    }

    console.log(`[MODE] Changing session ${sessionId} from ${proc.mode} to ${mode}`);

    // Store the new mode
    const previousMode = proc.mode;
    proc.mode = mode;

    // For mode changes on running sessions, we need to restart the process
    // Save any pending streaming content first
    if (proc.streamingText.trim().length > 0) {
      this.saveAssistantMessage(sessionId, proc.streamingText.trim());
      proc.streamingText = '';
      proc.isStreaming = false;
    }

    // Kill the current process and restart with new mode
    proc.process.kill('SIGTERM');

    // Wait a bit for the process to terminate, then restart
    setTimeout(async () => {
      this.processes.delete(sessionId);
      try {
        await this.startSession(sessionId, userId, mode);
        console.log(`[MODE] Session ${sessionId} restarted with mode ${mode}`);
      } catch (err) {
        console.error(`[MODE] Failed to restart session ${sessionId}:`, err);
        // Revert mode on failure
        const newProc = this.processes.get(sessionId);
        if (newProc) {
          newProc.mode = previousMode;
        }
      }
    }, 1000);
  }

  private cleanupProcess(sessionId: string): void {
    const proc = this.processes.get(sessionId);
    if (!proc) return;

    this.processes.delete(sessionId);

    const db = getDatabase();
    db.prepare('UPDATE sessions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
      'stopped',
      sessionId
    );

    this.emitStatus(sessionId, {
      sessionId,
      status: 'stopped',
    });
  }

  getRunningSessionIds(): string[] {
    return Array.from(this.processes.keys());
  }

  // Handle permission approval - restart session with allowed tools and resend message
  async approvePermission(
    sessionId: string,
    userId: string,
    toolNames: string[],
    originalMessage: string
  ): Promise<void> {
    const proc = this.processes.get(sessionId);
    if (!proc) {
      throw new Error('Session not running');
    }

    if (proc.userId !== userId) {
      throw new Error('Unauthorized');
    }

    console.log(`[PERMISSION] Approving tools: ${toolNames.join(', ')} for session ${sessionId}`);

    // Get the pending denials and last message
    const lastMessage = originalMessage || proc.lastUserMessage;
    const lastAttachments = proc.lastAttachments;

    if (!lastMessage) {
      throw new Error('No message to resend');
    }

    // Clear pending denials
    proc.pendingPermissionDenials = null;

    // Store Claude session ID and working directory before killing
    const claudeSessionId = proc.claudeSessionId;
    const workingDirectory = proc.workingDirectory;
    const mode = proc.mode;

    // Kill current process
    proc.process.kill('SIGTERM');
    this.processes.delete(sessionId);

    // Wait for process to terminate
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Restart with allowed tools
    const db = getDatabase();
    const session = db
      .prepare('SELECT * FROM sessions WHERE id = ? AND user_id = ?')
      .get(sessionId, userId) as { working_directory: string; claude_session_id: string | null; allowed_directories: string | null } | undefined;

    if (!session) {
      throw new Error('Session not found');
    }

    // Build command args with allowed tools
    const args: string[] = [
      '--print',
      '--verbose',
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      '--include-partial-messages',
      ...this.getPermissionFlags(mode),
    ];

    // Add allowed tools
    for (const toolName of toolNames) {
      args.push('--allowedTools', toolName);
    }

    // Add allowed directories
    const allowedDirs: string[] = session.allowed_directories
      ? JSON.parse(session.allowed_directories)
      : [];
    for (const dir of allowedDirs) {
      args.push('--add-dir', dir);
    }

    // Resume existing Claude session
    if (claudeSessionId) {
      args.push('--resume', claudeSessionId);
    }

    console.log(`[PERMISSION] Restarting Claude with args: ${args.join(' ')}`);

    // Spawn new process
    const newProc = cpSpawn('claude', args, {
      cwd: workingDirectory,
      env: {
        ...process.env,
        WEBUI_SESSION_ID: sessionId,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const claudeProcess: ClaudeProcess = {
      process: newProc,
      sessionId,
      userId,
      workingDirectory,
      claudeSessionId,
      buffer: '',
      streamingText: '',
      isStreaming: false,
      mode,
      currentToolName: null,
      currentToolId: null,
      currentToolInput: '',
      currentAgentType: null,
      model: proc.model || 'unknown',
      contextWindow: proc.contextWindow || 200000,
      turnInputTokens: 0,
      turnCacheReadTokens: 0,
      turnCacheCreationTokens: 0,
      turnOutputTokens: 0,
      totalInputTokens: proc.totalInputTokens,
      totalOutputTokens: proc.totalOutputTokens,
      cacheReadTokens: proc.cacheReadTokens,
      cacheCreationTokens: proc.cacheCreationTokens,
      totalCostUsd: proc.totalCostUsd,
      previousTotalCostUsd: proc.previousTotalCostUsd,
      needsWorkingDirReminder: false,
      outputBuffer: proc.outputBuffer,
      lastActivityAt: Date.now(),
      disconnectedAt: null,
      lastUserMessage: null,
      lastAttachments: null,
      pendingPermissionDenials: null,
    };

    this.processes.set(sessionId, claudeProcess);

    // Setup handlers
    newProc.stdout?.on('data', (data: Buffer) => {
      this.handleJsonOutput(sessionId, data.toString());
    });

    newProc.stderr?.on('data', (data: Buffer) => {
      console.error(`Claude stderr [${sessionId}]:`, data.toString());
    });

    newProc.on('exit', (exitCode) => {
      console.log(`Claude process for session ${sessionId} exited with code ${exitCode}`);
      this.cleanupProcess(sessionId);
    });

    newProc.on('error', (err) => {
      console.error(`Claude process error [${sessionId}]:`, err);
      this.cleanupProcess(sessionId);
    });

    // Wait for initialization
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Resend the original message
    await this.sendMessage(sessionId, userId, lastMessage, lastAttachments || undefined);
  }

  // Handle permission denial - clear pending state
  denyPermission(sessionId: string, userId: string): void {
    const proc = this.processes.get(sessionId);
    if (!proc) {
      return;
    }

    if (proc.userId !== userId) {
      throw new Error('Unauthorized');
    }

    console.log(`[PERMISSION] User denied permission for session ${sessionId}`);
    proc.pendingPermissionDenials = null;
    proc.lastUserMessage = null;
    proc.lastAttachments = null;
  }
}
