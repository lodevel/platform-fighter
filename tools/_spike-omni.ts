/**
 * _spike-omni.ts — THROWAWAY spike. Validates Z-Image image-reference (Omni)
 * frame consistency: given one character anchor, render the SAME character in
 * new poses. If this looks consistent + on-style, the sprite pipeline is viable.
 * Delete after evaluating.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { ComfyClient } from './comfy-client.ts';
import { MODELS, SAMPLER, NEGATIVE, CHARACTER_PREFIX } from './comfy-style.ts';

const REF_FILENAME = 'ref-link.png'; // already copied into ~/ComfyUI/input/
const SUBJECT =
  'a heroic elf swordsman, hero green tunic with tan cream trim, sword and shield, big eyes';

function omniWorkflow(pose: string, seed: number) {
  const positive = `${CHARACTER_PREFIX} the SAME character as the reference image: ${SUBJECT}, ${pose}, full body, side profile view, on a solid flat chroma-key magenta #FF00FF background, no shadows`;
  return {
    '1': { class_type: 'UNETLoader', inputs: { unet_name: MODELS.unet, weight_dtype: 'default' } },
    '2': { class_type: 'CLIPLoader', inputs: { clip_name: MODELS.clip, type: MODELS.clipType } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: MODELS.vae } },
    '10': { class_type: 'LoadImage', inputs: { image: REF_FILENAME } },
    // image-reference conditioning: same character, new pose driven by prompt
    '4': {
      class_type: 'TextEncodeZImageOmni',
      inputs: { clip: ['2', 0], prompt: positive, auto_resize_images: true, vae: ['3', 0], image1: ['10', 0] },
    },
    '5': { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: NEGATIVE } },
    '6': { class_type: 'EmptySD3LatentImage', inputs: { width: 1024, height: 1024, batch_size: 1 } },
    '7': {
      class_type: 'KSampler',
      inputs: {
        model: ['1', 0], seed, steps: SAMPLER.steps, cfg: SAMPLER.cfg,
        sampler_name: SAMPLER.samplerName, scheduler: SAMPLER.scheduler,
        positive: ['4', 0], negative: ['5', 0], latent_image: ['6', 0], denoise: SAMPLER.denoise,
      },
    },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['7', 0], vae: ['3', 0] } },
    '9': { class_type: 'SaveImage', inputs: { images: ['8', 0], filename_prefix: 'spike-omni' } },
  };
}

async function main() {
  const client = new ComfyClient();
  if (!(await client.isUp())) throw new Error('ComfyUI not up');
  await mkdir('assets/gen/_spike', { recursive: true });
  const poses = [
    ['running-pose-mid-stride', 101, 'run'],
    ['jumping-up-in-the-air-knees-bent', 102, 'jump'],
  ] as const;
  for (const [pose, seed, tag] of poses) {
    const t = Date.now();
    const { bytes } = await client.render(omniWorkflow(pose, seed));
    const out = `assets/gen/_spike/link-${tag}.png`;
    await writeFile(out, bytes);
    console.log(`[spike] ${tag}: ${(bytes.length / 1024) | 0}KB -> ${out}`);
  }
  console.log('[spike] done');
}
main().catch((e) => { console.error('[spike] FAIL:', e.message); process.exit(1); });
