/**
 * CLI Provider Abstraction
 *
 * Supports multiple AI CLI tools:
 * - Claude Code CLI (claude) - Anthropic
 * - Codex CLI (codex) - OpenAI
 * - OpenCode CLI (opencode) - Multi-provider (75+ LLM backends)
 */

import os from 'os';
import path from 'path';
import fs from 'fs';
import { execFile, execFileSync, execSync } from 'child_process';
import { promisify } from 'util';
import type {
  CodexServiceTier,
  CodexWebSearchMode,
  ProviderCapabilities,
  SessionMode,
} from '@claude-code-webui/shared';
import { getCodexWebuiApprovalPolicy, getCodexWebuiSandboxMode } from '../utils/codexDefaults';

const execFileAsync = promisify(execFile);

export type CLIProvider = 'claude' | 'codex' | 'opencode' | 'vibe';

export interface CLIProviderConfig {
  id: CLIProvider;
  name: string;
  command: string;
  icon: string;
  credentialsPath: string;
  supportsStreamJson: boolean;
  supportsResume: boolean;
  supportsModes: boolean;
  capabilities: ProviderCapabilities;
  defaultModel?: string;
  models?: string[];
}

export interface VibeModelEntry {
  name: string;
  alias: string;
  thinking?: string;
}

// Fallback models - used when CLI discovery fails or CLI not installed
// Can be overridden via CLI_PROVIDER_<PROVIDER>_MODELS env var
const CLI_PROVIDER_MODELS: Record<CLIProvider, string[]> = {
  claude: ['opus', 'sonnet', 'haiku'],
  // Fallback only — runtime list comes from ~/.codex/models_cache.json (filtered to
  // visibility=list, sorted by priority). Cache refreshes via the codex CLI itself;
  // if the user's auth token is expired, the cache freezes and the dropdown stays on
  // whatever was last fetched. gpt-5.5 is the new default (codex CLI 0.130+).
  codex: ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-5.2'],
  opencode: [
    'z-ai/glm-5.1',
    'z-ai/glm-5',
    'anthropic/claude-sonnet-4-5',
    'openai/gpt-4o',
    'deepseek/deepseek-chat',
    'google/gemini-2.5-pro',
  ],
  // Names must match `[[models]].name` in ~/.vibe/config.toml. Vibe ships with
  // mistral-vibe-cli-latest (alias mistral-medium-3.5) and devstral-small-latest.
  vibe: ['mistral-vibe-cli-latest', 'devstral-small-latest'],
};

// Display labels — enhanced at startup by CLI discovery
const MODEL_DISPLAY_LABELS: Record<string, string> = {
  // Claude (aliases resolve server-side to latest version)
  opus: 'Opus 4.7',
  sonnet: 'Sonnet 4.6',
  haiku: 'Haiku 4.5',
  // Codex (labels for the currently-listed models in upstream models_cache.json)
  'gpt-5.5': 'GPT 5.5',
  'gpt-5.4': 'GPT 5.4',
  'gpt-5.4-mini': 'GPT 5.4 Mini',
  'gpt-5.3-codex': 'GPT 5.3 Codex',
  'gpt-5.2': 'GPT 5.2',
  // OpenCode (provider/model format)
  'z-ai/glm-5.1': 'GLM 5.1',
  'z-ai/glm-5': 'GLM 5',
  'anthropic/claude-sonnet-4-5': 'Claude Sonnet 4.5',
  'openai/gpt-4o': 'GPT-4o',
  'deepseek/deepseek-chat': 'DeepSeek Chat',
  'google/gemini-2.5-pro': 'Gemini 2.5 Pro',
  // Mistral Vibe (name → alias resolves to mistral-medium-3.5 / devstral-small)
  'mistral-vibe-cli-latest': 'Mistral Medium 3.5 (Vibe)',
  'devstral-small-latest': 'Devstral Small',
};

// ── CLI Model Discovery ──────────────────────────────────────────────

/**
 * Find a CLI binary's real path.
 */
