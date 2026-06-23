/**
 * _spike-cn.ts — THROWAWAY. ControlNet quality spike. Canny edges from the clean
 * Link anchor drive a fresh Z-Image render via ZImageFunControlnet. Goal: prove
 * the linework comes out CLEAN (vs the noisy Omni spike) at a controlled pose.
 * Delete after evaluating.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { ComfyClient } from './comfy-client.ts';
import { MODELS, SAMPLER, NEGATIVE, CHARACTER_PREFIX } from './comfy-style.ts';

const REF = 'ref-link.png'; // in ~/ComfyUI/input/
const UNION = 'Z-Image-Turbo-Fun-Controlnet-Union.safetensors';
const SUBJECT =
  'a heroic elf swordsman, hero green tunic with tan cream trim, sword and shield, big eyes, full body';

function cnWorkflow(strength: number, seed: number) {
  const positive = `${CHARACTER_PREFIX} ${SUBJECT}, on a solid flat chroma-key magenta #FF00FF background, no shadows`;
  return {
    '1': { class_type: 'UNETLoader', inputs: { unet_name: MODELS.unet, weight_dtype: 'default' } },
    '2': { class_type: 'CLIPLoader', inputs: { clip_name: MODELS.clip, type: MODELS.clipType } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: MODELS.vae } },
    '11': { class_type: 'ModelPatchLoader', inputs: { name: UNION } },
    '10': { class_type: 'LoadImage', inputs: { image: REF } },
    '12': { class_type: 'Canny', inputs: { image: ['10', 0], low_threshold: 0.3, high_threshold: 0.7 } },
    '13': {
      class_type: 'ZImageFunControlnet',
      inputs: { model: ['1', 0], model_patch: ['11', 0], vae: ['3', 0], strength, image: ['12', 0] },
    },
    '4': { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: positive } },
    '5': { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: NEGATIVE } },
    '6': { class_type: 'EmptySD3LatentImage', inputs: { width: 1024, height: 1024, batch_size: 1 } },
    '7': {
      class_type: 'KSampler',
      inputs: {
        model: ['13', 0], seed, steps: SAMPLER.steps, cfg: SAMPLER.cfg,
        sampler_name: SAMPLER.samplerName, scheduler: SAMPLER.scheduler,
        positive: ['4', 0], negative: ['5', 0], latent_image: ['6', 0], denoise: SAMPLER.denoise,
      },
    },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['7', 0], vae: ['3', 0] } },
    '9': { class_type: 'SaveImage', inputs: { images: ['8', 0], filename_prefix: 'spike-cn' } },
    // also save the canny map so we can see the control signal
    '14': { class_type: 'SaveImage', inputs: { images: ['12', 0], filename_prefix: 'spike-cn-canny' } },
  };
}

async function main() {
  const client = new ComfyClient();
  if (!(await client.isUp())) throw new Error('ComfyUI not up');
  await mkdir('assets/gen/_spike', { recursive: true });
  // strength 0.6: enough structure, room for clean redraw
  const { bytes } = await client.render(cnWorkflow(0.6, 201));
  await writeFile('assets/gen/_spike/cn-link.png', bytes);
  console.log(`[spike-cn] -> assets/gen/_spike/cn-link.png (${(bytes.length / 1024) | 0}KB)`);
}
main().catch((e) => { console.error('[spike-cn] FAIL:', e.message); process.exit(1); });
