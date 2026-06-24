/**
 * gen-shield.ts — one-off: render a single consistent Hylian shield sprite
 * (text2img, no ControlNet) for the decoupled-shield system. The shield is
 * authored ONCE here and composited onto every Link frame at build time, so
 * its design stays identical across all poses (the thing per-frame AI gen
 * cannot do).
 *
 * Usage: node.exe node_modules/tsx/dist/cli.mjs tools/gen-shield.ts [out.png] [seed]
 */
import { writeFile } from 'node:fs/promises';
import { ComfyClient } from './comfy-client.ts';
import { MODELS, SAMPLER, NEGATIVE } from './comfy-style.ts';

const PROMPT =
  'a single iconic Hylian shield from The Legend of Zelda, front view facing the ' +
  'viewer dead-on, the classic rounded-top shield tapering to a point at the ' +
  'bottom, a polished silver steel rim, a deep cobalt-blue face, a bright golden ' +
  'border tracing the edge, the golden Triforce three-triangle symbol at the top ' +
  'centre above a stylized red phoenix crest with spread wings, ornate and regal, ' +
  'glossy polished metal with soft specular highlights, Super Smash Bros Ultimate ' +
  'premium 3D render style, vibrant saturated colors, bright even studio lighting, ' +
  'crisp and detailed, the shield centered and upright and filling the frame, on a ' +
  'solid flat magenta #FF00FF background, no shadows';

function graph(seed: number) {
  return {
    '1': { class_type: 'UNETLoader', inputs: { unet_name: MODELS.unet, weight_dtype: 'default' } },
    '2': { class_type: 'CLIPLoader', inputs: { clip_name: MODELS.clip, type: MODELS.clipType } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: MODELS.vae } },
    '20': { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: PROMPT } },
    '21': { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: `${NEGATIVE}, person, character, hand, arm, sword, multiple shields` } },
    '22': { class_type: 'EmptySD3LatentImage', inputs: { width: 1024, height: 1024, batch_size: 1 } },
    '23': { class_type: 'KSampler', inputs: { model: ['1', 0], seed, steps: SAMPLER.steps, cfg: SAMPLER.cfg, sampler_name: SAMPLER.samplerName, scheduler: SAMPLER.scheduler, positive: ['20', 0], negative: ['21', 0], latent_image: ['22', 0], denoise: SAMPLER.denoise } },
    '24': { class_type: 'VAEDecode', inputs: { samples: ['23', 0], vae: ['3', 0] } },
    '25': { class_type: 'SaveImage', inputs: { images: ['24', 0], filename_prefix: 'pf-shield' } },
  };
}

async function main() {
  const out = process.argv[2] ?? 'assets/gen/link-shield.png';
  const seed = Number(process.argv[3] ?? 4242);
  const client = new ComfyClient();
  if (!(await client.isUp())) throw new Error('ComfyUI not up');
  const { bytes } = await client.render(graph(seed));
  await writeFile(out, bytes);
  console.log(`[gen-shield] wrote ${out} (${(bytes.length / 1024) | 0}KB, seed ${seed})`);
}
main().catch((e) => { console.error('[gen-shield] FAIL:', e.message); process.exit(1); });
