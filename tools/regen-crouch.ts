/**
 * regen-crouch.ts — one-shot: regenerate link crouch with higher CN strength + seed sweep.
 * Tries up to 4 seeds, shows each result so the best one can be selected.
 * Usage: npx tsx tools/regen-crouch.ts
 */
import { writeFile } from 'node:fs/promises';
import { ComfyClient } from './comfy-client.ts';
import { MODELS, SAMPLER, NEGATIVE, CHARACTER_PREFIX } from './comfy-style.ts';

const UNION = 'Z-Image-Turbo-Fun-Controlnet-Union.safetensors';
const FACING = 'strictly facing to the right, right-facing side profile view';
const CANNY = 'link__crouching-very-low-sword-held-horizontal-at-ankle-height-dra.png';

const IDENTITY = 'a heroic elf swordsman, hero green tunic with tan cream trim, holding a sword and a shield, big eyes, full body';
const POSE = 'crouching very low, knees fully bent, body squashed down close to the ground, duck pose, idle defensive crouch, shield held in front, sword held low at side, NOT swinging';
const BG = 'magenta #FF00FF';
const CN_STRENGTH = 0.90;

const SEEDS = [209, 210, 211, 212];

function buildGraph(seed: number) {
  const prompt = `${CHARACTER_PREFIX} ${IDENTITY}, ${POSE}, ${FACING}, on a solid flat chroma-key ${BG} background, no shadows`;
  return {
    '1':  { class_type: 'UNETLoader',           inputs: { unet_name: MODELS.unet, weight_dtype: 'default' } },
    '2':  { class_type: 'CLIPLoader',            inputs: { clip_name: MODELS.clip, type: MODELS.clipType } },
    '3':  { class_type: 'VAELoader',             inputs: { vae_name: MODELS.vae } },
    '11': { class_type: 'ModelPatchLoader',      inputs: { name: UNION } },
    '10': { class_type: 'LoadImage',             inputs: { image: CANNY } },
    '31': { class_type: 'ZImageFunControlnet',   inputs: { model: ['1',0], model_patch: ['11',0], vae: ['3',0], strength: CN_STRENGTH, image: ['10',0] } },
    '40': { class_type: 'CLIPTextEncode',        inputs: { clip: ['2',0], text: prompt } },
    '41': { class_type: 'CLIPTextEncode',        inputs: { clip: ['2',0], text: NEGATIVE } },
    '42': { class_type: 'EmptySD3LatentImage',   inputs: { width: 1024, height: 1024, batch_size: 1 } },
    '43': { class_type: 'KSampler',              inputs: { model: ['31',0], seed, steps: SAMPLER.steps, cfg: SAMPLER.cfg, sampler_name: SAMPLER.samplerName, scheduler: SAMPLER.scheduler, positive: ['40',0], negative: ['41',0], latent_image: ['42',0], denoise: SAMPLER.denoise } },
    '44': { class_type: 'VAEDecode',             inputs: { samples: ['43',0], vae: ['3',0] } },
    '45': { class_type: 'SaveImage',             inputs: { images: ['44',0], filename_prefix: 'pf-crouch-alt' } },
  };
}

const client = new ComfyClient();
if (!(await client.isUp())) throw new Error('ComfyUI not up');

for (const seed of SEEDS) {
  const { bytes } = await client.render(buildGraph(seed));
  const out = `assets/gen/frames/link/crouch-alt-${seed}.png`;
  await writeFile(out, bytes);
  console.log(`[regen-crouch] seed ${seed} → ${out} (${(bytes.length/1024)|0}KB)`);
}
console.log('[regen-crouch] done — inspect crouch-alt-*.png and copy best to crouch-0.png');
