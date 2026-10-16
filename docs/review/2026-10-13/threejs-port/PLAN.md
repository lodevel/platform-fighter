# Phaser → Three.js port — plan

Started 2026-10-13. Owner: the coordinating AI; the user supervises and keeps visual acceptance.

## Takeover status — 2026-10-15

**Acceptance reopened after user play.** The completion statement below is
superseded by the [line-by-line acceptance audit](../../2026-10-15/user-bugs/PLAN-AUDIT.md).
The implementation exists, but the user reported freezes, controller ownership
and selection failures, missing/coarse animations and unacceptable effects.
Several written acceptance criteria remain unmet; repairs are in progress.

Implementation of steps 4–9 is complete. The root app now builds and serves the
real Three.js/HTML match host on `http://localhost:4173/platform-fighter/`.
The interrupted step 5 is finished: production gameplay lives in the pure
`src/sim/MatchSim.ts`, runs in Node, and uses the directly vendored Matter fork.
Phaser hosts and the retired editors are removed; retained runtime dependencies
and historical qualification tools have explicit preservation/archive records.
Controls, saved profiles, device reconnect, real result flow, audio, hazards,
items, traps and Final presentation are connected to the actual simulation.
The bomb and sword beam use code-drawn art, as requested by the user.

The coordinating agent and three agents completed the port and repaired the
unfinished Pikachu, DK and Link Final paths. The corrected production candidate
is `game-BYOl1XlT.js`. Its strict build, 723-file static runtime copy and full
suite pass: 548 files / 12,027 tests. Actual keyboard/gamepad browser checks,
all six stages, the title-to-results menu journey, audio and character Final
cases pass without page errors. See the current [cutover evidence](../../2026-10-15/takeover/THREE-CUTOVER.md)
and [headless evidence](../../2026-10-15/takeover/headless/README.md).

The original frozen extraction gate contains 55,800 exact per-frame comparisons.
Its short Final-enabled scenario did not activate a Final. The completed moves
therefore have separate production/browser qualifications and a longer current
browser replay; do not interpret the historical hashes as Final choreography
parity. Human visual acceptance and controller feel remain the user's review.
The old 17.7 GB cleanup list has not been executed; a narrower exact-duplicate
scratch-build plan is available under the takeover evidence.

The original plan and log below are retained as the record of decisions made
before the takeover. Their “blocked” and future-tense descriptions are historical.

## Why

The user judged live, code-built Three.js arenas "much more impressive" than the
current Phaser stages and ComfyUI-painted backgrounds (demos below), wants the
menus rebuilt, and wants the whole game built by AI under their supervision
(no Unity, no editor-centric engine). Phaser is not mandatory.

Demos (published artifacts hold the full HTML; copies in `demos/`):

- Sky Ruins (flat stage): https://claude.ai/artifact/LLdmGVZ8xnHHBjasuwUfKH
- Magma Caldera (lava stage, real pool cycle, dragon hazard): https://claude.ai/artifact/55wCUcts9oRvy63Jobp6da

## Fixed decisions

- Renderer: Three.js, orthographic camera over the 1920×1080 design space
  (small camera moves are fine, no free 3D camera).
