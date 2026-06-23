# Session CHECKPOINT — art GENERATION run (recovery doc)

## 🎯 SPRITE PIPELINE R&D (2026-06-22, later session)
GOAL (corrected by user): generate ORIGINAL AI sprites + character designs for the
fighters. ALL 13 need rework (the 10 "done" ones are ancient sliced OpenGameArt CC-BY
sheets — to be discarded/replaced); link/kirby/donkeykong have ZERO art (placeholders,
spriteKey:null). Long-term: ~45-55 clips/fighter (see docs/SPRITE-PLAN.md).

QUALITY GATE PASSED: text2img portraits = good character designs. Omni image-reference
holds identity but output is NOISY + speckled bg (unusable). **ControlNet (canny) +
Z-Image is the winner**: clean bold-outline on-style linework + FLAT keyable bg +
identity held. Validated graph in `tools/_spike-cn.ts` (THROWAWAY spike).
- Model: `Z-Image-Turbo-Fun-Controlnet-Union.safetensors` (3.1GB) in shared
  `models/model_patches/`. REQUIRED FIX: `~/ComfyUI/extra_model_paths.yaml` now also
  maps model_patches/controlnet/clip_vision/style_models/background_removal (it only
  mapped checkpoints/diffusion_models/text_encoders/clip/loras/vae before — that's why
  ModelPatchLoader showed empty until fixed + restart).
- Graph: UNETLoader+CLIPLoader(lumina2)+VAELoader + ModelPatchLoader(union) +
  LoadImage(ref in ~/ComfyUI/input/) -> Canny -> ZImageFunControlnet(model,model_patch,
  vae,image=canny,strength~0.6) -> KSampler(model=patched) -> VAEDecode -> SaveImage.
- Nodes available: ZImageFunControlnet, Canny, SetUnionControlNetType,
  SDPoseKeypointExtractor/SDPoseDrawKeypoints (pose path). Clean LOCAL bg-removal is the
  one gap (RemoveBackground has no model; Bria/Recraft are cloud) -> use chroma-key
  (works now bg is flat).
- TODO next: pose-source per frame (canny of pose drafts, or SDPose skeletons) ->
  build gen-clip pipeline (generate frames -> bg-remove -> union-bbox crop + downscale +
  pack horizontal strip + frames.json + register spriteKey) -> nail Link idle (4 frames)
  -> verify in-engine -> scale to all fighters/clips. Spikes: tools/_spike-omni.ts,
  tools/_spike-cn.ts (delete when pipeline lands).



> Updated 2026-06-22 (THIRD session). **CORRECTED ROOT CAUSE.** The last crash was a
> full Windows **BSOD**, not a WSL VM teardown. Event Log bugcheck = `0x116
> VIDEO_TDR_FAILURE` x2 today (10:35, 20:38), param3 `0xc000009a
> STATUS_INSUFFICIENT_RESOURCES`. The real bottleneck is the **GPU**, NOT system RAM:
> RTX 5070 Ti Laptop, **12 GB VRAM**, driver 592.01, hybrid Intel+NVIDIA (Optimus),
> and `TdrDelay` is unset → Windows default **2 s**. The ~19 GB Z-Image model thrashes
> the 12 GB VRAM ceiling, the driver stalls past 2 s, GPU reset fails → BSOD.
>
> ⚠️ The earlier "WSL2 RAM OOM" theory below (and the `.wslconfig memory=24GB` fix) was
> the WRONG LAYER — kept here for history but it does NOT prevent the 0x116 BSOD.
> GPU-targeted fixes required before any relaunch: (a) ComfyUI `--lowvram` to cap VRAM
> peak (we have 24 GB sys RAM headroom to offload into), and (b) optionally raise
> `HKLM\SYSTEM\CurrentControlSet\Control\GraphicsDrivers\TdrDelay` to ~30 s (admin +
> reboot). Until then, do NOT relaunch the batch.

