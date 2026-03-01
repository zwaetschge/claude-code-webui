/**
 * CLI Provider Abstraction
 *
 * Supports multiple AI CLI tools:
 * - Claude Code CLI (claude) - Anthropic
 * - Codex CLI (codex) - OpenAI
 * - Gemini CLI (gemini) - Google
 * - Kimi CLI (kimi) - Moonshot AI
 */

import os from 'os';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import type { SessionMode } from '@claude-code-webui/shared';

export type CLIProvider = 'claude' | 'codex' | 'gemini' | 'glm' | 'kimi' | 'multi';

export interface CLIProviderConfig {
  id: CLIProvider;
  name: string;
  command: string;
  icon: string;
  credentialsPath: string;
  supportsStreamJson: boolean;
  supportsResume: boolean;
  supportsModes: boolean;
  defaultModel?: string;
  models?: string[];
}

const DEFAULT_ALLOWED_TOOLS = [
  'Bash',
  'Read',
  'Write',
  'Edit',
  'Glob',
  'Grep',
  'WebFetch',
  'WebSearch',
  'Task',
  'TodoWrite',
  'ExitPlanMode',
  'AskUserQuestion',
];

const GLM_PLANNING_ALLOWED_TOOLS = [
  'TodoWrite',
  'ExitPlanMode',
];

// Fallback models - used when CLI discovery fails or CLI not installed
// Can be overridden via CLI_PROVIDER_<PROVIDER>_MODELS env var
const CLI_PROVIDER_MODELS: Record<CLIProvider, string[]> = {
  claude: ['opus', 'sonnet', 'haiku'],
  codex: ['gpt-5.2-codex', 'gpt-5.3-codex', 'gpt-5.1-codex-max', 'gpt-5.2', 'gpt-5.1-codex-mini'],
  gemini: ['auto', 'pro', 'flash', 'gemini-2.5-pro', 'gemini-2.5-flash'],
  glm: ['glm-5', 'glm-4.7', 'glm-4.5'],
  kimi: ['kimi-for-coding'],
  multi: ['orchestrated'],
};

// Display labels — enhanced at startup by CLI discovery
const MODEL_DISPLAY_LABELS: Record<string, string> = {
  // Claude (aliases resolve server-side to latest version)
  opus: 'Opus 4.6', sonnet: 'Sonnet 4.5', haiku: 'Haiku 4.5',
  // Codex
  'gpt-5.3-codex': 'GPT 5.3 Codex', 'gpt-5.2-codex': 'GPT 5.2 Codex', 'gpt-5.2': 'GPT 5.2',
  'gpt-5.1-codex-max': 'GPT 5.1 Codex Max', 'gpt-5.1-codex': 'GPT 5.1 Codex',
  'gpt-5.1-codex-mini': 'GPT 5.1 Codex Mini', 'gpt-5.1': 'GPT 5.1',
  'gpt-5-codex': 'GPT 5 Codex', 'gpt-5': 'GPT 5', 'gpt-5-codex-mini': 'GPT 5 Codex Mini',
  // Gemini aliases
  auto: 'Auto', pro: 'Pro', flash: 'Flash', 'flash-lite': 'Flash Lite',
  // Gemini explicit
  'gemini-2.5-pro': '2.5 Pro', 'gemini-2.5-flash': '2.5 Flash', 'gemini-2.5-flash-lite': '2.5 Flash Lite',
  'gemini-3-pro-preview': '3 Pro (preview)', 'gemini-3-flash-preview': '3 Flash (preview)',
  'gemini-3.1-pro-preview': '3.1 Pro (preview)', 'gemini-3.1-pro-preview-customtools': '3.1 Pro Custom Tools (preview)',
  'auto-gemini-2.5': 'Auto (2.5)', 'auto-gemini-3': 'Auto (3)',
  // GLM
  'glm-5': 'GLM 5', 'glm-4.7': 'GLM 4.7', 'glm-4.5': 'GLM 4.5',
  // Kimi (Moonshot AI)
  'kimi-for-coding': 'Kimi for Coding (K2.5)',
};

// ── CLI Model Discovery ──────────────────────────────────────────────

/**
 * Find a CLI binary's real path.
 */
