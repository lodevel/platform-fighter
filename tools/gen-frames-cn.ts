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
 * Subset: PF_GEN_ONLY="smash:2,utilt" renders only those poses / clips;
 * PF_GEN_SEED=<n> retries them with another seed, PF_GEN_STRENGTH=<0..1> with another ControlNet strength.
 * Overwrites assets/gen/frames/<fighter>/<clip>-<i>.png in place: copy frames you may
 * want back into an archive folder first, and never run a full spec without PF_GEN_ONLY
 * on a fighter whose frames were hand-picked (it also recreates idle-0.png).
 * PREREQ: the library cannys must already be in ComfyUI's input dir (LoadImage
 * reads from there). The orchestration copies them in via WSL `cp` before running
 * (Windows node.exe can't write to the WSL ~/ComfyUI/input path directly).
 *
 * Usage: node node_modules/tsx/dist/cli.mjs tools/gen-frames-cn.ts <spec.json>   (node.exe from a Windows shell)
 */
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { ComfyClient } from './comfy-client.ts';
import { MODELS, SAMPLER, NEGATIVE, CHARACTER_PREFIX } from './comfy-style.ts';

const UNION = 'Z-Image-Turbo-Fun-Controlnet-Union.safetensors';
const FACING = 'strictly facing to the right, right-facing side profile view';
const LIB_DIR = 'assets/gen/canny-library';

interface ClipSpec { fighter: string; identity: string; idSeed: number; clips: Record<string, string[]>; bg?: string; negative?: string; cnStrength?: number }

function poseHash(pose: string): string {
  return pose.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

function graphFromCanny(identity: string, bg: string, pose: string, cannyFile: string, idSeed: number, negativeExtra?: string, cnStrength?: number, size: { width: number; height: number } = { width: 1024, height: 1024 }) {
  const finalPrompt = `${CHARACTER_PREFIX} ${identity}, ${pose}, ${FACING}, on a solid flat chroma-key ${bg} background, no shadows`;
  // Per-spec negative additions (e.g. suppress a hallucinated cape for a
  // capeless fighter) appended to the shared global NEGATIVE.
  const negativePrompt = negativeExtra ? `${NEGATIVE}, ${negativeExtra}` : NEGATIVE;
  // ControlNet strength: higher hugs the (capeless) canny silhouette more
  // tightly, giving the model less room to invent a cape; default 0.65.
  const strength = cnStrength ?? 0.65;
  return {
    '1': { class_type: 'UNETLoader', inputs: { unet_name: MODELS.unet, weight_dtype: 'default' } },
    '2': { class_type: 'CLIPLoader', inputs: { clip_name: MODELS.clip, type: MODELS.clipType } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: MODELS.vae } },
    '11': { class_type: 'ModelPatchLoader', inputs: { name: UNION } },
    '10': { class_type: 'LoadImage', inputs: { image: cannyFile } },
    '31': { class_type: 'ZImageFunControlnet', inputs: { model: ['1', 0], model_patch: ['11', 0], vae: ['3', 0], strength, image: ['10', 0] } },
    '40': { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: finalPrompt } },
    '41': { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: negativePrompt } },
    '42': { class_type: 'EmptySD3LatentImage', inputs: { width: size.width, height: size.height, batch_size: 1 } },
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

  // PF_GEN_ONLY="smash:2,up_special,utilt:4" re-renders just those poses/clips
  // (same seed, same graph) — for retries after inspection, without touching
  // the rest of the batch.
  const only = (process.env.PF_GEN_ONLY ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  // PF_GEN_SEED overrides the spec's identity seed for a retry: the same guide
  // with the same seed reproduces the same image, so a rejected frame needs a
  // new seed (identity stays anchored by the prompt + guide; inspect the retry).
  const seed = process.env.PF_GEN_SEED ? Number(process.env.PF_GEN_SEED) : spec.idSeed;
  if (seed !== spec.idSeed) console.log(`[gen-cn] seed override ${spec.idSeed} -> ${seed}`);
  // PF_GEN_STRENGTH overrides ControlNet strength for a retry whose render
  // ignored the guide (an upright body on a crouched outline).
  const strength = process.env.PF_GEN_STRENGTH ? Number(process.env.PF_GEN_STRENGTH) : spec.cnStrength;
  if (strength !== spec.cnStrength) console.log(`[gen-cn] strength override ${spec.cnStrength} -> ${strength}`);
  const wanted = (anim: string, i: number) =>
    only.length === 0 || only.includes(anim) || only.includes(`${anim}:${i}`);
  let n = 0;
  const total = Object.values(spec.clips).reduce((a, c) => a + c.length, 0);
  for (const [anim, poses] of Object.entries(spec.clips)) {
    for (let i = 0; i < poses.length; i++) {
      const pose = poses[i]!;
      if (!wanted(anim, i)) continue;
      const hash = `${spec.fighter}__${poseHash(pose)}`;
      const entry = manifest[hash];
      n++;
      if (!entry) { console.log(`[gen-cn] (${n}/${total}) MISS no canny for "${pose}" — skipped`); continue; }
      // The latent takes the guide's own canvas size: wide-reach or tall poses
      // come on a larger canvas (see tools/ufd-pose-canny.py) so the fighter
      // keeps the same pixel scale as every other frame.
      const png = await readFile(`${LIB_DIR}/${entry.file}`);
      const size = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
      const { bytes } = await client.render(graphFromCanny(spec.identity, bg, pose, entry.file, seed, spec.negative, strength, size));
      const out = `${outDir}/${anim}-${i}.png`;
      await writeFile(out, bytes);
      console.log(`[gen-cn] (${n}/${total}) ${anim}[${i}] <- ${entry.file} ${size.width}x${size.height} -> ${out} (${(bytes.length / 1024) | 0}KB)`);
    }
  }
  console.log(`[gen-cn] done: ${n} frames in ${outDir}`);
}
main().catch((e) => { console.error('[gen-cn] FAIL:', e.message); process.exit(1); });