function findCliBinary(command: string): string | null {
  try {
    const p = execFileSync('which', [command], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return p ? fs.realpathSync(p) : null;
  } catch {
    return null;
  }
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
    const source =
      readCliFile(bin, 'cli.js') ?? readCliFile(bin, '@anthropic-ai', 'claude-code', 'cli.js');
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
      const version = stripped
        .replace(/-\d{8}$/, '')
        .split('-')
        .join('.');
      const family = alias.charAt(0).toUpperCase() + alias.slice(1);
      const newLabel = `${family} ${version}`;
      // Only update if discovered version is newer than hardcoded
      // (aliases resolve server-side, so the CLI bundle may lag behind)
      const currentVersion = MODEL_DISPLAY_LABELS[alias]?.match(/(\d+(?:\.\d+)*)/)?.[1] || '0';
      if (version >= currentVersion) {
        MODEL_DISPLAY_LABELS[alias] = newLabel;
      }
      console.log(
        `[CLI-PROVIDERS] claude: ${alias} → ${latest} (label: ${MODEL_DISPLAY_LABELS[alias]})`
      );
    }
  } catch {
    /* keep defaults */
  }
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
          .filter((m) => m.visibility === 'list')
          .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999));

        if (sorted.length > 0) {
          const modelIds = sorted.map((m) => m.slug);
          discoveredModels.codex = modelIds;

          for (const m of sorted) {
            MODEL_DISPLAY_LABELS[m.slug] = formatCodexLabel(m.slug);
          }

          const age = cache.fetched_at
            ? Math.round((Date.now() - new Date(cache.fetched_at).getTime()) / 3600000) + 'h ago'
            : 'unknown';
          console.log(
            `[CLI-PROVIDERS] codex: discovered ${modelIds.length} models from cache (${age}):`,
            modelIds
          );
          return;
        }
      }
    }

    // Fallback: extract model strings from the Rust binary
    discoverCodexFromBinary();
  } catch {
    /* keep defaults */
  }
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
      path.join(
        cliDir,
        '..',
        'lib',
        'node_modules',
        '@openai',
        'codex',
        'vendor',
        triple,
        'codex',
        'codex'
      ),
    ];

    let binaryPath = '';
    for (const p of binaryPaths) {
      try {
        const stat = fs.statSync(p);
        if (stat.size > 0) {
          binaryPath = p;
          break;
        }
      } catch {
        /* next */
      }
    }
    if (!binaryPath) return;

    const output = execFileSync('strings', [binaryPath], {
      encoding: 'utf-8',
      maxBuffer: 200 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
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
  } catch {
    /* keep defaults */
  }
}

function formatCodexLabel(modelId: string): string {
  // "o4-mini" → "o4 mini", "gpt-4.1" → "GPT 4.1"
  if (modelId.startsWith('gpt-')) {
    return modelId.replace('gpt-', 'GPT ').replace(/-/g, ' ');
  }
  return modelId.replace(/-/g, ' ');
}

/**
 * OpenCode: Discover models from either the user's opencode.json config
 * (explicit allow-list) or from the auth.json (enabled providers).
 *
 * Precedence:
 * 1. Explicit `models` array in ~/.config/opencode/opencode.json
 * 2. Auth file: expand each configured provider to its default model set
 * 3. Fall back to CLI_PROVIDER_MODELS.opencode
 */
function discoverOpenCode(): void {
  try {
    const homeDir = os.homedir();
    // Honor CLI_PROVIDER_OPENCODE_CREDENTIALS_PATH (default ~/.local/share/opencode)
    // so operators can relocate OpenCode state without forking the backend.
    // Config path follows XDG config convention independently.
    const authDir = (
      getProviderEnv('opencode', 'CREDENTIALS_PATH') ||
      path.join(homeDir, '.local', 'share', 'opencode')
    ).replace(/^~/, homeDir);
    const configDir = (
      getProviderEnv('opencode', 'CONFIG_PATH') || path.join(homeDir, '.config', 'opencode')
    ).replace(/^~/, homeDir);
    const configPath = path.join(configDir, 'opencode.json');
    const authPath = path.join(authDir, 'auth.json');

    const userModels: string[] = [];
    // Top-level `models` is an explicit allow-list — honor it and skip
    // auth-based expansion. Provider blocks are additive: they declare custom
    // providers (e.g. llama-local) that should coexist with the models
    // auth.json's providers expose. Those should merge, not short-circuit.
    let hasExplicitAllowList = false;

    // 1. Explicit allow-list in opencode.json
    if (fs.existsSync(configPath)) {
      try {
        const raw = fs.readFileSync(configPath, 'utf-8');
        const cfg = JSON.parse(raw) as {
          model?: string;
          models?: string[];
          provider?: Record<string, { models?: Record<string, unknown> }>;
        };
        if (Array.isArray(cfg.models) && cfg.models.length > 0) {
          userModels.push(...cfg.models);
          hasExplicitAllowList = true;
        }
        // Provider-scoped model blocks (provider.<id>.models.<modelId>)
        if (cfg.provider) {
          for (const [providerId, block] of Object.entries(cfg.provider)) {
            if (block?.models) {
              for (const modelId of Object.keys(block.models)) {
                userModels.push(`${providerId}/${modelId}`);
              }
            }
          }
        }
      } catch {
        // Malformed JSON — fall through to auth-based discovery
      }
    }

    // 2. Auth file: derive model set from enabled providers
    if (!hasExplicitAllowList && fs.existsSync(authPath)) {
      try {
        const raw = fs.readFileSync(authPath, 'utf-8');
        const auth = JSON.parse(raw) as Record<string, unknown>;
        const configuredProviders = Object.keys(auth).filter(
          (id) => typeof auth[id] === 'object' && auth[id] !== null
        );

        // Prefer live data from `opencode models`: it knows every provider the
        // installed CLI can route to, including ones not in our hardcoded
        // PROVIDER_DEFAULT_MODELS map (e.g. ollama-cloud). Keep the static map
        // as a fallback so discovery still works if the CLI is missing.
        let resolved = false;
        try {
          const cliRaw = execSync('opencode models 2>&1', {
            encoding: 'utf-8',
            timeout: 10_000,
          });
          for (const line of cliRaw.split('\n')) {
            const trimmed = line.trim();
            const slash = trimmed.indexOf('/');
            if (slash <= 0 || /\s/.test(trimmed)) continue;
            const providerId = trimmed.slice(0, slash);
            const modelId = trimmed.slice(slash + 1);
            if (!providerId || !modelId) continue;
            if (configuredProviders.includes(providerId)) {
              userModels.push(`${providerId}/${modelId}`);
              resolved = true;
            }
          }
        } catch {
          // `opencode models` unavailable — fall back to static map
        }

        if (!resolved) {
          for (const providerId of configuredProviders) {
            for (const model of PROVIDER_DEFAULT_MODELS[providerId] ?? []) {
              userModels.push(`${providerId}/${model}`);
            }
          }
        }
      } catch {
        // Malformed auth.json — fall through
      }
    }

    if (userModels.length > 0) {
      const unique = [...new Set(userModels)];
      discoveredModels.opencode = unique;
      for (const modelId of unique) {
        if (!MODEL_DISPLAY_LABELS[modelId]) {
          MODEL_DISPLAY_LABELS[modelId] = formatOpenCodeLabel(modelId);
        }
      }
      console.log(`[CLI-PROVIDERS] opencode: discovered ${unique.length} models:`, unique);
    }
  } catch {
    // Keep defaults
  }
}

