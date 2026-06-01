/**
 * ComfyUI workflow templates baked into the WebUI.
 *
 * Each template is a frozen JSON object matching ComfyUI's `/prompt` endpoint
 * schema (node-id-keyed graph). `buildWorkflow()` deep-clones the template and
 * overlays user-supplied parameters onto the appropriate node fields.
 *
 * Three workflows ship out of the box:
 *   - `z-image-turbo`      — fast T2I via Z-Image Turbo (Lumina2 / qwen3_4b CLIP)
 *   - `flux2-klein-t2i`    — quality T2I via Flux.2 Klein 9B + Turbo LoRA + TeaCache
 *   - `flux2-klein-edit`   — image-to-image edit via Flux.2 Klein + reference latent
 *
 * Adding a new workflow: copy the ComfyUI "Save (API Format)" JSON into TEMPLATES,
 * declare the parameter map below, and surface it in routes/comfyui.ts.
 */

export type WorkflowId = 'z-image-turbo' | 'flux2-klein-t2i' | 'flux2-klein-edit';

export const VALID_ASPECTS = [
  '1:1 (Perfect Square)',
  '2:3 (Classic Portrait)',
  '3:2 (Golden Landscape)',
  '3:4 (Golden Ratio)',
  '4:3 (Classic Landscape)',
  '4:5 (Artistic Frame)',
  '5:4 (Balanced Frame)',
  '9:16 (Slim Vertical)',
  '16:9 (Panorama)',
  '9:21 (Ultra Tall)',
  '21:9 (Epic Ultrawide)',
] as const;
export type AspectRatio = (typeof VALID_ASPECTS)[number];

export const VALID_MEGAPIXELS = ['0.1', '0.25', '0.5', '1.0', '1.5', '2.0'] as const;
export type Megapixels = (typeof VALID_MEGAPIXELS)[number];

export interface WorkflowParams {
  prompt: string;
  negative_prompt?: string;
  seed?: number;
  steps?: number;
  cfg?: number;
  sampler_name?: string;
  scheduler?: string;
  megapixel?: Megapixels;
  aspect_ratio?: AspectRatio;
  // Optional model swaps — defaults baked into each template.
  unet?: string;
  clip?: string;
  vae?: string;
  // LoRA override (Flux workflows only).
  lora_name?: string;
  lora_strength?: number;
  // TeaCache tuning (Flux workflows only).
  teacache_threshold?: number;
  // Image-edit workflow only — filename already uploaded to ComfyUI's `/input/`.
  input_image?: string;
  // Output prefix for ComfyUI's SaveImage node.
  filename_prefix?: string;
}

interface WorkflowMeta {
  id: WorkflowId;
  title: string;
  description: string;
  kind: 't2i' | 'edit';
  defaults: Required<
    Pick<WorkflowParams, 'steps' | 'cfg' | 'megapixel' | 'aspect_ratio' | 'sampler_name'>
  > & { scheduler?: string };
  requiresInputImage: boolean;
}

export const WORKFLOWS: Record<WorkflowId, WorkflowMeta> = {
  'z-image-turbo': {
    id: 'z-image-turbo',
    title: 'Z-Image Turbo (fast T2I)',
    description: 'Fast text-to-image via Z-Image Turbo + qwen3_4b CLIP. ~5s/image, lower VRAM.',
    kind: 't2i',
    defaults: {
      steps: 9,
      cfg: 1,
      megapixel: '2.0',
      aspect_ratio: '1:1 (Perfect Square)',
      sampler_name: 'dpmpp_2m_sde',
      scheduler: 'beta',
    },
    requiresInputImage: false,
  },
  'flux2-klein-t2i': {
    id: 'flux2-klein-t2i',
    title: 'Flux.2 Klein 9B (quality T2I)',
    description:
      'High-quality T2I via Flux.2 Klein 9B + Turbo LoRA + TeaCache. ~8 steps, qwen3_8b CLIP.',
    kind: 't2i',
    defaults: {
      steps: 8,
      cfg: 1,
      megapixel: '2.0',
      aspect_ratio: '1:1 (Perfect Square)',
      sampler_name: 'euler',
    },
    requiresInputImage: false,
  },
  'flux2-klein-edit': {
    id: 'flux2-klein-edit',
    title: 'Flux.2 Klein 9B (image edit)',
    description:
      'Image-to-image edit via Flux.2 Klein + ReferenceLatent. Pass an `input_image` already uploaded to ComfyUI.',
    kind: 'edit',
    defaults: {
      steps: 8,
      cfg: 1,
      megapixel: '2.0',
      aspect_ratio: '1:1 (Perfect Square)',
      sampler_name: 'euler',
      scheduler: 'simple',
    },
    requiresInputImage: true,
  },
};

