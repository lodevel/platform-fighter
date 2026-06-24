/**
 * build-canny-library.ts — generate a REUSABLE pose Canny library (the speed +
 * consistency win identified by the throughput study).
 *
 * For each unique pose across a clip spec, run ONCE:  text2img draft -> Canny ->
 * save the edge map to assets/gen/canny-library/<poseHash>.png + a manifest. The
 * draft uses a NEUTRAL body and a SINGLE ENFORCED FACING so every pose's edges
 * face the same way — this is what stops the in-engine "spinning" (frames must
 * share one canonical facing). Drafts are character-independent, so the library
 * is built once and reused for every fighter (gen-frames runs a ControlNet-only
 * pass over these cached cannys).
 *
 * Usage: node.exe node_modules/tsx/dist/cli.mjs tools/build-canny-library.ts <spec.json>
 * Spec (same file gen-frames uses): { fighter, identity, idSeed, clips: {<anim>:[pose,...]}, draftBody? }
 */
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { ComfyClient } from './comfy-client.ts';
import { MODELS, SAMPLER, NEGATIVE, CHARACTER_PREFIX } from './comfy-style.ts';

// Canonical facing baked into EVERY draft so all frames share one direction.
// Right-facing matches the engine default (CHARACTER_SPRITE_FACES_LEFT.<id> = false:
// art faces right, engine flips when moving left).
const FACING = 'strictly facing to the right, right-facing side profile view, body and head turned to the right';
const LIB_DIR = 'assets/gen/canny-library';

interface ClipSpec {
  fighter: string;
  clips: Record<string, string[]>;
  draftBody?: string;
  bg?: string;
  // Per-spec negative additions appended to the global NEGATIVE — keeps an
  // unwanted feature (e.g. a cape) OUT of the draft so the Canny edge map
  // never contains it, the real root-cause fix vs only negating at render time.
  negative?: string;
  // Canny edge thresholds. Lower = denser, more complete edges = a tighter
  // control map that leaves the render less room to improvise. Defaults match
  // the legacy 0.3/0.7; a clean capeless silhouette wants ~0.1/0.3.
  cannyLow?: number;
  cannyHigh?: number;
}

function poseHash(pose: string): string {
  return pose.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

function cannyGraph(
  body: string,
  bg: string,
  pose: string,
  draftSeed: number,
  negativeExtra?: string,
  cannyLow?: number,
  cannyHigh?: number,
) {
  const draftPrompt = `${CHARACTER_PREFIX} ${body}, ${pose}, ${FACING}, full body, on a solid flat chroma-key ${bg} background`;
  const negativePrompt = negativeExtra ? `${NEGATIVE}, ${negativeExtra}` : NEGATIVE;
  return {
    '1': { class_type: 'UNETLoader', inputs: { unet_name: MODELS.unet, weight_dtype: 'default' } },
    '2': { class_type: 'CLIPLoader', inputs: { clip_name: MODELS.clip, type: MODELS.clipType } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: MODELS.vae } },
    '20': { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: draftPrompt } },
    '21': { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: negativePrompt } },
    '22': { class_type: 'EmptySD3LatentImage', inputs: { width: 1024, height: 1024, batch_size: 1 } },
    '23': { class_type: 'KSampler', inputs: { model: ['1', 0], seed: draftSeed, steps: SAMPLER.steps, cfg: SAMPLER.cfg, sampler_name: SAMPLER.samplerName, scheduler: SAMPLER.scheduler, positive: ['20', 0], negative: ['21', 0], latent_image: ['22', 0], denoise: SAMPLER.denoise } },
    '24': { class_type: 'VAEDecode', inputs: { samples: ['23', 0], vae: ['3', 0] } },
    '30': { class_type: 'Canny', inputs: { image: ['24', 0], low_threshold: cannyLow ?? 0.3, high_threshold: cannyHigh ?? 0.7 } },
    // single SaveImage = the CANNY edge map (what we cache)
    '31': { class_type: 'SaveImage', inputs: { images: ['30', 0], filename_prefix: 'pf-canny' } },
  };
}

async function main() {
  const specPath = process.argv[2];
  if (!specPath) throw new Error('usage: build-canny-library.ts <spec.json>');
  const spec: ClipSpec = JSON.parse(await readFile(specPath, 'utf8'));
  const body = spec.draftBody ?? 'a humanoid fighter';
  const bg = spec.bg ?? 'magenta #FF00FF';
  const client = new ComfyClient();
  if (!(await client.isUp())) throw new Error('ComfyUI not up');
  await mkdir(LIB_DIR, { recursive: true });

  // load existing manifest (resume / cross-fighter reuse)
  const manifestPath = `${LIB_DIR}/manifest.json`;
  const manifest: Record<string, { pose: string; file: string; model: string; draftSeed: number }> =
    existsSync(manifestPath) ? JSON.parse(await readFile(manifestPath, 'utf8')) : {};

  const poses = [...new Set(Object.values(spec.clips).flat())];
  let n = 0, made = 0;
  for (const pose of poses) {
    n++;
    // Namespace by fighter: different bodies (link swordsman vs kirby puffball) must
    // NOT share a pose's Canny, even for an identically-worded pose.
    const hash = `${spec.fighter}__${poseHash(pose)}`;
    if (manifest[hash] && existsSync(`${LIB_DIR}/${manifest[hash].file}`)) {
      console.log(`[canny-lib] (${n}/${poses.length}) cached: ${hash}`);
      continue;
    }
    const draftSeed = 5000 + n;
    const { bytes } = await client.render(
      cannyGraph(body, bg, pose, draftSeed, spec.negative, spec.cannyLow, spec.cannyHigh),
    );
    const file = `${hash}.png`;
    await writeFile(`${LIB_DIR}/${file}`, bytes);
    manifest[hash] = { pose, file, model: MODELS.unet, draftSeed };
    made++;
    console.log(`[canny-lib] (${n}/${poses.length}) built: ${file} (${(bytes.length / 1024) | 0}KB)`);
  }
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`[canny-lib] done: ${made} new, ${poses.length - made} cached -> ${LIB_DIR}`);
}
main().catch((e) => { console.error('[canny-lib] FAIL:', e.message); process.exit(1); });
