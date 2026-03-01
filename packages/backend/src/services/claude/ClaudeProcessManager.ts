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
import os from 'os';
import { fileURLToPath } from 'url';
import { ChildProcess, spawn as cpSpawn } from 'child_process';
import { EventEmitter } from 'events';
import { config } from '../../config';
import { CLI_PROVIDERS, getCLIArgs, formatInputMessage, type CLIProvider } from '../cli-providers.js';
import { resolveConfigHome } from '../../utils/configPaths.js';
import { syncExternalSkills } from '../../utils/skillSync.js';
import { safeDecrypt } from '../../utils/encryption.js';
import { safeJsonParse } from '../../utils/json.js';
import { getWatchdog } from '../watchdog/WatchdogService';
import { GeminiApiAdapter } from '../gemini/GeminiApiAdapter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Circular buffer for storing messages for reconnection
const BUFFER_SIZE = 5000;
const DISCONNECT_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const CONTEXT_REMINDER_MAX_CHARS = 4000;
const CONTEXT_REMINDER_MAX_MESSAGES = 4;
const HANDOFF_CONTEXT_MAX_CHARS = 60000;
const HANDOFF_CONTEXT_MAX_MESSAGES = 80;
const WEBUI_MANAGED_MARKER = '<!-- webui-managed: shared-config -->';
const WEBUI_MANAGED_BLOCK_START = '<!-- webui-managed: shared-config:start -->';
const WEBUI_MANAGED_BLOCK_END = '<!-- webui-managed: shared-config:end -->';
const ZAI_BASE_URL_DEFAULT = 'https://api.z.ai/api/anthropic';

interface SharedAgent {
  name: string;
  prompt: string;
  tools?: string[];
  model?: string;
}

interface SharedSkill {
  name: string;
  content: string;
  allowedTools?: string[];
  model?: string;
}

interface SharedPlugin {
  name: string;
  description?: string;
  version?: string;
  author?: string;
  category?: string;
  content?: string;
  source: 'user' | 'marketplace';
  marketplace?: string;
}

async function readClaudeEnvFromConfigHome(configHome: string): Promise<Record<string, string>> {
  const candidates = [
    path.join(configHome, 'settings.json'),
    path.join(configHome, 'settings.local.json'),
  ];

  for (const settingsPath of candidates) {
    try {
      const content = await fs.readFile(settingsPath, 'utf-8');
      const settings = JSON.parse(content) as { env?: Record<string, string> };
      if (settings.env && typeof settings.env === 'object') {
        return settings.env;
      }
    } catch {
      // Ignore missing or invalid files.
    }
  }

  return {};
}

async function getZaiApiKeyForUser(userId: string): Promise<string | null> {
  const db = getDatabase();
  const row = db.prepare(
    'SELECT settings_json FROM user_settings WHERE user_id = ?'
  ).get(userId) as { settings_json?: string | null } | undefined;

  const settingsJson = safeJsonParse<Record<string, unknown>>(row?.settings_json, {});
  const encryptedKey = settingsJson.zaiApiKey;
  return typeof encryptedKey === 'string' ? safeDecrypt(encryptedKey) : null;
}

async function getCliModelForUser(userId: string, provider: CLIProvider): Promise<string | null> {
  const db = getDatabase();
  const row = db.prepare(
    'SELECT settings_json FROM user_settings WHERE user_id = ?'
  ).get(userId) as { settings_json?: string | null } | undefined;

  const settingsJson = safeJsonParse<Record<string, unknown>>(row?.settings_json, {});
  const models = settingsJson.cliProviderModels;
  if (!models || typeof models !== 'object') {
    return null;
  }

  const model = (models as Record<string, unknown>)[provider];
  return typeof model === 'string' && model.trim() ? model.trim() : null;
}

const CODEX_REASONING_LEVELS = new Set(['low', 'medium', 'high', 'extra_high']);

function normalizeReasoningLevel(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (!normalized) {
    return null;
  }
  return CODEX_REASONING_LEVELS.has(normalized) ? normalized : null;
}

async function getCliReasoningForUser(userId: string, provider: CLIProvider): Promise<string | null> {
  const db = getDatabase();
  const row = db.prepare(
    'SELECT settings_json FROM user_settings WHERE user_id = ?'
  ).get(userId) as { settings_json?: string | null } | undefined;

  const settingsJson = safeJsonParse<Record<string, unknown>>(row?.settings_json, {});
  const levels = settingsJson.cliProviderReasoning;
  if (!levels || typeof levels !== 'object') {
    return null;
  }

  const level = (levels as Record<string, unknown>)[provider];
  return normalizeReasoningLevel(level);
}

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

function parseMarkdownFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
  const frontmatter: Record<string, string> = {};
  let body = content;

  if (content.startsWith('---')) {
    const endIndex = content.indexOf('---', 3);
    if (endIndex !== -1) {
      const yamlContent = content.substring(3, endIndex).trim();
      body = content.substring(endIndex + 3).trim();

      yamlContent.split('\n').forEach((line) => {
        const colonIndex = line.indexOf(':');
        if (colonIndex > 0) {
          const key = line.substring(0, colonIndex).trim();
          const value = line.substring(colonIndex + 1).trim();
          frontmatter[key] = value;
        }
      });
    }
  }

  return { frontmatter, body };
}

async function readSharedAgents(configHome: string): Promise<SharedAgent[]> {
  const agentsDir = path.join(configHome, 'agents');
  const agents: SharedAgent[] = [];
  let files: string[] = [];

  try {
    files = await fs.readdir(agentsDir);
  } catch {
    return agents;
  }

  for (const file of files) {
    const isDisabled = file.endsWith('.md.disabled');
    const isEnabled = file.endsWith('.md') && !isDisabled;
    if (!isEnabled) continue;

    const filePath = path.join(agentsDir, file);
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const { frontmatter, body } = parseMarkdownFrontmatter(content);
      const baseName = file.replace('.md', '');
      agents.push({
        name: frontmatter.name || baseName,
        prompt: body,
        tools: frontmatter.tools?.split(',').map((tool) => tool.trim()),
        model: frontmatter.model,
      });
    } catch {
      // Skip unreadable files
    }
  }

  return agents;
}

