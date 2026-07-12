import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  getOpenCodeBuildAgentPrompt,
  getOpenCodePrimaryAgent,
  isOpenCodeManagedBuildAgentPrompt,
} from '../services/opencode/sessionContext.js';
import {
  getOpenCodeCredentialEnvVars,
  readOpenCodeProvidersForUser,
  type OpenCodeProvider,
} from './opencodeProviderKeys.js';
import { getOpenCodeProviderCatalog, type OpenCodeProviderCatalog } from './opencodeCatalog.js';

const CLAUDE_SKILLS_DIR = '/home/node/.claude/skills';
const CLAUDE_AGENTS_DIR = '/home/node/.claude/agents';
const OPENCODE_CONFIG_PATH = '/home/node/.opencode/config/opencode.json';
const OPENCODE_AGENTS_DIR = '/home/node/.opencode/config/agents';
const VIBE_AGENTS_DIR = '/home/node/.vibe/agents';
const VIBE_PROMPTS_DIR = '/home/node/.vibe/prompts';
const VIBE_CONFIG_PATH = '/home/node/.vibe/config.toml';
const VIBE_MANAGED_BLOCK_START = '# >>> webui-managed provider links >>>';
const VIBE_MANAGED_BLOCK_END = '# <<< webui-managed provider links <<<';
const ZAI_VISION_MCP_NAME = 'zai-vision';
const ZAI_VISION_MCP_MARKER = 'zai-vision-v1';

type ZaiVisionMcpPolicy = 'auto' | 'always' | 'off';

// Claude Code tool names (PascalCase) → OpenCode tool names (lowercase).
// OpenCode validates this list strictly; unlisted Claude tools are omitted.
const OPENCODE_TOOL_MAP: Record<string, string> = {
  Read: 'read',
  Write: 'write',
  Edit: 'edit',
  Glob: 'glob',
  Grep: 'grep',
  Bash: 'bash',
  WebFetch: 'webfetch',
  TodoWrite: 'todowrite',
  Task: 'task',
};

// Claude Code tool names (PascalCase) → Vibe tool names.
const VIBE_TOOL_MAP: Record<string, string> = {
  AskUserQuestion: 'ask_user_question',
  Bash: 'bash',
  Edit: 'search_replace',
  Grep: 'grep',
  Read: 'read_file',
  Task: 'task',
  TodoWrite: 'todo',
  WebFetch: 'web_fetch',
  WebSearch: 'web_search',
  Write: 'write_file',
};

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

interface Parsed {
  fields: Record<string, string>;
  body: string;
}

interface ClaudeMcpServer {
  type?: 'stdio' | 'http' | string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

interface ClaudeSettings {
  mcpServers?: Record<string, ClaudeMcpServer>;
}

export interface ProviderLinksSyncResult {
  opencodeAgents: { converted: number; skipped: number };
  vibeAgents: { converted: number; skipped: number };
  opencodeConfig: { updated: boolean; mcpCount: number };
  vibeConfig: { updated: boolean; mcpCount: number };
}

interface OpenCodeConfigProviderBlock {
  api?: string;
  name?: string;
  env?: string[];
  npm?: string;
  options?: Record<string, unknown>;
  models?: Record<string, unknown>;
}

function parseFrontmatter(source: string): Parsed | null {
  const m = source.match(FRONTMATTER_RE);
  if (!m) return null;
  const raw = m[1] ?? '';
  const body = m[2] ?? '';
  const fields: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    fields[key] = value;
  }
  return { fields, body };
}

function parseToolList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((tool) => tool.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

function firstBodyLine(body: string): string {
  return (
    body
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0 && !line.startsWith('#')) || ''
  );
}

function safeName(value: string): string {
  const safe = value
    .trim()
    .replace(/\.[^.]+$/, '')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return safe || 'agent';
}

