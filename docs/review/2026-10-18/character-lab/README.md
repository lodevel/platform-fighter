# Phase 2: character package, exporter and lab

2026-10-18, built overnight while the user was away. Executes the
[Phase 2 plan](../../../CHARACTER-LAB-PLAN.md) of the
[character system roadmap](../../../CHARACTER-SYSTEM-ROADMAP.md). Nothing is
committed. The game's behaviour is unchanged; one game module was refactored (below).

## What was built

| Piece | Where | Notes |
| --- | --- | --- |
| Format `character-package/1` | `character/package/types.ts` | Display only: pages, drawings (rect, root anchor, scale), actions (drawing schedule, body-centre offset, sockets, optional Ultimate source move), provenance, host extensions |
| Validator, canonical JSON, content revision | `character/package/validate.ts`, `canonical.ts` | Rejects gaps, overlaps, unknown fields, missing or unused drawings and pages, drawings outside their page |
| Evaluator | `character/evaluator/evaluate.ts` | One timing model for every character: contiguous windows from tick 0, then `loop`, `hold` or `stop`; sockets mirrored by facing |
| Boundary check | `character/boundaries.test.ts` | `package`, `evaluator`, `testing` and `lab` may import only each other (and `three` for the lab); anything in `src/` or `port/` fails. A deliberate game import was caught, then removed |
| Exporter (temporary) | `scripts/character-package/`, `npm run character:export` | Game-side migration code, deleted in Phase 6 with the legacy readers |
| Lab | `character/lab/`, `npm run lab`, `npm run lab:build` | Standalone Vite app, own config `vite.character-lab.config.ts`, builds to `dist-lab/` (16 KB of JavaScript, no game code) |
| Inventory of today's data | [frames-json-inventory.md](frames-json-inventory.md) | Which `frames.json` fields are display, gameplay or provenance |