async function readSharedSkills(configHome: string): Promise<SharedSkill[]> {
  await syncExternalSkills(configHome);
  const skillsDir = path.join(configHome, 'skills');
  const skills: SharedSkill[] = [];
  let entries: Array<{ name: string; isDirectory: () => boolean }> = [];

  try {
    entries = await fs.readdir(skillsDir, { withFileTypes: true });
  } catch {
    return skills;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.endsWith('.disabled')) continue;

    const skillDir = path.join(skillsDir, entry.name);
    const skillFile = path.join(skillDir, 'SKILL.md');
    try {
      const content = await fs.readFile(skillFile, 'utf-8');
      const { frontmatter, body } = parseMarkdownFrontmatter(content);
      skills.push({
        name: frontmatter.name || entry.name,
        content: body,
        allowedTools: frontmatter['allowed-tools']?.split(',').map((tool) => tool.trim()),
        model: frontmatter.model,
      });
    } catch {
      // Skip missing or unreadable skills
    }
  }

  return skills;
}

async function readSharedPlugins(configHome: string): Promise<SharedPlugin[]> {
  const plugins: SharedPlugin[] = [];
  const userPluginsDir = path.join(configHome, 'plugins', 'user');
  const installedPluginsFile = path.join(configHome, 'plugins', 'installed_plugins.json');

  try {
    const entries = await fs.readdir(userPluginsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.endsWith('.disabled')) continue;

      const pluginDir = path.join(userPluginsDir, entry.name);
      const pluginFile = path.join(pluginDir, 'PLUGIN.md');
      try {
        const content = await fs.readFile(pluginFile, 'utf-8');
        const { frontmatter, body } = parseMarkdownFrontmatter(content);
        plugins.push({
          name: frontmatter.name || entry.name,
          description: frontmatter.description,
          version: frontmatter.version,
          author: frontmatter.author,
          category: frontmatter.category,
          content: body.trim() || undefined,
          source: 'user',
        });
      } catch {
        // Skip unreadable plugins
      }
    }
  } catch {
    // No user plugins
  }

  try {
    const content = await fs.readFile(installedPluginsFile, 'utf-8');
    const data = JSON.parse(content) as { plugins?: Record<string, Array<{ installPath: string; version?: string }>> };
    const entries = Object.entries(data.plugins || {});
    for (const [pluginId, installs] of entries) {
      const install = installs?.[0];
      if (!install?.installPath) continue;

      const pluginFile = path.join(install.installPath, 'PLUGIN.md');
      try {
        const pluginContent = await fs.readFile(pluginFile, 'utf-8');
        const { frontmatter, body } = parseMarkdownFrontmatter(pluginContent);
        const [name, marketplace] = pluginId.split('@');
        plugins.push({
          name: frontmatter.name || name || pluginId,
          description: frontmatter.description,
          version: frontmatter.version || install.version,
          author: frontmatter.author,
          category: frontmatter.category,
          content: body.trim() || undefined,
          source: 'marketplace',
          marketplace,
        });
      } catch {
        // Skip marketplace plugin without PLUGIN.md
      }
    }
  } catch {
    // No installed plugins
  }

  return plugins;
}

function formatCodexSharedContext(
  agents: SharedAgent[],
  skills: SharedSkill[],
  plugins: SharedPlugin[]
): string | null {
  if (!agents.length && !skills.length && !plugins.length) {
    return null;
  }

  const lines: string[] = [];
  lines.push('[Shared Claude Config]');
  lines.push('These Claude skills and agents are available in this session. Use them when relevant.');

  if (skills.length > 0) {
    lines.push('');
    lines.push('Skills:');
    for (const skill of skills) {
      lines.push(`- ${skill.name}`);
      if (skill.allowedTools && skill.allowedTools.length > 0) {
        lines.push(`  Allowed tools: ${skill.allowedTools.join(', ')}`);
      }
      if (skill.model) {
        lines.push(`  Model: ${skill.model}`);
      }
      if (skill.content.trim()) {
        lines.push('  Instructions:');
        lines.push(skill.content.trim());
      }
    }
  }

  if (agents.length > 0) {
    lines.push('');
    lines.push('Agents:');
    for (const agent of agents) {
      lines.push(`- ${agent.name}`);
      if (agent.tools && agent.tools.length > 0) {
        lines.push(`  Tools: ${agent.tools.join(', ')}`);
      }
      if (agent.model) {
        lines.push(`  Model: ${agent.model}`);
      }
      if (agent.prompt.trim()) {
        lines.push('  Prompt:');
        lines.push(agent.prompt.trim());
      }
    }
  }

  if (plugins.length > 0) {
    lines.push('');
    lines.push('Plugins:');
    for (const plugin of plugins) {
      lines.push(`- ${plugin.name}`);
      if (plugin.version) {
        lines.push(`  Version: ${plugin.version}`);
      }
      if (plugin.author) {
        lines.push(`  Author: ${plugin.author}`);
      }
      if (plugin.category) {
        lines.push(`  Category: ${plugin.category}`);
      }
      if (plugin.marketplace) {
        lines.push(`  Marketplace: ${plugin.marketplace}`);
      }
      if (plugin.description) {
        lines.push(`  Description: ${plugin.description}`);
      }
      if (plugin.content) {
        lines.push('  Instructions:');
        lines.push(plugin.content.trim());
      }
    }
  }

  lines.push('');
  lines.push('[End Shared Claude Config]');

  return lines.join('\n');
}

