#!/usr/bin/env node
// Minimal MCP stdio server for the local Vocarium stack.
// The actual API, GPU preflight, and smoke-test logic lives in the
// vocarium_audio.py helper; this file is only the JSON-RPC bridge.

import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const HELPER_CANDIDATES = [
  process.env.VOCARIUM_HELPER,
  '/app/scripts/vocarium-audio.py',
  fileURLToPath(new URL('../vocarium-audio.py', import.meta.url)),
].filter(Boolean);

const HELPER = HELPER_CANDIDATES.find((path) => existsSync(path)) || HELPER_CANDIDATES[0];
const PYTHON = process.env.PYTHON || 'python3';
const DEFAULT_TIMEOUT_MS = Number(process.env.VOCARIUM_MCP_TIMEOUT_MS || 900_000);
const MAINTENANCE_ENABLED = /^(1|true|yes|on)$/i.test(
  process.env.VOCARIUM_MAINTENANCE_ENABLED || ''
);
const MAINTENANCE_TOOLS = new Set([
  'vocarium_stack_status',
  'vocarium_tts_worker_smoke',
  'vocarium_podcast_smoke',
  'vocarium_integration_check',
]);

function runtimeUser() {
  const configured = String(process.env.VOCARIUM_USER || '').trim();
  if (configured && configured.toLowerCase() !== 'api') return configured;
  const sessionId = String(process.env.WEBUI_SESSION_ID || '').trim();
  if (!sessionId) return 'plum-cli';
  const digest = createHash('sha256').update(sessionId).digest('hex').slice(0, 16);
  return `plum-session-${digest}`;
}

const log = (...args) => console.error('[mcp-vocarium]', ...args);

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function ok(id, value) {
  send({ jsonrpc: '2.0', id, result: value });
}

function fail(id, code, message, data) {
  send({ jsonrpc: '2.0', id, error: { code, message, ...(data ? { data } : {}) } });
}

function outputPath(kind, format = 'wav') {
  const safeFormat =
    String(format || 'wav')
      .replace(/[^a-z0-9]/gi, '')
      .toLowerCase() || 'wav';
  return `/tmp/vocarium-${kind}-${Date.now()}-${randomBytes(4).toString('hex')}.${safeFormat}`;
}

function addFlag(argv, flag, value) {
  if (value === undefined || value === null || value === '') return;
  argv.push(flag, String(value));
}

function parseMaybeJson(text) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function asStructured(parsed, stdout, stderr) {
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return stderr ? { ...parsed, stderr } : parsed;
  }
  if (Array.isArray(parsed)) return { items: parsed, ...(stderr ? { stderr } : {}) };
  return { value: parsed ?? stdout, ...(stderr ? { stderr } : {}) };
}

function formatToolResult(label, stdout, stderr) {
  const parsed = parseMaybeJson(stdout);
  const body = parsed === null ? stdout.trim() : JSON.stringify(parsed, null, 2);
  const text = [label, body, stderr ? `stderr:\n${stderr.trim()}` : '']
    .filter((part) => part && part.trim())
    .join('\n');
  return {
    content: [{ type: 'text', text }],
    structuredContent: asStructured(parsed, stdout.trim(), stderr.trim()),
  };
}

