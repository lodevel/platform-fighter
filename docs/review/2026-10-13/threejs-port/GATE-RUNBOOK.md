# Gate runbook: merging the port's pending work into `src/`

The gate opens when the other agent working in `src/` (Link, Final Smash,
items phases 9–10) has finished and the user says so. Until then nothing here
runs against the real tree. Work in order; each step says how it is verified.

## 0. Baseline (before any change)

1. Rebuild the game (`npm run build`) and serve it (`npm run preview`, or the
   port-4199 server pointed at the new `dist/`).
2. Re-record the six goldens on that build, then verify each against itself
   (`port/scripts/golden/sim-golden.mjs record all`, then `verify` with plain,
   `--warmup 600` and `--hz 144`). They must be 18/18 `IDENTICAL` before the
   goldens can judge anything (step5/README.md "goldens are bound to their build").
3. Record the baseline: `npm run typecheck` error count, `npx vitest run` failures.
   Failures already present on 2026-10-13 that the merge does not cause:
   - `src/scenes/PreloadScene.test.ts`, "create() invokes the progress-bar
     teardown helper".
   - `src/camera/CameraController.test.ts`, "snap() removes any smoothing
     residual". The test predates the bounds clamp in `snap()`: 400 is clamped
     to 510 on purpose. Fix the test in step 3 below.
   - The roster-mask failures recorded in `roster-mask.md` (STEP4-INVENTORY.md
     open question 3).

## 1. Rehearse the merge

```bash
flock .tmp/dk-heavy.lock bash port/scripts/gate-trial.sh <scratchpad>/gate-trial
```

It copies `src/` and `port/` to the scratch dir and applies the merge there. It
then compares root `tsc` errors and the stage, scene and entity tests before
and after, and runs the port checks and a port build.

Rehearsal of 2026-10-13 (tree as of 17:30):
- root tsc errors 58 → 58, identical list;
- tests: before, 1 failure (PreloadScene); after, 2 failures (PreloadScene plus
  the CameraController failure above, from the extra `src/camera` folder);
  the four moved suites (18 tests) pass;
- the CRLF of `stageDefinitions.ts` is kept (1602/1602);
- `port/src/pending/` is gone, the port typecheck and layer check pass, and the
  port builds.

If an anchor no longer matches (the other agent edited that spot), the script
stops before writing anything and names the anchor. Update that edit in
`port/scripts/gate-merge.mjs` and rehearse again.

## 2. Apply the merge

```bash
cd port && node scripts/gate-merge.mjs          # dry run, read the list
node scripts/gate-merge.mjs --apply
```

What it does (35 files written, 14 deleted as of 2026-10-13):
- **Moves** `pending/` to `src/`: `scenes/matchRules`,
  `entities/GazeHazard`, `physics/{PhysicsWorld,matterPhysicsWorld,matterFork.d}`,
  `camera/cameraFraming` and `sim/{view,hudView}`. Each `*.check.ts` becomes
  `*.test.ts` next to its module. Imports are rewritten on both sides.
- **Adds the Inferno to the game:**
  - `'gaze'` joins `HazardType`, and `StageHazard.gaze?` carries the timeline;
  - `createGazeHazardFromStageHazard` is added;
  - `INFERNO_STAGE` is inlined into `stageDefinitions.ts` with a stage-wide
    `gaze` hazard and registered in `STAGES`, the `stages` barrel and
    `BUILT_IN_STAGE_ENTRIES`;
  - a Phaser fallback theme `inferno` (the lava cave's layers under a darker
    sky);
  - the pinned-count tests go from five to six.
- **Updates the port:** it reads `STAGES`, `getStage` and
  `BUILT_IN_STAGE_ENTRIES` from the game, and builds the gaze hazard from the
  layout. The `pending` layer is removed from `check-layers.mjs` and
  `ARCHITECTURE.md`.
- **Gate notes:** each "MERGE AT THE GATE" note in a moved file is rewritten to
  its post-gate wording. The script refuses to finish if any note survives.

