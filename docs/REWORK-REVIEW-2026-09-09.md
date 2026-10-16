# Full rework review — 9 September 2026

This document records the original audit. Subsequent fixes and verification are
in the [implementation record](REWORK-IMPLEMENTATION-2026-09-09.md) and the current
[roadmap](PROJECT-ROADMAP.md). The user's later priority update defers replay
playback to ultralow priority; it is not a prerequisite for the other work.

## Verdict and direction

Keep the existing fixed-step 2D simulation and finish the gameplay rework. Defer
3D. The project has substantial reusable work, but it is still a broad prototype:
several menu choices and thoroughly tested subsystems do not control the live
game. A rendering migration would carry these problems forward.

The main change to the plan is **integration before expansion**. Build one
convincing two-player match, using Link as the art reference and Ultimate as the
working mechanics reference. Make rules, input, combat, recovery, results, and
restart agree. Extend that proven contract to four participants and the rest of
the roster. Finish a dependable tuning loop before adding editor features.

The earlier plan correctly identified collision, input, animation, and authoring
work. Its weakness was treating component coverage and feature breadth as
completion. The runtime review found missing connections in rules, CPU behavior,
replay, moving stages, controller ownership, and editor lifecycle. None calls for
a wholesale engine rewrite.

## Evidence and limits

Reviewed branch: `rework/gameplay`, base commit `26e6e3f`, including the existing
uncommitted rework. This review adds documentation, screenshots, and diagnostic
scripts; it does not fix the newly reported gameplay bugs.

- Previous verification in this session: **295 test files / 9,872 tests passed**;
  typecheck and production build passed. The shield/capture fix and revised
  three-frame jumpsquat integration tests are already included in that baseline.
- This review inspected production call paths and ran the existing production
  build in Chromium through WSL. Screens were inspected at 1280×720, with narrow
  checks at 390×844 and 844×390. No broad suite was rerun for these documentation
  changes.
- **Runtime** below means observed in the actual browser/Character/Matter code.
  Some probes inject a match configuration or control input and step the real
  world; these are targeted integration checks, not a complete human playtest.
- **Code** means confirmed in the production call path, without the full
  triggering journey exercised. **Assessment** is a design judgment.
- No physical controller session, audio listening session, competitive human
  playtest, cross-browser determinism proof, or representative GPU performance
  benchmark was completed. Those remain acceptance work.

Evidence: [screen and runtime observations](review/2026-09-09/runtime-observations.json),
[physics observations](review/2026-09-09/physics-observations.json),
[lab flow observations](review/2026-09-09/flow-observations.json), and
[reproduction instructions](review/2026-09-09/README.md).

Priorities: **P1** blocks a trustworthy match or tuning session; **P2** materially
weakens gameplay or usability; **P3** is polish. These are development priorities,
not claims about severity in every game mode.

## Gameplay, rules, and physics

### G1 — P1: Selected match rules are not implemented by the live match

**Runtime:** a supplied Time configuration with five stocks still created
three stocks per player. **Code:** no live timer is wired. The runtime sample
did not record match-end phase, so scene activity alone cannot distinguish an
unexpired match from the post-match freeze. The scene passes `DEFAULT_STOCK_COUNT` into `StockTracker` at
`src/scenes/MatchScene.ts:2424`. Its `MatchEndDetector` uses stock elimination.
`timeMode.ts` and `SuddenDeathController` have no live scene callers.

**Change:** one rule controller must initialize stocks, advance the timer, score
KOs/self-destructs, and decide the winner from the selected rules. Implement
ties/sudden death explicitly. **Acceptance:** play one- and five-stock matches;
run a short Time match to expiry and verify scoring and results.

### G2 — P1: Attack, grab, and defense commitment can overlap

**Runtime.** Link could begin a grab while his jab remained active, begin a grab
during a dodge, and raise shield or dodge during grab startup. These are parallel
states, rather than explicit allowed transitions.