Shared game change: `src/characterPresentation/legacy/heldItemPoseData.ts`
exposes `heldItemSocketAt` (a clip's socket for one drawing and age). The live
`sampleHeldItemSocket` now calls it, so the game and the exporter share one
implementation. Socket, item and presentation tests pass (36 files, 522 tests).

## Export: exact by construction

The exporter does not re-implement any timing rule. For every clip it calls the
game's own selection function at every tick from 0 to 1,199, then compresses the
answers into windows:

| Game function | DK | Link | Pikachu |
| --- | ---: | ---: | ---: |
| `selectPackedDrawing` (windows and native-sample clocks) | 189 | 222 | |
| Review pilot drawing (one drawing the game substitutes at one move age) | 6 | | |
| `sampleFinalBodyPose` | 6 | | |
| `getPikachuReviewedStateClock` | | | 150 |
| `selectPikachuAuxiliaryBody` (getups, techs, item motions…) | | | 34 |
| `pikachuFinalVisualPose` | | | 7 |
| `finalVictimBodyPose` | 7 | 7 | 7 |
| **Actions exported** | **208** | **229** | **198** |

Drawing placement comes from the game's render-metric functions and held-item
sockets from `heldItemSocketAt` (two sockets where they differ: `item` along the
bone's Y axis and `item-z` for gun barrels).

**Verification.** Every action was re-evaluated from the package at every tick up
to 2,399, twice the sampled range, and compared with the game: drawing, source
frame and both sockets. That covers 499,200 ticks for DK, 549,600 for Link and
475,200 for Pikachu, with **zero differences**. Each package also passes the
validator, and export → canonical JSON → parse → canonical JSON is
byte-identical. `scripts/character-package/exportLegacy.test.ts` re-runs all of
this in the normal test suite.

| Package | Actions | Drawings | Pages | JSON | Page PNGs | Pages as RGBA8 | Revision |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| donkeykong | 208 | 1,627 | 208 | 1.1 MiB | 80.1 MiB | 678 MiB | `96d4b5fabf72` |
| link | 229 | 1,753 | 229 | 1.9 MiB | 49.3 MiB | 281 MiB | `7238f09b9ded` |
| pikachu | 198 | 1,422 | 205 | 1.0 MiB | 22.6 MiB | 279 MiB | `9a42bbfab4c8` |

Pikachu's package omits the 14 old Final owner pages that the game's Final
display bank replaced, which is why it holds 279 MiB rather than the 366 MiB
measured for the whole installed bank.

**Shared drawings: 0 in every package.** Not one of the 4,802 drawings is shown by
more than one action. That is the measured starting point for Phase 3.

### Left out, with reasons

- **Effect strips (12):** DK's five Final and Giant Punch effects, Link's arrows and
  boomerang, Pikachu's four Final effects. They are placed by effect cues on body
  points, not by an action clock; the format needs an effect concept before they
  move. Open.
- **DK `attack`, `up_special`, `review_legacy_grab`:** no timing in the data at all
  (the game falls back to a fixed frame rate). Open: decide whether they are still
  shown anywhere, then delete or give them timing.
- **Gameplay data** (hurtbox, attack, catch and capture shapes, root motion): stays
  with the fighters' game code by decision; moving it out of `frames.json` is
  Phase 6 work.

## Lab

Opens any exported package, either served by the dev server or picked as a
folder in the static build:
- **Navigation:** an action list with the Phase 1 reference set pinned on top.
- **Playback:** play, pause, tick step and seek, at 1× or ¼× speed.
- **Display conditions:** facing, dark/light stage, and zoom 1.4 (match) or 2.8
  (Final) at real match pixel size.
- **Overlays:** root, body centre, sockets with item direction, drawing bounds.
- **Panels:** a drawing-window strip, action facts, a memory panel per action and
  per package (RGBA8 and BC7 estimates, shared drawings) and validation problems.

**Ultimate side by side.** For the reference actions with a local Ultimate Frame
Data recording, `character/lab/references.json` maps the action to the recording,
which plays beside the package on the same tick:
- DK: jab, forward smash, Spinning Kong, back throw.
- Link: jab, forward smash, spin attack, back throw.

UFD GIFs hold one frame per game frame, displayed slowed at 130 ms, so the lab
maps frame N to tick N. DK's jab is 24 frames in Ultimate and 24 ticks in the
package. The recordings stay in git-ignored `assets/gen/` and are never shipped.

### Browser check

`tools/character-lab-probe.mjs` ran in a fresh disposable Windows Edge,
1920×1080, pixel ratio 1:
- **Dev lab, nine views:** DK jab, forward smash facing left, Spinning Kong on the
  light stage, Final attack at zoom 2.8, bat swing with bounds and sockets; Link
  jab, spin attack facing left, bat on the light stage; Pikachu's Final display.
  Every view drew the character, reported no package problems, and loaded the
  Ultimate recording where one exists ([report](lab-probe.json), screenshots
  beside this file).
- **Static build:** `dist-lab/` served alone reports that no package is served,
  then opens a package folder through its folder input. It loaded a 10-action copy
  of the Link package holding just the reference set
  ([screenshot](static-build-folder-link.png)). Playwright cannot upload a
  directory through the Windows CDP bridge, so the probe hands the same files to
  the real input with a `DataTransfer`, keeping their folder-relative paths.
- **Console:** the only console errors appear after the probe stops the dev
  server: the Vite client's reconnect attempts. The missing favicon (two 404s on
  the first run) was fixed.

## First Phase 3 measurement: whole-drawing reuse is not enough

[`tools/character-reuse-scan.py`](../../../../tools/character-reuse-scan.py) crops
every drawing of each package and groups drawings that are identical, or nearly
identical as is or mirrored (mean difference under 1.5/255 on 96 px
premultiplied thumbnails, sizes within 4%). One stored drawing per group would
remain ([reuse-scan.json](reuse-scan.json)):

| Package | Drawings | Groups with reuse | Across actions | Drawn pixels today → with reuse | Saved |
| --- | ---: | ---: | ---: | --- | ---: |
| donkeykong | 1,627 | 52 | 23 | 149.0 M → 140.5 M | 5.7% |
| link | 1,753 | 44 | 29 | 65.2 M → 59.3 M | 9.0% |
| pikachu | 1,422 | 59 | 52 | 58.5 M → 52.4 M | 10.4% |

The groups are what one would expect: DK's repeated Final punches, Link's
brake/landing poses that return to the same stance, Pikachu's repeated Final
display drawings. Sharing whole drawings therefore saves under a tenth. The
large savings have to come from what Phase 3 compares: reusable parts and
computed poses, and fewer stored drawings per action with deliberate holds.

## Open items

- Effect strips and DK's three untimed clips (above).
- Recoloured costumes are not in the lab yet. Moving the palette shader into the
  character module is planned Phase 3 work.
- The format has no phases yet. Today's data does not name them; they arrive when
  creation (Phase 4) records them.
- Ultimate references for idle, run, turn, held item, grabbed and the Final
  phases are still missing (Phase 1 record).
