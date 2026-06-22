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
   across the clip, see `tools/build-newchar-sprites.cjs`) → downscale → pack horizontal
   strip → emit `frames.json` (runtime already reads per-fighter `frames.json`).
3. **Wiring** — register the per-fighter `spriteKey` (link/kirby/donkeykong are
   `placeholder.spriteKey: null`) + the 8-palette swap (`scripts/palette-swap/`).
4. **Scale** — all 13 fighters need rework (the 10 "done" use ancient OpenGameArt CC-BY
   sheets, to be replaced); long-term ~45-55 clips each (`docs/SPRITE-PLAN.md §A`).

Note: clean LOCAL bg-removal has no installed model (`RemoveBackground` weightless;
Bria/Recraft are cloud-API), so chroma-key remains the cutout path — fine now that the
ControlNet output has a flat magenta bg.
