# Phase 6: gameplay data out of `frames.json`

Part of the [Phase 6 plan](PLAN.md) (preparation for step 5). Date: 2026-10-19. Baseline: `9fa28f3`.
Field sources: the [frames.json inventory](../../2026-10-18/character-lab/frames-json-inventory.md).

## Result

- The simulation's per-fighter data now lives in `assets/characters/<id>/gameplay.json` (DK, Link, Pikachu).
- `frames.json` keeps only the legacy sheets: image layout, registration, Final FX banks and art provenance.
- Deleting `frames.json` in step 5 removes no value the simulation reads.
- Values are unchanged. Every moved field is byte-identical to the baseline (test below).
- No reader output changed (sweep below). Full suite green.
- `tools/split-gameplay-data.py` made the split. It is idempotent and kept for re-runs (see Risks).

| File | Before | `frames.json` after | `gameplay.json` |
| --- | --- | --- | --- |
| DK | 6.19 MB | 0.66 MB | 5.54 MB |
| Link | 0.86 MB | 0.28 MB | 0.58 MB |
| Pikachu | 3.07 MB | 0.47 MB | 2.60 MB |

## Inventory: runtime importers before the split

| Importer | Fields read | Class | Reads now |
| --- | --- | --- | --- |
| `src/assets/manifest.ts` | `strip`, `frameWidth/Height`, `atlas`, `trims`, `frameCount`; final-visual `pages` | display | `legacySheets()` |
| `src/characters/spriteAnimationDriver.ts` | clip names (texture keys, anim list) | display | `legacySheet()` |
| `src/characters/donkeykongBodyProfile.ts`, `linkPackedBodyProfile.ts` | whole `animations` → `PackedBodyProfile.clips` | gameplay | `gameplay.json` |
| `src/characters/packedBodyPresentation.ts` (through the profiles) | clock: `frameCount`, `frameWindows`, `loopDuration`, `nativeSampleIndices`, `actionFrameStarts`, `pairedActionTimeline`. Geometry: `hurtboxPoses` (+`headContact`), `attackCollisionPoses`, `catchCollisionPoses`, `sourceRootDelta`. Clip existence (aliases) | gameplay | `gameplay.json` |
| same, `getPackedBodyRenderMetrics` | `root`, `frameWidth/Height`, `scaleToWorld` (display); `bodyCentreFromRootY` (gameplay) | mixed | `legacySheet()` + gameplay clip |
| `src/characters/donkeykongCompleteGrab.ts` (clip passed in) | `pairedGrabTimeline`, `frameCount`, `frameWindows`, `hurtboxPoses`, `catchCollisionPoses`, `bodyCentreFromRootY`, `loopDuration`. It also validated `root`, `frameWidth/Height`, `scaleToWorld` | gameplay | gameplay clip; image checks dropped (no clip has `pairedGrabTimeline`, so unreachable with today's data) |
| `src/characters/donkeykongPairedProtectionClock.ts` | `pairedActionTimeline`, `frameWindows`, `hurtboxPoses`, `attackCollisionPoses` | gameplay | `gameplay.json` |
| `Character.ts` capture grip (via `selectPackedDrawing().clip`) | `captureGripPoses` | gameplay | `gameplay.json` |
| `src/characterPresentation/legacy/heldItemPoseData.ts` | `frameCount`, `itemAttachmentPoses`; `item-axes.json` | gameplay (hit areas `Character.ts:~6762`, muzzle `:~6834`; also drawn) | `gameplay.json`, `item-axes.json` |
| `src/characterPresentation/legacy/finalPoseData.ts` | `coordinateOrigin`, `sourceSampleBasis`, `frameCount`, `sourceDrawingCount`, clock fields, `hurtboxPoses`, `attackCollisionPoses(ByRole)`, `sourceAttachmentPoses`, `sourceRootDelta`, `bodyCentreFromRootY` | gameplay | `gameplay.json` |
| same | `root`, `frameWidth/Height`, `scaleToWorld`, `sourceEffectPointPoses`, `sourceRenderPoses` | display (origin, scale, FX anchors) | `legacySheet()` |
| `src/finalSmash/finalVictimBodyPose.ts` | top-level `runtimeFinalVictimProfiles` | gameplay (victim receiving, capture anchor) | `gameplay.json` |
| `src/finalSmash/registeredFinalFx.ts` | top-level `runtimeFinalFxProfiles`; `frameWidth/Height/Count` of its pages | display | `frames.json` via `LEGACY_FINAL_FX_BANKS`, `legacySheets()` |
| `src/characters/pikachuPresentation.ts` `getPikachuReviewedStateClock` | `frameWindows`, `loopDuration`, `frameCount` | gameplay | `gameplay.json` |
| same, `getPikachuSheetRenderMetrics` | `root`, `scaleToWorld`, `frameWidth/Height` | display | `legacySheet()` |
| `src/characters/pikachuCaptureBodyClearance.ts` (through the metrics above) | `root[1]`, `scaleToWorld` of `captured`/`captured_hit` | gameplay derived from the strip | registration kept in the review constant beside its alpha rows; a test pins it to the sheet |
| `src/characters/pikachuRecoveryAttacks.ts` | `frameCount` | gameplay | `gameplay.json` |
| `src/characters/simulationSpriteAnimation.ts` | Pikachu `frameWindows`, `frameCount`, `loopDuration`; final-visual clip names | gameplay; display | `gameplay.json`; `final-visual-frames.json` unchanged |
| `src/characters/actionDisplay.ts` | Pikachu `frameWindows`; packed `frameHeight` | gameplay; display | `gameplay.json`; `legacySheet()` |
| `port/src/fighters/poses.ts` | `frameWidth/Height` through the profile clips | display | `legacySheet()` |
| `port/src/fighters/finalVisual.ts` | `final-visual-frames.json` | display | unchanged |
| `src/sim/buildSimView.ts` | Link article `frameCount` through the profile | display | gameplay clip (`frameCount` lives there) |

Comment-only mentions were updated (`handAnchors.ts`, `captureAttachmentDefaultData.ts`, `HomeRunBat.ts`). `linkArticles.ts` still names `frames.json` for the Link article sheets, which are display.

Not runtime:
- `scripts/character-package/legacyClips.ts` and `exportLegacy.ts` (temporary exporter): timing from `gameplay.json`, layout from `legacySheets()`. `gameplay.json` added to the source hashes.
- `tools/character-memory-audit.ts`: now reads `legacySheets()`.
- About 90 other `tools/` files mention `frames.json`. 55 of them name gameplay fields. They are one-off pipeline and audit scripts. None of the maintained probes reads `frames.json`. `tools/encode-compressed-sheets.py` (Pages deploy) reads only `strip`.
- Tests: 17 files moved to `gameplay.json`, `legacySheet()` or both. The mocks now mock the file they stand in for.

## New layout

`assets/characters/<id>/gameplay.json`:

```
{ "schema": "fighter-gameplay/1", "fighter": "<id>", "note": "...",
  "animations": { "<clip>": { <gameplay fields> } },        // same clip names and order as frames.json
  "runtimeFinalVictimProfiles": { ... } }                    // DK, Link, Pikachu (unchanged bank)
```

Per-clip gameplay fields:

| Group | Fields |
| --- | --- |
| Pose track | `frameCount` (pose count), `nativeSampleIndices`, `actionFrameStarts`, `loopDuration`, `frameWindows`, `pairedActionTimeline`, `sourceSampleBasis`, `coordinateOrigin`, `sourceDrawingCount` |
| Geometry paired with each pose | `bodyCentreFromRootY`, `hurtboxPoses` (+`headContact`), `attackCollisionPoses`, `attackCollisionPosesByRole`, `catchCollisionPoses`, `captureGripPoses`, `itemAttachmentPoses`, `sourceAttachmentPoses`, `sourceRootDelta` |
| Provenance of the above | `receivingProvenance`, `collisionProvenance`, `itemAttachmentProvenance`, `sourceProvenance`, `sourceGeometryAdapters`, `sourceCatchReceipt(Sha256)`, `staticReceivingAcceptance{Receipt,Sha256}`, `captureClockCalibration`, `bodyReviewKey`, `runtimeClock`, Pikachu `nativeWindows`, `holdRule`, `specialPhase`, `specialClockKind`, `dynamicCutoff`, `playableEndExclusive`, `runtimeBindingStatus`, `drawingFacingBinding` |

**Keys.** Clips are keyed by motion or state name (`jab`, `grab_pull`, `final`; Link: native motion names such as `b00guard`). Within a clip, rows are keyed by `artFrameIndex` (plus `nativeSample`). The simulation keys on that index today. The pose clocks map action age to an index, and receiving, catch, grip and Final rows are looked up by it. Re-keying by age would change values and behaviour, so the index is kept. It is now a **pose index**: pose *i* of a clip's track. The legacy sheet draws pose *i* in cell *i*. `legacyFighterSheets.ts` is the only place that joins the two. Exceptions keyed by gameplay concepts already:
- `runtimeFinalVictimProfiles`: keyed by profile and authored age.
- `item-axes.json` `frames`: indexed by action age.

**Other files.**
- `item-axes.json` is gameplay and stays as it is: it sets the held-item axis used for muzzles.
- `final-visual-frames.json` is display: Pikachu's Final display bank.

**Display entry point.** `src/assets/legacyFighterSheets.ts` provides:
- `legacySheet(fighter, clip)` and `legacySheets(fighter)`: a clip's `frames.json` fields plus `frameCount` from `gameplay.json`;
- `LEGACY_FINAL_FX_BANKS`.

Every display reader of `frames.json` goes through it.

## What remains in `frames.json` (display only)

- Top level: `meta`, `animations`, `runtimeFinalFxProfiles` (DK, Pikachu) and `articles` (Link).
- Per clip: `strip`, `sha256`, `frameWidth`, `frameHeight`, `atlas`, `trims`, `columns`, `rows`, `root`, `scaleToWorld`, `sourceEffectPointPoses`, `sourceRenderPoses`.
- Art provenance: `artProvenance`, `artStatus`, `sourceTargetImage(Sha256)`, `floorRegistrationProvenance`, `postPackPoseTranslations`, `packingMetadata(Sha256)`, `atlasRepack`, `coordinateAdapter`.

## What step 5 deletes

**Data:**
- `assets/characters/<id>/frames.json` and the `animations/*.png` sheets;
- `pikachu/final-visual-frames.json` and its pages;
- `compressed/` banks and their CI step;
- the `char.*` manifest entries.

**Code:**
- `src/assets/legacyFighterSheets.ts`, and its callers' display halves:
  - `spriteAnimationDriver` texture keys and anim list;
  - `getPackedBodyRenderMetrics`;
  - `getPikachuSheetRenderMetrics`;
  - `actionDisplay` layer metrics;
  - `port/src/fighters/poses.ts`;
  - the `originX`, `originY`, `scaleToWorld`, `effectPoints` and render-page parts of `sampleFinalBodyPose`;
  - `registeredFinalFx` (the package now draws the effects).
- The exporter: `scripts/character-package/`, `tools/character-memory-audit.ts`.

**Kept:**
- `gameplay.json` and `item-axes.json`;
- the pose clocks in `packedBodyPresentation`, `pikachuPresentation` (state clock), `simulationSpriteAnimation` and `heldItemPoseData`, which the simulation drives.

**Watch in step 5:**
- `MatchSim` imports `FINAL_FX_CUES` from `registeredFinalFx.ts`. When that module goes, move the cue facts with it or next to the Final FX clock.
- `simulationSpriteAnimation` checks `final-visual-frames.json` clip names to set `display` on Pikachu's Final.
- The victim profiles in `gameplay.json` still carry their drawing addresses: `sheet`, `frameWidth/Height`, `scaleToWorld`, `originX/Y`, `frameIndex`, `render`. The strict parser requires them. Prune them once the package draws victims.

## Verification

- **Byte comparison test.** `src/assets/gameplayData.test.ts` reads the baseline `frames.json` with `git show 9fa28f3:` and compares every clip field and top-level value with `JSON.stringify` equality. Each value is found in exactly one of the two new files. All three fighters pass.
  - The test skips if the commit is unavailable, for example in a shallow clone.
  - It also checks that no field name is both display and gameplay, that both files list the same clips, and that the Pikachu clearance registration matches the sheet.
- **Reader sweep (old reads vs new reads).** A temporary test (not kept) dumped the readers' outputs before and after the change. It covered:
  - `selectPackedDrawing`, `getPackedBodyDrawing`, `getPackedBodyRootDelta`, `packedAnimationEnd`, `getPackedBodyRenderMetrics`, `installedPackedSheet`, `getPackedNativeTimedClip`;
  - `sampleFinalBodyPose` with every packet role;
  - `heldItemSocketAt` for both axes;
  - `getPikachuReviewedStateClock` and `getPikachuSheetRenderMetrics`;
  - `clipDrawingAt` and `pikachuClipClock`;
  - `finalVictimBodyPose`, `registeredFinalFxProfiles` and `FINAL_FX_CUES`;
  - the capture envelope;
  - the manifest `char.*` entries, the move sheet keys and the anim lists;
  - Pikachu's recovery attacks;
  - DK paired protection;
  - ages 0–319 on every clip of every fighter (460 MB of JSON).

  Result: **identical**. The only difference was the raw `clip` object that two helpers return, which no longer carries image fields. No typed consumer reads those (`tsc`).
- **Suite.** `npx tsc --noEmit` passes. `npx vitest run` passes: 602 files, 12,321 tests. That includes:
  - `src/sim/goldenReplays.test.ts`;
  - all `*.physics.test.ts`;
  - `scripts/character-package/exportLegacy.test.ts`, where every fighter matches the game at every tick;
  - `scripts/character-package/displayEquivalence.test.ts`, with 0 mismatches.

  `node port/scripts/check-layers.mjs` passes. `npm run build` and the browser probe were left to the coordinator's milestone pass.
- **Replay identity.** `SIMULATION_BUILD_ID` hashes `src/`, `port/src/` and `assets/characters/`, so it changes with this commit. That is expected. Under the CLAUDE.md identity rules, replay and history files from earlier builds are rejected, not reinterpreted.

## Risks

- **The art pipeline still writes mixed `frames.json`.** `tools/fighter-pack.py`, `link-build-final.py`, the socket derivers and the install scripts write gameplay fields into `frames.json`. After any such run, `python3 tools/split-gameplay-data.py` moves them across; values found in `frames.json` win. `gameplayData.test.ts` fails until it is run. An unknown field stops the script until it is classified.
- **Stale documentation.** CLAUDE.md still says held-item sockets are "`itemAttachmentPoses` in frames.json"; it now means `gameplay.json`. It was not edited, because agents may not change CLAUDE.md. The add-character skill's art references also describe the mixed file.
- `donkeykongCompleteGrab` no longer validates image fields. Its gate is the pose track only.
