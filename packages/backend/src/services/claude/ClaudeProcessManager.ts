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
import {
  CLI_PROVIDERS,
  getCLIArgs,
  formatInputMessage,
  getVibeModelAlias,
  type CLIProvider,
} from '../cli-providers.js';
import type { CodexServiceTier, CodexWebSearchMode } from '@claude-code-webui/shared';
import { opencodeServer, type OpencodeEvent } from '../opencode/OpencodeServer.js';
import { resolveConfigHome } from '../../utils/configPaths.js';
import { syncExternalSkills } from '../../utils/skillSync.js';
import { scanProject, formatProjectContext } from '../../utils/projectScanner.js';
import { safeJsonParse } from '../../utils/json.js';
import { getMistralApiKeyForUser } from '../../routes/settings.js';
import { buildIntegrationEnv } from '../../utils/integrationEnv.js';
import { applyVibeProviderLinks, syncProviderLinks } from '../../utils/providerLinks.js';

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
  chunk: string
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
  const row = db
    .prepare('SELECT settings_json FROM user_settings WHERE user_id = ?')
    .get(userId) as { settings_json?: string | null } | undefined;

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
  // Codex / GPT-5.x — context windows observed in `model_context_window` events
  // from codex session logs: gpt-5.5 → 258400, gpt-5.4 → 196k, gpt-5.4-mini → 128k.
  // The actual window can be overwritten when codex reports `model_context_window`
  // in a token_count event. Without this, codex sessions defaulted to 200k Claude
  // rates which made the context-used % calculation wrong on long sessions.
  if (id.startsWith('gpt-5.4-mini')) {
    return 128_000;
  }
  if (id.startsWith('gpt-5.4')) {
    return 196_000;
  }
  if (id.startsWith('gpt-5.5')) {
    return 256_000;
  }
  if (id.startsWith('gpt-5')) {
    return 256_000;
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

async function getCliReasoningForUser(
  userId: string,
  provider: CLIProvider
): Promise<string | null> {
  const db = getDatabase();
  const row = db
    .prepare('SELECT settings_json FROM user_settings WHERE user_id = ?')
    .get(userId) as { settings_json?: string | null } | undefined;

  const settingsJson = safeJsonParse<Record<string, unknown>>(row?.settings_json, {});
  const levels = settingsJson.cliProviderReasoning;
  if (!levels || typeof levels !== 'object') {
    return null;
  }

  const level = (levels as Record<string, unknown>)[provider];
  return normalizeReasoningLevel(level);
}

function getCliServiceTierForUser(userId: string, provider: CLIProvider): CodexServiceTier | null {
  if (provider !== 'codex') {
    return null;
  }

  const db = getDatabase();
  const row = db
    .prepare('SELECT settings_json FROM user_settings WHERE user_id = ?')
    .get(userId) as { settings_json?: string | null } | undefined;

  const settingsJson = safeJsonParse<Record<string, unknown>>(row?.settings_json, {});
  const tiers = settingsJson.cliProviderServiceTiers;
  if (!tiers || typeof tiers !== 'object') {
    return null;
  }

  return (tiers as Record<string, unknown>).codex === 'fast' ? 'fast' : null;
}

function getCodexWebSearchForUser(userId: string): CodexWebSearchMode {
  const db = getDatabase();
  const row = db
    .prepare('SELECT settings_json FROM user_settings WHERE user_id = ?')
    .get(userId) as { settings_json?: string | null } | undefined;

  const settingsJson = safeJsonParse<Record<string, unknown>>(row?.settings_json, {});
  const value = settingsJson.codexWebSearch;
  return value === 'cached' || value === 'live' || value === 'disabled' || value === 'auto'
    ? value
    : 'auto';
}

function getCodexUsageBaselineFromDatabase(
  sessionId: string
): { input: number; cached: number; output: number } | undefined {
  const db = getDatabase();
  const row = db
    .prepare(
      `
      SELECT
        COALESCE(SUM(input_tokens + cache_read_tokens), 0) as input,
        COALESCE(SUM(cache_read_tokens), 0) as cached,
        COALESCE(SUM(output_tokens), 0) as output
      FROM usage_history
      WHERE session_id = ?
        AND (model LIKE 'gpt-%' OR lower(model) LIKE '%codex%')
    `
    )
    .get(sessionId) as { input: number; cached: number; output: number } | undefined;

  if (!row) return undefined;
  const input = Number(row.input) || 0;
  const cached = Number(row.cached) || 0;
  const output = Number(row.output) || 0;
  if (input <= 0 && cached <= 0 && output <= 0) {
    return undefined;
  }
  return { input, cached, output };
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

function parseMarkdownFrontmatter(content: string): {
  frontmatter: Record<string, string>;
  body: string;
} {
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
    const data = JSON.parse(content) as {
      plugins?: Record<string, Array<{ installPath: string; version?: string }>>;
    };
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
  lines.push(
    'Registry of available skills, agents, and plugins. Load full instructions from their files only when needed.'
  );
  lines.push('');
  lines.push('Runtime tools:');
  lines.push(
    '- System Chromium is available at /usr/local/bin/plum-chromium; browser env vars CHROME_BIN, BROWSER, PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, and PUPPETEER_EXECUTABLE_PATH point there.'
  );
  lines.push(
    '- The Chromium wrapper adds Docker-safe flags such as --no-sandbox and --disable-dev-shm-usage, so do not apk add Chromium inside a session.'
  );

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
  lines.push(
    'Registry of available skills and agents. Full instructions live in their own files — loaded on demand.'
  );
  lines.push('');
  lines.push('- Skills: `~/.claude/skills/<name>/SKILL.md`');
  lines.push('- Agents: `~/.claude/agents/<name>.md`');
  lines.push(
    '- System Chromium is available at `/usr/local/bin/plum-chromium`; browser env vars are preconfigured for Playwright/Puppeteer-style tests.'
  );
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

function replaceManagedBlock(
  existing: string,
  startMarker: string,
  endMarker: string,
  newBlock: string
): string | null {
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
  legacyMarker?: string
): Promise<void> {
  let safePath: string;
  try {
    safePath = await resolveSafeFilePath(filePath);
  } catch (err) {
    console.warn(
      `[writeManagedBlock] Skipping unsafe path ${filePath}:`,
      err instanceof Error ? err.message : err
    );
    return;
  }

  let existing: string | null = null;
  try {
    existing = await fs.readFile(safePath, 'utf-8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code !== 'ENOENT') {
      console.warn(
        `[writeManagedBlock] Failed to read ${safePath}:`,
        err instanceof Error ? err.message : err
      );
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
    console.warn(
      `[writeManagedBlock] Failed to write ${safePath}:`,
      err instanceof Error ? err.message : err
    );
  }
}

/**
 * Remove old shared-config block from a file (migration from old format).
 */
async function removeOldSharedConfigBlock(filePath: string): Promise<void> {
  try {
    const existing = await fs.readFile(filePath, 'utf-8');
    const pattern = new RegExp(
      `${escapeRegex(WEBUI_MANAGED_BLOCK_START)}[\\s\\S]*?${escapeRegex(WEBUI_MANAGED_BLOCK_END)}`,
      'm'
    );
    if (pattern.test(existing)) {
      const cleaned = existing
        .replace(pattern, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
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
    WEBUI_MANAGED_MARKER
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
  cliProvider: string
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
    PROJECT_CONTEXT_BLOCK_END
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

// Walk every vibe session log under VIBE_HOME and collect the message_ids vibe
// already persisted. Used at WebUI session start to prime the dedupe set so
// `--continue`'s history replay doesn't re-emit prior turns to the frontend.
async function loadVibeSeenMessageIds(vibeSessionHome: string): Promise<Set<string>> {
  const seen = new Set<string>();
  const sessionsDir = path.join(vibeSessionHome, 'logs', 'session');
  let entries: import('fs').Dirent[];
  try {
    entries = await fs.readdir(sessionsDir, { withFileTypes: true });
  } catch {
    return seen;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const messagesPath = path.join(sessionsDir, entry.name, 'messages.jsonl');
    let raw: string;
    try {
      raw = await fs.readFile(messagesPath, 'utf-8');
    } catch {
      continue;
    }
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const id = (JSON.parse(line) as { message_id?: string }).message_id;
        if (id) seen.add(id);
      } catch {
        // Skip malformed lines.
      }
    }
  }
  return seen;
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function normalizeVibeThinkingLevel(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (!normalized) return null;
  if (normalized === 'extra_high' || normalized === 'xhigh') return 'max';
  if (normalized === 'minimal' || normalized === 'none') return 'off';
  if (['off', 'low', 'medium', 'high', 'max'].includes(normalized)) return normalized;
  return null;
}

function rewriteVibeSessionConfig(
  raw: string,
  opts: { sessionLogDir: string; activeAlias?: string | null; thinking?: string | null }
): string {
  let next = raw;
  const saveDirLine = `save_dir = ${tomlString(opts.sessionLogDir)}`;
  if (/^\s*save_dir\s*=\s*"[^"]*"/m.test(next)) {
    next = next.replace(/^\s*save_dir\s*=\s*"[^"]*"/m, saveDirLine);
  } else if (/^\s*\[session_logging\]\s*$/m.test(next)) {
    next = next.replace(/^\s*\[session_logging\]\s*$/m, (line) => `${line}\n${saveDirLine}`);
  } else {
    next = `${next.trimEnd()}\n\n[session_logging]\n${saveDirLine}\n`;
  }

  if (opts.activeAlias) {
    const activeLine = `active_model = ${tomlString(opts.activeAlias)}`;
    if (/^\s*active_model\s*=\s*"[^"]*"/m.test(next)) {
      next = next.replace(/^\s*active_model\s*=\s*"[^"]*"/m, activeLine);
    } else {
      next = `${activeLine}\n${next}`;
    }
  }

  if (opts.activeAlias && opts.thinking) {
    const blockRe = /^\s*\[\[models\]\]\s*$/gm;
    const starts: number[] = [];
    let match: RegExpExecArray | null;
    while ((match = blockRe.exec(next)) !== null) {
      starts.push(match.index);
    }
    for (let i = 0; i < starts.length; i += 1) {
      const start = starts[i]!;
      const end = starts[i + 1] ?? next.length;
      const block = next.slice(start, end);
      const alias = block.match(/^\s*alias\s*=\s*"([^"]+)"/m)?.[1];
      const name = block.match(/^\s*name\s*=\s*"([^"]+)"/m)?.[1];
      if (alias !== opts.activeAlias && name !== opts.activeAlias) continue;
      const thinkingLine = `thinking = ${tomlString(opts.thinking)}`;
      const rewrittenBlock = /^\s*thinking\s*=\s*"[^"]*"/m.test(block)
        ? block.replace(/^\s*thinking\s*=\s*"[^"]*"/m, thinkingLine)
        : block.replace(/^\s*alias\s*=\s*"[^"]*"/m, (line) => `${line}\n${thinkingLine}`);
      next = next.slice(0, start) + rewrittenBlock + next.slice(end);
      break;
    }
  }

  return next;
}

type VibeSessionStats = {
  session_prompt_tokens?: number;
  session_completion_tokens?: number;
  last_turn_prompt_tokens?: number;
  last_turn_completion_tokens?: number;
  context_tokens?: number;
  input_price_per_million?: number;
  output_price_per_million?: number;
  session_cost?: number;
};

function resolveWebuiScript(scriptName: string): string | null {
  const candidates = [
    path.resolve(__dirname, '../../../../../scripts', scriptName),
    path.resolve(process.cwd(), 'scripts', scriptName),
    path.join('/app/scripts', scriptName),
  ];
  for (const candidate of candidates) {
    try {
      if (fsSync.existsSync(candidate)) return candidate;
    } catch {
      // try next
    }
  }
  return null;
}

function resolveVibeRunnerInvocation(): { command: string; argsPrefix: string[] } | null {
  const runner = resolveWebuiScript('vibe-webui-runner.py');
  if (!runner) return null;
  const pythonCandidates = [
    '/home/node/.local/pipx/venvs/mistral-vibe/bin/python',
    process.env.PYTHON || '',
    'python3',
  ].filter(Boolean);
  for (const command of pythonCandidates) {
    if (command.includes('/') && !fsSync.existsSync(command)) continue;
    return { command, argsPrefix: [runner] };
  }
  return null;
}

function extractCodexText(output: string): string {
  const deltas: string[] = [];
  const completed: string[] = [];
  const fallback: string[] = [];

  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const event = JSON.parse(trimmed) as {
        type?: string;
        delta?: string;
        text?: string;
        item?: { type?: string; text?: string; content?: string; delta?: string };
      };
      const eventType = (event.type || '').replace(/\//g, '.').replace(/_/g, '').toLowerCase();
      const delta =
        (typeof event.delta === 'string' && event.delta) ||
        (typeof event.text === 'string' && event.text) ||
        (typeof event.item?.delta === 'string' && event.item.delta) ||
        '';
      if (
        delta &&
        (eventType.includes('delta') || eventType === 'agentmessage' || eventType === 'text')
      ) {
        deltas.push(delta);
      }
      const itemType = (event.item?.type || '').replace(/_/g, '').toLowerCase();
      if (eventType === 'item.completed' && itemType === 'agentmessage') {
        const text = event.item?.text || event.item?.content || '';
        if (text) completed.push(text);
      }
    } catch {
      if (!trimmed.startsWith('WARNING:')) fallback.push(trimmed);
    }
  }

  const deltaText = deltas.join('').trim();
  const completedText = completed.join('\n').trim();
  if (completedText.length >= deltaText.length * 0.5) return completedText;
  if (deltaText) return deltaText;
  return fallback.join('\n').trim();
}

async function maybeCodexChatGptAuthArg(codexHome: string): Promise<string[]> {
  try {
    const authPath = path.join(codexHome, 'auth.json');
    const auth = safeJsonParse<Record<string, unknown>>(await fs.readFile(authPath, 'utf-8'), {});
    const hasTokens =
      typeof auth.tokens === 'object' &&
      !!(auth.tokens as { access_token?: string }).access_token;
    const hasApiKey = typeof auth.OPENAI_API_KEY === 'string' && auth.OPENAI_API_KEY.length > 0;
    if (hasTokens && !hasApiKey) return ['--config', 'auth_mode="chatgpt"'];
  } catch {
    // No auth hint needed.
  }
  return [];
}

async function describeImagesWithCodex(opts: {
  imagePaths: string[];
  userPrompt: string;
  cwd: string;
  sessionId: string;
}): Promise<string | null> {
  if (opts.imagePaths.length === 0) return null;
  const providerConfig = CLI_PROVIDERS.codex;
  const codexHome = providerConfig.credentialsPath.replace('~', os.homedir());
  const prompt = [
    'Describe the attached image(s) for a downstream coding agent that cannot see images.',
    'Focus on concrete visual facts: UI text, errors, diagrams, layout, code snippets, filenames, charts, and relevant details.',
    'Do not solve the user task. Return concise structured notes that can be prepended to the downstream prompt.',
    '',
    `Original user prompt:\n${opts.userPrompt || '(no text prompt)'}`,
  ].join('\n');
  const args = [
    'exec',
    '--json',
    '--skip-git-repo-check',
    '--ephemeral',
    '--sandbox',
    'read-only',
    '-c',
    'approval_policy="never"',
    ...(await maybeCodexChatGptAuthArg(codexHome)),
    '--image',
    opts.imagePaths.join(','),
    prompt,
  ];

  return await new Promise<string | null>((resolve) => {
    const child = cpSpawn(providerConfig.command, args, {
      cwd: opts.cwd,
      env: {
        ...process.env,
        ...buildIntegrationEnv(),
        CODEX_HOME: codexHome,
        WEBUI_SESSION_ID: opts.sessionId,
        WEBUI_BACKEND_URL: `http://localhost:${config.port}`,
        WEBUI_PROJECT_PATH: opts.cwd,
        WEBUI_HOOK_SECRET: config.hookSecret,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      try {
        child.kill('SIGTERM');
      } catch {
        // ignore
      }
      resolve(null);
    }, 120_000);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      if (stdout.length > 2_000_000) stdout = stdout.slice(-2_000_000);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 200_000) stderr = stderr.slice(-200_000);
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      console.error(`[VIBE] Codex image bridge failed to spawn [${opts.sessionId}]:`, err);
      resolve(null);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const text = extractCodexText(stdout).trim();
      if (code !== 0 && !text) {
        console.warn(
          `[VIBE] Codex image bridge failed [${opts.sessionId}] code=${code}: ${stderr.slice(
            0,
            500
          )}`
        );
        resolve(null);
        return;
      }
      resolve(text || null);
    });
  });
}