function findCliBinary(command: string): string | null {
  try {
    const p = execSync(`which ${command} 2>/dev/null`, { encoding: 'utf-8' }).trim();
    return p ? fs.realpathSync(p) : null;
  } catch { return null; }
}

/**
 * Read a file relative to a CLI binary's install directory.
 * Searches both the binary dir and the typical npm global layout.
 */
function readCliFile(binaryPath: string, ...segments: string[]): string | null {
  const cliDir = path.dirname(binaryPath);
  // Try relative to binary dir
  const direct = path.join(cliDir, ...segments);
  if (fs.existsSync(direct)) return fs.readFileSync(direct, 'utf-8');
  // Try npm global layout: <prefix>/lib/node_modules/<pkg>/...
  const npmGlobal = path.join(cliDir, '..', 'lib', 'node_modules', ...segments);
  if (fs.existsSync(npmGlobal)) return fs.readFileSync(npmGlobal, 'utf-8');
  return null;
}

/**
 * Claude: Enhance alias labels by resolving what each alias points to.
 */
function discoverClaude(): void {
  try {
    const bin = findCliBinary('claude');
    if (!bin) return;
    const source = readCliFile(bin, 'cli.js')
      ?? readCliFile(bin, '@anthropic-ai', 'claude-code', 'cli.js');
    if (!source) return;

    // Try v2.1.34+ format: {opus:"claude-opus-4-6",sonnet:...}
    // and v2.1.29 format: firstParty:"claude-opus-4-5-20251101" with separate alias function
    // Strategy: find the latest firstParty model per family
    const families: Record<string, string[]> = { opus: [], sonnet: [], haiku: [] };
    const fpRe = /firstParty:"(claude-(opus|sonnet|haiku)-[^"]+)"/g;
    let fpMatch;
    while ((fpMatch = fpRe.exec(source)) !== null) {
      if (fpMatch[1] && fpMatch[2] && families[fpMatch[2]]) {
        families[fpMatch[2]]!.push(fpMatch[1]);
      }
    }

    // Also try direct alias map format (v2.1.34+): {opus:"claude-opus-4-6",...}
    for (const alias of ['opus', 'sonnet', 'haiku']) {
      const directRe = new RegExp(`${alias}:"(claude-${alias}-[a-z0-9-]+)"`);
      const dm = directRe.exec(source);
      if (dm?.[1] && !families[alias]!.includes(dm[1])) {
        families[alias]!.push(dm[1]);
      }
    }

    for (const [alias, modelIds] of Object.entries(families)) {
      if (modelIds.length === 0) continue;
      // Sort descending → newest model first
      modelIds.sort().reverse();
      const latest = modelIds[0]!;
      const stripped = latest.replace(/^claude-(?:opus|sonnet|haiku)-/, '');
      const version = stripped.replace(/-\d{8}$/, '').split('-').join('.');
      const family = alias.charAt(0).toUpperCase() + alias.slice(1);
      const newLabel = `${family} ${version}`;
      // Only update if discovered version is newer than hardcoded
      // (aliases resolve server-side, so the CLI bundle may lag behind)
      const currentVersion = MODEL_DISPLAY_LABELS[alias]?.match(/(\d+(?:\.\d+)*)/)?.[1] || '0';
      if (version >= currentVersion) {
        MODEL_DISPLAY_LABELS[alias] = newLabel;
      }
      console.log(`[CLI-PROVIDERS] claude: ${alias} → ${latest} (label: ${MODEL_DISPLAY_LABELS[alias]})`);
    }
  } catch { /* keep defaults */ }
}

/**
 * Gemini: Read models.js from gemini-cli-core to discover all available models.
 */