function runHelper(argv, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!HELPER || !existsSync(HELPER)) {
    return Promise.resolve({
      returncode: 127,
      stdout: '',
      stderr: `Vocarium helper not found. Checked: ${HELPER_CANDIDATES.join(', ')}`,
    });
  }

  return new Promise((resolve) => {
    const env = {
      ...process.env,
      PYTHONUNBUFFERED: '1',
      VOCARIUM_HELPER: HELPER,
      VOCARIUM_API_URL: process.env.VOCARIUM_API_URL || 'http://localhost:8280',
      VOCARIUM_API_CONTAINER: process.env.VOCARIUM_API_CONTAINER || 'vocarium-api',
      VOCARIUM_TTS_CONTAINER: process.env.VOCARIUM_TTS_CONTAINER || 'qwen3-tts',
      VOCARIUM_USER: runtimeUser(),
      VOCARIUM_STACK_DIR: process.env.VOCARIUM_STACK_DIR || '/mnt/user/AI/plum-code/voxtral',
      GPUTASKS_URL: process.env.GPUTASKS_URL || 'http://host.docker.internal:3080',
      GPUTASKS_CONTAINER: process.env.GPUTASKS_CONTAINER || 'gpu-task-manager',
      VOCARIUM_MCP_SERVER:
        process.env.VOCARIUM_MCP_SERVER || '/app/scripts/mcp-servers/vocarium.mjs',
      VOCARIUM_TRANSPORT: process.env.VOCARIUM_TRANSPORT || 'auto',
      VOCARIUM_MAINTENANCE_ENABLED: MAINTENANCE_ENABLED ? '1' : '0',
    };

    const proc = spawn(PYTHON, [HELPER, ...argv], { env });
    const stdout = [];
    const stderr = [];
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGTERM');
      setTimeout(() => proc.kill('SIGKILL'), 5_000).unref();
    }, timeoutMs);

    proc.stdout.on('data', (chunk) => stdout.push(chunk));
    proc.stderr.on('data', (chunk) => stderr.push(chunk));
    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({ returncode: 1, stdout: '', stderr: err.message });
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      const out = Buffer.concat(stdout).toString('utf8');
      const err = Buffer.concat(stderr).toString('utf8');
      resolve({
        returncode: timedOut ? 124 : (code ?? 0),
        stdout: out,
        stderr: timedOut ? `${err}\nTimed out after ${timeoutMs} ms`.trim() : err,
      });
    });
  });
}

async function helperResult(label, argv, options) {
  log('run', argv.join(' '));
  const result = await runHelper(argv, options);
  const payload = formatToolResult(label, result.stdout, result.stderr);
  if (result.returncode !== 0) {
    return {
      ...payload,
      isError: true,
      structuredContent: {
        ...payload.structuredContent,
        returncode: result.returncode,
      },
    };
  }
  return payload;
}