## Why the previous run died (diagnosed, evidence-backed)
WSL2 VM **ran out of memory and the whole VM was torn down** (that's why it dumped
to PowerShell, not just an error). Evidence: WSL uptime had reset; no `.wslconfig`
→ guest capped at ~15.3 GiB (50% of ~31 GB host); Z-Image model footprint is
**~19.3 GB** (z_image_turbo 11.5 + qwen_3_4b text encoder 7.5 + VAE 0.3), GPU only
12 GB so weights offload to system RAM. Crash hit at the render#1→#2 transition:
ComfyUI smart-memory kept #1 resident while loading #2 → >15.3 GB → VM OOM-crash.

## Fixes applied
1. **Durable**: wrote `C:\Users\lombe\.wslconfig` → `memory=24GB, swap=16GB`.
   Takes effect on next `wsl --shutdown` (NOT yet applied — optional speed/safety boost).
2. **Immediate (live)**: ComfyUI relaunched with **`--disable-smart-memory`** so it
   unloads between renders; every render then peaks like render #1 (proven to fit).
   Validated by a 2-render canary (lava-cavern + wind-canyon) — the exact crash case
   — which PASSED (9.4 min, peak ~1.8 GB free, swap untouched). Cost: ~280 s/render
   (reload tax) vs original 134 s.