function discoverGemini(): void {
  try {
    const bin = findCliBinary('gemini');
    if (!bin) return;

    // Find gemini-cli-core models.js — typical path under the gemini-cli package
    const cliDir = path.dirname(bin);
    const searchRoots = [
      path.join(cliDir, '..', 'lib', 'node_modules', '@google', 'gemini-cli'),
      path.join(cliDir, '..'),
    ];

    let modelsSource = '';
    for (const root of searchRoots) {
      // Direct path
      const direct = path.join(root, 'node_modules', '@google', 'gemini-cli-core', 'dist', 'src', 'config', 'models.js');
      if (fs.existsSync(direct)) { modelsSource = fs.readFileSync(direct, 'utf-8'); break; }
      // Also try without node_modules nesting
      const flat = path.join(root, 'dist', 'src', 'config', 'models.js');
      if (fs.existsSync(flat)) { modelsSource = fs.readFileSync(flat, 'utf-8'); break; }
    }
    if (!modelsSource) return;

    // Extract constants:  export const X = 'value';
    const constants: Record<string, string> = {};
    const constRe = /export\s+const\s+(\w+)\s*=\s*'([^']+)'/g;
    let cm;
    while ((cm = constRe.exec(modelsSource)) !== null) {
      if (cm[1] && cm[2]) constants[cm[1]] = cm[2];
    }

    const models: string[] = [];
    const addModel = (id: string, label: string) => {
      if (id && !models.includes(id)) {
        models.push(id);
        MODEL_DISPLAY_LABELS[id] = label;
      }
    };

    // Aliases first (short names the CLI accepts)
    if (constants['GEMINI_MODEL_ALIAS_AUTO']) addModel(constants['GEMINI_MODEL_ALIAS_AUTO'], 'Auto');
    if (constants['GEMINI_MODEL_ALIAS_PRO']) addModel(constants['GEMINI_MODEL_ALIAS_PRO'], 'Pro');
    if (constants['GEMINI_MODEL_ALIAS_FLASH']) addModel(constants['GEMINI_MODEL_ALIAS_FLASH'], 'Flash');
    if (constants['GEMINI_MODEL_ALIAS_FLASH_LITE']) addModel(constants['GEMINI_MODEL_ALIAS_FLASH_LITE'], 'Flash Lite');

    // Auto modes
    if (constants['DEFAULT_GEMINI_MODEL_AUTO']) addModel(constants['DEFAULT_GEMINI_MODEL_AUTO'], `Auto (${constants['DEFAULT_GEMINI_MODEL_AUTO'].replace('auto-', '')})`);
    if (constants['PREVIEW_GEMINI_MODEL_AUTO']) addModel(constants['PREVIEW_GEMINI_MODEL_AUTO'], `Auto (${constants['PREVIEW_GEMINI_MODEL_AUTO'].replace('auto-', '')})`);

    // Explicit models
    if (constants['DEFAULT_GEMINI_MODEL']) addModel(constants['DEFAULT_GEMINI_MODEL'], formatGeminiLabel(constants['DEFAULT_GEMINI_MODEL']));
    if (constants['DEFAULT_GEMINI_FLASH_MODEL']) addModel(constants['DEFAULT_GEMINI_FLASH_MODEL'], formatGeminiLabel(constants['DEFAULT_GEMINI_FLASH_MODEL']));
    if (constants['DEFAULT_GEMINI_FLASH_LITE_MODEL']) addModel(constants['DEFAULT_GEMINI_FLASH_LITE_MODEL'], formatGeminiLabel(constants['DEFAULT_GEMINI_FLASH_LITE_MODEL']));
    if (constants['PREVIEW_GEMINI_MODEL']) addModel(constants['PREVIEW_GEMINI_MODEL'], formatGeminiLabel(constants['PREVIEW_GEMINI_MODEL']) + ' (preview)');
    if (constants['PREVIEW_GEMINI_FLASH_MODEL']) addModel(constants['PREVIEW_GEMINI_FLASH_MODEL'], formatGeminiLabel(constants['PREVIEW_GEMINI_FLASH_MODEL']) + ' (preview)');
    if (constants['PREVIEW_GEMINI_3_1_MODEL']) addModel(constants['PREVIEW_GEMINI_3_1_MODEL'], formatGeminiLabel(constants['PREVIEW_GEMINI_3_1_MODEL']) + ' (preview)');
    if (constants['PREVIEW_GEMINI_3_1_CUSTOM_TOOLS_MODEL']) addModel(constants['PREVIEW_GEMINI_3_1_CUSTOM_TOOLS_MODEL'], formatGeminiLabel(constants['PREVIEW_GEMINI_3_1_CUSTOM_TOOLS_MODEL']) + ' (preview)');

    if (models.length > 0) {
      discoveredModels.gemini = models;
      console.log(`[CLI-PROVIDERS] gemini: discovered ${models.length} models:`, models);
    }
  } catch { /* keep defaults */ }
}

