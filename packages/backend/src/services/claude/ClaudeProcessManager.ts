import type { Server } from 'socket.io';
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  InterServerEvents,
  SocketData,
  BufferedMessage,
  SessionMode,
} from '@claude-code-webui/shared';
import { getAppConfig, getDatabase } from '../../db';
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
import { opencodeServer, type OpencodeEvent } from '../opencode/OpencodeServer.js';
import { resolveConfigHome } from '../../utils/configPaths.js';
import { syncExternalSkills } from '../../utils/skillSync.js';
import { scanProject, formatProjectContext } from '../../utils/projectScanner.js';
import { safeJsonParse } from '../../utils/json.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Circular buffer for storing messages for reconnection
const BUFFER_SIZE = 5000;
const DISCONNECT_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const HANDOFF_CONTEXT_MAX_CHARS = 60000;
const HANDOFF_CONTEXT_MAX_MESSAGES = 80;
const WEBUI_MANAGED_MARKER = '<!-- webui-managed: shared-config -->';
const WEBUI_MANAGED_BLOCK_START = '<!-- webui-managed: shared-config:start -->';
const WEBUI_MANAGED_BLOCK_END = '<!-- webui-managed: shared-config:end -->';
const PROJECT_CONTEXT_BLOCK_START = '<!-- webui-managed: project-context:start -->';
const PROJECT_CONTEXT_BLOCK_END = '<!-- webui-managed: project-context:end -->';

interface SharedAgent {
  name: string;
  prompt: string;
  tools?: string[];
  model?: string;
}

// Streaming filter for Gemma's thought-channel markers. Gemma 4 emits
// `<|channel>thought ... <channel|>` around its internal reasoning when
// llama-server runs with `--reasoning-format none`. The markers appear inline
// in the content stream and must be stripped before the UI sees them.
interface ThoughtStripState {
  inside: boolean;
  pending: string;
}

const THOUGHT_OPEN = '<|channel>thought';
const THOUGHT_CLOSE = '<channel|>';

function longestBoundarySuffix(haystack: string, marker: string): number {
  const max = Math.min(haystack.length, marker.length - 1);
  for (let len = max; len > 0; len--) {
    if (marker.startsWith(haystack.slice(haystack.length - len))) return len;
  }
  return 0;
}