function formatSharedInstructionFile(
  agents: SharedAgent[],
  skills: SharedSkill[],
  plugins: SharedPlugin[]
): string {
  const lines: string[] = [];
  lines.push(WEBUI_MANAGED_BLOCK_START);
  lines.push('# Shared Provider Context');
  lines.push('This file is generated by Claude Code WebUI to share config across providers.');
  lines.push('Remove this block to opt out of automatic updates.');

  if (skills.length > 0) {
    lines.push('');
    lines.push('## Skills');
    for (const skill of skills) {
      lines.push(`- ${skill.name}`);
      if (skill.allowedTools && skill.allowedTools.length > 0) {
        lines.push(`  - Allowed tools: ${skill.allowedTools.join(', ')}`);
      }
      if (skill.model) {
        lines.push(`  - Model: ${skill.model}`);
      }
      if (skill.content.trim()) {
        lines.push('  - Instructions:');
        lines.push(skill.content.trim());
      }
    }
  }

  if (agents.length > 0) {
    lines.push('');
    lines.push('## Agents');
    for (const agent of agents) {
      lines.push(`- ${agent.name}`);
      if (agent.tools && agent.tools.length > 0) {
        lines.push(`  - Tools: ${agent.tools.join(', ')}`);
      }
      if (agent.model) {
        lines.push(`  - Model: ${agent.model}`);
      }
      if (agent.prompt.trim()) {
        lines.push('  - Prompt:');
        lines.push(agent.prompt.trim());
      }
    }
  }

  if (plugins.length > 0) {
    lines.push('');
    lines.push('## Plugins');
    for (const plugin of plugins) {
      lines.push(`- ${plugin.name}`);
      if (plugin.version) {
        lines.push(`  - Version: ${plugin.version}`);
      }
      if (plugin.author) {
        lines.push(`  - Author: ${plugin.author}`);
      }
      if (plugin.category) {
        lines.push(`  - Category: ${plugin.category}`);
      }
      if (plugin.marketplace) {
        lines.push(`  - Marketplace: ${plugin.marketplace}`);
      }
      if (plugin.description) {
        lines.push(`  - Description: ${plugin.description}`);
      }
      if (plugin.content) {
        lines.push('  - Instructions:');
        lines.push(plugin.content.trim());
      }
    }
  }

  if (skills.length === 0 && agents.length === 0 && plugins.length === 0) {
    lines.push('');
    lines.push('_No shared skills, agents, or plugins were found._');
  }

  lines.push(WEBUI_MANAGED_BLOCK_END);
  return lines.join('\n');
}

function replaceManagedBlock(existing: string, block: string): string | null {
  const start = WEBUI_MANAGED_BLOCK_START;
  const end = WEBUI_MANAGED_BLOCK_END;
  const pattern = new RegExp(`${start}[\\s\\S]*?${end}`, 'm');
  if (!pattern.test(existing)) {
    return null;
  }
  return existing.replace(pattern, block);
}