3. **Node fix**: there is NO Linux node here — project runs on **Windows Node v24**
   via interop (`/mnt/c/Program Files/nodejs/`). Detached shells can't find `node`.
   Invoke tooling as: `node.exe node_modules/tsx/dist/cli.mjs tools/<x>.ts ...` from
   the MAIN repo root (its node_modules is real; the worktree's is a Linux symlink
   Windows interop can't follow).
4. Tooling commit `20b1901` fast-forwarded onto **main** (local only, NOT pushed).

## ✅ RESOLVED 2026-06-22 ~20:50 — full batch DONE, fix validated
- Root cause was GPU TDR (0x116), see corrected diagnosis at top. Relaunched ComfyUI
  with **`--lowvram`** (NOT `--disable-smart-memory`). Result: VRAM held a safe ~10.6 GB
  peak across ALL 24 renders (cleanly cycling 10.6→6.4 GB between renders), **zero
  crashes** on the exact render→render transition that BSOD'd twice. Bonus: after the
  cold first render (90.8 s) the rest ran ~30 s each — faster than the old 134 s, far
  faster than the 280 s smart-memory tax.
- **All 24 raw 1024² PNGs are on disk in `assets/gen/`** (2 stages, 6 items, 13
  portraits, 3 idle). All healthy (400–800 KB; no blank/tiny outputs). ComfyUI still
  up on PID-of-the-day at 127.0.0.1:8188 with `--lowvram`.
- Helper files written (gitignored, in assets/gen/): chunk-1..6.json, manifest-pending.json.

## ✅ POST-PROCESSING DONE 2026-06-22 ~21:05 (bg-remove + downscale) — NOT committed
- bg-remove (chroma-key #FF00FF, --despill) on all 22 transparent assets (6 items,
  13 portraits, 3 idle). Full-res transparent masters in **`assets/gen/cut/`** (gitignored).
- Downscale (aspect-preserving --max): items 96px, portraits 256px, idle 128px,
  stages 768px. 26 game-ready PNGs in **`assets/gen/processed/`** (gitignored, ~1.6 MB):
  22 keyed RGBA + 4 stages (the 2 batch stages + the 2 canary survivors lava-cavern/
  wind-canyon as a bonus). Spot-checked wolf/sword/sky-ferry — on-prompt, clean alpha.
- ⚠️ GOTCHA: Windows `node.exe` resolves a leading-slash path like `/tmp/cut` as
  `C:\tmp\cut` (current drive), NOT WSL `/tmp`. Use REPO-RELATIVE paths for tool
  --in/--out (e.g. `assets/gen/cut/x.png`), never absolute WSL paths.
- **Still NOT done (stopped here per user for review):** move processed/ to a tracked
  home + commit (gitignore currently blocks `assets/gen/*`), commit the
  `comfy-client.ts` 5→15min timeout fix, create `docs/ART-ASSETS.md` (does not exist
  yet despite the older note below). DO NOT push. Worktree cleanup also pending.

## (historical) Relaunched 2026-06-22 ~20:30 after a SECOND VM teardown
- The VM was torn down again mid-batch (uptime had reset to 3 min; `/tmp/fullbatch.log`
  wiped). **Silver lining: the `.wslconfig` 24 GB fix is now ACTIVE** — `system_stats`
  reports ram_total 25.2 GB (was 15.3) + 16 GB swap. So we now have the headroom the
  recovery doc recommended; conditions are strictly better than the canary that passed.
- Pre-flight re-verified: ComfyUI install OK; models present on the Windows-shared path
  (`extra_model_paths.yaml` → `.../Comfy-Desktop/ComfyUI-Shared/models/`): z_image_turbo
  12.3 GB + qwen_3_4b 8.0 GB + ae 0.34 GB. node.exe interop OK. manifest-remaining.json
  still accurate (24 pending; none of its `out` files exist on disk yet).
- Full batch relaunched: `assets/gen/manifest-remaining.json` (2 stages + 6 items +
  13 portraits + 3 idle poses). Log: `/tmp/fullbatch.log`. Batch **PID 1127**
  (`node.exe tsx tools/batch-gen.ts ... --continue-on-error`).
- ComfyUI **PID 1017**, `127.0.0.1:8188`, `--disable-smart-memory`. Log: `/tmp/comfy.log`.
- Raw 1024² PNGs land in gitignored `assets/gen/` (`stage-*`, `item-*`, `portrait-*`,
  `idle-*`). Canary survivors on disk: stage-lava-cavern, stage-wind-canyon (NOT part
  of the 24-batch). Batch progress at relaunch: render 1/24 in flight.

## If the VM crashes again mid-run
Completed renders persist on disk in `assets/gen/`. To resume: relaunch ComfyUI
(`cd ~/ComfyUI && source .venv/bin/activate && python main.py --listen 127.0.0.1
--port 8188 --disable-smart-memory`), rebuild a manifest of the MISSING `assets/gen/*`
files, re-run batch-gen via the `node.exe` invocation above. Consider applying the
`.wslconfig` first (`wsl --shutdown`) for headroom so it can't recur.

## After the batch completes (post-processing — NOT yet done)
1. **bg-remove** (chroma-key magenta #FF00FF) the transparent ones: items, portraits,
   idle poses. Stages stay opaque. `tools/bg-remove.ts`.
2. **downscale** to game-ready sizes (`tools/downscale.ts`): items→engine sizes
   (bomb 40x40, bat 16x48, raygun 70x70; hammer/spear/sword ~48-64px), portraits
   ~256², idle poses ~96-128px, stages ~1280x720 reference.
3. Commit ONLY downscaled assets (raw stays gitignored) + update `docs/ART-ASSETS.md`
   to reflect what was ACTUALLY generated. Keep tsc+vitest+build GREEN — do NOT wire
   into the engine (stages use 24px parallax tiles, items are Kenney-keyed, no portrait
   slot — wiring needs engine changes that break gates; documented, not done).
4. `git add` + commit to main. **DO NOT push** (auto-deploys to Pages) without user OK.
5. Clean worktree: `git worktree remove --force .claude/worktrees/agent-a9fa068ae85a29116`
   + `git branch -D worktree-agent-a9fa068ae85a29116`.

## Anti-sleep keeper
Windows PowerShell loop (SetThreadExecutionState), survived the crash, **PID 11484**.
Keep running. To stop later: Stop-Process 11484 + reset flag to 0x80000000.
