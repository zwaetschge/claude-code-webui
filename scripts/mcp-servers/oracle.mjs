#!/usr/bin/env node
// WebUI-owned Oracle MCP wrapper.
//
// Why this exists:
// - Upstream `oracle-mcp` hardcodes a minimal browser config for MCP consults.
// - That blocks user-driven ChatGPT login flows like remote Chrome attach.
// - This wrapper keeps Oracle as the execution engine, but applies per-session
//   WebUI browser settings before spawning the CLI.
//
// Transport: line-delimited JSON-RPC 2.0 over stdin/stdout. No external deps.

import { createInterface } from 'node:readline';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function readParentEnv() {
  if (process.platform !== 'linux' || !process.ppid) return {};
  try {
    const raw = readFileSync(`/proc/${process.ppid}/environ`, 'utf8');
    const entries = {};
    for (const item of raw.split('\0')) {
      if (!item) continue;
      const separator = item.indexOf('=');
      if (separator <= 0) continue;
      entries[item.slice(0, separator)] = item.slice(separator + 1);
    }
    return entries;
  } catch {
    return {};
  }
}

// Codex starts MCP servers with the static config env block, which can omit the
// dynamic WebUI session/auth env from the parent Codex process.
const RUNTIME_ENV = { ...readParentEnv(), ...process.env };

const BACKEND = RUNTIME_ENV.WEBUI_BACKEND_URL || 'http://localhost:3001';
const HOOK_SECRET = RUNTIME_ENV.WEBUI_HOOK_SECRET || '';
const SESSION_ID = RUNTIME_ENV.WEBUI_SESSION_ID || '';
const ORACLE_HOME_DIR = RUNTIME_ENV.ORACLE_HOME_DIR || path.join(os.homedir(), '.oracle');
const ORACLE_BIN = RUNTIME_ENV.ORACLE_BIN || 'npx';
const ORACLE_NPM_PACKAGE = RUNTIME_ENV.ORACLE_NPM_PACKAGE || '@steipete/oracle@0.14.0';
const ORACLE_BIN_PREFIX = ORACLE_BIN === 'npx' ? ['-y', ORACLE_NPM_PACKAGE] : [];
const TEMP_ROOT = path.join(os.tmpdir(), 'plum-oracle-mcp');
const CHATGPT_URL = 'https://chatgpt.com/';
const ORACLE_TIMEOUT_MS = Number(RUNTIME_ENV.ORACLE_MCP_TIMEOUT_MS || 70 * 60 * 1000);
const DEFAULT_BROWSER_TIMEOUT = normalizeString(
  RUNTIME_ENV.ORACLE_MCP_BROWSER_TIMEOUT || RUNTIME_ENV.ORACLE_BROWSER_TIMEOUT || '8m'
);
const DEFAULT_BROWSER_INPUT_TIMEOUT = normalizeString(
  RUNTIME_ENV.ORACLE_MCP_BROWSER_INPUT_TIMEOUT || RUNTIME_ENV.ORACLE_BROWSER_INPUT_TIMEOUT || ''
);
const DEFAULT_BROWSER_MODEL = normalizeString(
  RUNTIME_ENV.ORACLE_BROWSER_MODEL || RUNTIME_ENV.ORACLE_BROWSER_MODEL_LABEL || 'gpt-5.5-pro'
);
const ALLOW_BROWSER_ENV_OVERRIDES =
  isTruthyEnv(RUNTIME_ENV.ORACLE_MCP_ALLOW_BROWSER_ENV_OVERRIDES) ||
  isTruthyEnv(RUNTIME_ENV.ORACLE_MCP_TRUST_BROWSER_ENV);

const log = (...args) => console.error('[mcp-oracle]', ...args);

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function ok(id, value) {
  send({ jsonrpc: '2.0', id, result: value });
}

function fail(id, code, message, data) {
  send({ jsonrpc: '2.0', id, error: { code, message, ...(data ? { data } : {}) } });
}

function toolError(message, extra = {}) {
  return {
    content: [{ type: 'text', text: `Error: ${message}` }],
    structuredContent: { ok: false, ...extra },
    isError: true,
  };
}

