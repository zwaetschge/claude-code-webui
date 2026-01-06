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
import path from 'path';
import { ChildProcess, spawn as cpSpawn } from 'child_process';

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

interface ImageData {
  data: string; // base64
  mimeType: string;
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
  // Context reminder flag for resumed sessions
  needsWorkingDirReminder: boolean;
  // Reconnect buffer
  outputBuffer: CircularBuffer<BufferedMessage>;
  lastActivityAt: number;
  disconnectedAt: number | null;
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

  // Map UI modes to Claude CLI permission flags
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
      .get(sessionId, userId) as { working_directory: string; claude_session_id: string | null } | undefined;

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
    const args: string[] = [
      '--print',
      '--verbose',
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      '--include-partial-messages',
      ...this.getPermissionFlags(effectiveMode),
    ];

    const isResuming = !!session.claude_session_id;
    if (isResuming && session.claude_session_id) {
      args.push('--resume', session.claude_session_id);
    }

    console.log(`Starting Claude with args: ${args.join(' ')}`);
    console.log(`Working directory: ${session.working_directory}`);
    console.log(`Resuming: ${isResuming}`);

    // Use regular spawn instead of PTY for stream-json mode
    const proc = cpSpawn('claude', args, {
      cwd: session.working_directory,
      env: {
        ...process.env,
        // Pass session ID so Claude can use it for image generation
        WEBUI_SESSION_ID: sessionId,
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
      // Only need reminder for resumed sessions
      needsWorkingDirReminder: isResuming,
      // Reconnect buffer
      outputBuffer: new CircularBuffer<BufferedMessage>(BUFFER_SIZE),
      lastActivityAt: Date.now(),
      disconnectedAt: null,
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
    const turnTotalTokens = contextTokens + proc.turnOutputTokens;
    const contextUsedPercent = Math.round((contextTokens / proc.contextWindow) * 100);

    console.log(`[USAGE] Emitting usage for ${sessionId}: model=${proc.model}, contextTokens=${contextTokens}, turnTotal=${turnTotalTokens}, context=${contextUsedPercent}%, cost=$${proc.totalCostUsd}`);

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

    // Save usage to database for analytics (only if there are tokens to record)
    if (turnTotalTokens > 0) {
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
          proc.totalCostUsd,
          proc.model
        );
      } catch (error) {
        console.error('[USAGE] Failed to save usage to database:', error);
      }
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

          // Emit tool completion with input (result will come from tool_result)
          try {
            const inputData = JSON.parse(proc.currentToolInput);
            // For display, show a summary of the input
            let inputSummary = '';
            if (proc.currentToolName === 'Read' && inputData.file_path) {
              inputSummary = inputData.file_path;
            } else if (proc.currentToolName === 'Write' && inputData.file_path) {
              inputSummary = inputData.file_path;
            } else if (proc.currentToolName === 'Edit' && inputData.file_path) {
              inputSummary = inputData.file_path;
            } else if (proc.currentToolName === 'Bash' && inputData.command) {
              inputSummary = inputData.command.substring(0, 100);
            } else if (proc.currentToolName === 'Glob' && inputData.pattern) {
              inputSummary = inputData.pattern;
            } else if (proc.currentToolName === 'Grep' && inputData.pattern) {
              inputSummary = inputData.pattern;
            } else if (proc.currentToolName === 'WebFetch' && inputData.url) {
              inputSummary = inputData.url;
            } else if (proc.currentToolName === 'WebSearch' && inputData.query) {
              inputSummary = inputData.query;
            } else {
              inputSummary = JSON.stringify(inputData).substring(0, 100);
            }

            // Note: The actual result will be captured from tool_result message
            // For now, we just show the input was accepted
            this.emitToolUse(sessionId, {
              sessionId,
              toolName: proc.currentToolName,
              toolId: proc.currentToolId || undefined,
              status: 'completed',
              input: inputSummary,
            });
          } catch {
            // If parsing fails, just emit with raw input
            this.emitToolUse(sessionId, {
              sessionId,
              toolName: proc.currentToolName,
              toolId: proc.currentToolId || undefined,
              status: 'completed',
              input: proc.currentToolInput.substring(0, 100),
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
    if (msg.type === 'user') {
      this.io.to(`session:${sessionId}`).emit('session:thinking', {
        sessionId,
        isThinking: true,
      });
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
    images?: ImageData[]
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

    // Handle images
    let imagePaths: string[] = [];
    if (images && images.length > 0) {
      const imageDir = path.join(proc.workingDirectory, '.claude-webui-images');
      await fs.mkdir(imageDir, { recursive: true });

      imagePaths = await Promise.all(
        images.map(async (img, index) => {
          const ext = img.mimeType.split('/')[1] || 'png';
          const filename = `image_${Date.now()}_${index}.${ext}`;
          const filepath = path.join(imageDir, filename);
          const buffer = Buffer.from(img.data, 'base64');
          await fs.writeFile(filepath, buffer);
          return filepath;
        })
      );
    }

    // Build message for Claude (with image instructions and/or working dir reminder if needed)
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

    if (imagePaths.length > 0) {
      const imageRefs = imagePaths.map((p) => `- ${p}`).join('\n');
      const imagePrompt = `Please analyze the following image files:\n${imageRefs}\nUse the Read tool on these paths.\n\n`;
      messageForClaude = imagePrompt + messageForClaude;
    }

    // Build image metadata for frontend (filename only, served via API)
    const imageMetadata = imagePaths.map((p) => ({
      path: p,
      filename: path.basename(p),
    }));

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
    });

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
}