function titleFromName(value: string): string {
  return safeName(value)
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function addVibeAllowlistName(names: Set<string>, value: string | undefined): void {
  if (!value) return;
  const name = safeName(value);
  if (!name) return;
  names.add(name);
  names.add(name.toLowerCase());
}

function getVibeTaskAllowlist(): string[] {
  const names = new Set<string>(['explore']);
  if (!fs.existsSync(CLAUDE_AGENTS_DIR)) return Array.from(names).sort();

  for (const file of fs.readdirSync(CLAUDE_AGENTS_DIR).filter((entry) => entry.endsWith('.md'))) {
    addVibeAllowlistName(names, file);
    try {
      const source = fs.readFileSync(path.join(CLAUDE_AGENTS_DIR, file), 'utf8');
      const parsed = parseFrontmatter(source);
      addVibeAllowlistName(names, parsed?.fields.name);
    } catch {
      // Ignore unreadable custom agents; conversion logs the actual failure elsewhere.
    }
  }
  return Array.from(names).sort();
}

function readClaudeSettings(claudeSettingsPath?: string): ClaudeSettings | null {
  const settingsPath = claudeSettingsPath || path.join(os.homedir(), '.claude/settings.json');
  try {
    const raw = fs.readFileSync(settingsPath, 'utf8');
    const parsed = JSON.parse(raw) as ClaudeSettings;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function getClaudeMcpServers(claudeSettingsPath?: string): Record<string, ClaudeMcpServer> {
  return readClaudeSettings(claudeSettingsPath)?.mcpServers || {};
}

function writeIfChanged(filePath: string, content: string): boolean {
  let existing: string | null = null;
  try {
    existing = fs.readFileSync(filePath, 'utf8');
  } catch {
    existing = null;
  }
  if (existing === content) return false;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return true;
}

function readJsonObject(filePath: string): Record<string, unknown> {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Missing or invalid config gets replaced with a minimal valid object.
  }
  return {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function formatOpenCodeProviderModelName(modelId: string): string {
  return modelId
    .replace(/[-_]/g, ' ')
    .split(' ')
    .map((segment) => {
      if (/^\d/.test(segment)) return segment;
      if (segment.toLowerCase() === 'glm') return 'GLM';
      if (segment.toLowerCase() === 'qwen') return 'Qwen';
      return segment.charAt(0).toUpperCase() + segment.slice(1);
    })
    .join(' ');
}

function mergeStringArrays(...lists: Array<string[] | undefined>): string[] {
  const values = new Set<string>();
  for (const list of lists) {
    for (const item of list || []) {
      const normalized = typeof item === 'string' ? item.trim() : '';
      if (normalized) values.add(normalized);
    }
  }
  return [...values];
}

export function buildWebuiOpenCodeProviderConfig(
  provider: OpenCodeProvider,
  catalog: OpenCodeProviderCatalog = getOpenCodeProviderCatalog(),
  existing?: Record<string, unknown>
): OpenCodeConfigProviderBlock | null {
  const catalogProvider = catalog[provider.id];
  const baseUrl = provider.baseUrl || catalogProvider?.api;
  if (!provider.enabled || !baseUrl) return null;

  const existingBlock = isRecord(existing) ? existing : {};
  const existingOptions = isRecord(existingBlock.options) ? existingBlock.options : {};
  const existingModels = isRecord(existingBlock.models)
    ? (existingBlock.models as Record<string, unknown>)
    : {};
  const modelIds = catalogProvider?.models || [];
  const models: Record<string, unknown> = { ...existingModels };

  for (const modelId of modelIds) {
    if (models[modelId]) continue;
    models[modelId] = {
      id: modelId,
      name: formatOpenCodeProviderModelName(modelId),
      tool_call: true,
      temperature: true,
    };
  }

  const envVars = getOpenCodeCredentialEnvVars(provider.id, catalog);
  const existingEnv = Array.isArray(existingBlock.env)
    ? existingBlock.env.filter((value): value is string => typeof value === 'string')
    : undefined;
  const existingApiKey =
    typeof existingOptions.apiKey === 'string' && existingOptions.apiKey.trim()
      ? existingOptions.apiKey
      : undefined;

  return {
    ...existingBlock,
    name: provider.name || catalogProvider?.name || String(existingBlock.name || provider.id),
    env: mergeStringArrays(existingEnv, envVars),
    api: baseUrl,
    npm:
      typeof existingBlock.npm === 'string' && existingBlock.npm.trim()
        ? existingBlock.npm
        : '@ai-sdk/openai-compatible',
    options: {
      ...existingOptions,
      baseURL: baseUrl,
      apiKey: existingApiKey || `{env:${envVars[0]}}`,
    },
    models,
  };
}

function applyWebuiOpenCodeProviderConfig(
  config: Record<string, unknown>,
  userId?: string,
  storedProvidersOverride?: OpenCodeProvider[]
): void {
  if (!userId && !storedProvidersOverride) return;

  const catalog = getOpenCodeProviderCatalog();
  const storedProviders = (storedProvidersOverride || readOpenCodeProvidersForUser(userId!)).filter(
    (provider) => provider.enabled && (provider.baseUrl || catalog[provider.id]?.api)
  );
  if (storedProviders.length === 0) return;

  const providers = isRecord(config.provider) ? config.provider : {};

  for (const stored of storedProviders) {
    const block = buildWebuiOpenCodeProviderConfig(
      stored,
      catalog,
      isRecord(providers[stored.id]) ? (providers[stored.id] as Record<string, unknown>) : undefined
    );
    if (!block) continue;
    providers[stored.id] = block;
  }

  config.provider = providers;
}

export function resolveZaiVisionMcpPolicy(
  value: string | null | undefined = process.env.OPENCODE_ZAI_VISION_MCP
): ZaiVisionMcpPolicy {
  const normalized = (value || 'auto').trim().toLowerCase();
  if (['0', 'false', 'off', 'disable', 'disabled', 'none'].includes(normalized)) {
    return 'off';
  }
  if (['1', 'true', 'on', 'enable', 'enabled', 'always'].includes(normalized)) {
    return 'always';
  }
  return 'auto';
}

function isZaiCodingProvider(provider: OpenCodeProvider): boolean {
  const id = provider.id.trim().toLowerCase();
  return id === 'z-ai' || id === 'zai';
}

function hasEnabledZaiCodingProviderKey(providers: OpenCodeProvider[]): boolean {
  return providers.some(
    (provider) => provider.enabled !== false && isZaiCodingProvider(provider) && !!provider.apiKey
  );
}

function hasInheritedZaiVisionKey(env: Record<string, string | undefined>): boolean {
  return typeof env.Z_AI_API_KEY === 'string' && env.Z_AI_API_KEY.trim().length > 0;
}

function isManagedZaiVisionMcpEntry(entry: unknown): boolean {
  return isRecord(entry) && entry.webuiManaged === ZAI_VISION_MCP_MARKER;
}

function buildZaiVisionMcpEntry(): Record<string, unknown> {
  return {
    type: 'local',
    command: ['npx', '-y', '@z_ai/mcp-server@latest'],
    environment: {
      Z_AI_MODE: 'ZAI',
    },
    enabled: true,
    webuiManaged: ZAI_VISION_MCP_MARKER,
  };
}

export function applyZaiVisionMcpConfig(
  config: Record<string, unknown>,
  opts: {
    policy?: string | null;
    providers?: OpenCodeProvider[];
    inheritedEnv?: Record<string, string | undefined>;
  } = {}
): void {
  const policy = resolveZaiVisionMcpPolicy(opts.policy);
  const providersWereProvided = opts.providers !== undefined;
  const providers = opts.providers || [];
  const inheritedEnv = opts.inheritedEnv || process.env;
  const mcp = isRecord(config.mcp) ? config.mcp : {};
  const existing = mcp[ZAI_VISION_MCP_NAME];
  const existingIsManaged = isManagedZaiVisionMcpEntry(existing);

  if (policy === 'off') {
    if (existingIsManaged) delete mcp[ZAI_VISION_MCP_NAME];
    config.mcp = mcp;
    return;
  }

  const active =
    policy === 'always'
      ? hasEnabledZaiCodingProviderKey(providers) || hasInheritedZaiVisionKey(inheritedEnv)
      : hasEnabledZaiCodingProviderKey(providers);

  if (!active) {
    if (existingIsManaged && providersWereProvided) delete mcp[ZAI_VISION_MCP_NAME];
    config.mcp = mcp;
    return;
  }

  if (existing && !existingIsManaged) {
    config.mcp = mcp;
    return;
  }

  mcp[ZAI_VISION_MCP_NAME] = buildZaiVisionMcpEntry();
  config.mcp = mcp;
}

export function applyOpenCodePrimaryAgentConfig(config: Record<string, unknown>): void {
  const primaryAgentName = getOpenCodePrimaryAgent();
  if (!primaryAgentName) return;

  const agent = isRecord(config.agent) ? config.agent : {};
  const primaryAgent = isRecord(agent[primaryAgentName])
    ? (agent[primaryAgentName] as Record<string, unknown>)
    : {};

  if (typeof primaryAgent.description !== 'string' || primaryAgent.description.trim() === '') {
    primaryAgent.description = 'Primary Plum Code WebUI coding agent.';
  }
  if (typeof primaryAgent.mode !== 'string' || primaryAgent.mode.trim() === '') {
    primaryAgent.mode = 'primary';
  }

  const managedPrompt = getOpenCodeBuildAgentPrompt();
  const existingPrompt = typeof primaryAgent.prompt === 'string' ? primaryAgent.prompt : '';
  const hasManagedPrompt = isOpenCodeManagedBuildAgentPrompt(existingPrompt);
  if (managedPrompt) {
    if (!existingPrompt || hasManagedPrompt) {
      primaryAgent.prompt = managedPrompt;
    }
  } else if (hasManagedPrompt) {
    delete primaryAgent.prompt;
  }

  agent[primaryAgentName] = primaryAgent;
  config.agent = agent;
}

// Claude agents declare `tools: Read, Write, Edit` (CSV string). OpenCode
// expects a YAML record (`tools:\n  read: true\n  write: true`). Convert and
// filter to OpenCode's whitelist.
function toOpencodeAgent(claudeSource: string): string | null {
  const parsed = parseFrontmatter(claudeSource);
  if (!parsed) return null;

  const { fields, body } = parsed;
  const allowed = parseToolList(fields.tools)
    .map((tool) => OPENCODE_TOOL_MAP[tool])
    .filter((tool): tool is string => Boolean(tool));

  const description = fields.description || firstBodyLine(body) || fields.name || '';

  const lines: string[] = ['---'];
  if (fields.name) lines.push(`name: ${fields.name}`);
  lines.push(`description: ${description.replace(/"/g, '\\"')}`);
  lines.push('mode: subagent');
  if (allowed.length > 0) {
    lines.push('tools:');
    for (const tool of allowed) lines.push(`  ${tool}: true`);
  }
  lines.push('---');
  lines.push('');
  lines.push(body.trimStart());

  return lines.join('\n');
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function tomlArray(values: string[]): string {
  return `[${values.map(tomlString).join(', ')}]`;
}

function tomlInlineTable(values: Record<string, string>): string {
  const entries = Object.entries(values)
    .filter(([, value]) => typeof value === 'string')
    .map(([key, value]) => `${tomlString(key)} = ${tomlString(value)}`);
  return `{ ${entries.join(', ')} }`;
}

function toVibeAgent(
  fileName: string,
  claudeSource: string
): { agentFile: string; agentToml: string; promptFile: string; prompt: string } | null {
  const parsed = parseFrontmatter(claudeSource);
  if (!parsed) return null;

  const { fields, body } = parsed;
  const agentName = safeName(fields.name || fileName);
  const promptId = `webui-agent-${agentName}`;
  const rawTools = parseToolList(fields.tools);
  const enabledTools = Array.from(
    new Set(
      rawTools
        .map((tool) => VIBE_TOOL_MAP[tool])
        .filter((tool): tool is string => Boolean(tool))
        .concat('skill')
    )
  );
  const mutates = rawTools.some((tool) => ['Bash', 'Edit', 'Write'].includes(tool));
  const description = fields.description || firstBodyLine(body) || fields.name || agentName;
  const lines = [
    `display_name = ${tomlString(fields.name || titleFromName(agentName))}`,
    `description = ${tomlString(description)}`,
    `safety = ${tomlString(mutates ? 'destructive' : 'safe')}`,
    'agent_type = "subagent"',
    `system_prompt_id = ${tomlString(promptId)}`,
  ];
  if (enabledTools.length > 0) {
    lines.push(`enabled_tools = ${tomlArray(enabledTools)}`);
  }

  return {
    agentFile: `${agentName}.toml`,
    agentToml: `${lines.join('\n')}\n`,
    promptFile: `${promptId}.md`,
    prompt: body.trimStart(),
  };
}

export function syncOpencodeAgents(opts: { quiet?: boolean } = {}): {
  converted: number;
  skipped: number;
} {
  const srcDir = CLAUDE_AGENTS_DIR;
  const dstDir = OPENCODE_AGENTS_DIR;

  if (!fs.existsSync(srcDir)) return { converted: 0, skipped: 0 };

  // If the dst is a stale symlink from an earlier build, drop it so we can
  // write real files in its place.
  try {
    const st = fs.lstatSync(dstDir);
    if (st.isSymbolicLink()) fs.unlinkSync(dstDir);
  } catch {
    // doesn't exist
  }

  fs.mkdirSync(dstDir, { recursive: true });

  const entries = fs.readdirSync(srcDir).filter((f) => f.endsWith('.md'));
  let converted = 0;
  let skipped = 0;

  for (const file of entries) {
    try {
      const source = fs.readFileSync(path.join(srcDir, file), 'utf8');
      const output = toOpencodeAgent(source);
      if (!output) {
        skipped += 1;
        continue;
      }
      writeIfChanged(path.join(dstDir, file), output);
      converted += 1;
    } catch (err) {
      console.error(`[init] Failed to convert OpenCode agent ${file}:`, err);
      skipped += 1;
    }
  }

  // Prune dst files whose source no longer exists.
  const srcNames = new Set(entries);
  for (const existing of fs.readdirSync(dstDir)) {
    if (existing.endsWith('.md') && !srcNames.has(existing)) {
      try {
        fs.unlinkSync(path.join(dstDir, existing));
      } catch {
        /* ignore */
      }
    }
  }

  if (!opts.quiet) {
    console.log(`[init] OpenCode agents synced: ${converted} converted, ${skipped} skipped`);
  }
  return { converted, skipped };
}

export function syncVibeAgents(opts: { quiet?: boolean } = {}): {
  converted: number;
  skipped: number;
} {
  const srcDir = CLAUDE_AGENTS_DIR;
  if (!fs.existsSync(srcDir)) return { converted: 0, skipped: 0 };

  fs.mkdirSync(VIBE_AGENTS_DIR, { recursive: true });
  fs.mkdirSync(VIBE_PROMPTS_DIR, { recursive: true });

  const entries = fs.readdirSync(srcDir).filter((f) => f.endsWith('.md'));
  const agentNames = new Set<string>();
  const promptNames = new Set<string>();
  let converted = 0;
  let skipped = 0;

  for (const file of entries) {
    try {
      const source = fs.readFileSync(path.join(srcDir, file), 'utf8');
      const output = toVibeAgent(file, source);
      if (!output) {
        skipped += 1;
        continue;
      }
      writeIfChanged(path.join(VIBE_AGENTS_DIR, output.agentFile), output.agentToml);
      writeIfChanged(path.join(VIBE_PROMPTS_DIR, output.promptFile), output.prompt);
      agentNames.add(output.agentFile);
      promptNames.add(output.promptFile);
      converted += 1;
    } catch (err) {
      console.error(`[init] Failed to convert Vibe agent ${file}:`, err);
      skipped += 1;
    }
  }

  for (const [dir, names, suffix] of [
    [VIBE_AGENTS_DIR, agentNames, '.toml'],
    [VIBE_PROMPTS_DIR, promptNames, '.md'],
  ] as const) {
    for (const existing of fs.readdirSync(dir)) {
      if (existing.startsWith('webui-agent-') || existing.endsWith(suffix)) {
        if (!names.has(existing) && existing.startsWith('webui-agent-')) {
          try {
            fs.unlinkSync(path.join(dir, existing));
          } catch {
            /* ignore */
          }
        }
      }
    }
  }

  if (!opts.quiet) {
    console.log(`[init] Vibe agents synced: ${converted} converted, ${skipped} skipped`);
  }
  return { converted, skipped };
}

function toOpenCodeMcpConfig(server: ClaudeMcpServer): Record<string, unknown> | null {
  if (server.url) {
    const entry: Record<string, unknown> = {
      type: 'remote',
      url: server.url,
      enabled: true,
    };
    if (server.headers && Object.keys(server.headers).length > 0) {
      entry.headers = server.headers;
    }
    return entry;
  }
  if (server.command) {
    const entry: Record<string, unknown> = {
      type: 'local',
      command: [server.command, ...(server.args || [])],
      enabled: true,
    };
    if (server.env && Object.keys(server.env).length > 0) {
      entry.environment = server.env;
    }
    return entry;
  }
  return null;
}

export function syncOpenCodeConfig(
  opts: {
    quiet?: boolean;
    claudeSettingsPath?: string;
    userId?: string;
  } = {}
): { updated: boolean; mcpCount: number } {
  const config = readJsonObject(OPENCODE_CONFIG_PATH);
  if (!config.$schema) {
    config.$schema = 'https://opencode.ai/config.json';
  }

  const skills = isRecord(config.skills) ? config.skills : {};
  const paths = Array.isArray(skills.paths)
    ? skills.paths.filter((value): value is string => typeof value === 'string')
    : [];
  if (!paths.includes(CLAUDE_SKILLS_DIR)) paths.push(CLAUDE_SKILLS_DIR);
  skills.paths = paths;
  config.skills = skills;

  const mcp = isRecord(config.mcp) ? config.mcp : {};
  let mcpCount = 0;
  for (const [name, server] of Object.entries(getClaudeMcpServers(opts.claudeSettingsPath))) {
    const entry = toOpenCodeMcpConfig(server);
    if (!entry) continue;
    mcp[name] = entry;
    mcpCount += 1;
  }
  config.mcp = mcp;
  const storedProviders = opts.userId ? readOpenCodeProvidersForUser(opts.userId) : undefined;
  applyZaiVisionMcpConfig(config, storedProviders ? { providers: storedProviders } : undefined);
  applyOpenCodePrimaryAgentConfig(config);
  applyWebuiOpenCodeProviderConfig(config, opts.userId, storedProviders);

  const next = `${JSON.stringify(config, null, 2)}\n`;
  const updated = writeIfChanged(OPENCODE_CONFIG_PATH, next);
  if (!opts.quiet) {
    console.log(
      `[init] OpenCode config synced: ${mcpCount} MCP servers, skills path ${updated ? 'updated' : 'ok'}`
    );
  }
  return { updated, mcpCount };
}

function renderVibeMcpServers(servers: Record<string, ClaudeMcpServer>): string {
  const blocks: string[] = [];
  for (const [name, server] of Object.entries(servers)) {
    const lines: string[] = ['[[mcp_servers]]', `name = ${tomlString(name)}`];
    if (server.url) {
      lines.push('transport = "http"');
      lines.push(`url = ${tomlString(server.url)}`);
      if (server.headers && Object.keys(server.headers).length > 0) {
        lines.push(`headers = ${tomlInlineTable(server.headers)}`);
      }
    } else if (server.command) {
      lines.push('transport = "stdio"');
      lines.push(`command = ${tomlString(server.command)}`);
      lines.push(`args = ${tomlArray(server.args || [])}`);
      if (server.env && Object.keys(server.env).length > 0) {
        lines.push(`env = ${tomlInlineTable(server.env)}`);
      }
    } else {
      continue;
    }
    blocks.push(lines.join('\n'));
  }
  return blocks.join('\n\n');
}

function replaceOrAddTopLevelArray(raw: string, key: string, values: string[]): string {
  const line = `${key} = ${tomlArray(values)}`;
  const re = new RegExp(`^\\s*${key}\\s*=\\s*\\[[^\\n]*\\]\\s*$`, 'm');
  if (re.test(raw)) return raw.replace(re, line);

  const firstTable = raw.search(/^\s*\[/m);
  if (firstTable === -1) return `${raw.trimEnd()}\n${line}\n`;
  return `${raw.slice(0, firstTable).trimEnd()}\n${line}\n\n${raw.slice(firstTable).trimStart()}`;
}

function findMatchingBracket(source: string, openIndex: number): number {
  let inString = false;
  let escaped = false;
  let depth = 0;
  for (let i = openIndex; i < source.length; i += 1) {
    const char = source[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === '[') depth += 1;
    if (char === ']') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function replaceOrAddVibeTaskAllowlist(raw: string, values: string[]): string {
  const allowlistLine = `allowlist = ${tomlArray(values)}`;
  const header = raw.match(/^\s*\[tools\.task\]\s*$/m);
  if (!header || header.index === undefined) {
    return `${raw.trimEnd()}\n\n[tools.task]\npermission = "ask"\n${allowlistLine}\ndenylist = []\nsensitive_patterns = []\n`;
  }

  const start = header.index;
  const headerEnd = start + header[0].length;
  const rest = raw.slice(headerEnd);
  const nextTableRel = rest.search(/\n\s*\[/);
  const end = nextTableRel === -1 ? raw.length : headerEnd + nextTableRel;
  const block = raw.slice(start, end);
  const allowMatch = block.match(/^\s*allowlist\s*=\s*\[/m);

  if (!allowMatch || allowMatch.index === undefined) {
    const insertAt = start + block.indexOf('\n') + 1;
    return `${raw.slice(0, insertAt)}${allowlistLine}\n${raw.slice(insertAt)}`;
  }

  const allowStart = start + allowMatch.index;
  const openIndex = raw.indexOf('[', allowStart);
  const closeIndex = findMatchingBracket(raw, openIndex);
  if (closeIndex === -1) return raw;
  const lineEnd = raw.indexOf('\n', closeIndex);
  const replaceEnd = lineEnd === -1 ? closeIndex + 1 : lineEnd + 1;
  return `${raw.slice(0, allowStart)}${allowlistLine}\n${raw.slice(replaceEnd)}`;
}

export function applyVibeProviderLinks(
  raw: string,
  opts: { claudeSettingsPath?: string } = {}
): { content: string; mcpCount: number } {
  let next = raw || '';
  const startIdx = next.indexOf(VIBE_MANAGED_BLOCK_START);
  const endIdx = next.indexOf(VIBE_MANAGED_BLOCK_END);
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    next = `${next.slice(0, startIdx).trimEnd()}\n${next
      .slice(endIdx + VIBE_MANAGED_BLOCK_END.length)
      .trimStart()}`;
  }

  // Vibe defaults ship with `mcp_servers = []`, which conflicts with
  // `[[mcp_servers]]` array tables. Drop only that empty top-level assignment.
  next = next.replace(/^\s*mcp_servers\s*=\s*\[\]\s*$/m, '');
  next = replaceOrAddTopLevelArray(next, 'skill_paths', [CLAUDE_SKILLS_DIR]);
  next = replaceOrAddTopLevelArray(next, 'agent_paths', [VIBE_AGENTS_DIR]);
  next = replaceOrAddVibeTaskAllowlist(next, getVibeTaskAllowlist());

  const servers = getClaudeMcpServers(opts.claudeSettingsPath);
  const renderedServers = renderVibeMcpServers(servers);
  const sections = [
    VIBE_MANAGED_BLOCK_START,
    '# Managed by plum-code-webui. Custom Vibe config outside this block is preserved.',
    renderedServers,
    VIBE_MANAGED_BLOCK_END,
  ].filter((section) => section.trim().length > 0);
  next = `${next.trimEnd()}\n\n${sections.join('\n')}\n`;
  return { content: next, mcpCount: Object.keys(servers).length };
}

export function syncVibeConfig(
  opts: {
    quiet?: boolean;
    claudeSettingsPath?: string;
  } = {}
): { updated: boolean; mcpCount: number } {
  let raw = '';
  try {
    raw = fs.readFileSync(VIBE_CONFIG_PATH, 'utf8');
  } catch {
    raw = '';
  }
  const { content, mcpCount } = applyVibeProviderLinks(raw, opts);
  const updated = writeIfChanged(VIBE_CONFIG_PATH, content);
  if (!opts.quiet) {
    console.log(`[init] Vibe config synced: ${mcpCount} MCP servers ${updated ? 'updated' : 'ok'}`);
  }
  return { updated, mcpCount };
}

export function syncProviderLinks(opts: { quiet?: boolean } = {}): ProviderLinksSyncResult {
  const opencodeAgents = syncOpencodeAgents({ quiet: true });
  const vibeAgents = syncVibeAgents({ quiet: true });
  const opencodeConfig = syncOpenCodeConfig({ quiet: true });
  const vibeConfig = syncVibeConfig({ quiet: true });

  if (!opts.quiet) {
    console.log(
      `[init] Provider links synced: OpenCode agents ${opencodeAgents.converted}/${opencodeAgents.skipped}, ` +
        `Vibe agents ${vibeAgents.converted}/${vibeAgents.skipped}, ` +
        `MCP OpenCode=${opencodeConfig.mcpCount}, Vibe=${vibeConfig.mcpCount}`
    );
  }

  return { opencodeAgents, vibeAgents, opencodeConfig, vibeConfig };
}