const CONSULT_TOOL = {
  name: 'consult',
  description:
    'Run a one-shot Oracle review with file context. Browser runs honor WebUI Oracle browser auth settings, including remote Chrome attach for ChatGPT login.',
  inputSchema: {
    type: 'object',
    required: ['prompt'],
    properties: {
      prompt: { type: 'string', minLength: 1, description: 'Question or review prompt.' },
      files: {
        type: 'array',
        items: { type: 'string' },
        description: 'Files, directories, or globs to attach as context.',
      },
      model: { type: 'string', description: 'Optional primary model override.' },
      models: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional multi-model API run list.',
      },
      engine: {
        type: 'string',
        enum: ['api', 'browser'],
        description: 'Force Oracle API or browser mode.',
      },
      browserModelLabel: {
        type: 'string',
        description:
          'Optional browser-only model label for the ChatGPT picker, e.g. "GPT-5.2 Thinking".',
      },
      browserModelStrategy: {
        type: 'string',
        enum: ['select', 'current', 'ignore'],
        description:
          'Optional browser-only model selection strategy. Defaults to current to avoid brittle ChatGPT model-picker automation.',
      },
      browserThinkingTime: {
        type: 'string',
        enum: ['light', 'standard', 'extended', 'heavy'],
        description:
          'Optional browser-only thinking time for Pro/Thinking models. By default the wrapper leaves the current ChatGPT setting unchanged.',
      },
      browserTimeout: {
        type: 'string',
        description:
          'Optional browser-only answer timeout passed to Oracle, e.g. "90s", "8m", or "120000". Defaults to ORACLE_MCP_BROWSER_TIMEOUT or 8m.',
      },
      browserInputTimeout: {
        type: 'string',
        description:
          'Optional browser-only composer timeout passed to Oracle, e.g. "30s" or "1m".',
      },
      search: {
        type: 'boolean',
        description: 'Enable or disable Oracle server-side search explicitly.',
      },
      slug: {
        type: 'string',
        description: 'Optional memorable session slug. 3-5 words recommended.',
      },
    },
  },
};

const SESSIONS_TOOL = {
  name: 'sessions',
  description:
    'List stored Oracle sessions or fetch one session by id/slug. Pass detail=true to include metadata, log, and stored request payload.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      hours: { type: 'number' },
      limit: { type: 'number' },
      includeAll: { type: 'boolean' },
      detail: { type: 'boolean' },
    },
  },
};

const TOOLS = [CONSULT_TOOL, SESSIONS_TOOL];

const RESOURCE_TEMPLATE = {
  uriTemplate: 'oracle-session://{id}/{kind}',
  name: 'oracle-session',
  title: 'oracle session resources',
  description: 'Read stored Oracle session metadata, log, or request payload.',
  mimeType: 'text/plain',
};

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isTruthyEnv(value) {
  return ['1', 'true', 'yes', 'on'].includes(normalizeString(value).toLowerCase());
}

function normalizeBrowserModelStrategy(value) {
  const configured = normalizeString(
    value ||
      (ALLOW_BROWSER_ENV_OVERRIDES ? RUNTIME_ENV.ORACLE_BROWSER_MODEL_STRATEGY : '') ||
      'current'
  ).toLowerCase();
  return configured === 'current' || configured === 'ignore' ? configured : 'select';
}

function normalizeBrowserThinkingTime(value) {
  const configured = normalizeString(
    value || (ALLOW_BROWSER_ENV_OVERRIDES ? RUNTIME_ENV.ORACLE_BROWSER_THINKING_TIME : '') || ''
  )
    .toLowerCase()
    .replace(/[_\s]+/g, '-');

  if (!configured || configured === 'off' || configured === 'none' || configured === 'false') {
    return '';
  }

  return ['light', 'standard', 'extended', 'heavy'].includes(configured) ? configured : 'extended';
}

function normalizeDurationOption(value) {
  const configured = normalizeString(value);
  if (!configured) return '';
  if (/^\d+$/.test(configured)) return configured;
  if (/^\d+(?:\.\d+)?(?:ms|s|m)$/i.test(configured)) return configured;
  throw new Error(`Invalid duration "${configured}". Use milliseconds, seconds (s), or minutes (m).`);
}

function ensureDirName(input) {
  return input.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
}

function defaultSlug() {
  const token = Math.random().toString(36).slice(2, 8);
  return `plum-oracle-run-${token}`;
}

function sessionPaths(sessionId) {
  const base = path.join(ORACLE_HOME_DIR, 'sessions', sessionId);
  return {
    base,
    meta: path.join(base, 'meta.json'),
    log: path.join(base, 'output.log'),
    request: path.join(base, 'request.json'),
  };
}

async function readJson(file) {
  const raw = await readFile(file, 'utf8');
  return JSON.parse(raw);
}

async function safeReadText(file) {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return null;
  }
}

