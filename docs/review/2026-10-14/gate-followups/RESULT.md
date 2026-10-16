# Gate follow-ups 1, 2, 4, 5a (2026-10-14)

Done one at a time. The machine was under heavy lock contention (Link agent working
concurrently), so vitest/tsc/build runs took 3 to 40 minutes each.

## 1. CameraController over cameraFraming
- Change: `CameraController` is now a thin Phaser adapter. It builds a `CameraFraming`,
  forwards `setTargets`/`update`/`snap`/`setBounds`/`setViewport`/`setZoomRange`, and applies
  `framing.center`/`framing.zoom` to the Phaser camera (`applyFraming`). Its private
  `computeTargetEnvelope`, `frameRateIndependentLerp`, `clampCenterToBounds` and `clamp` are
  deleted. `CameraBounds`/`CameraViewport`/`CameraTarget` are aliases of the `cameraFraming` types.
  The unused `addTarget()` was removed with its test (no caller in `src/`).
  `CameraFraming` gained `setViewport`, `getTargetCenter`, `getTargetZoom`.
- Files: `src/camera/CameraController.ts`, `src/camera/cameraFraming.ts`,
  `src/camera/CameraController.test.ts` (the `snap()` test now expects the clamped centre via
  `clampCenterToBounds`; the out-of-bounds `snap()` test asserts the exact clamp).
- Verification: `src/camera` all pass (cameraFraming 4, CameraController 31).
  Camera follows in a preview match: see "Camera check" below.

## 2. ModeSelectScene over matchRules
- Change: the scene holds one `MatchRules` (`this.rules`) from `src/scenes/matchRules.ts`;
  its own `state`/`itemFrequency`/`itemSwitch`/`finalRules` fields, the frequency list and the
  Smash Ball/meter toggling are gone. It calls `rulesFromConfig`, `cycleRulesMode`,
  `cycleRulesQuantity`, `cycleItemFrequency`, `toggleFinalMeter`, `toggleItem`, `isItemEnabled`,
  `rulesConfigFields`. Behaviour note: re-entering the scene without a pending config now
  resets to the default rules (it used to keep the previous mode/frequency).
- Files: `src/scenes/ModeSelectScene.ts`, `src/scenes/ModeSelectScene.test.ts` (two source-grep
  assertions renamed to `cycleRulesMode`/`cycleRulesQuantity`).
- Verification: `src/scenes` all pass except `PreloadScene.test.ts > create() invokes the
  progress-bar teardown helper` (the known failure). `matchRules.test.ts` and
  `ModeSelectScene.test.ts` pass.