The defense gate only considers `activeAttack` at `Character.ts:2298`; the fresh
grab gate at `:2504` only excludes a raised shield. **Change:** centralize action
eligibility and allowed cancellation windows, including grab commitment.
**Acceptance:** inputs during startup/active/recovery either buffer or remain
blocked according to the contract; no accidental simultaneous attack/grab/defense.

### G3 — P1: Hitlag does not freeze physics or animation completely

**Runtime.** With neutral input and hitlag still active, an airborne fighter moved
down **0.2778 design pixels per Matter step**; six frozen steps moved it 1.6667px.
`Character.ts:1924` zeros velocity, then the scene's Matter step adds gravity.
This movement is independent of permitted SDI.

In a separate probe, simulation was paused with 60 hitlag frames remaining while
the Link jab sprite advanced **frame 0 → 1 → 2**. Sprite clips use Phaser elapsed
time, not the combat frame (`spriteAnimationDriver.ts:459`, `:481`;
`MatchScene.ts:5411`). Thus the visible attack can complete during frozen combat.

**Change:** define a complete freeze/release contract for bodies, move timers,
and poses, preserving explicit SDI and restored momentum. **Acceptance:** neutral
freeze has no drift; the impact pose stays fixed; release restores the intended
launch/momentum exactly once.

### G4 — P1: Launch decay generates reverse acceleration after a wall collision

**Runtime, real Matter wall.** A rightward launch hit a static wall and its actual
horizontal velocity became zero. Following steps changed it to **−0.34, −0.68,
−1.02 … −5.10**, without another hit or input. This is repeated acceleration away
from the wall, not a controlled one-time bounce.

`Character.ts:3499` subtracts a tracked launch vector from actual velocity, then
adds its decayed replacement. Collision changes actual velocity without updating
that tracked vector. **Change:** reconcile launch state with collision response.
**Acceptance:** wall, floor, ceiling, and platform contact must not invent energy;
any bounce/tech behavior must be explicit.

### G5 — P1: Recovery state is inconsistent after catching a ledge

**Code.** A fresh ledge catch resets jumps and falling state at
`Character.ts:2694`, but leaves `helpless` set. It normally clears only on ground
contact or respawn. Catching a ledge after an exhausted up-special and then
dropping/jumping off can leave jump/offense gates disabled. The dodge gate also
does not consistently account for helpless state.

**Change:** specify which actions and resources landing, ledge catch, damage,
and respawn restore. **Acceptance:** reach the same ledge by normal falling,
up-special, air dodge, and being hit; compare all ledge exits and recovery options.
Verify exact Ultimate air-dodge refresh rules separately.

### G6 — P1: The Moving Platform arena currently has stationary platforms

**Runtime + code.** Three samples across 1.3 seconds showed both moving platforms'
bodies and visuals fixed at their authored coordinates. `BaseStage.updateRender`
has no production caller. Even the unused visual update applies motion only to
rectangles (`StageRenderer.ts:535`), while bodies are created static (`:291`).
Ledge corners are derived once at `MatchScene.ts:2928`.

**Change:** use one fixed-step platform motion state to drive collision, riders,
visuals, and ledges. Merely connecting the visual animation would create a moving
picture over stationary collision. **Acceptance:** ride, jump onto, fall through
where allowed, and grab a moving platform throughout its full cycle.

### G7 — P2: Jump-attack timing and shield buffering are inconsistent