// ── Templates (frozen — buildWorkflow always deep-clones) ────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Workflow = Record<string, any>;

const Z_IMAGE_TURBO_TEMPLATE: Workflow = {
  '60': {
    inputs: { filename_prefix: 'z-image', images: ['59:8', 0] },
    class_type: 'SaveImage',
    _meta: { title: 'Save Image' },
  },
  '67': {
    inputs: { clip_name: 'qwen_3_4b.safetensors', type: 'lumina2', device: 'default' },
    class_type: 'CLIPLoader',
    _meta: { title: 'Load CLIP' },
  },
  '74': {
    inputs: {
      megapixel: '2.0',
      aspect_ratio: '9:16 (Slim Vertical)',
      divisible_by: '64',
      custom_ratio: false,
      custom_aspect_ratio: '1:1',
    },
    class_type: 'FluxResolutionNode',
    _meta: { title: 'Flux Resolution Calc' },
  },
  '59:29': {
    inputs: { vae_name: 'ae.safetensors' },
    class_type: 'VAELoader',
    _meta: { title: 'Load VAE' },
  },
  '59:28': {
    inputs: { unet_name: 'z_image_turbo_bf16.safetensors', weight_dtype: 'default' },
    class_type: 'UNETLoader',
    _meta: { title: 'Load Diffusion Model' },
  },
  '59:11': {
    inputs: { shift: 3, model: ['59:28', 0] },
    class_type: 'ModelSamplingAuraFlow',
    _meta: { title: 'ModelSamplingAuraFlow' },
  },
  '59:27': {
    inputs: { text: '"insert prompt here"', clip: ['67', 0] },
    class_type: 'CLIPTextEncode',
    _meta: { title: 'CLIP Text Encode (Prompt)' },
  },
  '59:13': {
    inputs: { width: ['74', 0], height: ['74', 1], batch_size: 1 },
    class_type: 'EmptySD3LatentImage',
    _meta: { title: 'EmptySD3LatentImage' },
  },
  '59:33': {
    inputs: { conditioning: ['59:27', 0] },
    class_type: 'ConditioningZeroOut',
    _meta: { title: 'ConditioningZeroOut' },
  },
  '59:3': {
    inputs: {
      seed: 0,
      steps: 9,
      cfg: 1,
      sampler_name: 'dpmpp_2m_sde',
      scheduler: 'beta',
      denoise: 1,
      model: ['59:11', 0],
      positive: ['59:27', 0],
      negative: ['59:33', 0],
      latent_image: ['59:13', 0],
    },
    class_type: 'KSampler',
    _meta: { title: 'KSampler' },
  },
  '59:8': {
    inputs: {
      tile_size: 512,
      overlap: 64,
      temporal_size: 32,
      temporal_overlap: 16,
      samples: ['59:3', 0],
      vae: ['59:29', 0],
    },
    class_type: 'VAEDecodeTiled',
    _meta: { title: 'VAE Decode (Tiled)' },
  },
};

