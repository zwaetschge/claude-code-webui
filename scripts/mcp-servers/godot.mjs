#!/usr/bin/env node
// Godot MCP bridge for Plum Code WebUI.
//
// The server is intentionally zero-dependency. It can scaffold and inspect
// Godot projects directly, and uses a Godot binary for validation, script runs,
// and exports when GODOT_BIN/godot/godot4 is available.

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync, readFileSync } from 'node:fs';
import { access, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { constants as FS_CONSTANTS } from 'node:fs';
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

const RUNTIME_ENV = { ...readParentEnv(), ...process.env };
const WORKSPACE_ROOT = (
  RUNTIME_ENV.WORKSPACE_ROOT ||
  RUNTIME_ENV.WEBUI_WORKSPACE_ROOT ||
  '/workspace'
).replace(/\/$/, '');
const DEFAULT_TIMEOUT_MS = Number(RUNTIME_ENV.GODOT_TIMEOUT_MS || 120_000);
const MAX_OUTPUT_CHARS = Number(RUNTIME_ENV.GODOT_MCP_MAX_OUTPUT_CHARS || 120_000);

const log = (...args) => console.error('[mcp-godot]', ...args);

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function ok(id, value) {
  send({ jsonrpc: '2.0', id, result: value });
}

function fail(id, code, message, data) {
  send({ jsonrpc: '2.0', id, error: { code, message, ...(data ? { data } : {}) } });
}

function asText(label, payload, isError = false) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
  const structuredContent =
    payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : { value: payload };
  return {
    content: [{ type: 'text', text: `${label}\n${body}` }],
    structuredContent,
    ...(isError ? { isError: true } : {}),
  };
}

function clampTimeout(value) {
  const parsed = Number(value || DEFAULT_TIMEOUT_MS);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.min(parsed, 15 * 60_000);
}

function appendCapped(current, chunk) {
  if (current.length >= MAX_OUTPUT_CHARS) return current;
  const next = current + chunk.toString();
  return next.length > MAX_OUTPUT_CHARS ? next.slice(0, MAX_OUTPUT_CHARS) : next;
}

function resolvePath(input, fallback = WORKSPACE_ROOT) {
  const raw = String(input || '').trim();
  if (!raw) return path.resolve(fallback);
  return path.resolve(path.isAbsolute(raw) ? raw : path.join(fallback, raw));
}