/**
 * Per-provider model seeds used when auth.json lists a provider but no
 * opencode.json model allow-list is present. Pairs with the user's auth
 * config to produce a sensible default surface.
 */
const PROVIDER_DEFAULT_MODELS: Record<string, string[]> = {
  anthropic: ['claude-sonnet-4-5', 'claude-opus-4-5', 'claude-haiku-4-5'],
  openai: ['gpt-4o', 'gpt-4o-mini', 'o1', 'o1-mini'],
  'z-ai': ['glm-5.1', 'glm-5'],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  google: ['gemini-2.5-pro', 'gemini-2.5-flash'],
  groq: ['llama-3.3-70b-versatile'],
  openrouter: [],
  'x-ai': ['grok-2-latest'],
  mistral: ['mistral-large-latest'],
  cohere: ['command-r-plus'],
  together: [],
};

function formatOpenCodeLabel(modelId: string): string {
  // "z-ai/glm-5.1" → "GLM 5.1", "anthropic/claude-sonnet-4-5" → "Claude Sonnet 4.5"
  const parts = modelId.split('/');
  const tail = parts[parts.length - 1] || modelId;
  const provider = parts.length > 1 ? parts[0] : undefined;

  const cleaned = tail
    .replace(/[-_]/g, ' ')
    .split(' ')
    .map((segment) => {
      if (/^\d/.test(segment)) return segment; // keep version segments verbatim
      return segment.charAt(0).toUpperCase() + segment.slice(1);
    })
    .join(' ');

  if (provider === 'z-ai') {
    return cleaned.replace(/^Glm/i, 'GLM');
  }
  if (provider === 'openai' || provider === 'x-ai') {
    return cleaned.replace(/^Gpt/i, 'GPT').replace(/^Grok/i, 'Grok');
  }
  return cleaned;
}

export function parseVibeModelsToml(raw: string): VibeModelEntry[] {
  const models: VibeModelEntry[] = [];
  const blockRe = /^\s*\[\[models\]\]\s*$/gm;
  const starts: number[] = [];
  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(raw)) !== null) {
    starts.push(match.index);
  }

  for (let i = 0; i < starts.length; i += 1) {
    const start = starts[i]!;
    const end = starts[i + 1] ?? raw.length;
    const block = raw.slice(start, end);
    const name = block.match(/^\s*name\s*=\s*"([^"]+)"/m)?.[1]?.trim();
    const alias = block.match(/^\s*alias\s*=\s*"([^"]+)"/m)?.[1]?.trim();
    const thinking = block.match(/^\s*thinking\s*=\s*"([^"]+)"/m)?.[1]?.trim();
    if (name || alias) {
      models.push({
        name: name || alias!,
        alias: alias || name!,
        thinking,
      });
    }
  }

  return models;
}