## 4. Golden digest into the game
- Change: `port/scripts/golden/digest.js` is now `src/match/simDigest.ts` (Phaser-free:
  `canonicalJson`, `fnv1a64`, `buildSimRecord`, `computeSimDigest`; MatchScene builds the
  `SimDigestSource`). `digest.js` is deleted. `MatchScene.getSimDigest()` returns
  `{text, hash}`; `MatchScene.setRecordedInputs(timeline)` makes the sampling loop take every
  slot's input from the recorded `CapturedFrame[]` (resolver, `buildCpuWorld` and the CPU
  wrappers are skipped; missing entries are neutral; `null` restores live input). The id of the
  match's first Matter body is stored at the end of `create()` (`simDigestBaseBodyId`).
  `sim-golden.mjs` calls `getSimDigest()` / `setRecordedInputs()` and no longer injects anything.
  Link goldens and the Final Smash golden (#6) were NOT recorded.
- Deviation from STEP5-DESIGN 5.1 item 1: the digest does NOT reuse `computeReplayChecksum`
  or add a `world` section to `stateChecksum.ts`. That checksum is two 32-bit FNV passes over
  UTF-8; the recorded golden hashes are 64-bit BigInt FNV-1a over both bytes of each UTF-16
  unit, and the gate requires the existing goldens to stay identical. `simDigest.ts` therefore
  keeps the harness hash bit-for-bit and only borrows `STATE_CHECKSUM_HEX_LENGTH` from
  `stateChecksum.ts`. Switching to `computeReplayChecksum` needs all goldens re-recorded.
- Exact digest difference caused by the move (found by the first verify run): with the
  recorded-input path skipping the CPU branch, `finals.cpuBallAttackHeld` (part of
  `captureFinalRuntimeSnapshot`, set by the CPU branch after its wrappers) was missing, which
  diverged every golden at frame 1. Fixed in `setRecordedInputs` mode: a slot that has a CPU
  controller still latches `cpuBallAttackHeld` from the recorded input (one line in MatchScene).
- Files: `src/match/simDigest.ts`, `src/match/simDigest.test.ts`, `src/scenes/MatchScene.ts`,
  `port/scripts/golden/sim-golden.mjs`, `port/scripts/golden/digest.js` (deleted).
- Verification: `src/match/simDigest.test.ts` (5 tests) passes; golden results below.

## 5a. Sprite driver over the art selector
- Change: `createSimulationSpriteAnimationDriver` is now ~25 lines: it builds
  `createArtFrameSelector` over the Phaser `AnimationManager` (`frameCount`) and only does the
  sprite calls (`pause`, `play`, `setCurrentFrame`) for the selected pose. The duplicated
  state-clock/key-resolution code and the unused `getMoveAnimKey`/`getSpriteAnimationKey`
  imports are deleted. `characterAnimationSheets` (+ `CharacterAnimationSheet`) moved from
  `artFrameSelector.ts` to `spriteAnimationDriver.ts` (next to the specs, avoids a second import
  cycle) and `registerCharacterSpriteAnimations` loops over it (one loop instead of two copies).
  Remaining cycle: `simulationSpriteAnimation` <-> `artFrameSelector` (call-time only).
  Behavioural note: `registerCharacterSpriteAnimations` now de-duplicates a sheet key shared by
  the two spec lists (it used to return that key twice).
- Files: `src/characters/simulationSpriteAnimation.ts`, `src/characters/artFrameSelector.ts`,
  `src/characters/spriteAnimationDriver.ts`, `src/characters/artFrameSelector.test.ts` (import).
- Verification: `artFrameSelector.test.ts` (4) and `spriteAnimationDriver*.test.ts` pass.
  `simulationSpriteAnimation.test.ts`: 52 pass, 10 fail. The same 10 fail with a byte-for-byte
  copy of the OLD driver run against the same test file (temporary files, removed), so they are
  not caused by this change. They are Link-fixture tests (`link.hurt.anim` -> `link.idle.anim`,
  LINK_JAB windows) and belong to the concurrent Link work.

## V. Final verification
- tsc: 53 error lines vs 56 in `tsc-baseline.txt` (`tsc-after.txt` here). No new errors. Gone
  (fixed by the Link agent, not by me): `linkFreshNormals.ts`, `linkFreshRecoveryAttacks.ts`,
  `linkRecoveryAttackRuntime.ts`. The `MatchScene.ts TS2339 'action'` error is the same one as in
  the baseline with the union members in another order. A first tsc run aborted with TS6053
  because the other agent deleted a temp test file mid-run; the rerun is clean.
- Build: `vite build` OK twice (9m60s, then 42m52s under contention). Bundles
  `index-BmzijYFS.js` (first build) and `index-p1zRT-JT.js` (with the `cpuBallAttackHeld` fix).
- Goldens (six, plain / warmup 600 / hz 144, `verify-after.raw`):
  - on `index-p1zRT-JT.js`: 15 IDENTICAL (flat-items hz144; lava, moving, wind, crumbling x3;
    ffa-items plain and warmup 600).
  - flat-items plain and warmup 600 were run on the first build `index-BmzijYFS.js` (before the
    `cpuBallAttackHeld` fix) and diverged at frame 1 only in that field. The fix is in p1zRT-JT
    (flat-items hz144 on it is IDENTICAL) but they could not be rerun on it: the shared `dist/`
    was overwritten by another agent's build.
  - ffa-items hz144 ran on that other build (`index-cb3loVO1.js`) and diverged (`verify-after.raw`,
    `verify-after-flat-rerun.raw`): its `finals` no longer contains the Link article fields
    (`linkArrows`, `linkBombs`, `nextLinkArrowId`, ... all `[] -> undefined`) because the Link
    work removed them from `captureFinalRuntimeSnapshot`. Any golden recorded before that change
    diverges on it; this is the Link tree, not the digest move.
  - So 18/18 is NOT demonstrated: 15 IDENTICAL, 3 not verified on a bundle with the fix
    (flat-items x2, ffa-items hz144). Rerun them once the Link work settles.
- Camera check: see below.

## Camera check (`camera-check.mjs`, `camera-a.png`, `camera-b.png`, `camera-check.json`)
Flat-items CPU match on the preview build, sim stepped 30 then 150 frames:
- frame 30: camera centre (806.7, 745.8) zoom 1.291, fighters' centroid (744.9, 777.6)
- frame 150: camera centre (699.2, 750.5) zoom 1.366, fighters' centroid (706.1, 776.0)
The camera moved with the fighters (x 807 -> 699 as the centroid moved 745 -> 706) and zoomed in
as they came closer. No page errors. Run on whichever bundle `dist/` held at that time (the
shared dist was rebuilt by another agent), which includes the new CameraController.
