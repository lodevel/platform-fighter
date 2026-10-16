# Platform Fighter Overhaul

Last updated: 2026-09-23

2026-10-16 addition: the [Character System Overhaul roadmap](CHARACTER-SYSTEM-ROADMAP.md)
defines a separate future workstream for reusable character packages, AI-assisted
creation, bounded memory and replaceable presentation. The first implementation
step, [preparing the current rendering interfaces](CHARACTER-RENDERING-REFACTOR-PLAN.md),
is complete with [runtime qualification](review/2026-10-16/character-rendering-refactor/README.md).
New character representations then develop in an independent lab and integrate
through a game adapter. Reuse is
planned before generation; individual character packages can evolve across
supported visual representations. The illustrated art remains the quality
reference; future 3D support is an option, with no 3D pipeline selected now.
The gameplay status and engine references below are the September 23 snapshot;
the current presentation architecture is described in [port/ARCHITECTURE.md](../port/ARCHITECTURE.md).

This file is the persistent handoff for the visual, menu, combat-feel, and
character-authoring overhaul. Update the status table and verification record at
the end of every milestone so work can resume safely after an interrupted
session.

The [full review dated 2026-09-09](REWORK-REVIEW-2026-09-09.md) is the current
assessment. It includes runtime evidence, screenshots, priorities, and acceptance
criteria across gameplay, physics, menus, tools, presentation, and replay.

The [September 14 implementation record](review/2026-09-14/README.md) continues
that review with ordinary landing, distinct air jumps, facing, linked strikes,
and the item/platform integration boundaries found during browser acceptance.

The [September 15 landing continuation](review/2026-09-15/README.md) adds Link's
special and air-dodge landing commitment, interruption cleanup and authoring.
The [down-air rebound milestone](review/2026-09-15/rebound/README.md) adds
hit/shield bounce, fast-fall suppression and the returning strike. The
[September 16 reference-knockback pass](review/2026-09-16/reference-knockback/README.md)
converts Link's forward tilt and up air after the five-scenario launch measurement
and gravity recovery fix. The [launch-energy pass](review/2026-09-16/launch-energy/README.md)
retains momentum through recovery and adds Link/DK gravity, boost and vertical
tumble transitions. The [September 20 speed-up pass](review/2026-09-20/README.md)
groups trajectory ticks with intermediate collision checks while preserving outer
game clocks. The [launch-influence pass](review/2026-09-20/launch-influence/README.md)
adds LSI after DI, with measured trajectories and KO boundaries. The
[September 21 tilt pass](review/2026-09-21/tilt-launches/README.md) converts Link's
up/down tilts and position-based up-tilt direction. The
[neutral-air/dash pass](review/2026-09-21/nair-dash-launches/README.md) converts both
neutral-air strengths and dash attack, preserving hit-group deduplication. The
[down-air pass](review/2026-09-21/down-air-launches/README.md) converts the
early meteor, grounded response, late strike and returning launch while retaining
the rebound lifecycle. The [forward-smash pass](review/2026-09-21/forward-smash-launches/README.md)
adds explicit damage-only charge, distinct inner/tip launches and the second
slash's reference record, retaining charge inheritance as project policy.
The [down-smash pass](review/2026-09-21/down-smash-launches/README.md)
adds distinct front/back launch records, position-based direction and charged
damage for both sweeps. The [up-smash pass](review/2026-09-22/up-smash-launches/README.md)
adds fixed-knockback, set-weight and reaction-frame contracts, source linking
launches and an ordinary finisher. The
[forward/back aerial pass](review/2026-09-22/fair-bair-launches/README.md) converts
both back-air strikes and forward air's finisher. After the combined pass,
only the outer/middle airborne regions of forward air's first hit retain the
documented approximation pending verified angle-367 behavior.
The [jab pass](review/2026-09-22/jab-launches/README.md) converts all
three stages, projects reach from selected source hitboxes, verifies real
chain inputs and fixes whole-frame Lab edits and multi-opponent staling.
The latest [combined mechanics pass](review/2026-09-22/combat-parity/README.md)
implements the requested five areas together: special/projectile launches,
normal variants, capsule collision and source priority, defense timing, and
shared damage/hitlag/SDI rules. Its evidence distinguishes verified records
from native algorithms still requiring research. Grab/throw records and
remaining roster values are separate follow-ups.

The [September 23 playtest repair](review/2026-09-23/playtest-input-repair/README.md)
replaces device reassignment in Controls with reusable named binding profiles.
It covers sparse player/controller ownership, capture and Confirm feedback,
mouse interference, consistent bomb effects and doubled item availability.
The reported preview-to-match skin mismatch remains open pending reproduction.
The [connected-controller refactor](review/2026-09-23/controller-boundary/README.md)
centralizes live controller filtering and physical-index lookup across the
affected scene paths and clears stale menu input after missed disconnect events.
The current [per-player Controls milestone](review/2026-09-23/player-controls/README.md)
keeps character selection active while players edit isolated binding drafts.
The complete suite passes **375 files / 11,304 tests**; TypeScript/build and
**13 production browser checks** pass on `index-DH_JqEPY.js`.

## Product Direction

Finish the gameplay rework first on `rework/gameplay`. The user wants closely
matching Smash Bros mechanics; there is no requirement to invent mechanical
differences for originality. Use Ultimate as the working reference, consistent
with the earlier parity plan, and identify any version-specific exceptions.
Do not mix Ultimate, Melee, and Brawlhalla behavior without an explicit reason.

User priority update: replay playback is **ultralow priority**. Preserve existing
recording support, but do not gate gameplay, physics calibration, CPU behavior,
Link's kit, animation, presentation or playtesting on a playback feature.

Control ownership: making P1 a CPU must not give P1's keys to P2. Defaults
follow the keyboard layout or physical controller used to join. Reusable named
profiles change bindings without transferring controller ownership. The current
[playtest repair](review/2026-09-23/playtest-input-repair/README.md) supersedes the
older slot-based device selector and expands the CPU-first checks to empty P1
and nonzero browser controller indices.

Approved local Controls design: character selection supports up to four
independent player editors. A joined controller opens its own editor with X or
its own card's Controls action; mouse editing belongs to keyboard players.
Other controllers continue selecting fighters or editing their own controls.
Named profiles contain reusable mappings, with no device or gamepad-number
selector. Editing a shared profile saves a copy. Done saves, Cancel discards,
and a match cannot start while any editor is open. The standalone MainMenu/Pause
profile library remains available. See the
[current handoff](review/2026-09-23/player-controls/README.md) for input ownership,
capture and temporary disconnect policy.

Retain the current Phaser/Matter renderer and fixed 60 Hz simulation while
fixing combat correctness, controls, and gameplay feel. Link's latest runtime
art remains the visual reference, with room to improve. Limit current visual
work to readability and animation that communicates actual move timing.

Real 3D presentation is deferred. The [3D Rework Plan](3D-REWORK-PLAN.md) is a
future option, not the active execution plan. Mechanics, frame data, and input
contracts can survive a later renderer change; Phaser scene coupling still
needs assessment then. No 3D installations or model generation are needed now.

Treat existing tests and earlier AI-written checklists as evidence to inspect,
not proof of Smash parity. A mechanic is complete only when the actual input,
state transitions, collision, damage, movement, and feedback work together.

Code-quality preference: refactor fragile existing code when it makes ownership,
state and lifecycle rules simpler. The user explicitly supports replacing earlier
implementations when warranted; authorship is not a reason to retain a design.

## Status

| Milestone | Status | Deliverable |
|---|---|---|
| 1. Audit and baseline | Full review complete; implementation gaps documented | Runtime probes, screenshots, source review, and prioritized acceptance criteria |
| 2. Navigation and character lab | Session/navigation repair, reusable input profiles, all 13 live-kit baselines, per-player saved tunes and local per-player Controls implemented and verified | Device ownership independent of bindings, isolated player drafts and shared-profile copies, retained Lab drafts/history, exact constructor-kit save/load, immutable tune snapshots through matches/restarts |
| 3. Combat contract fixes | Reference launch/DI/LSI, capsule collision, weighted staling, rage, hitlag/SDI and measured Link defense implemented; native autolink, complete dodge/ledge rules and remaining roster calibration remain | Source records and documented adapters, grouped launch collision/KO checks, shield-release parries, ledge-regrab protection, independent formula oracles and production input/physics verification |
| 4. Presentation | Grouped HUD and roster readability implemented; large art pass deferred | Player identity/damage/stocks cards, central rules/timer, larger roster tiles, projectile geometry aligned with art |
| 5. Animation pipeline | Simulation-driven strike poses, facing and feedback implemented | Poses, trails and debug geometry follow actual strike windows and hitlag; clean new art and 3D deferred |
| 6. Content and balance pass | Live CPU tiers, audited Link normal variants and supported special/projectile launches implemented; grab/throw records, detailed parity and roster balance remain | Capsule-selected inward jab tips and fair regions, charged spin, phased boomerang, reference arrows/bombs, down-air rebound, authored defense profiles and Lab geometry previews |

