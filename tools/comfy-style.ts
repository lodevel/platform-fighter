/**
 * comfy-style.ts — Canonical Brawlhalla-style art recipe + Z-Image workflow builder.
 *
 * Single source of truth for the LOCKED art style (see docs/ART-STYLE.md):
 * Brawlhalla-style clean 2D cartoon — NOT pixel art. The prompts/negatives and
 * the model/sampler settings below mirror docs/ART-STYLE.md exactly. If the style
 * doc changes, update both.
 *
 * This module is pure data + a workflow-JSON builder. No network, no fs — so the
 * client (gen-sprite.ts) and any future stage (bg-removal, slicing, manifest) can
 * import it without side effects.
 */

// ─── Canonical models (validated, see TODO.md) ──────────────────────────────
export const MODELS = {
  unet: 'z_image_turbo_bf16.safetensors',
  clip: 'qwen_3_4b.safetensors',
  vae: 'ae.safetensors',
  /** Z-Image's qwen text encoder is loaded as the "lumina2" clip type in ComfyUI. */
  clipType: 'lumina2' as const,
} as const;

// ─── Canonical sampler settings (docs/ART-STYLE.md "Canonical ComfyUI recipe") ──
export const SAMPLER = {
  steps: 8,
  cfg: 4.5,
  samplerName: 'euler',
  scheduler: 'simple',
  denoise: 1.0,
  width: 1024,
  height: 1024,
} as const;

// ─── Canonical prompt fragments (docs/ART-STYLE.md) ─────────────────────────
/** Prepend to every CHARACTER prompt. `<SUBJECT + POSE>` is appended by caller. */
export const CHARACTER_PREFIX =
  'clean 2D cartoon game art, Brawlhalla style, bold dark outline, cel shading with ' +
  'subtle gradient, vibrant saturated colors, dynamic heroic athletic proportions, ' +
  'strong silhouette, full body, side view, transparent background';

/** Prepend to every BACKGROUND prompt. Caller supplies the parallax layer + scene. */
export const BACKGROUND_PREFIX =
  'clean 2D cartoon game background, Brawlhalla style, vibrant painterly environment, ' +
  'depth and atmosphere';

/** Prepend to ITEM / PROP / UI prompts (same weight + saturation as characters). */
export const ITEM_PREFIX =
  'clean 2D cartoon game item sprite, Brawlhalla style, bold dark outline, cel shading ' +
  'with subtle gradient, vibrant saturated colors, strong silhouette, transparent background';

/** Negative prompt — applies to ALL renders. */
export const NEGATIVE =
  'pixel art, pixelated, photorealistic, 3d render, photo, blurry, soft focus, ' +
  'sketch, lineart only, watermark, text, signature, extra limbs, deformed, ' +
  'low contrast, muddy colors';

export type AssetKind = 'character' | 'background' | 'item';

export interface BuildPromptOpts {
  /** Asset category — selects the canonical style prefix. */
  kind: AssetKind;
  /** The subject/scene text, e.g. "ninja cat in a fighting stance" or
   *  "midground: floating sky island with ruins, no characters". */
  subject: string;
}

/** Compose the full positive prompt for an asset from the locked style prefix + subject. */
export function buildPositivePrompt({ kind, subject }: BuildPromptOpts): string {
  const prefix =
    kind === 'character'
      ? CHARACTER_PREFIX
      : kind === 'background'
        ? BACKGROUND_PREFIX
        : ITEM_PREFIX;
  return `${prefix}, ${subject}`;
}

// ─── Workflow JSON (ComfyUI /prompt API format) ─────────────────────────────
/** A ComfyUI API-format graph: node-id -> { class_type, inputs }. */
export type ComfyWorkflow = Record<string, { class_type: string; inputs: Record<string, unknown> }>;

export interface WorkflowOpts {
  positive: string;
  negative?: string;
  seed: number;
  steps?: number;
  cfg?: number;
  width?: number;
  height?: number;
  /** filename prefix ComfyUI uses for SaveImage output (no extension). */
  filenamePrefix?: string;
}

/**
 * Build a Z-Image-Turbo text2img workflow in ComfyUI /prompt API format.
 *
 * Graph: UNETLoader + CLIPLoader(lumina2) + VAELoader -> CLIPTextEncode x2 ->
 *        EmptySD3LatentImage -> KSampler -> VAEDecode -> SaveImage.
 *
 * NOTE (img2img / frame consistency, see docs/SPRITE-PLAN.md §E): this is the
 * text2img path. The img2img variant (load reference -> VAEEncode -> KSampler
 * denoise<1) is a TODO for the per-clip consistency work.
 */
export function buildZImageWorkflow(opts: WorkflowOpts): ComfyWorkflow {
  const {
    positive,
    negative = NEGATIVE,
    seed,
    steps = SAMPLER.steps,
    cfg = SAMPLER.cfg,
    width = SAMPLER.width,
    height = SAMPLER.height,
    filenamePrefix = 'pf-gen',
  } = opts;

  return {
    '1': {
      class_type: 'UNETLoader',
      inputs: { unet_name: MODELS.unet, weight_dtype: 'default' },
    },
    '2': {
      class_type: 'CLIPLoader',
      inputs: { clip_name: MODELS.clip, type: MODELS.clipType },
    },
    '3': {
      class_type: 'VAELoader',
      inputs: { vae_name: MODELS.vae },
    },
    '4': {
      class_type: 'CLIPTextEncode',
      inputs: { clip: ['2', 0], text: positive },
    },
    '5': {
      class_type: 'CLIPTextEncode',
      inputs: { clip: ['2', 0], text: negative },
    },
    '6': {
      class_type: 'EmptySD3LatentImage',
      inputs: { width, height, batch_size: 1 },
    },
    '7': {
      class_type: 'KSampler',
      inputs: {
        model: ['1', 0],
        seed,
        steps,
        cfg,
        sampler_name: SAMPLER.samplerName,
        scheduler: SAMPLER.scheduler,
        positive: ['4', 0],
        negative: ['5', 0],
        latent_image: ['6', 0],
        denoise: SAMPLER.denoise,
      },
    },
    '8': {
      class_type: 'VAEDecode',
      inputs: { samples: ['7', 0], vae: ['3', 0] },
    },
    '9': {
      class_type: 'SaveImage',
      inputs: { images: ['8', 0], filename_prefix: filenamePrefix },
    },
  };
}
