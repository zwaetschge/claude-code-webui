#!/usr/bin/env node
// Minimal MCP stdio server: exposes `generate_image` for inline chat rendering.
// No external deps — speaks JSON-RPC 2.0 over stdin/stdout (line-delimited JSON).

import { writeFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import path from 'node:path';

const API = process.env.COMFYUI_API_URL || 'http://192.168.1.126:8850';
const COMFYUI = process.env.COMFYUI_BACKEND_URL || 'http://192.168.1.23:8188';
const OUT_DIR = process.env.COMFYUI_OUTPUT_DIR || '/app/packages/backend/data/generated';
const PUBLIC_PREFIX = process.env.COMFYUI_PUBLIC_PREFIX || '/generated';
const POLL_TIMEOUT_S = Number(process.env.COMFYUI_TIMEOUT_SECONDS || 300);

const VALID_ASPECTS = new Set([
  '1:1 (Perfect Square)',
  '2:3 (Classic Portrait)', '3:2 (Golden Landscape)',
  '3:4 (Golden Ratio)', '4:3 (Classic Landscape)',
  '4:5 (Artistic Frame)', '5:4 (Balanced Frame)',
  '9:16 (Slim Vertical)', '16:9 (Panorama)',
  '9:21 (Ultra Tall)', '21:9 (Epic Ultrawide)',
]);
const VALID_MEGAPIXELS = new Set(['0.1', '0.25', '0.5', '1.0', '1.5']);

const log = (...args) => console.error('[mcp-comfyui]', ...args);

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function result(id, value) { send({ jsonrpc: '2.0', id, result: value }); }
function error(id, code, message, data) {
  send({ jsonrpc: '2.0', id, error: { code, message, ...(data ? { data } : {}) } });
}

const TOOLS = [
  {
    name: 'generate_image',
    description: [
      'Generate an image via the LoRA Tester ComfyUI backend (Flux.2 Klein 9b).',
      'The image is saved server-side and returned with a public URL.',
      'CRITICAL for chat display: after this tool returns, paste the markdown snippet from the `display_markdown` field directly into your final reply to the user, e.g. `![prompt](/generated/xxx.png)`. This is how the image appears inline in the chat bubble.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      required: ['prompt'],
      properties: {
        prompt: {
          type: 'string',
          description: 'Visual description of the image. Be specific about subject, style, colors, composition.',
          minLength: 3,
          maxLength: 2000,
        },
        aspect_ratio: {
          type: 'string',
          description: 'Aspect ratio preset. Defaults to "1:1 (Perfect Square)".',
          enum: [...VALID_ASPECTS],
        },
        megapixels: {
          type: 'string',
          description: 'Image size. "0.1" for thumbs, "0.25" for previews, "0.5" for chat-review (default), "1.0"/"1.5" for full quality.',
          enum: [...VALID_MEGAPIXELS],
        },
        steps: {
          type: 'integer',
          description: 'Sampling steps. 4=fast/thumbs, 6=default, 8-12=high quality. >12 has diminishing returns.',
          minimum: 1,
          maximum: 20,
        },
        negative_prompt: {
          type: 'string',
          description: 'Things to avoid in the image. Usually unnecessary for Flux.',
          maxLength: 500,
        },
      },
    },
  },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function generateImage(args) {
  const prompt = String(args?.prompt || '').trim();
  if (prompt.length < 3) throw new Error('prompt must be at least 3 characters');

  const aspect = args?.aspect_ratio || '1:1 (Perfect Square)';
  if (!VALID_ASPECTS.has(aspect)) throw new Error(`invalid aspect_ratio: ${aspect}`);

  const megapixels = args?.megapixels || '0.5';
  if (!VALID_MEGAPIXELS.has(megapixels)) throw new Error(`invalid megapixels: ${megapixels}`);

  const steps = Number.isInteger(args?.steps) ? args.steps : 6;
  if (steps < 1 || steps > 20) throw new Error('steps must be between 1 and 20');

  const negative_prompt = String(args?.negative_prompt || '');

  await mkdir(OUT_DIR, { recursive: true });

  const payload = {
    prompt,
    negative_prompt,
    steps,
    cfg: 1.0,
    megapixels,
    aspect_ratio: aspect,
    sampler: 'euler',
    teacache_threshold: 0.35,
  };

  log('submit', { prompt: prompt.slice(0, 80), aspect, megapixels, steps });

  const submitResp = await fetch(`${API}/api/generation/t2i`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!submitResp.ok) {
    const body = await submitResp.text().catch(() => '');
    throw new Error(`submit failed ${submitResp.status}: ${body.slice(0, 300)}`);
  }
  const submitData = await submitResp.json();
  const promptId = submitData.prompt_id;
  if (!promptId || submitData.status === 'error') {
    throw new Error(`submit error: ${submitData.error || JSON.stringify(submitData)}`);
  }

  let seed = null;
  let outputImages = null;
  const started = Date.now();
  while ((Date.now() - started) / 1000 < POLL_TIMEOUT_S) {
    await sleep(1000);
    let st;
    try {
      const sr = await fetch(`${API}/api/generation/status/${promptId}`);
      st = await sr.json();
    } catch (e) {
      log('poll error', e.message);
      continue;
    }
    if (st.status === 'completed' && Array.isArray(st.output_images) && st.output_images.length) {
      outputImages = st.output_images;
      seed = st.seed ?? null;
      break;
    }
    if (st.status === 'error') {
      throw new Error(`generation failed: ${st.error || 'unknown'}`);
    }
  }
  if (!outputImages) throw new Error(`generation timed out after ${POLL_TIMEOUT_S}s`);

  const raw = outputImages[0];
  const u = new URL(raw, 'http://placeholder.local');
  const fn = u.searchParams.get('filename') || raw;
  const sub = u.searchParams.get('subfolder') || '';
  const typ = u.searchParams.get('type') || 'output';

  const ir = await fetch(
    `${COMFYUI}/view?filename=${encodeURIComponent(fn)}&subfolder=${encodeURIComponent(sub)}&type=${encodeURIComponent(typ)}`
  );
  if (!ir.ok) throw new Error(`download failed ${ir.status}`);
  const buf = Buffer.from(await ir.arrayBuffer());

  const id = randomUUID();
  const filename = `${id}.png`;
  const outPath = path.join(OUT_DIR, filename);
  await writeFile(outPath, buf);

  const publicUrl = `${PUBLIC_PREFIX}/${filename}`;
  const altText = prompt.length > 120 ? `${prompt.slice(0, 117)}...` : prompt;
  const markdown = `![${altText}](${publicUrl})`;

  log('saved', { filename, size: buf.length, publicUrl });

  return {
    content: [
      {
        type: 'text',
        text: [
          `Image generated and saved.`,
          `url: ${publicUrl}`,
          `filename: ${filename}`,
          `size: ${buf.length} bytes`,
          `seed: ${seed ?? 'unknown'}`,
          ``,
          `display_markdown: ${markdown}`,
          ``,
          `NEXT STEP: include the display_markdown line above in your reply to the user so the image renders inline in the chat.`,
        ].join('\n'),
      },
    ],
    structuredContent: {
      url: publicUrl,
      filename,
      seed,
      display_markdown: markdown,
      size_bytes: buf.length,
    },
  };
}

async function handleRequest(msg) {
  const { id, method, params } = msg;

  try {
    if (method === 'initialize') {
      return result(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'mcp-comfyui', version: '0.1.0' },
      });
    }
    if (method === 'notifications/initialized' || method === 'initialized') {
      return; // notification, no response
    }
    if (method === 'tools/list') {
      return result(id, { tools: TOOLS });
    }
    if (method === 'tools/call') {
      const name = params?.name;
      const args = params?.arguments || {};
      if (name !== 'generate_image') {
        return error(id, -32601, `unknown tool: ${name}`);
      }
      try {
        const r = await generateImage(args);
        return result(id, r);
      } catch (e) {
        log('tool error', e.message);
        return result(id, {
          content: [{ type: 'text', text: `Error: ${e.message}` }],
          isError: true,
        });
      }
    }
    if (method === 'ping') {
      return result(id, {});
    }
    return error(id, -32601, `method not found: ${method}`);
  } catch (e) {
    log('handler error', e.stack || e.message);
    return error(id, -32603, 'internal error', { message: e.message });
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
log('ready (stdio)');