## Baseline

Verified on 2026-09-07 with Node 20.20.2:

- `npm run typecheck`: pass
- `npm test`: 294 files, 9,824 tests passed
- `npm run build`: pass
- Production bundle: game 726.17 kB gzip 177.67 kB; Phaser 1,478.61 kB gzip 339.72 kB
- npm audit: 6 reported vulnerabilities (2 moderate, 3 high, 1 critical), not yet triaged

The default shell currently exposes Node 18. Use Node 20 via `.nvmrc` or run
commands in this environment with `npx -y -p node@20 -c '<command>'`.

## Historical Baseline Findings (2026-09-07)

Some findings below were fixed by the milestone logs. Use the current review
and execution order for outstanding work.

### Menu And Editor

- The main menu hides tools behind undocumented single-letter shortcuts instead
  of presenting navigable choices.
- The stage builder is registered but has no main-menu route.
- The character editor only edits movement and body dimensions with the keyboard.
- Move data is already serializable, including damage, startup/active/recovery,
  hitboxes, knockback, aerial landing lag, grabs, throws, and specials, but the
  editor exposes none of it.
- The editor seeds Wolf and can only load localStorage saves, not the shipped
  roster. Saved characters are not consumed by Character Select or MatchScene.
- Saving does not repaint the dirty marker until a later UI refresh.
- Sprite preview supports only Wolf and Cat and does not explicitly select an
  idle frame.
- Sparse player slots such as P1 + P3 are mis-spawned by MatchScene.

### Combat

- The production shield/dodge input contract makes rolls and spot dodges
  unreachable even though direct-state unit tests pass.
- Mirror matches resolve attack ownership by character ID rather than unique
  body/slot identity, corrupting hitlag, stale-move, grab, rage, and stat data.
- Authored hurtboxes and sweet-spot geometry are not used by production collision
  resolution.
- Attacker hitlag deletes aerial momentum instead of restoring it.
- Matter gravity runs after the fighter terminal-velocity clamp, allowing natural
  fall speed to exceed the authored cap.
- Shield and dodge can cancel committed attacks without explicit cancel windows.
- Launch speed does not decay during hitstun, forcing non-canonical global
  knockback tempering.

### Rendering And Art

- The renderer is Phaser Scene2D. Real 3D would require a renderer and asset
  pipeline change; the extent of reusable simulation code needs assessment.
- Existing parallax, camera, stage layout, animation-key, visual-scale, and
  deterministic FX systems are good foundations for faux 2.5D.
- Platforms and hazards are mostly flat rectangles; the HUD still exposes debug
  scaffolding and hard-coded fighter labels.
- Four concept stage images and thirteen portraits exist but are not loaded by
  the runtime.
- Four fighters have broad per-move animation packs; most others reuse one attack
  strip for nearly every move.
- Some generated HD strips retain visible chroma backgrounds. The dedicated
  background-removal tool is better than the packer's current keying step.
- Phaser animation FPS is not tied to the deterministic simulation frame, so
  replay visuals can drift even when gameplay does not.
- All fighter assets preload before the menu; higher-resolution art needs staged
  loading or atlases.

## Initial Critical Review (2026-09-09)

This first pass is retained for context. The subsequent
[full review](REWORK-REVIEW-2026-09-09.md) supersedes it where runtime checks
refined a finding. The jumpsquat test work described below has been completed.

The earlier plan spread effort across editor expansion, combat patches, and
presentation before validating their runtime interactions. Its useful collision
and input fixes should stay, but a completed checkbox or a large test count
must not substitute for playable, measured behavior.

Confirmed in current code:

- **Grab versus shield:** a captured fighter kept an active shield; pummels and
  normal throws then passed through the blockable hit path. Fixed in this
  session with capture, pummel, and four-direction throw regressions.
- **Action commitment is inconsistent:** ordinary grab can start during an
  attack or dodge, and the defensive gate does not account for grab commitment.
  Audit transitions as one contract, preserving deliberately allowed cancels.
- **Hitlag is not a complete physics freeze:** the Character path zeroes
  velocity but the subsequent Matter step still applies gravity. Verify a
  stationary airborne hitlag interval with real physics, preserving permitted
  SDI and the momentum restored on release.
- **Collision and launch decay disagree:** the tracked launch vector is not
  reconciled after collision changes actual velocity. A stopped horizontal
  launch can acquire reverse velocity on the next decay step. Add real wall,
  floor, and ceiling cases before changing the decay model.
- **Replay capture is incomplete:** `InputCaptureBuffer.normaliseInput()` and
  `ReplayFile` persist movement, jump, light attack, and drop-through only.
  Heavy attack, special, shield, dodge, and grab inputs are discarded. Passing
  replay component tests does not demonstrate a reproducible combat match.
- **Calibration is provisional:** the `0.09` knockback temper was justified
  before launch decay existed; the later `0.34` decay was chosen from a ratio
  under custom units. Their combination has not been demonstrated to reproduce
  Ultimate launch trajectories or combo windows. Do not claim numeric parity
  or change isolated multipliers without a coherent units model and measurements.
- **Jump integration had unfinished tests:** 19 aggregate failures still
  expected same-frame takeoff. Update them to assert input recognition on the
  press frame and takeoff after three preparation frames, preserving air-jump
  immediacy, player isolation, and SFX timing.
- **Authoring coverage is incomplete:** the lab exposes ten JSON-backed
  fighters and does not include Link's compiled kit. Sparse player slots and
  saved tunes in normal character selection remain unfinished.
- **Narrow viewport readability remains weak:** the desktop layout fits through
  scaling and letterboxing, but text and fighters are very small in portrait.
  A passing navigation smoke test is not mobile usability approval.

Exact DI/LSI rules, held-input buffering, defense timing, and fighter values
still need verified references. Do not promote speculative differences to bugs.

## Current Execution Order

The current focus is step 4. The latest handoff is the
[combined mechanics record](review/2026-09-22/combat-parity/README.md), covering
all five requested areas in one integration pass. Link's inward jab tips and
ordinary forward-air variants now have distinct source records and capsule
selection. Specials, defense, weighted staling, rage, hitlag and SDI use the
documented evidence described there. Native autolink behavior, animated bone
transforms, full dodge kinetics/landing and ledge timing remain explicit gaps.
Grab/throw records and release timing remain a separate next kit audit.
Earlier session, combat and authoring repairs are recorded in the milestone
logs; the ordered product priorities remain:

1. **Make the match session trustworthy.** Wire selected stock/time rules into
   live gameplay; preserve participant/device identity and sparse slots. Complete
   keyboard, mouse, and gamepad menu journeys, restart, and Controls return.
2. **Make combat and physics consistent.** Fix grab/attack/defense overlap,
   hitlag body/pose freeze, launch collision response, ledge recovery, and jump
   buffering. Exercise real Matter steps and production input. Work on this can
   run alongside session fixes; avoid spreading balance work across the roster.
3. **Use the repaired tuning loop.** Lab sessions, Link/full-roster authoring,
   saved tunes and match snapshots are implemented. Use direct fixed-step trace
   measurements to diagnose gameplay; replay playback is not a prerequisite.
4. **Calibrate the mechanics and one convincing kit.** Define reference units;
   measure movement, landing, hitstun, launch/DI, and KO thresholds together.
   Implement Link's intended projectile/recovery behavior instead of forcing
   it into approximate schemas. Verify advanced defense and ledge rules against
   the selected Smash version. Start on the flat arena with contrasting opponents.
5. **Polish presentation for play.** Drive visible poses from simulation frames;
   finish one stage, coherent HUD, and hit feedback. Fix menu clipping and input
   glyphs, stage loading, and supported-viewport readability. Keep Link's latest
   art as the reference; additional assets follow demonstrated needs.
6. **Expand proven behavior.** Complete stronger CPU integration, remaining
   fighters, dynamic-stage collision/riders/ledges, four-player coverage,
   authoring. Replay playback is an ultralow-priority later task. New 3D work waits
   until the current game is convincing and repeatable.