export function getVibeModelAlias(
  modelId: string | null | undefined,
  rawConfig: string
): string | null {
  if (!modelId) return null;
  const wanted = modelId.trim();
  if (!wanted) return null;
  const models = parseVibeModelsToml(rawConfig);
  const byName = models.find((model) => model.name === wanted);
  if (byName) return byName.alias;
  const byAlias = models.find((model) => model.alias === wanted);
  if (byAlias) return byAlias.alias;
  return null;
}

function formatVibeLabel(entry: VibeModelEntry): string {
  const base = entry.alias || entry.name;
  if (base === 'mistral-medium-3.5') return 'Mistral Medium 3.5 (Vibe)';
  if (base === 'devstral-small') return 'Devstral Small';
  return base
    .replace(/[-_]/g, ' ')
    .split(' ')
    .map((segment) => {
      if (/^\d/.test(segment)) return segment;
      if (segment.toLowerCase() === 'mistral') return 'Mistral';
      if (segment.toLowerCase() === 'devstral') return 'Devstral';
      return segment.charAt(0).toUpperCase() + segment.slice(1);
    })
    .join(' ');
}

function discoverVibe(): void {
  try {
    const homeDir = os.homedir();
    const configDir = (
      getProviderEnv('vibe', 'CREDENTIALS_PATH') || path.join(homeDir, '.vibe')
    ).replace(/^~/, homeDir);
    const configPath = path.join(configDir, 'config.toml');
    if (!fs.existsSync(configPath)) return;

    const models = parseVibeModelsToml(fs.readFileSync(configPath, 'utf-8'));
    if (models.length === 0) return;

    const ids = [...new Set(models.map((model) => model.name).filter(Boolean))];
    discoveredModels.vibe = ids;
    for (const entry of models) {
      if (!MODEL_DISPLAY_LABELS[entry.name]) {
        MODEL_DISPLAY_LABELS[entry.name] = formatVibeLabel(entry);
      }
      if (!MODEL_DISPLAY_LABELS[entry.alias]) {
        MODEL_DISPLAY_LABELS[entry.alias] = formatVibeLabel(entry);
      }
    }
    console.log(`[CLI-PROVIDERS] vibe: discovered ${ids.length} models:`, ids);
  } catch {
    // Keep defaults
  }
}

// ── Discovery Cache ──────────────────────────────────────────────────

const discoveredModels: Partial<Record<CLIProvider, string[]>> = {};
let discoveryDone = false;

function ensureDiscovery(): void {
  if (discoveryDone) return;
  discoveryDone = true;
  discoverClaude();
  discoverCodex();
  discoverOpenCode();
  discoverVibe();
}

/**
 * Reset discovery cache so models are re-read on next access.
 * Call after CLI updates or manual cache refresh.
 */
export function resetDiscovery(): void {
  discoveryDone = false;
  delete discoveredModels.claude;
  delete discoveredModels.codex;
  delete discoveredModels.opencode;
  delete discoveredModels.vibe;
}

// Single shared promise so concurrent callers don't spawn multiple Codex processes
// (each run takes up to 30s and hits the OpenAI API). Cleared in `finally`.
let codexRefreshInFlight: Promise<boolean> | null = null;

/**
 * Refresh the Codex models cache by running a minimal Codex session.
 * The Codex CLI fetches from the OpenAI API on startup.
 * Uses an in-flight lock so concurrent callers share one run.
 */
