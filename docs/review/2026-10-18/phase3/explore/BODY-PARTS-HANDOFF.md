# Body-parts research: handoff prompt

Paste the text below to the AI taking over. It works in this repository on its own branch.

---

You are taking over a research track in a 2D platform fighter (repo
`~/Workspace/platform-fighter`, TypeScript, Three.js game, Node 22). Goal: **show fighters
with motion close to the original Super Smash Bros. Ultimate animations (Ultimate Frame Data,
"UFD"), built from multiple body parts, using much less GPU memory than full drawings, without
reducing how many distinct poses the player sees.** The method is up to you: cutout parts on
bones, part swaps per angle, mesh deformation, parts rendered from the 3D model, hybrids with
correction drawings, anything that works.

## What "good" means

- **Motion:** judged by the user against the Ultimate move at match size. Today's drawings are
  test material, not the quality ceiling. The user rejected the first rig attempt as "less
  natural": it looked like a puppet (rigid flat limbs, visible joints), had no foreshortening
  (a fist punching towards the camera can't shorten), got the twisting wind-up wrong (one rigid
  torso), and the tie flipped up. Solve those, don't repeat them.
- **No fewer poses:** do not save memory by dropping or holding drawings. At least as many
  distinct poses per second as today; ideally a new pose every tick (60 per second).
- **Memory:** compare with the decided full-drawing baseline at one byte per pixel (match-size
  drawings, 256-colour palette, held drawings): DK 82.5 MiB, Link 30.9, Pikachu 18.8. Today's
  DK jab is 444 KiB for 7 drawings. Count everything resident on the GPU (parts pages, meshes,
  correction drawings), with `character/package/memory.ts`, extended rather than duplicated if
  needed.
- **Style:** clean 2D cartoon, Brawlhalla-like, crisp outlines (`docs/ART-STYLE.md`). Costumes
  must still recolour (`character/render/recolor.ts`).

## Start here (read in this order)

1. `CLAUDE.md`: project rules, commands, testing. Coding rules: no duplicated code (extract and
   share), simple and modular.
2. `docs/CHARACTER-SYSTEM-ROADMAP.md` (2D rig/hybrid notes around "Choose the visual backend")
   and `docs/CHARACTER-LAB-PLAN.md`: the character package format and the lab.
3. `docs/review/2026-10-18/phase3/README.md`: every option measured so far, and the decision.
4. The body-parts records, with images:
   - `docs/review/2026-10-18/phase3/explore/skeleton/README.md`: first rig from parts cut out
     of today's drawings (why cutting fails, memory model, PyTorch pose fitter in `prototype/`).
   - `docs/review/2026-10-18/phase3/explore/parts-generation/README.md`: **the approach that
     worked for making parts**. Each part of the native DK 3D model is rendered alone (hidden
     areas come for free), then repainted in our style with ComfyUI img2img (denoise 0.65).
     Scripts in `scripts/` (`native_parts.py`, `shape_parts.py`, `gen.py`, `post_parts.py`,
     `ik.py`). Limits found: one view only, no foreshortening, mesh creases.
   - `docs/review/2026-10-18/phase3/explore/rig/README.md`: the rig in the format, evaluator and
     lab, DK jab fitted to Ultimate and an invented idle.
5. The parked code: branch **`explore/skeleton-rig`** (commit `d5d4376`). It holds an optional
   `rig` in `character/package/types.ts` and `validate.ts`, `character/evaluator/rig.ts`, lab
   drawing and a Skeleton overlay (`character/lab/`), `character/candidates/rigCandidate.ts` +
   `rigParts.ts` (`npm run character:rig`), and `tools/rig-pose-fit.py`. Start your branch from
   it; don't merge into `rework/gameplay`.

## Data and tools

- Character packages: `npm run character:export` writes today's fighters to
  `.tmp/character-packages/<id>/` (`character.json` + `pages/*.png`). The lab serves every folder
  there: `npm run lab` → http://localhost:5180, e.g.
  `?package=donkeykong~rig&action=jab&compare=donkeykong`.
- Generated DK parts: `.tmp/rig/donkeykong-parts/` (`parts.json`, 19 PNGs). Git-ignored.
- Native DK 3D model and renders: `assets/gen/dk-native-reference/` (git-ignored), used by
  `tools/dk-material-guide.py`. Other fighters: look for their native references under
  `assets/gen/`.
- Ultimate recordings: `character/lab/references.json` maps actions to UFD recordings in
  `assets/gen/` (git-ignored; never publish or copy them out of the repo). UFD frame N = tick N.
  Idle, run, turn, held item, grabbed and Final references are still missing. UFD and SmashWiki
  are the source of truth for motion.
- Image generation: local ComfyUI at `~/ComfyUI` (venv `~/ComfyUI/.venv/bin/python`), 8 GB GPU,
  int8/fp8 models via `PF_COMFY_UNET` / `PF_COMFY_CLIP` (runbook `docs/ART-PIPELINE.md`, pose
  guides from UFD in §2b with `tools/ufd-pose-canny.py`).
- Character creation workflow: `.agents/skills/add-character/SKILL.md` and its references.

## Rules

- Don't change game code (`src/`, `port/`). Keep `character/` free of game imports
  (`character/boundaries.test.ts`).
- Run GPU or heavy jobs under `flock .tmp/dk-heavy.lock <cmd>`, one at a time; CPU work may use
  all 20 cores.
- Never delete through symlinks; never touch `assets/` originals.
- Checks before claiming progress: `npm run typecheck`, `npx vitest run character`,
  `npm run lab:build`.
- Write your record in `docs/review/<date>/body-parts/README.md`: plain short sentences,
  numbers in tables, comparison strips at match size (drawing scale 0.467 × camera zoom 1.4;
  Final Smash zoom 2.8) of Ultimate, today's drawing and yours.
- The user reviews on a phone: give them something that **plays the motion** (an animated page
  or a short video), not only still images.

## Suggested first milestone

DK jab, forward smash and idle, built from parts, playing in the lab beside Ultimate and today's
art, every tick a distinct pose, with the measured GPU memory, and an honest list of what still
looks less natural than the drawings.