For authored fighter timings, record the source and the frame-count convention.
[Link's Ultimate Frame Data](https://ultimateframedata.com/link) provides a
starting reference for moves, hitbox timing, landing behavior, grabs, and
defensive actions. It is not by itself a specification for the physics engine.

Each mechanical fix needs a before/after scenario and a regression that fails
before the fix. Each tuning change needs a reproducible measurement. Preserve
determinism deliberately, and mark old replays incompatible when rules change
rather than treating an input-schema version as a simulation-version guarantee.

## Earlier Milestone Breakdown

The following retains the original deliverables for context. The current
execution order above takes precedence.

### Milestone 2: Navigation And Character Lab

1. Replace the title-screen hotkey wall with keyboard/gamepad navigable cards for
   Fight, Character Lab, Stage Builder, and Controls.
2. Load shipped character data directly in the lab and provide roster/slot
   selection without browser prompts.
3. Add tabs for identity, movement, body, normals, aerials, and specials.
4. Edit move damage, startup/active/recovery/cooldown frames, knockback, hitbox,
   aerial landing lag, and family-specific properties through schema-aware rows.
5. Render a move timeline and body/hitbox preview, including facing and active
   frames.
6. Add save, duplicate, delete, import/export, dirty-exit confirmation, and a
   test-fight path.
7. Connect saved specs to the match runtime instead of keeping them isolated in
   localStorage.

### Milestone 3: Combat Contract Fixes

1. Add integration tests spanning real input resolution through `Character`.
2. Fix shield/dodge arbitration and prevent implicit attack cancellation.
3. Carry unique owner identity through hit context and mirror-match resolution.
4. Restore attacker velocity after hitlag and clamp velocity after Matter steps.
5. Route authored hurtbox/sweet-spot geometry through collision resolution.
6. Add a proper jumpsquat/general action buffer and launch-speed decay only after
   deterministic replay fixtures are updated deliberately.

### Milestone 4: 2.5D Vertical Slice

1. Extend background themes to support full-image far, mid, and foreground
   layers with camera-relative parallax.
2. Derive top face, front extrusion, rim light, and contact shadow from existing
   authoritative platform rectangles. Physics remains unchanged.
3. Upgrade one stage's hazard surface and atmosphere as the quality target.
4. Replace engineering HUD text with portraits, stocks, percent hierarchy, and
   off-screen indicators; keep diagnostics behind a debug toggle.
5. Validate Canvas fallback, WebGL, 16:9 desktop, and narrow/mobile viewport fit.

### Milestone 5: Animation Pipeline

1. Route generated frames through the dedicated chroma-removal/despill tool.
2. Add clip validation for alpha contamination, frame bounds, foot anchoring,
   silhouette stability, and source-to-strip metadata.
3. Make displayed sprite frame a pure function of simulation action/frame.
4. Add clip/frame preview and frame-event markers to Character Lab.
5. Finish move-specific clips before generating costume palettes.

## Verification Gate

Every implementation milestone must pass:

```text
npm run typecheck
npm test
npm run build
```

Menu, editor, and rendering milestones additionally require a browser smoke test
at desktop and narrow viewport sizes. Combat milestones require at least one new
end-to-end contract test rather than only isolated reducer/state tests.

## Milestone Log

### 2026-09-09: Team implementation after the full review

Three parallel contributors owned combat/replay, menu/device handoff, and
editor/platform lifecycle. The coordinator integrated live rules and scene
behavior. Cross-reviews found additional landing-recovery cancellation,
capture-state leaks, reconnect metadata loss, unused controller bindings,
inconsistent player labels, stale moving-ledges, and moving-surface landing
history; these were corrected before acceptance.

Implemented:

- Stock matches use the selected count. Time matches respawn without exhausting
  stocks, score KOs minus falls, finish on the simulation timer, and send only
  tied leaders into one-stock, 300% sudden death with a clean round state.
- Sparse lobby identities map to contiguous simulation slots. Physical pad
  indices and chosen binding profiles survive handoff/reconnect/rematch;
  unused slots cannot cause phantom disconnect pauses. HUD/Results labels
  retain the original lobby number.
- Keyboard and pointer rule selection, scrolling stage previews, keyboard
  roster picking, CPU setup, clickable Ready, controller Results focus, and
  resumable Pause → Controls are connected to the live scene.
- Menu key events are claimed once across scene transitions, preventing the
  duplicate actions found by the browser journey. Modal and pause ownership
  determine which scene can consume each event.
- Character Lab retains draft/history/selection across Test, restart and Back.
  Restart and Results preserve full test overrides and Lab routing. Stage Forge
  retains placed pieces/history and shares Back cancellation across inputs.
- Attack/grab/defense commitment, landing recovery, shieldstun jump buffering,
  simultaneous jump/attack, helpless transitions, and capture cleanup are fixed.
  Real Matter post-step reconciliation pins hitlag and prevents collision-induced
  reverse launch acceleration. Sprites freeze during hitlag and menu pause.
- Moving platform bodies carry supported riders once per simulation step.
  Depth pieces and ledges read those bodies; hanging/climbing fighters follow
  moving ledges. Landing detection retains the previous platform surface.
  MatchScene now calls the stage's rendering refresh, which was previously
  disconnected despite the renderer's component tests passing.
- Replay v4 retains every CharacterInput action. Strict validation rejects
  incomplete v4 inputs; older files migrate missing channels to neutral with
  the explicit limitation that lost actions cannot be reconstructed. Recordings
  include a SHA-256 digest of source, character content, configuration and lockfile,
  including uncommitted changes.

Production build/typecheck passed. Final aggregate and browser verification is
recorded in [the implementation report](REWORK-IMPLEMENTATION-2026-09-09.md).
The original review remains a historical before-state, not a current bug list.

The following authoring batch completes Link and saved-tune integration. The
user subsequently deprioritized playback: next calibrate movement/launch/defense
together using direct frame-step traces. Full simulation-driven sprite
timing, stronger live CPU behavior, Link kit completion, visual polish, and
human/controller playtesting remain open. This batch does not establish exact
Ultimate numerical parity or complete the entire overhaul.

### 2026-09-09: Full roster authoring and playable saved tunes

Three parallel contributors handled the authorable roster/schema, Lab navigation,
and saved-tune selection. The coordinator integrated immutable match snapshots
and replay v5. Contributors independently reviewed each other's changes.

- Fresh Lab sessions start with Link and its current idle artwork. All thirteen
  fighters are available through paginated roster selection; saved tune names
  wrap and paginate. Existing drafts/history survive navigation and Test Fight.
- Link, Kirby, and Donkey Kong authoring derives from their current compiled
  kits, retaining chain jabs, directional aerials/smashes, dash attacks and
  fighter-specific move properties. The ten existing JSON baselines remain;
  their numerical parity with compiled kits has not been established.
- Each occupied character-select slot can cycle compatible saved tunes with
  T/Shift+T, controller Y, or its clickable tune row. Fighter changes clear an
  incompatible tune; palette/device changes retain the choice. Removing a CPU
  clears controller edit ownership before another player can use that slot.
- Selection captures a validated, deeply frozen spec. Stage Back, launch,
  restart and rematch carry that snapshot; storage edits/deletion cannot silently
  change a selected fighter. Four copies of a fighter can have independent kits.
- Canonical match initialization retains authored specs, participant identities,
  physical devices, profiles and item rules. Device descriptors are copied too.
- Replay v5 persists complete authored specs and that metadata alongside v4's
  complete input channels. Older files migrate without inventing absent tune
  data. Capture support does not establish working live playback or determinism.

Verification and browser evidence are recorded in
[the implementation report](REWORK-IMPLEMENTATION-2026-09-09.md).

### 2026-09-07: Milestone 2, Slice A

- Replaced hidden main-menu shortcuts with selectable Versus, Character Lab,
  Stage Forge, and Controls cards.
- Enabled pointer and touch input for menu/authoring scenes; combat remains
  pointer-independent.
- Character Lab now loads all ten data-backed shipped fighters and saved tune
  slots.
- Added schema-driven numeric editing for movement, body geometry, normals,
  aerials, specials, grabs, throws, frame phases, knockback, and hitboxes.
- Added live sprite, hurtbox/hitbox, and startup/active/recovery timeline views.
- Added bounded values, undo/redo, save, duplicate, delete, and JSON export.
- Added a persistence validation gate so invalid cross-field combinations never
  create an unloadable localStorage record.
- Added Test Fight. The current unsaved spec is validated, applied to P1 at
  construction, and its authored moves replace compiled records. Lab fights do
  not record misleading replay files because the current replay schema does not
  yet embed custom character data.
- Browser proof: changed `wolf.jab.damage` from 6 to 6.5, launched MatchScene,
  and read 6.5 back from the live P1 move registry with no console/page errors.
- Remaining in Milestone 2: import UI, identity editing, animation-clip/frame
  authoring, custom tune selection in normal Character Select, and sparse-slot
  spawning repair.

### 2026-09-07: Milestone 4, Slice A

- Added theme-specific platform materials for midnight, lava, wind, temple, and
  sky stages.
- Added render-only front faces, top rims, and drop shadows derived from each
  platform rectangle. Matter bodies and authored collision geometry are
  unchanged.
- Depth decorations follow the existing deterministic platform visual state and
  are destroyed with the stage lifecycle.
- Added grounded/airborne-responsive contact shadows for every fighter slot.
- Engineering overlays (FPS, simulation frame, camera state, fighter internals,
  spawn markers, controls dump, seed, and F3 hint) are now hidden by default.
  Append `?debug=1` to retain the diagnostic view; pressing F3 still reveals
  hitbox debug state.
- Replaced the missing-glyph speaker emoji with a compact `AUDIO ON` / `MUTED`
  control.
- Browser proof: Character Lab Test Fight reached an active MatchScene with four
  platform depth sets, two fighter shadows, debug HUD disabled, and no console
  or page errors.
- Production build passes. The aggregate suite reached 9,831 passing tests;
  both menu compatibility failures and the Stage Builder timeout passed on
  isolated rerun. The pre-existing Medium AI stress test passes logically with
  `--testTimeout 20000` (9.4 s on this NTFS mount) but exceeds Vitest's default
  5 s budget in the current slow filesystem environment.

### 2026-09-07: Milestone 3, Slice A

- Added a production-chain contract test spanning live bindings,
  `DeviceInputDispatcher`, `InputResolver`, `CharacterInput`, and
  `Character.applyInput`.
- Fixed defensive arbitration: `shield + direction` starts a roll/spot-dodge
  instead of raising shield and suppressing dodge. Adding direction to an
  existing shield also rolls when shieldstun is clear.
- A fresh airborne shield press now starts a neutral air-dodge; directional
  shield input keeps the existing directional burst.
- The persisted `taunt` binding is now the backwards-compatible direct Dodge
  slot (R / Numpad 5 / gamepad B by default) and is labeled `Dodge` in the
  rebinding UI. Existing saved profiles remain valid.
- Shield and dodge are rejected throughout an attack's authored
  startup/active/recovery commitment instead of deleting the move and cooldown.
- Hit contexts now resolve `attackerPlayerIndex` from the unique Matter body ID.
  Mirror matches therefore attribute grabs, rage, stale-move queues, hitlag,
  stats, inventory SFX, and hit sparks to the correct fighter instance.
- Attacker hitlag captures pre-freeze velocity once and restores it on release.
  Incoming defender knockback takes priority and discards saved momentum.
- Added a post-Matter velocity constraint phase. It removes gravity added above
  normal/fast-fall terminal speed but preserves velocity that was already above
  terminal before the step due to hazards or scripted specials.
- Verification at slice checkpoint: TypeScript and production build pass; 610
  focused combat/input tests pass. The aggregate run reached 9,847/9,848 before
  exposing one mixed-rebind conflict (Jump shared the legacy Dodge key); that
  conflict was fixed and all 190 affected input/rebinding tests pass on rerun.
- Remaining in Milestone 3: geometric hurtbox/sweet-spot collision, explicit
  hit outcomes, launch-speed decay, general input buffer/jumpsquat, and
  wall/ceiling techs.

### 2026-09-08: Milestone 3, Slice B

- Hitbox sensors now test their real Matter AABB against each active authored
  hurtbox instead of treating overlap with the broad character body as a hit.
- Crouch/per-move hurtbox offsets and dimensions now affect live collision.
  Broad-body contacts that miss every authored hurtbox are rejected.
- Intangibility and hurtbox damage multipliers apply only to the regions the
  sensor actually touched; an intangible limb no longer protects a separate
  tangible body region.
- Hitbox plugins now carry parent and sweet-spot geometry. Sweet-region overlap
  applies authored damage and knockback multipliers plus the existing bonus
  hitlag flag. Aegis and Blaze spacing identities are therefore live mechanics,
  not data-only declarations.
- Added `Character.applyHitDetailed()` with explicit `landed`, `shielded`,
  `parried`, `invincible`, `dodged`, `ledge-invincible`, `armored`, and
  `destroyed` outcomes while preserving the original `applyHit()` API.
- Rejected outcomes no longer consume hitbox lifetime, stale the move, add
  damage stats, arm attacker hitlag, play flesh-hit audio, or spawn hit sparks.
  Shield/parry/landed outcomes consume the contact; only landed damage is
  credited.
- MatchScene now retries unconfirmed contacts on Matter `collisionactive`, so a
  still-overlapping active hitbox can connect on the first vulnerable frame
  after dodge/ledge/armor invulnerability ends. Confirmed contacts remain
  suppressed by the existing per-hitbox/per-target registry.
- Verification: TypeScript pass; 555 focused collision, fighter, sweet-spot,
  and stats tests pass; full suite passes (295 files, 9,858 tests); production
  build passes.
- Remaining in Milestone 3: launch-speed decay, general input buffer/jumpsquat,
  wall/ceiling techs, shield-poke geometry, and balance calibration.

### 2026-09-08: Milestone 3, Slice C

- Sourced launch physics from SmashWiki: launch speed is knockback × 0.03 and
  decays by 0.051 per frame; Ultimate uses a 0.4× knockback hitstun baseline
  plus balloon-knockback acceleration for long launches.
- Added a unit-normalized `LAUNCH_SPEED_DECAY_PER_FRAME = 0.34`. With this
  engine's `2.0 × velocity` hitstun relation, it removes the same approximate
  68% of launch momentum over a typical stun window as the sourced model.
- Launch velocity is tracked separately from Matter gravity. Decay preserves
  launch angle while gravity, collisions, wind, and other residual velocity
  continue independently.
- Added the Ultimate-standard 9-frame offensive buffer for light, heavy, and
  special presses. Delayed inputs retain stick direction and facing, expire
  deterministically, and execute once the fighter is fully free.
- Simultaneous buffered actions use `special > heavy > attack` priority, but
  only among actions the fighter actually has. This preserves arbitrary
  rebinding when one physical button maps to multiple logical actions.
- Immediate presses retain the existing directional-leniency history; jab-chain
  presses remain chain inputs and do not leak into a later extra attack.
- Verification: TypeScript and production build pass; 488 focused tests passed;
  aggregate run reached 9,863/9,864 and exposed one mixed-rebind priority issue,
  which was fixed and all 503 affected tests pass on rerun.
- Remaining in Milestone 3: universal 3-frame jumpsquat, jump/defense buffering,
  wall/ceiling techs, shield-poke geometry, and post-decay KO calibration.

### 2026-09-08: Milestone 3, Slice D (Paused At Safe Checkpoint)

- Added the sourced universal 3-frame grounded jumpsquat; air jumps remain
  immediate.
- Added a 9-frame jump input buffer and exposed jumpsquat frames for runtime
  inspection.
- Releasing jump during squat selects short-hop before takeoff.
- An attack pressed during squat is retained by the offensive buffer and fires
  as a short-hop aerial on takeoff rather than a grounded attack.
- Updated the affected Character contracts from same-frame takeoff to explicit
  squat timing.
- Safe-stop verification: TypeScript passes, 489 focused Character/combat tests
  pass, and `git diff --check` passes.
- Not yet run after Slice D: aggregate suite, production build, browser smoke,
  replay/AI integration checks, and roadmap status promotion to complete.

### 2026-09-09: 3D Rework Branch And Asset Direction

- Created and switched to `rework/3d-link` from `main` at `26e6e3f`, preserving
  all existing uncommitted overhaul work. No commit or push performed.
- User identified the latest Link art as the current visual standard, with
  improvements still needed. Inspected its runtime idle and jab strips and HD
  clip description; these are 2D reference assets, not an existing 3D mesh.
- Recorded a local asset workflow and 3D prototype gates in `3D-REWORK-PLAN.md`.
- Verified current hardware: RTX 4070 Laptop GPU, 8,188 MiB VRAM; Ubuntu WSL2
  is installed. Older notes describing a 5070 Ti refer to a different setup.
- Documentation and branch setup only this session. No runtime edits,
  installations, model downloads, generation, or new test results.

### 2026-09-09: Mechanics First, Critical Review, And Validated Checkpoint

- User deferred 3D and clarified that closely matching Smash mechanics is the
  objective. Created `rework/gameplay`, preserving all existing local work;
  retained the 3D proposal as deferred. No commit or push performed.
- Reordered the roadmap around runtime correctness, complete combat capture,
  coherent physics calibration, then authoring and presentation. The review
  above distinguishes current bugs from unverified parity assumptions.
- Fixed capture retaining an active shield: pummels and all four normal throw
  directions now damage a captured shielding fighter. Shield HP is preserved;
  capture also clears shieldstun. Seven regression cases cover this behavior;
  pummel and four throw cases failed before the runtime fix.
- Completed the paused jumpsquat integration tests in Fighter, roster, sound,
  and mixed keyboard/gamepad input suites. Tests assert immediate recognition,
  three preparation frames, delayed takeoff, per-player isolation, and jump SFX
  on the impulse frame. Air jumps retain their immediate contract.
- Verification with Node 20.20.2 in Ubuntu WSL2:
  - `npm run typecheck`: pass.
  - `npm test`: 295 files, 9,872 tests passed.
  - `npm run build`: pass (also runs TypeScript); game bundle 756.59 kB,
    gzip 186.77 kB.
  - `git diff --check`: pass.
- Browser smoke at 1280x720 and 390x844: keyboard navigation reached Character
  Lab and Test Fight; no page errors; two fighters spawned; lab recording stayed
  disabled. Actual Matter steps preserved jump preparation counts 3, 2, 1, 0
  and jump consumption 0, 0, 0, 1, with upward velocity on takeoff.
- Browser test accounts for the existing local preview password gate in an
  isolated browser context. Initial harness timeout was the unhandled gate,
  not a loading failure. Narrow portrait readability remains a documented UX
  limitation.
- Full suite includes AI and replay component tests. Complete combat replay and
  seek correctness are NOT validated: current capture discards combat actions
  as documented above. Slice D's old pending-test note is superseded by these
  results, but the combat milestone remains in progress.
- Next implementation: consistent grab/attack/defense commitment, real hitlag
  freeze, and collision-aware launch decay, followed by complete combat input
  recording. Do not promote the current knockback approximation to parity.

### 2026-09-09: Full Gameplay, Physics, Menus, Tools, And Presentation Review

- Added `REWORK-REVIEW-2026-09-09.md` and reproducible review artifacts under
  `docs/review/2026-09-09`. Review only; no new runtime fixes in this pass.
- Confirmed with real Character/Matter probes: overlapping action states,
  gravity during hitlag, reverse acceleration after wall collision, inconsistent
  Jump+Attack hop height, dropped combat replay inputs, and wrong sparse-slot
  roster. Live Time/five-stock config still produced three-stock gameplay.
- Confirmed animation progresses while combat simulation is frozen. Moving
  platforms remained stationary; rendering and motion components are not wired
  through a complete live collision/rider/ledge contract.
- Lab run-speed tuning 10 reverted to 7.5 on Pause Restart; lab overrides and
  recording suppression were dropped. Reopening the Lab through the normal
  Results/Main Menu route threw a destroyed-text `drawImage` error. This extends
  the earlier smoke test, which covered first entry only.
- Inspected desktop menu, roster, lab, controls, forge, match, pause and results
  screenshots, plus portrait and small-landscape matches. Documented truncated
  labels, overlapping Controls actions, missing gamepad glyphs, and weak narrow
  readability. No physical-controller or audio-listening acceptance claimed.
- Ordinary pointer and keyboard rematches both preserved the standard config;
  withdrew the initial pointer-reset suspicion after checking Phaser's retained
  scene data. Lab-specific explicit restart payload loss remains confirmed.
- Fresh local production load: 195 resource requests, about 25.3 MB transferred,
  188 textures, approximately 143 MB source RGBA pixels. This is diagnostic
  loading evidence, not a representative GPU or network benchmark.
- Source review also identified controller handoff loss, missing per-device menu
  actions, incomplete recovery resets, and unwired CPU/replay/time components.
- Existing full suite/build baseline remains 9,872 passing tests; it was not
  rerun for this documentation pass. New targeted probes intentionally record
  the defects above, including the Lab re-entry failure.
- Current execution order now prioritizes live rules/participants alongside
  combat contracts, followed by a dependable tuning/reproduction loop. No
  commit, push, 3D installation, or model generation performed.

### 2026-09-09: Gameplay, CPU, presentation and full live-kit authoring

- User priority: replay playback is ultralow; 3D remains deferred.
- Fixed recovery resources, successful-action tumble clearing, hitlag tech edges,
  live ground contacts and placed-object lifecycles. Added sourced Ultimate DI
  rules and real trajectory measurements without claiming full numeric parity.
- Implemented Link's charged bow, returning boomerang, grounded/aerial spin and
  remote bomb. Corrected projectile travel-order collision, reflection ownership,
  and physical coordinates for projectiles/traps/items on scaled/moving stages.
- Wired actual Easy/Medium/Hard CPUs into live matches, including sparse mirror
  opponents, navigation/recovery, hit confirmation and respawn resets.
- Fighter poses now follow simulation action timing. Grouped HUD cards and a
  reserved camera area keep identity, damage, stocks and fighters readable.
  Enlarged roster tiles and wrapped labels remove desktop name clipping.
- Replaced the ten stale editor baselines with complete live compiled kits.
  All thirteen preserve constructor-registered moves, tuning/body, grabs and
  dispatch through save/load, including legacy neutral airs and sweet spots.
- Final verification: 313 files / 10,188 tests passed, TypeScript/production
  build passed, eight browser harnesses passed with zero page errors, and
  diff whitespace checking passed. Detailed evidence and limitations are in
  [the implementation record](REWORK-IMPLEMENTATION-2026-09-09.md).
- Remaining active acceptance: human gameplay/balance and controller/audio tests,
  coherent global unit calibration, detailed Link/roster parity and comfortable
  narrow-screen play. Existing animation art still limits pose detail.

### 2026-09-09: Link attacks, landing, movement and item integration

- Normal/aerial timelines now follow the documented Ultimate targets. Added
  separate strikes, early/late hit strengths, rear down smash, optional charged
  forward-smash follow-up, correct jab openings and air-only early down-air meteor.
- Landing penalties resolve before action arbitration and last the authored
  number of steps. Fair's late landing flag survives action completion.
- Calibrated Link's full/short jump heights to 139/66.9 physical pixels, with
  jump/fast-fall durations within one step of the reference targets. Added
  explicit air speed and editor controls while preserving other profiles.
- Grounded Spin Attack charges for up to 60 extra frames. Bombs use the shared
  inventory for carrying, throws and pickups; remote ownership stays with Link.
- Browser review caught and fixed sensor gravity drift, stray trails during
  hit gaps, a player-order bomb throw delay and distant-owner hit-stop.
  Final production review also repaired floor contact after a same-position
  reset, with a failing-before real-Matter regression and 555 affected tests.
- Final aggregate: **318 files / 10,342 tests passed**; TypeScript and production
  build passed. Production browser evidence and remaining parity limits are in
  [the milestone record](review/2026-09-09/link-gameplay/README.md).
- Next gameplay review should target ordinary landing, air-jump/free-air-turn
  behavior, more precise move collision/linking, and human balance/feel. Keep
  replay playback and 3D deferred.

### 2026-09-14: Ordinary landing, air movement and combat integration

- Added Link's distinct 145 px air jump, preserved facing during free air drift,
  and corrected the ground/air jump budget after walking off, being launched,
  and releasing a ledge. Human and CPU ledge jumps now agree. Holding down
  declines a catch; an available jump takes precedence over a nearby ledge.
- Added ordinary soft/hard landing recovery and buffered first-free-step actions.
  Autocancel uses normal recovery; aerial penalties replace it. Item pickup
  and buffered remote-bomb throws now respect the pre-input landing boundary.
- Real Matter combat tests exposed and repaired falling fair losing its second
  hit and early bair/up-smash hits allowing premature jump/dodge escape.
  Authored motion carry and hitstun floors are engine calibrations, with SDI
  escape still possible at the edge; no exact Ultimate launch-formula claim.
- Preserved rising/falling trajectories through attacker hitlag. Resetting
  under a floating platform clears stale crossing history instead of snapping
  upward. Ordinary landing poses use the existing simulation timer.
- Exposed air-jump/landing fields in the Lab and save/load format, with a
  paging hint. The implementation record distinguishes sourced durations and
  heights from the unverified terminal-duration calibration.
- Verification and browser evidence are recorded in the
  [September 14 milestone](review/2026-09-14/README.md): **321 files / 10,429
  distinct tests verified across the aggregate run and its final fixture
  rerun**, production build and final TypeScript passed, four production
  browser harnesses passed with zero page errors. Next mechanics work:
  special/air-dodge landing, finer collision/launch calibration, down-air
  rebound and human controller/feel acceptance. Replay playback and 3D remain
  deferred.

### 2026-09-15: Special and air-dodge landing commitment

- Link's aerial Spin Attack now has 30 steps of landing recovery during the
  move and after it ends in helpless fall. Touchdown cancels its hitboxes;
  grounded Spin retains its own timeline.
- Link's neutral/directional air-dodge landings replace the airborne remainder
  with 10/19 steps, ending burst movement and invincibility. Directional 19 is
  provisional; the reference's timing-dependent 11–19 rule remains open.
- Landing respects buffered actions, held shield, item pre-input checks and
  hitlag. Capture clears completed special-fall helplessness; damage, ledges
  and reset clear retained commitments. Ledge catches restore air dodge.
- All new frame values survive save/load and are accessible in the Lab.
- Verification: **323 files / 10,475 distinct tests** across a passing aggregate
  and the separately discovered authoring file; TypeScript/build passed and
  production browser landing/Lab checks passed with zero page errors. See the
  [September 15 record](review/2026-09-15/README.md) for evidence and limits.
- Next: Link's down-air rebound, collision/launch calibration, precise dodge
  timing/travel and remaining roster landing values, then human acceptance.
  Replay playback and 3D remain deferred.

### 2026-09-15: Link down-air rebound

- Down air now bounces Link on damaging or shield contact, preserving the
  original move timeline and jump budget. Fast-falling suppresses the bounce.
  Hitlag holds the upward velocity until the impact pause ends.
- A bounce removes the hitbox for 30 advancing attack frames, then returns
  with an 11-damage strike and a fresh hit group. Frozen frames do not shorten
  the delay, and the original active window still limits late returns.
- Damage, capture, reset and ledge transitions cannot revive a queued rebound.
  Saved characters preserve optional rebound and return-hit data; the Lab
  exposes their numeric tuning fields.
- Reference scripts supply the 1.33-unit bound impulse and 11-damage return.
  The current 6.65 px/step rebound, rectangular sensor and launch vector still
  need trajectory/collision calibration; no complete original-status port is claimed.
- Production review also exposed solver-altered shield bounce speed. The
  impulse now commits after physics, preserving horizontal pushback and ceiling
  response; simultaneous damaging contact transfers it into outgoing hitlag.
- Verification: **325 files / 10,498 tests passed**, final TypeScript and build
  passed, and production hit/shield/whiff/fast-fall plus Lab browser checks
  passed with zero page errors. See the
  [rebound record](review/2026-09-15/rebound/README.md) for evidence and limits.
- Next: calibrate collision, launch, DI, hitstun and KO thresholds under one
  units model; refine directional dodge and the remaining roster. Human
  controller, sound and balance acceptance remains open. Replay playback and
  3D remain deferred.

### 2026-09-16: Launch measurements and gravity recovery

- Added five live-contact scenarios spanning damage, fighter weight, a wall
  and a ceiling. The real Matter fixture and production MatchScene agree
  across 141 sampled frames, including five steps after hitstun.
- The ceiling case exposed gravity-generated fall speed persisting above
  the ordinary cap after hitstun. The runtime now tracks the actual gravity
  contribution and removes only its excess before the first free action;
  ceiling recovery changes from 9.72222 to 8 px/step.
- Downward launch, velocity carry and wind remain distinct from that correction.
  Fresh actions, incoming damage, capture, resets and final-stun collisions have
  real physics coverage. Existing full-hitstun trajectories are preserved.
- Verification: **327 files / 10,515 tests passed**; TypeScript/build, production
  frame-by-frame comparison and the previous rebound browser regression passed
  with zero page errors. Whitespace checks passed. See the
  [September 16 record](review/2026-09-16/README.md).
- Next: author reference knockback base/growth/angle and weight separately
  from Matter mass, then migrate launch decay, hitstun, tumble timing/gravity
  and post-hitstun momentum as a measured model. Existing constants remain
  explicit calibrations; controller/audio/balance acceptance is still needed.

### 2026-09-16: Reference knockback for Link's measured strikes

- Forward tilt and early/late up air now use sourced base knockback, growth
  and angle, plus independent Link104/DK127 reference weight. Ordinary hitstun,
  tumble/DI eligibility and 0.255 px/step launch decay travel with each launch.
- Up air resolves horizontal direction from the opponent's side of Link.
  Existing sweet-spot, rage, stale and crouch modifiers reach the reference path.
  Other moves retain their previous model; unauthored weights currently use100.
- Save/load, custom construction and Lab controls preserve the new fields.
  Import rejects reference launches combined with unsupported charge interpolation.
- Verification: **331 files / 10,616 tests passed**, TypeScript/build passed,
  and production/physics comparison agrees across **349 frames** with zero page
  errors. Desktop/mobile Lab checks pass. The final six-test fixture rerun fixes
  grounded staging and matches Phaser's solver defaults; no runtime changes
  followed the aggregate. See the [latest handoff](review/2026-09-16/reference-knockback/README.md).
- Next: coordinate damage-energy momentum after hitstun, gravity launch boost,
  vertical tumble gravity and speed-up before converting more moves. Current
  hitlag/stale/rage and post-hitstun motion remain project calibrations.

### 2026-09-16: Launch momentum and gravity through recovery

- Reference launches now retain damage velocity beyond hitstun. Player drift
  acts on separate motion; gravity, carried velocity and wind remain distinct.
- Link/DK profiles supply native gravity, fall caps and vertical tumble values.
  Eligible launches receive gravity boost before DI. Release uses zero accumulated
  gravity; outgoing hitlag pauses and resumes the launch/gravity clocks together.
- Vertical tumble gravity approaches the profile's ordinary cap gradually after
  hitstun. Contacts reconcile gravity removed by ceiling impacts or wall friction.
  Ordinary aerials retain energy; explicit velocity-owning recovery actions clear
  stale bookkeeping. Collision/action transition rules remain project contracts.
- Save/load, older-file defaults, custom construction and Lab editing preserve
  all four profile values, six-decimal precision and undo/redo.
- Verification: aggregate **334 files / 10,663 tests passed**, followed by
  **131 focused tests passed** after the wall-friction fix and one new regression
  (**10,664 distinct tests verified**). Final TypeScript/build passed; production
  matches the physics fixtures across **356 frames**, with zero page/load errors.
  Desktop/mobile Lab controls, keyboard editing and undo pass. See the
  [latest handoff](review/2026-09-16/launch-energy/README.md).
- Next: implement virtual-frame tumble speed-up with coordinated displacement,
  gravity, decay and collision timing, then remeasure DI, hitstun and KO boundaries
  before extending the reference model to more strikes and fighters.

### 2026-09-20: Coordinated reference tumble speed-up

- Sourced reaction-clock groups now advance launch displacement, decay and
  authored gravity together. At 100%, measured forward-tilt hitstun changes
  from 65 to 44 frames for Link and 61 to 43 for DK; early up air changes
  from 64 to 44. Release tick zero remains part of the trajectory.
- A bounded physics coordinator checks intermediate contacts while retaining
  one outer input/rule/attack clock and one world timestep. Ordinary free-flight
  bodies preserve their positions and velocities; carried motion is not sped up.
- Hitlag resumes the next launch group. Collision callbacks read canonical
  velocity; solver-stopped normals remain stopped with external carry. Lava and
  blast-zone crossings are observed between segments, while wind and landing
  bookkeeping remain once per frame. Single-step launches retain the old path.
- Verification: **338 files / 10,701 tests passed**, final TypeScript/build passed,
  and production matches the physics fixtures across **276 frames**. Input/rule/
  world clocks pass **937 checks**; an unrelated body's motion matches across
  **277 steps**. Desktop/mobile Lab editing and undo pass; zero page/load errors.
  Artifact `index-C3CpODON.js`; see the [latest handoff](review/2026-09-20/README.md).
- Next: complete launch-speed influence (LSI) and verify DI/KO behavior together,
  then extend reference move/weight/gravity data across Link's kit and the roster.
  Vanilla collision/action transition parity and directional-dodge timing remain
  open. Replay playback and 3D remain deferred.

### 2026-09-20: Reference launch-speed influence and DI/KO verification

- Authored reference launches apply DI then LSI on the final hitlag input.
  Up/down input scales eligible speed, with strict post-DI vertical immunity.
  The resolved unit-disc input adapter and mirrored angle gate remain explicit
  project policies; console raw-stick processing is not claimed.
- Boosted launch velocity is influenced once. Carry, natural gravity, hitstun
  schedules and pre-DI vertical classification remain separate. Legacy strikes
  and recipients without a launch profile retain their existing DI behavior.
- Independent real-Matter fixtures measure 12 neighboring integer KO brackets
  from an airborne flat-stage origin through the final locked step. These are
  project regression measurements, not whole-match survival thresholds.
- Verification: **340 files / 10,751 tests passed**, final TypeScript/build passed.
  Production verifies **18 scenarios / 778 influenced
  frames**, plus **276 neutral frames** and desktop/narrow Lab editing and undo.
  Zero page/load errors. Artifact `index-CH7_8XA2.js`; see the
  [latest handoff](review/2026-09-20/launch-influence/README.md).
- Next: source and convert Link's up/down tilt launch records with measured
  outcomes before tackling charged smash and linked/set-weight strikes. Exact
  directional dodge, remaining roster data and collision/action parity stay open.

### 2026-09-21: Link up/down tilt reference launches

- Up tilt uses the pinned inner-sword record (11 damage, base30, growth111,
  angle85) for the existing single arc rectangle. Its horizontal orientation
  follows the target's side; rear hits now launch in the corresponding direction.
  Source tip/arm/clavicle differences remain an explicit spatial approximation.
- Down tilt uses the pinned single strike (9 damage, base90, growth30, angle85),
  retaining attacker-facing direction. It now produces a vertical launch instead
  of the former shallow legacy vector. Existing gameplay timings are retained.
- Both move records inherit the verified reference weight/gravity, tumble
  speed-up, DI/LSI and recovery model. Lab editing, save/load and live custom
  factory overrides preserve the fields and source-direction flag.
- Verification: **341 files / 10,767 tests passed**, final TypeScript/build passed.
  Production matches **14 actual-hit scenarios /
  688 frames** exactly through three actionable steps, with both Lab viewport
  checks passed and zero page/load errors. Artifact `index-C6NNrrJp.js`;
  see the [latest handoff](review/2026-09-21/tilt-launches/README.md).
- Next: source and convert neutral air's early/late records and dash attack.
  Charged smash, linked/set-weight strikes, detailed spatial hitboxes, precise
  directional dodge and wider roster calibration remain open. Replay playback
  and 3D remain deferred.

### 2026-09-21: Neutral-air and dash-attack reference launches

- Neutral air uses outer-knee early11/base22/growth100/angle361 and uniform
  late6/base15/growth100/angle361 records. Both orient by the target's side and
  share group `kick`, preserving one hit per victim across the phase replacement.
- Dash attack uses its middle-sword13/base85/growth85/angle50 record and attacker
  facing. Existing geometry, timing and hitlag policies remain; source spatial
  variants and shield-setoff distinctions stay explicit approximations.
- Independent real-Matter checks include fresh late contact, rear/mirrored
  launches, both weights, DI/LSI, grounded angle361 release and forced late-sensor
  recontact without a second hit. Lab edits preserve early/late data separately
  through save/load and factory overrides.
- Verification: **342 files / 10,788 tests passed**, final TypeScript/build passed.
  Production matches **16 actual-hit scenarios /
  717 frames** exactly, with both Lab viewport checks passed, **2,570 ordinary
  input/rule/world steps**, and zero page/load errors. Artifact `index-qgSsjK5c.js`;
  see the [latest handoff](review/2026-09-21/nair-dash-launches/README.md).
- Next: audit and convert down air's early/late meteor, grounded-response and
  returning-hit launches together. Charged/linked/set-weight strikes, detailed
  spatial hitboxes, precise directional dodge and broader roster calibration
  remain open. Replay playback and 3D remain deferred.

### 2026-09-21: Down-air reference launches

- Early down air uses separate airborne18/base30/growth80/angle270 and
  grounded18/base30/growth78/angle60 records. Late uses15/base30/growth80/angle60;
  the returning hit uses11/base50/growth80/angle65. All orient by target position.
- Existing rebound speed, fast-fall suppression, hitlag-paused return delay and
  fresh returning group remain. Grounded launch overrides do not leak into later
  strikes. Lab editing and save/load retain all four records independently.
- Verification: **343 files / 10,807 tests passed**, plus the final **17-test**
  focused rerun after aligning grounded fixture staging with production.
  TypeScript/build pass; **787 production frames** match exactly across both
  weights, grounded delivery, mirrored/rear contact, meteor DI and actual
  rebound/return scheduling. Both Lab viewports and the four existing production
  rebound cases pass. All **3,027 input/rule/world steps** retain normal cadence;
  zero page/load errors. Artifact `index-Cz1CoqeW.js`; see the
  [latest handoff](review/2026-09-21/down-air-launches/README.md).
- Next: establish forward smash's charged reference contract, distinct inner/tip
  launch records and charge inheritance by the optional second slash; verify
  tap, partial and full charge before conversion. Linked/set-weight strikes,
  detailed geometry, precise dodge and remaining roster calibration stay open.
  Replay playback and 3D remain deferred.

### 2026-09-21: Charged forward-smash reference launches

- Link's first inner hit, tip and optional second slash use distinct sourced
  base/growth/angle records. Explicit damage-only charge increases damage while
  retaining those launch parameters; older moves keep endpoint interpolation.
- An optional sweet-spot knockback override supplies the tip's distinct launch.
  Save/load validates the mode, rejects projectile usage and reference endpoint
  interpolation, and preserves separate Lab edits for both slashes and the tip.
- Existing charge timing and optional follow-up windows remain. Charge inheritance
  is verified as existing project policy, not independently established vanilla
  status behavior. Source geometry and hitlag distinctions remain approximations.
- Verification: **345 files / 10,855 distinct tests** verified across the
  aggregate and final **162-test** authoring rerun, which resolves the aggregate's
  sole projectile-guard failure. TypeScript/build pass. Production matches
  **21 trajectories / 1,166 frames** exactly; both Lab viewports and a separate
  normal attack-plus-stick-flick charge/follow-up check pass. All **4,933** checked
  input/rule/world steps preserve cadence; zero page/load errors. Final artifact
  `index-DrN4gZWe.js`; see the
  [latest handoff](review/2026-09-21/forward-smash-launches/README.md).
- Next: audit and convert down smash's front/back launches with the new charge
  mode, then address up smash's linking and any fixed/set-weight requirements.
  Precise dodge, detailed geometry and wider roster calibration remain open;
  replay playback and 3D remain deferred.

### 2026-09-21: Charged down-smash reference launches

- Link's front sweep uses inner-sword16/base40/growth88/angle78; its back
  sweep uses sword12/base80/growth63/angle30. Both orient by target position.
  The back geometry remains mirrored while damage-only charge scales each
  sweep's damage without changing its reference parameters.
- Existing strike windows and hold timing remain. Spatial damage variants,
  trip and low-height status behavior remain explicit source limitations.
  Lab edits preserve the front and rear launch records independently through
  save/load and live factory overrides, hiding inactive charge endpoints.
- Verification: **346 files / 10,873 tests passed**. TypeScript/build pass,
  artifact `index-DNmiPqYT.js`; production matches
  **17 scenarios / 1,007 frames** exactly. Normal resolver down-flick/attack
  charge checks pass for both sweeps; Lab main/rear controls pass both
  viewports. All **4,106** checked input/rule/world steps retain normal cadence,
  with zero page/load errors. See the
  [latest handoff](review/2026-09-21/down-smash-launches/README.md).
- Next: up smash requires fixed-knockback, set-weight and additive reaction-frame
  support before converting its linking strikes and testing the whole sequence.
  Precise dodge, detailed geometry and wider roster calibration remain open;
  replay playback and 3D remain deferred.

### 2026-09-22: Up-smash fixed linking launches

- Added optional fixed knockback, forced reference weight and extra reaction
  frames. Fixed launches retain ordinary recipient gravity, skip tumble
  speed-up and ignore rage/stale knockback scaling while still dealing stale
  damage. Added reaction frames do not independently trigger tumble.
- Link's first two sweeps use inner-sword air115/fixed38 and ground107/fixed28,
  forced weight100 and three added frames; its inner finisher uses
  damage11/base60/growth101/angle90. Damage-only charge scales all three hits.
  Outer/body variants and source SDI/setoff details remain explicit limitations.
- Lab numeric edits and JSON/factory persistence cover the separate ground/air
  records. The numeric-only Lab preserves setWeight; boolean editing remains
  available through JSON. The older integration fixture now uses the production
  physics coordinator, retaining its existing connection/defense assertions.
- Verification: **348 files / 10,921 tests passed**, plus final **26-test
  physics** and **18-test Lab** reruns after strengthening the DI test and
  shortening two overlapping labels. TypeScript/build pass on
  `index-aLAtqK0o.js`, with matching source-map contents for all changed runtime
  files. Production matches **26 scenarios / 1,332 frames** exactly, including
  six connected sequences. Resolver checks cover the grounded three-hit charge
  and fixed-launch rage/staling exemption. Both Lab viewports pass, with zero
  browser errors and **5,842** checked outer game steps. See the
  [latest handoff](review/2026-09-22/up-smash-launches/README.md).
- Next: audit and convert forward/back aerial linking launches with their
  motion and special-angle requirements. Detailed geometry, precise dodge
  and wider roster calibration remain open; replay playback and 3D stay deferred.

### 2026-09-22: Forward/back aerial launch records

- Converted forward air's finisher to damage10/base43/growth120/angle44.
  Its first hit remains an explicitly calibrated vector, minimum hitstun and
  motion carry: the audited scripts name angle367 but do not establish its
  internal algorithm. Unsupported special angles remain rejected in saved data.
- Back air selects the distal-knee fixed linker: air70/fixed36 and
  ground73/fixed50, base0/growth100/forced weight100. Its finisher uses
  damage7/base45/growth98/angle361. Normal back-aerial input already supplies
  the backward launch axis. The old minimum-nine-frame linker floor is removed.
- Measured rising back airs connect without a defense gap; falling and slower
  rising approaches can miss within the existing rectangle. Source launches
  were retained, and the earlier universal connection assumption was replaced
  by explicit connection/miss/recovery checks. Animated bone geometry remains
  a separate parity limit.
- Verification: **350 files / 10,963 tests passed**, plus the final **34-test
  physics rerun** after increasing fixture starting gaps to avoid unmodeled
  pre-hit body separation. No runtime changes followed the aggregate run.
  TypeScript/build pass on `index-CU65TyEE.js`; production matches all
  **34 scenarios / 1,419 frames** within numerical precision, including normal forward/back aerial
  dispatch, connected sequences and misses. Fixed launch ignores attacker
  rage/stale knockback scaling while stale damage remains active. Lab fields
  pass at both checked viewports with zero browser errors. See the
  [latest handoff](review/2026-09-22/fair-bair-launches/README.md).
- Next: source and convert the three-stage jab's launches and verify actual
  chain input/contact timing. Angle367, detailed geometry, precise dodge and
  remaining roster values stay open; replay playback and 3D remain deferred.

### 2026-09-22: Jab launches and chain authoring

- Converted jab one/two to the selected inner damage3/base25/growth25/angle361
  records, and jab three to damage4/base70/growth70/angle30. Inward tip records
  and their fallback remain omitted until collision priority can be represented
  and verified. Source hitlag multipliers and motion/status clocks are not ported.
- Replaced the short calibrated rectangles with the selected source top-bone
  capsule/sphere envelopes at the established five pixels per unit and an
  explicit foot projection. The old reach missed follow-ups with sourced
  launches; the evidence is preserved. Rounded corners and animated bones
  remain limits of this rectangular approximation.
- Earliest fresh presses land all three hits at relative steps 0/13/25 in the
  measured neutral approaches, with no actionable gap. Delayed presses land at
  0/17/33 against an idle recipient, but allow action from step 15. Whole-chain
  fixtures retain the floor and fighters without repositioning between hits.
- Ordinary single-sensor attacks now share one execution identity across all
  victims, so one swing registers one stale use with one starting snapshot.
  Lab chain openings now edit as integer frames; JSON/factory and real-Matter
  checks verify the shifted opening, including the exact accepted frame.
- Verification: **352 files / 11,002 tests passed** in the final full-suite run.
  TypeScript/build pass on `index-B5ZhKgBj.js`; production matches all
  **33 scenarios / 1,130 frames** within numerical precision. Multi-opponent
  staling and whole-frame Lab edits pass, with zero browser errors. Narrow
  screenshots establish field access, not mobile usability. The initial
  aggregate run exposed absent plugin metadata in mock hitbox bodies; the
  single-sensor path now initializes it consistently with windowed attacks,
  and the complete rerun passes. Evidence is collected in the
  [latest handoff](review/2026-09-22/jab-launches/README.md).
- Next: audit grab/throw damage, release timing and launch records. Jab tip
  priority, angle367, projectile/special launches and wider roster values remain
  open; replay playback stays ultralow priority and 3D remains deferred.

### 2026-09-22–23: Combined Link and shared combat reference pass

- Implemented the five requested areas together. Bow, boomerang phases, grounded
  Spin, supported aerial Spin rungs and bomb explosions use audited launch
  records. Projectiles and multihit sequences retain one execution identity.
- Inward jab tips and ordinary forward-air situation variants now have separate
  records. Capsule checks reject empty sensor corners and select the lowest
  eligible source ID. Saved tunes and the Lab retain these fields and preview
  the selected capsule region.
- Link has measured fresh spot/forward/back roll and air-dodge windows. Shield
  release owns its commitment and parry window, including minimum hold,
  post-block eligibility and protected freeze/stun. Regrabbing a ledge without
  landing or taking a damaging launch no longer restores hang invulnerability.
- Shared combat uses weighted nine-use staling and freshness, the reference
  rage cap, separate stale damage/growth terms, authored hitlag/SDI factors,
  crouch modifiers and category-based shieldstun. SDI uses documented distance,
  pulse spacing and direction-addition rules with explicit input adapters.
- Final clean aggregate: **361 files / 11,179 tests passed** on September 23.
  TypeScript/build and all four production harnesses pass on
  `index-DN4pX3Za.js`. The artifact matches all 270 runtime source-map entries;
  all 66 archived-source hashes match. Independent formula oracles, real Matter
  regressions, normal-input chains and Lab save/reload checks are collected in
  the [combined handoff](review/2026-09-22/combat-parity/README.md).
- Remaining accuracy work is listed there: native autolink/target-position
  behavior, animated bone transforms, full special trajectories and item rules,
  native dodge travel/landing/staling and complete ledge/SDI rules. The next
  separate kit audit is grab/throw damage, release timing and source launches.
  Replay playback remains ultralow priority; 3D and broad roster tuning wait.

### 2026-09-23: Controller and rematch regression repair

- Reproduced the reported failures in the previous production build: device
  chips did not assign fighters, B escaped capture into menu navigation, and
  replacement match sprites lost their selected palette tints.
- Controls now distinguishes player columns from controller indices and applies
  real device ownership. Occupied devices exchange players; custom controller
  buttons survive reassignment. Roster return, sleeping-match refresh and
  restart/rematch launch data retain the assignment and profile.
- B can be rebound; Esc, Start and Cancel abort capture. Held capture inputs
  cannot immediately navigate away. CPU/unused columns are labelled as presets.
- Match creation clears cached palette applications before rebuilding sprites.
- Build/typecheck pass on `index-Cfka7DlF.js`; all 273 runtime source-map entries
  match. The clean full suite passes **363 files / 11,204 tests**. All four
  production browser journeys and the final conflict-free B persistence check
  pass with zero browser errors. Evidence is recorded in the
  [regression handoff](review/2026-09-23/controller-session-regressions/README.md).

### 2026-09-23: Playtest input profiles, scene lifecycle and bomb consistency

- Replaced the physical-device selector with reusable named binding profiles.
  Defaults follow the actual joined input; old custom mappings remain selectable
  as imported profiles. Profile selection and editing preserve physical ownership.
  Main-menu Controls explicitly clears previous match context and edits only the
  library. Confirm reports saved profiles, conflicts or storage failures.
- Capture consumes activation/navigation inputs and requires release before menu
  movement resumes. Mouse clicks no longer reposition controller-owned hands.
  Sparse controller indices retain ownership through scene transitions; fixes
  cover Phaser cleanup and keyboard/CPU roster confirmation with array holes.
- All bomb detonation causes use one layered explosion effect, emitted once per
  detonation even during hitlag. Ground and thrown-item lifetimes are doubled,
  including the remote-bomb object lifetime; authored combat/fuse timing remains.
- Final clean suite: **369 files / 11,254 tests passed**. TypeScript/build pass on
  `index-DU0SLTOZ.js`, matching all 275 runtime source-map entries. All three
  production probes pass: 15 profile checks, six sparse-player journeys and eight
  bomb causes, with zero page errors. Screenshots and preserved failure evidence
  are collected in the [playtest handoff](review/2026-09-23/playtest-input-repair/README.md).
- The user's specific preview-to-match skin mismatch remains unreproduced. Tested
  Link/Wolf colours persist through match/restart/rematch; the selected fighters,
  colours and observed match colours are still needed for that separate report.
  Physical-controller playtesting remains necessary. The next kit audit remains
  grab/throw records; replay playback and 3D retain their deferred priorities.

### 2026-09-23: Shared connected-controller handling

- Replaced duplicated scene-level controller filtering with one typed read path.
  Character selection, lobby actions, menu navigation and match START ignore
  disconnected wrappers and sparse holes while retaining physical indices.
- Menu button history is pruned against each connected snapshot, so a missed
  disconnect event cannot leave stale confirm/back/repeat state behind.
- Retained the isolated Phaser cleanup workaround after reviewing the installed
  native methods; cleanup must also visit disconnected wrappers to remove their
  listeners, whereas input polling must exclude them.
- Verification: **65 affected files / 2,079 tests passed**, TypeScript/build pass
  on `index-CiXJE12M.js`, all 276 runtime source-map entries match, and the 15
  profile plus six sparse-player browser checks pass with zero page errors.
  The preceding complete-suite baseline remains recorded separately. Evidence
  and scope are in the [refactor handoff](review/2026-09-23/controller-boundary/README.md).

### 2026-09-23: Per-player Controls in character selection

- Implements the approved local editing flow: up to four independent editors,
  each owned by its player's joined input, while other controllers keep using
  character selection. Mouse editing is restricted to keyboard-player controls.
- Profile selection changes mappings without changing physical ownership. Drafts
  remain isolated; saving changes to a shared profile creates a copy. Done saves
  and closes that editor; Cancel discards its unsaved draft. The standalone
  MainMenu/Pause library remains unchanged.
- Capture consumes navigation and held activation/release inputs. B remains
  bindable; Start or Escape cancels capture. Match start waits for all editors
  to close. Disconnect currently discards that editor's unsaved draft while the
  scene continues; this policy is explicit and temporary.
- Final verification passes **375 files / 11,304 tests**, including 36 new
  tests across the session, input, panel and scene. TypeScript/build and
  **13 production browser checks** pass on `index-DH_JqEPY.js`, with zero
  page errors. All 280 runtime source-map entries match the workspace;
  screenshots of simultaneous editors and match handoff were inspected.
  The prior `index-CiXJE12M.js` controller-boundary result remains historical.
  Details are in the [current handoff](review/2026-09-23/player-controls/README.md).
- The reported preview-to-match skin discrepancy remains unreproduced and is
  unchanged by this Controls milestone. Physical-controller acceptance remains
  necessary; grab/throw auditing, replay and 3D priorities are unchanged.

### 2026-09-25: Donkey Kong as a sourced Ultimate kit (uncommitted)

- Rebuilt `donkeykong` from Ultimate Frame Data and the dumped Ultimate
  scripts with the add-character skill: 49 ledger rows (32 sourced, 12
  approximate, 5 missing engine states). Two generic engine extensions:
  `armorWindows` (super armour, optional charge gate) and the `shockwave`
  down-special kind.
- New art for all 33 clips from UFD-frame pose guides on the local ComfyUI
  (third batch shipped after two rejected batches and two retry rounds);
  the user chose to ship it as is and revisit with a better image tool.
- Browser probe 34/34 on `index-BQtcIJGJ.js`; full suite shows only the
  branch's three pre-existing failures.
- Evidence: [Donkey Kong record](review/2026-09-25/donkeykong-character/README.md).
  Remaining work, including a jab-2 scale bug and three guide-file
  collisions found by the end-of-session audit:
  [open issues](review/2026-09-25/donkeykong-character/OPEN-ISSUES.md).