export async function refreshCodexModelsCache(): Promise<boolean> {
  if (codexRefreshInFlight) return codexRefreshInFlight;

  codexRefreshInFlight = (async () => {
    try {
      const bin = findCliBinary('codex');
      if (!bin) return false;

      const credPath = CLI_PROVIDERS.codex.credentialsPath.replace('~', os.homedir());
      const cachePath = path.join(credPath, 'models_cache.json');
      const beforeMtime = fs.existsSync(cachePath) ? fs.statSync(cachePath).mtimeMs : 0;

      // Async spawn so we don't block the event loop for up to 30s.
      await execFileAsync(
        bin,
        ['exec', '--json', '--skip-git-repo-check', '--model', 'gpt-5.4', 'say OK'],
        { cwd: '/app', timeout: 30000 }
      );

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
  })();

  try {
    return await codexRefreshInFlight;
  } finally {
    codexRefreshInFlight = null;
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

// Insertion order matters: routes/cli-providers.ts uses Object.values() so the
// frontend picker lists providers in this order. Codex is the primary going
// forward; Claude is intentionally last (legacy) since claude -p is being
// restricted / moved to a credit system upstream.
export const CLI_PROVIDERS: Record<CLIProvider, CLIProviderConfig> = {
  codex: {
    id: 'codex',
    name: 'Codex',
    command: envOr('codex', 'COMMAND', 'codex'),
    icon: '🟢',
    credentialsPath: envOr('codex', 'CREDENTIALS_PATH', '~/.codex'),
    // Codex CLI itself is single-shot per turn, but the WebUI simulates streaming
    // by handling `item.delta` events and resume by prepending a transcript of
    // prior turns to each respawned process's stdin.
    supportsStreamJson: true,
    supportsResume: true,
    supportsModes: true,
    capabilities: {
      streaming: true,
      resume: true,
      modes: true,
      approvals: true,
      nativeVision: true,
      imageBridge: false,
      mcp: true,
      mcpSessionAttribution: 'native',
      usageLimits: 'upstream',
      reasoning: true,
      serviceTier: true,
      webSearch: true,
      allowedDirectories: true,
    },
    defaultModel: getProviderEnv('codex', 'DEFAULT_MODEL') || 'gpt-5.5',
    models: parseEnvModels('codex') ?? CLI_PROVIDER_MODELS.codex,
  },
  opencode: {
    id: 'opencode',
    name: 'OpenCode',
    command: envOr('opencode', 'COMMAND', 'opencode'),
    icon: '⚡',
    // OpenCode writes auth/tokens to ~/.local/share/opencode/auth.json per XDG.
    // Config lives at ~/.config/opencode/opencode.json but absence of a config
    // file doesn't mean the CLI is unusable — auth presence is the real signal.
    credentialsPath: envOr('opencode', 'CREDENTIALS_PATH', '~/.local/share/opencode'),
    supportsStreamJson: true,
    supportsResume: true,
    supportsModes: true,
    capabilities: {
      streaming: true,
      resume: true,
      modes: true,
      approvals: true,
      nativeVision: false,
      imageBridge: true,
      mcp: true,
      mcpSessionAttribution: 'prompt-scoped',
      usageLimits: 'local-budget',
      reasoning: true,
      serviceTier: false,
      webSearch: true,
      allowedDirectories: true,
    },
    defaultModel: getProviderEnv('opencode', 'DEFAULT_MODEL') || 'z-ai/glm-5.1',
    models: parseEnvModels('opencode') ?? CLI_PROVIDER_MODELS.opencode,
  },
  vibe: {
    id: 'vibe',
    name: 'Mistral Vibe',
    command: envOr('vibe', 'COMMAND', 'vibe'),
    icon: '🟣',
    // Vibe state lives in ~/.vibe by default; we override per-session via VIBE_HOME
    // at spawn time so each WebUI chat is an isolated agent session.
    credentialsPath: envOr('vibe', 'CREDENTIALS_PATH', '~/.vibe'),
    // Vibe streams newline-delimited JSON (one LLMMessage per line) under --output streaming.
    supportsStreamJson: true,
    // Continuation is provided by reusing the same VIBE_HOME — the CLI's --continue
    // flag picks up the last session in that home dir.
    supportsResume: true,
    supportsModes: true,
    capabilities: {
      streaming: true,
      resume: true,
      modes: true,
      approvals: true,
      nativeVision: false,
      imageBridge: true,
      mcp: true,
      mcpSessionAttribution: 'native',
      usageLimits: 'local-budget',
      reasoning: true,
      serviceTier: false,
      webSearch: false,
      allowedDirectories: true,
    },
    defaultModel: getProviderEnv('vibe', 'DEFAULT_MODEL') || 'mistral-vibe-cli-latest',
    models: parseEnvModels('vibe') ?? CLI_PROVIDER_MODELS.vibe,
  },
  claude: {
    id: 'claude',
    name: 'Claude Code',
    command: envOr('claude', 'COMMAND', 'claude'),
    icon: '🟠',
    credentialsPath: envOr('claude', 'CREDENTIALS_PATH', '~/.claude'),
    supportsStreamJson: true,
    supportsResume: true,
    supportsModes: true,
    capabilities: {
      streaming: true,
      resume: true,
      modes: true,
      approvals: true,
      nativeVision: false,
      imageBridge: false,
      mcp: true,
      mcpSessionAttribution: 'native',
      usageLimits: 'upstream',
      reasoning: true,
      serviceTier: false,
      webSearch: true,
      allowedDirectories: true,
    },
    defaultModel: getProviderEnv('claude', 'DEFAULT_MODEL') || 'sonnet',
    models: parseEnvModels('claude') ?? CLI_PROVIDER_MODELS.claude,
  },
};

export function getProviderCapabilities(provider: CLIProvider): ProviderCapabilities {
  return CLI_PROVIDERS[provider].capabilities;
}

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
    serviceTier?: CodexServiceTier | string | null;
    webSearchMode?: CodexWebSearchMode;
    codexExecCommand?: { type: 'review'; args: string[]; prompt?: string };
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
        '--output-format',
        'stream-json',
        '--input-format',
        'stream-json',
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

      // Effort level (reasoning)
      if (options.reasoningLevel) {
        args.push('--effort', options.reasoningLevel);
      }

      // Allowed directories
      if (options.allowedDirectories) {
        for (const dir of options.allowedDirectories) {
          args.push('--add-dir', dir);
        }
      }
      break;

    case 'codex': {
      // Codex CLI 0.130 non-interactive: `codex exec [resume <id>] [opts] [prompt]`
      // Native resume preferred when a sessionId is known. Note: `codex exec resume`
      // accepts a NARROWER flag set than `codex exec` — no --sandbox, no --add-dir;
      // those settings are inherited from the resumed thread.
      const isReview = options.codexExecCommand?.type === 'review';
      const isResume = !!(options.resumeSessionId && config.supportsResume);
      if (isReview) {
        args.push('exec', '--json');
      } else if (isResume) {
        args.push('exec', 'resume', options.resumeSessionId as string, '--json');
      } else {
        args.push('exec', '--json');
      }

      // Sandbox / approval flags only apply to fresh `exec`, not `exec resume`.
      if (!isResume) {
        args.push(...getCodexApprovalArgs(options.mode));
      }

      if (options.model) {
        args.push('--model', options.model);
      }

      // Reasoning effort. Valid Codex values: none | minimal | low | medium | high | xhigh.
      // Map common aliases (extra_high / extrahigh / very_high) → xhigh; drop unknown
      // values silently so a stale user setting doesn't crash the spawn.
      const VALID_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const;
      const EFFORT_ALIASES: Record<string, (typeof VALID_EFFORTS)[number]> = {
        extra_high: 'xhigh',
        extrahigh: 'xhigh',
        very_high: 'xhigh',
        veryhigh: 'xhigh',
        max: 'xhigh',
      };
      const rawEffort =
        options.mode === 'planning' && !options.reasoningLevel ? 'high' : options.reasoningLevel;
      let effort: (typeof VALID_EFFORTS)[number] | undefined;
      if (rawEffort) {
        const normalized = rawEffort.toLowerCase().trim();
        if ((VALID_EFFORTS as readonly string[]).includes(normalized)) {
          effort = normalized as (typeof VALID_EFFORTS)[number];
        } else if (EFFORT_ALIASES[normalized]) {
          effort = EFFORT_ALIASES[normalized];
        }
      }
      if (effort) {
        args.push('-c', `model_reasoning_effort="${effort}"`);
      }

      if (options.serviceTier === 'fast') {
        args.push('-c', 'features.fast_mode=true');
        args.push('-c', 'service_tier="fast"');
      }

      if (options.webSearchMode && options.webSearchMode !== 'auto') {
        args.push('-c', `web_search="${options.webSearchMode}"`);
      }

      if (options.workingDirectory && !isResume) {
        args.push('--cd', options.workingDirectory);
        args.push('--skip-git-repo-check');
      }

      // --add-dir is exec-only (resume inherits from the original session).
      if (!isResume && options.allowedDirectories) {
        for (const dir of options.allowedDirectories) {
          args.push('--add-dir', dir);
        }
      }
      if (isReview) {
        args.push('review', ...options.codexExecCommand!.args);
        if (options.codexExecCommand!.prompt) {
          args.push(options.codexExecCommand!.prompt);
        }
      }
      break;
    }

    case 'opencode':
      // OpenCode CLI: `opencode run --format json --model <model> "prompt"`
      // Permission semantics are declarative (OPENCODE_PERMISSION env JSON)
      // rather than hook-based — see buildOpenCodePermissionJson().
      args.push('run', '--format', 'json');

      if (options.model) {
        args.push('--model', options.model);
      }

      if (options.reasoningLevel) {
        args.push('--variant', normalizeOpenCodeVariant(options.reasoningLevel));
      }

      // Resume explicit session; OpenCode also supports --continue for the
      // latest session, but we always carry an explicit session id when one
      // exists, so --session is the right primitive here.
      if (options.resumeSessionId && config.supportsResume) {
        args.push('--session', options.resumeSessionId);
      }

      // Danger mode bypasses permission prompts entirely. All other modes
      // rely on the OPENCODE_PERMISSION env var built at spawn time.
      if (options.mode === 'danger') {
        args.push('--dangerously-skip-permissions');
      }
      break;

    case 'vibe':
      // Mistral Vibe: prompt is passed via argv (-p), output streams newline-JSON.
      // The actual prompt text is appended by the spawner just before exec, since
      // it changes every turn — here we set up everything else.
      // --trust skips the folder-trust prompt. Tool policy is selected through
      // Vibe's builtin agents so WebUI modes stay meaningful in programmatic mode.
      // Note: vibe has no --model flag; the spawner rewrites per-session config.toml.
      args.push('--output', 'streaming', '--trust');

      if (options.mode && config.supportsModes) {
        args.push('--agent', getVibeAgentForMode(options.mode));
      }

      if (options.workingDirectory) {
        args.push('--workdir', options.workingDirectory);
      }

      if (options.allowedDirectories) {
        for (const dir of options.allowedDirectories) {
          args.push('--add-dir', dir);
        }
      }

      if (options.resumeSessionId && config.supportsResume) {
        args.push('--continue');
      }
      break;
  }

  return args;
}

function normalizeOpenCodeVariant(reasoningLevel: string): string {
  const normalized = reasoningLevel
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (normalized === 'extra_high' || normalized === 'xhigh') return 'max';
  return normalized;
}

function getVibeAgentForMode(mode?: SessionMode): string {
  switch (mode) {
    case 'planning':
      return 'plan';
    case 'manual':
      return 'default';
    case 'danger':
      return 'auto-approve';
    case 'auto-accept':
    default:
      return 'accept-edits';
  }
}

/**
 * Build the JSON value for the OPENCODE_PERMISSION env var.
 *
 * OpenCode evaluates permissions declaratively at runtime. The JSON schema:
 *   { "edit": "ask"|"allow"|"deny",
 *     "bash": { "<pattern>": "ask"|"allow"|"deny", "*": "ask" },
 *     "webfetch": "ask"|"allow"|"deny" }
 *
 * Modes map to policies matching Claude's permission-mode semantics:
 *   - auto-accept: edits allowed, common bash allowed, destructive bash asked
 *   - manual:      everything asked (OpenCode sends ask-events the UI surfaces)
 *   - planning:    edits denied (read-only), bash mostly denied
 *   - danger:      N/A — bypassed via --dangerously-skip-permissions flag
 */
export function buildOpenCodePermissionJson(mode?: SessionMode): string {
  switch (mode) {
    case 'planning':
      return JSON.stringify({
        edit: 'deny',
        webfetch: 'allow',
        bash: {
          '*': 'deny',
          'ls *': 'allow',
          'cat *': 'allow',
          'grep *': 'allow',
          'find *': 'allow',
          'git status': 'allow',
          'git diff *': 'allow',
          'git log *': 'allow',
        },
      });
    case 'manual':
      return JSON.stringify({
        edit: 'ask',
        webfetch: 'ask',
        bash: { '*': 'ask' },
      });
    case 'danger':
      // Unused — --dangerously-skip-permissions takes effect at the flag level.
      return JSON.stringify({ edit: 'allow', webfetch: 'allow', bash: { '*': 'allow' } });
    case 'auto-accept':
    default:
      return JSON.stringify({
        edit: 'allow',
        webfetch: 'allow',
        bash: {
          '*': 'allow',
          'rm -rf *': 'ask',
          'rm -rf /': 'deny',
          'sudo *': 'ask',
          'curl * | bash *': 'ask',
          'curl * | sh *': 'ask',
          'wget * | bash *': 'ask',
        },
      });
  }
}

export type OpenCodePermissionRule = {
  permission: string;
  pattern: string;
  action: 'allow' | 'deny' | 'ask';
};

function openCodeDirectoryPatterns(
  workingDirectory?: string,
  allowedDirectories?: string[]
): string[] {
  const values = [workingDirectory, ...(allowedDirectories || [])]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => path.resolve(value));
  const unique = Array.from(new Set(values));
  return unique.flatMap((dir) => [dir, `${dir}/**`]);
}

