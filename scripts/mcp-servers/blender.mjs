#!/usr/bin/env node
// Blender MCP bridge for Plum Code WebUI.
//
// Runs Blender in background/headless mode so sessions can create, inspect,
// save, export, and render 3D assets through Blender Python.

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { constants as FS_CONSTANTS, existsSync, readFileSync } from 'node:fs';
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
const DEFAULT_TIMEOUT_MS = Number(RUNTIME_ENV.BLENDER_TIMEOUT_MS || 300_000);
const MAX_OUTPUT_CHARS = Number(RUNTIME_ENV.BLENDER_MCP_MAX_OUTPUT_CHARS || 200_000);

const log = (...args) => console.error('[mcp-blender]', ...args);

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
  return Math.min(parsed, 30 * 60_000);
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

async function findBlender() {
  const configured = String(RUNTIME_ENV.BLENDER_BIN || '').trim();
  const candidates = configured
    ? [configured]
    : [
        'blender-headless',
        'blender',
        '/usr/bin/blender-headless',
        '/usr/bin/blender',
        '/usr/local/bin/blender-headless',
        '/usr/local/bin/blender',
      ];

  const failures = [];
  for (const candidate of candidates) {
    if (!(await executableExists(candidate))) {
      failures.push({ candidate, error: 'not executable' });
      continue;
    }
    try {
      const result = await runProcess(candidate, ['--version'], { timeoutMs: 8_000 });
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
      'Blender binary not found. Install blender-headless in the WebUI image or set BLENDER_BIN to a mounted Blender binary.',
    failures,
  };
}

async function requireBlenderBinary() {
  const blender = await findBlender();
  if (!blender.available) {
    const err = new Error(blender.message);
    err.details = blender;
    throw err;
  }
  return blender;
}

function buildPythonWrapper(userPython, opts = {}) {
  const clearScene = opts.clearScene === true;
  const outputPath = opts.outputPath || '';
  const autoSaveOutput = opts.autoSaveOutput !== false;
  return [
    'import json',
    'import os',
    'import sys',
    'import traceback',
    'import bpy',
    '',
    `WEBUI_OUTPUT_PATH = ${JSON.stringify(outputPath)}`,
    '',
    clearScene
      ? [
          'bpy.ops.object.select_all(action="SELECT")',
          'bpy.ops.object.delete()',
          '',
        ].join('\n')
      : '',
    'if WEBUI_OUTPUT_PATH:',
    '    os.makedirs(os.path.dirname(WEBUI_OUTPUT_PATH) or ".", exist_ok=True)',
    '',
    `USER_CODE = ${JSON.stringify(userPython)}`,
    'try:',
    '    exec(compile(USER_CODE, "<webui-blender-python>", "exec"), globals(), globals())',
    autoSaveOutput ? '    if WEBUI_OUTPUT_PATH:' : '    if False:',
    '        ext = os.path.splitext(WEBUI_OUTPUT_PATH)[1].lower()',
    '        if ext == ".blend":',
    '            bpy.ops.wm.save_as_mainfile(filepath=WEBUI_OUTPUT_PATH)',
    '        elif ext in (".glb", ".gltf"):',
    '            bpy.ops.export_scene.gltf(filepath=WEBUI_OUTPUT_PATH, export_format="GLB" if ext == ".glb" else "GLTF_SEPARATE")',
    '        elif ext == ".obj":',
    '            if hasattr(bpy.ops.wm, "obj_export"):',
    '                bpy.ops.wm.obj_export(filepath=WEBUI_OUTPUT_PATH)',
    '            else:',
    '                bpy.ops.export_scene.obj(filepath=WEBUI_OUTPUT_PATH)',
    '        elif ext == ".stl":',
    '            bpy.ops.export_mesh.stl(filepath=WEBUI_OUTPUT_PATH)',
    '        elif ext in (".fbx",):',
    '            bpy.ops.export_scene.fbx(filepath=WEBUI_OUTPUT_PATH)',
    '        else:',
    '            bpy.ops.wm.save_as_mainfile(filepath=WEBUI_OUTPUT_PATH)',
    '    summary = {',
    '        "objects": len(bpy.data.objects),',
    '        "meshes": len(bpy.data.meshes),',
    '        "materials": len(bpy.data.materials),',
    '        "collections": len(bpy.data.collections),',
    '        "outputPath": WEBUI_OUTPUT_PATH or None,',
    '    }',
    '    print("__WEBUI_BLENDER_RESULT__" + json.dumps(summary, sort_keys=True))',
    'except Exception:',
    '    traceback.print_exc()',
    '    sys.exit(1)',
    '',
  ].join('\n');
}

async function runBlenderPython(args = {}, opts = {}) {
  const blender = await requireBlenderBinary();
  const python = String(args.python || args.script || '').trim();
  if (!python) throw new Error('python is required');

  const outputPath = args.output_path ? resolvePath(args.output_path) : '';
  if (outputPath) await mkdir(path.dirname(outputPath), { recursive: true });

  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'plum-blender-mcp-'));
  const scriptPath = path.join(tempDir, 'run.py');
  await writeFile(
    scriptPath,
    buildPythonWrapper(python, {
      outputPath,
      clearScene: opts.defaultClearScene === true ? args.clear_scene !== false : args.clear_scene === true,
      autoSaveOutput: opts.autoSaveOutput,
    }),
    'utf8'
  );

  const blendFile = args.blend_file ? resolvePath(args.blend_file) : '';
  const argv = ['--background'];
  if (blendFile) {
    argv.push(blendFile);
  } else {
    argv.push('--factory-startup');
  }
  argv.push('--python', scriptPath);

  try {
    const result = await runProcess(blender.binary, argv, { timeoutMs: args.timeout_ms });
    return {
      blender: { binary: blender.binary, version: blender.version },
      scriptPath,
      blendFile: blendFile || null,
      outputPath: outputPath || null,
      outputExists: outputPath ? existsSync(outputPath) : null,
      result,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function toolInfo() {
  const blender = await findBlender();
  return asText('Blender MCP info', { blender, workspaceRoot: WORKSPACE_ROOT });
}

async function toolRunPython(args = {}) {
  const data = await runBlenderPython(args);
  return asText(
    'Blender Python finished',
    data,
    data.result.code !== 0 || data.result.timedOut || (data.outputPath ? !data.outputExists : false)
  );
}

async function toolCreateAsset(args = {}) {
  if (!args.output_path) throw new Error('output_path is required');
  const data = await runBlenderPython(args, { defaultClearScene: true });
  return asText(
    'Blender asset created',
    data,
    data.result.code !== 0 || data.result.timedOut || !data.outputExists
  );
}

async function toolInspectFile(args = {}) {
  const blender = await requireBlenderBinary();
  const filePath = resolvePath(args.file_path);
  if (!existsSync(filePath)) throw new Error(`file not found: ${filePath}`);
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'plum-blender-inspect-'));
  const scriptPath = path.join(tempDir, 'inspect.py');
  const script = [
    'import json',
    'import bpy',
    'objects = []',
    'for obj in bpy.data.objects:',
    '    polygons = len(obj.data.polygons) if getattr(obj, "data", None) and hasattr(obj.data, "polygons") else 0',
    '    objects.append({"name": obj.name, "type": obj.type, "polygons": polygons})',
    'summary = {',
    '    "objects": objects,',
    '    "objectCount": len(bpy.data.objects),',
    '    "meshCount": len(bpy.data.meshes),',
    '    "materialCount": len(bpy.data.materials),',
    '    "cameraCount": len([o for o in bpy.data.objects if o.type == "CAMERA"]),',
    '    "lightCount": len([o for o in bpy.data.objects if o.type == "LIGHT"]),',
    '}',
    'print("__WEBUI_BLENDER_INSPECT__" + json.dumps(summary, sort_keys=True))',
    '',
  ].join('\n');

  try {
    await writeFile(scriptPath, script, 'utf8');
    const result = await runProcess(blender.binary, ['--background', filePath, '--python', scriptPath], {
      timeoutMs: args.timeout_ms || 120_000,
    });
    let summary = null;
    const marker = '__WEBUI_BLENDER_INSPECT__';
    const line = result.stdout
      .split('\n')
      .find((entry) => entry.startsWith(marker));
    if (line) {
      try {
        summary = JSON.parse(line.slice(marker.length));
      } catch {
        summary = null;
      }
    }
    return asText(
      'Blender file inspected',
      { filePath, blender: { binary: blender.binary, version: blender.version }, summary, result },
      result.code !== 0 || result.timedOut
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function toolRenderPreview(args = {}) {
  const outputPath = resolvePath(args.output_path || `blender-preview-${Date.now()}.png`);
  const blendFile = args.blend_file ? resolvePath(args.blend_file) : '';
  const resolution = Number(args.resolution || 1024);
  const python = [
    `bpy.context.scene.render.filepath = ${JSON.stringify(outputPath)}`,
    `bpy.context.scene.render.resolution_x = ${Math.max(128, Math.min(resolution, 4096))}`,
    `bpy.context.scene.render.resolution_y = ${Math.max(128, Math.min(resolution, 4096))}`,
    'if not bpy.context.scene.camera:',
    '    bpy.ops.object.light_add(type="AREA", location=(0, -3, 5))',
    '    bpy.context.object.name = "Preview_Area_Light"',
    '    bpy.context.object.data.energy = 400',
    '    bpy.ops.object.camera_add(location=(4, -6, 4), rotation=(1.1, 0, 0.62))',
    '    bpy.context.scene.camera = bpy.context.object',
    'bpy.ops.render.render(write_still=True)',
    '',
  ].join('\n');
  const data = await runBlenderPython({
    python,
    blend_file: blendFile,
    output_path: outputPath,
    clear_scene: false,
    timeout_ms: args.timeout_ms || DEFAULT_TIMEOUT_MS,
  }, { autoSaveOutput: false });
  return asText(
    'Blender preview rendered',
    data,
    data.result.code !== 0 || data.result.timedOut || !existsSync(outputPath)
  );
}

const TOOLS = [
  {
    name: 'blender_info',
    description:
      'Report Blender binary availability/version. The WebUI image provides blender-headless; BLENDER_BIN can override it.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'blender_run_python',
    description:
      'Run Blender Python in background mode. Optionally open blend_file and/or save/export output_path (.blend, .glb, .gltf, .obj, .stl, .fbx).',
    inputSchema: {
      type: 'object',
      required: ['python'],
      properties: {
        python: { type: 'string', minLength: 1, description: 'Blender Python source.' },
        blend_file: { type: 'string', description: 'Optional existing .blend file. Relative paths resolve under /workspace.' },
        output_path: { type: 'string', description: 'Optional asset output path. Extension controls export format.' },
        clear_scene: { type: 'boolean', description: 'Delete existing scene objects before running user code.' },
        timeout_ms: { type: 'integer', minimum: 1000, maximum: 1800000 },
      },
    },
  },
  {
    name: 'blender_create_asset',
    description:
      'Create a 3D asset by running Blender Python from a clean scene and exporting output_path. Best default for procedural models.',
    inputSchema: {
      type: 'object',
      required: ['python', 'output_path'],
      properties: {
        python: { type: 'string', minLength: 1, description: 'Blender Python that creates geometry, materials, lights, and cameras.' },
        output_path: { type: 'string', description: 'Output .blend/.glb/.gltf/.obj/.stl/.fbx path. Relative paths resolve under /workspace.' },
        clear_scene: { type: 'boolean', description: 'Defaults to true. Set false to keep startup objects.' },
        timeout_ms: { type: 'integer', minimum: 1000, maximum: 1800000 },
      },
    },
  },
  {
    name: 'blender_inspect_file',
    description: 'Open a .blend file and summarize objects, mesh counts, material counts, cameras, lights, and polygon counts.',
    inputSchema: {
      type: 'object',
      required: ['file_path'],
      properties: {
        file_path: { type: 'string' },
        timeout_ms: { type: 'integer', minimum: 1000, maximum: 900000 },
      },
    },
  },
  {
    name: 'blender_render_preview',
    description: 'Render a PNG preview from an existing .blend file, adding a camera/light if needed.',
    inputSchema: {
      type: 'object',
      required: ['blend_file'],
      properties: {
        blend_file: { type: 'string' },
        output_path: { type: 'string', description: 'PNG output path. Relative paths resolve under /workspace.' },
        resolution: { type: 'integer', minimum: 128, maximum: 4096 },
        timeout_ms: { type: 'integer', minimum: 1000, maximum: 1800000 },
      },
    },
  },
];

async function runTool(name, args) {
  switch (name) {
    case 'blender_info':
      return await toolInfo(args);
    case 'blender_run_python':
      return await toolRunPython(args);
    case 'blender_create_asset':
      return await toolCreateAsset(args);
    case 'blender_inspect_file':
      return await toolInspectFile(args);
    case 'blender_render_preview':
      return await toolRenderPreview(args);
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
        serverInfo: { name: 'mcp-blender-webui', version: '0.1.0' },
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
    ok(id, asText('Blender MCP error', { message: err instanceof Error ? err.message : String(err), details }, true));
  } finally {
    pendingRequests -= 1;
    maybeExit();
  }
});

rl.on('close', () => {
  inputClosed = true;
  maybeExit();
});