Verify:
- `npm run typecheck`: same error count as the baseline.
- `npx vitest run`: no new failures.
- `cd port && npm run typecheck && npx vite build`.
- The golden `verify` on a rebuilt game is still `IDENTICAL` for all six
  scenarios. The merge adds a stage but must not change the simulation of
  existing ones.

## 3. Manual follow-ups (judgment, one change each)

1. **CameraController over cameraFraming** (no-duplication rule). **DONE 2026-10-14**, see `docs/review/2026-10-14/gate-followups/RESULT.md`.
   - Make `src/camera/CameraController.ts` a thin Phaser adapter: it builds a
     `CameraFraming`, forwards `setTargets`/`update`/`snap`/`setBounds`/
     `setZoomRange`, and applies `center`/`zoom` to the Phaser camera.
   - Delete its private copies of `computeTargetEnvelope`,
     `frameRateIndependentLerp` and `clampCenterToBounds`.
   - Fix the stale `snap()` test to expect the clamped centre.
   - Verify: `src/camera` tests, and a preview match in which the camera still
     follows.
2. **ModeSelectScene over matchRules** (no-duplication rule). **DONE 2026-10-14**, see `docs/review/2026-10-14/gate-followups/RESULT.md`.
   - The Phaser scene keeps its own rule rows (item frequency, Item Switch,
     Final Smash). Make it read them from `src/scenes/matchRules.ts`.
   - Verify: `src/scenes` tests, and the mode-select rules in the preview.
3. **The Inferno in the Phaser game.**
   - The Phaser match ignores the `'gaze'` hazard: only lava and wind are
     filtered in (`BaseStage.ts:786/794`). The stage plays as a hazard-free
     Battlefield with a volcanic backdrop.
   - That is deliberate: Phaser has no head visual, and an invisible lethal
     flash would be unfair.
   - The head becomes live in step 6, when MatchSim owns the hazards and the
     3D view draws them. It ticks per step, KOs through the lava-KO path, and
     is included in the snapshot through `toState`/`fromState`.
   - Verify: a preview match on the Inferno plays normally.
4. **Golden digest into the game** (STEP5-DESIGN §5.1 items 1–2). **DONE 2026-10-14** except recording the Final Smash golden (#6) and the Link goldens; see `docs/review/2026-10-14/gate-followups/RESULT.md`.
   - Move `port/scripts/golden/digest.js` into `src/match/simDigest.ts`
     (extending `stateChecksum.ts`).
   - Add `MatchScene.getSimDigest()` and `setRecordedInputs()`.
   - Record the Final Smash golden (#6) and the Link scenarios.
5a. **Sprite driver over the art selector** (no-duplication rule). **DONE 2026-10-14**, see `docs/review/2026-10-14/gate-followups/RESULT.md`.
   - `createSimulationSpriteAnimationDriver` keeps only its sprite calls
     over `createArtFrameSelector`.
   - `registerCharacterSpriteAnimations` loops over `characterAnimationSheets`.
   - Verify: `src/characters/simulationSpriteAnimation.test.ts` and
     `artFrameSelector.test.ts`.
5. **Step 4: remove the unused fighters.** Follow `STEP4-INVENTORY.md`.
   - Its open questions go to the user first.
   - Its hard ordering points:
     - inline `WOLF_GRAB` into `Pikachu.ts` before Wolf goes;
     - narrow `CharacterId` and all `Record<CharacterId,…>` maps in one change;
     - add `link` to `ACTIVE_FIGHTER_IDS`.
6. **Step 5 sub-steps 5.2 onward** (STEP5-DESIGN.md).
   - Each one is verified by the goldens: retype to `PhysicsWorld`, swap in
     `createMatterPhysicsWorld`, extract MatchSim, then SimView.
   - 5.3 is already rehearsed (`step5/REHEARSAL-5.3.md`): a facade assigned
     to `this.matter` at the top of `MatchScene.create()` gives 6/6
     `IDENTICAL`, and a control diverges at frame 1. Land it that way, then
     rerun the rehearsal on the settled tree.