const ALL_TOOLS = [
  {
    name: 'vocarium_health',
    description: 'Check Vocarium API, queue, resource, music, and SFX health.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'vocarium_stack_status',
    description:
      'Administrative: run docker compose ps in the configured Vocarium stack directory.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'vocarium_gpu_status',
    description: 'Read GPU and VRAM state from gpu-task-manager.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'vocarium_preflight',
    description: 'Check whether a Vocarium job kind is allowed before generation.',
    inputSchema: {
      type: 'object',
      required: ['kind'],
      properties: {
        kind: { type: 'string', enum: ['tts', 'asr', 'music', 'sfx'] },
        target: { type: 'string', description: 'auto, 3060, 5060, or GPU index.' },
      },
    },
  },
  {
    name: 'vocarium_voices',
    description: 'List Vocarium voices, optionally filtered by source.',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', enum: ['clone', 'custom', 'design'] },
      },
    },
  },
  {
    name: 'vocarium_tts',
    description: 'Generate speech through Vocarium after GPU preflight.',
    inputSchema: {
      type: 'object',
      required: ['text'],
      properties: {
        text: { type: 'string', minLength: 1 },
        voice: { type: 'string', default: 'default' },
        source: { type: 'string', enum: ['clone', 'custom', 'designed'], default: 'clone' },
        model: { type: 'string', default: 'tts-1' },
        format: { type: 'string', default: 'wav' },
        out: { type: 'string', description: 'Output path. Defaults to /tmp/vocarium-tts-*.wav.' },
      },
    },
  },
  {
    name: 'vocarium_tts_worker_smoke',
    description: 'Administrative: smoke-test the direct qwen3-tts worker.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', default: 'Kurzer Test.' },
        speaker: { type: 'string', default: 'Vivian' },
        language: { type: 'string', default: 'German' },
        instruct: { type: 'string' },
        format: { type: 'string', default: 'wav' },
        out: { type: 'string' },
        timeout: { type: 'integer', minimum: 1, default: 900 },
        invalid_format_check: { type: 'boolean', default: false },
        skip_preflight: { type: 'boolean', default: false },
      },
    },
  },
  {
    name: 'vocarium_sfx',
    description: 'Generate a short sound effect through Vocarium after GPU preflight.',
    inputSchema: {
      type: 'object',
      required: ['prompt'],
      properties: {
        prompt: { type: 'string', minLength: 1 },
        negative_prompt: { type: 'string', default: 'speech, music' },
        duration: { type: 'number', default: 2 },
        cfg_strength: { type: 'number', default: 4.5 },
        num_steps: { type: 'integer', default: 25 },
        out: { type: 'string' },
      },
    },
  },
  {
    name: 'vocarium_music',
    description: 'Generate a short music clip through Vocarium after GPU preflight.',
    inputSchema: {
      type: 'object',
      required: ['prompt'],
      properties: {
        prompt: { type: 'string', minLength: 1 },
        lyrics: { type: 'string' },
        duration: { type: 'integer', default: 10 },
        thinking: { type: 'boolean', default: false },
        format: { type: 'string', default: 'wav' },
        out: { type: 'string' },
      },
    },
  },
  {
    name: 'vocarium_transcribe',
    description: 'Transcribe an audio file through Vocarium ASR after GPU preflight.',
    inputSchema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', minLength: 1 },
        model: { type: 'string', default: 'whisper-1' },
        response_format: { type: 'string', enum: ['json', 'text'], default: 'json' },
        out: { type: 'string' },
      },
    },
  },
  {
    name: 'vocarium_podcast_smoke',
    description: 'Administrative: create and delete temporary Podcast Studio records.',
    inputSchema: {
      type: 'object',
      properties: {
        topic: { type: 'string', default: 'Plum Code integration smoke' },
        host_name: { type: 'string', default: 'Plum Smoke Host' },
      },
    },
  },
  {
    name: 'vocarium_integration_check',
    description:
      'Administrative: verify helper syntax, MCP handshake, and local config references.',
    inputSchema: {
      type: 'object',
      properties: {
        mcp_path: { type: 'string', default: '/app/scripts/mcp-servers/vocarium.mjs' },
      },
    },
  },
];

const TOOLS = ALL_TOOLS.filter((tool) => MAINTENANCE_ENABLED || !MAINTENANCE_TOOLS.has(tool.name));