function safeProjectName(value) {
  const name = String(value || 'Godot Game').trim().replace(/"/g, '');
  return name || 'Godot Game';
}

async function executableExists(file) {
  if (!file.includes('/')) return true;
  try {
    await access(file, FS_CONSTANTS.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function runProcess(command, args, opts = {}) {
  const timeoutMs = clampTimeout(opts.timeoutMs);
  return await new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    const child = spawn(command, args, {
      cwd: opts.cwd || WORKSPACE_ROOT,
      env: { ...RUNTIME_ENV, ...(opts.env || {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 2_000).unref();
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout = appendCapped(stdout, chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr = appendCapped(stderr, chunk);
    });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr, timedOut, command, args });
    });
  });
}

async function findGodot() {
  const configured = String(RUNTIME_ENV.GODOT_BIN || '').trim();
  const candidates = configured
    ? [configured]
    : ['godot', 'godot4', '/usr/local/bin/godot', '/usr/local/bin/godot4', '/usr/bin/godot', '/usr/bin/godot4'];

  const failures = [];
  for (const candidate of candidates) {
    if (!(await executableExists(candidate))) {
      failures.push({ candidate, error: 'not executable' });
      continue;
    }
    try {
      const result = await runProcess(candidate, ['--version'], { timeoutMs: 5_000 });
      const version = `${result.stdout}${result.stderr}`.trim().split('\n')[0] || 'unknown';
      return { available: true, binary: candidate, version, probe: result };
    } catch (err) {
      failures.push({ candidate, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return {
    available: false,
    binary: configured || null,
    message:
      'Godot binary not found. Set GODOT_BIN to a Godot 4 headless/editor binary mounted in the WebUI container.',
    failures,
  };
}

async function walkProject(root, limit = 500) {
  const result = {
    scenes: [],
    scripts: [],
    resources: [],
    addons: [],
    other: [],
    truncated: false,
  };
  const stack = [''];

  while (stack.length > 0) {
    const rel = stack.pop();
    const abs = path.join(root, rel || '');
    let entries;
    try {
      entries = await readdir(abs, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.name === '.godot' || entry.name === '.import' || entry.name === '.git') continue;
      const childRel = rel ? path.join(rel, entry.name) : entry.name;
      if (entry.isDirectory()) {
        if (childRel.startsWith('addons')) result.addons.push(childRel);
        stack.push(childRel);
        continue;
      }

      const ext = path.extname(entry.name).toLowerCase();
      const target =
        ext === '.tscn' || ext === '.scn'
          ? result.scenes
          : ext === '.gd' || ext === '.cs'
            ? result.scripts
            : ['.tres', '.res', '.json', '.toml', '.cfg', '.import'].includes(ext)
              ? result.resources
              : result.other;
      target.push(childRel);
      const count =
        result.scenes.length +
        result.scripts.length +
        result.resources.length +
        result.addons.length +
        result.other.length;
      if (count >= limit) {
        result.truncated = true;
        return result;
      }
    }
  }

  result.scenes.sort();
  result.scripts.sort();
  result.resources.sort();
  result.addons.sort();
  result.other.sort();
  return result;
}

async function readProjectConfig(projectPath) {
  const file = path.join(projectPath, 'project.godot');
  try {
    const raw = await readFile(file, 'utf8');
    const nameMatch = raw.match(/config\/name\s*=\s*"([^"]+)"/);
    const mainSceneMatch = raw.match(/run\/main_scene\s*=\s*"([^"]+)"/);
    return {
      exists: true,
      file,
      name: nameMatch?.[1] || null,
      mainScene: mainSceneMatch?.[1] || null,
      bytes: raw.length,
    };
  } catch {
    return { exists: false, file, name: null, mainScene: null, bytes: 0 };
  }
}

async function toolInfo(args = {}) {
  const projectPath = args.project_path ? resolvePath(args.project_path) : null;
  const godot = await findGodot();
  const project = projectPath
    ? {
        path: projectPath,
        config: await readProjectConfig(projectPath),
        files: existsSync(projectPath) ? await walkProject(projectPath) : null,
      }
    : null;
  return asText('Godot MCP info', { godot, project, workspaceRoot: WORKSPACE_ROOT });
}

async function toolCreateProject(args = {}) {
  const projectPath = resolvePath(args.project_path);
  const name = safeProjectName(args.name);
  const overwrite = args.overwrite === true;
  const projectFile = path.join(projectPath, 'project.godot');

  if (existsSync(projectFile) && !overwrite) {
    throw new Error(`project.godot already exists at ${projectFile}; pass overwrite=true to replace starter files`);
  }

  await mkdir(path.join(projectPath, 'scenes'), { recursive: true });
  await mkdir(path.join(projectPath, 'scripts'), { recursive: true });
  await mkdir(path.join(projectPath, 'assets'), { recursive: true });

  const projectConfig = [
    'config_version=5',
    '',
    '[application]',
    `config/name="${name}"`,
    'run/main_scene="res://scenes/Main.tscn"',
    'config/features=PackedStringArray("4.x")',
    '',
    '[display]',
    'window/size/viewport_width=1280',
    'window/size/viewport_height=720',
    'window/stretch/mode="canvas_items"',
    'window/stretch/aspect="expand"',
    '',
    '[rendering]',
    'renderer/rendering_method="gl_compatibility"',
    'renderer/rendering_method.mobile="gl_compatibility"',
    '',
  ].join('\n');

  const mainScene = [
    '[gd_scene load_steps=2 format=3]',
    '',
    '[ext_resource type="Script" path="res://scripts/main.gd" id="1"]',
    '',
    '[node name="Main" type="Node2D"]',
    'script = ExtResource("1")',
    '',
  ].join('\n');

  const mainScript = [
    'extends Node2D',
    '',
    'func _ready() -> void:',
    `\tprint("${name} ready")`,
    '',
  ].join('\n');

  await writeFile(projectFile, projectConfig, 'utf8');
  await writeFile(path.join(projectPath, 'scenes', 'Main.tscn'), mainScene, 'utf8');
  await writeFile(path.join(projectPath, 'scripts', 'main.gd'), mainScript, 'utf8');

  return asText('Godot project created', {
    projectPath,
    name,
    files: [
      path.join(projectPath, 'project.godot'),
      path.join(projectPath, 'scenes', 'Main.tscn'),
      path.join(projectPath, 'scripts', 'main.gd'),
    ],
  });
}

async function toolListProject(args = {}) {
  const projectPath = resolvePath(args.project_path);
  return asText('Godot project files', {
    projectPath,
    config: await readProjectConfig(projectPath),
    files: await walkProject(projectPath, Number(args.limit || 500)),
  });
}

async function requireGodotBinary() {
  const godot = await findGodot();
  if (!godot.available) {
    const err = new Error(godot.message);
    err.details = godot;
    throw err;
  }
  return godot;
}

async function toolValidateProject(args = {}) {
  const projectPath = resolvePath(args.project_path);
  const godot = await requireGodotBinary();
  const result = await runProcess(godot.binary, ['--headless', '--path', projectPath, '--quit'], {
    cwd: projectPath,
    timeoutMs: args.timeout_ms,
  });
  return asText(
    'Godot validation finished',
    { projectPath, godot: { binary: godot.binary, version: godot.version }, result },
    result.code !== 0 || result.timedOut
  );
}

async function toolRunGdscript(args = {}) {
  const projectPath = resolvePath(args.project_path);
  const godot = await requireGodotBinary();
  let scriptPath = args.script_path ? resolvePath(args.script_path, projectPath) : '';
  let tempDir = '';

  if (!scriptPath) {
    const source = String(args.script || '').trim();
    if (!source) throw new Error('script or script_path is required');
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'plum-godot-mcp-'));
    scriptPath = path.join(tempDir, 'run.gd');
    await writeFile(scriptPath, source, 'utf8');
  }

  try {
    const extraArgs = Array.isArray(args.extra_args)
      ? args.extra_args.filter((item) => typeof item === 'string')
      : [];
    const result = await runProcess(
      godot.binary,
      ['--headless', '--path', projectPath, '--script', scriptPath, ...extraArgs],
      { cwd: projectPath, timeoutMs: args.timeout_ms }
    );
    return asText(
      'Godot script finished',
      { projectPath, scriptPath, godot: { binary: godot.binary, version: godot.version }, result },
      result.code !== 0 || result.timedOut
    );
  } finally {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  }
}

async function toolExportProject(args = {}) {
  const projectPath = resolvePath(args.project_path);
  const preset = String(args.preset || '').trim();
  if (!preset) throw new Error('preset is required');
  const outputPath = resolvePath(args.output_path, projectPath);
  await mkdir(path.dirname(outputPath), { recursive: true });

  const godot = await requireGodotBinary();
  const exportMode = args.debug === true ? '--export-debug' : '--export-release';
  const result = await runProcess(
    godot.binary,
    ['--headless', '--path', projectPath, exportMode, preset, outputPath],
    { cwd: projectPath, timeoutMs: args.timeout_ms || 10 * 60_000 }
  );
  return asText(
    'Godot export finished',
    { projectPath, preset, outputPath, mode: exportMode, godot: { binary: godot.binary, version: godot.version }, result },
    result.code !== 0 || result.timedOut
  );
}

const TOOLS = [
  {
    name: 'godot_info',
    description:
      'Report Godot binary availability/version and optionally summarize a Godot project. Set GODOT_BIN when no godot/godot4 binary is on PATH.',
    inputSchema: {
      type: 'object',
      properties: {
        project_path: { type: 'string', description: 'Optional project directory. Relative paths resolve under /workspace.' },
      },
    },
  },
  {
    name: 'godot_create_project',
    description:
      'Create a minimal Godot 4 project with project.godot, scenes/Main.tscn, scripts/main.gd, and assets/. Does not require a Godot binary.',
    inputSchema: {
      type: 'object',
      required: ['project_path'],
      properties: {
        project_path: { type: 'string', description: 'Project directory. Relative paths resolve under /workspace.' },
        name: { type: 'string', description: 'Godot application name.' },
        overwrite: { type: 'boolean', description: 'Replace starter files if project.godot already exists.' },
      },
    },
  },
  {
    name: 'godot_list_project',
    description: 'List scenes, scripts, resources, addons, and project.godot metadata for a Godot project.',
    inputSchema: {
      type: 'object',
      required: ['project_path'],
      properties: {
        project_path: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 2000 },
      },
    },
  },
  {
    name: 'godot_validate_project',
    description: 'Run Godot headless against a project to catch parse/import/startup errors. Requires GODOT_BIN or godot/godot4 on PATH.',
    inputSchema: {
      type: 'object',
      required: ['project_path'],
      properties: {
        project_path: { type: 'string' },
        timeout_ms: { type: 'integer', minimum: 1000, maximum: 900000 },
      },
    },
  },
  {
    name: 'godot_run_gdscript',
    description:
      'Run a GDScript file or inline GDScript with Godot headless. Useful for editor automation, import checks, and scripted project edits.',
    inputSchema: {
      type: 'object',
      required: ['project_path'],
      properties: {
        project_path: { type: 'string' },
        script_path: { type: 'string', description: 'Existing .gd script path.' },
        script: { type: 'string', description: 'Inline GDScript source. Use extends SceneTree for one-shot scripts.' },
        extra_args: { type: 'array', items: { type: 'string' } },
        timeout_ms: { type: 'integer', minimum: 1000, maximum: 900000 },
      },
    },
  },
  {
    name: 'godot_export_project',
    description: 'Run a Godot export preset in headless mode. Requires export_presets.cfg and a Godot binary.',
    inputSchema: {
      type: 'object',
      required: ['project_path', 'preset', 'output_path'],
      properties: {
        project_path: { type: 'string' },
        preset: { type: 'string' },
        output_path: { type: 'string' },
        debug: { type: 'boolean', description: 'Use --export-debug instead of --export-release.' },
        timeout_ms: { type: 'integer', minimum: 1000, maximum: 900000 },
      },
    },
  },
];

