/**
 * gen-frames.ts — generate consistent, distinct-pose character frames for an
 * animation clip via the validated two-stage Z-Image graph:
 *
 *   (A) text2img a rough POSE draft  ->  Canny (pose structure)
 *   (B) re-render through ZImageFunControlnet with a FIXED identity prompt + seed
 *
 * The draft gives the pose; the fixed identity prompt+seed keeps the SAME character
 * across every frame; ControlNet gives clean, on-style, keyable output. Raw 1024²
 * frames land in assets/gen/frames/<fighter>/<anim>-<idx>.png (gitignored); a later
 * packing step crops + downscales + packs strips + emits frames.json.
 *
 * Usage: node.exe node_modules/tsx/dist/cli.mjs tools/gen-frames.ts <spec.json>
 * Spec: { fighter, identity, idSeed, clips: { <anim>: ["pose prompt", ...] } }
 */
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { ComfyClient } from './comfy-client.ts';
import { MODELS, SAMPLER, NEGATIVE, CHARACTER_PREFIX } from './comfy-style.ts';

const UNION = 'Z-Image-Turbo-Fun-Controlnet-Union.safetensors';
const BG = 'on a solid flat chroma-key magenta #FF00FF background, no shadows';

interface ClipSpec {
  fighter: string;
  identity: string;
  idSeed: number;
  clips: Record<string, string[]>;
}

function graph(identity: string, pose: string, idSeed: number, draftSeed: number) {
  const draftPrompt = `${CHARACTER_PREFIX} a ${identity.split(',')[0]} ${pose}, dynamic, side profile view, full body, ${BG}`;
  const finalPrompt = `${CHARACTER_PREFIX} ${identity}, ${pose}, side profile view, ${BG}`;
  return {
    '1': { class_type: 'UNETLoader', inputs: { unet_name: MODELS.unet, weight_dtype: 'default' } },
    '2': { class_type: 'CLIPLoader', inputs: { clip_name: MODELS.clip, type: MODELS.clipType } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: MODELS.vae } },
    '20': { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: draftPrompt } },
    '21': { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: NEGATIVE } },
    '22': { class_type: 'EmptySD3LatentImage', inputs: { width: 1024, height: 1024, batch_size: 1 } },
    '23': { class_type: 'KSampler', inputs: { model: ['1', 0], seed: draftSeed, steps: SAMPLER.steps, cfg: SAMPLER.cfg, sampler_name: SAMPLER.samplerName, scheduler: SAMPLER.scheduler, positive: ['20', 0], negative: ['21', 0], latent_image: ['22', 0], denoise: SAMPLER.denoise } },
    '24': { class_type: 'VAEDecode', inputs: { samples: ['23', 0], vae: ['3', 0] } },
    '30': { class_type: 'Canny', inputs: { image: ['24', 0], low_threshold: 0.3, high_threshold: 0.7 } },
    '11': { class_type: 'ModelPatchLoader', inputs: { name: UNION } },
    '31': { class_type: 'ZImageFunControlnet', inputs: { model: ['1', 0], model_patch: ['11', 0], vae: ['3', 0], strength: 0.65, image: ['30', 0] } },
    '40': { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: finalPrompt } },
    '41': { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: NEGATIVE } },
    '42': { class_type: 'EmptySD3LatentImage', inputs: { width: 1024, height: 1024, batch_size: 1 } },
    '43': { class_type: 'KSampler', inputs: { model: ['31', 0], seed: idSeed, steps: SAMPLER.steps, cfg: SAMPLER.cfg, sampler_name: SAMPLER.samplerName, scheduler: SAMPLER.scheduler, positive: ['40', 0], negative: ['41', 0], latent_image: ['42', 0], denoise: SAMPLER.denoise } },
    '44': { class_type: 'VAEDecode', inputs: { samples: ['43', 0], vae: ['3', 0] } },
    // single SaveImage -> client.render fetches THE final frame (no draft ambiguity)
    '45': { class_type: 'SaveImage', inputs: { images: ['44', 0], filename_prefix: 'pf-frame' } },
  };
}

async function main() {
  const specPath = process.argv[2];
  if (!specPath) throw new Error('usage: gen-frames.ts <spec.json>');
  const spec: ClipSpec = JSON.parse(await readFile(specPath, 'utf8'));
  const client = new ComfyClient();
  if (!(await client.isUp())) throw new Error('ComfyUI not up');
  const outDir = `assets/gen/frames/${spec.fighter}`;
  await mkdir(outDir, { recursive: true });
  let n = 0, total = Object.values(spec.clips).reduce((a, c) => a + c.length, 0);
  for (const [anim, poses] of Object.entries(spec.clips)) {
    for (let i = 0; i < poses.length; i++) {
      const t = Date.now();
      const { bytes } = await client.render(graph(spec.identity, poses[i]!, spec.idSeed, 7000 + n));
      const out = `${outDir}/${anim}-${i}.png`;
      await writeFile(out, bytes);
      n++;
      console.log(`[gen-frames] (${n}/${total}) ${anim}[${i}] "${poses[i]}" -> ${out} (${(bytes.length / 1024) | 0}KB)`);
    }
  }
  console.log(`[gen-frames] done: ${n} frames in ${outDir}`);
}
main().catch((e) => { console.error('[gen-frames] FAIL:', e.message); process.exit(1); });
