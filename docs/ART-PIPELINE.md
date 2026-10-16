# Art Pipeline — runbook

How to generate game art with the locked Brawlhalla-style recipe (see
`docs/ART-STYLE.md`) using the native WSL ComfyUI + the `tools/` client.

The style is **LOCKED**: Brawlhalla-style clean 2D cartoon, **not** pixel art.
Z-Image-Turbo base + cartoon prompting, no pixel LoRA. Canonical prompts/negatives
and sampler settings live in `tools/comfy-style.ts` (mirrors `docs/ART-STYLE.md`).

---

## 1. Launch the ComfyUI server

A native ComfyUI lives in WSL at `~/ComfyUI` (venv `~/ComfyUI/.venv`, torch
2.12+cu130, GPU RTX 5070 Ti). `~/ComfyUI/extra_model_paths.yaml` already points at
the Windows `ComfyUI-Shared/models` dir, so the 12GB+ models are shared — no
re-download.

```bash
cd ~/ComfyUI && source .venv/bin/activate && python main.py --listen 127.0.0.1 --port 8188
```

Boots in ~10s. Confirm it's up:

```bash
curl -s http://127.0.0.1:8188/system_stats   # JSON with GPU + version
```

Models the client expects (validated, see `TODO.md`):
- `diffusion_models/z_image_turbo_bf16.safetensors`
- `text_encoders/qwen_3_4b.safetensors`  (loaded as CLIP type `lumina2`)
- `vae/ae.safetensors`

(Server confirmed launching this session: ComfyUI 0.25.0, CUDA, RTX 5070 Ti.)

---

### Low-VRAM machines (verified 2026-09-25 on an RTX 4070 Laptop, 8 GB VRAM, 15.5 GB WSL RAM)

The bf16 recipe above needs ~20 GB of model memory and will not fit an 8 GB GPU
with a 16 GB WSL VM. The same Comfy-Org repo publishes smaller official variants
that run the identical graphs (text2img and the ControlNet path) unchanged:

| Slot | File (same folder as the bf16 one) | Size |
|------|-------------------------------------|------|
| `diffusion_models/` | `z_image_turbo_int8_convrot.safetensors` | 6.2 GB |
| `text_encoders/`    | `qwen_3_4b_fp8_mixed.safetensors`        | 5.6 GB |
| `vae/`              | `ae.safetensors` (unchanged)             | 0.3 GB |
| `model_patches/`    | `Z-Image-Turbo-Fun-Controlnet-Union.safetensors` (unchanged) | 3.1 GB |

Point the tooling at them with environment variables instead of editing code
(`tools/comfy-style.ts` reads them; every generator imports `MODELS` from there,
and `build-canny-library` records the actual `MODELS.unet` in its manifest):

```bash
export PF_COMFY_UNET=z_image_turbo_int8_convrot.safetensors
export PF_COMFY_CLIP=qwen_3_4b_fp8_mixed.safetensors
```

Launch without `--lowvram` (ComfyUI ≥ 0.37 manages VRAM dynamically) but keep
`--disable-smart-memory` so the text encoder is evicted before the diffusion model
loads:

```bash
cd ~/ComfyUI && source .venv/bin/activate && python main.py --listen 127.0.0.1 --port 8188 --disable-smart-memory
```

Measured on that machine at 1024², 8 steps: text2img 32 s including model load,
ControlNet (Canny → `ZImageFunControlnet`) 42 s. Later renders in the same
session skip most of the load time. Quality of the int8/fp8 pair versus bf16 has
not been compared side by side; treat any visible difference as a candidate
cause before blaming prompts.

## 2. Generate an asset

```bash
# Character (style prefix auto-prepended)
npx tsx tools/gen-sprite.ts --kind character \
  --prompt "ninja cat in a fighting stance" \
  --seed 1 --out assets/gen/cat-idle.png

# Stage background
npx tsx tools/gen-sprite.ts --kind background \
  --prompt "midground: floating sky island arena, stone ruins, blue sky, no characters" \
  --out assets/gen/stage-sky.png

# Item / prop
npx tsx tools/gen-sprite.ts --kind item \
  --prompt "glowing energy sword" --seed 42 --out assets/gen/sword.png
```

Useful flags: `--seed N` (fix for reproducibility / clip consistency),
`--steps N --cfg N --width N --height N` (overrides; defaults 8 / 4.5 / 1024²),
`--raw-prompt` (skip the style prefix), `--url <base>` (non-default server),
`--dump-workflow` (print the workflow JSON and exit — works **offline**, handy for
inspecting/debugging the graph without a render). `--help` for the full list.

A 1024² render takes ~4–5 min on the laptop GPU. Output PNGs land where `--out`
points (dirs auto-created). **Generated PNGs are git-ignored** (`assets/gen/`) —
they're large and reproducible; commit tooling, not output.

### Verified test render
`assets/gen/test-stage.png` — 1024×1024, seed 7, a floating sky-island arena.
Proves the full round-trip (POST `/prompt` → poll `/history` → fetch `/view` →
write PNG). One small sample is committed; the rest of `assets/gen/` is ignored.

---

