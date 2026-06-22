# Concept / Reference Art (`assets/concept-art/`)

AI-generated reference art produced with the local ComfyUI + Z-Image-Turbo pipeline
(`tools/batch-gen.ts` → `tools/bg-remove.ts` → `tools/downscale.ts`).

> ⚠️ **These are concept/reference illustrations, NOT engine sprites.** They are *not*
> wired into the game and do not match the runtime sprite format. The actual in-game
> sprites are tiny multi-frame strips under `assets/characters/<id>/animations/`
> (e.g. `idle.png` is 256×64 — several frames in a row). The portraits/idles here are
> single still images. Stages here are single reference images; the engine renders
> stages from 24px parallax tiles, and items are Kenney-keyed. Treat this folder as a
> mood/style reference and a starting point, not as drop-in game assets.

Raw 1024² renders and full-res transparent masters stay gitignored under `assets/gen/`
(`assets/gen/` raw, `assets/gen/cut/` bg-removed masters). Only the downscaled copies
below are committed.

## Contents (26 files)

| Folder | Count | Size | Notes |
|--------|-------|------|-------|
| `stages/` | 4 | 768px, opaque | crumbling-temple, sky-ferry, lava-cavern, wind-canyon |
| `items/` | 6 | 96px, RGBA | bat, bomb, hammer, raygun, spear, sword |
| `portraits/` | 13 | 256px, RGBA | one per roster fighter (character-select style) |
| `idle/` | 3 | 128px, RGBA | single standing pose — link, kirby, donkeykong only |

Transparency was produced by rendering each subject on a flat chroma-key magenta
(`#FF00FF`) background and keying it out (`tools/bg-remove.ts --despill`); stages are
left opaque. Downscale is aspect-preserving (`tools/downscale.ts --max`).

## Regenerating

See `CHECKPOINT.md` for the full pipeline + the GPU/WSL gotchas. Short version: launch
ComfyUI with `--lowvram` (NOT `--disable-smart-memory`) to avoid the `0x116`
VIDEO_TDR_FAILURE BSOD, and invoke the tools via Windows Node interop with
repo-relative paths only:
`node.exe node_modules/tsx/dist/cli.mjs tools/batch-gen.ts assets/gen/<manifest>.json`.