// Copy the user's global ~/.vibe/config.toml into a per-session VIBE_HOME and
// rewrite session_logging.save_dir to point at the per-session logs dir. Vibe
// will otherwise write a fresh default config inside the empty VIBE_HOME on
// first run, which would drop skill_paths / user customizations.
async function seedVibeSessionConfig(
  vibeBaseHome: string,
  vibeSessionHome: string,
  selectedModel?: string | null,
  selectedReasoning?: string | null
): Promise<{ activeAlias: string | null; thinking: string | null }> {
  const sessionConfig = path.join(vibeSessionHome, 'config.toml');
  const globalConfig = path.join(vibeBaseHome, 'config.toml');
  let raw: string;
  try {
    raw = await fs.readFile(globalConfig, 'utf-8');
  } catch {
    return { activeAlias: null, thinking: null }; // No global config to copy.
  }
  const sessionLogDir = path.join(vibeSessionHome, 'logs', 'session');
  const activeAlias = getVibeModelAlias(selectedModel, raw);
  const thinking = normalizeVibeThinkingLevel(selectedReasoning);
  const sessionRewritten = rewriteVibeSessionConfig(raw, { sessionLogDir, activeAlias, thinking });
  const rewritten = applyVibeProviderLinks(sessionRewritten).content;
  try {
    await fs.writeFile(sessionConfig, rewritten, 'utf-8');
  } catch (err) {
    console.error(`[VIBE] Failed to seed config.toml at ${sessionConfig}:`, err);
  }
  return { activeAlias, thinking };
}

async function readLatestVibeSessionMeta(vibeSessionHome: string): Promise<{
  sessionId: string | null;
  stats: VibeSessionStats | null;
} | null> {
  const sessionsDir = path.join(vibeSessionHome, 'logs', 'session');
  let entries: Array<{ path: string; mtimeMs: number }> = [];
  try {
    const dirs = await fs.readdir(sessionsDir, { withFileTypes: true });
    entries = await Promise.all(
      dirs
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const metaPath = path.join(sessionsDir, entry.name, 'meta.json');
          try {
            const stat = await fs.stat(metaPath);
            return { path: metaPath, mtimeMs: stat.mtimeMs };
          } catch {
            return { path: metaPath, mtimeMs: 0 };
          }
        })
    );
  } catch {
    return null;
  }

  const latest = entries
    .filter((entry) => entry.mtimeMs > 0)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
  if (!latest) return null;

  try {
    const raw = await fs.readFile(latest.path, 'utf-8');
    const parsed = JSON.parse(raw) as {
      session_id?: string;
      stats?: Record<string, unknown>;
    };
    return {
      sessionId: typeof parsed.session_id === 'string' ? parsed.session_id : null,
      stats: (parsed.stats as VibeSessionStats | undefined) ?? null,
    };
  } catch {
    return null;
  }
}

// Helper to determine attachment type
function getAttachmentType(
  mimeType: string,
  filename?: string
): 'image' | 'text' | 'pdf' | 'document' {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType === 'application/pdf') return 'pdf';
  if (
    mimeType.startsWith('text/') ||
    mimeType === 'application/json' ||
    mimeType === 'application/xml' ||
    mimeType === 'application/javascript' ||
    (filename &&
      /\.(md|txt|json|yaml|yml|js|ts|tsx|jsx|py|rb|go|rs|java|sql|sh|html|css|xml|csv|toml|ini|cfg|conf|env|gitignore)$/i.test(
        filename
      ))
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

interface CodexReviewCommand {
  args: string[];
  prompt?: string;
}

function splitSlashArgs(input: string): string[] {
  const tokens: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(input)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3] ?? '');
  }
  return tokens;
}

function parseCodexReviewCommand(message: string): CodexReviewCommand | null {
  const trimmed = message.trim();
  if (!trimmed.startsWith('/review')) return null;
  const first = trimmed.split(/\s+/, 1)[0];
  if (first !== '/review') return null;

  const tokens = splitSlashArgs(trimmed.slice('/review'.length).trim());
  const args: string[] = [];
  const promptParts: string[] = [];
  let hasTarget = false;

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token) continue;
    if (token === '--uncommitted') {
      args.push('--uncommitted');
      hasTarget = true;
      continue;
    }
    if ((token === '--base' || token === '--commit' || token === '--title') && tokens[i + 1]) {
      args.push(token, tokens[i + 1]!);
      if (token === '--base' || token === '--commit') {
        hasTarget = true;
      }
      i += 1;
      continue;
    }
    promptParts.push(token);
  }

  const prompt = promptParts.join(' ').trim();

  if (!hasTarget) {
    args.unshift('--uncommitted');
  }

  return prompt ? { args, prompt } : { args };
}