function openCodeDirectoryAllowRules(
  workingDirectory?: string,
  allowedDirectories?: string[]
): OpenCodePermissionRule[] {
  return openCodeDirectoryPatterns(workingDirectory, allowedDirectories).map((pattern) => ({
    permission: 'external_directory',
    pattern,
    action: 'allow',
  }));
}

export function buildOpenCodePermissionRules(
  mode?: SessionMode,
  opts: { workingDirectory?: string; allowedDirectories?: string[] } = {}
): OpenCodePermissionRule[] {
  const directoryAllows = openCodeDirectoryAllowRules(
    opts.workingDirectory,
    opts.allowedDirectories
  );
  // OpenCode permission patterns are last-match-wins, so broad external_directory
  // catch-alls must come before the specific WebUI workspace/add-dir allows.
  const allowRead: OpenCodePermissionRule[] = [
    { permission: 'read', pattern: '*', action: 'allow' },
    { permission: 'list', pattern: '*', action: 'allow' },
    { permission: 'glob', pattern: '*', action: 'allow' },
    { permission: 'grep', pattern: '*', action: 'allow' },
    { permission: 'webfetch', pattern: '*', action: 'allow' },
    { permission: 'websearch', pattern: '*', action: 'allow' },
  ];

  switch (mode) {
    case 'planning':
      return [
        ...allowRead,
        { permission: 'edit', pattern: '*', action: 'deny' },
        { permission: 'bash', pattern: '*', action: 'deny' },
        { permission: 'task', pattern: '*', action: 'deny' },
        { permission: 'todowrite', pattern: '*', action: 'deny' },
        { permission: 'external_directory', pattern: '*', action: 'deny' },
        ...directoryAllows,
        { permission: 'repo_clone', pattern: '*', action: 'deny' },
        { permission: 'plan_enter', pattern: '*', action: 'deny' },
        { permission: 'plan_exit', pattern: '*', action: 'deny' },
      ];
    case 'manual':
      return [
        ...allowRead,
        { permission: 'edit', pattern: '*', action: 'ask' },
        { permission: 'bash', pattern: '*', action: 'ask' },
        { permission: 'task', pattern: '*', action: 'ask' },
        { permission: 'todowrite', pattern: '*', action: 'ask' },
        { permission: 'external_directory', pattern: '*', action: 'ask' },
        ...directoryAllows,
        { permission: 'repo_clone', pattern: '*', action: 'ask' },
      ];
    case 'danger':
      return [
        { permission: '*', pattern: '*', action: 'allow' },
        { permission: 'question', pattern: '*', action: 'deny' },
      ];
    case 'auto-accept':
    default:
      return [
        ...allowRead,
        { permission: 'edit', pattern: '*', action: 'allow' },
        { permission: 'bash', pattern: '*', action: 'allow' },
        { permission: 'task', pattern: '*', action: 'allow' },
        { permission: 'todowrite', pattern: '*', action: 'allow' },
        { permission: 'external_directory', pattern: '*', action: 'ask' },
        ...directoryAllows,
        { permission: 'repo_clone', pattern: '*', action: 'allow' },
        { permission: 'question', pattern: '*', action: 'deny' },
      ];
  }
}

