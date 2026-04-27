#!/usr/bin/env node
// Minimal MCP stdio server for the Android App Creator backend.
// Lets Claude/Codex/OpenCode build APKs, manage ADB devices, and drive
// real-device tests (logcat / shell / screencap) without re-explaining
// the workflow every session.
//
// Speaks JSON-RPC 2.0 over stdin/stdout (line-delimited JSON). Zero deps.

import { createInterface } from 'node:readline';
import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';

const API = (process.env.ANDROID_BUILDER_URL || 'http://host.docker.internal:4000').replace(/\/$/, '');
const REQUEST_TIMEOUT_MS = Number(process.env.ANDROID_BUILDER_TIMEOUT_MS || 60_000);

const log = (...args) => console.error('[mcp-android]', ...args);

function send(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }
function ok(id, value) { send({ jsonrpc: '2.0', id, result: value }); }
function fail(id, code, message, data) {
  send({ jsonrpc: '2.0', id, error: { code, message, ...(data ? { data } : {}) } });
}

async function http(method, path, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const resp = await fetch(`${API}${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const text = await resp.text();
    let parsed;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text }; }
    if (!resp.ok) {
      const message = parsed?.error || parsed?.message || `HTTP ${resp.status}`;
      const err = new Error(message);
      err.status = resp.status;
      err.body = parsed;
      throw err;
    }
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

// Fetch a binary blob (e.g. PNG screenshot) and return it as a Buffer.
async function httpBinary(method, path) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const resp = await fetch(`${API}${path}`, { method, signal: ctrl.signal });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`HTTP ${resp.status}: ${text.slice(0, 300)}`);
    }
    const ab = await resp.arrayBuffer();
    return Buffer.from(ab);
  } finally {
    clearTimeout(timer);
  }
}

function asText(label, payload) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
  // structuredContent must be a record (object), not an array or primitive —
  // the harness validates this against the MCP spec. Wrap arrays so list
  // endpoints (adb_devices, adb_known_devices, …) don't blow up the client.
  let structured;
  if (Array.isArray(payload)) {
    structured = { items: payload };
  } else if (typeof payload === 'object' && payload !== null) {
    structured = payload;
  } else {
    structured = { value: payload };
  }
  return {
    content: [{ type: 'text', text: `${label}\n${body}` }],
    structuredContent: structured,
  };
}

function errorResult(message) {
  return {
    content: [{ type: 'text', text: `Error: ${message}` }],
    isError: true,
  };
}

const TOOLS = [
  // ── Project lifecycle ────────────────────────────────────────────────
  {
    name: 'android_list_projects',
    description: 'List all Android projects known to the builder.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'android_get_project',
    description: 'Get a single Android project by id (status, package, last build, etc).',
    inputSchema: {
      type: 'object',
      required: ['projectId'],
      properties: { projectId: { type: 'string' } },
    },
  },
  {
    name: 'android_create_project',
    description: [
      'Create a new Android project.',
      'Provide name, packageName (e.g. com.example.foo), and a natural-language description.',
      'The builder will scaffold the Gradle project; use android_generate to have Claude write the code.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      required: ['name', 'packageName', 'description'],
      properties: {
        name: { type: 'string', minLength: 1 },
        packageName: { type: 'string', pattern: '^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+$' },
        description: { type: 'string', minLength: 1 },
        template: { type: 'string', description: 'Optional template id.' },
      },
    },
  },
  {
    name: 'android_generate',
    description: 'Trigger Claude code generation inside a project (returns sessionId; subscribe to socket for progress).',
    inputSchema: {
      type: 'object',
      required: ['projectId'],
      properties: {
        projectId: { type: 'string' },
        prompt: { type: 'string', description: 'Optional custom generation prompt.' },
      },
    },
  },
  {
    name: 'android_iterate',
    description: 'Send an iteration prompt to an existing project session (continues the Claude conversation).',
    inputSchema: {
      type: 'object',
      required: ['projectId', 'prompt'],
      properties: {
        projectId: { type: 'string' },
        prompt: { type: 'string', minLength: 1 },
      },
    },
  },

  // ── Build / install / launch ────────────────────────────────────────
  {
    name: 'android_build',
    description: 'Build the APK for a project (Gradle assembleDebug). Streams progress via the backend socket; returns initial accept response.',
    inputSchema: {
      type: 'object',
      required: ['projectId'],
      properties: {
        projectId: { type: 'string' },
        variant: { type: 'string', enum: ['debug', 'release'] },
      },
    },
  },
  {
    name: 'android_build_artifacts',
    description: 'List build artifacts (APKs/AABs) for a project.',
    inputSchema: {
      type: 'object',
      required: ['projectId'],
      properties: { projectId: { type: 'string' } },
    },
  },
  {
    name: 'android_install',
    description: 'Install the freshly-built APK from a project onto a connected device.',
    inputSchema: {
      type: 'object',
      required: ['projectId', 'serial'],
      properties: {
        projectId: { type: 'string' },
        serial: { type: 'string' },
        apkPath: { type: 'string', description: 'Optional override path; defaults to app/build/outputs/apk/debug/app-debug.apk' },
      },
    },
  },
  {
    name: 'android_uninstall',
    description: 'Uninstall an app from a device by package name.',
    inputSchema: {
      type: 'object',
      required: ['serial', 'packageName'],
      properties: {
        serial: { type: 'string' },
        packageName: { type: 'string', pattern: '^[\\w.]+$' },
      },
    },
  },
  {
    name: 'android_launch',
    description: 'Launch an installed app on a device.',
    inputSchema: {
      type: 'object',
      required: ['serial', 'packageName'],
      properties: {
        serial: { type: 'string' },
        packageName: { type: 'string', pattern: '^[\\w.]+$' },
        mainActivity: { type: 'string', description: 'Default ".MainActivity"' },
      },
    },
  },

  // ── ADB device management ──────────────────────────────────────────
  {
    name: 'adb_devices',
    description: 'List currently connected ADB devices (live).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'adb_known_devices',
    description: 'List remembered devices from the persistent registry (survives container restarts).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'adb_pair_wifi',
    description: 'Pair a wireless device using a pairing code from Developer Options → Wireless debugging → Pair device with pairing code.',
    inputSchema: {
      type: 'object',
      required: ['host', 'port', 'pairingCode'],
      properties: {
        host: { type: 'string' },
        port: { type: 'integer', minimum: 1, maximum: 65535 },
        pairingCode: { type: 'string', pattern: '^\\d{4,8}$' },
        friendlyName: { type: 'string', maxLength: 80 },
      },
    },
  },
  {
    name: 'adb_connect_wifi',
    description: 'Connect to a wireless device on host:port (after pairing). The device is added to the auto-reconnect registry on success.',
    inputSchema: {
      type: 'object',
      required: ['host'],
      properties: {
        host: { type: 'string' },
        port: { type: 'integer', minimum: 1, maximum: 65535, description: 'Default 5555' },
        friendlyName: { type: 'string', maxLength: 80 },
      },
    },
  },
  {
    name: 'adb_disconnect',
    description: 'Disconnect a wireless device (does not forget it from the registry).',
    inputSchema: {
      type: 'object',
      required: ['serial'],
      properties: { serial: { type: 'string' } },
    },
  },
  {
    name: 'adb_forget_device',
    description: 'Remove a device from the persistent registry (it will not auto-reconnect on next startup).',
    inputSchema: {
      type: 'object',
      required: ['serial'],
      properties: { serial: { type: 'string' } },
    },
  },
  {
    name: 'adb_set_friendly_name',
    description: 'Assign a human-friendly label to a remembered device.',
    inputSchema: {
      type: 'object',
      required: ['serial', 'friendlyName'],
      properties: {
        serial: { type: 'string' },
        friendlyName: { type: 'string', maxLength: 80 },
      },
    },
  },
  {
    name: 'adb_set_auto_reconnect',
    description: 'Toggle auto-reconnect for a remembered wifi device.',
    inputSchema: {
      type: 'object',
      required: ['serial', 'autoReconnect'],
      properties: {
        serial: { type: 'string' },
        autoReconnect: { type: 'boolean' },
      },
    },
  },
  {
    name: 'adb_reconnect_all',
    description: 'Re-attempt reconnect for every remembered wifi device that has autoReconnect=true.',
    inputSchema: { type: 'object', properties: {} },
  },

  // ── Emulator ───────────────────────────────────────────────────────
  {
    name: 'emulator_status',
    description: 'Get current emulator status (running / avd / port).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'emulator_start',
    description: 'Start an Android emulator (specify avd name, or default).',
    inputSchema: {
      type: 'object',
      properties: {
        avd: { type: 'string' },
        port: { type: 'integer', minimum: 5554, maximum: 5680 },
      },
    },
  },
  {
    name: 'emulator_stop',
    description: 'Stop the running emulator.',
    inputSchema: { type: 'object', properties: {} },
  },

  // ── Runtime testing on device ──────────────────────────────────────
  {
    name: 'adb_logcat',
    description: 'Read recent logcat lines from a device. Default: last 60s, 500 lines, no filter.',
    inputSchema: {
      type: 'object',
      required: ['serial'],
      properties: {
        serial: { type: 'string' },
        lines: { type: 'integer', minimum: 10, maximum: 5000 },
        sinceMs: { type: 'integer', description: 'Only logs since this epoch ms.' },
        filter: { type: 'string', description: 'logcat filter spec, e.g. "MyApp:V *:S" or "*:E"' },
      },
    },
  },
  {
    name: 'adb_logcat_clear',
    description: 'Clear the logcat buffer on a device.',
    inputSchema: {
      type: 'object',
      required: ['serial'],
      properties: { serial: { type: 'string' } },
    },
  },
  {
    name: 'adb_shell',
    description: 'Run an arbitrary adb shell command on a device. Destructive ops (rm -rf /, dd, mkfs, fork bomb, su root) are denied by the backend.',
    inputSchema: {
      type: 'object',
      required: ['serial', 'command'],
      properties: {
        serial: { type: 'string' },
        command: { type: 'string', minLength: 1, maxLength: 4000 },
        timeoutMs: { type: 'integer', minimum: 1000, maximum: 120_000 },
      },
    },
  },
  {
    name: 'adb_screenshot',
    description: 'Capture a PNG screenshot from a device and save it to a file inside the builder container. Use adb_screenshot_view if you want to actually SEE the screen content.',
    inputSchema: {
      type: 'object',
      required: ['serial', 'outputPath'],
      properties: {
        serial: { type: 'string' },
        outputPath: { type: 'string', pattern: '^/[\\w./-]+\\.png$' },
      },
    },
  },
  {
    name: 'adb_screenshot_view',
    description: [
      'Capture the live screen of a device and return it as an inline image so the agent can SEE what is on screen.',
      'Use this BEFORE every interaction (tap/swipe/keyevent) to know what is actually displayed,',
      'and AFTER to verify the action took effect. This is the primary visual feedback channel for autonomous testing.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      required: ['serial'],
      properties: { serial: { type: 'string' } },
    },
  },
  {
    name: 'adb_tap',
    description: 'Tap at screen coordinates (x, y in pixels). Pair with adb_screenshot_view + adb_ui_dump to know where to tap.',
    inputSchema: {
      type: 'object',
      required: ['serial', 'x', 'y'],
      properties: {
        serial: { type: 'string' },
        x: { type: 'number', minimum: 0, maximum: 10000 },
        y: { type: 'number', minimum: 0, maximum: 10000 },
      },
    },
  },
  {
    name: 'adb_swipe',
    description: 'Swipe from (x1,y1) to (x2,y2). durationMs default 300 (use ~600 for slow scroll, 100-200 for fling).',
    inputSchema: {
      type: 'object',
      required: ['serial', 'x1', 'y1', 'x2', 'y2'],
      properties: {
        serial: { type: 'string' },
        x1: { type: 'number', minimum: 0, maximum: 10000 },
        y1: { type: 'number', minimum: 0, maximum: 10000 },
        x2: { type: 'number', minimum: 0, maximum: 10000 },
        y2: { type: 'number', minimum: 0, maximum: 10000 },
        durationMs: { type: 'integer', minimum: 50, maximum: 10000 },
      },
    },
  },
  {
    name: 'adb_input_text',
    description: 'Type text into the currently-focused input field (printable ASCII only; for special keys use adb_keyevent).',
    inputSchema: {
      type: 'object',
      required: ['serial', 'text'],
      properties: {
        serial: { type: 'string' },
        text: { type: 'string', minLength: 1, maxLength: 1000 },
      },
    },
  },
  {
    name: 'adb_keyevent',
    description: [
      'Virtually press a key — including the physical hardware buttons of the device.',
      'Pass a symbolic name (preferred) or numeric keycode.',
      'Common hardware/system buttons: HOME, BACK, APP_SWITCH (recents), POWER, MENU, CAMERA,',
      'VOLUME_UP, VOLUME_DOWN, VOLUME_MUTE, MEDIA_PLAY_PAUSE, MEDIA_NEXT, MEDIA_PREVIOUS.',
      'Common navigation/typing: ENTER, TAB, ESCAPE, DEL (backspace), FORWARD_DEL, DPAD_UP/DOWN/LEFT/RIGHT/CENTER, PAGE_UP, PAGE_DOWN, MOVE_HOME, MOVE_END.',
      'For Xbox/gamepad-style controller buttons (BUTTON_A, BUTTON_L1, etc.) prefer adb_gamepad — many games filter by SOURCE_GAMEPAD and ignore default keyboard events.',
      'Examples: "HOME" returns to launcher, "BACK" goes back, "APP_SWITCH" opens recents, "POWER" toggles screen.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      required: ['serial', 'keyCode'],
      properties: {
        serial: { type: 'string' },
        keyCode: {
          oneOf: [
            { type: 'string', description: 'Symbolic name like "HOME", "BACK", "VOLUME_UP" (KEYCODE_ prefix optional).' },
            { type: 'integer', minimum: 0, maximum: 1000 },
          ],
        },
        source: {
          type: 'string',
          enum: ['keyboard', 'gamepad', 'joystick', 'dpad', 'touchscreen', 'touchnavigation', 'mouse', 'stylus', 'trackball'],
          description: 'Input source. Defaults to "keyboard". Use "gamepad" for controller buttons that games/emulators filter by SOURCE_GAMEPAD (or just call adb_gamepad).',
        },
      },
    },
  },
  {
    name: 'adb_gamepad',
    description: [
      'Press a gamepad/controller button using input source SOURCE_GAMEPAD — required for the Anbernic RG Mini V2 and any',
      'Xbox-style controller, retro handheld, or emulator that ignores plain keyboard keyevents.',
      'Xbox-style buttons: BUTTON_A, BUTTON_B, BUTTON_X, BUTTON_Y, BUTTON_L1, BUTTON_R1, BUTTON_L2, BUTTON_R2,',
      'BUTTON_THUMBL (left stick click), BUTTON_THUMBR (right stick click), BUTTON_START, BUTTON_SELECT, BUTTON_MODE.',
      'D-pad: DPAD_UP, DPAD_DOWN, DPAD_LEFT, DPAD_RIGHT, DPAD_CENTER. The KEYCODE_ prefix is optional.',
      'Set longpress=true for a held press (useful in fighting games or to trigger long-press menus).',
    ].join(' '),
    inputSchema: {
      type: 'object',
      required: ['serial', 'button'],
      properties: {
        serial: { type: 'string' },
        button: {
          type: 'string',
          description: 'Symbolic gamepad keycode like "BUTTON_A", "BUTTON_L2", "DPAD_UP" (KEYCODE_ prefix optional).',
        },
        longpress: { type: 'boolean', description: 'Default false. True sends --longpress for a held button.' },
      },
    },
  },
  {
    name: 'adb_ui_dump',
    description: [
      'Dump the on-screen UI hierarchy as XML so the agent can locate elements by text/resource-id/content-desc/bounds',
      'instead of guessing pixel coordinates from a screenshot. Each <node> has a `bounds` attribute like "[x1,y1][x2,y2]"',
      'that tells you exactly where to tap. Combine with adb_screenshot_view for fast, reliable autonomous interaction.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      required: ['serial'],
      properties: {
        serial: { type: 'string' },
        compressed: { type: 'boolean', description: 'Default true — strips redundant nodes for shorter output.' },
      },
    },
  },
  {
    name: 'adb_current_activity',
    description: 'Identify the foreground activity (package + activity class) — useful right after adb_launch to confirm the app is actually showing.',
    inputSchema: {
      type: 'object',
      required: ['serial'],
      properties: { serial: { type: 'string' } },
    },
  },

  // ── Health ─────────────────────────────────────────────────────────
  {
    name: 'android_health',
    description: 'Health check: confirm the Android builder backend is reachable.',
    inputSchema: { type: 'object', properties: {} },
  },
];

const HANDLERS = {
  android_list_projects: () => http('GET', '/api/projects'),
  android_get_project: (a) => http('GET', `/api/projects/${encodeURIComponent(a.projectId)}`),
  android_create_project: (a) => http('POST', '/api/projects', a),
  android_generate: (a) => http('POST', `/api/projects/${encodeURIComponent(a.projectId)}/generate`, { prompt: a.prompt }),
  android_iterate: (a) => http('POST', `/api/projects/${encodeURIComponent(a.projectId)}/iterate`, { prompt: a.prompt }),

  android_build: (a) => http('POST', `/api/build/${encodeURIComponent(a.projectId)}`, a.variant ? { variant: a.variant } : {}),
  android_build_artifacts: (a) => http('GET', `/api/build/${encodeURIComponent(a.projectId)}/artifacts`),
  android_install: (a) => http('POST', `/api/devices/${encodeURIComponent(a.serial)}/install/${encodeURIComponent(a.projectId)}`, a.apkPath ? { apkPath: a.apkPath } : {}),
  android_uninstall: (a) => http('POST', `/api/devices/${encodeURIComponent(a.serial)}/uninstall`, { packageName: a.packageName }),
  android_launch: (a) => http('POST', `/api/devices/${encodeURIComponent(a.serial)}/launch`, { packageName: a.packageName, mainActivity: a.mainActivity }),

  adb_devices: () => http('GET', '/api/devices'),
  adb_known_devices: () => http('GET', '/api/devices/known'),
  adb_pair_wifi: (a) => http('POST', '/api/devices/pair', a),
  adb_connect_wifi: (a) => http('POST', '/api/devices/connect', a),
  adb_disconnect: (a) => http('POST', '/api/devices/disconnect', { serial: a.serial }),
  adb_forget_device: (a) => http('DELETE', `/api/devices/known/${encodeURIComponent(a.serial)}`),
  adb_set_friendly_name: (a) => http('POST', `/api/devices/${encodeURIComponent(a.serial)}/friendly-name`, { friendlyName: a.friendlyName }),
  adb_set_auto_reconnect: (a) => http('POST', `/api/devices/${encodeURIComponent(a.serial)}/auto-reconnect`, { autoReconnect: a.autoReconnect }),
  adb_reconnect_all: () => http('POST', '/api/devices/reconnect-all'),

  emulator_status: () => http('GET', '/api/emulator/status'),
  emulator_start: (a) => http('POST', '/api/emulator/start', a),
  emulator_stop: () => http('POST', '/api/emulator/stop'),

  adb_logcat: (a) => {
    const params = new URLSearchParams();
    if (a.lines) params.set('lines', String(a.lines));
    if (a.sinceMs) params.set('sinceMs', String(a.sinceMs));
    if (a.filter) params.set('filter', a.filter);
    const qs = params.toString();
    return http('GET', `/api/devices/${encodeURIComponent(a.serial)}/logcat${qs ? `?${qs}` : ''}`);
  },
  adb_logcat_clear: (a) => http('POST', `/api/devices/${encodeURIComponent(a.serial)}/logcat/clear`),
  adb_shell: (a) => http('POST', `/api/devices/${encodeURIComponent(a.serial)}/shell`, { command: a.command, timeoutMs: a.timeoutMs }),
  adb_screenshot: (a) => http('POST', `/api/devices/${encodeURIComponent(a.serial)}/screenshot`, { outputPath: a.outputPath }),
  adb_tap: (a) => http('POST', `/api/devices/${encodeURIComponent(a.serial)}/tap`, { x: a.x, y: a.y }),
  adb_swipe: (a) => http('POST', `/api/devices/${encodeURIComponent(a.serial)}/swipe`, {
    x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2, durationMs: a.durationMs,
  }),
  adb_input_text: (a) => http('POST', `/api/devices/${encodeURIComponent(a.serial)}/input-text`, { text: a.text }),
  adb_keyevent: (a) => http('POST', `/api/devices/${encodeURIComponent(a.serial)}/keyevent`, {
    keyCode: a.keyCode,
    ...(a.source ? { source: a.source } : {}),
  }),
  adb_gamepad: (a) => http('POST', `/api/devices/${encodeURIComponent(a.serial)}/gamepad-button`, {
    button: a.button,
    ...(a.longpress ? { longpress: true } : {}),
  }),
  adb_ui_dump: (a) => {
    const qs = a.compressed === false ? '?compressed=false' : '';
    return http('GET', `/api/devices/${encodeURIComponent(a.serial)}/ui-dump${qs}`);
  },
  adb_current_activity: (a) => http('GET', `/api/devices/${encodeURIComponent(a.serial)}/current-activity`),

  android_health: () => http('GET', '/api/health'),
};

// Pipe a buffer through `magick` (ImageMagick 7) to resize + recompress.
// Resolves to the converted buffer, or rejects with stderr on non-zero exit.
function magickPipe(input, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('magick', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks = [];
    const errChunks = [];
    proc.stdout.on('data', (c) => chunks.push(c));
    proc.stderr.on('data', (c) => errChunks.push(c));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) return resolve(Buffer.concat(chunks));
      reject(new Error(`magick exit ${code}: ${Buffer.concat(errChunks).toString().slice(0, 400)}`));
    });
    proc.stdin.on('error', reject);
    proc.stdin.end(input);
  });
}

// adb_screenshot_view returns the PNG inline as MCP image content so the
// agent literally sees the screen. Full-resolution screenshots (~1–2 MB
// base64) get silently dropped by the Claude CLI's MCP image plumbing, so
// we downscale + JPEG-recompress to stay well under the size cap. The
// builder backend still serves the original PNG for adb_screenshot.
async function callScreenshotView(args) {
  const serial = args?.serial;
  if (!serial) throw new Error('serial required');
  const png = await httpBinary('GET', `/api/devices/${encodeURIComponent(serial)}/screenshot.png`);

  // Longest-edge 1024px, quality 78. Phone screens are pixel-dense; the agent
  // doesn't need 1:1 pixels to read UI labels. JPEG halves bytes vs PNG for
  // photographic/anti-aliased game content.
  let outBuf;
  let mime = 'image/jpeg';
  try {
    outBuf = await magickPipe(png, [
      '-',
      '-resize', '1024x1024>',
      '-strip',
      '-quality', '78',
      'jpg:-',
    ]);
  } catch (err) {
    log('magick downscale failed, sending raw PNG:', err.message);
    outBuf = png;
    mime = 'image/png';
  }

  return {
    content: [
      { type: 'image', data: outBuf.toString('base64'), mimeType: mime },
      {
        type: 'text',
        text: `Screenshot of ${serial}: ${png.length} B raw → ${outBuf.length} B ${mime}. Use adb_ui_dump for element coordinates.`,
      },
    ],
    structuredContent: {
      serial,
      size_bytes_raw: png.length,
      size_bytes_sent: outBuf.length,
      mime_type: mime,
      captured_at: new Date().toISOString(),
    },
  };
}

async function callTool(name, args) {
  if (name === 'adb_screenshot_view') {
    return callScreenshotView(args || {});
  }
  const handler = HANDLERS[name];
  if (!handler) throw new Error(`unknown tool: ${name}`);
  return handler(args || {});
}

async function handleRequest(msg) {
  const { id, method, params } = msg;
  try {
    if (method === 'initialize') {
      return ok(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'mcp-android-builder', version: '0.1.0' },
      });
    }
    if (method === 'notifications/initialized' || method === 'initialized') return;
    if (method === 'tools/list') return ok(id, { tools: TOOLS });
    if (method === 'tools/call') {
      const name = params?.name;
      const args = params?.arguments || {};
      try {
        const result = await callTool(name, args);
        // Tools like adb_screenshot_view already return MCP-shaped
        // { content: [...] } payloads (with image blocks). Pass those
        // through; only wrap raw JSON results from plain HTTP handlers.
        const isMcpShaped = result && typeof result === 'object' && Array.isArray(result.content);
        return ok(id, isMcpShaped ? result : asText(name, result));
      } catch (e) {
        log('tool error', name, e.message);
        return ok(id, errorResult(e.message));
      }
    }
    if (method === 'ping') return ok(id, {});
    return fail(id, -32601, `method not found: ${method}`);
  } catch (e) {
    log('handler error', e.stack || e.message);
    return fail(id, -32603, 'internal error', { message: e.message });
  }
}

const rl = createInterface({ input: process.stdin });
rl.on('line', async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try { msg = JSON.parse(trimmed); } catch (e) {
    log('parse error', e.message, trimmed.slice(0, 200));
    return;
  }
  await handleRequest(msg);
});
rl.on('close', () => process.exit(0));
log('ready (stdio) →', API);