function runtimeHeaders() {
  const headers = {};
  if (HOOK_SECRET) headers['x-webui-hook-secret'] = HOOK_SECRET;
  if (SESSION_ID) headers['x-webui-session-id'] = SESSION_ID;
  return headers;
}

async function listSessionMetadata() {
  const dir = path.join(ORACLE_HOME_DIR, 'sessions');
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const sessions = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const metaFile = path.join(dir, entry.name, 'meta.json');
    try {
      const meta = await readJson(metaFile);
      sessions.push(meta);
    } catch {
      // Ignore malformed session directories.
    }
  }

  sessions.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  return sessions;
}

function filterSessions(entries, { id, hours = 24, limit = 100, includeAll = false } = {}) {
  let filtered = entries;

  if (id) {
    filtered = filtered.filter((entry) => entry.id === id || String(entry.id).startsWith(`${id}-`));
  } else if (!includeAll) {
    const cutoff = Date.now() - hours * 60 * 60 * 1000;
    filtered = filtered.filter((entry) => {
      const createdAt = Date.parse(String(entry.createdAt || ''));
      return Number.isFinite(createdAt) ? createdAt >= cutoff : false;
    });
  }

  const cappedLimit = Math.max(1, Math.min(Number(limit) || 100, 1000));
  return {
    total: filtered.length,
    truncated: filtered.length > cappedLimit,
    entries: filtered.slice(0, cappedLimit),
  };
}

async function readSessionDetail(sessionId) {
  const paths = sessionPaths(sessionId);
  const metadata = await readJson(paths.meta);
  const logText = (await safeReadText(paths.log)) || '';
  const requestRaw = await safeReadText(paths.request);
  let request = undefined;

  if (requestRaw) {
    try {
      request = JSON.parse(requestRaw);
    } catch {
      request = requestRaw;
    }
  }

  return {
    metadata,
    log: logText,
    request,
  };
}

async function findConsultSession({ slug, startedAt }) {
  const sessions = await listSessionMetadata();

  const exact = sessions.find((entry) => entry.id === slug);
  if (exact) return exact;

  const related = sessions.filter((entry) => {
    const createdAt = Date.parse(String(entry.createdAt || ''));
    return (
      String(entry.id || '').startsWith(slug) &&
      (!Number.isFinite(createdAt) || createdAt >= startedAt - 5_000)
    );
  });

  return related[0] || null;
}

async function fetchRuntimeConfig() {
  const response = await fetch(`${BACKEND}/api/oracle/internal/runtime`, {
    headers: runtimeHeaders(),
    signal: AbortSignal.timeout(5_000),
  });
  const text = await response.text();
  let parsed = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Oracle runtime config returned non-JSON: ${text.slice(0, 200)}`);
  }

  if (!response.ok || !parsed.success) {
    throw new Error(
      parsed?.error?.message || `Oracle runtime config failed with HTTP ${response.status}`
    );
  }

  const data = parsed.data || {};
  return {
    mode: normalizeString(data.mode) || 'profile',
    chatgptUrl: normalizeString(data.chatgptUrl) || CHATGPT_URL,
    remoteChrome: normalizeString(data.remoteChrome) || null,
    embeddedRemoteChrome: normalizeString(data.embeddedRemoteChrome) || null,
    chromeProfile: normalizeString(data.chromeProfile) || null,
    chromeCookiePath: normalizeString(data.chromeCookiePath) || null,
    manualLoginProfileDir: normalizeString(data.manualLoginProfileDir) || null,
  };
}

async function ensureEmbeddedBrowser(runtime) {
  if (runtime.mode !== 'manual' || runtime.embeddedRemoteChrome) {
    return runtime;
  }

  const response = await fetch(`${BACKEND}/api/oracle/internal/browser/start`, {
    method: 'POST',
    headers: runtimeHeaders(),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  let parsed = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Oracle embedded browser start returned non-JSON: ${text.slice(0, 200)}`);
  }

  if (!response.ok || !parsed.success) {
    throw new Error(
      parsed?.error?.message || `Oracle embedded browser start failed with HTTP ${response.status}`
    );
  }

  const data = parsed.data || {};
  const embeddedRemoteChrome = normalizeString(data.embeddedRemoteChrome);
  if (!embeddedRemoteChrome) {
    throw new Error(
      normalizeString(data.message) || 'Oracle embedded browser did not expose a DevTools target.'
    );
  }

  return {
    ...runtime,
    embeddedRemoteChrome,
    manualLoginProfileDir: normalizeString(data.profileDir) || runtime.manualLoginProfileDir,
  };
}

