# How the game reads `frames.json` today

2026-10-18. Read-only inventory made for the [Phase 2 plan](../../../CHARACTER-LAB-PLAN.md)
(produced by a research agent). It sorts every field into display data (goes into
the character package), gameplay data (stays with the fighter's game code) and
provenance with no runtime reader. Line references are as of commit 02b8d21.

Coordinate conventions used below:
- **tex px**: pixels in the logical cell.
- **world px**: design px, which is tex px × `scaleToWorld`.
- **BC**: body-centre relative, facing right, +y down.
- **ROOT**: relative to the actor source root.

## A. Consumers

**src/assets/manifest.ts:738-767, src/assets/packedFrames.ts:48-65**
- Reads `strip`, `frameWidth/Height`, `frameCount`, and `atlas`+`trims` (via `packedLayoutOf`, only when both are present). Each clip becomes the texture `char.<id>.<clip>`.
- `trims[i]` is `[x,y,w,h,dx,dy]` in tex px.
- Pikachu ignores `strip` and uses `animations/<sheet>.png`, with `ftilt` routed to `tilt` (:757-764).
- Pikachu final-visual `pages` load as separate sheets (:750).
- `columns`/`rows` (Link victim grids) are never passed to the manifest. `frameRect` would need `columns` for grid sheets; Phaser derives it.
- Display only.

**src/characters/spriteAnimationDriver.ts:772-777, 906-922**
- Clip-name membership in `animations` decides which anim keys exist (DK and Link: all clips; Pikachu: only `final*` plus a hard-coded table).
- The registered `frameRate` (6 / 60 / per table) is effectively dead: the Phaser anim is paused and the frame is set explicitly (simulationSpriteAnimation.ts:648-658).

**src/characters/artFrameSelector.ts:56-95**
- Frame count comes from the manifest.
- Its own `stateElapsed` counter (:68-69) resets when the state changes and pauses in hitlag. It is used only by unclocked fallbacks.

**src/characters/simulationSpriteAnimation.ts**: the central `(clip, age) → drawing` resolver
- `resolveSimulationAction` returns an `ActionPose` with exactly one clock mode. `selectActionArtFrame` (:591-604) dispatches in this order: `directArtFrame` → `reviewedSheet` (Pikachu windows) → `nativeTimedSheet` (packed samples) → `move` (gameplay phase split) → `phase` → `hold` → `duration` proportional → fixed fps on `stateElapsed` (run/jump 12, else 6).
- Pikachu reviewed states (:129-140) read `frameWindows`, `frameCount` and `loopDuration` through `getPikachuReviewedStateClock`. It throws if the strip count ≠ `frameCount`.
- Pikachu specials (:322-336) take `resolvePikachuSpecialBodyClock` (pikachuSpecialPresentation.ts). In the hold phase that function uses `nativeFrame = local % 6`. The window search returns `{frame: artFrameIndex, duration: frameCount}`, which round-trips through the `duration` branch.
- Smash charge reads `pose-batches/smash-charges.json` `frameWindows` (:357-366), not frames.json.
- Final (:148-163): `sampleFinalBodyPose`. Link fallback: `selectPackedNativeSampleFrame` with a zero-based raw age (:150-159).

**src/characters/packedBodyPresentation.ts** (DK and Link, through `PackedBodyProfile`)
- Clip fields read (:27-45): `frameWindows`, `loopDuration`, `nativeSampleIndices`, `actionFrameStarts`, `pairedActionTimeline`, `hurtboxPoses`, `attackCollisionPoses`, `catchCollisionPoses`, `captureGripPoses`, `sourceRootDelta`, `root`, `scaleToWorld`, `bodyCentreFromRootY`.
- Two drawing clocks:
  1. **Windows clock**, `bodyDrawing` (:114-129):
     ```
     local = loopDuration ? age % loopDuration : (pairedActionTimeline || end===null) ? age : min(age, end-1)
     ```
     It finds `[startFrame,endFrame)`. It requires a `hurtboxPoses` row for that `artFrameIndex` and returns null at `age ≥ pairedActionTimeline.endFrame`. Hold = clamp to the last window.
  2. **Native clock**, `nativeSampleFrame` (:364-374). Used only when there are no `frameWindows` (:212-214):
     ```
     samples = actionFrameStarts ?? nativeSampleIndices   // 1-based
     native = (loop ? age % loop : age) + 1
     ```
     It takes the last `i` with `samples[i] ≤ native`. In loops it skips drawings that last fewer than 2 frames. Non-loop clips hold the last drawing.
- `actionFrameStarts` remaps timing only; the `nativeSample` identity still comes from `nativeSampleIndices` (:387).
- Animation tail: `animationEnd` is the last sample (:215-218, 335-343).
- Attacks (:201-211): if the clip has `pairedActionTimeline`, `mapDonkeyKongPairedActionAge` resamples the move's actual startup/active/recovery onto the source spans (donkeykongPairedActionTimeline.ts:43-59). The source spans are *derived* from which `attackCollisionPoses` rows are non-empty (:15-39). Otherwise a profile `attackPilots` age match is tried, then raw age.
- Receiving (:418-433): the `hurtboxPoses` row for the selected drawing (BC world px, `nativeSample` must match). X is mirrored by `basis = action.facing * actor.facing`. The intangibility overlays and `applyDonkeyKongMoveProtection` run on the paired-source clock (donkeykongPairedProtectionClock.ts:27-39). **Gameplay.**
- `headContact` (:435-445): BC, gameplay.
- `attackCollisionPoses` (:448-463): replaces only the capsules of the live hit ids (Character.ts:1403, donkeykongAttackCollisionPose.ts). **Gameplay.**
- `catchCollisionPoses` (:472-488, donkeykongCatchCollisionPose.ts): replaces grab-sensor capsules by region id ("drawing-actor-centre world units"). **Gameplay.**
- The complete standing grab is hard-coded in donkeykongCompleteGrab.ts:38-75: 7/3/28, sample ages `[0,3,6,7,8,9,10,23,32,37]`, keyed off `pairedGrabTimeline`/`catchCollisionPoses`.
- Render metrics (:465-468): `originX = root[0]/frameWidth`, `originY = root[1]/frameHeight`, `scaleToWorld`, and `bodyCentreFromRootY ?? profile default`.
- `getPackedBodyRootDelta` (:132): clamps the index. Its only caller is Character.ts:3789 (ground recovery), and the getup clips have no `sourceRootDelta`, so it falls back to `GETUP_ROLL_SPEED`.

**src/characters/donkeykongBodyProfile.ts:37-61 / linkPackedBodyProfile.ts:113-127**
- Code-side profile data: `sheetAliases`, `missingSheet` (`generic` vs `invisible`), default `bodyCentreFromRootY` (-42 / -36), `attackSheet` rules (DK Max punch at ≥111 charge, `up_special→up_special_air`; Link `smash2`), DK `attackPilots`/`grabPilots` (`review_pilot_*` clips), landing-sheet selectors.

**src/characters/pikachuPresentation.ts**
- `getPikachuSheetRenderMetrics` (:16-31): `root`, `scaleToWorld`, `frameWidth/Height`. `bodyCentreFromRootY` is **hard-coded -25** and the JSON value is ignored. `tilt` maps to `ftilt`. Without `root` it uses the hard-coded 512×384/512 padded fallback.
- `getPikachuReviewedStateClock` (:37-53) works like `bodyDrawing` minus the paired logic.
- Receiving for those states comes from TS tables (`pikachuStateHurtboxes`, `pikachuAuxiliaryBody`), keyed by `localFrame`, not from JSON. Pikachu's non-final `hurtboxPoses` (item_heavy_*, landing_heavy, squat_wait_item) have no runtime reader.

**src/characters/pikachuRecoveryAttacks.ts:36,59**
- Only `frameCount`, used to size the recovery phase. Windows and hurtboxes come from TS.

**src/characters/donkeykongPairedProtectionClock.ts:15-39**
- `pairedActionTimeline`, `frameWindows`, `hurtboxPoses`, `attackCollisionPoses` (validation). The protection windows are in paired-source age. **Gameplay.**

**src/characters/handAnchors.ts**
- Only a comment mentions frames.json. It holds static per-fighter grip constants (fallback).

**src/items/HomeRunBat.ts:105**
- Comment only (`bodyCentre 25 px`). No reader.

**src/characterPresentation/legacy/heldItemPoseData.ts:54-116**
- `itemAttachmentPoses[artFrameIndex]` gives `{position (BC world px, facing right), angle}`.
- The drawing is chosen by re-running `selectActionArtFrame` with a null `stateElapsed`. The clip name goes through `installedPackedSheet` (and `tilt→ftilt`).
- The angle is overridden by `item-axes.json` (per drawing, or per native frame indexed by action age with a loop). The upper-body overlay wins.
- **Gameplay:** hammer hit areas (Character.ts:6762) and the shot muzzle (:6834).

**src/characters/Character.ts:1085-1093 (`captureGripPoses`)**
- The clip comes from `selectCapturePoseSource` → `selectPackedDrawing`.
- A row matches on `poseKey`, `profileKey`, `artFrameIndex`, `nativeSample` and `context` (`cargo-held` etc.).
- Gives the captor's grip point for captive placement. **Gameplay.** It merges with the TS calibration in captureAttachmentDefaultData.ts, which has no JSON reader of its own.

**src/characterPresentation/legacy/finalPoseData.ts:121-156** (`sampleFinalBodyPose`, Finals for all three fighters)
- Gate: the sheet starts with `final` and `coordinateOrigin === 'actorSourceRoot'`.
- Three branches:
  1. Packed fighter + `sourceSampleBasis: one-based` + no windows → packed native clock.
  2. `frameWindows` (with loop).
  3. `nativeSampleIndices` + `(basis ? 1 : 0)` offset.
- Per-drawing rows, all required to match `hurtboxPoses.nativeSample`:
  - receiving (ROOT), `headContact`;
  - outgoing `attackCollisionPoses`, or `attackCollisionPosesByRole[packetRole]`, where the packet label comes from MatchSim.ts:3869;
  - `sourceAttachmentPoses` (roles item/sword/…/capture-anchor/waist, point plus optional angle and `axisDirections`);
  - `sourceEffectPointPoses` (bone top/hip);
  - `sourceRenderPoses` (page redirect plus per-drawing origin), with `sourceDrawingCount` > `frameCount` for paging. These are supported but present in no current data.
- `sourceRootDelta[floor(localAge)]` is a cumulative per-tick ROOT displacement: [0] = 0, a loop must stay at 0, and it must cover every age (validation :113-118).
- **Gameplay:** Character.ts:12556-12571 (receiving, converted ROOT→BC with `- bodyCentreFromRootY`), MatchSim.ts:3865-3875 (final contacts), :3836-3846 (capture-anchor), Character.ts:3414 (root-delta motion).

**src/finalSmash/finalVictimBodyPose.ts:64-158** (top-level `runtimeFinalVictimProfiles`)
- Schema `authored-final-victim-profiles/1`.
- Per profile key: `sheet`, dimensions, `scaleToWorld`, `bodyCentreFromRootY`, `endAgeExclusive`, `terminalHold`, an all-zero `rootDelta`, and `drawings[{startAge,endAgeExclusive,frameIndex,authoredSampleIndex,receiving,attachments,originX/Y,render?,headContact?,captureSupport?}]` (contiguous).
- Selection by authored age, holding the last drawing if `terminalHold`.
- **Gameplay:** victim hurtboxes and the capture anchor (MatchSim:3848-3858).
- The victim strips are also ordinary `animations` clips (Link uses grid `columns`/`rows`).

**src/finalSmash/registeredFinalFx.ts + finalFxProfiles.ts:85-150** (top-level `runtimeFinalFxProfiles`, DK and Pikachu)
- Per cue key: `sheet`, dimensions, `scaleToWorld`, `originX/Y`, `endAgeExclusive`, `loopFrames`, `terminalHold`, `drawings` windows (plus `render`).
- The page must exist in `animations` with matching dimensions.
- Placement: `sourceRoot + effectPoint(bone) + cue.localOffset`, rotated and mirrored. Cue timing comes from `finalFxCueFacts.json`, not frames.json.
- Display only (buildSimView.ts:57-66).

**port/src/fighters/finalVisual.ts:20-33** (`final-visual-frames.json`)
- `clips[sheet] = {nativeEnd, loopDuration, root, scaleToWorld, bodyCentreFromRootY, frames[]}` where `frames[]` is a **dense per-tick** table of `{nativeSample, page, frame}`.
- `sample = floor(loop ? t % loop : min(t, nativeEnd))`. Pages carry their own dimensions.
- Display only (explicitly "never authoritative").

**src/match/linkArticles.ts:185-198 + buildSimView.ts:79-129**
- `fx__link_*` clips in `animations` supply `root`/`scaleToWorld` (via `getPackedBodyRenderMetrics`) and `frameCount`.
- Boomerang drawing = `floor(spin mod 360 · count / 360)`, i.e. a uniform-angle assumption.
- The top-level `articles` key (`spinDegrees`, `use`, `source`) is **not read**.

**Indirect readers**
- poseProvider.ts (facade); Character.ts; MatchSim.ts; buildSimView.ts.
- port/src/fighters/poses.ts:25-125: render placement is `y = bodyCentre - bodyCentreFromRootY`, `originX` mirrored on flip, Pikachu rotation pivots.
- upperBodyLayer.ts: waist cut from `root`/`scaleToWorld`/`bodyCentreFromRootY`.
- linkNormalBodyClock.ts: a tool bakes the gameplay→native mapping into `actionFrameStarts`.

## B. Synthesis: distinct concepts

1. **Image layout**
   - Fields: `strip`, `frameWidth/Height`, `frameCount`, `atlas`, `trims`, `columns`/`rows`, `sha256`; final-visual `pages`.
   - Uniform across dialects except Pikachu's URL convention and the Link grid victims.
2. **Registration**
   - `root` (tex px) → origin; `scaleToWorld`; `bodyCentreFromRootY` (world px).
   - DK/Link: per clip, with a profile default. Pikachu: JSON ignored, hard-coded -25 plus a padded fallback. Final-visual: per clip. Victim: per drawing `originX/Y`. `sourceRenderPoses`: per drawing.
3. **Drawing schedule.** One concept, five encodings:
   - (a) `nativeSampleIndices` (1-based on DK/Link, 0-based on Pikachu unless declared by `sourceSampleBasis`), with `loopDuration`;
   - (b) `actionFrameStarts`, a gameplay-tick override of (a);
   - (c) `frameWindows` `[start,end|null)` in 0-based action age (Pikachu everywhere, DK paired/hammer);
   - (d) victim/FX `drawings[{startAge,endAgeExclusive}]` plus `terminalHold`/`loopFrames`;
   - (e) the final-visual dense per-tick table.
   - Hold semantics differ:
     - (a) holds the last drawing;
     - (c) clamps to `end-1`, or has an open `null` end;
     - paired clips end as null;
     - victims use explicit `terminalHold`;
     - loops in (a) suppress drawings shorter than 2 ticks.
   - Generalize to `{tick → drawing}` windows on a declared clock domain (action age vs native frame), with `loop` / `hold` / `end` policy and an optional `nativeSample` label.
4. **Clock mapping (action age → source age).** Today spread across:
   - `actionFrameStarts` (baked);
   - `pairedActionTimeline` + `mapDonkeyKongPairedActionAge` (piecewise-linear three-phase resampling, with phases inferred from collision rows);
   - the Pikachu special clock (code);
   - the Link Final raw-age quirk;
   - `sourceSampleBasis`.
   - Should become one explicit "phase spans" or "time-remap" track per clip.
5. **Shape tracks keyed by drawing** (row = `artFrameIndex` + `nativeSample` pairing check):
   - receiving: `hurtboxPoses` (BC for packed, ROOT for Finals), victim `receiving`;
   - outgoing: `attackCollisionPoses`, plus `ByRole` keyed by packet role;
   - grab: `catchCollisionPoses` (regions by id).
   - Ids bind to gameplay hit records, which own damage and timing. Coordinate origin is implicit except in Finals (`coordinateOrigin`); the new format should always declare it.
6. **Socket / point tracks:**
   - `itemAttachmentPoses` (BC, position + angle; `item-axes.json` adds per-native-frame axes);
   - `sourceAttachmentPoses` (ROOT, role-keyed, angle + axes);
   - `sourceEffectPointPoses` (bones top/hip);
   - `headContact`;
   - `captureGripPoses` (context + profile keyed);
   - victim `attachments`/`captureSupport`.
   - Unify as named sockets per drawing (or per tick), with an explicit space.
7. **Root displacement:**
   - `sourceRootDelta` (cumulative, per tick, ROOT/world, facing right);
   - victim `rootDelta` (forced zero).
   - Pikachu's ground-recovery/tech deltas live in TS (pikachuAuxiliaryBody.ts, pikachuSurfaceTech.ts), not JSON.
8. **Facing:** all data is right-facing, with X mirrored once by `action.facing * actor.facing`. Drawing-basis ≠ actor facing (pivot, backward roll) is code-only; `drawingFacingBinding` is prose. Make it a per-clip enum.
9. **Clip aliasing:** `sheetAliases`, `ftilt`/`tilt`, `itemMotionClip`, `render` page redirects.
10. **Final Smash FX profile and victim profile:** separate top-level banks keyed by cue/profile. They could be ordinary clips with effect-point anchoring.

## C. Generalizable vs host-specific

**Generalizable:**
- the paired-timeline resampling;
- `actionFrameStarts`;
- Pikachu reviewed windows;
- loop-suppression rule;
- `pullToHoldThreshold` 20 (hard-coded at packedBodyPresentation.ts:296 and simulationSpriteAnimation.ts:399);
- fall/landing sheet selectors;
- the alias tables;
- `missingSheet` policy;
- default `bodyCentreFromRootY`.

**Host-specific (extension):**
- DK pilots (`review_pilot_*`) and the complete-standing-grab validator (hard-coded 7/3/28);
- DK Max-punch sheet rule;
- Pikachu special clocks (thunderJolt 0.77 rate, skull-bash loop6);
- Link boomerang spin;
- Final victim recipe identities/SHAs;
- final FX cue facts.

## D. Provenance / review only (no runtime reader found)

- `meta` (all three), and Link `articles` (`spinDegrees` etc.).
- `sha256`, `artProvenance`, `artStatus`, `sourceProvenance`, `receivingProvenance`, `collisionProvenance`, `itemAttachmentProvenance`, `floorRegistrationProvenance`.
- `sourceTargetImage`/`Sha256`, `staticReceivingAcceptance*`, `sourceCatchReceipt*`, `bodyReviewKey` (clip level), `sourceGeometryAdapters`, `postPackPoseTranslations` (already baked into the raster and sockets).
- `captureClockCalibration` (its 20 is hard-coded in code).
- `runtimeClock` (prose).
- Pikachu `nativeWindows`, `holdRule`, `specialPhase`, `specialClockKind`, `dynamicCutoff`, `playableEndExclusive`, `drawingFacingBinding`, `runtimeBindingStatus`, `packingMetadata`/`Sha256`, `atlasRepack`, `coordinateAdapter`. These are read only by `tools/*.py`; the rules they describe are implemented in TS.
- Pikachu `nativeSampleIndices` on non-final clips.
- Pikachu non-final `hurtboxPoses`.
- Link `sourceRootDelta` on `bair`/`utilt`.
- `columns`/`rows`.
- final-visual `schema`, `purpose`, `sampling`, `*Sha256`, `decodedBytes`.