- Physics: the same Matter.js Phaser bundles (3.90.0's fork), loaded directly,
  so the simulation stays bit-identical. Rapier is a possible later step, not
  part of this port.
- Fighters stay 2D ComfyUI sprites, drawn as flat sprite cards. The 3D fighter
  experiments (code-built, Blender, sprite inflation) were all rejected.
- Menus: HTML/CSS over the canvas, reusing the existing Phaser-free state
  modules (`lobby.ts`, `modeSelect.ts`, `characterSelect.ts`, `stageSelect.ts`,
  `pauseMenu.ts`, `results*.ts`) unchanged.
- Kept roster: Donkey Kong, Pikachu, Link (fresh). The other fighters are deleted
  in step 4, not ported.
- The port moves the simulation code; it does not rewrite gameplay. Everything
  the other AI lands before step 5 (Link, Final Smash, items) comes along as is.

## Coupling measured 2026-10-13

- 84 of 642 non-test `src/` files import Phaser (~69k lines).
- `MatchScene.ts` 9,509 lines, `Character.ts` 14,076 lines (151 `scene.matter`
  uses, mostly `body.setVelocity` / `setPosition`).
- 169 of 241 `tools/*.mjs` probes drive the game through `window.__game`.

## Working in parallel with the other AI (steps 1–3)

Another AI is editing `src/` (Link, Final Smash, items, MatchScene, scenes)
with all work uncommitted in one working tree. Until it finishes, the port:

- lives only in `port/` (own `package.json`, `tsconfig.json`, Vite config);
  nothing under `src/` is edited, so the game's typecheck, tests, build and
  `SIMULATION_BUILD_ID` are unaffected;
- only **reads** Phaser-free modules from `src/` and assets from `assets/`;
- never rebuilds the game's `dist/`; the port builds to `port/dist/` and is
  served by `npm run preview` on 4211 (static, assets read from `../assets`);
  `npm run dev` (4210) also works but reloads whenever another agent edits
  `../src`, so headless captures use the preview. Heavy commands run under
  `flock .tmp/dk-heavy.lock`;
- adds no git operations (no commit, stash, reset, checkout).

If a `src/` module the port reads turns out to import Phaser transitively, the
port does not patch it; it records it under "Blocked on step 5" below.

## Steps and acceptance

### 1. Stage renderer (parallel, now)

`port/src/stage/`: build a Three.js scene from a `StageLayout`
(`src/stages/stageDefinitions.ts`).

- Flat stage → Sky Ruins look; lava stage → Magma Caldera look, pool levels
  driven by the same cycle function and frame count the sim uses.
- Wind / crumbling / moving stages get a plain themed fallback for now.
- Accept: in a screenshot at 1920×1080, every ground, platform, ledge and pool
  edge sits within 1 design px of its `StageLayout` value (overlay check), and
  the user accepts the look.

### 2. Fighter sprite cards (parallel, now)

`port/src/fighter/`: load a fighter's sheets via `src/assets/manifest.ts` and
`assets/characters/<id>/frames.json`, play clips, apply palettes, flip by
facing, draw at the same scale and anchor as `visualScale.ts` / Phaser.

- Accept: for DK, Pikachu and Link, idle / run / jab frames rendered by the
  port match the Phaser render of the same frame pixel-for-pixel within
  filtering tolerance (side-by-side capture).

### 3. HTML/CSS menus (parallel, now)

`port/src/menus/`: password gate, main menu, mode select, character select,
stage select, results, pause, driven by the existing state modules.
Menu input is DOM keyboard + Gamepad API (the current `LocalInputHandler` /
`RawInputSource` import Phaser).

- Accept: every flow the Phaser menus offer is reachable with keyboard and
  gamepad; the state modules are used unmodified; the user accepts the look.

--- gate: the other AI has finished (items phases 6–9, Link, Final Smash) ---

### 4. Delete the unused fighters

Remove every fighter except Donkey Kong, Pikachu and Link, with their
registrations, assets, tests and probes. Accept: typecheck, tests, build green.

### 5. Headless match simulation

Extract `MatchSim` from `MatchScene`: owns the Matter engine, stage entities,
characters, items, projectiles, hazards, rules, replay capture; no Phaser.
`Character` talks to a small `PhysicsWorld` interface instead of
`scene.matter`. Visual side effects become events/state the renderer reads.

- Accept: recorded replays re-simulated in the old Phaser build and in the
  headless sim produce identical per-frame state hashes (golden replays for
  DK, Pikachu, Link, items, lava stage, Final Smash); the existing
  `*.physics.test.ts` suites pass; the sim runs in Node.

### 6. Match view in Three.js

Wire `MatchSim` to the port renderer: stage, fighter cards, items, projectiles,
traps, damage areas, hit sparks, Final Smash presentation, charge indicator,
camera, HUD (HTML). Accept: side-by-side parity captures of the Phaser and
Three.js builds on the same replay; every spawned object still shows its real
damage area (`add-spawned-object` skill); the user plays it.

### 7. Probes and tools

Expose `window.__sim` (step, state, start match) and port the probes used by
the DK / Pikachu / Link qualification records. Others are archived.

### 8. Controls screen (done early, 2026-10-13)

User decision 2026-10-13: **port Controls** (per-player keyboard/gamepad
rebinding with saved profiles, reusing the bindings store), **drop Character
Lab and Stage Forge**. Step 9 deletes their Phaser scenes and the code only
they use (CharacterEditorScene, StageBuilderScene, `src/builder/`, the
custom-character and custom-stage paths, the pause menu's lab variant) after
checking nothing else depends on it. Accept: every player can rebind from the
title screen and character select; bindings persist and drive the match.

### 9. Remove Phaser

Delete the Phaser scenes, renderers, `phaser` dependency and dead code.
Accept: no `phaser` import left; typecheck, tests, build, preview green;
replays still verify.

## Blocked on step 5

Phaser still reaches the port in two dev-only places, both removed by step 5/9:
- the stage viewer builds its lava entities with
  `createLavaHazardFromStageHazard` from `src/stages/LavaHazardRenderer.ts`
  (a Phaser module) rather than duplicating it; step 5 moves that factory to a
  Phaser-free module and MatchSim owns the hazards;
- `port/parity.html` renders with Phaser on purpose (step 2 acceptance).

Visuals that currently live in Phaser code and must be re-done in Three.js
(grows as the other AI lands work): Final Smash presentation
(`src/finalSmash/finalSmashPresentation.ts`), Link event presentation
(`linkCommonEventPresentation.ts`), `fx/HitSpark.ts`, `ui/ChargeIndicator.ts`,
`ui/DamageHud.ts`, item/trap visuals inline in `MatchScene`,
`stages/LavaHazardRenderer.ts`, `camera/CameraController.ts`.

## Estimate (given 2026-10-12)

Steps 1–3 ≈ 6–10 working days; 4–7 ≈ 11–19 (STEP5-DESIGN puts step 5 alone at ~14); Controls ≈ 1–2; total ≈ 5–7 weeks.

## Log

- 2026-10-13: plan written; user approved starting steps 1–3 in parallel.
- 2026-10-13: steps 1 and 2 built, awaiting the user's visual acceptance.
  - `port/` scaffold: own package (three 0.170.0), tsconfig, Vite config
    (`build` + `preview` on 4211), `scripts/typecheck.mjs` (fails only on port
    files; tsc follows imports into `../src`, which the other agent is mid-edit
    on: 9 game files had errors that day), `scripts/capture.mjs`,
    `scripts/parity.mjs`.
  - Step 1 (`port/src/stage/`, `render/`): `PlaneCamera` is an off-axis
    perspective camera, so the z = 0 gameplay plane maps to the canvas exactly
    like Phaser's 2D camera (capture check: 0 px projection error on all five
    stages). Platform and pool front faces sit on the gameplay plane, depth
    goes backward, so the visible edge is the collision edge (overlay shots in
    `step1/`). Themes: Sky Ruins (day/sunset/night) and Magma Caldera (pools
    driven by the sim's `LavaHazard`; the demo's dragon breath is dropped
    because it is not a game hazard, the dragon only circles). Wind,
    crumbling and moving stages use Sky Ruins for now; moving platforms follow
    `computeMovingPlatformOffset`; crumbling visual states are not wired.
  - Step 2 (`port/src/sprites/`): `SpriteLayer` takes Phaser-sprite fields
    (key, frame, origin, scale, flip, rotation, alpha, tint, depth) from the
    asset manifest. Parity vs Phaser on 8 sprites covering every field:
    230,126 painted pixels, max channel difference 1/255, none over 2
    (`step2/parity.png`). The viewer shows DK, Pikachu and Link idling via
    their own presentation modules (`step2/*.png`).
- 2026-10-13: step 3 built (HTML/CSS menus), awaiting the user's visual acceptance.
  - `port/index.html` is now the game shell; the stage viewer moved to
    `port/viewer.html`. Shared pieces: `stage/stageRuntime.ts` (layout +
    hazards + clock) and `stage/stagePresenter.ts` (fixed 60 Hz loop, stage +
    sprite layer, `contain` or `cover` fit) serve both pages.
  - Screens (`port/src/menus/`): password gate, title, match rules, character
    select, stage select, match (placeholder until step 6), pause, results
    (sample numbers, labelled). Every menu runs over the live 3D arena; stage
    select shows the highlighted arena live with the chosen lineup on it.
  - State modules used unchanged: `accessGate`, `modeSelect`, `characterSelect`,
    `handCursorState` (hand cursors, hit-tested on the DOM), `stageSelect`,
    `pauseMenu`, `resultsButtons`, `resultsHeadline`, `resultsStats`.
  - Input (`app/input.ts`): DOM keyboard + Gamepad API with edge detection
    and hold repeat; pads drive their own hand (stick free move, d-pad snap).
  - MERGE AT THE GATE: `port/src/menus/matchRules.ts` holds the item
    frequency / Item Switch / Final Smash rule logic that ModeSelectScene keeps
    inside the Phaser scene; it moves to `src/scenes/modeSelect.ts` at step 4.
  - Evidence: `step3/*.png`; `port/scripts/menus.mjs` walks gate → title →
    rules → fighters → stages → match → pause → results → back to title with
    the keyboard and a SIMULATED gamepad (injected `navigator.getGamepads`),
    no console errors, no horizontal overflow at 390 px.
  - Not in step 3 (recorded, not dropped): Controls / per-slot controls editor
    and character tune (step 8 with the editors), custom builder stages in
    stage select (step 8), binding profiles attached at match launch and
    palette recolours on fighter art (step 6), Shift+Enter quick match.
- 2026-10-13: user asked for state-of-the-art modular organisation. `port/src`
  is now layered (`pending` < `engine` < `arena` < `fighters` < `ui` < `entries`),
  documented in `port/ARCHITECTURE.md` and enforced by
  `port/scripts/check-layers.mjs` (part of `npm run typecheck`). Shared kits:
  `arena/kit/` (toonKit, skyKit, lavaKit, props); registries for themes and
  screens; `port/src/pending/` mirrors `src/` paths for code that merges at
  the gate (matchRules, GazeHazard, Inferno stage).
- 2026-10-13: arenas for every built-in stage: Wind Canyon (prayer flags and
  dust follow the real net wind), Crumbling Temple, Sky Ferry (rotor rafts and
  a chain lift on the game's moving-platform paths). Wind zones are drawn by
  `arena/hazards/windZones.ts` from the live entities.
  - FINDING (game data, not changed): the wind stage's two zones share one
    rectangle, both with forceX -0.45 and phases 0/180, so their forces cancel;
    a fighter is pushed (net 0.225) only on threshold-crossing frames. The port
    shows the real net force, so the stage looks calm.
- 2026-10-13: step 5 design written by an agent: `STEP5-DESIGN.md` (8
  sub-steps, ~14 days for step 5 alone; PLAN's 11–19 days for steps 4–7 is too
  low). Key facts: no full-state snapshot/restore is wired (restore =
  re-simulate inputs); `tools/replay-resim.mjs` double-applies CPU wrappers;
  Phaser's Matter plugin sets resolver thresholds 4/6 vs Matter's defaults.
- 2026-10-13: user request: The Inferno. New stage (`pending/stages`) with
  the giant-head hazard `pending/entities/GazeHazard.ts` (5 unit tests,
  `port/*.check.ts`): every 60 s (AUTHORED timing) the head rises for 4 s,
  its eyes glow 2.5 s, then the flash KOs every fighter not crouching
  (intangible / inactive fighters excluded). Theme `arena/themes/inferno/`:
  obsidian stage, lava sea, demons tormenting souls, caged souls, the head from
  the user's picture (Real-ESRGAN x4 upscale, cut out; kept in
  `port/private/`, served by dev/preview only, git-ignored, never built), stone
  face fallback. The viewer runs a demo (`fighters/gazeDemo.ts`) where the
  hazard's own rule decides the KOs: DK crouches and survives, Pikachu and
  Link are star-KO'd and respawn. Match integration (instant KO via the lava-KO
  path, `'gaze'` HazardType, crouch from `Character.isCrouching()`, no warning: the
  user does not want one) lands at the gate / step 6.
