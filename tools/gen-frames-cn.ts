/**
 * gen-frames-cn.ts — ControlNet-ONLY frame generation from the cached Canny
 * library (the fast path: no per-frame draft stage).
 *
 * For each pose, load its cached Canny edge map (built once by
 * build-canny-library.ts, with a single ENFORCED facing) and re-render it through
 * ZImageFunControlnet with a FIXED identity prompt + seed. The canny supplies the
 * pose + facing; the fixed prompt/seed supplies the consistent character. ~45%
 * faster per frame than the two-stage path, and because every canny shares one
 * facing the frames no longer "spin" in-engine.
 *
 * PREREQ: the library cannys must already be in ComfyUI's input dir (LoadImage
 * reads from there). The orchestration copies them in via WSL `cp` before running
 * (Windows node.exe can't write to the WSL ~/ComfyUI/input path directly).
 *
 * Usage: node.exe node_modules/tsx/dist/cli.mjs tools/gen-frames-cn.ts <spec.json>
 */
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { ComfyClient } from './comfy-client.ts';
import { MODELS, SAMPLER, NEGATIVE, CHARACTER_PREFIX } from './comfy-style.ts';

const UNION = 'Z-Image-Turbo-Fun-Controlnet-Union.safetensors';
const FACING = 'strictly facing to the right, right-facing side profile view';
const LIB_DIR = 'assets/gen/canny-library';

interface ClipSpec { fighter: string; identity: string; idSeed: number; clips: Record<string, string[]>; bg?: string }

function poseHash(pose: string): string {
  return pose.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

function graphFromCanny(identity: string, bg: string, pose: string, cannyFile: string, idSeed: number) {
  const finalPrompt = `${CHARACTER_PREFIX} ${identity}, ${pose}, ${FACING}, on a solid flat chroma-key ${bg} background, no shadows`;
  return {
    '1': { class_type: 'UNETLoader', inputs: { unet_name: MODELS.unet, weight_dtype: 'default' } },
    '2': { class_type: 'CLIPLoader', inputs: { clip_name: MODELS.clip, type: MODELS.clipType } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: MODELS.vae } },
    '11': { class_type: 'ModelPatchLoader', inputs: { name: UNION } },
    '10': { class_type: 'LoadImage', inputs: { image: cannyFile } },
    '31': { class_type: 'ZImageFunControlnet', inputs: { model: ['1', 0], model_patch: ['11', 0], vae: ['3', 0], strength: 0.65, image: ['10', 0] } },
    '40': { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: finalPrompt } },
    '41': { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: NEGATIVE } },
    '42': { class_type: 'EmptySD3LatentImage', inputs: { width: 1024, height: 1024, batch_size: 1 } },
    '43': { class_type: 'KSampler', inputs: { model: ['31', 0], seed: idSeed, steps: SAMPLER.steps, cfg: SAMPLER.cfg, sampler_name: SAMPLER.samplerName, scheduler: SAMPLER.scheduler, positive: ['40', 0], negative: ['41', 0], latent_image: ['42', 0], denoise: SAMPLER.denoise } },
    '44': { class_type: 'VAEDecode', inputs: { samples: ['43', 0], vae: ['3', 0] } },
    '45': { class_type: 'SaveImage', inputs: { images: ['44', 0], filename_prefix: 'pf-frame-cn' } },
  };
}

async function main() {
  const specPath = process.argv[2];
  if (!specPath) throw new Error('usage: gen-frames-cn.ts <spec.json>');
  const spec: ClipSpec = JSON.parse(await readFile(specPath, 'utf8'));
  const manifest: Record<string, { pose: string; file: string }> =
    JSON.parse(await readFile(`${LIB_DIR}/manifest.json`, 'utf8'));
  const client = new ComfyClient();
  if (!(await client.isUp())) throw new Error('ComfyUI not up');
  const outDir = `assets/gen/frames/${spec.fighter}`;
  await mkdir(outDir, { recursive: true });
  const bg = spec.bg ?? 'magenta #FF00FF';

  let n = 0;
  const total = Object.values(spec.clips).reduce((a, c) => a + c.length, 0);
  for (const [anim, poses] of Object.entries(spec.clips)) {
    for (let i = 0; i < poses.length; i++) {
      const pose = poses[i]!;
      const hash = `${spec.fighter}__${poseHash(pose)}`;
      const entry = manifest[hash];
      n++;
      if (!entry) { console.log(`[gen-cn] (${n}/${total}) MISS no canny for "${pose}" — skipped`); continue; }
      const { bytes } = await client.render(graphFromCanny(spec.identity, bg, pose, entry.file, spec.idSeed));
      const out = `${outDir}/${anim}-${i}.png`;
      await writeFile(out, bytes);
      console.log(`[gen-cn] (${n}/${total}) ${anim}[${i}] <- ${entry.file} -> ${out} (${(bytes.length / 1024) | 0}KB)`);
    }
  }
  console.log(`[gen-cn] done: ${n} frames in ${outDir}`);
}
main().catch((e) => { console.error('[gen-cn] FAIL:', e.message); process.exit(1); });