async function runTool(name, args) {
  switch (name) {
    case 'godot_info':
      return await toolInfo(args);
    case 'godot_create_project':
      return await toolCreateProject(args);
    case 'godot_list_project':
      return await toolListProject(args);
    case 'godot_validate_project':
      return await toolValidateProject(args);
    case 'godot_run_gdscript':
      return await toolRunGdscript(args);
    case 'godot_export_project':
      return await toolExportProject(args);
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
let pendingRequests = 0;
let inputClosed = false;

function maybeExit() {
  if (inputClosed && pendingRequests === 0) process.exit(0);
}

rl.on('line', async (line) => {
  if (!line.trim()) return;
  pendingRequests += 1;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    pendingRequests -= 1;
    maybeExit();
    return;
  }

  const id = msg.id;
  try {
    if (msg.method === 'initialize') {
      ok(id, {
        protocolVersion: msg.params?.protocolVersion || '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'mcp-godot-webui', version: '0.1.0' },
      });
      return;
    }
    if (msg.method === 'tools/list') {
      ok(id, { tools: TOOLS });
      return;
    }
    if (msg.method === 'tools/call') {
      const { name, arguments: args = {} } = msg.params || {};
      const value = await runTool(name, args);
      ok(id, value);
      return;
    }
    if (msg.method === 'ping') {
      ok(id, {});
      return;
    }
    if (!msg.method?.startsWith('notifications/')) {
      fail(id, -32601, `Unknown method: ${msg.method}`);
    }
  } catch (err) {
    log('tool failed', err);
    const details = err?.details;
    ok(id, asText('Godot MCP error', { message: err instanceof Error ? err.message : String(err), details }, true));
  } finally {
    pendingRequests -= 1;
    maybeExit();
  }
});

rl.on('close', () => {
  inputClosed = true;
  maybeExit();
});