async function runTool(name, args = {}) {
  if (MAINTENANCE_TOOLS.has(name) && !MAINTENANCE_ENABLED) {
    throw new Error(
      `${name} is an administrative maintenance tool; set VOCARIUM_MAINTENANCE_ENABLED=1 in the server environment to expose it`
    );
  }
  switch (name) {
    case 'vocarium_health':
      return helperResult('Vocarium health', ['health'], { timeoutMs: 60_000 });
    case 'vocarium_stack_status':
      return helperResult('Vocarium stack status', ['stack-status'], { timeoutMs: 60_000 });
    case 'vocarium_gpu_status':
      return helperResult('Vocarium GPU status', ['gpu-status'], { timeoutMs: 45_000 });
    case 'vocarium_preflight': {
      const argv = ['preflight', '--kind', String(args.kind || '')];
      addFlag(argv, '--target', args.target || 'auto');
      return helperResult('Vocarium preflight', argv, { timeoutMs: 60_000 });
    }
    case 'vocarium_voices': {
      const argv = ['voices'];
      addFlag(argv, '--source', args.source);
      return helperResult('Vocarium voices', argv, { timeoutMs: 90_000 });
    }
    case 'vocarium_tts': {
      const format = args.format || 'wav';
      const argv = ['tts', '--text', String(args.text || '')];
      addFlag(argv, '--voice', args.voice || 'default');
      addFlag(argv, '--source', args.source || 'clone');
      addFlag(argv, '--model', args.model || 'tts-1');
      addFlag(argv, '--format', format);
      addFlag(argv, '--out', args.out || outputPath('tts', format));
      return helperResult('Vocarium TTS', argv);
    }
    case 'vocarium_tts_worker_smoke': {
      const format = args.format || 'wav';
      const argv = ['tts-worker-smoke'];
      addFlag(argv, '--text', args.text || 'Kurzer Test.');
      addFlag(argv, '--speaker', args.speaker || 'Vivian');
      addFlag(argv, '--language', args.language || 'German');
      addFlag(argv, '--instruct', args.instruct);
      addFlag(argv, '--format', format);
      addFlag(argv, '--out', args.out || outputPath('tts-worker-smoke', format));
      addFlag(argv, '--timeout', args.timeout || 900);
      if (args.invalid_format_check) argv.push('--invalid-format-check');
      if (args.skip_preflight) argv.push('--skip-preflight');
      return helperResult('Vocarium TTS worker smoke', argv);
    }
    case 'vocarium_sfx': {
      const argv = ['sfx', '--prompt', String(args.prompt || '')];
      addFlag(argv, '--negative-prompt', args.negative_prompt ?? 'speech, music');
      addFlag(argv, '--duration', args.duration ?? 2);
      addFlag(argv, '--cfg-strength', args.cfg_strength ?? 4.5);
      addFlag(argv, '--num-steps', args.num_steps ?? 25);
      addFlag(argv, '--out', args.out || outputPath('sfx', 'wav'));
      return helperResult('Vocarium SFX', argv);
    }
    case 'vocarium_music': {
      const format = args.format || 'wav';
      const argv = ['music', '--prompt', String(args.prompt || '')];
      addFlag(argv, '--lyrics', args.lyrics);
      addFlag(argv, '--duration', args.duration || 10);
      addFlag(argv, '--format', format);
      addFlag(argv, '--out', args.out || outputPath('music', format));
      if (args.thinking) argv.push('--thinking');
      return helperResult('Vocarium music', argv, { timeoutMs: 1_500_000 });
    }
    case 'vocarium_transcribe': {
      const argv = ['transcribe', '--file', String(args.file || '')];
      addFlag(argv, '--model', args.model || 'whisper-1');
      addFlag(argv, '--response-format', args.response_format || 'json');
      addFlag(argv, '--out', args.out);
      return helperResult('Vocarium transcribe', argv, { timeoutMs: 1_200_000 });
    }
    case 'vocarium_podcast_smoke': {
      const argv = ['podcast-smoke'];
      addFlag(argv, '--topic', args.topic || 'Plum Code integration smoke');
      addFlag(argv, '--host-name', args.host_name || 'Plum Smoke Host');
      return helperResult('Vocarium podcast smoke', argv, { timeoutMs: 180_000 });
    }
    case 'vocarium_integration_check': {
      const argv = ['integration-check'];
      addFlag(
        argv,
        '--mcp-path',
        args.mcp_path || process.env.VOCARIUM_MCP_SERVER || '/app/scripts/mcp-servers/vocarium.mjs'
      );
      return helperResult('Vocarium integration check', argv, { timeoutMs: 60_000 });
    }
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

async function handleRequest(msg) {
  const { id, method, params } = msg;
  if (method === 'initialize') {
    return ok(id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'mcp-vocarium', version: '0.1.0' },
    });
  }
  if (method === 'tools/list') return ok(id, { tools: TOOLS });
  if (method === 'tools/call') {
    const name = params?.name;
    const args = params?.arguments || {};
    return ok(id, await runTool(name, args));
  }
  if (id !== undefined) return fail(id, -32601, `method not found: ${method}`);
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on('line', async (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch (err) {
    return fail(null, -32700, `parse error: ${err.message}`);
  }
  try {
    await handleRequest(msg);
  } catch (err) {
    if (msg?.id !== undefined) fail(msg.id, -32000, err.message || String(err));
  }
});
