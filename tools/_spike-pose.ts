/**
 * _spike-pose.ts — THROWAWAY. Validates the pose-source step for distinct poses.
 * ONE graph, two stages: (A) text2img a rough pose draft -> Canny -> (B) re-render
 * through ZImageFunControlnet with a FIXED Link-identity prompt+seed. Draft = pose,
 * fixed prompt+seed = consistent identity, ControlNet = clean output.
 * Tests "running" (big pose change). Delete after evaluating.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { ComfyClient } from './comfy-client.ts';
import { MODELS, SAMPLER, NEGATIVE, CHARACTER_PREFIX } from './comfy-style.ts';

const UNION = 'Z-Image-Turbo-Fun-Controlnet-Union.safetensors';
const IDENTITY =
  'a heroic elf swordsman, hero green tunic with tan cream trim, sword and shield, big eyes, full body';
const ID_SEED = 201; // SAME seed as the idle cn keyframe -> identity consistency

function graph(pose: string, draftSeed: number) {
  const draftPrompt = `${CHARACTER_PREFIX} a heroic elf swordsman ${pose}, dynamic, side profile view, full body, on a solid flat chroma-key magenta #FF00FF background`;
  const finalPrompt = `${CHARACTER_PREFIX} ${IDENTITY}, ${pose}, side profile view, on a solid flat chroma-key magenta #FF00FF background, no shadows`;
  return {
    '1': { class_type: 'UNETLoader', inputs: { unet_name: MODELS.unet, weight_dtype: 'default' } },
    '2': { class_type: 'CLIPLoader', inputs: { clip_name: MODELS.clip, type: MODELS.clipType } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: MODELS.vae } },
    // --- stage A: rough pose draft (text2img) ---
    '20': { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: draftPrompt } },
    '21': { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: NEGATIVE } },
    '22': { class_type: 'EmptySD3LatentImage', inputs: { width: 1024, height: 1024, batch_size: 1 } },
    '23': { class_type: 'KSampler', inputs: { model: ['1', 0], seed: draftSeed, steps: SAMPLER.steps, cfg: SAMPLER.cfg, sampler_name: SAMPLER.samplerName, scheduler: SAMPLER.scheduler, positive: ['20', 0], negative: ['21', 0], latent_image: ['22', 0], denoise: SAMPLER.denoise } },
    '24': { class_type: 'VAEDecode', inputs: { samples: ['23', 0], vae: ['3', 0] } },
    '25': { class_type: 'SaveImage', inputs: { images: ['24', 0], filename_prefix: 'spike-pose-draft' } },
    // --- canny of the draft (pose structure) ---
    '30': { class_type: 'Canny', inputs: { image: ['24', 0], low_threshold: 0.3, high_threshold: 0.7 } },
    // --- stage B: clean identity-locked render under ControlNet ---
    '11': { class_type: 'ModelPatchLoader', inputs: { name: UNION } },
    '31': { class_type: 'ZImageFunControlnet', inputs: { model: ['1', 0], model_patch: ['11', 0], vae: ['3', 0], strength: 0.65, image: ['30', 0] } },
    '40': { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: finalPrompt } },
    '41': { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: NEGATIVE } },
    '42': { class_type: 'EmptySD3LatentImage', inputs: { width: 1024, height: 1024, batch_size: 1 } },
    '43': { class_type: 'KSampler', inputs: { model: ['31', 0], seed: ID_SEED, steps: SAMPLER.steps, cfg: SAMPLER.cfg, sampler_name: SAMPLER.samplerName, scheduler: SAMPLER.scheduler, positive: ['40', 0], negative: ['41', 0], latent_image: ['42', 0], denoise: SAMPLER.denoise } },
    '44': { class_type: 'VAEDecode', inputs: { samples: ['43', 0], vae: ['3', 0] } },
    '45': { class_type: 'SaveImage', inputs: { images: ['44', 0], filename_prefix: 'spike-pose-final' } },
  };
}

async function main() {
  const client = new ComfyClient();
  if (!(await client.isUp())) throw new Error('ComfyUI not up');
  await mkdir('assets/gen/_spike', { recursive: true });
  const { bytes } = await client.render(graph('running fast mid-stride', 777));
  await writeFile('assets/gen/_spike/pose-run.png', bytes);
  console.log(`[spike-pose] -> assets/gen/_spike/pose-run.png (${(bytes.length / 1024) | 0}KB)`);
}
main().catch((e) => { console.error('[spike-pose] FAIL:', e.message); process.exit(1); });