function formatGeminiLabel(modelId: string): string {
  // "gemini-2.5-pro" → "2.5 Pro", "gemini-3-flash-preview" → "3 Flash"
  return modelId
    .replace(/^gemini-/, '')
    .replace(/-preview$/, '')
    .split('-')
    .map(p => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}

/**
 * Codex: Discover models from the CLI's models_cache.json.
 * The Codex CLI maintains this cache by fetching from the OpenAI API.
 * Falls back to extracting model strings from the Rust binary.
 */
function discoverCodex(): void {
  try {
    // Try models_cache.json first (maintained by Codex CLI from OpenAI API)
    const credPath = CLI_PROVIDERS.codex.credentialsPath.replace('~', os.homedir());
    const cachePath = path.join(credPath, 'models_cache.json');

    if (fs.existsSync(cachePath)) {
      const raw = fs.readFileSync(cachePath, 'utf-8');
      const cache = JSON.parse(raw) as {
        fetched_at?: string;
        models?: Array<{
          slug: string;
          display_name: string;
          visibility?: string;
          priority?: number;
        }>;
      };

      if (cache.models && cache.models.length > 0) {
        // Sort by priority (lower = more important), filter to visible models
        const sorted = cache.models
          .filter(m => m.visibility === 'list')
          .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999));

        if (sorted.length > 0) {
          const modelIds = sorted.map(m => m.slug);
          discoveredModels.codex = modelIds;

          for (const m of sorted) {
            MODEL_DISPLAY_LABELS[m.slug] = formatCodexLabel(m.slug);
          }

          const age = cache.fetched_at
            ? Math.round((Date.now() - new Date(cache.fetched_at).getTime()) / 3600000) + 'h ago'
            : 'unknown';
          console.log(`[CLI-PROVIDERS] codex: discovered ${modelIds.length} models from cache (${age}):`, modelIds);
          return;
        }
      }
    }

    // Fallback: extract model strings from the Rust binary
    discoverCodexFromBinary();
  } catch { /* keep defaults */ }
}

/**
 * Fallback: Extract model IDs from the compiled Codex Rust binary using `strings`.
 */
function discoverCodexFromBinary(): void {
  try {
    const bin = findCliBinary('codex');
    if (!bin) return;

    const cliDir = path.dirname(bin);
    const platform = os.platform();
    const arch = os.arch();
    let triple = '';
    if (platform === 'linux' && arch === 'x64') triple = 'x86_64-unknown-linux-musl';
    else if (platform === 'linux' && arch === 'arm64') triple = 'aarch64-unknown-linux-musl';
    else if (platform === 'darwin' && arch === 'x64') triple = 'x86_64-apple-darwin';
    else if (platform === 'darwin' && arch === 'arm64') triple = 'aarch64-apple-darwin';

    if (!triple) return;

    const binaryPaths = [
      path.join(cliDir, '..', 'vendor', triple, 'codex', 'codex'),
      path.join(cliDir, '..', 'lib', 'node_modules', '@openai', 'codex', 'vendor', triple, 'codex', 'codex'),
    ];

    let binaryPath = '';
    for (const p of binaryPaths) {
      try {
        const stat = fs.statSync(p);
        if (stat.size > 0) { binaryPath = p; break; }
      } catch { /* next */ }
    }
    if (!binaryPath) return;

    const output = execSync(`strings "${binaryPath}" 2>/dev/null`, { encoding: 'utf-8', maxBuffer: 200 * 1024 * 1024 });
    const models = new Set<string>();

    const patterns = [
      /^(gpt-[0-9][.0-9]*(?:-[a-z0-9]+)*)$/gm,
      /^(o[0-9](?:-[a-z0-9]+)*)$/gm,
      /^(codex-[a-z0-9-]+)$/gm,
      /^(chatgpt-[a-z0-9-]+)$/gm,
    ];
    for (const re of patterns) {
      let m;
      while ((m = re.exec(output)) !== null) {
        if (m[1]) models.add(m[1]);
      }
    }

    if (models.size > 0) {
      const sorted = [...models].sort();
      discoveredModels.codex = sorted;
      for (const id of sorted) {
        if (!MODEL_DISPLAY_LABELS[id]) {
          MODEL_DISPLAY_LABELS[id] = formatCodexLabel(id);
        }
      }
      console.log(`[CLI-PROVIDERS] codex: discovered ${sorted.length} models from binary:`, sorted);
    }
  } catch { /* keep defaults */ }
}