- 2026-10-13: in-match HUD in HTML (`port/src/ui/hud/`), fed by the HUD part
  of the render contract (`pending/sim/hudView.ts`, STEP5-DESIGN §4): plates
  with fighter art, damage in the game's colour ramp (`damageHudFormat`),
  stocks or score, Final Smash meter (`FinalHudModel`) and clock. The
  Inferno demo drops the victims' stocks on the flash. (A "CROUCH!" alert
  was built, then removed at the user's request: no warning text.) Shared design tokens in `ui/shell/tokens.css`.
- 2026-10-13: user asked for far more detailed demons and people. New
  `arena/kit/humanoid.ts` (jointed figure, poses as joint rotations, lathe
  torso, tapered limbs, hands, screaming hinged jaw) and `arena/kit/creatures.ts`
  (bat wing now shared with the Magma dragon, curved horns and tails). The
  Inferno scenes: demons with pitchfork or whip over souls kneeling in chains,
  souls boiling in cauldrons while a demon stirs, caged souls gripping bars.
- 2026-10-13: port unit tests: GazeHazard (5) and matchRules (4), `npm test`
  in port/ (9 pass). Regression after all of the above: projection 0 px on
  every stage, sprite parity max 1/255, menu journey green.
- 2026-10-13: Inferno: the centre platform is drawn as the head's toothbrush
  mustache (`themes/inferno/mustache.ts`, collision unchanged), at the user's
  request with the pictured person's consent (confirmed by the user). The head
  is sized and placed by `GiantHead.alignPhiltrum`, solved against the shared
  rest eye (`engine/space.ts restEye`), so the nose-to-lip strip of the
  picture sits behind the platform from the player's view when risen; the
  lava line now falls just under the mustache. HUD lives are hearts.
