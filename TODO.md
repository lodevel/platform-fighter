# Handoff / TODO

Working handoff so a new instance (or returning dev) can pick up. Last updated
this session. The game is a Super Smash Bros mechanical clone (Phaser 3 +
Matter.js + TS), deterministic 60 Hz fixed-step sim.

## Conventions (read first)
- **Commit → push immediately.** Pushing to `main` auto-deploys to GitHub Pages
  via `.github/workflows/deploy.yml` (builds `dist/`, which is NOT committed).
- **Verification ritual before done:** `npx tsc --noEmit && npx vitest run && npm run build`.
- **Determinism:** no `Math.random` / `Date.now` / `new Date` in sim paths
  (the workflow validator + replay determinism reject them).
- End commit messages with the `Co-Authored-By: Claude Opus 4.8 (1M context)` trailer.

## Shipped this session (on `main`)
- `48a48ea` — ledge-grab made **facing-agnostic** by default (was rejecting normal recovery).
- `e8661f5` — **smooth ledge climb-up / roll-up** (was a freeze-then-teleport). Pure smoothstep interp; `ledgeRecoverySmoothstep` + `computeLedgeStandingTarget` in `ledgeHangState.ts`.
- `ffb4dec` — **`add-character` skill + `docs/CHARACTER-CHECKLIST.md` + verifier** (`.claude/skills/add-character/`).

## ComfyUI model install — ✅ DONE / READY
**Status: ✅ COMPLETE** (finished this session). The interrupted Z-Image-Turbo
download was resumed and all 4 model files are downloaded + validated
(safetensors header-end == file size), in
`…/AppData/Local/Comfy-Desktop/ComfyUI-Shared/models/`:
- diffusion `diffusion_models/z_image_turbo_bf16.safetensors` — **12.31 GB** ✓
- text encoder `text_encoders/qwen_3_4b.safetensors` — **8.04 GB** ✓
- VAE `vae/ae.safetensors` — **0.34 GB** ✓
- pixel LoRA `loras/pixel_art_style_z_image_turbo.safetensors` — **0.17 GB** ✓ (trigger: `Pixel art style.`)

**Generation engine:** the Windows Comfy *Desktop* app is flaky (server wouldn't
stay up), so a **native ComfyUI is installed in WSL at `~/ComfyUI`** (venv +
torch 2.12+cu130, GPU verified RTX 5070 Ti) — I drive it directly (server on WSL
`127.0.0.1:8188`), with `~/ComfyUI/extra_model_paths.yaml` pointing at the Windows
`ComfyUI-Shared/models` (reuses the downloaded models, no re-download). Next:
launch server → build `tools/gen-*.ts` client → test render → batch.

**🎨 ART STYLE LOCKED → Brawlhalla-style clean 2D cartoon** (heroic athletic
proportions, vibrant saturated). **NOT pixel art** → the pixel LoRA is set aside;
use Z-Image base + cartoon prompting. Full recipe + canonical prompts in
**`docs/ART-STYLE.md`**; the ~50-clip per-fighter animation list + the
grab-interaction (grab-anchor) model in **`docs/SPRITE-PLAN.md`**. Asset order:
stage backgrounds → item sprites → character portraits → animation clips.

## ✅ SHIPPED 2026-06-22 (4-stream parallel session — all merged to `main`)
Built via 4 parallel sub-agents in isolated worktrees, merged sequentially; full
ritual green on combined `main` (`tsc` ✓, `vitest` ✓, `npm run build` ✓).
- **Roster 10 → 13:** added **Link** (projectile-swordsman zoner: bow/boomerang/hookshot-tether/bomb-trap), **Kirby** (inhale commandGrab/hammer dashStrike/final-cutter multiHitRising/stone stallAndFall; 4 jumps, mass 7 — one notch below Puff on every float axis, a hard cross-cast invariant), **Donkey Kong** (giant-punch charge/shoulder dashStrike/spinning-kong multiHitRising/groundPound). Procedural art (`spriteKey:null`). `perFighterSmoke` refreshed to full 13.
- **Ledge Smash-parity fixes** in `ledgeHangState.ts`: climb startup i-frames (`getupIframes 0→12`), regrab intangibility depletion (`ledgeGrabsSinceGround`: full→16→8→0), 2-frame ledge-grab punish window (`grabVulnerableFrames:2`). + `docs/SMASH-PARITY-GAPS.md` (37 code-verified gaps / 9 domains).
- **Art pipeline tooling** (`tools/comfy-style.ts`, `comfy-client.ts`, `gen-sprite.ts`, `tools/tsconfig.json`, `docs/ART-PIPELINE.md`): WSL ComfyUI + Z-Image round-trip **proven** with a test render (`assets/gen/test-stage.png`). NOTE: `tools/` is NOT in the root `tsc`/build include — type-check with `npx tsc --noEmit -p tools/tsconfig.json`.
- **Cat/Owl/Bear uair+dair:** premise was STALE — they already exist in `extendedMoves.ts` (no change). The CHARACTER-CHECKLIST "missing uair+dair" note is outdated.

### Remaining follow-ups from this session
- **Generate real game art** (pipeline proven but no game sprites generated yet): batch in `SPRITE-PLAN.md` order — stage backgrounds → items → portraits → ~50 anim clips/fighter. Build the batch driver + bg-removal + slicing + manifest wiring (TODO in `docs/ART-PIPELINE.md`).
- **owl/bear `frames.json`** still missing (only placeholder source sheets) — generate real source sheets + frames.json once art lands. Do NOT fabricate (breaks loading).
- New fighters use procedural rectangles until the art pipeline produces their sheets.