function formatCodexLabel(modelId: string): string {
  // "o4-mini" → "o4 mini", "gpt-4.1" → "GPT 4.1"
  if (modelId.startsWith('gpt-')) {
    return modelId.replace('gpt-', 'GPT ').replace(/-/g, ' ');
  }
  return modelId.replace(/-/g, ' ');
}

// ── Discovery Cache ──────────────────────────────────────────────────

const discoveredModels: Partial<Record<CLIProvider, string[]>> = {};
let discoveryDone = false;

function ensureDiscovery(): void {
  if (discoveryDone) return;
  discoveryDone = true;
  discoverClaude();
  discoverGemini();
  discoverCodex();
}

/**
 * Reset discovery cache so models are re-read on next access.
 * Call after CLI updates or manual cache refresh.
 */
export function resetDiscovery(): void {
  discoveryDone = false;
  delete discoveredModels.claude;
  delete discoveredModels.codex;
  delete discoveredModels.gemini;
  delete discoveredModels.glm;
  delete discoveredModels.kimi;
}

/**
 * Refresh the Codex models cache by running a minimal Codex session.
 * The Codex CLI fetches from the OpenAI API on startup.
 */
export async function refreshCodexModelsCache(): Promise<boolean> {
  try {
    const bin = findCliBinary('codex');
    if (!bin) return false;

    const credPath = CLI_PROVIDERS.codex.credentialsPath.replace('~', os.homedir());
    const cachePath = path.join(credPath, 'models_cache.json');
    const beforeMtime = fs.existsSync(cachePath) ? fs.statSync(cachePath).mtimeMs : 0;

    // Run a minimal exec that triggers model cache refresh on startup
    execSync('cd /app && codex exec --json --skip-git-repo-check --model gpt-5.2-codex "say OK" 2>/dev/null', {
      encoding: 'utf-8',
      timeout: 30000,
    });

    const afterMtime = fs.existsSync(cachePath) ? fs.statSync(cachePath).mtimeMs : 0;
    if (afterMtime > beforeMtime) {
      resetDiscovery();
      console.log('[CLI-PROVIDERS] Codex models cache refreshed');
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function getDiscoveredModels(provider: CLIProvider): string[] {
  ensureDiscovery();
  return discoveredModels[provider] ?? CLI_PROVIDER_MODELS[provider];
}

function parseEnvModels(provider: CLIProvider): string[] | undefined {
  const raw = getProviderEnv(provider, 'MODELS');
  if (!raw) return undefined;
  const models = raw
    .split(',')
    .map((model) => model.trim())
    .filter((model) => model.length > 0);
  return models.length > 0 ? models : undefined;
}

function getProviderEnv(provider: CLIProvider, key: string): string | undefined {
  const envKey = `CLI_PROVIDER_${provider.toUpperCase()}_${key}`;
  return process.env[envKey];
}

function envOr(provider: CLIProvider, key: string, fallback: string): string {
  return getProviderEnv(provider, key) || fallback;
}

const glmPrefix = getProviderEnv('glm', 'PREFIX') || path.join(os.homedir(), '.npm-glm');

export const CLI_PROVIDERS: Record<CLIProvider, CLIProviderConfig> = {
  claude: {
    id: 'claude',
    name: 'Claude Code',
    command: envOr('claude', 'COMMAND', 'claude'),
    icon: '🟠',
    credentialsPath: envOr('claude', 'CREDENTIALS_PATH', '~/.claude'),
    supportsStreamJson: true,
    supportsResume: true,
    supportsModes: true,
    defaultModel: getProviderEnv('claude', 'DEFAULT_MODEL') || 'sonnet',
    models: parseEnvModels('claude') ?? CLI_PROVIDER_MODELS.claude,
  },
  codex: {
    id: 'codex',
    name: 'Codex',
    command: envOr('codex', 'COMMAND', 'codex'),
    icon: '🟢',
    credentialsPath: envOr('codex', 'CREDENTIALS_PATH', '~/.codex'),
    supportsStreamJson: false,
    supportsResume: false,
    supportsModes: true,
    defaultModel: getProviderEnv('codex', 'DEFAULT_MODEL') || 'gpt-5.2-codex',
    models: parseEnvModels('codex') ?? CLI_PROVIDER_MODELS.codex,
  },
  gemini: {
    id: 'gemini',
    name: 'Gemini CLI',
    command: envOr('gemini', 'COMMAND', 'gemini'),
    icon: '🔵',
    credentialsPath: envOr('gemini', 'CREDENTIALS_PATH', '~/.gemini'),
    supportsStreamJson: true,
    supportsResume: true,
    supportsModes: true,
    defaultModel: getProviderEnv('gemini', 'DEFAULT_MODEL') || 'auto',
    models: parseEnvModels('gemini') ?? CLI_PROVIDER_MODELS.gemini,
  },
  glm: {
    id: 'glm',
    name: 'Z.AI',
    command: envOr('glm', 'COMMAND', path.join(glmPrefix, 'bin', 'claude')),
    icon: '🔷',
    credentialsPath: envOr('glm', 'CREDENTIALS_PATH', '~/.glm'),
    supportsStreamJson: true,
    supportsResume: true,
    supportsModes: true,
    defaultModel: getProviderEnv('glm', 'DEFAULT_MODEL') || 'glm-4.7',
    models: parseEnvModels('glm') ?? CLI_PROVIDER_MODELS.glm,
  },
  kimi: {
    id: 'kimi',
    name: 'Kimi',
    command: envOr('kimi', 'COMMAND', 'kimi'),
    icon: '🌑',
    credentialsPath: envOr('kimi', 'CREDENTIALS_PATH', '~/.kimi'),
    supportsStreamJson: true,
    supportsResume: true,
    supportsModes: true,
    defaultModel: getProviderEnv('kimi', 'DEFAULT_MODEL') || 'kimi-for-coding',
    models: parseEnvModels('kimi') ?? CLI_PROVIDER_MODELS.kimi,
  },
  multi: {
    id: 'multi',
    name: 'Multi-CLI',
    command: envOr('claude', 'COMMAND', 'claude'), // Uses Claude as default master
    icon: '🎭',
    credentialsPath: envOr('claude', 'CREDENTIALS_PATH', '~/.claude'),
    supportsStreamJson: true,
    supportsResume: true,
    supportsModes: true,
    defaultModel: 'orchestrated',
    models: CLI_PROVIDER_MODELS.multi,
  },
  // Note: Mistral Vibe 2.0+ removed - does not support programmatic/headless mode
};

/**
 * Get CLI arguments for a provider
 */
export function getCLIArgs(
  provider: CLIProvider,
  options: {
    mode?: SessionMode;
    resumeSessionId?: string;
    allowedDirectories?: string[];
    workingDirectory?: string;
    allowedTools?: string[];
    model?: string;
    reasoningLevel?: string;
  }
): string[] {
  const config = CLI_PROVIDERS[provider];
  const args: string[] = [];

  switch (provider) {
    case 'claude':
      // Claude Code CLI arguments
      args.push(
        '--print',
        '--verbose',
        '--output-format', 'stream-json',
        '--input-format', 'stream-json',
        '--include-partial-messages'
      );

      // Permission mode
      if (options.mode && config.supportsModes) {
        args.push(...getClaudePermissionFlags(options.mode));
      }

      // Resume session
      if (options.resumeSessionId && config.supportsResume) {
        args.push('--resume', options.resumeSessionId);
      }

      // Allowed directories
      if (options.allowedDirectories) {
        for (const dir of options.allowedDirectories) {
          args.push('--add-dir', dir);
        }
      }
      break;

    case 'codex':
      // Codex CLI arguments (non-interactive JSONL output)
      args.push('exec', '--json');

      const codexApprovalArgs = getCodexApprovalArgs(options.mode);
      args.push(...codexApprovalArgs);

      if (options.model) {
        args.push('--model', options.model);
      }

      if (options.reasoningLevel) {
        args.push('-c', `reasoning_level=${options.reasoningLevel}`);
      }

      if (options.workingDirectory) {
        args.push('--cd', options.workingDirectory);
        args.push('--skip-git-repo-check');
      }

      if (options.allowedDirectories) {
        for (const dir of options.allowedDirectories) {
          args.push('--add-dir', dir);
        }
      }
      break;

    case 'gemini':
      // Gemini CLI arguments
      // -p flag is required for non-interactive (headless) mode
      args.push('--output-format', 'stream-json');

      {
        const geminiApprovalMode = getGeminiApprovalMode(options.mode);
        if (geminiApprovalMode) {
          args.push('--approval-mode', geminiApprovalMode);
        }
      }

      if (options.model) {
        args.push('--model', options.model);
      }

      // Resume session
      if (options.resumeSessionId && config.supportsResume) {
        args.push('--resume', options.resumeSessionId);
      }

      if (options.allowedDirectories) {
        for (const dir of options.allowedDirectories) {
          args.push('--include-directories', dir);
        }
      }
      break;

    case 'glm':
      // Z.AI GLM CLI arguments (similar to Claude)
      args.push(
        '--print',
        '--verbose',
        '--output-format', 'stream-json',
        '--input-format', 'stream-json',
        '--include-partial-messages'
      );

      if (options.model) {
        args.push('--model', options.model);
      }

      // Permission mode
      if (options.mode && config.supportsModes) {
        args.push(...getClaudePermissionFlags(options.mode));
      }

      const allowedTools = options.allowedTools && options.allowedTools.length > 0
        ? options.allowedTools
        : options.mode === 'auto-accept'
          ? DEFAULT_ALLOWED_TOOLS
          : options.mode === 'planning'
            ? GLM_PLANNING_ALLOWED_TOOLS
            : [];
      if (allowedTools.length > 0) {
        for (const toolName of allowedTools) {
          args.push('--allowedTools', toolName);
        }
      }

      // Resume session
      if (options.resumeSessionId && config.supportsResume) {
        args.push('--resume', options.resumeSessionId);
      }

      // Allowed directories
      if (options.allowedDirectories) {
        for (const dir of options.allowedDirectories) {
          args.push('--add-dir', dir);
        }
      }
      break;

    case 'kimi':
      // Kimi CLI (Moonshot AI) — uses --print for non-interactive mode
      // --print implies --yolo (auto-approve all operations)
      // Output format: stream-json emits complete JSONL messages (OpenAI-compatible)
      args.push(
        '--print',
        '--output-format', 'stream-json',
        '--input-format', 'stream-json'
      );

      // Kimi approval modes
      if (options.mode) {
        args.push(...getKimiApprovalArgs(options.mode));
      }

      // Kimi resolves model from config.toml (default_model = "kimi-code/kimi-for-coding").
      // Only pass --model if user explicitly set a non-default model.
      if (options.model && options.model !== config.defaultModel) {
        args.push('--model', options.model);
      }

      // Resume session
      if (options.resumeSessionId && config.supportsResume) {
        args.push('--session', options.resumeSessionId);
      }

      if (options.workingDirectory) {
        args.push('--work-dir', options.workingDirectory);
      }

      if (options.allowedDirectories) {
        for (const dir of options.allowedDirectories) {
          args.push('--add-dir', dir);
        }
      }
      break;

    case 'multi':
      // Multi-CLI mode uses Claude as the master orchestrator
      // with orchestration mode enabled by default
      args.push(
        '--print',
        '--verbose',
        '--output-format', 'stream-json',
        '--input-format', 'stream-json',
        '--include-partial-messages',
        '--dangerously-skip-permissions'  // Multi-CLI needs full permissions for orchestration
      );

      // Resume session
      if (options.resumeSessionId) {
        args.push('--resume', options.resumeSessionId);
      }

      // Allowed directories
      if (options.allowedDirectories) {
        for (const dir of options.allowedDirectories) {
          args.push('--add-dir', dir);
        }
      }
      break;
  }

  return args;
}

function getCodexApprovalArgs(mode?: SessionMode): string[] {
  // Codex CLI 0.98+: --ask-for-approval removed.
  // Use --full-auto, --dangerously-bypass-approvals-and-sandbox, or --sandbox.
  //
  // In Docker containers, Landlock sandbox (used by --full-auto and --sandbox workspace-write)
  // often fails with LandlockRestrict errors because the kernel may not support it or
  // the container lacks the required capabilities. Use danger-full-access instead.
  const isDocker = !!process.env.CONTAINER_NAME;

  switch (mode) {
    case 'manual':
      return isDocker
        ? ['--sandbox', 'danger-full-access', '-a', 'untrusted']
        : ['--sandbox', 'workspace-write'];
    case 'planning':
      return isDocker
        ? ['--sandbox', 'danger-full-access', '-a', 'untrusted']
        : ['--sandbox', 'read-only'];
    case 'danger':
      return ['--dangerously-bypass-approvals-and-sandbox'];
    case 'orchestration':
      return ['--dangerously-bypass-approvals-and-sandbox'];
    case 'auto-accept':
    default:
      return isDocker
        ? ['--sandbox', 'danger-full-access', '-a', 'never']
        : ['--full-auto'];
  }
}

function getGeminiApprovalMode(mode?: SessionMode): string | null {
  switch (mode) {
    case 'auto-accept':
      return 'auto_edit';
    case 'danger':
    case 'orchestration':
      return 'yolo';
    case 'manual':
    case 'planning':
      return 'default';
    default:
      return null;
  }
}

function getKimiApprovalArgs(mode?: SessionMode): string[] {
  // Kimi CLI: --yolo (auto-approve), --print (implies --yolo)
  // Sandbox modes not applicable — Kimi uses Python-based execution
  switch (mode) {
    case 'manual':
    case 'planning':
      // No auto-approve — but --print already implies --yolo
      // Use max-steps-per-turn to limit autonomous execution
      return ['--max-steps-per-turn', '1'];
    case 'danger':
    case 'orchestration':
      return ['--yolo'];
    case 'auto-accept':
    default:
      return ['--yolo'];
  }
}

/**
 * Get Claude permission flags based on mode
 */
function getClaudePermissionFlags(mode: SessionMode): string[] {
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
      return ['--dangerously-skip-permissions'];
    default:
      return ['--permission-mode', 'acceptEdits'];
  }
}

/**
 * Check if a CLI provider is available (credentials exist)
 */
export async function isProviderAvailable(provider: CLIProvider): Promise<boolean> {
  const fs = await import('fs/promises');
  const os = await import('os');

  // Multi-CLI is available if Claude (the master) is available
  if (provider === 'multi') {
    return isProviderAvailable('claude');
  }

  const config = CLI_PROVIDERS[provider];
  const credPath = config.credentialsPath.replace('~', os.homedir());

  try {
    await fs.access(credPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get all available providers
 */
export async function getAvailableProviders(): Promise<CLIProviderConfig[]> {
  const available: CLIProviderConfig[] = [];

  for (const provider of Object.values(CLI_PROVIDERS)) {
    if (await isProviderAvailable(provider.id)) {
      available.push(provider);
    }
  }

  return available;
}

/**
 * Parse stream output based on provider
 * Different CLIs may have different output formats
 */
export function parseStreamOutput(_provider: CLIProvider, line: string): unknown {
  // For now, all providers use JSON lines
  // This can be extended for provider-specific parsing
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

/**
 * Get available models for a provider.
 * Priority: env var override > CLI discovery > hardcoded defaults.
 */
export function getCliModels(provider: CLIProvider): string[] {
  const envModels = parseEnvModels(provider);
  if (envModels) return envModels;
  return getDiscoveredModels(provider);
}

export function getModelDisplayLabels(): Record<string, string> {
  ensureDiscovery();
  return MODEL_DISPLAY_LABELS;
}

/**
 * Format input message for a provider
 */
export function formatInputMessage(provider: CLIProvider, message: string): string {
  switch (provider) {
    case 'claude':
    case 'glm':
    case 'multi':
      // All use stream-json input
      return JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: message,
        },
      }) + '\n';

    case 'kimi':
      // Kimi stream-json input: OpenAI-compatible message format
      return JSON.stringify({ role: 'user', content: message }) + '\n';

    case 'codex':
    case 'gemini':
      // Gemini might use plain text or different format
      return message + '\n';

    default:
      return message + '\n';
  }
}