- 2026-10-13: Inferno tuning (user): floating platforms raised 90 design px
  (`INFERNO_PLATFORM_RAISE`, AUTHORED; item anchors move with them) and the
  lava sea lowered to groundTop - 70 world units, figure scenes kept on
  their ledge with rock pillars down to the lava. The risen head now shows
  mouth and chin under its mustache platform.
- 2026-10-13: user decisions: port Controls, drop Character Lab and Stage Forge
  (title screen updated). The phase-5 item questions were already answered on
  2026-10-12 ("Keep all, with provenance labels").
- 2026-10-13: step 5.1 started ahead of the gate (user: "we must advance"):
  golden-replay state-hash harness in `port/scripts/golden/` (digest,
  scenarios, record/verify), driving the game's published build through
  `window.__game`, no src/ change. Replay of a recorded CPU match is
  IDENTICAL frame by frame; a flipped input is caught 4 frames later with
  the differing fields. Six full-length scenarios + warmup/144 Hz self-checks
  recorded in `step5/`. See `step5/README.md` for the gaps closed at the gate.
- 2026-10-13: step 5.2/5.3 code prepared in `port/src/pending/physics/`
  (`PhysicsWorld`/`PhysicsHost` interfaces, `createMatterPhysicsWorld` on the
  Matter fork with Phaser's resolver globals and gravity), 5 unit tests incl.
  parity with a hand-built engine; merges at the gate and is verified there
  by the goldens.
- 2026-10-13: step 8 done early: the Controls screen (`ui/screens/controls.ts`)
  renders the game's own `PlayerControlsInput`/`PlayerControlsSession` (capture,
  reset, conflicts, save-as-copy to InputProfileStore); character select lets
  each human pick a saved profile (V/(Y) or click), carried in
  `bindingProfileId`. Menu journey probe: Attack rebound to K and saved as
  "My Keyboard 1", profile chip cycles. Evidence `step8/`.