const FLUX2_KLEIN_T2I_TEMPLATE: Workflow = {
  '81': {
    inputs: {
      noise: ['113', 0],
      guider: ['112', 0],
      sampler: ['111', 0],
      sigmas: ['92', 0],
      latent_image: ['94', 0],
    },
    class_type: 'SamplerCustomAdvanced',
    _meta: { title: 'SamplerCustomAdvanced' },
  },
  '82': {
    inputs: {
      tile_size: 512,
      overlap: 64,
      temporal_size: 64,
      temporal_overlap: 8,
      samples: ['81', 0],
      vae: ['114', 0],
    },
    class_type: 'VAEDecodeTiled',
    _meta: { title: 'VAE Decode (Tiled)' },
  },
  '84': {
    inputs: { text: '', clip: ['102', 0] },
    class_type: 'CLIPTextEncode',
    _meta: { title: 'CLIP Text Encode (Negative Prompt)' },
  },
  '91': {
    inputs: { text: '"insert prompt here"', clip: ['102', 0] },
    class_type: 'CLIPTextEncode',
    _meta: { title: 'CLIP Text Encode (Positive Prompt)' },
  },
  '92': {
    inputs: { steps: 8, width: ['93', 0], height: ['93', 1] },
    class_type: 'Flux2Scheduler',
    _meta: { title: 'Flux2Scheduler' },
  },
  '93': {
    inputs: {
      megapixel: '2.0',
      aspect_ratio: '9:16 (Slim Vertical)',
      divisible_by: '64',
      custom_ratio: false,
      custom_aspect_ratio: '1:1',
    },
    class_type: 'FluxResolutionNode',
    _meta: { title: 'Flux Resolution Calc' },
  },
  '94': {
    inputs: { width: ['93', 0], height: ['93', 1], batch_size: 1 },
    class_type: 'EmptyFlux2LatentImage',
    _meta: { title: 'Empty Flux 2 Latent' },
  },
  '95': {
    inputs: { filename_prefix: 'ComfyUI', images: ['82', 0] },
    class_type: 'SaveImage',
    _meta: { title: 'Save Image' },
  },
  '100': {
    inputs: { unet_name: 'flux-2-klein-base-9b.safetensors', weight_dtype: 'default' },
    class_type: 'UNETLoader',
    _meta: { title: 'Load Diffusion Model' },
  },
  '102': {
    inputs: { clip_name: 'qwen_3_8b_fp8mixed.safetensors', type: 'flux2', device: 'default' },
    class_type: 'CLIPLoader',
    _meta: { title: 'Load CLIP' },
  },
  '105': {
    inputs: {
      model_type: 'flux',
      rel_l1_thresh: 0.4,
      start_percent: 0,
      end_percent: 1,
      cache_device: 'cuda',
      model: ['129', 0],
    },
    class_type: 'TeaCache',
    _meta: { title: 'TeaCache (Flux)' },
  },
  '111': {
    inputs: { sampler_name: 'euler' },
    class_type: 'KSamplerSelect',
    _meta: { title: 'KSamplerSelect' },
  },
  '112': {
    inputs: { cfg: 1, model: ['105', 0], positive: ['91', 0], negative: ['84', 0] },
    class_type: 'CFGGuider',
    _meta: { title: 'CFGGuider' },
  },
  '113': {
    inputs: { noise_seed: 0 },
    class_type: 'RandomNoise',
    _meta: { title: 'RandomNoise' },
  },
  '114': {
    inputs: { vae_name: 'flux2-vae.safetensors' },
    class_type: 'VAELoader',
    _meta: { title: 'Load VAE' },
  },
  '129': {
    inputs: {
      lora_name: 'f2k/9b/concept/klein_9B_Turbo_r128.safetensors',
      strength_model: 1,
      model: ['100', 0],
    },
    class_type: 'LoraLoaderModelOnly',
    _meta: { title: 'Load LoRA' },
  },
};