function stripThoughtChunk(
  state: ThoughtStripState,
  chunk: string,
): { state: ThoughtStripState; emit: string } {
  let buf = state.pending + chunk;
  let out = '';
  let inside = state.inside;

  while (buf.length > 0) {
    if (inside) {
      const idx = buf.indexOf(THOUGHT_CLOSE);
      if (idx >= 0) {
        buf = buf.slice(idx + THOUGHT_CLOSE.length);
        inside = false;
        continue;
      }
      const keep = longestBoundarySuffix(buf, THOUGHT_CLOSE);
      buf = buf.slice(buf.length - keep);
      break;
    }

    const openIdx = buf.indexOf(THOUGHT_OPEN);
    const closeIdx = buf.indexOf(THOUGHT_CLOSE);

    // Orphan close marker (no preceding open): Gemma retries emit the closing
    // `thought\n<channel|>` without the matching `<|channel>thought` in some
    // continuation parts. Treat the text before the orphan as discarded
    // thought content and drop it along with the marker itself.
    if (closeIdx >= 0 && (openIdx < 0 || closeIdx < openIdx)) {
      buf = buf.slice(closeIdx + THOUGHT_CLOSE.length);
      continue;
    }

    if (openIdx >= 0) {
      out += buf.slice(0, openIdx);
      buf = buf.slice(openIdx + THOUGHT_OPEN.length);
      inside = true;
      continue;
    }

    const keepOpen = longestBoundarySuffix(buf, THOUGHT_OPEN);
    const keepClose = longestBoundarySuffix(buf, THOUGHT_CLOSE);
    const keep = Math.max(keepOpen, keepClose);
    out += buf.slice(0, buf.length - keep);
    buf = buf.slice(buf.length - keep);
    break;
  }

  return { state: { inside, pending: buf }, emit: out };
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

const VALID_REASONING_LEVELS = new Set(['low', 'medium', 'high', 'extra_high', 'max']);

const DEFAULT_CONTEXT_WINDOW = 200_000;
const ONE_MILLION_CONTEXT = 1_000_000;

// Map a Claude model identifier to its context window. Anthropic ships 1M-token
// context for all current 4.x and 5.x Claude families (Opus, Sonnet, Haiku).
// Older 3.x models remain at 200k. The CLI reports the actual window via
// modelUsage when available; this helper is the fallback so the frontend
// tracker stops claiming 200k for a 1M-capable model.
function contextWindowFor(model: string | null | undefined): number {
  if (!model) return DEFAULT_CONTEXT_WINDOW;
  const id = model.toLowerCase();
  if (/(opus|sonnet|haiku)-?(4|5)/.test(id)) {
    return ONE_MILLION_CONTEXT;
  }
  return DEFAULT_CONTEXT_WINDOW;
}

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
  return VALID_REASONING_LEVELS.has(normalized) ? normalized : null;
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

/**
 * Fixed-size FIFO buffer used to replay recent session events to a reconnecting client.
 *
 * Thread safety: All methods are synchronous and contain no `await`, so the Node.js event
 * loop itself serializes access — no external mutex is needed. Readers get defensive copies
 * (`slice` / spread), so a reader's returned array is stable even if a subsequent tick writes.
 * If any method is later changed to be `async`, revisit this invariant.
 */
class CircularBuffer<T> {
  private buffer: T[] = [];
  private maxSize: number;
  /** True once a push has evicted an item — used to detect buffer rollover for reconnects. */
  private hasEvicted = false;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  push(item: T): void {
    if (this.buffer.length >= this.maxSize) {
      this.buffer.shift();
      this.hasEvicted = true;
    }
    this.buffer.push(item);
  }

  getAll(): T[] {
    return [...this.buffer];
  }

  /**
   * Returns items matching the predicate and everything after, plus a flag indicating
   * whether the buffer has rolled over since the caller last saw data.
   * If predicate doesn't match and the buffer has evicted items, caller should full-resync.
   */
  getSinceWithStatus(predicate: (item: T) => boolean): { items: T[]; needsFullResync: boolean } {
    const startIndex = this.buffer.findIndex(predicate);
    if (startIndex !== -1) {
      return { items: this.buffer.slice(startIndex), needsFullResync: false };
    }
    return { items: [], needsFullResync: this.hasEvicted };
  }

  getSince(predicate: (item: T) => boolean): T[] {
    return this.getSinceWithStatus(predicate).items;
  }

  getSize(): number {
    return this.buffer.length;
  }

  clear(): void {
    this.buffer = [];
    this.hasEvicted = false;
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
  lines.push('Registry of available skills, agents, and plugins. Load full instructions from their files only when needed.');

  if (skills.length > 0) {
    lines.push('');
    lines.push('Skills (~/.claude/skills/<name>/SKILL.md):');
    for (const skill of skills) {
      const desc = extractFrontmatterDescription(skill.content);
      lines.push(desc ? `- ${skill.name} — ${desc}` : `- ${skill.name}`);
    }
  }

  if (agents.length > 0) {
    lines.push('');
    lines.push('Agents (~/.claude/agents/<name>.md):');
    for (const agent of agents) {
      const desc = extractFrontmatterDescription(agent.prompt);
      lines.push(desc ? `- ${agent.name} — ${desc}` : `- ${agent.name}`);
    }
  }

  if (plugins.length > 0) {
    lines.push('');
    lines.push('Plugins:');
    for (const plugin of plugins) {
      const desc = plugin.description ? ` — ${plugin.description}` : '';
      lines.push(`- ${plugin.name}${desc}`);
    }
  }

  lines.push('');
  lines.push('[End Shared Claude Config]');

  return lines.join('\n');
}

function extractFrontmatterDescription(content: string): string | null {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith('---')) return null;
  const end = trimmed.indexOf('\n---', 3);
  if (end === -1) return null;
  const fm = trimmed.slice(3, end);
  const match = fm.match(/^\s*description\s*:\s*(.+?)\s*$/m);
  const raw = match?.[1];
  if (!raw) return null;
  return raw.replace(/^["']|["']$/g, '').trim() || null;
}

function formatSharedInstructionFile(
  agents: SharedAgent[],
  skills: SharedSkill[],
  plugins: SharedPlugin[]
): string {
  const lines: string[] = [];
  lines.push(WEBUI_MANAGED_BLOCK_START);
  lines.push('# Shared Provider Context');
  lines.push('Registry of available skills and agents. Full instructions live in their own files — loaded on demand.');
  lines.push('');
  lines.push('- Skills: `~/.claude/skills/<name>/SKILL.md`');
  lines.push('- Agents: `~/.claude/agents/<name>.md`');
  lines.push('- Remove this block to opt out of automatic updates.');

  if (skills.length > 0) {
    lines.push('');
    lines.push('## Skills');
    for (const skill of skills) {
      const desc = extractFrontmatterDescription(skill.content);
      const suffixParts: string[] = [];
      if (skill.allowedTools && skill.allowedTools.length > 0) {
        suffixParts.push(`tools: ${skill.allowedTools.join(', ')}`);
      }
      if (skill.model) {
        suffixParts.push(`model: ${skill.model}`);
      }
      const suffix = suffixParts.length > 0 ? ` _(${suffixParts.join('; ')})_` : '';
      lines.push(desc ? `- **${skill.name}** — ${desc}${suffix}` : `- **${skill.name}**${suffix}`);
    }
  }

  if (agents.length > 0) {
    lines.push('');
    lines.push('## Agents');
    for (const agent of agents) {
      const desc = extractFrontmatterDescription(agent.prompt);
      const suffixParts: string[] = [];
      if (agent.tools && agent.tools.length > 0) {
        suffixParts.push(`tools: ${agent.tools.join(', ')}`);
      }
      if (agent.model) {
        suffixParts.push(`model: ${agent.model}`);
      }
      const suffix = suffixParts.length > 0 ? ` _(${suffixParts.join('; ')})_` : '';
      lines.push(desc ? `- **${agent.name}** — ${desc}${suffix}` : `- **${agent.name}**${suffix}`);
    }
  }

  if (plugins.length > 0) {
    lines.push('');
    lines.push('## Plugins');
    for (const plugin of plugins) {
      const metaParts: string[] = [];
      if (plugin.version) metaParts.push(`v${plugin.version}`);
      if (plugin.category) metaParts.push(plugin.category);
      if (plugin.marketplace) metaParts.push(plugin.marketplace);
      const meta = metaParts.length > 0 ? ` _(${metaParts.join('; ')})_` : '';
      const desc = plugin.description ? ` — ${plugin.description}` : '';
      lines.push(`- **${plugin.name}**${desc}${meta}`);
    }
  }

  if (skills.length === 0 && agents.length === 0 && plugins.length === 0) {
    lines.push('');
    lines.push('_No shared skills, agents, or plugins were found._');
  }

  lines.push(WEBUI_MANAGED_BLOCK_END);
  return lines.join('\n');
}

function replaceManagedBlock(existing: string, startMarker: string, endMarker: string, newBlock: string): string | null {
  const pattern = new RegExp(`${escapeRegex(startMarker)}[\\s\\S]*?${escapeRegex(endMarker)}`, 'm');
  if (!pattern.test(existing)) {
    return null;
  }
  return existing.replace(pattern, newBlock);
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Resolve parent dir via realpath and ensure the final file path stays inside it.
 * Blocks symlink-based escapes: /foo/bar/CLAUDE.md where bar -> /etc would otherwise land in /etc/CLAUDE.md.
 */
async function resolveSafeFilePath(filePath: string): Promise<string> {
  const absolute = path.resolve(filePath);
  const parentDir = path.dirname(absolute);
  const baseName = path.basename(absolute);
  let realParent: string;
  try {
    realParent = await fs.realpath(parentDir);
  } catch {
    realParent = parentDir;
  }
  const resolved = path.join(realParent, baseName);
  if (!resolved.startsWith(realParent + path.sep) && resolved !== path.join(realParent, baseName)) {
    throw new Error(`Refusing to write outside resolved parent directory: ${filePath}`);
  }
  return resolved;
}

/**
 * Write managed block to a file, handling create/replace/append.
 * Errors are logged but never thrown — writes to CLAUDE.md are best-effort and
 * must not break session startup (e.g. read-only mounts, permission issues).
 */
async function writeManagedBlock(
  filePath: string,
  content: string,
  startMarker: string,
  endMarker: string,
  legacyMarker?: string,
): Promise<void> {
  let safePath: string;
  try {
    safePath = await resolveSafeFilePath(filePath);
  } catch (err) {
    console.warn(`[writeManagedBlock] Skipping unsafe path ${filePath}:`, err instanceof Error ? err.message : err);
    return;
  }

  let existing: string | null = null;
  try {
    existing = await fs.readFile(safePath, 'utf-8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code !== 'ENOENT') {
      console.warn(`[writeManagedBlock] Failed to read ${safePath}:`, err instanceof Error ? err.message : err);
    }
  }

  try {
    if (existing !== null) {
      const replaced = replaceManagedBlock(existing, startMarker, endMarker, content);
      if (replaced) {
        if (replaced.trim() !== existing.trim()) {
          await fs.writeFile(safePath, replaced, 'utf-8');
        }
        return;
      }

      if (legacyMarker && existing.includes(legacyMarker)) {
        await fs.writeFile(safePath, content, 'utf-8');
        return;
      }

      const appended = `${existing.trimEnd()}\n\n${content}\n`;
      await fs.writeFile(safePath, appended, 'utf-8');
      return;
    }

    await fs.writeFile(safePath, content, 'utf-8');
  } catch (err) {
    console.warn(`[writeManagedBlock] Failed to write ${safePath}:`, err instanceof Error ? err.message : err);
  }
}

/**
 * Remove old shared-config block from a file (migration from old format).
 */
async function removeOldSharedConfigBlock(filePath: string): Promise<void> {
  try {
    const existing = await fs.readFile(filePath, 'utf-8');
    const pattern = new RegExp(`${escapeRegex(WEBUI_MANAGED_BLOCK_START)}[\\s\\S]*?${escapeRegex(WEBUI_MANAGED_BLOCK_END)}`, 'm');
    if (pattern.test(existing)) {
      const cleaned = existing.replace(pattern, '').replace(/\n{3,}/g, '\n\n').trim();
      await fs.writeFile(filePath, cleaned + '\n', 'utf-8');
    }
  } catch {
    // File doesn't exist or can't be read — nothing to clean
  }
}

/**
 * Write skills/agents/plugins to the global ~/.claude/CLAUDE.md.
 * Claude CLI loads this automatically for all sessions.
 */
async function ensureGlobalInstructions(configHome: string): Promise<void> {
  const [agents, skills, plugins] = await Promise.all([
    readSharedAgents(configHome),
    readSharedSkills(configHome),
    readSharedPlugins(configHome),
  ]);
  const content = formatSharedInstructionFile(agents, skills, plugins);

  const globalClaudeMd = path.join(os.homedir(), '.claude', 'CLAUDE.md');

  // Ensure directory exists
  const globalDir = path.dirname(globalClaudeMd);
  try {
    await fs.mkdir(globalDir, { recursive: true });
  } catch {
    // Already exists
  }

  await writeManagedBlock(
    globalClaudeMd,
    content,
    WEBUI_MANAGED_BLOCK_START,
    WEBUI_MANAGED_BLOCK_END,
    WEBUI_MANAGED_MARKER,
  );
}

/**
 * Build a short skills summary line (names only, no instructions).
 * Used for non-Claude providers that don't read ~/.claude/CLAUDE.md.
 */
function formatSkillsSummary(skills: SharedSkill[], agents: SharedAgent[]): string {
  const parts: string[] = [];
  if (skills.length > 0) {
    parts.push(`Available Skills: ${skills.map((s) => s.name).join(', ')}`);
  }
  if (agents.length > 0) {
    parts.push(`Available Agents: ${agents.map((a) => a.name).join(', ')}`);
  }
  return parts.join('\n');
}

/**
 * Write lightweight project context to the project's CLAUDE.md.
 * For Claude provider: just project info (skills are in global CLAUDE.md).
 * For other providers: project info + skills summary (names only).
 */
async function ensureProjectInstructions(
  workingDir: string,
  configHome: string,
  cliProvider: string,
): Promise<void> {
  // Scan project for auto-detected context
  let projectContext: string;
  try {
    const info = await scanProject(workingDir);
    projectContext = formatProjectContext(info);
  } catch {
    projectContext = `# Project: ${path.basename(workingDir)}`;
  }

  const lines: string[] = [PROJECT_CONTEXT_BLOCK_START];
  lines.push(projectContext);

  // For non-Claude providers, include skills/agents names as a reference
  if (cliProvider !== 'claude') {
    const [agents, skills] = await Promise.all([
      readSharedAgents(configHome),
      readSharedSkills(configHome),
    ]);
    const summary = formatSkillsSummary(skills, agents);
    if (summary) {
      lines.push('');
      lines.push(summary);
    }
  }

  lines.push(PROJECT_CONTEXT_BLOCK_END);
  const content = lines.join('\n');

  const claudeMdPath = path.join(workingDir, 'CLAUDE.md');

  // First: remove old shared-config block if it exists (migration)
  await removeOldSharedConfigBlock(claudeMdPath);

  // Then: write/update the new project-context block
  await writeManagedBlock(
    claudeMdPath,
    content,
    PROJECT_CONTEXT_BLOCK_START,
    PROJECT_CONTEXT_BLOCK_END,
  );

  // Also clean up old AGENTS.md managed block (no longer generated)
  const agentsMdPath = path.join(workingDir, 'AGENTS.md');
  await removeOldSharedConfigBlock(agentsMdPath);
}

interface FileAttachmentData {
  data: string; // base64
  mimeType: string;
  filename?: string;
}

function buildIntegrationEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  const comfyuiUrl = getAppConfig('comfyui_url');
  if (comfyuiUrl) {
    env.COMFYUI_URL = comfyuiUrl;
  }
  const loraTesterUrl = getAppConfig('lora_tester_url');
  if (loraTesterUrl) {
    env.LORA_TESTER_URL = loraTesterUrl;
  }
  return env;
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

// Build a no-op ChildProcess stub for server-backed sessions (opencode HTTP/SSE).
// The manager expects every ClaudeProcess to carry a ChildProcess, but when the
// CLI is driven over HTTP there is no local child to own. stdin is null so the
// existing `proc.process.stdin?.write/end` chains become no-ops; kill() is a
// noop whose real equivalent runs via opencodeServer.abort()/shutdown().
function createVirtualChildProcess(): ChildProcess {
  const em = new EventEmitter() as unknown as ChildProcess;
  Object.assign(em, {
    stdin: null,
    stdout: null,
    stderr: null,
    pid: undefined,
    killed: false,
    exitCode: null,
    kill: () => true,
    ref: () => em,
    unref: () => em,
    disconnect: () => undefined,
  });
  return em;
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
  codexIdle?: boolean; // True when codex process exited after turn.completed, awaiting respawn
  // Server-backed providers (opencode in HTTP/SSE mode) have no child process.
  // `process` is a no-op stub; all lifecycle goes through HTTP + SSE subscription.
  serverBacked?: boolean;
  // Accumulates content per opencode part.id so we can emit streaming deltas
  // and a final isComplete=true when the session goes idle.
  partStreams?: Map<string, { type: 'text' | 'reasoning'; text: string; cleaned?: string; thoughtState?: ThoughtStripState }>;
  // Track tool callIDs we've already emitted 'started' for, so we don't
  // re-emit on every status transition (pending → running → completed).
  emittedTools?: Set<string>;
  lastSavedAssistantContent?: string;
  lastSavedAssistantAt?: number;
}

export class ClaudeProcessManager {
  private processes: Map<string, ClaudeProcess> = new Map();
  private pendingModes: Map<string, SessionMode> = new Map(); // Store modes for sessions not yet started
  private pendingContextReminders: Map<string, { summary: string; reason: 'mode-change' | 'provider-switch' | 'context-limit' }> = new Map();
  private io: Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

  /** Public event emitter for external consumers */
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

  private getModePrompt(mode: SessionMode): string | null {
    if (mode === 'planning') {
      return this.getPlanningPrompt();
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
    return this.getSessionBufferStatus(sessionId, sinceTimestamp).items;
  }

  /**
   * Returns buffered items plus a rollover flag. needsFullResync=true means the buffer
   * evicted data older than sinceTimestamp — client cannot reconstruct state from the buffer alone.
   */
  getSessionBufferStatus(
    sessionId: string,
    sinceTimestamp?: number,
  ): { items: BufferedMessage[]; needsFullResync: boolean } {
    const proc = this.processes.get(sessionId);
    if (!proc) return { items: [], needsFullResync: false };

    if (sinceTimestamp) {
      return proc.outputBuffer.getSinceWithStatus((msg) => msg.timestamp >= sinceTimestamp);
    }
    return { items: proc.outputBuffer.getAll(), needsFullResync: false };
  }

  // Check if a session is running (for reconnection)
  isSessionRunning(sessionId: string): boolean {
    return this.processes.has(sessionId);
  }

  // Empty the replay buffer so a rewound session doesn't replay messages that were
  // just deleted from the DB. Safe to call whether the session is running or not.
  clearSessionBuffer(sessionId: string): void {
    const proc = this.processes.get(sessionId);
    proc?.outputBuffer.clear();
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
      .get(sessionId, userId) as { working_directory: string; claude_session_id: string | null; allowed_directories: string | null; cli_provider: CLIProvider | null } | undefined;

    if (!session) {
      throw new Error('Session not found');
    }

    if (this.processes.has(sessionId)) {
      return;
    }


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

    // Write skills/agents to global ~/.claude/CLAUDE.md + lightweight project context
    await ensureGlobalInstructions(configHome);
    await ensureProjectInstructions(session.working_directory, configHome, cliProvider);

    if (cliProvider === 'opencode') {
      // Server-backed path: opencode HTTP/SSE via the singleton `opencode serve`.
      // Unlike claude/codex, there is no per-session child process to own; events
      // arrive over the shared SSE subscription and are demultiplexed by sessionID.
      await opencodeServer.ensureStarted();

      let remoteId = isResuming && session.claude_session_id ? session.claude_session_id : null;
      if (remoteId && !(await opencodeServer.sessionExists(remoteId))) {
        console.log(`[OPENCODE-SERVER] Prior session ${remoteId} not found on server; recreating`);
        remoteId = null;
      }
      if (!remoteId) {
        remoteId = await opencodeServer.createSession(session.working_directory);
        db.prepare('UPDATE sessions SET claude_session_id = ? WHERE id = ?').run(remoteId, sessionId);
      }

      console.log(`[SESSION] ========== Starting Session (opencode server) ==========`);
      console.log(`[SESSION] Session ID: ${sessionId}`);
      console.log(`[SESSION] OpenCode sessionID: ${remoteId}`);
      console.log(`[SESSION] Working directory: ${session.working_directory}`);
      console.log(`[SESSION] Mode: ${effectiveMode}`);
      console.log(`[SESSION] Model: ${selectedModel ?? '(default)'}`);
      console.log(`[SESSION] Resuming: ${isResuming}`);
      console.log(`[SESSION] ==============================================`);

      const virtualProc = createVirtualChildProcess();
      const claudeProcess: ClaudeProcess = {
        process: virtualProc,
        sessionId,
        cliProvider,
        userId,
        workingDirectory: session.working_directory,
        claudeSessionId: remoteId,
        buffer: '',
        streamingText: '',
        isStreaming: false,
        mode: effectiveMode,
        currentToolName: null,
        currentToolId: null,
        currentToolInput: '',
        pendingToolResults: new Map(),
        currentAgentType: null,
        model: selectedModel || CLI_PROVIDERS[cliProvider]?.defaultModel || 'unknown',
        contextWindow: contextWindowFor(selectedModel || CLI_PROVIDERS[cliProvider]?.defaultModel),
        turnInputTokens: 0,
        turnCacheReadTokens: 0,
        turnCacheCreationTokens: 0,
        turnOutputTokens: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        totalCostUsd: 0,
        previousTotalCostUsd: 0,
        needsWorkingDirReminder: isResuming,
        contextReminder: this.pendingContextReminders.get(sessionId) || null,
        outputBuffer: new CircularBuffer<BufferedMessage>(BUFFER_SIZE),
        lastActivityAt: Date.now(),
        disconnectedAt: null,
        lastUserMessage: null,
        lastAttachments: null,
        pendingPermissionDenials: null,
        sharedContextInjected: false,
        modePromptInjected: null,
        lastContextLimitAt: undefined,
        serverBacked: true,
        partStreams: new Map(),
        emittedTools: new Set(),
      };

      this.pendingContextReminders.delete(sessionId);
      this.processes.set(sessionId, claudeProcess);

      opencodeServer.subscribe(remoteId, (evt) => {
        this.translateOpencodeServerEvent(sessionId, evt);
      });

      db.prepare('UPDATE sessions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
        'running',
        sessionId
      );
      this.emitStatus(sessionId, { sessionId, status: 'running' });
      return;
    }

    if (cliProvider === 'claude') {
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

      if (selectedReasoning) {
        args.push('--effort', selectedReasoning);
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

      // The CLI does NOT auto-load mcpServers from ~/.claude/settings.json —
      // only claude.ai-managed MCPs and project-local .mcp.json get picked
      // up by default. Point it at our config so stdio servers (comfyui,
      // android-builder, …) actually register on every spawn.
      const mcpConfigPath = `${process.env.HOME || '/home/node'}/.claude/settings.json`;
      try {
        if (fsSync.existsSync(mcpConfigPath)) {
          args.push('--mcp-config', mcpConfigPath);
        }
      } catch {
        // best-effort — missing file just means no extra stdio MCPs
      }

      if (isResuming && session.claude_session_id) {
        args.push('--resume', session.claude_session_id);
      }

      if (effectiveMode === 'planning') {
        args.push('--append-system-prompt', this.getPlanningPrompt());
      }

    } else {
      const resumeId = isResuming ? session.claude_session_id ?? undefined : undefined;

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
    if (cliProvider === 'claude') {
      extraEnv.CLAUDE_CONFIG_HOME = configHome;
    }
    extraEnv.WEBUI_SESSION_MODE = effectiveMode;
    extraEnv.WEBUI_CONFIG_HOME = configHome;
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
    Object.assign(extraEnv, buildIntegrationEnv());
    // Use regular spawn for CLI providers
    const proc: ChildProcess = cpSpawn(providerConfig.command, args, {
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
        // Shared secret the permission-prompt script sends back in a header so
        // the backend can distinguish real hook calls from forged requests.
        WEBUI_HOOK_SECRET: config.hookSecret,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

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
      contextWindow: contextWindowFor(selectedModel || CLI_PROVIDERS[cliProvider]?.defaultModel),
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
        // Codex/OpenCode: single-shot `run`/`exec` processes that exit after each turn.
        // On clean exit (code 0), keep the session entry alive for respawn instead of
        // tearing down the whole session.
        if (managedProc.cliProvider === 'codex' && exitCode === 0) {
          console.log(`[CODEX] Process exited cleanly, marking idle for respawn [${sessionId}]`);
          if (managedProc.streamingText?.trim().length) {
            this.saveAssistantMessage(sessionId, managedProc.streamingText.trim());
          }
          managedProc.codexIdle = true;
          managedProc.streamingText = '';
          managedProc.isStreaming = false;
          managedProc.buffer = '';
          this.io.to(`session:${sessionId}`).emit('session:thinking', {
            sessionId,
            isThinking: false,
          });
          return; // Do NOT clean up — session stays alive for respawn
        }
        // For providers that don't send a result message,
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

      }
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
        this.processStreamMessage(sessionId, raw as StreamJsonMessage);
      } catch (e) {
        // Not valid JSON, emit as raw output for debugging (skip noisy codex/opencode prompts)
        console.log(`Non-JSON output [${sessionId}]:`, line);
        if (proc.cliProvider !== 'codex' && proc.cliProvider !== 'opencode') {
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
      case 'turn.completed': {
        // Codex process teardown is now handled in the exit handler (exit code 0 → codexIdle).
        // If turn.completed arrives before process exit, just mark idle proactively.
        const codexProc = this.processes.get(sessionId);
        if (codexProc && codexProc.cliProvider === 'codex' && !codexProc.codexIdle) {
          console.log(`[CODEX] turn.completed received, marking idle [${sessionId}]`);
          codexProc.codexIdle = true;
        }
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
      }
      case 'error':
        if (data.message) {
          this.io.to(`session:${sessionId}`).emit('session:output', {
            sessionId,
            content: `${data.message}\n`,
            isComplete: false,
          });
        }

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
   * Translate a single opencode SSE event into our Socket.IO event stream.
   *
   * The OpenCode server emits `message.part.updated` many times per turn — once
   * per delta for streaming text/reasoning, once per state transition for tools
   * (pending → running → completed|error), and for step-start/step-finish
   * boundaries. `session.idle` marks the turn's end, at which point we finalize
   * the streaming buffer and persist the assistant message.
   */
  private processOpencodeTextChunk(
    sessionId: string,
    proc: ClaudeProcess,
    partId: string,
    rawChunk: string,
  ): void {
    if (!rawChunk) return;
    const streams = proc.partStreams ??= new Map();
    const existing = streams.get(partId);
    const entry = existing ?? { type: 'text' as const, text: '', thoughtState: { inside: false, pending: '' } };
    entry.thoughtState ??= { inside: false, pending: '' };

    entry.text += rawChunk;
    const { state: nextState, emit } = stripThoughtChunk(entry.thoughtState, rawChunk);
    entry.thoughtState = nextState;
    entry.cleaned = (entry.cleaned ?? '') + emit;
    streams.set(partId, entry);

    this.io.to(`session:${sessionId}`).emit('session:thinking', {
      sessionId,
      isThinking: nextState.inside,
    });

    if (emit) {
      if (process.env.OPENCODE_DEBUG_EVENTS === '1') {
        console.log(`[OC-EMIT] session=${sessionId} partId=${partId} chunk=${JSON.stringify(emit).slice(0, 80)} totalCleaned=${entry.cleaned.length}`);
      }
      this.io.to(`session:${sessionId}`).emit('session:output', {
        sessionId,
        content: emit,
        isComplete: false,
      });
    }
  }

  private translateOpencodeServerEvent(sessionId: string, event: OpencodeEvent): void {
    const proc = this.processes.get(sessionId);
    if (!proc) {
      if (process.env.OPENCODE_DEBUG_EVENTS === '1') {
        console.log(`[OC-TRANSLATE] no proc for sessionId=${sessionId} type=${event.type}`);
      }
      return;
    }

    const type = event.type;
    const props = (event.properties ?? {}) as Record<string, unknown>;

    switch (type) {
      case 'session.status': {
        const status = props.status as { type?: string } | undefined;
        if (status?.type === 'busy') {
          this.io.to(`session:${sessionId}`).emit('session:thinking', { sessionId, isThinking: true });
        } else if (status?.type === 'idle') {
          this.io.to(`session:${sessionId}`).emit('session:thinking', { sessionId, isThinking: false });
        }
        return;
      }

      case 'session.idle': {
        // Turn complete: flush accumulated text parts as final, persist assistant
        // message, and drop any partial streams so the next turn starts clean.
        const streams = proc.partStreams;
        if (streams && streams.size > 0) {
          const finalText: string[] = [];
          for (const entry of streams.values()) {
            if (entry.type !== 'text') continue;
            const out = (entry.cleaned ?? entry.text).trim();
            if (out) finalText.push(out);
          }
          if (finalText.length > 0) {
            const joined = finalText.join('\n');
            this.io.to(`session:${sessionId}`).emit('session:output', {
              sessionId,
              content: '',
              isComplete: true,
            });
            this.saveAssistantMessage(sessionId, joined);
          }
          streams.clear();
        }
        proc.streamingText = '';
        proc.isStreaming = false;
        proc.emittedTools?.clear();
        this.io.to(`session:${sessionId}`).emit('session:thinking', { sessionId, isThinking: false });
        return;
      }

      case 'session.error': {
        const err = props.error as { data?: { message?: string }; message?: string } | undefined;
        const message = err?.data?.message || err?.message || 'OpenCode session error';
        this.io.to(`session:${sessionId}`).emit('session:output', {
          sessionId,
          content: `${message}\n`,
          isComplete: true,
        });
        this.io.to(`session:${sessionId}`).emit('session:thinking', { sessionId, isThinking: false });
        return;
      }

      case 'message.part.updated': {
        const part = props.part as Record<string, unknown> | undefined;
        const delta = typeof props.delta === 'string' ? (props.delta as string) : undefined;
        if (!part) return;
        const partType = part.type as string;
        const partId = part.id as string;

        if (partType === 'text') {
          let rawChunk = delta ?? '';
          if (!rawChunk) {
            const fullText = (part.text as string) ?? '';
            const existing = proc.partStreams?.get(partId);
            if (fullText.length > (existing?.text?.length ?? 0)) {
              rawChunk = fullText.slice(existing?.text?.length ?? 0);
            }
          }
          this.processOpencodeTextChunk(sessionId, proc, partId, rawChunk);
          return;
        }

        if (partType === 'reasoning') {
          const fullText = (part.text as string) ?? '';
          if (!fullText.trim()) return;
          const summary = this.formatCodexReasoning(fullText);
          this.io.to(`session:${sessionId}`).emit('session:thinking', {
            sessionId,
            isThinking: true,
            message: summary || undefined,
          });
          return;
        }

        if (partType === 'tool') {
          const callId = (part.callID as string) || partId;
          const toolName = part.tool as string;
          const state = part.state as { status?: string; input?: unknown; output?: string; error?: string } | undefined;
          if (!toolName || !state) return;
          const emittedTools = proc.emittedTools ??= new Set();

          if (state.status === 'pending' || state.status === 'running') {
            if (!emittedTools.has(callId)) {
              emittedTools.add(callId);
              this.emitToolUse(sessionId, {
                sessionId,
                toolName,
                status: 'started',
                toolId: callId,
                input: state.input,
              });
            }
            return;
          }

          if (state.status === 'completed') {
            const output = typeof state.output === 'string' ? state.output : JSON.stringify(state.output ?? '');
            this.emitToolUse(sessionId, {
              sessionId,
              toolName,
              status: 'completed',
              toolId: callId,
              input: state.input,
              result: output,
            });
            return;
          }

          if (state.status === 'error') {
            this.emitToolUse(sessionId, {
              sessionId,
              toolName,
              status: 'error',
              toolId: callId,
              input: state.input,
              error: state.error || 'Tool error',
            });
            return;
          }
          return;
        }

        if (partType === 'step-start') {
          this.io.to(`session:${sessionId}`).emit('session:thinking', { sessionId, isThinking: true });
          return;
        }

        if (partType === 'step-finish') {
          const tokens = part.tokens as { input?: number; output?: number; reasoning?: number; cache?: { read?: number; write?: number } } | undefined;
          const cost = typeof part.cost === 'number' ? (part.cost as number) : 0;
          if (tokens) {
            proc.turnInputTokens = tokens.input ?? 0;
            proc.turnOutputTokens = tokens.output ?? 0;
            proc.turnCacheReadTokens = tokens.cache?.read ?? 0;
            proc.turnCacheCreationTokens = tokens.cache?.write ?? 0;
            proc.totalInputTokens += tokens.input ?? 0;
            proc.totalOutputTokens += tokens.output ?? 0;
            proc.cacheReadTokens += tokens.cache?.read ?? 0;
            proc.cacheCreationTokens += tokens.cache?.write ?? 0;
          }
          if (cost > 0) {
            proc.previousTotalCostUsd = proc.totalCostUsd;
            proc.totalCostUsd += cost;
          }
          this.emitUsage(sessionId, proc);
          return;
        }
        return;
      }

      case 'message.part.delta': {
        // Streaming text chunk. Shape: { sessionID, messageID, partID, field, delta }.
        // Only text deltas need to reach the UI; other fields are metadata updates.
        const field = typeof props.field === 'string' ? (props.field as string) : undefined;
        if (field !== 'text') return;
        const partId = typeof props.partID === 'string' ? (props.partID as string) : undefined;
        const delta = typeof props.delta === 'string' ? (props.delta as string) : undefined;
        if (!partId || !delta) return;
        this.processOpencodeTextChunk(sessionId, proc, partId, delta);
        return;
      }

      case 'permission.updated': {
        // Forwarded for future UI wiring; no action required for now.
        return;
      }

      default:
        return;
    }
  }

  /**
   * Respawn a codex process for the next turn.
   * Codex CLI is single-shot (stdin EOF → response → exit), so we need a fresh
   * process for each user message.  This reuses the existing ClaudeProcess entry
   * (preserving usage counters, mode, etc.) and only replaces the child process.
   */
  private async respawnCodexProcess(sessionId: string, proc: ClaudeProcess): Promise<void> {
    const providerConfig = CLI_PROVIDERS.codex;
    const selectedModel = proc.model || providerConfig.defaultModel;
    const selectedReasoning = await getCliReasoningForUser(proc.userId, 'codex');

    const db = getDatabase();
    const session = db
      .prepare('SELECT working_directory, allowed_directories FROM sessions WHERE id = ?')
      .get(sessionId) as { working_directory: string; allowed_directories: string | null } | undefined;

    if (!session) throw new Error('Session not found for codex respawn');

    const allowedDirs: string[] = session.allowed_directories
      ? JSON.parse(session.allowed_directories)
      : [];

    const args = getCLIArgs('codex', {
      mode: proc.mode,
      allowedDirectories: allowedDirs,
      workingDirectory: session.working_directory,
      model: selectedModel || undefined,
      reasoningLevel: selectedReasoning ?? undefined,
    });

    // Build env (same as startSession codex block)
    const extraEnv: Record<string, string> = {};
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
      // Ignore
    }
    Object.assign(extraEnv, buildIntegrationEnv());

    const newChildProc = cpSpawn(providerConfig.command, args, {
      cwd: session.working_directory,
      env: {
        ...process.env,
        ...extraEnv,
        WEBUI_SESSION_ID: sessionId,
        WEBUI_BACKEND_URL: `http://localhost:${config.port}`,
        WEBUI_PROJECT_PATH: session.working_directory,
        WEBUI_HOOK_SECRET: config.hookSecret,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Replace process reference and reset state
    proc.process = newChildProc;
    proc.codexIdle = false;
    proc.buffer = '';
    proc.streamingText = '';
    proc.isStreaming = false;

    // Re-attach output handlers
    newChildProc.stdout?.on('data', (data: Buffer) => {
      this.handleJsonOutput(sessionId, data.toString());
    });
    newChildProc.stderr?.on('data', (data: Buffer) => {
      console.error(`Claude stderr [${sessionId}]:`, data.toString());
    });
    newChildProc.on('exit', (exitCode) => {
      console.log(`[CODEX] Respawned process for session ${sessionId} exited with code ${exitCode}`);
      const managedProc = this.processes.get(sessionId);
      if (managedProc) {
        // Clean exit → mark idle for next respawn
        if (exitCode === 0) {
          console.log(`[CODEX] Respawned process exited cleanly, marking idle [${sessionId}]`);
          if (managedProc.streamingText?.trim().length) {
            this.saveAssistantMessage(sessionId, managedProc.streamingText.trim());
          }
          managedProc.codexIdle = true;
          managedProc.streamingText = '';
          managedProc.isStreaming = false;
          managedProc.buffer = '';
          this.io.to(`session:${sessionId}`).emit('session:thinking', { sessionId, isThinking: false });
          return;
        }
        if (managedProc.streamingText?.trim().length) {
          this.saveAssistantMessage(sessionId, managedProc.streamingText.trim());
          managedProc.streamingText = '';
          managedProc.isStreaming = false;
        }
      }
      this.io.to(`session:${sessionId}`).emit('session:thinking', { sessionId, isThinking: false });
      if (typeof exitCode === 'number' && exitCode !== 0) {

      }
      this.cleanupProcess(sessionId);
    });
    newChildProc.on('error', (err) => {
      console.error(`Claude process error [${sessionId}]:`, err);

      this.cleanupProcess(sessionId);
    });

    console.log(`[CODEX] Respawned process [${sessionId}], args: ${args.join(' ')}`);
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
        proc.contextWindow = contextWindowFor(rawMsg.model);
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
            proc.contextWindow = contextWindowFor(event.message.model);
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
          proc.streamingText = '';
          proc.isStreaming = false;
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
        toolId: msg.tool_use.id,
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
      // Emit turnComplete for external consumers
      this.events.emit('turnComplete', sessionId, {
        inputTokens: proc.turnInputTokens,
        outputTokens: proc.turnOutputTokens,
        totalCostUsd: proc.totalCostUsd,
      });
    }
  }

  private saveAssistantMessage(sessionId: string, content: string): void {
    const proc = this.processes.get(sessionId);
    const now = Date.now();
    if (
      proc &&
      proc.lastSavedAssistantContent === content &&
      proc.lastSavedAssistantAt !== undefined &&
      now - proc.lastSavedAssistantAt < 2000
    ) {
      console.log(`[SAVE] Skipping duplicate assistant message [${sessionId}]`);
      return;
    }

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

    if (proc) {
      proc.lastSavedAssistantContent = content;
      proc.lastSavedAssistantAt = now;
    }

    // Emit for external consumers
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

    if ((proc.cliProvider === 'codex' || proc.cliProvider === 'opencode') && proc.modePromptInjected !== proc.mode) {
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
      // Keep the session list preview in sync with the newest activity — previously
      // only assistant replies touched last_message, so user-only sessions showed
      // a stale preview until Claude responded.
      const preview = message.length > 200 ? message.slice(0, 200) : message;
      db.prepare(
        'UPDATE sessions SET last_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
      ).run(preview, sessionId);

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

      this.events.emit('userMessage', sessionId, message);
    }

    if (updateLastMessage) {
      // Track last message for permission approval resend
      proc.lastUserMessage = message;
      proc.lastAttachments = attachments || null;
    }
    proc.pendingPermissionDenials = null; // Clear any previous denials

    // Emit thinking indicator
    this.io.to(`session:${sessionId}`).emit('session:thinking', {
      sessionId,
      isThinking: true,
    });

    // Codex respawn: codex CLI is single-shot (stdin EOF → response → exit), so we
    // need a fresh process for each user message. OpenCode is now server-backed
    // (HTTP/SSE), so it doesn't need respawn — the session lives in the singleton.
    if (proc.cliProvider === 'codex' && proc.codexIdle) {
      console.log(`[CODEX] Respawning process for next message [${sessionId}]`);
      await this.respawnCodexProcess(sessionId, proc);
    }

    // Dispatch: server-backed opencode uses HTTP/SSE; claude/codex use stdin.
    if (proc.cliProvider === 'opencode' && proc.serverBacked && proc.claudeSessionId) {
      await opencodeServer.sendPrompt(proc.claudeSessionId, {
        text: messageForClaude,
        model: proc.model,
        mode: proc.mode,
        directory: proc.workingDirectory,
      });
      console.log(`Sent message [${sessionId}] via opencode HTTP: ${messageForClaude.substring(0, 100)}...`);
    } else {
      const formattedMessage = formatInputMessage(proc.cliProvider, messageForClaude);
      if (proc.cliProvider === 'codex') {
        // codex: single-shot process reads stdin until EOF before responding.
        proc.process.stdin?.end(formattedMessage);
      } else {
        proc.process.stdin?.write(formattedMessage);
      }
      console.log(`Sent message [${sessionId}] via ${proc.cliProvider}: ${messageForClaude.substring(0, 100)}...`);
    }
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

    // Server-backed opencode: abort the in-flight prompt via HTTP.
    if (proc.serverBacked && proc.cliProvider === 'opencode' && proc.claudeSessionId) {
      void opencodeServer.abort(proc.claudeSessionId);
      return;
    }

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

    // Server-backed opencode: drop the SSE handler so events for this session
    // stop routing anywhere. The opencode session itself stays alive on the
    // server (it can be resumed on next startSession).
    if (proc.serverBacked && proc.cliProvider === 'opencode' && proc.claudeSessionId) {
      opencodeServer.unsubscribe(proc.claudeSessionId);
    }

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

  /**
   * Gracefully stop every running Claude process. Used on SIGTERM/SIGINT so
   * container restarts don't orphan processes or leave sessions flagged as
   * 'running' in the DB. Sends SIGTERM, waits briefly for stdin/stdout drain,
   * then SIGKILLs anything still alive.
   */
  async shutdownAll(timeoutMs = 3000): Promise<void> {
    const sessionIds = Array.from(this.processes.keys());
    if (sessionIds.length === 0) return;

    console.log(`[SHUTDOWN] Terminating ${sessionIds.length} Claude process(es)`);
    const db = getDatabase();

    for (const sessionId of sessionIds) {
      const proc = this.processes.get(sessionId);
      if (!proc) continue;
      try {
        proc.process.stdin?.end();
        proc.process.kill('SIGTERM');
      } catch (err) {
        console.error(`[SHUTDOWN] SIGTERM failed for ${sessionId}:`, err);
      }
      try {
        db.prepare(`UPDATE sessions SET status = 'stopped', updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
          .run(sessionId);
      } catch {
        // DB may already be closing — best effort.
      }
    }

    // Give processes a moment to exit cleanly before force-killing.
    await new Promise((resolve) => setTimeout(resolve, timeoutMs));

    for (const sessionId of sessionIds) {
      const proc = this.processes.get(sessionId);
      if (!proc) continue;
      try {
        proc.process.kill('SIGKILL');
      } catch {
        // Process may already have exited.
      }
      this.processes.delete(sessionId);
    }
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

      if (requestedReasoning) {
        args.push('--effort', requestedReasoning);
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
        WEBUI_HOOK_SECRET: config.hookSecret,
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
      contextWindow: proc.contextWindow || contextWindowFor(proc.model),
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

      }
      this.cleanupProcess(sessionId);
    });

    newProc.on('error', (err) => {
      console.error(`Claude process error [${sessionId}]:`, err);

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