## NEXT UP (priority order)
> ⚠️ Items 1 & 2 below are DONE (see SHIPPED above). Item 3 = tooling DONE, art-gen batch remains. Item 4 = uair/dair already existed; owl/bear frames.json remains.

### 1. Build 3 new fighters — Link, Kirby, Donkey Kong (user-approved)
Use `.claude/skills/add-character/SKILL.md` + run `bash .claude/skills/add-character/verify-character.sh <id>`.
Template fighters: **Nova.ts** (projectiles/charge/multihit/trap) or **Bruno.ts** (all-rounder).
Procedural art for now (`placeholder.spriteKey: null` → flat rectangle) until the art pipeline lands.
Suggested kits (each distinct from the existing 10):
- **Link** — projectile-swordsman zoner: neutral `projectile` (arrow/bomb), side `multiHit` or `commandDash` (boomerang feel), up `tether` or `directionalJump` (spin/grapple), down `trap` (bomb).
- **Kirby** — multi-jump puffball: neutral `commandGrab` (inhale), up `multiHitRising` (final cutter), down `stallAndFall` (stone), high `maxJumps` (5), low fall accel.
- **Donkey Kong** — mobile heavyweight: neutral `charge` (giant punch), side `dashStrike`, up `multiHitRising` (spinning kong), down `groundPound`. Heavier than Bear is the "immovable wall"; DK is the mobile bruiser.
Don't forget: roster-cardinality tests break on the 11th fighter (fighterRegistry/characterSpec/palettes/anim-driver `*.test.ts`) — append the new id. Verifier + `tsc` catch the rest.

### 2. Write `docs/SMASH-PARITY-GAPS.md` (from the 137-gap audit)
A deep multi-agent audit found **137 confirmed Smash-fidelity gaps** (rejected 34). The full
output was ephemeral (session `/tmp`), so **re-run the workflow** if the report is gone — it
was named `smash-gap-deep-audit` (find→adversarially-verify→synthesize over ~20 domains).
Headline confirmed gaps to act on:
- **Ledge get-up climb has 0 i-frames** (`getupIframes: 0`) — Smash gives climb startup intangibility. Trivial fix (it counts down from release → protects the start). See `ledgeHangState.ts` `LEDGE_HANG_DEFAULTS`.
- **Ledge intangibility doesn't deplete on repeated regrabs** (refresh-only-on-landing missing) — enables infinite ledge-stall. Needs a per-fighter `ledgeGrabsSinceGround` counter reset on landing.
- **No 2-frame punish window** — grab grants i-frames from frame 0.
- Plus DI/SDI magnitudes, shield/OoS detail, staling/rage, hitlag, etc. (re-run audit for the full ranked list).

### 3. Art / sprite pipeline (the "feels unfinished" problem)
See `docs/CHARACTER-CHECKLIST.md` "Biggest gaps": every move shares ONE `attack.png`
(jab=tilt=smash=special visually), no per-fighter voice, specials unvoiced, no portraits/stock
icons, **Cat/Owl/Bear missing uair+dair**.
- Tooling decided: **ComfyUI Desktop** (user installing) with **Z-Image-Turbo** base + official
  **`pixel_art_style_z_image_turbo.safetensors`** LoRA (HF `tarn59`, → `models/loras/`) +
  **ComfyUI-PixelArt-Detector** node (Manager) for downscale/palette-lock. SDXL pixel checkpoints
  (Pixel Art Diffusion XL "Sprite Shaper") are the fallback.
- **Network:** WSL is NAT mode; Windows host = `172.21.208.1`. To drive Comfy's API from WSL,
  Comfy must listen on `0.0.0.0` + Windows firewall allow → hit `http://172.21.208.1:<port>/`.
  Fallback with zero networking: filesystem handoff (Comfy writes to its output dir, readable via
  `/mnt/c/...`; I author the workflow JSON, user clicks Queue).
- Build `tools/gen-sprite.ts` (POST `/prompt` → poll `/history` → fetch PNG → bg-remove → slice → manifest).
- Suggested order by payoff/effort: **stage backgrounds → item sprites → char portraits → platforms → full char animation sheets**.
- Lock ONE art style early; palette-lock (PixelArt-Detector) ties into the 8-palette swap system.
- `gpt-image-1` (OpenAI API key) is an alt path; ChatGPT *web/Plus* auth is NOT API-usable.

### 4. Misc fidelity follow-ups
- Cat/Owl/Bear: author `uair`/`dair` (only structural moveset gaps in the cast).
- `perFighterSmoke.test.ts` FIGHTERS list is stale (stops at aegis — missing volt/nova/bruno).
- Owl `attack.png` is 1 frame (degenerate); `frames.json` missing on owl/bear.

## Key files / docs
- `docs/CHARACTER-CHECKLIST.md` — anatomy of a complete fighter (REQUIRED/ART/POLISH tiers).
- `.claude/skills/add-character/` — skill playbook + `verify-character.sh`.
- `docs/SMASH-PARITY-PLAN.md` — earlier system-level parity plan.
- Existing 10 fighters: Aegis(Marth), Bear(heavy grappler), Blaze(Falcon), Bruno(Mario),
  Cat(ninja), Nova(Samus), Owl(mage), Puff(Jigglypuff), Volt(Pikachu), Wolf(space-animal).