async function ensureSharedInstructionFiles(workingDir: string, configHome: string): Promise<void> {
  const [agents, skills, plugins] = await Promise.all([
    readSharedAgents(configHome),
    readSharedSkills(configHome),
    readSharedPlugins(configHome),
  ]);
  const content = formatSharedInstructionFile(agents, skills, plugins);
  const files = ['AGENTS.md', 'CLAUDE.md'];

  for (const filename of files) {
    const filePath = path.join(workingDir, filename);
    try {
      const existing = await fs.readFile(filePath, 'utf-8');
      const replaced = replaceManagedBlock(existing, content);
      if (replaced) {
        if (replaced.trim() === existing.trim()) {
          continue;
        }
        await fs.writeFile(filePath, replaced, 'utf-8');
        continue;
      }

      if (existing.includes(WEBUI_MANAGED_MARKER)) {
        await fs.writeFile(filePath, content, 'utf-8');
        continue;
      }

      const appended = `${existing.trimEnd()}\n\n${content}\n`;
      await fs.writeFile(filePath, appended, 'utf-8');
      continue;
    } catch {
      // File doesn't exist or can't be read; we'll attempt to write below.
    }

    try {
      await fs.writeFile(filePath, content, 'utf-8');
    } catch {
      // Ignore failures in project dirs without write permission
    }
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
  // CLI provider for this session
  cliProvider: CLIProvider;
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
  contextReminder: { summary: string; reason: 'mode-change' | 'provider-switch' | 'context-limit' } | null;
  // Reconnect buffer
  outputBuffer: CircularBuffer<BufferedMessage>;
  lastActivityAt: number;
  disconnectedAt: number | null;
  // Permission approval tracking
  lastUserMessage: string | null;
  lastAttachments: FileAttachmentData[] | null;
  pendingPermissionDenials: PermissionDenial[] | null;
  sharedContextInjected: boolean;
  modePromptInjected: SessionMode | null;
  lastContextLimitAt?: number;
  kimiIdleTimer?: ReturnType<typeof setTimeout>; // Timer to detect Kimi idle after tool results
}

export class ClaudeProcessManager {
  private processes: Map<string, ClaudeProcess> = new Map();
  private geminiAdapters: Map<string, GeminiApiAdapter> = new Map();
  private pendingModes: Map<string, SessionMode> = new Map(); // Store modes for sessions not yet started
  private pendingContextReminders: Map<string, { summary: string; reason: 'mode-change' | 'provider-switch' | 'context-limit' }> = new Map();
  private io: Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

  /** Public event emitter for external consumers (e.g. RalphService) */
  public events = new EventEmitter();

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

  private getPlanningPrompt(): string {
    return `
## PLANNING MODE ACTIVE

You are in Planning Mode. Do not execute tools other than TodoWrite or ExitPlanMode.

### Planning Rules:
1. Provide a concise, step-by-step plan before any execution.
2. Capture actionable steps with TodoWrite.
3. Ask clarifying questions in plain text if needed.
4. When the plan is approved, call ExitPlanMode to proceed.
`;
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

  private getModePrompt(mode: SessionMode): string | null {
    if (mode === 'planning') {
      return this.getPlanningPrompt();
    }
    if (mode === 'orchestration') {
      return this.getOrchestrationPrompt();
    }
    return null;
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

  private emitModeChange(sessionId: string, mode: SessionMode): void {
    const data = { sessionId, mode };
    this.bufferMessage(sessionId, 'mode', data);
    this.io.to(`session:${sessionId}`).emit('session:mode', data);
  }

  // Get buffered messages since a timestamp for reconnection
  getSessionBuffer(sessionId: string, sinceTimestamp?: number): BufferedMessage[] {
    const proc = this.processes.get(sessionId);
    if (!proc) return [];

    if (sinceTimestamp) {
      return proc.outputBuffer.getSince((msg) => msg.timestamp >= sinceTimestamp);
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

    // For Gemini API adapter, abort any in-flight request and kill the fake process
    const adapter = this.geminiAdapters.get(sessionId);
    if (adapter) {
      adapter.interrupt();
      proc.process.kill();
      this.cleanupProcess(sessionId);
      return;
    }

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
      .get(sessionId, userId) as { working_directory: string; claude_session_id: string | null; allowed_directories: string | null; cli_provider: CLIProvider | null } | undefined;

    if (!session) {
      throw new Error('Session not found');
    }

    if (this.processes.has(sessionId)) {
      return;
    }
    getWatchdog()?.initSession(sessionId);

    // Use provided mode, or pending mode, or default to 'auto-accept'
    const effectiveMode = mode ?? this.pendingModes.get(sessionId) ?? 'auto-accept';
    this.pendingModes.delete(sessionId); // Clear pending mode once used
    // Get CLI provider (default to claude for backwards compatibility)
    const cliProvider: CLIProvider = session.cli_provider || 'claude';
    const providerConfig = CLI_PROVIDERS[cliProvider];
    const configHome = resolveConfigHome(cliProvider);
    const selectedModel = await getCliModelForUser(userId, cliProvider);
    const selectedReasoning = await getCliReasoningForUser(userId, cliProvider);

    console.log(`[MODE] Starting session ${sessionId} with mode ${effectiveMode}, provider ${cliProvider}`);

    // Parse allowed directories
    const allowedDirs: string[] = session.allowed_directories
      ? JSON.parse(session.allowed_directories)
      : [];

    const isResuming = !!session.claude_session_id;
    let args: string[] = [];

    await ensureSharedInstructionFiles(session.working_directory, configHome);

    if (cliProvider === 'claude' || cliProvider === 'glm') {
      // Build command args for stream-json mode (hooks-based permissions)
      // IMPORTANT: Always use --dangerously-skip-permissions so our hook is the ONLY permission layer
      // Without this, Claude's internal permission system would still prompt after our hook approves
      args = [
        '--print',
        '--verbose',
        '--debug', 'hooks',
        '--output-format', 'stream-json',
        '--input-format', 'stream-json',
        '--include-partial-messages',
        '--dangerously-skip-permissions',
      ];

      if (selectedModel) {
        args.push('--model', selectedModel);
      }

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

      if (isResuming && session.claude_session_id) {
        args.push('--resume', session.claude_session_id);
      }

      if (effectiveMode === 'planning') {
        args.push('--append-system-prompt', this.getPlanningPrompt());
      }

      if (effectiveMode === 'orchestration') {
        args.push('--append-system-prompt', this.getOrchestrationPrompt());
      }
    } else {
      // For Kimi: Always pass sessionId as --session so context persists across process restarts.
      // Kimi doesn't emit a session_id in its output (unlike Claude), so we use the WebUI sessionId directly.
      // This ensures Kimi can restore conversation history from its context file when the process is restarted.
      const resumeId = cliProvider === 'kimi'
        ? sessionId
        : (isResuming ? session.claude_session_id ?? undefined : undefined);

      // Build command args using CLI provider abstraction
      args = getCLIArgs(cliProvider, {
        mode: effectiveMode,
        resumeSessionId: resumeId,
        allowedDirectories: allowedDirs,
        workingDirectory: session.working_directory,
        model: selectedModel ?? undefined,
        reasoningLevel: selectedReasoning ?? undefined,
      });
    }

    console.log(`[SESSION] ========== Starting Session ==========`);
    console.log(`[SESSION] Provider: ${providerConfig.name} (${cliProvider})`);
    console.log(`[SESSION] Session ID: ${sessionId}`);
    console.log(`[SESSION] Working directory: ${session.working_directory}`);
    console.log(`[SESSION] Mode: ${effectiveMode}`);
    console.log(`[SESSION] Allowed directories: ${allowedDirs.join(', ') || 'none'}`);
    console.log(`[SESSION] Resuming: ${isResuming}`);
    console.log(`[SESSION] Args: ${args.join(' ')}`);
    console.log(`[SESSION] Env WEBUI_SESSION_ID: ${sessionId}`);
    console.log(`[SESSION] Env WEBUI_BACKEND_URL: http://localhost:${config.port}`);
    console.log(`[SESSION] Env WEBUI_PROJECT_PATH: ${session.working_directory}`);
    console.log(`[SESSION] ==============================================`); 

    const extraEnv: Record<string, string> = {};
    if (cliProvider === 'claude' || cliProvider === 'glm') {
      extraEnv.CLAUDE_CONFIG_HOME = configHome;
    }
    extraEnv.WEBUI_SESSION_MODE = effectiveMode;
    extraEnv.WEBUI_CONFIG_HOME = configHome;
    if (cliProvider === 'glm') {
      const claudeEnv = await readClaudeEnvFromConfigHome(configHome);
      const zaiKey = await getZaiApiKeyForUser(userId);
      const authToken = claudeEnv.ANTHROPIC_AUTH_TOKEN || zaiKey || '';
      const baseUrl = claudeEnv.ANTHROPIC_BASE_URL || ZAI_BASE_URL_DEFAULT;

      if (authToken) {
        extraEnv.ANTHROPIC_AUTH_TOKEN = authToken;
      }
      if (baseUrl) {
        extraEnv.ANTHROPIC_BASE_URL = baseUrl;
      }
    }
    if (cliProvider === 'codex') {
      const codexHome = providerConfig.credentialsPath.replace('~', os.homedir());
      extraEnv.CODEX_HOME = codexHome;
      try {
        const authPath = path.join(codexHome, 'auth.json');
        const auth = safeJsonParse<Record<string, unknown>>(await fs.readFile(authPath, 'utf-8'), {});
        const hasTokens = typeof auth.tokens === 'object' && !!(auth.tokens as { access_token?: string }).access_token;
        const hasApiKey = typeof auth.OPENAI_API_KEY === 'string' && auth.OPENAI_API_KEY.length > 0;
        if (hasTokens && !hasApiKey) {
          args.push('--config', 'auth_mode="chatgpt"');
        }
      } catch {
        // Ignore missing or unreadable auth.json; codex will handle auth errors.
      }
    }
    // Gemini provider: use direct API adapter instead of CLI subprocess
    // (Gemini CLI is an Ink/React TUI that hangs in Docker with 0 bytes output)
    let proc: ChildProcess;

    if (cliProvider === 'gemini') {
      const adapter = new GeminiApiAdapter(sessionId, selectedModel || undefined, session.working_directory);
      this.geminiAdapters.set(sessionId, adapter);
      const fakeProc = adapter.getProcess();
      proc = fakeProc as unknown as ChildProcess;

      // Initialize async (loads credentials, emits init message)
      adapter.init().catch((err) => {
        console.error(`[GeminiApi] Init error [${sessionId}]:`, err);
      });
    } else {
      // Use regular spawn for other CLI providers
      proc = cpSpawn(providerConfig.command, args, {
        cwd: session.working_directory,
        env: {
          ...process.env,
          ...extraEnv,
          // Pass session ID so Claude can use it for image generation and permissions
          WEBUI_SESSION_ID: sessionId,
          // Pass backend URL for permission-prompt script
          WEBUI_BACKEND_URL: `http://localhost:${config.port}`,
          // Pass project path for loading project-specific settings
          WEBUI_PROJECT_PATH: session.working_directory,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    }

    const claudeProcess: ClaudeProcess = {
      process: proc,
      sessionId,
      cliProvider,
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
      model: selectedModel || CLI_PROVIDERS[cliProvider]?.defaultModel || 'unknown',
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
      contextReminder: this.pendingContextReminders.get(sessionId) || null,
      // Reconnect buffer
      outputBuffer: new CircularBuffer<BufferedMessage>(BUFFER_SIZE),
      lastActivityAt: Date.now(),
      disconnectedAt: null,
      // Permission approval tracking
      lastUserMessage: null,
      lastAttachments: null,
      pendingPermissionDenials: null,
      sharedContextInjected: false,
      modePromptInjected: null,
      lastContextLimitAt: undefined,
    };

    this.pendingContextReminders.delete(sessionId);

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
      const managedProc = this.processes.get(sessionId);
      if (managedProc) {
        // For providers that don't send a result message (e.g. Kimi),
        // save any remaining streaming text and stop thinking indicator
        if (managedProc.streamingText?.trim().length) {
          this.saveAssistantMessage(sessionId, managedProc.streamingText.trim());
          managedProc.streamingText = '';
          managedProc.isStreaming = false;
        }
        this.io.to(`session:${sessionId}`).emit('session:thinking', {
          sessionId,
          isThinking: false,
        });
      }
      if (typeof exitCode === 'number' && exitCode !== 0) {
        getWatchdog()?.recordError(sessionId);
      }
      this.cleanupProcess(sessionId);
    });

    proc.on('error', (err) => {
      console.error(`Claude process error [${sessionId}]:`, err);
      getWatchdog()?.recordError(sessionId);
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
        const raw = JSON.parse(line) as unknown;
        if (proc.cliProvider === 'codex') {
          const translated = this.translateCodexMessage(sessionId, raw);
          if (Array.isArray(translated)) {
            for (const msg of translated) {
              this.processStreamMessage(sessionId, msg);
            }
          } else if (translated) {
            this.processStreamMessage(sessionId, translated);
          }
          continue;
        }
        if (proc.cliProvider === 'kimi') {
          const translated = this.translateKimiMessage(sessionId, raw);
          if (Array.isArray(translated)) {
            for (const msg of translated) {
              this.processStreamMessage(sessionId, msg);
            }
          } else if (translated) {
            this.processStreamMessage(sessionId, translated);
          }
          // Reset Kimi idle timer — if no more output comes within 5s, assume turn is done
          if (proc.kimiIdleTimer) clearTimeout(proc.kimiIdleTimer);
          proc.kimiIdleTimer = setTimeout(() => {
            const currentProc = this.processes.get(sessionId);
            if (currentProc) {
              this.io.to(`session:${sessionId}`).emit('session:thinking', {
                sessionId,
                isThinking: false,
              });
            }
          }, 5000);
          continue;
        }
        this.processStreamMessage(sessionId, raw as StreamJsonMessage);
      } catch (e) {
        // Not valid JSON, emit as raw output for debugging (skip noisy codex prompts)
        console.log(`Non-JSON output [${sessionId}]:`, line);
        if (proc.cliProvider !== 'codex') {
          this.io.to(`session:${sessionId}`).emit('session:output', {
            sessionId,
            content: line + '\n',
            isComplete: false,
          });
        }
      }
    }
  }

  private translateCodexMessage(sessionId: string, raw: unknown): StreamJsonMessage | null {
    if (!raw || typeof raw !== 'object') return null;
    const data = raw as {
      type?: string;
      item?: { type?: string; text?: string };
      usage?: { input_tokens?: number; output_tokens?: number; cached_input_tokens?: number };
      message?: string;
    };

    switch (data.type) {
      case 'turn.started':
        this.io.to(`session:${sessionId}`).emit('session:thinking', {
          sessionId,
          isThinking: true,
        });
        return null;
      case 'item.completed':
        if (data.item?.type === 'reasoning' && data.item.text) {
          const summary = this.formatCodexReasoning(data.item.text);
          if (summary) {
            this.io.to(`session:${sessionId}`).emit('session:thinking', {
              sessionId,
              isThinking: true,
              message: summary,
            });
          }
          return null;
        }
        if (data.item?.type === 'agent_message' && data.item.text) {
          return {
            type: 'assistant',
            message: {
              role: 'assistant',
              content: data.item.text,
            },
          };
        }
        return null;
      case 'turn.completed':
        if (data.usage) {
          return {
            type: 'result',
            usage: {
              input_tokens: data.usage.input_tokens || 0,
              output_tokens: data.usage.output_tokens || 0,
              cache_read_input_tokens: data.usage.cached_input_tokens || 0,
              cache_creation_input_tokens: 0,
            },
          };
        }
        return null;
      case 'error':
        if (data.message) {
          this.io.to(`session:${sessionId}`).emit('session:output', {
            sessionId,
            content: `${data.message}\n`,
            isComplete: false,
          });
        }
        getWatchdog()?.recordError(sessionId);
        return null;
      default:
        return null;
    }
  }

  private formatCodexReasoning(text: string): string {
    const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) return '';
    const stripMd = (value: string) => value.replace(/\*\*/g, '').replace(/^#+\s*/, '').trim();
    const firstLine = lines[0] ?? '';
    let candidate = stripMd(firstLine);
    if (candidate.length < 8 && lines[1]) {
      candidate = stripMd(lines[1]);
    }
    const trimmed = candidate.replace(/\s+/g, ' ').trim();
    if (!trimmed) return '';
    return trimmed.length > 160 ? `${trimmed.slice(0, 157)}...` : trimmed;
  }

  /**
   * Translate Kimi CLI stream-json messages to the internal StreamJsonMessage format.
   *
   * Kimi emits complete JSONL messages per turn:
   * - Assistant: {"role":"assistant","content":[{"type":"think","think":"..."},{"type":"text","text":"..."}],"tool_calls":[...]}
   * - Tool result: {"role":"tool","content":[{"type":"text","text":"..."}],"tool_call_id":"..."}
   */
  private translateKimiMessage(sessionId: string, raw: unknown): StreamJsonMessage | StreamJsonMessage[] | null {
    if (!raw || typeof raw !== 'object') return null;
    const data = raw as {
      role?: string;
      content?: Array<{ type?: string; text?: string; think?: string }>;
      tool_calls?: Array<{ type?: string; id?: string; function?: { name?: string; arguments?: string } }>;
      tool_call_id?: string;
    };

    // Handle assistant messages (thinking, text, tool calls)
    if (data.role === 'assistant') {
      const messages: StreamJsonMessage[] = [];
      const content = Array.isArray(data.content) ? data.content : [];
      const hasToolCalls = data.tool_calls && data.tool_calls.length > 0;

      // Extract thinking content
      const thinkBlock = content.find(c => c.type === 'think' && c.think);
      if (thinkBlock?.think) {
        const summary = this.formatCodexReasoning(thinkBlock.think);
        this.io.to(`session:${sessionId}`).emit('session:thinking', {
          sessionId,
          isThinking: true,
          message: summary || undefined,
        });
      }

      // Extract text content
      const textBlocks = content.filter(c => c.type === 'text' && c.text);
      const textContent = textBlocks.map(c => c.text).join('');

      if (textContent) {
        if (hasToolCalls) {
          // Message has both text and tool_calls — emit text directly to avoid
          // processStreamMessage setting thinking:false before tools start
          this.io.to(`session:${sessionId}`).emit('session:thinking', {
            sessionId,
            isThinking: false,
          });
          this.saveAssistantMessage(sessionId, textContent.trim());
        } else {
          // Text-only message — use normal assistant path
          messages.push({
            type: 'assistant',
            message: {
              role: 'assistant',
              content: textContent,
            },
          });
        }
      }

      // Handle tool calls
      if (hasToolCalls) {
        for (const tc of data.tool_calls!) {
          if (tc.function?.name) {
            const toolId = tc.id || `kimi-tool-${Date.now()}`;
            let parsedInput: unknown = undefined;
            try {
              parsedInput = tc.function.arguments ? JSON.parse(tc.function.arguments) : undefined;
            } catch {
              parsedInput = tc.function.arguments;
            }
            // Track tool name by ID so we can use it in tool results
            const proc = this.processes.get(sessionId);
            if (proc) {
              proc.pendingToolResults = proc.pendingToolResults || new Map();
              proc.pendingToolResults.set(toolId, { toolName: tc.function.name, input: parsedInput });
            }
            messages.push({
              type: 'tool_use',
              tool_use: {
                id: toolId,
                name: tc.function.name,
                input: parsedInput,
              },
            } as StreamJsonMessage);
          }
        }
      }

      return messages.length > 0 ? messages : null;
    }

    // Handle tool results
    if (data.role === 'tool' && data.tool_call_id) {
      // Kimi sends content as either a string or an array of {type, text} objects
      let resultText = '';
      if (typeof data.content === 'string') {
        resultText = data.content;
      } else if (Array.isArray(data.content)) {
        resultText = data.content
          .filter((c: Record<string, unknown>) => c.type === 'text' && c.text)
          .map((c: Record<string, unknown>) => c.text as string)
          .join('\n');
      }

      // Look up the actual tool name from pending results
      const proc = this.processes.get(sessionId);
      const pending = proc?.pendingToolResults?.get(data.tool_call_id);
      const toolName = pending?.toolName || 'Tool';
      proc?.pendingToolResults?.delete(data.tool_call_id);

      // Emit tool completion with the actual tool name
      this.io.to(`session:${sessionId}`).emit('session:tool_use', {
        sessionId,
        toolId: data.tool_call_id,
        toolName,
        status: 'completed',
        result: resultText,
      });

      // Set thinking state since Kimi will continue processing
      this.io.to(`session:${sessionId}`).emit('session:thinking', {
        sessionId,
        isThinking: true,
      });

      return null;
    }

    return null;
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
    getWatchdog()?.recordTokenUsage(sessionId, turnTotalTokens);

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

  private extractErrorText(msg: StreamJsonMessage): string | null {
    const msgAny = msg as unknown as { message?: unknown; error?: unknown; detail?: unknown; text?: unknown };
    if (typeof msgAny?.message === 'string') return msgAny.message;
    if (typeof msgAny?.error === 'string') return msgAny.error;
    if (typeof msgAny?.detail === 'string') return msgAny.detail;
    if (typeof msgAny?.text === 'string') return msgAny.text;
    return null;
  }

  private isContextLimitError(text: string): boolean {
    const normalized = text.toLowerCase();
    return normalized.includes('context window')
      || normalized.includes('context limit')
      || normalized.includes('context length')
      || normalized.includes('maximum context')
      || normalized.includes('token limit');
  }

  private handleContextLimit(sessionId: string, proc: ClaudeProcess, errorText: string): void {
    const now = Date.now();
    if (proc.lastContextLimitAt && now - proc.lastContextLimitAt < 2000) {
      return;
    }
    proc.lastContextLimitAt = now;

    const summary = this.buildContextSummary(
      sessionId,
      HANDOFF_CONTEXT_MAX_MESSAGES,
      HANDOFF_CONTEXT_MAX_CHARS
    );
    if (summary) {
      this.pendingContextReminders.set(sessionId, { summary, reason: 'context-limit' });
    }

    proc.totalInputTokens = 0;
    proc.totalOutputTokens = 0;
    proc.cacheReadTokens = 0;
    proc.cacheCreationTokens = 0;
    proc.streamingText = '';
    proc.isStreaming = false;

    this.io.to(`session:${sessionId}`).emit('session:thinking', {
      sessionId,
      isThinking: false,
    });

    this.io.to(`session:${sessionId}`).emit('session:compact', {
      sessionId,
      message: `Context limit reached. Auto-compacting context to continue.`,
      summary: summary || undefined,
      clear: true,
      reason: 'context-limit',
      error: errorText,
    });
  }

  private processStreamMessage(sessionId: string, msg: StreamJsonMessage): void {
    const proc = this.processes.get(sessionId);
    if (!proc) return;

    console.log(`[MSG] type=${msg.type} subtype=${msg.subtype || ''} event.type=${msg.event?.type || ''}`);

    if (msg.type === 'error' || (msg.type === 'system' && msg.subtype === 'error')) {
      const errorText = this.extractErrorText(msg);
      if (errorText && this.isContextLimitError(errorText)) {
        this.handleContextLimit(sessionId, proc, errorText);
        return;
      }
      getWatchdog()?.recordError(sessionId);
    }

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
          getWatchdog()?.recordToolCall(sessionId);
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
        if (proc.currentToolName) {
          console.log(`[TOOL] ${proc.currentToolName} completed with input length: ${proc.currentToolInput.length}`);

          let inputData: unknown = null;
          if (proc.currentToolInput.trim().length > 0) {
            try {
              inputData = JSON.parse(proc.currentToolInput);
            } catch {
              inputData = proc.currentToolInput;
            }
          }

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
            input: inputData ?? undefined,
          });

          const normalizedToolName = (proc.currentToolName || '').replace(/[_-]/g, '').toLowerCase();

          if (normalizedToolName === 'exitplanmode') {
            proc.mode = 'auto-accept';
            this.emitModeChange(sessionId, 'auto-accept');
            // Set context reminder to inform Claude that plan mode has ended
            proc.contextReminder = {
              summary: `## PLAN MODE ENDED - IMPLEMENTATION MODE ACTIVE

The planning phase is complete. You are now in Auto-Accept mode.

**What changed:**
- You can now use ALL tools freely (Read, Write, Edit, Bash, Glob, Grep, etc.)
- The planning restrictions have been lifted
- Proceed with implementing the approved plan step by step

**Next steps:**
1. Start implementing the tasks from your plan
2. Use appropriate tools to make changes
3. Mark todos as completed as you finish each task`,
              reason: 'mode-change',
            };
            console.log(`[MODE] Plan mode ended for session ${sessionId}, switching to auto-accept`);
          }

          // Handle TodoWrite tool
          if (normalizedToolName === 'todowrite') {
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
          if (normalizedToolName === 'task') {
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
        reason: 'auto-compact',
      });
      this.emitUsage(sessionId, proc);
    }

    // Handle result/completion
    if (msg.type === 'result' || (msg.type === 'system' && msg.subtype === 'turn_end')) {
      getWatchdog()?.clearErrors(sessionId);
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
      // Emit turnComplete for external consumers (RalphService)
      this.events.emit('turnComplete', sessionId, {
        inputTokens: proc.turnInputTokens,
        outputTokens: proc.turnOutputTokens,
        totalCostUsd: proc.totalCostUsd,
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

    // Emit for external consumers (RalphService)
    this.events.emit('assistantMessage', sessionId, content);

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
    attachments?: FileAttachmentData[],
    options?: { recordMessage?: boolean; updateLastMessage?: boolean }
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

    if (proc.contextReminder) {
      let label = 'Context from previous session';
      if (proc.contextReminder.reason === 'provider-switch') {
        label = 'Provider switch handoff (detailed)';
      } else if (proc.contextReminder.reason === 'context-limit') {
        label = 'Context compacted after limit reached';
      } else {
        label = 'Context from previous session (mode change)';
      }
      const contextReminder = `<system-reminder>
${label}:
${proc.contextReminder.summary}
</system-reminder>

`;
      messageForClaude = contextReminder + messageForClaude;
      proc.contextReminder = null;
      console.log(`Added context reminder after ${label.toLowerCase()} [${sessionId}]`);
    }

    if (proc.cliProvider === 'codex' && !proc.sharedContextInjected) {
      const configHome = resolveConfigHome(proc.cliProvider);
      const [agents, skills, plugins] = await Promise.all([
        readSharedAgents(configHome),
        readSharedSkills(configHome),
        readSharedPlugins(configHome),
      ]);
      const sharedContext = formatCodexSharedContext(agents, skills, plugins);
      if (sharedContext) {
        messageForClaude = `${sharedContext}\n\n${messageForClaude}`;
      }
      proc.sharedContextInjected = true;
    }

    if ((proc.cliProvider === 'codex' || proc.cliProvider === 'gemini') && proc.modePromptInjected !== proc.mode) {
      const modePrompt = this.getModePrompt(proc.mode);
      if (modePrompt) {
        messageForClaude = `${modePrompt}\n\n${messageForClaude}`;
        proc.modePromptInjected = proc.mode;
      }
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

    const recordMessage = options?.recordMessage !== false;
    const updateLastMessage = options?.updateLastMessage !== false;

    if (recordMessage) {
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

      // Emit for external consumers (WatchdogService goal detection)
      this.events.emit('userMessage', sessionId, message);
    }

    if (updateLastMessage) {
      // Track last message for permission approval resend
      proc.lastUserMessage = message;
      proc.lastAttachments = attachments || null;
    }
    proc.pendingPermissionDenials = null; // Clear any previous denials
    if (proc.kimiIdleTimer) clearTimeout(proc.kimiIdleTimer); // Clear Kimi idle timer on new message

    // Emit thinking indicator
    this.io.to(`session:${sessionId}`).emit('session:thinking', {
      sessionId,
      isThinking: true,
    });

    // Send message using provider-specific format
    const formattedMessage = formatInputMessage(proc.cliProvider, messageForClaude);
    if (proc.cliProvider === 'codex') {
      // codex exec reads stdin until EOF before responding
      proc.process.stdin?.end(formattedMessage);
    } else {
      proc.process.stdin?.write(formattedMessage);
    }
    console.log(`Sent message [${sessionId}] via ${proc.cliProvider}: ${messageForClaude.substring(0, 100)}...`);
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

    // Send interrupt signal (or abort fetch for Gemini API adapter)
    const adapter = this.geminiAdapters.get(sessionId);
    if (adapter) {
      adapter.interrupt();
    } else {
      proc.process.kill('SIGINT');
    }
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
    const db = getDatabase();
    const sessionRow = db.prepare(
      'SELECT cli_provider as cliProvider FROM sessions WHERE id = ? AND user_id = ?'
    ).get(sessionId, userId) as { cliProvider: CLIProvider | null } | undefined;
    const nextProvider = sessionRow?.cliProvider || proc?.cliProvider || 'claude';
    const providerChanged = !!proc && nextProvider !== proc.cliProvider;

    if (providerChanged) {
      const summary = this.buildHandoffSummary(sessionId);
      if (summary) {
        this.pendingContextReminders.set(sessionId, { summary, reason: 'provider-switch' });
        this.io.to(`session:${sessionId}`).emit('session:compact', {
          sessionId,
          message: '🔄 Provider switched. Detailed handoff context captured.',
          summary,
          clear: true,
          reason: 'provider-switch',
        });
      } else {
        this.io.to(`session:${sessionId}`).emit('session:compact', {
          sessionId,
          message: '🔄 Provider switched. No handoff context available.',
          clear: true,
          reason: 'provider-switch',
        });
      }
    }
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

  private buildContextSummary(sessionId: string, maxMessages: number, maxChars: number): string | null {
    const db = getDatabase();
    const rows = db.prepare(
      'SELECT role, content FROM messages WHERE session_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?'
    ).all(sessionId, maxMessages) as { role: string; content: string }[];

    if (!rows.length) {
      return null;
    }

    const formatted = rows
      .reverse()
      .map((row) => {
        const role = row.role === 'assistant' ? 'Assistant' : row.role === 'user' ? 'User' : row.role;
        return `${role}: ${row.content.trim()}`;
      })
      .join('\n\n');

    if (formatted.length <= maxChars) {
      return formatted;
    }

    return `${formatted.slice(0, maxChars)}...`;
  }

  private buildContextReminder(sessionId: string): string | null {
    return this.buildContextSummary(sessionId, CONTEXT_REMINDER_MAX_MESSAGES, CONTEXT_REMINDER_MAX_CHARS);
  }

  private buildHandoffSummary(sessionId: string): string | null {
    return this.buildContextSummary(sessionId, HANDOFF_CONTEXT_MAX_MESSAGES, HANDOFF_CONTEXT_MAX_CHARS);
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
    const shouldDropResume = proc.cliProvider === 'glm' && !!proc.claudeSessionId;

    // For mode changes on running sessions, we need to restart the process
    // Save any pending streaming content first
    if (proc.streamingText.trim().length > 0) {
      this.saveAssistantMessage(sessionId, proc.streamingText.trim());
      proc.streamingText = '';
      proc.isStreaming = false;
    }

    if (shouldDropResume) {
      const reminder = this.buildContextReminder(sessionId);
      if (reminder) {
        this.pendingContextReminders.set(sessionId, { summary: reminder, reason: 'mode-change' });
      }
      try {
        const db = getDatabase();
        db.prepare('UPDATE sessions SET claude_session_id = NULL WHERE id = ?').run(sessionId);
        proc.claudeSessionId = null;
        console.log(`[MODE] Cleared claude_session_id for ${sessionId} to apply mode change for glm`);
      } catch (err) {
        console.error(`[MODE] Failed to clear claude_session_id for ${sessionId}:`, err);
      }
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

    // Clear Kimi idle timer
    if (proc.kimiIdleTimer) clearTimeout(proc.kimiIdleTimer);

    this.processes.delete(sessionId);
    this.geminiAdapters.delete(sessionId);

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
    if (!lastMessage) {
      throw new Error('No message to resend');
    }

    // Clear pending denials
    proc.pendingPermissionDenials = null;

    // Store session info before killing
    const claudeSessionId = proc.claudeSessionId;
    const workingDirectory = proc.workingDirectory;
    const mode = proc.mode;
    const cliProvider = proc.cliProvider;
    const providerConfig = CLI_PROVIDERS[cliProvider];

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

    // Parse allowed directories
    const allowedDirs: string[] = session.allowed_directories
      ? JSON.parse(session.allowed_directories)
      : [];

    let args: string[] = [];
    const requestedModel = proc.model && proc.model !== 'unknown'
      ? proc.model
      : await getCliModelForUser(userId, cliProvider);
    const requestedReasoning = await getCliReasoningForUser(userId, cliProvider);
    if (cliProvider === 'claude') {
      args = [
        '--print',
        '--verbose',
        '--output-format', 'stream-json',
        '--input-format', 'stream-json',
        '--include-partial-messages',
        ...this.getPermissionFlags(mode),
      ];

      if (requestedModel) {
        args.push('--model', requestedModel);
      }

      for (const toolName of toolNames) {
        args.push('--allowedTools', toolName);
      }

      for (const dir of allowedDirs) {
        args.push('--add-dir', dir);
      }

      if (claudeSessionId) {
        args.push('--resume', claudeSessionId);
      }
    } else {
      // Build command args using CLI provider abstraction
      args = getCLIArgs(cliProvider, {
        mode,
        resumeSessionId: claudeSessionId ?? undefined,
        allowedDirectories: allowedDirs,
        workingDirectory,
        allowedTools: toolNames,
        model: requestedModel ?? undefined,
        reasoningLevel: requestedReasoning ?? undefined,
      });
    }

    console.log(`[PERMISSION] Restarting ${providerConfig.name} with args: ${args.join(' ')}`);

    const configHome = resolveConfigHome(cliProvider);

    // Spawn new process
    const newProc = cpSpawn(providerConfig.command, args, {
      cwd: workingDirectory,
      env: {
        ...process.env,
        WEBUI_SESSION_ID: sessionId,
        WEBUI_BACKEND_URL: `http://localhost:${config.port}`,
        WEBUI_PROJECT_PATH: workingDirectory,
        WEBUI_SESSION_MODE: mode,
        WEBUI_CONFIG_HOME: configHome,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const claudeProcess: ClaudeProcess = {
      process: newProc,
      sessionId,
      cliProvider,
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
      pendingToolResults: new Map(),
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
      contextReminder: null,
      outputBuffer: proc.outputBuffer,
      lastActivityAt: Date.now(),
      disconnectedAt: null,
      lastUserMessage: null,
      lastAttachments: null,
      pendingPermissionDenials: null,
      sharedContextInjected: false,
      modePromptInjected: null,
      lastContextLimitAt: proc.lastContextLimitAt,
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
      if (typeof exitCode === 'number' && exitCode !== 0) {
        getWatchdog()?.recordError(sessionId);
      }
      this.cleanupProcess(sessionId);
    });

    newProc.on('error', (err) => {
      console.error(`Claude process error [${sessionId}]:`, err);
      getWatchdog()?.recordError(sessionId);
      this.cleanupProcess(sessionId);
    });

    // Wait for initialization
    await new Promise((resolve) => setTimeout(resolve, 500));

    const resumeMessage = [
      `Permission granted for tools: ${toolNames.join(', ') || 'approved tools'}.`,
      'Continue the previous request from the existing context.',
      'Do not repeat earlier analysis or summaries; resume where you left off.',
    ].join('\n');

    // Send a resume signal instead of re-sending the full prompt,
    // and skip recording/emitting the message to avoid duplicates in the UI.
    await this.sendMessage(sessionId, userId, resumeMessage, undefined, {
      recordMessage: false,
      updateLastMessage: false,
    });
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