function getCodexApprovalArgs(mode?: SessionMode): string[] {
  // Codex CLI 0.130 `exec` subcommand only exposes:
  //   -s, --sandbox (read-only | workspace-write | danger-full-access)
  //   --dangerously-bypass-approvals-and-sandbox
  // It does NOT expose `--ask-for-approval` or `--full-auto` directly — approval
  // policy comes via `-c approval_policy=<value>` config override.
  //
  // In Docker the Landlock sandbox used by workspace-write often fails with
  // LandlockRestrict errors (kernel/capability mismatch), so the WebUI default
  // is danger-full-access there. Operators can override it with
  // CODEX_WEBUI_SANDBOX_MODE=read-only|workspace-write|danger-full-access.
  const defaultSandbox = getCodexWebuiSandboxMode();
  const defaultApproval = getCodexWebuiApprovalPolicy();

  switch (mode) {
    case 'planning':
      // Read-only filesystem: agent designs without mutating files. Approval=never
      // because plans surface through the WebUI, not blocking prompts.
      return ['--sandbox', 'read-only', '-c', 'approval_policy="never"'];
    case 'manual':
      // User-facing approval: surface every shell/file action back to the WebUI.
      return ['--sandbox', defaultSandbox, '-c', 'approval_policy="untrusted"'];
    case 'danger':
      return ['--dangerously-bypass-approvals-and-sandbox'];
    case 'auto-accept':
    default:
      return ['--sandbox', defaultSandbox, '-c', `approval_policy="${defaultApproval}"`];
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

  const config = CLI_PROVIDERS[provider];
  const credPath = config.credentialsPath.replace('~', os.homedir());

  try {
    if (provider === 'codex') {
      const raw = await fs.readFile(path.join(credPath, 'auth.json'), 'utf-8');
      const auth = JSON.parse(raw) as {
        OPENAI_API_KEY?: string | null;
        tokens?: { access_token?: string | null };
      };
      return !!(auth.tokens?.access_token || auth.OPENAI_API_KEY);
    }
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
      // Claude uses stream-json input
      return (
        JSON.stringify({
          type: 'user',
          message: {
            role: 'user',
            content: message,
          },
        }) + '\n'
      );

    case 'codex':
    case 'opencode':
      // Plain text + newline
      return message + '\n';

    case 'vibe':
      // Vibe takes the prompt via argv (-p), not stdin. The spawner appends -p <message>
      // to the argv just before exec; we return the raw text here so the manager can
      // detect the provider and route accordingly.
      return message;

    default:
      return message + '\n';
  }
}