- 2026-10-13: step 6 groundwork (gate still closed): `pending/sim/view.ts`
  (SimView: fighters by body centre + sheet/age, items, projectiles,
  explosions, camera targets, HUD); `pending/camera/cameraFraming.ts`, the
  match camera math lifted from CameraController with MatchScene's settings
  (4 tests; at the gate CameraController delegates to it); new port layer
  `match/` (CameraRig, FxLayer drawing blasts and projectile hit boxes at
  their real areas, MatchView); sprite layer gained display size
  (setDisplaySize). The 3D camera now zooms by narrowing its frustum at a fixed
  eye distance (true zoom, consistent perspective). Sandbox page
  `port/sandbox.html` runs a scripted demo match (`match/demoMatch.ts`,
  scaffolding deleted in step 6) through the real view and HUD; evidence
  `step6-prep/`.
- 2026-10-13: gate prepared. `port/scripts/gate-merge.mjs` does the whole
  pending → src merge as moves plus anchored, line-ending-preserving edits.
  It computes everything in memory, the dry run checks every anchor, and it
  writes nothing unless all of them match. `port/scripts/gate-trial.sh`
  rehearses it on a scratch copy: root tsc 58 → 58 identical, no new test
  failures, CRLF kept, port typecheck and build pass. Order, verification
  and manual follow-ups: `GATE-RUNBOOK.md`. Step 4 deletion manifest:
  `STEP4-INVENTORY.md` (agent, read-only).