## 2b. Pose guides from UFD frames (fighters with a Smash source)

Text-to-image drafts ignore stance ("crouched on all fours") and two-handed
contact, so `build-canny-library.ts` drafts produced upright, one-arm poses for
Donkey Kong's up tilt and forward smash (pilot 1, 2026-09-25). For a UFD-based
kit, derive the edge maps from the extracted UFD animation frames instead:

```bash
python3 tools/ufd-pose-canny.py \
  docs/review/<date>/<fighter>-character/pose-schedule.json \
  assets/gen/<fighter>-clips-ufd.json \
  --extracted assets/gen/<fighter>-ufd/extracted --reference <StandingDir>:<index>
```

It writes one edge map per scheduled pose into `assets/gen/canny-library/`
(same manifest and `<fighter>__<poseHash>.png` naming as the draft builder, so
`gen-frames-cn.ts` needs no change), plus review sheets (source | mask | edge)
and a `report.json` (scale, the pose that bound it, per-pose notes) under
`assets/gen/<fighter>-ufd/pose-guides/`. Run it with `~/ComfyUI/.venv/bin/python`
(it needs scipy for blob filtering; the system python has none). Copy the new
maps into `~/ComfyUI/input/` before rendering.

Rules it applies: pick an overlay-free neighbour within ±3 frames when the
requested frame carries attack overlays; strip overlay fill drawn over the flat
background including its anti-aliased rim; drop blobs smaller than 3 % of the
body; union with clean neighbours only when their body sits where this one does
(travelling and rising moves displace the fighter between frames); rebuild the
striking limb from the white "+" markers at overlay centres, pulling any centre
farther than 1.25 standing heights back in; keep dark armour/intangibility
tints as body; fill enclosed holes.

Scale and registration: ONE scale for the whole batch — the reference
standing height is 600 px on every canvas — and a canvas per pose: the
smallest of {1024, 1280, 1536, 1792} × {1024, 1280, 1536} on which the pose,
reach included, fits with a 12 px margin (the log prints the distribution and
every non-1024² pose; a pose that exceeds even 1792×1536 is clipped and
flagged). Every canvas shares the registration — bbox bottom 144 px above the
canvas bottom, silhouette centroid at the horizontal centre, so an extended
arm does not slide the body — and `pack-clips.cjs` aligns mixed canvas sizes
on those two anchors. `gen-frames-cn.ts` sizes the latent from the guide's
own dimensions (a 1792×1024 frame takes ~70 s on the 8 GB GPU against ~38 s
for 1024²). Do NOT shrink the scale to make reach fit on 1024²: at 325 px the
model ignored the outline in about four frames out of five and drew a
canvas-filling fighter (Donkey Kong batch 2, 2026-09-25, stopped after 31
frames); at 600 px it obeyed every frame. Never mix guides built at different
scales in one batch either: packing shares one cell scale, so a full-canvas
text draft next to a 600 px guide makes the fighter grow by a third between
clips (Donkey Kong batch 1, rejected for exactly that plus 25 frames with
limbs cut at the canvas edge). To regenerate a subset, run the tool with
`--clips a,b` (the scale is the same for any subset) and render only those
poses with `PF_GEN_ONLY="smash:2,utilt" node node_modules/tsx/dist/cli.mjs
tools/gen-frames-cn.ts <spec>` (same seed and graph as the batch). A frame
rejected at inspection needs `PF_GEN_SEED=<other seed>` as well — the same
guide and seed reproduce the same image — and the retry must be inspected
again for identity drift. A render that ignored a crouched or low guide
(an upright body on a low outline) gets `PF_GEN_STRENGTH=1.0`. When the
tool's ±3 overlay-free shift lands two poses on the same source frame,
pin the schedule entry with `"exact": true` (the overlay reconstruction is
then used) and regenerate that clip's guides with `--clips <clip>`.

Clips UFD does not show (run cycle, jump phases, hurt, shield) take their
silhouettes from `--fallback-frames <dir>/<clip>-<i>.png` (magenta-keyed
renders, e.g. a text-guided batch) resized to `heightRatio` × the reference
standing height (a schedule-entry field). The ratio is the POSE's height
relative to the reference stance, not 1.0 by default: Donkey Kong's reference
stance is his hunched idle, and his upright text-draft poses needed 1.2–1.4.
Idle should be the UFD idle stance (frame 0 of any grounded attack GIF) as a
single keyframe: copy the render to `assets/gen/_spike/cn-<fighter>.png`,
delete `idle-*.png` from the frames dir, and `pack-clips.cjs` synthesises the
breathing loop.

Because these maps are silhouettes rather than full Canny drafts, render them
with `cnStrength` 0.9 (0.6 let the model straighten crouches upright), and add
`shadow, drop shadow, ground shadow, cast shadow, reflection` to the negative
prompt — the renderer otherwise draws a dark-magenta ground shadow that
survives the chroma key. `pack-clips.cjs` chroma-keys by hue (including the
mauve one-pixel canvas border the VAE leaves and the red-tinted residue the
model bleeds into concavities — the latter only where it connects to the
background or forms a small pocket, never as a plain threshold), despeckles
isolated off-key pixels, drops floating specks, fits the global union rect
into the 256² cell on BOTH axes (wide-reach kits have unions wider than
tall) and pins the bottom; the standing
height in the cell is therefore set by the widest/tallest pose of the whole
kit — calibrate `src/characters/visualScale.ts` from the packed idle cell
(`display = bodyHeight / (standing px / 256)`). After packing, `python3
tools/sync-manifest-sheets.py <fighter>` rewrites the fighter's manifest block
from `frames.json`.