**Runtime:** neutral-stick Jump + Attack together produced Link's full-hop launch
velocity **−13**. Attack one frame later in the same squat produced **−5.46** and
the same neutral aerial. Squat initialization misses attack intent that the next
frame's update handles (`Character.ts:2960`, `:3029`). Ultimate explicitly supports
simultaneous jump/attack as a short-hop attack.
[Nintendo's technique guide](https://www.smashbros.com/en_US/howtoplay/technique.html).

**Code:** a jump pressed during shieldstun is buffered, but the shield-exit gate
only accepts a fresh press (`Character.ts:2311`, `:3487`). Continuing to hold
Shield can prevent the buffered jump from executing.

**Change:** resolve buffered intent through the same eligibility checks as fresh
input. **Acceptance:** measure same-frame chords, one-frame variations, late
shieldstun inputs, landing buffers, dedicated jump, and tap jump separately.

### G8 — P2: Physics tuning needs a coherent reference model

**Assessment grounded in code.** `combat.ts:140` uses a 0.09 knockback temper whose
calibration comments assume no launch damping. Launch decay now exists at 0.34
per frame; hitstun uses another custom conversion. Matching one KO percentage
does not establish correct arcs, combo windows, weight effects, or DI.

Keep the fixed 60Hz loop. Define distance/velocity/weight conversions, then measure
run acceleration and braking, full/short hops, air drift, fall/fast-fall, landing
actionability, launch trajectories, hitstun, and KO thresholds together. Cover
low/mid/high damage and center/edge positions. Do not change isolated constants
or call them canonical without measurements.

### G9 — P2: Link's kit is an approximation, not an Ultimate implementation

**Code + reference.** His side special is chained local hitboxes
(`Link.ts:364`), up special is a tether (`:405`), and down special is a short fused
trap (`:440`). Ultimate Link has a returning boomerang, grounded/aerial Spin
Attack, and a remote bomb. This changes neutral and recovery substantially.
[Link's measured Ultimate move data](https://ultimateframedata.com/link).

Keep Link's art as the visual reference. Build the move behaviors the chosen kit
actually needs, then author timings against that behavior. The existing special
schema should not force a projectile into a melee approximation. General system
correctness comes before completing every fighter's exact kit.

### G10 — P2: CPU tiers are much less capable than their modules suggest

**Code.** `MatchScene.ts:4082` calls `simpleBotInput`; the separate tier AI systems
are not the active opponents. The live bot approaches, periodically jumps, attacks
nearby targets, and handles some items. Difficulty changes aggression/cooldowns.
It never shields or dodges and has no normal offstage recovery plan.

**Change:** first provide a reliable training opponent: stand, shield, jump,
DI direction, recover, and repeat an action. Then integrate the stronger AI with
honest difficulty labels. Do not use the current bot alone to judge balance.

### G11 — P2: Advanced parity still needs targeted verification

Ground tech handling exists; no wall/ceiling tech path was found. Shield's current
perfect timing is based on raising the shield. Exact release-parry behavior,
shield geometry, DI/LSI/SDI, ledge regrab rules, autocancel/landing lag, jab chains,
attack cooldowns, and held-input buffering need a version-specific comparison.
These are review targets, not a claim that every listed mechanic is broken.

## Menus, controls, and player identity

### U1 — P1: Controller identity is lost between selection and combat

**Code.** Character Select assigns physical pads to players in a private map
(`CharacterSelectScene.ts:670`). Its final payload contains generic `gamepad`
input type but no pad identity (`scenes/characterSelect.ts:962`). Live input reads
the binding store's fixed slot profiles. Fresh defaults are P1 WASD, P2 arrows,
P3 pad 0, P4 pad 1 (`input/InputBindingsStore.ts:217`).

Two pads joining the first two slots therefore do not establish the matching
combat bindings. **Change:** carry participant ID, physical device, binding
profile, fighter, and palette in one session payload. **Acceptance:** one pad
versus CPU, two pads, mixed keyboard/pad, four pads, disconnect/reconnect, rematch.
This call-path finding still needs physical-controller reproduction.

### U2 — P1: Sparse lobby slots create the wrong fighters

**Runtime.** Configuration requested P1 Link + P3 Kirby. The scene spawned P1 Link
and **P2 Cat**, omitting Kirby. It constructs slots 1 and 2 unconditionally and
decides whether to create extras from array length (`MatchScene.ts:2040`, `:2334`).

**Change:** instantiate actual participant entries and map their identities
explicitly through stocks, HUD, collisions, AI, hazards, and input. Include
two-/three-/four-player and mirror-match scenarios. Also inspect the wind callback
at `MatchScene.ts:1944`, which only resolves bodies for the first two players.

### U3 — P2: Menu journeys require switching input devices

**Code; layouts inspected.** These are missing actions, not just missing hints:

| Device | Incomplete journey |
|---|---|
| Keyboard | Character Select has no keyboard human-join/portrait navigation. |
| Mouse | Mode and Stage Select have no pointer selection; READY is not clickable. |
| Controller | Character Select cannot add/configure a CPU or back out cleanly; Controls and Stage Forge lack controller navigation/back. |

Relevant paths: `CharacterSelectScene.ts:470`, `:558`, `:834`;
`ModeSelectScene.ts:191`; `StageSelectScene.ts:212`; `RebindingScene.ts:248`;
`StageBuilderScene.ts:708`.

**Change:** every screen exposes the same focusable actions to supported devices,
with clear confirm/back behavior and actual button glyphs. **Acceptance:** complete
keyboard-only and controller-only setup/match/rematch journeys, plus complete
pointer navigation through menus. Mouse-only combat is not a requirement.

### U4 — P2: Looking up controls abandons the current match

**Code.** Pause → Controls starts another scene with return destination Main Menu
(`MatchScene.ts:6422`). **Change:** suspend the match beneath Controls and return
through Pause. Separate binding changes from a decision to leave the match.

### U5 — P2/P3: Rule selection and menu information are too thin

Mode Select exposes only mode and quantity. Items cannot be disabled through the
normal menu, although the engine supports it and defaults to medium frequency.
Stage Select needs thumbnails/layout previews, hazard information, and scrolling
for saved arenas; its fixed rows overflow with a sufficiently large library.
Avoid copying a partial config field by field when forwarding it.

The four-card main menu is worth retaining. Solo-versus-CPU setup is reachable
with mouse/keyboard; complete that journey for a controller-only player. Remove contradictory
navigation hints and replace missing gamepad glyphs, visible as boxes in this
Chromium environment.

## Character Lab and Stage Forge

### E1 — P1: The Lab test/restart/return loop is unreliable

**Runtime.** Set Wolf's run speed to 10 and Test Fight: speed was 10 and lab
recording was correctly disabled. Pause → Restart restored **7.5**, dropped the
override, and enabled ordinary recording. The explicit restart payload only
contains `matchConfig` (`MatchScene.ts:6413`). Enter/pad rematch follows the same
limited payload path (`ResultsScene.ts:363`).

Re-entering the Lab also initializes a new Wolf draft (`CharacterEditorScene.ts:140`).
Returning through Results → Main Menu → Character Lab reproduced a `drawImage`
exception in `refreshFields`: retained field arrays still reference destroyed
Phaser text objects. The Lab failed to become active and its new draft had
already reverted to 7.5 with no undo history. The flow probe subsequently timed
out, so its later Pause → Controls step was not exercised.

**Change:** retain a real editor session (draft, undo history, selection), recreate
only its view objects, and add Return to Lab. Preserve test overrides and lab
metadata through every restart. **Acceptance:** edit → test → restart → return →
undo → save → reopen, with identical tuning and no error or data loss.

### E2 — P2: Link and saved tunes are outside the normal authoring pipeline

**Code.** The Lab's ten shipped JSON specs exclude Link, Kirby, and Donkey Kong
(`CharacterEditorScene.ts:47`). Regular Character Select uses a static roster;
saved tuned specs are not selectable there. Only six saves are visible in the
Lab's mouse list, although source cycling can reach more.

**Change:** use one roster/spec registry and give saved variants stable identity.
Keep validated data, undo/redo, serialization, and test overrides. Add import and
broader authoring only after saved content can reliably be tested and played.

### E3 — P2: The Lab preview does not yet demonstrate a move

**Visual + code assessment.** It shows an idle sprite, separate body/hitbox
diagram, and static duration bar. Those are useful, but “live collision preview”
overstates what it communicates. Add play/pause, frame step/scrub, facing, actual
move poses, active hitboxes/hurtboxes, and first actionable/landing frames. Keep
the sprite and collision geometry together so a sword's visible reach can be
checked. Use measured distance/launch readouts in a test fight.

### E4 — P2: Stage Forge needs draft recovery and a test loop

**Code.** Escape exits without guarding unsaved changes; re-entry resets the draft
(`StageBuilderScene.ts:296`, `:732`). Testing requires save and normal match setup.
Retain recoverable drafts, provide explicit save/discard behavior, and add
Test Arena → Return to Forge. Validate placement, spawn safety, and moving-piece
behavior through the same runtime used for matches.

## Aesthetics, camera, feedback, and accessibility

**Assessment from the captured game:** retain Link's current shaded style and
readable silhouette. It is a workable direction, not a finished quality bar.
The roster mixes that look with tiny pixel sprites and differing levels of
detail. Standardize proportions, outline/light direction, sprite occupancy,
weapon continuity, and palette treatment before generating more fighters.

| Area | Current observation | Next useful change |
|---|---|---|
| Fighter animation | Per-move packs exist for four fighters; others reuse generic attacks. Poses follow elapsed time rather than mechanical frames. | Tie anticipation, active contact, recovery, and hitstop to simulation; repair key poses before adding frames. |
| Stage art | Depth faces, top edges, and parallax already help. Flat arena still looks like geometric scaffolding; moving arena has conspicuous horizontal background bands. | Finish one arena with clear platform tops, restrained scenery contrast, consistent depth/shadows, and readable hazards. |
| Camera | Both fighters are visible in sampled desktop scenes; close framing crops portions of the arena. | Test center/edge play, vertical launches, recovery, and four-player spread; tune zoom/padding against fighter readability. No camera defect claimed from a still image alone. |
| HUD | Percent is readable on desktop, but stocks are detached at top center and identity labels are small. Contrast is weak on bright scenery. | Group portrait/name, percent, stocks and player color; add readable background plates and the actual mode timer. |
| Hit feedback | Spark, audio, and other FX infrastructure exists. Physics/pose freeze currently disagrees. | Fix hitstop first; distinguish light/heavy hits, block, parry, grab, launch and KO with coherent pose, sound and restrained shake. |
| Menus | Main menu is clean; later screens mix fonts/density. Lab names truncate, Controls' Confirm/Reset labels overlap. | Shared spacing/type/button rules; responsive rows, readable labels and bounded scroll areas. |
| Small screens | Portrait shrinks the entire 1920×1080 canvas into a narrow strip; even landscape text is small. | Decide supported minimum size. Prioritize desktop/controller play; if phones are a target, they require deliberate layouts/input, not just scale-to-fit. |

Screens: [main](review/2026-09-09/main.png),
[roster](review/2026-09-09/roster.png),
[lab](review/2026-09-09/lab.png),
[controls](review/2026-09-09/controls.png),
[Link match](review/2026-09-09/match-default-link.png),
[moving arena](review/2026-09-09/moving-platforms.png),
[portrait match](review/2026-09-09/match-portrait.png).

Accessibility acceptance should include legible minimum text, focus visibility,
color-independent player identification, complete rebinding, tap-jump preference,
separate audio levels, and reduced flash/shake. Check what already exists before
adding duplicate settings. Audio mix quality and motion comfort need a listening
and human playtest pass; screenshots cannot establish them.

## Replay, performance, and maintainability

### R1 — P1: Recorded combat cannot reproduce the played match

**Runtime:** capture retained movement, jump, attack and drop-through while
discarding **special, shield, dodge and grab**. **Code:** heavy attack is also
omitted. The probe accidentally supplied `heavy` instead of `attackHeavy`, so its
recorded sample does not establish that particular omission. See
`InputCaptureBuffer.ts:391`; serialization/parsing in `ReplayFile.ts:603` and
`:1008` has the same limited contract. A deterministic RNG is insufficient when
the recording drops actions.

Playback/seek components exist but no playback scene or production controller
construction was found. The menu has no replay entry. The engine version is also
intentionally omitted from live recording initialization (`MatchScene.ts:3142`).

**Change:** finish all-input capture/round-trip first, version the simulation and
content, then wire playback/reset/seek. **Acceptance:** replay a short match with
every action family, compare state checksums throughout, and reject incompatible
builds. Full VCR polish can follow reliable linear playback.

### R2 — P2: All art loads before the menu

**Runtime.** In a fresh local production-page load, the gate was reached after
195 resource requests, approximately **25.3MB transferred**, and 188 texture
entries. Source texture dimensions imply about **143MB of RGBA pixel data** before
additional runtime/GPU overhead. This is an estimate, not measured GPU residency.
Local startup was about 5.9 seconds and is not a network/device benchmark.

`PreloadScene.ts:48` queues the full manifest. Load the menu/portraits first and
selected fighters/stage before the match; profile atlases, decode/upload cost and
repeated scene transitions. Keep higher-resolution and 3D expansion deferred
until loading and memory budgets are explicit.

### R3 — P2: Tests and documentation overstate integrated completion

Keep the pure state machines and regression suite. Add a small number of
behavioral tests around complete flows and real physics. For example,
`CharacterSelectScene.test.ts:343` claims sparse-slot protection while matching
source lookups for slots 1 and 2; that cannot detect the reproduced wrong roster.
Tests should fail on the player's broken outcome, not merely on missing source
text/imports.

`Character.ts` and `MatchScene.ts` are very large integration points. Extract
action eligibility, recovery transitions, session/config ownership, and render
projection incrementally as fixes establish their contracts. Preserve fixed-step
simulation, seeded randomness, pure data schemas, and unique fighter identity.
Do not start with an architectural rewrite or a larger abstraction layer.

### Findings corrected by runtime verification

Ordinary pointer Rematch **preserved** Link/Kirby, palettes, and configuration.
Phaser retains scene data when a start omits new data. The initially suspected
ordinary reset is not a confirmed bug. Likewise, a generic return-to-selection
rule reset was not established. Explicit Lab restart/rematch payloads still lose
overrides; unify session handling so behavior does not depend on implicit retained
data. The moving platforms were stationary in runtime, not visibly moving over
stationary bodies; that latter problem would arise if only visual updates were wired.

## Revised execution milestones

| Order | Deliverable | Completion evidence |
|---|---|---|
| 1 | Trustworthy match session | Correct stock/time rules, participants/devices, complete menu journeys, restart and Controls return; repeat a match without configuration loss. |
| 2 | Coherent combat and physics | Resolve commitment, hitlag, launch collision, recovery and input timing; real-Matter regressions and short human matches on the flat arena. |
| 3 | Reliable tuning and reproduction | Lab edit/test/return and saved tunes; frame trace/step tools; all-input capture and deterministic linear replay with build identity. |
| 4 | Smash-like calibration and one convincing kit | Documented units and reference cases; movement/launch/defense measured together; Link's intended specials and timings work in real fights. |
| 5 | Readable presentation | Simulation-driven poses, one finished stage, coherent HUD/hit feedback, consistent menu layouts, loading budget and accessibility checks. |
| 6 | Expand proven behavior | Remaining fighters, stronger CPU, four-player/hazard regression matrix, full authoring and replay polish; consider 3D after this baseline is convincing. |

Some work can overlap: session fixes and combat fixes are independent; targeted
readability improvements need not wait. The sequence is a priority order, not a
reason to defer every small polish fix. The next concrete change should address
**live match rules and participant/device identity**, alongside the already
reproduced combat-state faults—not another large asset or editor expansion.