- 2026-10-13: costume recolouring for the kept fighters (user condition for
  deleting the build-time palette pipeline). The sprite layer has HSV region
  shifts that keep shading, with Phaser parity unchanged. Art-measured
  region keys are in `pending/characters/paletteArtKeys.ts`; palette N
  relative to palette 0 comes from `palettes.ts`. The page is
  `port/costumes.html`, evidence in `costumes/`. The match view draws each
  fighter's `paletteIndex`.
- 2026-10-13: rehearsed sub-step 5.3 on scratch copies: MatchScene on the
  port's own Matter world replays the six goldens **IDENTICAL**. The swap was
  checked live (0 bodies left in Phaser's world), and a 1%-longer-step
  control diverges at frame 1 (`step5/REHEARSAL-5.3.md`). Today's tree only
  boots with two rehearsal patches for the in-progress Link data. Costumes
  also reach the select cards, HUD plates and lineups
  (`engine/sprites/spriteSnapshot.ts`).
- 2026-10-13: Matter vendored for step 9 (`port/scripts/vendor-matter.mjs`):
  a byte-identical fork copy plus a generated ES bundle that
  `createMatterPhysicsWorld` now imports. Rehearsal build B on the bundle
  replays the six goldens **IDENTICAL**. The gate merge moves
  `pending/physics/matter/` whole.
- Found: sound runs on Phaser's sound manager, but `AudioManager` already
  takes any `SoundManagerLike`, so the port needs only a Web Audio
  backend (in progress).
- 2026-10-13: sound in the port: a Web Audio `SoundManagerLike` drives the
  game's own `AudioManager` and `StageMusicController`, and `SimView.events`
  carries `sfx`/`ko`. The sandbox plays music and the demo's cues; the probe
  counted 11 starts as scripted (`audio/README.md`).
- 2026-10-13: match effects in the port from the game's formatters (hit
  sparks, shield bubble, charge bar, damage areas) on a new shape layer.
  The art selector was extracted from the Phaser sprite driver and proven
  identical to it on DK/Pikachu snapshot sequences; `FighterView` now carries
  the animation snapshot, and the sandbox draws snapshot-driven poses
  (`effects/README.md`). Item poses and traps wait for items phases 9–10.
- 2026-10-13: explosion art ported (burst sprite on an additive effect layer,
  embers, smoke; a pure function of age, driven by an `explosion` event);
  Pikachu's special-move rotation about its pivot (pivot-rebase test); the
  Inferno gained lava geysers erupting behind the stage
  (`kit/lavaKit.ts lavaGeysers`, visual only).