function resolveEngine(input) {
  const requested = normalizeString(input.engine).toLowerCase();
  if (requested === 'api' || requested === 'browser') return requested;

  const configured = normalizeString(
    RUNTIME_ENV.ORACLE_MCP_DEFAULT_ENGINE || RUNTIME_ENV.ORACLE_ENGINE
  ).toLowerCase();
  if (configured === 'api' || configured === 'browser') return configured;

  return 'browser';
}

function buildOracleArgs(input, runtime, outputPath, slug) {
  const prompt = normalizeString(input.prompt);
  const files = asArray(input.files)
    .map((entry) => normalizeString(entry))
    .filter(Boolean);
  const models = asArray(input.models)
    .map((entry) => normalizeString(entry))
    .filter(Boolean);
  const engine = models.length > 0 ? 'api' : resolveEngine(input);
  const browserModelLabel = normalizeString(input.browserModelLabel);
  const browserModelStrategy = normalizeBrowserModelStrategy(input.browserModelStrategy);
  const browserThinkingTime = normalizeBrowserThinkingTime(input.browserThinkingTime);
  const model = normalizeString(input.model);
  const requestedBrowserModel = browserModelLabel || model || DEFAULT_BROWSER_MODEL;
  const foldDefaultExtendedIntoBrowserModel =
    engine === 'browser' &&
    !browserModelLabel &&
    browserThinkingTime === 'extended' &&
    requestedBrowserModel.toLowerCase() === 'gpt-5.5-pro';
  const targetBrowserModel = foldDefaultExtendedIntoBrowserModel
    ? 'Pro Extended'
    : requestedBrowserModel;
  const browserThinkingAlreadyInModel =
    engine === 'browser' &&
    Boolean(browserThinkingTime) &&
    targetBrowserModel.toLowerCase().replace(/[_\s]+/g, '-').includes(browserThinkingTime);
  const args = [...ORACLE_BIN_PREFIX, '--prompt', prompt];

  for (const file of files) {
    args.push('--file', file);
  }

  if (slug) {
    args.push('--slug', slug);
  }

  if (models.length > 0) {
    args.push('--models', models.join(','));
  } else if (engine === 'browser') {
    if (targetBrowserModel) {
      args.push('--model', targetBrowserModel);
    }
  } else if (model) {
    args.push('--model', model);
  }

  args.push('--engine', engine, '--heartbeat', '0', '--wait', '--write-output', outputPath);

  if (typeof input.search === 'boolean') {
    args.push('--search', input.search ? 'on' : 'off');
  }

  if (engine === 'browser') {
    args.push('--chatgpt-url', runtime.chatgptUrl || CHATGPT_URL);
    args.push('--browser-model-strategy', browserModelStrategy);
    const browserTimeout = normalizeDurationOption(input.browserTimeout || DEFAULT_BROWSER_TIMEOUT);
    const browserInputTimeout = normalizeDurationOption(
      input.browserInputTimeout || DEFAULT_BROWSER_INPUT_TIMEOUT
    );
    if (browserTimeout) {
      args.push('--browser-timeout', browserTimeout);
    }
    if (browserInputTimeout) {
      args.push('--browser-input-timeout', browserInputTimeout);
    }
    if (browserThinkingTime && !browserThinkingAlreadyInModel) {
      args.push('--browser-thinking-time', browserThinkingTime);
    }

    if (runtime.mode === 'remote') {
      if (!runtime.remoteChrome) {
        throw new Error(
          'Oracle browser mode is set to remote Chrome, but no host:port target is configured in Settings.'
        );
      }
      args.push('--remote-chrome', runtime.remoteChrome);
    } else if (runtime.embeddedRemoteChrome) {
      args.push('--remote-chrome', runtime.embeddedRemoteChrome);
    } else if (runtime.mode === 'manual') {
      throw new Error(
        'Oracle is set to Embedded Browser mode, but no running embedded browser was found for this WebUI session. Open the session Browser tab, start it, sign into ChatGPT, then retry Oracle.'
      );
    } else {
      if (runtime.chromeProfile) {
        args.push('--browser-chrome-profile', runtime.chromeProfile);
      }
      if (runtime.chromeCookiePath) {
        args.push('--browser-cookie-path', runtime.chromeCookiePath);
      }
    }
  }

  return { args, engine };
}