## 3. Tooling layout (`tools/`)

| File | Role |
|------|------|
| `tools/comfy-style.ts`  | Locked art recipe: prompts, negatives, models, sampler settings, and the Z-Image text2img **workflow builder**. Single source of truth — pure data, no I/O. |
| `tools/comfy-client.ts` | Typed ComfyUI HTTP client: `queue` → `waitForImages` → `fetchImage` (+ `isUp`, `render`). Pure transport. |
| `tools/gen-sprite.ts`   | CLI entrypoint. Parses flags, builds the prompt+workflow, renders, writes the PNG. |
| `tools/tsconfig.json`   | Standalone type-check for `tools/` (see "Type-checking" below). |

Designed modular so later stages import `comfy-style`/`comfy-client` and add their
own step without touching the CLI.

### Type-checking
`tools/` is **not** in the root `tsconfig.json` `include` (that config builds the
app + `scripts/`). Type-check the tooling on its own:

```bash
npx tsc --noEmit -p tools/tsconfig.json
```

(The root `npm run build` / `tsc --noEmit` does not cover `tools/`.)

---

## 4. Status — done vs TODO

Asset order (per `docs/SPRITE-PLAN.md` / `docs/ART-STYLE.md`, cheapest-win first):
**stage backgrounds → item sprites → character portraits → animation clips.**

### Done
- WSL ComfyUI launch + readiness check (runbook above).
- Z-Image text2img workflow builder with the locked cartoon recipe.
- Typed ComfyUI client (queue → poll → fetch → save).
- `gen-sprite.ts` CLI with character/background/item modes + a working test render.
- **Batch driver** (`tools/batch-gen.ts`) — manifest of `{kind,prompt,seed,out}` → loop.
- **Background removal** (`tools/bg-remove.ts`) — flat chroma-key (#FF00FF) + `--despill`.
- **Downscale** (`tools/downscale.ts`) — area-average, aspect-preserving (`--max`).
- Stages/items/portraits batch rendered (see `docs/ART-ASSETS.md`, `assets/concept-art/`).

### Frame-consistency: VALIDATED approach (2026-06-22)
The "img2img / frame consistency" hard part (`docs/SPRITE-PLAN.md §E`) was spiked two ways:
- **Image-reference (`TextEncodeZImageOmni`)** — holds character identity across poses,
  BUT output is grainy + the magenta bg comes back speckled (won't chroma-key). ✗
- **ControlNet (`ZImageFunControlnet` + `Canny`)** — clean bold-outline on-style linework,
  FLAT keyable bg, identity held. ✓ **This is the chosen path.**

Graph: `UNETLoader + CLIPLoader(lumina2) + VAELoader` + `ModelPatchLoader(union)` +
`LoadImage(ref)` → `Canny` → `ZImageFunControlnet(model, model_patch, vae, image=canny,
strength≈0.6)` → `KSampler(model=patched)` → `VAEDecode` → `SaveImage`.

Setup required:
- Model `Z-Image-Turbo-Fun-Controlnet-Union.safetensors` (3.1 GB) in shared
  `models/model_patches/`.
- `~/ComfyUI/extra_model_paths.yaml` MUST map `model_patches` (and `controlnet`,
  `clip_vision`, `style_models`, `background_removal`) — the original only mapped
  checkpoints/diffusion_models/text_encoders/clip/loras/vae, so `ModelPatchLoader`
  showed an empty list until those were added + ComfyUI restarted.
- Run ComfyUI with `--lowvram` (base model + 3 GB ControlNet patch); avoids the
  `0x116 VIDEO_TDR_FAILURE` GPU BSOD seen at the 12 GB VRAM ceiling.

### TODO (remaining, in pipeline order)
1. **Pose-source per frame** — distinct control map per frame: `Canny` of pose drafts,
   or `SDPoseKeypointExtractor`/`SDPoseDrawKeypoints` skeletons.
2. **`gen-clip` pipeline** — generate N frames → bg-remove → union-bbox crop (one rect
   across the clip, see `tools/pack-clips.cjs`) → downscale → pack horizontal
   strip → emit `frames.json` (runtime already reads per-fighter `frames.json`).
3. **Wiring** — register the per-fighter `spriteKey`; recolours come from the
   runtime palette shader (`src/characters/paletteSwapShader.ts`).
4. **Scale** — the roster is Donkey Kong, Pikachu and Link; long-term ~45-55 clips
   each (`docs/SPRITE-PLAN.md §A`).

Note: clean LOCAL bg-removal has no installed model (`RemoveBackground` weightless;
Bria/Recraft are cloud-API), so chroma-key remains the cutout path — fine now that the
ControlNet output has a flat magenta bg.