const FLUX2_KLEIN_EDIT_TEMPLATE: Workflow = {
  '1': {
    inputs: { vae_name: 'flux2-vae.safetensors' },
    class_type: 'VAELoader',
    _meta: { title: 'Load VAE' },
  },
  '2': {
    inputs: { text: '"Insert prompt to edit input image here"', clip: ['4', 0] },
    class_type: 'CLIPTextEncode',
    _meta: { title: 'CLIP Text Encode (Positive Prompt)' },
  },
  '3': {
    inputs: { text: '', clip: ['4', 0] },
    class_type: 'CLIPTextEncode',
    _meta: { title: 'CLIP Text Encode (Negative - unused at CFG 1)' },
  },
  '4': {
    inputs: { clip_name: 'qwen_3_8b_fp8mixed.safetensors', type: 'flux2', device: 'default' },
    class_type: 'CLIPLoader',
    _meta: { title: 'Load CLIP' },
  },
  '5': {
    inputs: { upscale_method: 'lanczos', megapixels: 2, resolution_steps: 1, image: ['10', 0] },
    class_type: 'ImageScaleToTotalPixels',
    _meta: { title: 'ImageScaleToTotalPixels' },
  },
  '6': {
    inputs: {
      tile_size: 512,
      overlap: 64,
      temporal_size: 64,
      temporal_overlap: 8,
      samples: ['7', 0],
      vae: ['1', 0],
    },
    class_type: 'VAEDecodeTiled',
    _meta: { title: 'VAE Decode (Tiled)' },
  },
  '7': {
    inputs: {
      seed: 0,
      steps: 8,
      cfg: 1,
      sampler_name: 'euler',
      scheduler: 'simple',
      denoise: 1,
      model: ['13', 0],
      positive: ['9:77', 0],
      negative: ['9:76', 0],
      latent_image: ['8', 0],
    },
    class_type: 'KSampler',
    _meta: { title: 'KSampler' },
  },
  '8': {
    inputs: { width: ['16', 0], height: ['16', 1], batch_size: 1 },
    class_type: 'EmptyFlux2LatentImage',
    _meta: { title: 'Empty Flux 2 Latent' },
  },
  '10': {
    inputs: { image: 'placeholder.png' },
    class_type: 'LoadImage',
    _meta: { title: 'Load Image' },
  },
  '11': {
    inputs: { filename_prefix: 'ComfyUI', images: ['6', 0] },
    class_type: 'SaveImage',
    _meta: { title: 'Save Image' },
  },
  '12': {
    inputs: { unet_name: 'flux-2-klein-base-9b.safetensors', weight_dtype: 'default' },
    class_type: 'UNETLoader',
    _meta: { title: 'Load Diffusion Model' },
  },
  '13': {
    inputs: {
      model_type: 'flux',
      rel_l1_thresh: 0.4,
      start_percent: 0,
      end_percent: 1,
      cache_device: 'cuda',
      model: ['15', 0],
    },
    class_type: 'TeaCache',
    _meta: { title: 'TeaCache (Flux)' },
  },
  '15': {
    inputs: {
      lora_name: 'f2k/9b/concept/klein_9B_Turbo_r128.safetensors',
      strength_model: 1,
      model: ['12', 0],
    },
    class_type: 'LoraLoaderModelOnly',
    _meta: { title: 'Load LoRA' },
  },
  '16': {
    inputs: { image: ['5', 0] },
    class_type: 'GetImageSize',
    _meta: { title: 'Get Image Size' },
  },
  '9:78': {
    inputs: { pixels: ['5', 0], vae: ['1', 0] },
    class_type: 'VAEEncode',
    _meta: { title: 'VAE Encode' },
  },
  '9:77': {
    inputs: { conditioning: ['2', 0], latent: ['9:78', 0] },
    class_type: 'ReferenceLatent',
    _meta: { title: 'ReferenceLatent' },
  },
  '9:76': {
    inputs: { conditioning: ['3', 0], latent: ['9:78', 0] },
    class_type: 'ReferenceLatent',
    _meta: { title: 'ReferenceLatent' },
  },
};

const TEMPLATES: Record<WorkflowId, Workflow> = {
  'z-image-turbo': Z_IMAGE_TURBO_TEMPLATE,
  'flux2-klein-t2i': FLUX2_KLEIN_T2I_TEMPLATE,
  'flux2-klein-edit': FLUX2_KLEIN_EDIT_TEMPLATE,
};

// Per-workflow map: which node holds which parameter. Each entry is
// `[node_id, field_path_in_inputs]`. Field paths are dot-separated for nested
// fields (e.g. `lora_name` is at `inputs.lora_name`, just `lora_name`).
const PARAM_MAP: Record<
  WorkflowId,
  Partial<Record<keyof WorkflowParams, [nodeId: string, field: string]>>
> = {
  'z-image-turbo': {
    prompt: ['59:27', 'text'],
    seed: ['59:3', 'seed'],
    steps: ['59:3', 'steps'],
    cfg: ['59:3', 'cfg'],
    sampler_name: ['59:3', 'sampler_name'],
    scheduler: ['59:3', 'scheduler'],
    megapixel: ['74', 'megapixel'],
    aspect_ratio: ['74', 'aspect_ratio'],
    unet: ['59:28', 'unet_name'],
    clip: ['67', 'clip_name'],
    vae: ['59:29', 'vae_name'],
    filename_prefix: ['60', 'filename_prefix'],
  },
  'flux2-klein-t2i': {
    prompt: ['91', 'text'],
    negative_prompt: ['84', 'text'],
    seed: ['113', 'noise_seed'],
    steps: ['92', 'steps'],
    cfg: ['112', 'cfg'],
    sampler_name: ['111', 'sampler_name'],
    megapixel: ['93', 'megapixel'],
    aspect_ratio: ['93', 'aspect_ratio'],
    unet: ['100', 'unet_name'],
    clip: ['102', 'clip_name'],
    vae: ['114', 'vae_name'],
    lora_name: ['129', 'lora_name'],
    lora_strength: ['129', 'strength_model'],
    teacache_threshold: ['105', 'rel_l1_thresh'],
    filename_prefix: ['95', 'filename_prefix'],
  },
  'flux2-klein-edit': {
    prompt: ['2', 'text'],
    negative_prompt: ['3', 'text'],
    seed: ['7', 'seed'],
    steps: ['7', 'steps'],
    cfg: ['7', 'cfg'],
    sampler_name: ['7', 'sampler_name'],
    scheduler: ['7', 'scheduler'],
    megapixel: ['5', 'megapixels'],
    unet: ['12', 'unet_name'],
    clip: ['4', 'clip_name'],
    vae: ['1', 'vae_name'],
    lora_name: ['15', 'lora_name'],
    lora_strength: ['15', 'strength_model'],
    teacache_threshold: ['13', 'rel_l1_thresh'],
    input_image: ['10', 'image'],
    filename_prefix: ['11', 'filename_prefix'],
  },
};