function isCodexNativeSlashCommand(message: string): boolean {
  return /^\/(?:goal|compact)(?:\s|$)/i.test(message.trim());
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
  message?:
    | string
    | {
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
  // Current model-call context usage. Some providers, notably Codex, report
  // both per-call context usage and summed turn billing usage; keep those
  // separate so the context bar does not display cumulative/cache-billing totals.
  contextInputTokens?: number;
  contextCacheReadTokens?: number;
  contextCacheCreationTokens?: number;
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
  turnCostUsd?: number;
  // Context reminder flag for resumed sessions
  needsWorkingDirReminder: boolean;
  contextReminder: {
    summary: string;
    reason: 'mode-change' | 'provider-switch' | 'context-limit';
  } | null;
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
  // Codex CLI 0.130+ persists sessions at ~/.codex/sessions/<uuid>.jsonl. Once captured
  // from the first `thread.started` event, we use `codex exec resume <id>` on respawn
  // for native context continuity instead of transcript replay.
  codexSessionId?: string;
  // Image paths to attach via `--image` on the next codex respawn. Populated by
  // sendMessage when codex is the provider, consumed (and cleared) by respawnCodexProcess.
  codexPendingImages?: string[];
  // Dedicated Codex exec workflow to use for the next respawn instead of the
  // normal chat prompt, e.g. `codex exec review`.
  codexPendingExecCommand?: { type: 'review'; args: string[]; prompt?: string };
  // Codex `exec` cannot accept another stdin prompt after the first EOF. User
  // messages submitted while a turn is still running are stored here and
  // dispatched FIFO as fresh `codex exec` turns once the child exits.
  codexQueuedTurns?: CodexPreparedTurn[];
  codexQueueDraining?: boolean;
  codexPreemptingForQueuedTurn?: boolean;
  codexPreemptKillTimer?: ReturnType<typeof setTimeout>;
  // Track tool callIDs we've already emitted 'started' for during a codex turn, mirroring
  // the opencode emittedTools pattern. Reset at the start of each turn.
  codexEmittedTools?: Set<string>;
  // Last cumulative-token snapshot Codex reported for this session. We use it to
  // compute per-turn deltas because `turn.completed.usage` in resume mode reports
  // CUMULATIVE counts (input + cached + output grow monotonically across the
  // session). Without deltas, analytics gets multi-million-token rows for what
  // should be ~50k-per-turn API calls.
  codexLastReportedTokens?: { input: number; cached: number; output: number };
  // Mistral Vibe is per-turn like Codex, but prompt is delivered via argv (-p TEXT)
  // not stdin. We always start `idle` and spawn a fresh child for each message.
  vibeIdle?: boolean;
  // Isolated VIBE_HOME so each WebUI chat is its own vibe session (enables --continue
  // without cross-session bleed). Path is created at startSession.
  vibeHome?: string;
  // Track tool_call_id → tool name across vibe streaming chunks so the matching
  // tool result message can be paired with the originating call.
  vibeToolNames?: Map<string, string>;
  // Track vibe message_ids we've already forwarded so `--continue` replays
  // (which restream the whole conversation history) don't duplicate prior
  // assistant/tool messages on every turn.
  vibeSeenMessageIds?: Set<string>;
  // Server-backed providers (opencode in HTTP/SSE mode) have no child process.
  // `process` is a no-op stub; all lifecycle goes through HTTP + SSE subscription.
  serverBacked?: boolean;
  // Accumulates content per opencode part.id so we can emit streaming deltas
  // and a final isComplete=true when the session goes idle.
  partStreams?: Map<
    string,
    { type: 'text' | 'reasoning'; text: string; cleaned?: string; thoughtState?: ThoughtStripState }
  >;
  // Track tool callIDs we've already emitted 'started' for, so we don't
  // re-emit on every status transition (pending → running → completed).
  emittedTools?: Set<string>;
  lastSavedAssistantContent?: string;
  lastSavedAssistantAt?: number;
}

interface CodexPreparedTurn {
  queueId: string;
  queuedAt: string;
  originalMessage: string;
  messageForClaude: string;
  attachments?: FileAttachmentData[];
  updateLastMessage: boolean;
  codexImagePaths: string[];
  codexExecCommand?: { type: 'review'; args: string[]; prompt?: string };
  codexNativeSlashCommand: boolean;
}

export class ClaudeProcessManager {
  private processes: Map<string, ClaudeProcess> = new Map();
  private pendingModes: Map<string, SessionMode> = new Map(); // Store modes for sessions not yet started
  private pendingContextReminders: Map<
    string,
    { summary: string; reason: 'mode-change' | 'provider-switch' | 'context-limit' }
  > = new Map();
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

    console.warn(
      `[HOOKS] Could not find permission-prompt-wrapper.sh, tried: ${devPath}, ${prodPath}, ${fallbackPath}`
    );
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
            matcher: '*', // Match all tools
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
  private emitStatus(
    sessionId: string,
    data: { sessionId: string; status: 'running' | 'stopped' | 'error' }
  ): void {
    this.bufferMessage(sessionId, 'status', data);
    this.io.to(`session:${sessionId}`).emit('session:status', data);
  }

  // Wrapper to emit and buffer tool_use events
  private emitToolUse(
    sessionId: string,
    data: {
      sessionId: string;
      toolName: string;
      status: 'started' | 'completed' | 'error';
      toolId?: string;
      input?: unknown;
      result?: string;
      error?: string;
    }
  ): void {
    // Stamp with the backend clock so the frontend can sort tools against
    // assistant messages (which already use the backend clock via
    // saveAssistantMessage's `createdAt`). Mixing FE Date.now() with BE
    // ISO timestamps caused the timeline to pile tools at the bottom
    // whenever the browser clock drifted ahead of the server.
    const stamped = { ...data, timestamp: Date.now() };
    this.bufferMessage(sessionId, 'tool_use', stamped);
    this.io.to(`session:${sessionId}`).emit('session:tool_use', stamped);
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
    sinceTimestamp?: number
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
      if (proc.disconnectedAt && now - proc.disconnectedAt > DISCONNECT_TIMEOUT_MS) {
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
      .get(sessionId, userId) as
      | {
          working_directory: string;
          claude_session_id: string | null;
          allowed_directories: string | null;
          cli_provider: CLIProvider | null;
        }
      | undefined;

    if (!session) {
      throw new Error('Session not found');
    }

    if (this.processes.has(sessionId)) {
      return;
    }

    // Use provided mode, or pending mode, or default to 'auto-accept'
    const effectiveMode = mode ?? this.pendingModes.get(sessionId) ?? 'auto-accept';
    this.pendingModes.delete(sessionId); // Clear pending mode once used
    // Codex is the primary provider. Only very old rows can have NULL here.
    const cliProvider: CLIProvider = session.cli_provider || 'codex';
    const providerConfig = CLI_PROVIDERS[cliProvider];
    const configHome = resolveConfigHome(cliProvider);
    const selectedModel = await getCliModelForUser(userId, cliProvider);
    const selectedReasoning = await getCliReasoningForUser(userId, cliProvider);
    const selectedServiceTier = getCliServiceTierForUser(userId, cliProvider);

    console.log(
      `[MODE] Starting session ${sessionId} with mode ${effectiveMode}, provider ${cliProvider}`
    );

    // Parse allowed directories
    const allowedDirs: string[] = session.allowed_directories
      ? JSON.parse(session.allowed_directories)
      : [];

    const isResuming = !!session.claude_session_id;
    let args: string[] = [];

    // Write skills/agents to global ~/.claude/CLAUDE.md + lightweight project context
    await ensureGlobalInstructions(configHome);
    await ensureProjectInstructions(session.working_directory, configHome, cliProvider);
    syncProviderLinks({ quiet: true });

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
        remoteId = await opencodeServer.createSession(session.working_directory, {
          model: selectedModel,
          mode: effectiveMode,
          variant: selectedReasoning,
          allowedDirectories: allowedDirs,
        });
        db.prepare('UPDATE sessions SET claude_session_id = ? WHERE id = ?').run(
          remoteId,
          sessionId
        );
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

    if (cliProvider === 'vibe') {
      // Mistral Vibe takes its prompt via argv (-p TEXT) and exits after the turn.
      // There is no useful child process to spawn until the first user message
      // arrives — so we register a virtual process and respawn on every sendMessage.
      const vibeBaseHome = providerConfig.credentialsPath.replace('~', os.homedir());
      const vibeSessionHome = path.join(vibeBaseHome, 'webui-sessions', sessionId);
      try {
        await fs.mkdir(vibeSessionHome, { recursive: true });
      } catch (err) {
        console.error(`[VIBE] Failed to create VIBE_HOME ${vibeSessionHome}:`, err);
      }
      // Seed per-session config.toml from the global one so skill_paths and any
      // user customization carry over. Vibe writes its own copy on first run
      // otherwise — and that fresh copy loses our skill_paths override.
      await seedVibeSessionConfig(vibeBaseHome, vibeSessionHome, selectedModel, selectedReasoning);
      // On resume (or after a server restart), prime the dedupe set with every
      // message_id vibe has already persisted on disk so `--continue`-driven
      // history replays don't re-emit prior turns to the frontend.
      const seenIds = await loadVibeSeenMessageIds(vibeSessionHome);

      console.log(`[SESSION] ========== Starting Session (vibe) ==========`);
      console.log(`[SESSION] Session ID: ${sessionId}`);
      console.log(`[SESSION] VIBE_HOME: ${vibeSessionHome}`);
      console.log(`[SESSION] Working directory: ${session.working_directory}`);
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
        claudeSessionId: session.claude_session_id,
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
        vibeIdle: true,
        vibeHome: vibeSessionHome,
        vibeToolNames: new Map(),
        vibeSeenMessageIds: seenIds,
      };

      this.pendingContextReminders.delete(sessionId);
      this.processes.set(sessionId, claudeProcess);

      db.prepare('UPDATE sessions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
        'running',
        sessionId
      );
      this.emitStatus(sessionId, { sessionId, status: 'running' });
      return;
    }

    if (cliProvider === 'codex') {
      // Codex `exec` is single-shot and important launch parameters such as
      // `--image` can only be supplied at process spawn time. Register the WebUI
      // session as running, but delay the actual child process until sendMessage()
      // has the user prompt and attachments. This gives first-turn image input
      // the same behavior as later turns.
      const persistedCodexSessionId = session.claude_session_id || undefined;
      const codexTokenBaseline = persistedCodexSessionId
        ? getCodexUsageBaselineFromDatabase(sessionId)
        : undefined;

      console.log(`[SESSION] ========== Starting Session (codex idle) ==========`);
      console.log(`[SESSION] Session ID: ${sessionId}`);
      console.log(`[SESSION] Codex session ID: ${persistedCodexSessionId || '(new)'}`);
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
        claudeSessionId: session.claude_session_id,
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
        codexIdle: true,
        codexSessionId: persistedCodexSessionId,
        codexPendingImages: [],
        codexPendingExecCommand: undefined,
        codexEmittedTools: new Set(),
        codexLastReportedTokens: codexTokenBaseline,
      };

      this.pendingContextReminders.delete(sessionId);
      this.processes.set(sessionId, claudeProcess);

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
        '--debug',
        'hooks',
        '--output-format',
        'stream-json',
        '--input-format',
        'stream-json',
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
      const resumeId = isResuming ? (session.claude_session_id ?? undefined) : undefined;

      // Build command args using CLI provider abstraction
      args = getCLIArgs(cliProvider, {
        mode: effectiveMode,
        resumeSessionId: resumeId,
        allowedDirectories: allowedDirs,
        workingDirectory: session.working_directory,
        model: selectedModel ?? undefined,
        reasoningLevel: selectedReasoning ?? undefined,
        serviceTier: selectedServiceTier ?? undefined,
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
        if (proc.cliProvider === 'vibe') {
          const translated = this.translateVibeMessage(sessionId, raw);
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
        // Not valid JSON, emit as raw output for debugging (skip noisy codex/opencode/vibe prompts)
        console.log(`Non-JSON output [${sessionId}]:`, line);
        if (
          proc.cliProvider !== 'codex' &&
          proc.cliProvider !== 'opencode' &&
          proc.cliProvider !== 'vibe'
        ) {
          this.io.to(`session:${sessionId}`).emit('session:output', {
            sessionId,
            content: line + '\n',
            isComplete: false,
          });
        }
      }
    }
  }

  /**
   * Translate a Codex CLI JSON event (`codex exec --json` / app-server) to our
   * Socket.IO event vocabulary.
   *
   * Codex emits events in two notations depending on version/transport:
   *   - dot notation:   `item.completed`, `agent_message.delta`, `turn.started`
   *   - slash notation: `item/completed`, `item/agentMessage/delta`, `turn/started`
   *
   * Both are normalized to a single canonical form before switching.
   *
   * Event categories handled:
   *   - thread/turn lifecycle (capture sessionId, mark idle)
   *   - agent message deltas + completed (streaming text)
   *   - reasoning deltas + completed (thinking summaries)
   *   - tool events: commandExecution, fileChange, mcpToolCall, webSearch, imageView
   *   - plan updates (turn/plan/updated)
   *   - diff updates (turn/diff/updated) — currently informational, future work
   *   - context compaction, model rerouting, errors
   */
  private translateCodexMessage(sessionId: string, raw: unknown): StreamJsonMessage | null {
    if (!raw || typeof raw !== 'object') return null;

    const data = raw as {
      type?: string;
      // delta payloads
      delta?: string;
      text?: string;
      // shared id / thread context
      threadId?: string;
      turnId?: string;
      // item payloads
      item?: {
        id?: string;
        type?: string;
        text?: string;
        delta?: string;
        // command execution
        command?: string | string[];
        cwd?: string;
        status?: string;
        aggregatedOutput?: string;
        exitCode?: number;
        durationMs?: number;
        // file change
        changes?: unknown;
        // mcp tool call
        server?: string;
        tool?: string;
        arguments?: unknown;
        result?: unknown;
        error?: unknown;
        // web search
        query?: string;
        action?: unknown;
        // image view
        path?: string;
        // reasoning
        summary?: string;
        content?: string;
      };
      thread?: { id?: string };
      turn?: { id?: string; status?: string };
      // plan update
      plan?: Array<{ step: string; status: string }>;
      explanation?: string;
      // diff
      diff?: string;
      // model reroute
      fromModel?: string;
      toModel?: string;
      reason?: string;
      // turn usage — Codex `turn.completed.usage` shape is:
      //   { input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens }
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        cached_input_tokens?: number;
        reasoning_output_tokens?: number;
      };
      model_context_window?: number;
      info?: {
        model_context_window?: number;
        total_token_usage?: {
          input_tokens?: number;
          output_tokens?: number;
          cached_input_tokens?: number;
          reasoning_output_tokens?: number;
          total_tokens?: number;
        };
        last_token_usage?: {
          input_tokens?: number;
          output_tokens?: number;
          cached_input_tokens?: number;
          reasoning_output_tokens?: number;
          total_tokens?: number;
        };
      } | null;
      message?: string;
    };

    // Normalize event type: collapse `item/foo/bar` ↔ `item.foo.bar` to canonical
    // lowercase camelCase so a single switch covers both notations.
    //
    //   item/agentMessage/delta  →  item.agentmessage.delta
    //   item.commandExecution    →  item.commandexecution
    //   turn/plan/updated        →  turn.plan.updated
    const eventType = (data.type || '').replace(/\//g, '.').toLowerCase();

    switch (eventType) {
      // ── Thread lifecycle ────────────────────────────────────────────────
      case 'thread.started': {
        const threadId = data.thread?.id || data.threadId;
        if (threadId) {
          const proc = this.processes.get(sessionId);
          if (proc && proc.cliProvider === 'codex' && !proc.codexSessionId) {
            proc.codexSessionId = threadId;
            proc.claudeSessionId = threadId;
            const db = getDatabase();
            db.prepare('UPDATE sessions SET claude_session_id = ? WHERE id = ?').run(
              threadId,
              sessionId
            );
            console.log(`[CODEX] Captured session id ${threadId} for ${sessionId}`);
          }
        }
        return null;
      }

      // ── Turn lifecycle ──────────────────────────────────────────────────
      case 'task.started':
      case 'task_started':
      case 'turn.started':
        {
          const codexProc = this.processes.get(sessionId);
          const reportedWindow = data.model_context_window;
          if (codexProc && typeof reportedWindow === 'number' && reportedWindow > 0) {
            codexProc.contextWindow = reportedWindow;
          }
        }
        this.io.to(`session:${sessionId}`).emit('session:thinking', {
          sessionId,
          isThinking: true,
        });
        return null;

      case 'token_count': {
        const codexProc = this.processes.get(sessionId);
        if (!codexProc || codexProc.cliProvider !== 'codex') {
          return null;
        }

        const reportedWindow = data.info?.model_context_window ?? data.model_context_window;
        if (typeof reportedWindow === 'number' && reportedWindow > 0) {
          codexProc.contextWindow = reportedWindow;
        }

        // `last_token_usage` is the current model-call prompt, which is what a
        // context window meter should show. `total_token_usage` is summed across
        // all model calls in the Codex exec turn and can legitimately exceed the
        // model context window; that belongs in analytics/cost, not the context bar.
        const lastUsage = data.info?.last_token_usage;
        if (lastUsage) {
          const contextInputTotal = lastUsage.input_tokens ?? 0;
          const contextCached = Math.min(lastUsage.cached_input_tokens ?? 0, contextInputTotal);
          codexProc.contextInputTokens = Math.max(contextInputTotal - contextCached, 0);
          codexProc.contextCacheReadTokens = contextCached;
          codexProc.contextCacheCreationTokens = 0;
          this.emitUsage(sessionId, codexProc);
        }
        return null;
      }

      case 'turn.completed':
      case 'turn.failed': {
        const codexProc = this.processes.get(sessionId);
        if (codexProc && codexProc.cliProvider === 'codex') {
          console.log(`[CODEX] ${eventType} received [${sessionId}]`);
        }
        if (data.usage && codexProc) {
          // Codex's `turn.completed.usage` reports CUMULATIVE counts in resume
          // mode (each respawn loads the full session JSONL — totals grow across
          // turns). Sending the raw values to usage_history multiplied analytics
          // tokens 10-100x and produced single rows with 5M+ cached_input_tokens
          // (impossible for a single 256k-context API call).
          //
          // Solution: track the last-reported totals per session and compute
          // per-turn deltas. Edge cases:
          //   - First call (no snapshot): use raw values
          //   - Any counter decrease (counter reset / fresh codex spawn after
          //     session detach): use raw values (don't write a negative delta)
          //   - Monotonic increase: write delta
          //
          // Schema difference vs Claude:
          //   Codex:  input_tokens INCLUDES cached_input_tokens (overlapping)
          //   Claude: input_tokens and cache_read_input_tokens are disjoint
          //
          // After computing deltas we split into the disjoint pair Claude-style
          // so contextWindow math + usage_history rows stay consistent.
          //
          // Reasoning output tokens are billed like regular output upstream, so
          // we fold them into output_tokens for cost calculation.
          const totalInput = data.usage.input_tokens ?? 0;
          const totalCached = data.usage.cached_input_tokens ?? 0;
          const totalOutput =
            (data.usage.output_tokens ?? 0) + (data.usage.reasoning_output_tokens ?? 0);

          const prev = codexProc.codexLastReportedTokens;
          let deltaInput: number;
          let deltaCached: number;
          let deltaOutput: number;
          if (
            !prev ||
            totalInput < prev.input ||
            totalCached < prev.cached ||
            totalOutput < prev.output
          ) {
            // First call OR counter reset → take values as-is. The reset case
            // includes the very first turn after a fresh `codex exec` (no resume).
            deltaInput = totalInput;
            deltaCached = totalCached;
            deltaOutput = totalOutput;
          } else {
            deltaInput = totalInput - prev.input;
            deltaCached = totalCached - prev.cached;
            deltaOutput = totalOutput - prev.output;
          }
          codexProc.codexLastReportedTokens = {
            input: totalInput,
            cached: totalCached,
            output: totalOutput,
          };

          // Sanity cap: even cumulative-delta values shouldn't exceed roughly 4x
          // the context window in a single turn. If they do, clamp to keep
          // analytics sane. Caps are generous (1M each) so legitimate large turns
          // still pass through.
          const PER_TURN_CAP = 1_000_000;
          deltaInput = Math.min(deltaInput, PER_TURN_CAP);
          deltaCached = Math.min(deltaCached, PER_TURN_CAP);
          deltaOutput = Math.min(deltaOutput, PER_TURN_CAP);

          // Split into disjoint non-cached + cached for Claude-shape compatibility.
          const nonCachedInput = Math.max(deltaInput - deltaCached, 0);

          codexProc.turnInputTokens = nonCachedInput;
          codexProc.turnOutputTokens = deltaOutput;
          codexProc.turnCacheReadTokens = deltaCached;
          codexProc.turnCacheCreationTokens = 0; // Codex doesn't surface cache writes.

          // If this Codex version did not emit token_count.last_token_usage, keep
          // the live context meter bounded. The turn totals are billing totals
          // across all model calls and may exceed the model context window.
          if (
            codexProc.contextInputTokens === undefined &&
            codexProc.contextCacheReadTokens === undefined
          ) {
            const boundedContextInput = Math.min(deltaInput, codexProc.contextWindow);
            const boundedContextCached = Math.min(deltaCached, boundedContextInput);
            codexProc.contextInputTokens = Math.max(boundedContextInput - boundedContextCached, 0);
            codexProc.contextCacheReadTokens = boundedContextCached;
            codexProc.contextCacheCreationTokens = 0;
          }

          const turnCostUsd = this.calculateTurnCost(codexProc);
          codexProc.previousTotalCostUsd = codexProc.totalCostUsd;
          codexProc.totalCostUsd += turnCostUsd;
          this.emitUsage(sessionId, codexProc);

          return {
            type: 'result',
            usage: {
              input_tokens: nonCachedInput,
              output_tokens: deltaOutput,
              cache_read_input_tokens: deltaCached,
              cache_creation_input_tokens: 0,
            },
          };
        }
        return null;
      }

      // ── Agent message deltas (token-by-token streaming) ─────────────────
      // Variants we've seen in the wild across Codex versions:
      //   item.delta, item.text.delta, item.agentmessage.delta,
      //   agent_message.delta, text.delta, response.output_text.delta
      case 'item.delta':
      case 'item.text.delta':
      case 'item.agentmessage.delta':
      case 'agent_message.delta':
      case 'text.delta':
      case 'response.output_text.delta': {
        const chunk =
          (typeof data.delta === 'string' && data.delta) ||
          (typeof data.text === 'string' && data.text) ||
          (data.item && typeof data.item.delta === 'string' && data.item.delta) ||
          (data.item && typeof data.item.text === 'string' && data.item.text) ||
          '';
        if (!chunk) return null;
        const proc = this.processes.get(sessionId);
        if (proc) {
          proc.streamingText = (proc.streamingText || '') + chunk;
          proc.isStreaming = true;
        }
        this.io.to(`session:${sessionId}`).emit('session:output', {
          sessionId,
          content: chunk,
          isComplete: false,
        });
        return null;
      }

      // ── Reasoning deltas (live thinking) ────────────────────────────────
      case 'item.reasoning.delta':
      case 'reasoning.delta': {
        const chunk =
          (typeof data.delta === 'string' && data.delta) ||
          (data.item && typeof data.item.delta === 'string' && data.item.delta) ||
          '';
        if (!chunk) return null;
        const summary = this.formatCodexReasoning(chunk);
        if (summary) {
          this.io.to(`session:${sessionId}`).emit('session:thinking', {
            sessionId,
            isThinking: true,
            message: summary,
          });
        }
        return null;
      }

      // ── Command execution (shell tool) ──────────────────────────────────
      case 'item.started':
      case 'item.completed':
        return this.translateCodexItem(sessionId, data, eventType === 'item.completed');

      // ── Command output streaming ────────────────────────────────────────
      case 'item.commandexecution.outputdelta':
      case 'command.exec.outputdelta':
      case 'commandexecution.outputdelta': {
        const chunk = typeof data.delta === 'string' ? data.delta : '';
        if (!chunk) return null;
        // We surface command output as inline session:output for now. A future
        // enhancement could pipe to per-tool execution cards using the item.id.
        this.io.to(`session:${sessionId}`).emit('session:output', {
          sessionId,
          content: chunk,
          isComplete: false,
        });
        return null;
      }

      // ── Plan updates (matches Claude's TodoWrite UX) ────────────────────
      case 'turn.plan.updated': {
        if (Array.isArray(data.plan)) {
          this.emitToolUse(sessionId, {
            sessionId,
            toolName: 'TodoWrite',
            status: 'completed',
            toolId: `codex-plan-${data.turnId || Date.now()}`,
            input: { todos: data.plan },
            result: data.explanation || '',
          });
        }
        return null;
      }

      // ── Diff updates (whole-turn unified diff snapshot) ─────────────────
      case 'turn.diff.updated':
        // Informational; could render a "files changed" preview. Skipping for now
        // — individual fileChange items already cover the per-edit detail.
        return null;

      // ── Context compaction (auto-summarization at context limits) ───────
      case 'context_compacted':
      case 'context_compaction':
      case 'context.compacted':
      case 'context.compaction':
      case 'contextcompaction':
      case 'compacted': {
        const codexProc = this.processes.get(sessionId);
        if (codexProc && codexProc.cliProvider === 'codex') {
          this.resetCurrentContextUsage(codexProc);
          this.emitUsage(sessionId, codexProc);
        }
        this.io.to(`session:${sessionId}`).emit('session:compact', {
          sessionId,
          message: 'Context was compacted to reduce token usage',
          reason: 'auto-compact',
        });
        return null;
      }

      // ── Model rerouting (codex backend switched models on us) ───────────
      case 'model.rerouted': {
        const note = `\n[Codex rerouted ${data.fromModel || ''} → ${data.toModel || ''}${data.reason ? `: ${data.reason}` : ''}]\n`;
        this.io.to(`session:${sessionId}`).emit('session:output', {
          sessionId,
          content: note,
          isComplete: false,
        });
        return null;
      }

      case 'error':
      case 'configwarning':
      case 'warning':
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

  /**
   * Translate an `item.started` / `item.completed` event into a tool-use lifecycle
   * notification or an assistant message. Covers commandExecution, fileChange,
   * mcpToolCall, webSearch, imageView, agentMessage, and reasoning items.
   */
  private translateCodexItem(
    sessionId: string,
    data: {
      item?: {
        id?: string;
        type?: string;
        text?: string;
        command?: string | string[];
        cwd?: string;
        status?: string;
        aggregatedOutput?: string;
        exitCode?: number;
        durationMs?: number;
        changes?: unknown;
        server?: string;
        tool?: string;
        arguments?: unknown;
        result?: unknown;
        error?: unknown;
        query?: string;
        action?: unknown;
        path?: string;
        summary?: string;
        content?: string;
      };
    },
    isCompleted: boolean
  ): StreamJsonMessage | null {
    const item = data.item;
    if (!item) return null;
    // Codex item types may be camelCase (`commandExecution`) or snake_case
    // (`command_execution`) — normalize for switching.
    const itemType = (item.type || '').replace(/_/g, '').toLowerCase();
    const itemId = item.id || `codex-${itemType}-${Date.now()}`;
    const proc = this.processes.get(sessionId);

    // Skip duplicate started events; track which item ids we've emitted started for.
    if (proc) {
      proc.codexEmittedTools = proc.codexEmittedTools || new Set<string>();
    }

    switch (itemType) {
      case 'agentmessage':
      case 'agent_message': {
        if (!isCompleted || !item.text) return null;
        // If we already streamed the full text via deltas, the streamingText buffer
        // ≈ item.text; persist as the canonical assistant message and clear buffer.
        if (proc?.streamingText && proc.streamingText.length >= item.text.length * 0.5) {
          proc.streamingText = '';
          proc.isStreaming = false;
        }
        return {
          type: 'assistant',
          message: {
            role: 'assistant',
            content: item.text,
          },
        };
      }

      case 'reasoning': {
        if (!isCompleted) return null;
        const text = item.summary || item.text || item.content || '';
        if (!text) return null;
        const summary = this.formatCodexReasoning(text);
        if (summary) {
          this.io.to(`session:${sessionId}`).emit('session:thinking', {
            sessionId,
            isThinking: true,
            message: summary,
          });
        }
        return null;
      }

      case 'commandexecution': {
        const command = Array.isArray(item.command) ? item.command.join(' ') : item.command || '';
        if (!isCompleted) {
          if (proc && !proc.codexEmittedTools?.has(itemId)) {
            proc.codexEmittedTools?.add(itemId);
            this.emitToolUse(sessionId, {
              sessionId,
              toolName: 'Bash',
              status: 'started',
              toolId: itemId,
              input: { command, description: item.cwd },
            });
          }
          return null;
        }
        const success = item.status === 'completed' && (item.exitCode ?? 0) === 0;
        this.emitToolUse(sessionId, {
          sessionId,
          toolName: 'Bash',
          status: success ? 'completed' : 'error',
          toolId: itemId,
          input: { command, description: item.cwd },
          result: item.aggregatedOutput || '',
          error: success ? undefined : `exit ${item.exitCode ?? '?'}`,
        });
        return null;
      }

      case 'filechange': {
        const changes = item.changes;
        if (!isCompleted) {
          if (proc && !proc.codexEmittedTools?.has(itemId)) {
            proc.codexEmittedTools?.add(itemId);
            this.emitToolUse(sessionId, {
              sessionId,
              toolName: 'Edit',
              status: 'started',
              toolId: itemId,
              input: { changes },
            });
          }
          return null;
        }
        this.emitToolUse(sessionId, {
          sessionId,
          toolName: 'Edit',
          status: item.status === 'completed' ? 'completed' : 'error',
          toolId: itemId,
          input: { changes },
          result: typeof item.result === 'string' ? item.result : JSON.stringify(item.result ?? ''),
          error: item.error ? String(item.error) : undefined,
        });
        return null;
      }

      case 'mcptoolcall':
      case 'mcp_tool_call': {
        const toolName = `${item.server || 'mcp'}.${item.tool || 'tool'}`;
        if (!isCompleted) {
          if (proc && !proc.codexEmittedTools?.has(itemId)) {
            proc.codexEmittedTools?.add(itemId);
            this.emitToolUse(sessionId, {
              sessionId,
              toolName,
              status: 'started',
              toolId: itemId,
              input: item.arguments,
            });
          }
          return null;
        }
        this.emitToolUse(sessionId, {
          sessionId,
          toolName,
          status: item.status === 'completed' ? 'completed' : 'error',
          toolId: itemId,
          input: item.arguments,
          result: typeof item.result === 'string' ? item.result : JSON.stringify(item.result ?? ''),
          error: item.error ? String(item.error) : undefined,
        });
        return null;
      }

      case 'websearch':
      case 'web_search': {
        if (!isCompleted) {
          if (proc && !proc.codexEmittedTools?.has(itemId)) {
            proc.codexEmittedTools?.add(itemId);
            this.emitToolUse(sessionId, {
              sessionId,
              toolName: 'WebSearch',
              status: 'started',
              toolId: itemId,
              input: { query: item.query },
            });
          }
          return null;
        }
        this.emitToolUse(sessionId, {
          sessionId,
          toolName: 'WebSearch',
          status: 'completed',
          toolId: itemId,
          input: { query: item.query, action: item.action },
        });
        return null;
      }

      case 'imageview':
      case 'image_view':
        if (isCompleted && item.path) {
          this.emitToolUse(sessionId, {
            sessionId,
            toolName: 'Read',
            status: 'completed',
            toolId: itemId,
            input: { file_path: item.path },
          });
        }
        return null;

      case 'usermessage':
      case 'user_message':
        // Echo of the user input we just sent — ignore, we already persisted it.
        return null;

      default:
        return null;
    }
  }

  private formatCodexReasoning(text: string): string {
    const lines = text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length === 0) return '';
    const stripMd = (value: string) =>
      value
        .replace(/\*\*/g, '')
        .replace(/^#+\s*/, '')
        .trim();
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
   * Translate a Mistral Vibe streaming JSON message (one LLMMessage per line).
   *
   * Schema (from mistral-vibe/core/output_formatters.py StreamingJsonOutputFormatter):
   *   { role: 'assistant' | 'tool' | 'user' | 'system',
   *     content: string | null,
   *     reasoning_content?: string | null,
   *     tool_calls?: [{ id, function: { name, arguments }, type }] | null,
   *     name?: string | null,       // tool name on tool-result messages
   *     tool_call_id?: string,      // tool result correlation id
   *     message_id?: string,
   *     usage?: { input_tokens, output_tokens, ... } }
   */
  private translateVibeMessage(
    sessionId: string,
    raw: unknown
  ): StreamJsonMessage | StreamJsonMessage[] | null {
    if (!raw || typeof raw !== 'object') return null;
    const proc = this.processes.get(sessionId);
    if (!proc) return null;
    const data = raw as {
      role?: string;
      content?: string | null;
      reasoning_content?: string | null;
      tool_calls?: Array<{
        id?: string;
        function?: { name?: string; arguments?: string };
        type?: string;
      }> | null;
      name?: string | null;
      tool_call_id?: string;
      message_id?: string;
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        prompt_tokens?: number;
        completion_tokens?: number;
        cached_tokens?: number;
      };
    };

    const emissions: StreamJsonMessage[] = [];
    proc.vibeToolNames ??= new Map();
    proc.vibeSeenMessageIds ??= new Set();

    // Dedup: `vibe --continue` replays the entire prior conversation on stdout
    // before emitting the new turn. Skip any message we've already forwarded.
    // System/user echoes have no actionable side-effect for us regardless, but
    // we still mark them as seen so the set tracks vibe's monotonic id history.
    if (data.message_id) {
      if (proc.vibeSeenMessageIds.has(data.message_id)) {
        return null;
      }
      proc.vibeSeenMessageIds.add(data.message_id);
    }

    // Reasoning content → thinking indicator with summary
    if (typeof data.reasoning_content === 'string' && data.reasoning_content.trim()) {
      const summary = this.formatCodexReasoning(data.reasoning_content);
      this.io.to(`session:${sessionId}`).emit('session:thinking', {
        sessionId,
        isThinking: true,
        message: summary || undefined,
      });
    }

    // Assistant text → emit as assistant content
    if (data.role === 'assistant' && typeof data.content === 'string' && data.content) {
      emissions.push({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: data.content,
        },
      });
    }

    // Tool calls fired by the model
    if (data.role === 'assistant' && Array.isArray(data.tool_calls) && data.tool_calls.length > 0) {
      for (const call of data.tool_calls) {
        const toolName = call.function?.name || 'unknown';
        const callId = call.id || `vibe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        let parsedArgs: unknown = call.function?.arguments;
        try {
          if (typeof call.function?.arguments === 'string') {
            parsedArgs = JSON.parse(call.function.arguments);
          }
        } catch {
          // Keep raw string if not JSON
        }
        proc.vibeToolNames.set(callId, toolName);
        this.emitToolUse(sessionId, {
          sessionId,
          toolName,
          status: 'started',
          toolId: callId,
          input: parsedArgs,
        });
      }
    }

    // Tool result message (role='tool')
    if (data.role === 'tool' && data.tool_call_id) {
      const toolName = data.name || proc.vibeToolNames.get(data.tool_call_id) || 'unknown';
      const output =
        typeof data.content === 'string' ? data.content : JSON.stringify(data.content ?? '');
      this.emitToolUse(sessionId, {
        sessionId,
        toolName,
        status: 'completed',
        toolId: data.tool_call_id,
        result: output,
      });
    }

    // Usage stats (vibe may include them on the final assistant message)
    if (data.usage) {
      const inputTokens = data.usage.input_tokens ?? data.usage.prompt_tokens ?? 0;
      const outputTokens = data.usage.output_tokens ?? data.usage.completion_tokens ?? 0;
      emissions.push({
        type: 'result',
        usage: {
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          cache_read_input_tokens: data.usage.cached_tokens ?? 0,
          cache_creation_input_tokens: 0,
        },
      });
    }

    return emissions.length === 0 ? null : emissions.length === 1 ? emissions[0]! : emissions;
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
    rawChunk: string
  ): void {
    if (!rawChunk) return;
    const streams = (proc.partStreams ??= new Map());
    const existing = streams.get(partId);
    const entry = existing ?? {
      type: 'text' as const,
      text: '',
      thoughtState: { inside: false, pending: '' },
    };
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
        console.log(
          `[OC-EMIT] session=${sessionId} partId=${partId} chunk=${JSON.stringify(emit).slice(0, 80)} totalCleaned=${entry.cleaned.length}`
        );
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
          this.io
            .to(`session:${sessionId}`)
            .emit('session:thinking', { sessionId, isThinking: true });
        } else if (status?.type === 'idle') {
          this.io
            .to(`session:${sessionId}`)
            .emit('session:thinking', { sessionId, isThinking: false });
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
        this.saveUsageToDatabase(sessionId, proc);
        proc.streamingText = '';
        proc.isStreaming = false;
        proc.emittedTools?.clear();
        this.io
          .to(`session:${sessionId}`)
          .emit('session:thinking', { sessionId, isThinking: false });
        return;
      }

      case 'permission.asked': {
        const requestId = typeof props.id === 'string' ? props.id : undefined;
        const permission = typeof props.permission === 'string' ? props.permission : 'tool';
        const patterns = Array.isArray(props.patterns)
          ? props.patterns.filter((item): item is string => typeof item === 'string')
          : [];
        const metadata = props.metadata ?? {};
        if (!requestId) return;
        this.io.to(`session:${sessionId}`).emit('session:permission_request', {
          sessionId,
          requestId,
          toolName: permission,
          toolInput: metadata,
          description: `OpenCode requests ${permission}${patterns[0] ? `: ${patterns[0]}` : ''}`,
          suggestedPattern: patterns[0] || `${permission}:*`,
        });
        this.io
          .to(`session:${sessionId}`)
          .emit('session:thinking', { sessionId, isThinking: false });
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
        this.io
          .to(`session:${sessionId}`)
          .emit('session:thinking', { sessionId, isThinking: false });
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
          const state = part.state as
            | { status?: string; input?: unknown; output?: string; error?: string }
            | undefined;
          if (!toolName || !state) return;
          const emittedTools = (proc.emittedTools ??= new Set());

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
            const output =
              typeof state.output === 'string' ? state.output : JSON.stringify(state.output ?? '');
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
          this.io
            .to(`session:${sessionId}`)
            .emit('session:thinking', { sessionId, isThinking: true });
          return;
        }

        if (partType === 'step-finish') {
          const tokens = part.tokens as
            | {
                input?: number;
                output?: number;
                reasoning?: number;
                cache?: { read?: number; write?: number };
              }
            | undefined;
          const cost = typeof part.cost === 'number' ? (part.cost as number) : 0;
          if (tokens) {
            proc.turnInputTokens += tokens.input ?? 0;
            proc.turnOutputTokens += tokens.output ?? 0;
            proc.turnCacheReadTokens += tokens.cache?.read ?? 0;
            proc.turnCacheCreationTokens += tokens.cache?.write ?? 0;
            proc.totalInputTokens += tokens.input ?? 0;
            proc.totalOutputTokens += tokens.output ?? 0;
            proc.cacheReadTokens += tokens.cache?.read ?? 0;
            proc.cacheCreationTokens += tokens.cache?.write ?? 0;
          }
          if (cost > 0) {
            proc.previousTotalCostUsd = proc.totalCostUsd;
            proc.totalCostUsd += cost;
            proc.turnCostUsd = (proc.turnCostUsd ?? 0) + cost;
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
    const selectedServiceTier = getCliServiceTierForUser(proc.userId, 'codex');
    const webSearchMode = getCodexWebSearchForUser(proc.userId);

    const db = getDatabase();
    const session = db
      .prepare('SELECT working_directory, allowed_directories FROM sessions WHERE id = ?')
      .get(sessionId) as
      | { working_directory: string; allowed_directories: string | null }
      | undefined;

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
      serviceTier: selectedServiceTier ?? undefined,
      webSearchMode,
      codexExecCommand: proc.codexPendingExecCommand,
      // Use native codex resume once we've captured a sessionId from `thread.started`.
      resumeSessionId: proc.codexPendingExecCommand ? undefined : proc.codexSessionId,
    });
    proc.codexPendingExecCommand = undefined;

    // Attach pending images via Codex's `--image` flag (PNG/JPEG/GIF/WebP, <5MB each).
    // codex exec accepts a single comma-separated path list. We clear after consuming.
    if (proc.codexPendingImages && proc.codexPendingImages.length > 0) {
      args.push('--image', proc.codexPendingImages.join(','));
      proc.codexPendingImages = [];
    }

    // Build env (same as startSession codex block)
    const extraEnv: Record<string, string> = {};
    const codexHome = providerConfig.credentialsPath.replace('~', os.homedir());
    extraEnv.CODEX_HOME = codexHome;
    try {
      const authPath = path.join(codexHome, 'auth.json');
      const auth = safeJsonParse<Record<string, unknown>>(await fs.readFile(authPath, 'utf-8'), {});
      const hasTokens =
        typeof auth.tokens === 'object' &&
        !!(auth.tokens as { access_token?: string }).access_token;
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
    proc.turnInputTokens = 0;
    proc.turnOutputTokens = 0;
    proc.turnCacheReadTokens = 0;
    proc.turnCacheCreationTokens = 0;
    proc.contextInputTokens = undefined;
    proc.contextCacheReadTokens = undefined;
    proc.contextCacheCreationTokens = undefined;

    // Re-attach output handlers
    newChildProc.stdout?.on('data', (data: Buffer) => {
      this.handleJsonOutput(sessionId, data.toString());
    });
    newChildProc.stderr?.on('data', (data: Buffer) => {
      console.error(`Claude stderr [${sessionId}]:`, data.toString());
    });
    newChildProc.on('exit', (exitCode) => {
      console.log(
        `[CODEX] Respawned process for session ${sessionId} exited with code ${exitCode}`
      );
      const managedProc = this.processes.get(sessionId);
      if (managedProc) {
        if (managedProc.codexPreemptKillTimer) {
          clearTimeout(managedProc.codexPreemptKillTimer);
          managedProc.codexPreemptKillTimer = undefined;
        }

        const hasQueuedTurns = (managedProc.codexQueuedTurns?.length ?? 0) > 0;

        // Clean exit, or an intentional queued-input interruption, means the
        // manager should keep the session alive and immediately run the FIFO.
        if (exitCode === 0 || hasQueuedTurns) {
          if (exitCode === 0) {
            console.log(`[CODEX] Respawned process exited cleanly, marking idle [${sessionId}]`);
          } else {
            console.log(
              `[CODEX] Respawned process exited with code ${exitCode}; draining queued input [${sessionId}], depth=${managedProc.codexQueuedTurns?.length ?? 0}`
            );
          }
          if (managedProc.streamingText?.trim().length) {
            const suffix = exitCode === 0 ? '' : '\n\n[Interrupted by newer user message]';
            this.saveAssistantMessage(sessionId, `${managedProc.streamingText.trim()}${suffix}`);
          }
          managedProc.codexIdle = true;
          managedProc.codexPreemptingForQueuedTurn = false;
          managedProc.streamingText = '';
          managedProc.isStreaming = false;
          managedProc.buffer = '';
          if (hasQueuedTurns) {
            console.log(
              `[CODEX] Draining queued turn after process exit [${sessionId}], depth=${managedProc.codexQueuedTurns?.length ?? 0}`
            );
            void this.drainCodexQueuedTurns(sessionId, managedProc);
          } else {
            this.io
              .to(`session:${sessionId}`)
              .emit('session:thinking', { sessionId, isThinking: false });
          }
          return;
        }
        if (managedProc.streamingText?.trim().length) {
          this.saveAssistantMessage(sessionId, managedProc.streamingText.trim());
          managedProc.streamingText = '';
          managedProc.isStreaming = false;
        }
      }
      this.io.to(`session:${sessionId}`).emit('session:thinking', { sessionId, isThinking: false });
      this.cleanupProcess(sessionId);
    });
    newChildProc.on('error', (err) => {
      console.error(`Claude process error [${sessionId}]:`, err);

      this.cleanupProcess(sessionId);
    });

    console.log(`[CODEX] Respawned process [${sessionId}], args: ${args.join(' ')}`);
  }

  /**
   * Spawn a fresh Mistral Vibe process for the upcoming turn.
   * Vibe receives the prompt via argv `-p TEXT` and exits when done — there is
   * no stdin handoff. Each user message therefore spawns a new child. VIBE_HOME
   * is set per-WebUI-session so `--continue` resumes the right vibe session.
   */
  private async respawnVibeProcess(
    sessionId: string,
    proc: ClaudeProcess,
    prompt: string
  ): Promise<void> {
    const providerConfig = CLI_PROVIDERS.vibe;
    const selectedModel = proc.model || providerConfig.defaultModel;
    const selectedReasoning = await getCliReasoningForUser(proc.userId, 'vibe');

    const db = getDatabase();
    const session = db
      .prepare('SELECT working_directory, allowed_directories FROM sessions WHERE id = ?')
      .get(sessionId) as
      | { working_directory: string; allowed_directories: string | null }
      | undefined;

    if (!session) throw new Error('Session not found for vibe respawn');

    const allowedDirs: string[] = session.allowed_directories
      ? JSON.parse(session.allowed_directories)
      : [];

    // We use --continue when a vibe session already exists in this VIBE_HOME.
    // First spawn (no prior session) ⇒ omit --continue. We mark that the first
    // call has happened by checking proc.claudeSessionId / a session marker file.
    const vibeHome = proc.vibeHome || providerConfig.credentialsPath.replace('~', os.homedir());
    const sessionMarker = path.join(vibeHome, '.webui-session-started');
    let hasPriorSession = false;
    try {
      await fs.access(sessionMarker);
      hasPriorSession = true;
    } catch {
      // First turn: no marker yet.
    }

    const args = getCLIArgs('vibe', {
      mode: proc.mode,
      resumeSessionId: hasPriorSession ? 'continue' : undefined,
      allowedDirectories: allowedDirs,
      workingDirectory: session.working_directory,
      model: selectedModel || undefined,
      reasoningLevel: selectedReasoning ?? undefined,
    });

    // Prompt must be the last argv pair, separated so vibe interprets it correctly.
    args.push('-p', prompt);

    const vibeConfig = await seedVibeSessionConfig(
      providerConfig.credentialsPath.replace('~', os.homedir()),
      vibeHome,
      selectedModel,
      selectedReasoning
    );
    this.resetCurrentContextUsage(proc);

    const extraEnv: Record<string, string> = {};
    extraEnv.VIBE_HOME = vibeHome;
    if (vibeConfig.activeAlias) {
      extraEnv.VIBE_ACTIVE_MODEL = vibeConfig.activeAlias;
    }
    // Vibe authenticates via MISTRAL_API_KEY. Source priority:
    //   1. per-user setting stored encrypted in SQLite (Settings → API Keys → Mistral)
    //   2. parent process env (set via docker-compose MISTRAL_API_KEY)
    //   3. ~/.vibe/.env (created by interactive `vibe --setup`)
    // Per-user setting wins so the WebUI can override an outdated .env key without a restart.
    const userKey = proc.userId ? getMistralApiKeyForUser(proc.userId) : null;
    if (userKey) {
      extraEnv.MISTRAL_API_KEY = userKey;
    } else if (!process.env.MISTRAL_API_KEY) {
      try {
        const globalEnvPath = path.join(os.homedir(), '.vibe', '.env');
        const raw = await fs.readFile(globalEnvPath, 'utf-8');
        const match = raw.match(/^MISTRAL_API_KEY=(.+)$/m);
        if (match?.[1]) extraEnv.MISTRAL_API_KEY = match[1].trim();
      } catch {
        // No fallback found; fail-fast below.
      }
    }
    // Fail fast: vibe hangs silently on missing auth — surface the problem to the user.
    if (!process.env.MISTRAL_API_KEY && !extraEnv.MISTRAL_API_KEY) {
      const errMsg =
        'Mistral Vibe konnte nicht starten: MISTRAL_API_KEY ist nicht gesetzt. ' +
        'Trage den Schlüssel unter Settings → API Keys → Mistral Vibe ein.';
      console.error(`[VIBE] ${errMsg} [${sessionId}]`);
      this.saveAssistantMessage(sessionId, errMsg);
      this.io.to(`session:${sessionId}`).emit('session:thinking', { sessionId, isThinking: false });
      proc.vibeIdle = true;
      proc.process = createVirtualChildProcess();
      return;
    }
    Object.assign(extraEnv, buildIntegrationEnv());
    extraEnv.WEBUI_SESSION_MODE = proc.mode;
    extraEnv.WEBUI_CONFIG_HOME = resolveConfigHome(proc.cliProvider);

    const vibeRunner = resolveVibeRunnerInvocation();
    const spawnCommand = vibeRunner?.command || providerConfig.command;
    const spawnArgs = vibeRunner ? [...vibeRunner.argsPrefix, ...args] : args;
    if (!vibeRunner) {
      console.warn(
        `[VIBE] WebUI runner not found; falling back to raw vibe CLI without approval callback [${sessionId}]`
      );
    }

    const newChildProc = cpSpawn(spawnCommand, spawnArgs, {
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

    proc.process = newChildProc;
    proc.vibeIdle = false;
    proc.buffer = '';
    proc.streamingText = '';
    proc.isStreaming = false;

    // Vibe waits on stdin even with -p set; if we leave the pipe open it hangs and
    // exits 0 without ever calling the LLM. Close stdin right after spawn so vibe
    // proceeds to the single-shot completion path.
    newChildProc.stdin?.end();

    // Drop a marker so the next turn uses --continue — but only after the child
    // exits successfully (code 0). A premature marker write would lock subsequent
    // turns into --continue even though no real vibe session was ever created.

    newChildProc.stdout?.on('data', (data: Buffer) => {
      this.handleJsonOutput(sessionId, data.toString());
    });
    newChildProc.stderr?.on('data', (data: Buffer) => {
      console.error(`Vibe stderr [${sessionId}]:`, data.toString());
    });
    newChildProc.on('exit', (exitCode) => {
      console.log(`[VIBE] Process for session ${sessionId} exited with code ${exitCode}`);
      void (async () => {
        const managedProc = this.processes.get(sessionId);
        if (managedProc && managedProc.cliProvider === 'vibe') {
          if (managedProc.streamingText?.trim().length) {
            this.saveAssistantMessage(sessionId, managedProc.streamingText.trim());
          }
          if (exitCode === 0) {
            const latest = await readLatestVibeSessionMeta(vibeHome);
            if (latest?.stats) {
              const stats = latest.stats;
              const input = Number(stats.last_turn_prompt_tokens ?? 0);
              const output = Number(stats.last_turn_completion_tokens ?? 0);
              managedProc.turnInputTokens = Number.isFinite(input) ? input : 0;
              managedProc.turnOutputTokens = Number.isFinite(output) ? output : 0;
              managedProc.contextInputTokens =
                typeof stats.context_tokens === 'number'
                  ? stats.context_tokens
                  : managedProc.turnInputTokens;
              managedProc.totalInputTokens =
                typeof stats.session_prompt_tokens === 'number'
                  ? stats.session_prompt_tokens
                  : managedProc.totalInputTokens + managedProc.turnInputTokens;
              managedProc.totalOutputTokens =
                typeof stats.session_completion_tokens === 'number'
                  ? stats.session_completion_tokens
                  : managedProc.totalOutputTokens + managedProc.turnOutputTokens;
              const inputPrice =
                typeof stats.input_price_per_million === 'number'
                  ? stats.input_price_per_million
                  : 0;
              const outputPrice =
                typeof stats.output_price_per_million === 'number'
                  ? stats.output_price_per_million
                  : 0;
              managedProc.turnCostUsd =
                (managedProc.turnInputTokens / 1_000_000) * inputPrice +
                (managedProc.turnOutputTokens / 1_000_000) * outputPrice;
              if (typeof stats.session_cost === 'number') {
                managedProc.totalCostUsd = stats.session_cost;
              }
              this.emitUsage(sessionId, managedProc);
              this.saveUsageToDatabase(sessionId, managedProc);
            }
            if (latest?.sessionId) {
              managedProc.claudeSessionId = latest.sessionId;
              try {
                getDatabase()
                  .prepare('UPDATE sessions SET claude_session_id = ? WHERE id = ?')
                  .run(latest.sessionId, sessionId);
              } catch {
                // Non-critical: --continue uses VIBE_HOME, not the DB id.
              }
            }
          }
          managedProc.streamingText = '';
          managedProc.isStreaming = false;
          managedProc.buffer = '';
          managedProc.vibeIdle = true;
          // Only mark the session continuable if vibe exited cleanly. Otherwise
          // a transient crash (missing model, missing API key) would falsely
          // arm --continue and keep failing forever.
          if (exitCode === 0 && !hasPriorSession) {
            fs.writeFile(sessionMarker, new Date().toISOString(), 'utf-8').catch(() => undefined);
          }
          // Replace live child with a virtual stub so the manager keeps the session alive
          // for the next message without a dangling exited process.
          managedProc.process = createVirtualChildProcess();
          this.io
            .to(`session:${sessionId}`)
            .emit('session:thinking', { sessionId, isThinking: false });
        }
      })().catch((err) => {
        console.error(`[VIBE] Failed to finalize session ${sessionId}:`, err);
        this.io
          .to(`session:${sessionId}`)
          .emit('session:thinking', { sessionId, isThinking: false });
      });
    });
    newChildProc.on('error', (err) => {
      console.error(`Vibe process error [${sessionId}]:`, err);
      this.cleanupProcess(sessionId);
    });

    console.log(
      `[VIBE] Spawned process [${sessionId}], command=${spawnCommand}, args: ${spawnArgs
        .slice(0, -2)
        .join(' ')} -p <prompt:${prompt.length} chars>`
    );
  }

  private emitUsage(sessionId: string, proc: ClaudeProcess): void {
    const contextInputTokens = proc.contextInputTokens ?? proc.turnInputTokens;
    const contextCacheReadTokens = proc.contextCacheReadTokens ?? proc.turnCacheReadTokens;
    const contextCacheCreationTokens =
      proc.contextCacheCreationTokens ?? proc.turnCacheCreationTokens;

    // Context usage only counts INPUT tokens (including cache), NOT output tokens.
    // Prefer current model-call context usage over summed turn billing usage when
    // a provider reports both.
    const contextTokens = contextInputTokens + contextCacheReadTokens + contextCacheCreationTokens;
    const contextUsedPercent =
      proc.contextWindow > 0 ? Math.round((contextTokens / proc.contextWindow) * 100) : 0;

    this.io.to(`session:${sessionId}`).emit('session:usage', {
      sessionId,
      // Current context values for display
      inputTokens: contextInputTokens,
      outputTokens: proc.turnOutputTokens,
      cacheReadTokens: contextCacheReadTokens,
      cacheCreationTokens: contextCacheCreationTokens,
      totalTokens: contextTokens, // Context tokens only (no output) for display
      contextWindow: proc.contextWindow,
      contextUsedPercent,
      // Cumulative session cost
      totalCostUsd: proc.totalCostUsd,
      model: proc.model,
    });
    // Note: DB saving moved to saveUsageToDatabase() called only on turn completion
  }

  private resetCurrentContextUsage(proc: ClaudeProcess): void {
    proc.turnInputTokens = 0;
    proc.turnOutputTokens = 0;
    proc.turnCacheReadTokens = 0;
    proc.turnCacheCreationTokens = 0;
    proc.contextInputTokens = 0;
    proc.contextCacheReadTokens = 0;
    proc.contextCacheCreationTokens = 0;
    proc.turnCostUsd = undefined;
  }

  // Calculate cost for tokens based on model pricing
  // Prices per 1M tokens (as of 2025)
  // Prices per 1M tokens (USD). Codex models map to OpenAI's published API rates,
  // even though most users come via ChatGPT plans (where billing is flat). We
  // record the rate-card cost so analytics charts compare apples-to-apples
  // across providers. Users on ChatGPT plans can treat the figure as
  // "equivalent API spend".
  private static readonly MODEL_PRICING: Record<
    string,
    { input: number; output: number; cacheRead: number; cacheWrite: number }
  > = {
    // Anthropic Claude
    'claude-opus-4-5-20251101': { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
    'claude-sonnet-4-20250514': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    'claude-3-5-sonnet-20241022': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    'claude-3-5-haiku-20241022': { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
    // OpenAI Codex (rate-card equivalents; subscription users pay flat)
    'gpt-5.5': { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
    'gpt-5.4': { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
    'gpt-5.4-mini': { input: 0.25, output: 2, cacheRead: 0.025, cacheWrite: 0 },
    'gpt-5.3-codex': { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
    'gpt-5.2': { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
  };

  private calculateTurnCost(proc: ClaudeProcess): number {
    // Pricing lookup; default to Codex gpt-5.5 rates for unknown models (the new
    // primary provider). Previous default was Claude Opus pricing which over-
    // attributed cost to Codex sessions on cache misses.
    const defaultPricing = { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 };
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
    const turnTotalTokens =
      proc.turnInputTokens +
      proc.turnOutputTokens +
      proc.turnCacheReadTokens +
      proc.turnCacheCreationTokens;

    if (turnTotalTokens <= 0) return;

    // Calculate cost from tokens (not from CLI cumulative value)
    const turnCostUsd = proc.turnCostUsd ?? this.calculateTurnCost(proc);

    try {
      const db = getDatabase();
      db.prepare(
        `
        INSERT INTO usage_history (user_id, session_id, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, total_tokens, cost_usd, model)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      ).run(
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
      console.log(
        `[USAGE] Saved turn usage: ${turnTotalTokens} tokens, $${turnCostUsd.toFixed(4)}`
      );
      proc.turnCostUsd = undefined;
    } catch (error) {
      console.error('[USAGE] Failed to save usage to database:', error);
    }
  }

  private extractErrorText(msg: StreamJsonMessage): string | null {
    const msgAny = msg as unknown as {
      message?: unknown;
      error?: unknown;
      detail?: unknown;
      text?: unknown;
    };
    if (typeof msgAny?.message === 'string') return msgAny.message;
    if (typeof msgAny?.error === 'string') return msgAny.error;
    if (typeof msgAny?.detail === 'string') return msgAny.detail;
    if (typeof msgAny?.text === 'string') return msgAny.text;
    return null;
  }

  private isContextLimitError(text: string): boolean {
    const normalized = text.toLowerCase();
    return (
      normalized.includes('context window') ||
      normalized.includes('context limit') ||
      normalized.includes('context length') ||
      normalized.includes('maximum context') ||
      normalized.includes('token limit')
    );
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
    this.resetCurrentContextUsage(proc);
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
    this.emitUsage(sessionId, proc);
  }

  private processStreamMessage(sessionId: string, msg: StreamJsonMessage): void {
    const proc = this.processes.get(sessionId);
    if (!proc) return;

    console.log(
      `[MSG] type=${msg.type} subtype=${msg.subtype || ''} event.type=${msg.event?.type || ''}`
    );

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
          proc.turnCacheReadTokens =
            event.usage.cache_read_input_tokens || proc.turnCacheReadTokens;
          proc.turnCacheCreationTokens =
            event.usage.cache_creation_input_tokens || proc.turnCacheCreationTokens;
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
        const contentBlock = (
          event as { content_block?: { type: string; name?: string; id?: string } }
        ).content_block;
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
        const delta = event.delta as
          | { type?: string; text?: string; partial_json?: string }
          | undefined;

        // Handle text streaming
        if (delta?.type === 'text_delta' && delta.text) {
          proc.streamingText += delta.text;
          console.log(
            `[STREAM] Emitting session:output with text: "${delta.text.substring(0, 50)}..."`
          );
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
          console.log(
            `[TOOL] ${proc.currentToolName} completed with input length: ${proc.currentToolInput.length}`
          );

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

          const normalizedToolName = (proc.currentToolName || '')
            .replace(/[_-]/g, '')
            .toLowerCase();

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
            console.log(
              `[MODE] Plan mode ended for session ${sessionId}, switching to auto-accept`
            );
          }

          // Handle TodoWrite tool
          if (normalizedToolName === 'todowrite') {
            try {
              const todoInput = JSON.parse(proc.currentToolInput) as {
                todos?: Array<{ content: string; status: string; activeForm?: string }>;
              };
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
              const taskInput = JSON.parse(proc.currentToolInput) as {
                subagent_type?: string;
                description?: string;
              };
              if (taskInput.subagent_type) {
                console.log(
                  `[AGENT] Agent starting: ${taskInput.subagent_type} - ${taskInput.description || ''}`
                );
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
        console.log(
          `[PERMISSION] Permission denied for tools:`,
          msg.permission_denials.map((d) => d.tool_name).join(', ')
        );
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
        proc.cacheCreationTokens =
          msg.usage.cache_creation_input_tokens || proc.cacheCreationTokens;
      }
      // Get context window from modelUsage if available
      if (msg.modelUsage) {
        const primaryModel = Object.entries(msg.modelUsage).find(
          ([key]) => key.includes('opus') || key.includes('sonnet')
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
    if (
      msg.type === 'assistant' &&
      msg.message &&
      typeof msg.message !== 'string' &&
      !proc.isStreaming
    ) {
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
      const userMsg = msg as {
        message?: {
          content?: Array<{
            type: string;
            tool_use_id?: string;
            content?: string | Array<{ type: string; text?: string }>;
          }>;
        };
      };
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
              console.log(
                `[TOOL] Result for ${block.tool_use_id}: ${resultText.substring(0, 100)}...`
              );
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
    if (
      msg.type === 'system' &&
      (msg.subtype === 'compact' ||
        msg.subtype === 'pre_compact' ||
        (msg.message &&
          typeof msg.message === 'string' &&
          msg.message.toLowerCase().includes('compact')))
    ) {
      console.log(`[COMPACT] Context compaction detected for session ${sessionId}`);
      // Reset token counts since context was compacted
      proc.totalInputTokens = 0;
      proc.totalOutputTokens = 0;
      proc.cacheReadTokens = 0;
      proc.cacheCreationTokens = 0;
      this.resetCurrentContextUsage(proc);
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
    db.prepare(
      'UPDATE sessions SET last_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(content.substring(0, 200), sessionId);

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

  private queueCodexTurn(sessionId: string, proc: ClaudeProcess, turn: CodexPreparedTurn): void {
    proc.codexQueuedTurns ??= [];
    proc.codexQueuedTurns.push(turn);
    console.log(
      `[CODEX] Queued user turn while current turn is running [${sessionId}], depth=${proc.codexQueuedTurns.length}`
    );
    this.emitQueueState(sessionId, proc);
  }

  private emitQueueState(sessionId: string, proc: ClaudeProcess): void {
    const items = (proc.codexQueuedTurns ?? []).map((turn) => ({
      id: turn.queueId,
      preview: turn.originalMessage.slice(0, 240),
      createdAt: turn.queuedAt,
      attachments: turn.attachments?.length,
    }));
    this.io.to(`session:${sessionId}`).emit('session:queue', {
      sessionId,
      provider: proc.cliProvider,
      depth: items.length,
      items,
      preempting: !!proc.codexPreemptingForQueuedTurn,
    });
  }

  private requestCodexQueuePreemption(sessionId: string, proc: ClaudeProcess): void {
    if (proc.cliProvider !== 'codex' || proc.codexIdle || proc.codexPreemptingForQueuedTurn) {
      return;
    }

    const child = proc.process;
    if (!child || child.stdin === null) {
      return;
    }

    proc.codexPreemptingForQueuedTurn = true;
    console.log(`[CODEX] Interrupting active turn to drain queued input [${sessionId}]`);
    this.emitQueueState(sessionId, proc);

    if (proc.streamingText.trim().length > 0) {
      this.saveAssistantMessage(
        sessionId,
        `${proc.streamingText.trim()}\n\n[Interrupted by newer user message]`
      );
      proc.streamingText = '';
      proc.isStreaming = false;
    }

    child.kill('SIGINT');

    proc.codexPreemptKillTimer = setTimeout(() => {
      const latest = this.processes.get(sessionId);
      if (latest !== proc || latest.process !== child || !latest.codexPreemptingForQueuedTurn) {
        return;
      }

      console.warn(`[CODEX] Queued-input interrupt did not exit; sending SIGTERM [${sessionId}]`);
      child.kill('SIGTERM');

      latest.codexPreemptKillTimer = setTimeout(() => {
        const stillLatest = this.processes.get(sessionId);
        if (
          stillLatest !== proc ||
          stillLatest.process !== child ||
          !stillLatest.codexPreemptingForQueuedTurn
        ) {
          return;
        }

        console.warn(`[CODEX] Queued-input SIGTERM did not exit; sending SIGKILL [${sessionId}]`);
        child.kill('SIGKILL');
      }, 5000);
    }, 5000);
  }

  private async dispatchCodexTurn(
    sessionId: string,
    proc: ClaudeProcess,
    turn: CodexPreparedTurn
  ): Promise<void> {
    if (proc.cliProvider !== 'codex') {
      throw new Error('dispatchCodexTurn called for non-Codex session');
    }
    if (!proc.codexIdle) {
      throw new Error('Codex process is still running');
    }
    proc.codexIdle = false;

    if (turn.updateLastMessage) {
      proc.lastUserMessage = turn.originalMessage;
      proc.lastAttachments = turn.attachments || null;
    }
    proc.pendingPermissionDenials = null;

    this.io.to(`session:${sessionId}`).emit('session:thinking', {
      sessionId,
      isThinking: true,
    });

    proc.codexPendingExecCommand = turn.codexExecCommand;
    proc.codexPendingImages = [...turn.codexImagePaths];

    console.log(`[CODEX] Respawning process for next message [${sessionId}]`);
    try {
      await this.respawnCodexProcess(sessionId, proc);
    } catch (err) {
      proc.codexIdle = true;
      throw err;
    }

    let payloadForProvider = turn.messageForClaude;
    if (!turn.codexExecCommand && !turn.codexNativeSlashCommand && !proc.codexSessionId) {
      // First turn or session id not yet captured — prepend prior conversation
      // so the fresh codex process has continuity. Once `thread.started` lands
      // and proc.codexSessionId is set, subsequent respawns use native
      // `codex exec resume <id>` and we skip the manual prefix entirely.
      const contextPrefix = this.buildCodexContextPrefix(sessionId, turn.originalMessage);
      if (contextPrefix) {
        payloadForProvider = `${contextPrefix}\nUser's new message:\n${turn.messageForClaude}`;
      }
    }

    if (turn.codexExecCommand) {
      proc.process.stdin?.end();
    } else {
      proc.process.stdin?.end(formatInputMessage(proc.cliProvider, payloadForProvider));
    }

    console.log(
      `Sent message [${sessionId}] via codex: ${turn.messageForClaude.substring(0, 100)}...`
    );
  }

  private async drainCodexQueuedTurns(sessionId: string, proc: ClaudeProcess): Promise<void> {
    if (proc.cliProvider !== 'codex' || proc.codexQueueDraining || !proc.codexIdle) {
      return;
    }

    const nextTurn = proc.codexQueuedTurns?.shift();
    if (!nextTurn) {
      this.emitQueueState(sessionId, proc);
      return;
    }

    proc.codexQueueDraining = true;
    this.emitQueueState(sessionId, proc);
    try {
      await this.dispatchCodexTurn(sessionId, proc, nextTurn);
    } catch (err) {
      proc.codexQueuedTurns?.unshift(nextTurn);
      this.emitQueueState(sessionId, proc);
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[CODEX] Failed to dispatch queued turn [${sessionId}]:`, err);
      this.io.to(`session:${sessionId}`).emit('session:error', {
        sessionId,
        error: `Failed to start queued Codex message: ${message}`,
      });
      this.io.to(`session:${sessionId}`).emit('session:thinking', {
        sessionId,
        isThinking: false,
      });
    } finally {
      proc.codexQueueDraining = false;
    }
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
    const filePaths: {
      path: string;
      filename: string;
      type: 'image' | 'text' | 'pdf' | 'document';
      mimeType: string;
    }[] = [];
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
    const codexReviewCommand =
      proc.cliProvider === 'codex' ? parseCodexReviewCommand(message) : null;
    const codexNativeSlashCommand =
      proc.cliProvider === 'codex' && !codexReviewCommand && isCodexNativeSlashCommand(message);
    let codexExecCommandForTurn: CodexPreparedTurn['codexExecCommand'];
    const codexImagePathsForTurn: string[] = [];
    if (codexReviewCommand) {
      codexExecCommandForTurn = {
        type: 'review',
        args: codexReviewCommand.args,
        prompt: codexReviewCommand.prompt,
      };
      messageForClaude = '';
    }

    // Add working directory reminder for resumed sessions (only once)
    if (proc.needsWorkingDirReminder && !codexNativeSlashCommand) {
      const workingDirReminder = `<system-reminder>
IMPORTANT: Your current working directory is: ${proc.workingDirectory}
This is the project you should be working on. All file operations should be relative to this directory.
</system-reminder>

`;
      messageForClaude = workingDirReminder + messageForClaude;
      proc.needsWorkingDirReminder = false;
      console.log(`Added working directory reminder for resumed session [${sessionId}]`);
    }

    if (proc.contextReminder && !codexNativeSlashCommand) {
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

    if (
      proc.cliProvider === 'codex' &&
      !codexReviewCommand &&
      !codexNativeSlashCommand &&
      !proc.sharedContextInjected
    ) {
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

    if (
      !codexReviewCommand &&
      !codexNativeSlashCommand &&
      (proc.cliProvider === 'codex' || proc.cliProvider === 'opencode') &&
      proc.modePromptInjected !== proc.mode
    ) {
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
        if (proc.cliProvider === 'vibe' || proc.cliProvider === 'opencode') {
          const names = imageFiles.map((f) => f.filename).join(', ');
          const bridgeDescription = await describeImagesWithCodex({
            imagePaths: imageFiles.map((f) => f.path),
            userPrompt: message,
            cwd: proc.workingDirectory,
            sessionId,
          });
          if (bridgeDescription) {
            const providerLabel = proc.cliProvider === 'vibe' ? 'Vibe' : 'OpenCode';
            instructions.push(
              `The user attached ${imageFiles.length} image file(s) (${names}), saved at:\n${refs}\n\n` +
                `${providerLabel} is receiving these image attachments through Plum Code WebUI's Codex vision bridge, so Codex pre-read the image(s) and produced these visual notes:\n` +
                `<image-vision-notes provider="codex">\n${bridgeDescription}\n</image-vision-notes>\n\n` +
                `Use these notes as the image content. If you need exact pixels or OCR beyond these notes, say what is missing.`
            );
          } else {
            const providerLabel = proc.cliProvider === 'vibe' ? 'Vibe' : 'OpenCode';
            instructions.push(
              `The user attached ${imageFiles.length} image file(s) (${names}), saved at:\n${refs}\n` +
                `${providerLabel} did not receive native vision content and the Codex vision bridge failed. Do not pretend to see the image; ` +
                `ask the user for a text description or switch to Codex/Claude for this image-specific turn.`
            );
          }
        } else if (proc.cliProvider === 'codex') {
          // Codex supports native multimodal input via --image. Stage the paths for
          // this turn's respawn instead of asking the model to Read them — that wastes
          // a tool turn and the model can't actually see PNG bytes via fs reads anyway.
          codexImagePathsForTurn.push(...imageFiles.map((f) => f.path));
        } else {
          instructions.push(
            `Please analyze the following image files:\n${refs}\nUse the Read tool on these paths.`
          );
        }
      }

      if (pdfFiles.length > 0) {
        const refs = pdfFiles.map((f) => `- ${f.path}`).join('\n');
        instructions.push(
          `Please read and analyze the following PDF files:\n${refs}\nUse the Read tool on these paths.`
        );
      }

      if (otherFiles.length > 0) {
        const refs = otherFiles.map((f) => `- ${f.path}`).join('\n');
        instructions.push(
          `Please read the following files:\n${refs}\nUse the Read tool on these paths.`
        );
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
    let recordedMessageId = nanoid();
    let recordedCreatedAt = new Date().toISOString();

    if (recordMessage) {
      // Save user message and emit to frontend (show original message, images as metadata)
      const db = getDatabase();
      db.prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?, ?, ?, ?)').run(
        recordedMessageId,
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
        id: recordedMessageId,
        sessionId,
        role: 'user',
        content: message,
        createdAt: recordedCreatedAt,
        images: imageMetadata.length > 0 ? imageMetadata : undefined,
        attachments: attachmentMetadata.length > 0 ? attachmentMetadata : undefined,
      });

      this.events.emit('userMessage', sessionId, message);
    }

    if (proc.cliProvider === 'codex') {
      const codexTurn: CodexPreparedTurn = {
        queueId: recordedMessageId,
        queuedAt: recordedCreatedAt,
        originalMessage: message,
        messageForClaude,
        attachments,
        updateLastMessage,
        codexImagePaths: codexImagePathsForTurn,
        codexExecCommand: codexExecCommandForTurn,
        codexNativeSlashCommand,
      };

      if (!proc.codexIdle || proc.codexQueueDraining) {
        this.queueCodexTurn(sessionId, proc, codexTurn);
        this.requestCodexQueuePreemption(sessionId, proc);
        return;
      }

      await this.dispatchCodexTurn(sessionId, proc, codexTurn);
      return;
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

    // Vibe: prompt is delivered via argv (-p TEXT) so every turn requires a new spawn.
    // We branch out of the normal stdin dispatch entirely here.
    if (proc.cliProvider === 'vibe') {
      console.log(`[VIBE] Spawning fresh process for next message [${sessionId}]`);
      await this.respawnVibeProcess(sessionId, proc, messageForClaude);
      console.log(
        `Sent message [${sessionId}] via vibe (argv): ${messageForClaude.substring(0, 100)}...`
      );
      return;
    }

    // Dispatch: server-backed opencode uses HTTP/SSE; claude uses stdin.
    if (proc.cliProvider === 'opencode' && proc.serverBacked && proc.claudeSessionId) {
      const selectedReasoning = await getCliReasoningForUser(proc.userId, 'opencode');
      this.resetCurrentContextUsage(proc);
      await opencodeServer.sendPrompt(proc.claudeSessionId, {
        text: messageForClaude,
        model: proc.model,
        mode: proc.mode,
        variant: selectedReasoning,
        directory: proc.workingDirectory,
        webuiSessionId: sessionId,
      });
      console.log(
        `Sent message [${sessionId}] via opencode HTTP: ${messageForClaude.substring(0, 100)}...`
      );
    } else {
      const formattedMessage = formatInputMessage(proc.cliProvider, messageForClaude);
      proc.process.stdin?.write(formattedMessage);
      console.log(
        `Sent message [${sessionId}] via ${proc.cliProvider}: ${messageForClaude.substring(0, 100)}...`
      );
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
    const sessionRow = db
      .prepare('SELECT cli_provider as cliProvider FROM sessions WHERE id = ? AND user_id = ?')
      .get(sessionId, userId) as { cliProvider: CLIProvider | null } | undefined;
    const nextProvider = sessionRow?.cliProvider || proc?.cliProvider || 'codex';
    const providerChanged = !!proc && nextProvider !== proc.cliProvider;

    if (providerChanged) {
      this.pendingContextReminders.delete(sessionId);
      this.io.to(`session:${sessionId}`).emit('session:compact', {
        sessionId,
        message: 'Provider switched. Fresh CLI context started.',
        clear: true,
        reason: 'provider-switch',
      });
    }
    const currentMode = proc?.mode ?? this.pendingModes.get(sessionId) ?? 'auto-accept';

    // Stop if running
    if (proc) {
      if (proc.userId !== userId) {
        throw new Error('Unauthorized');
      }

      proc.codexQueuedTurns = [];
      this.emitQueueState(sessionId, proc);
      // Kill the process immediately
      proc.process.kill('SIGTERM');
      this.processes.delete(sessionId);
    }

    // Clear claude_session_id to start fresh (not resume)
    db.prepare(
      'UPDATE sessions SET status = ?, claude_session_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run('stopped', sessionId);
    console.log(`[SESSION] Cleared claude_session_id for fresh start`);

    // Wait a moment for cleanup
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Start fresh with the same mode
    await this.startSession(sessionId, userId, currentMode);

    console.log(`[SESSION] Session ${sessionId} restarted`);
  }

  private buildContextSummary(
    sessionId: string,
    maxMessages: number,
    maxChars: number
  ): string | null {
    const db = getDatabase();
    const rows = db
      .prepare(
        'SELECT role, content FROM messages WHERE session_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?'
      )
      .all(sessionId, maxMessages) as { role: string; content: string }[];

    if (!rows.length) {
      return null;
    }

    const formatted = rows
      .reverse()
      .map((row) => {
        const role =
          row.role === 'assistant' ? 'Assistant' : row.role === 'user' ? 'User' : row.role;
        return `${role}: ${row.content.trim()}`;
      })
      .join('\n\n');

    if (formatted.length <= maxChars) {
      return formatted;
    }

    return `${formatted.slice(0, maxChars)}...`;
  }

  /**
   * Build a Codex-friendly transcript of prior turns, excluding the just-saved
   * latest user message (which becomes the new prompt).
   *
   * Codex CLI has no native resume — every turn is a fresh process. To simulate
   * continuity, we prepend a structured transcript so the model has context.
   *
   * Returns null if there are no prior turns to replay.
   */
  private buildCodexContextPrefix(sessionId: string, latestUserMessage: string): string | null {
    const db = getDatabase();
    const MAX_MESSAGES = 40;
    const MAX_CHARS = 24_000;

    const rows = db
      .prepare(
        'SELECT role, content FROM messages WHERE session_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?'
      )
      .all(sessionId, MAX_MESSAGES + 1) as { role: string; content: string }[];

    const newest = rows[0];
    if (!newest) return null;

    // Drop the just-saved latest user message if it matches (sendMessage saves
    // before respawn, so it's the newest row when we get here).
    const prior =
      newest.role === 'user' && newest.content.trim() === latestUserMessage.trim()
        ? rows.slice(1)
        : rows;

    if (!prior.length) return null;

    const formatted = prior
      .slice(0, MAX_MESSAGES)
      .reverse()
      .map((row) => {
        const role =
          row.role === 'assistant' ? 'Assistant' : row.role === 'user' ? 'User' : row.role;
        return `${role}: ${row.content.trim()}`;
      })
      .join('\n\n');

    if (!formatted.trim()) return null;

    const truncated =
      formatted.length > MAX_CHARS
        ? '[earlier turns omitted]\n\n' + formatted.slice(formatted.length - MAX_CHARS)
        : formatted;

    return [
      '[Prior conversation context — for your reference only, do not repeat verbatim]',
      truncated,
      '[End of prior context]',
      '',
    ].join('\n');
  }

  // Set permission mode for a session
  setMode(sessionId: string, userId: string, mode: SessionMode): void {
    const proc = this.processes.get(sessionId);

    // If no process running, store the mode for when it starts
    if (!proc) {
      console.log(
        `[MODE] No running process for ${sessionId}, storing mode ${mode} for next start`
      );
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
        db.prepare(
          `UPDATE sessions SET status = 'stopped', updated_at = CURRENT_TIMESTAMP WHERE id = ?`
        ).run(sessionId);
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
      .get(sessionId, userId) as
      | {
          working_directory: string;
          claude_session_id: string | null;
          allowed_directories: string | null;
        }
      | undefined;

    if (!session) {
      throw new Error('Session not found');
    }

    // Parse allowed directories
    const allowedDirs: string[] = session.allowed_directories
      ? JSON.parse(session.allowed_directories)
      : [];

    let args: string[] = [];
    const requestedModel =
      proc.model && proc.model !== 'unknown'
        ? proc.model
        : await getCliModelForUser(userId, cliProvider);
    const requestedReasoning = await getCliReasoningForUser(userId, cliProvider);
    const requestedServiceTier = getCliServiceTierForUser(userId, cliProvider);
    if (cliProvider === 'claude') {
      args = [
        '--print',
        '--verbose',
        '--output-format',
        'stream-json',
        '--input-format',
        'stream-json',
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
        serviceTier: requestedServiceTier ?? undefined,
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