async function spawnOracle(args, extraEnv = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(ORACLE_BIN, args, {
      cwd: process.cwd(),
      env: {
        ...RUNTIME_ENV,
        ...extraEnv,
        ORACLE_HOME_DIR,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      try {
        child.kill('SIGTERM');
      } catch {
        // Ignore timer cleanup failures.
      }
      reject(new Error('Oracle timed out before completing.'));
    }, ORACLE_TIMEOUT_MS);

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

function summarizeModels(metadata) {
  const modelEntries = Array.isArray(metadata?.models) ? metadata.models : [];
  return modelEntries.map((entry) => ({
    model: normalizeString(entry.model) || 'unknown',
    status: normalizeString(entry.status) || 'unknown',
    startedAt: typeof entry.startedAt === 'string' ? entry.startedAt : undefined,
    completedAt: typeof entry.completedAt === 'string' ? entry.completedAt : undefined,
    usage: typeof entry.usage === 'object' && entry.usage ? entry.usage : undefined,
    response: typeof entry.response === 'object' && entry.response ? entry.response : undefined,
    error: typeof entry.error === 'object' && entry.error ? entry.error : undefined,
    logPath: entry?.log?.path,
  }));
}

async function runConsult(input) {
  const prompt = normalizeString(input.prompt);
  if (!prompt) {
    throw new Error('Prompt is required.');
  }

  const runtime = await ensureEmbeddedBrowser(await fetchRuntimeConfig());
  const slug = normalizeString(input.slug) || defaultSlug();
  const startedAt = Date.now();
  await mkdir(TEMP_ROOT, { recursive: true });
  const tempDir = await mkdtemp(path.join(TEMP_ROOT, `${ensureDirName(slug)}-`));
  const outputPath = path.join(tempDir, 'assistant.txt');
  const extraEnv = {};

  if (runtime.mode === 'manual' && runtime.manualLoginProfileDir) {
    extraEnv.ORACLE_BROWSER_PROFILE_DIR = runtime.manualLoginProfileDir;
  }

  try {
    const { args, engine } = buildOracleArgs(input, runtime, outputPath, slug);
    log('consult start', { engine, slug, mode: runtime.mode, files: asArray(input.files).length });
    let result;
    try {
      result = await spawnOracle(args, extraEnv);
    } catch (error) {
      const sessionMeta = await findConsultSession({ slug, startedAt });
      const sessionId = sessionMeta?.id || slug;
      const sessionDetail = sessionMeta ? await readSessionDetail(sessionId) : null;
      const logTail = sessionDetail?.log ? sessionDetail.log.slice(-4_000).trim() : '';
      const message = error instanceof Error ? error.message : String(error);
      const output = [message, logTail].filter(Boolean).join('\n\n');
      return toolError(output, {
        sessionId,
        status: sessionMeta?.status || 'error',
        output,
        models: sessionMeta ? summarizeModels(sessionMeta) : undefined,
      });
    }
    const outputText = ((await safeReadText(outputPath)) || '').trim();
    const sessionMeta = await findConsultSession({ slug, startedAt });
    const sessionId = sessionMeta?.id || slug;
    const sessionDetail = sessionMeta ? await readSessionDetail(sessionId) : null;
    const logTail = sessionDetail?.log ? sessionDetail.log.slice(-4_000).trim() : '';
    const finalText = outputText || logTail || result.stdout.trim() || result.stderr.trim();

    if (result.code !== 0) {
      return toolError(
        finalText || `Oracle exited with code ${result.code}.`,
        sessionMeta
          ? {
              sessionId,
              status: sessionMeta.status || 'error',
              output: finalText,
              models: summarizeModels(sessionMeta),
            }
          : { sessionId, output: finalText }
      );
    }

    const metadata = sessionDetail?.metadata || sessionMeta || null;
    const status = normalizeString(metadata?.status) || 'completed';

    return {
      content: [{ type: 'text', text: finalText || '(Oracle returned no output.)' }],
      structuredContent: {
        sessionId,
        status,
        output: finalText,
        models: metadata ? summarizeModels(metadata) : undefined,
      },
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function listSessionsTool(args) {
  const id = normalizeString(args?.id);
  const detail = Boolean(args?.detail);
  const sessions = await listSessionMetadata();

  if (id) {
    const match = sessions.find(
      (entry) => entry.id === id || String(entry.id).startsWith(`${id}-`)
    );
    if (!match) {
      throw new Error(`Session "${id}" not found.`);
    }

    if (!detail) {
      return {
        content: [
          {
            type: 'text',
            text: `${match.createdAt} | ${match.status} | ${match.model || 'n/a'} | ${match.id}`,
          },
        ],
        structuredContent: {
          entries: [
            {
              id: match.id,
              createdAt: match.createdAt,
              status: match.status,
              model: match.model,
              mode: match.mode,
            },
          ],
          total: 1,
          truncated: false,
        },
      };
    }

    const detailPayload = await readSessionDetail(match.id);
    return {
      content: [{ type: 'text', text: detailPayload.log }],
      structuredContent: {
        session: {
          metadata: detailPayload.metadata,
          log: detailPayload.log,
          request: detailPayload.request,
        },
      },
    };
  }

  const filtered = filterSessions(sessions, {
    hours: Number.isFinite(args?.hours) ? Number(args.hours) : 24,
    limit: Number.isFinite(args?.limit) ? Number(args.limit) : 100,
    includeAll: Boolean(args?.includeAll),
  });

  return {
    content: [
      {
        type: 'text',
        text: filtered.entries
          .map(
            (entry) =>
              `${entry.createdAt} | ${entry.status} | ${entry.model || 'n/a'} | ${entry.id}`
          )
          .join('\n'),
      },
    ],
    structuredContent: {
      entries: filtered.entries.map((entry) => ({
        id: entry.id,
        createdAt: entry.createdAt,
        status: entry.status,
        model: entry.model,
        mode: entry.mode,
      })),
      total: filtered.total,
      truncated: filtered.truncated,
    },
  };
}

async function readResource(uriValue) {
  const uri = new URL(uriValue);
  if (uri.protocol !== 'oracle-session:') {
    throw new Error(`Unsupported resource URI: ${uriValue}`);
  }

  const sessionId = decodeURIComponent(uri.hostname || '');
  const kind = decodeURIComponent(uri.pathname.replace(/^\/+/, ''));
  if (!sessionId || !kind) {
    throw new Error('Oracle resource URI must include a session id and kind.');
  }

  const detail = await readSessionDetail(sessionId);
  let text;

  if (kind === 'metadata') {
    text = JSON.stringify(detail.metadata, null, 2);
  } else if (kind === 'log') {
    text = detail.log;
  } else if (kind === 'request') {
    text =
      typeof detail.request === 'string'
        ? detail.request
        : JSON.stringify(detail.request ?? null, null, 2);
  } else {
    throw new Error(`Unsupported Oracle resource kind: ${kind}`);
  }

  return {
    contents: [
      {
        uri: uriValue,
        text,
      },
    ],
  };
}

async function handleRequest(msg) {
  const { id, method, params } = msg;

  try {
    if (method === 'initialize') {
      return ok(id, {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: { listChanged: false },
          resources: { subscribe: false, listChanged: false },
        },
        serverInfo: { name: 'mcp-oracle-webui', version: '0.1.0' },
      });
    }

    if (method === 'notifications/initialized' || method === 'initialized') {
      return;
    }

    if (method === 'tools/list') {
      return ok(id, { tools: TOOLS });
    }

    if (method === 'tools/call') {
      const toolName = params?.name;
      const args = params?.arguments || {};

      try {
        if (toolName === 'consult') {
          return ok(id, await runConsult(args));
        }
        if (toolName === 'sessions') {
          return ok(id, await listSessionsTool(args));
        }
        return fail(id, -32601, `unknown tool: ${toolName}`);
      } catch (error) {
        log('tool error', toolName, error instanceof Error ? error.message : String(error));
        return ok(id, toolError(error instanceof Error ? error.message : String(error)));
      }
    }

    if (method === 'resources/list') {
      return ok(id, { resources: [] });
    }

    if (method === 'resources/templates/list') {
      return ok(id, { resourceTemplates: [RESOURCE_TEMPLATE] });
    }

    if (method === 'resources/read') {
      const uri = normalizeString(params?.uri);
      if (!uri) {
        return fail(id, -32602, 'missing resource uri');
      }
      return ok(id, await readResource(uri));
    }

    return fail(id, -32601, `method not found: ${method}`);
  } catch (error) {
    log('handler error', error instanceof Error ? error.message : String(error));
    return fail(id, -32603, error instanceof Error ? error.message : String(error));
  }
}

const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch (error) {
    log('parse error', error instanceof Error ? error.message : String(error), line.slice(0, 200));
    return;
  }
  void handleRequest(msg);
});

log(`ready (backend=${BACKEND}, session=${SESSION_ID || '<unset>'}, home=${ORACLE_HOME_DIR})`);