function setField(workflow: Workflow, nodeId: string, field: string, value: unknown): void {
  const node = workflow[nodeId];
  if (!node || !node.inputs) return;
  // Megapixel for the edit workflow is numeric (ImageScaleToTotalPixels), but
  // string everywhere else (FluxResolutionNode). Coerce based on existing type.
  const current = node.inputs[field];
  if (typeof current === 'number' && typeof value === 'string') {
    const n = Number(value);
    if (Number.isFinite(n)) {
      node.inputs[field] = n;
      return;
    }
  }
  node.inputs[field] = value;
}

/**
 * Generate a 64-bit-ish seed in the range ComfyUI accepts.
 * Default Math.random() only gives 53 bits but it's fine — RandomNoise wraps.
 */
export function randomSeed(): number {
  return Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
}

/**
 * Validate params against workflow constraints, throwing on bad input.
 */
export function validateParams(
  id: WorkflowId,
  params: WorkflowParams
): { ok: true } | { ok: false; error: string } {
  const meta = WORKFLOWS[id];
  if (!meta) return { ok: false, error: `unknown workflow: ${id}` };

  if (!params.prompt || params.prompt.trim().length < 3) {
    return { ok: false, error: 'prompt must be at least 3 characters' };
  }
  if (params.prompt.length > 4000) {
    return { ok: false, error: 'prompt exceeds 4000 chars' };
  }
  if (meta.requiresInputImage && !params.input_image) {
    return { ok: false, error: `${id} requires input_image (filename uploaded to ComfyUI)` };
  }
  if (params.steps !== undefined && (params.steps < 1 || params.steps > 60)) {
    return { ok: false, error: 'steps must be 1-60' };
  }
  if (params.cfg !== undefined && (params.cfg < 0 || params.cfg > 20)) {
    return { ok: false, error: 'cfg must be 0-20' };
  }
  if (params.aspect_ratio && !VALID_ASPECTS.includes(params.aspect_ratio)) {
    return { ok: false, error: `aspect_ratio must be one of: ${VALID_ASPECTS.join(', ')}` };
  }
  if (params.megapixel && !VALID_MEGAPIXELS.includes(params.megapixel)) {
    return { ok: false, error: `megapixel must be one of: ${VALID_MEGAPIXELS.join(', ')}` };
  }
  if (
    params.lora_strength !== undefined &&
    (params.lora_strength < 0 || params.lora_strength > 2)
  ) {
    return { ok: false, error: 'lora_strength must be 0-2' };
  }
  return { ok: true };
}

/**
 * Deep-clone a workflow template and overlay user params onto the appropriate
 * nodes. Returns the workflow ready to POST to ComfyUI's /prompt endpoint.
 *
 * Unset params keep their template default. `seed` defaults to a random value
 * so repeated calls with the same prompt produce different images.
 */
export function buildWorkflow(id: WorkflowId, params: WorkflowParams): Workflow {
  const template = TEMPLATES[id];
  if (!template) throw new Error(`unknown workflow: ${id}`);

  const workflow: Workflow = JSON.parse(JSON.stringify(template));
  const map = PARAM_MAP[id];

  // Seed: random if not supplied so the user always gets variation.
  const seed = params.seed ?? randomSeed();

  const fullParams: WorkflowParams = { ...params, seed };

  for (const [paramKey, mapping] of Object.entries(map)) {
    if (!mapping) continue;
    const value = fullParams[paramKey as keyof WorkflowParams];
    if (value === undefined || value === null) continue;
    const [nodeId, field] = mapping;
    setField(workflow, nodeId, field, value);
  }

  return workflow;
}

/**
 * Listing endpoint payload — describes each workflow's title, defaults, and
 * declared parameters so the frontend / agent can render or compose calls.
 */
export function listWorkflows(): Array<WorkflowMeta & { params: Array<keyof WorkflowParams> }> {
  return Object.values(WORKFLOWS).map((w) => ({
    ...w,
    params: Object.keys(PARAM_MAP[w.id]) as Array<keyof WorkflowParams>,
  }));
}
