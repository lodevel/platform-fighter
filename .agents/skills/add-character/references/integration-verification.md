# Repository integration and verification

## Current entrypoints

Inspect implementations before editing; this map is navigation, not a fixed
number of files to touch. TypeScript catches exhaustive maps but not every
ordered list, route or asset registration.
Unless a longer path is given, filenames here are in `src/characters/`;
test files live beside their implementation (including under `src/match/`
and `src/scenes/`).

| Concern | Entry points and invariant |
| --- | --- |
| Identity | `src/types/index.ts`: add to canonical `CHARACTER_IDS`; `CharacterId` is derived |
| Kit | `src/characters/<Name>.ts`, `contractFighter.ts`, `movesetContract.ts` and move/special schemas; inspect a fighter with comparable mechanics, not an arbitrary copied template |
| Movement/defense | `fighterMovementProfiles.ts`, `locomotionState.ts`, `dodgeState.ts`, `shieldState.ts`, `ledgeHangState.ts` and Character configuration |
| Input selection | `groundedAttackInput.ts`, `aerialAttackInput.ts`, `Character.ts`, `src/input/InputBindingsStore.ts`, `src/input/InputResolver.ts` (`buildCharacterInputFromResolver`) and `src/scenes/MatchScene.ts`; test the route actually used in a match |
| Instantiation/selection | `fighterRegistry.ts`, registry ID lists, `roster.ts`, roster ordering and `index.ts` exports |
| Authoring/save/load | `authorableCharacterRegistry.ts` compiled-kit map and slot export names, `characterSerializer.ts`, `characterFactory.ts`, `src/characterBuilder/characterStorage.ts` and match character snapshots |
| Animation | `groundedNormalDriver.ts`, `movesetAnimationDriver.ts`, `movesetAnimationCues.ts`, `defensiveAnimationState.ts`, `spriteAnimationDriver.ts` (`MOVE_SHEET_KEYS`, `MOVE_SHEET_SPECS`, `attackMoveToSheets`), `simulationSpriteAnimation.ts`; inspect runtime ID lists and dedicated clip routes |
| Assets/presentation | `src/assets/manifest.ts`, `visualScale.ts`, `handAnchors.ts`, `palettes.ts`, `assets/characters/<id>/frames.json` and final animation strips |
| Live contact | `attackHitWindows.ts`, `attackCollisionShapes.ts`, `src/match/HitboxDamageHandler.ts` and real Matter contact |
| Armour / variants | `AttackMove.armorWindows` (super armour, optional `minChargeRatio`) in `attacks.ts` and `Character.applyHit`; `downSpecialKind: 'shockwave'` (`aerialVariant`, mash `repeat`) in `downSpecialSchema.ts`; both parsed by `characterSerializer.ts` |
| World entities | Character special runtime, relevant `src/items/` adapters, `src/scenes/MatchScene.ts` rendering and cleanup |
| Pickup weapons/items | `src/items/itemCatalog.ts`, `ItemDefinition.ts`, `resolveItemInput.ts`, `itemActions.ts`, `itemShooting.ts`, fighter-specific routes/anchors in `Character.ts`, `handAnchors.ts`, `upperBodyLayer.ts` and `MatchScene.ts`; follow [weapon/item compatibility](weapon-compatibility.md) for full fighter coverage or affected item fixes |

Register forward/default attack slots deliberately, then explicitly wire
directional tilts/smashes/dash attacks and grab data. Aerial direction controls
dispatch. Preserve move IDs and export naming consumed by the authorable
registry. A fighter selectable in the roster must also be instantiable from
its saved Lab data; check optional follow-ups and nested tuning survive.

Audit inherited action constructors and actual registrations as well as the
fighter's declared kit. Getup attacks (face-up/down and trip) and ledge attacks
can silently use shared default rectangles even when their source animation
profiles exist. Trace each applicable input/status producer to the actual
attack definition, source timing/protection, packet and paired outgoing
consumer. A supplied clip or source table cannot qualify an unregistered
action. Preserve genuine harmless gaps and fail visibly on missing required
geometry rather than letting a generic inherited attack fill the row.

For a fighter rebuilt with a new identity or source-art namespace, inspect
character-selection portraits/cards, match entry and Lab reference/move
previews explicitly. They must consume the new registered drawing, root and
render metrics; unchanged idle keys can retain the previous character art.
Keep legacy saved/replay revisions explicit. A renamed or timing-edited move
retains its declared source lineage and uses the same effective contact
windows/pose clock as the match. In editor overlays, preserve geometry
precedence: explicit window geometry, then explicit global geometry, then
source geometry; an explicit empty capsule array remains harmless. Missing
fresh preview art is an unresolved integration dependency, not permission to
show an old animation or an idle pose as the inspected action.

Keep random behavior seeded and gameplay on the fixed-step simulation. Use
each producer's coordinate contract for entities, including scaled or offset
stages. Some entities already provide world coordinates (traps currently do);
apply a stage-to-world transform only to values still in stage coordinates.
Test a visible projectile and its collision at the same position.

For fast body-attached sensors, compare the sensor and displayed body at the
actual post-physics/substep owner root, including both facings and rotations.
Pikachu's Quick Attack initially had correct local joint geometry and receiving
capsules but its attack sensor lagged the live body by55px. Test actual hits at
the current position and misses at the stale position with a receiver small
enough to distinguish them; a large receiver covering both points cannot prove
the negative case. Check both world collision events and post-step receiving
sampling. Record any source-opt-in fix and unchanged legacy behavior separately.

When several semantic states overlap (for example tumble and ordinary fall),
verify the selected receiving pose against the selected visible body, not just
the number of capsules. Use a shared qualified selection/clock or prove both
consumers agree at entry, transitions, hitlag and exit. A passing visual route
alone does not qualify a lower-priority receiving shortcut.

For visible-floor acceptance, measure selected alpha pixel centres under the
actual rendered sprite's origin, scale, flips, rotation and postphysics position
against the actual finite supporting floor. PIL bounding boxes have an exclusive
bottom: the final visible pixel centre is `bottom - .5`, not `bottom - 1`.
Record the alpha cutoff and independently justified ink/contact tolerance.
Select pixels from the pose's anatomical support contact: feet/soles or another
source-intended supporting part. Record that landmark; the lowest opaque tie,
hair, tail or equipment pixel cannot qualify grounding unless that part actually
supports the pose. Preserve intentional airborne and non-contact intervals.
Keep physical support vertices separate from damage-receiving capsule extents;
a vulnerability capsule is not a movement collider. Inspect the saved body
screenshots as well as the measurements. This convention corrected a borderline
Pikachu audit error; see the
[observed verification lessons](../../../../docs/review/2026-10-06/pikachu-character/integration/resumed-verification-lessons.json).

`docs/CHARACTER-CHECKLIST.md` and
`.claude/skills/add-character/verify-character.sh` have historical coverage.
The script checks text presence; it cannot establish correct routing or play.
Inspect their actual fighter coverage before relying on them. The current
authorable registry is important for compiled fighters absent from legacy JSON.

## Choose meaningful checks

When custom gameplay phases resample a paired source animation, carry regional
and whole-body protection through the same continuous source age used by its
drawing, receiving shapes and outgoing geometry. Declare that clock domain in
the editor and saved schema. A source protection endpoint may exceed the edited
gameplay total, so validate it against the source extent rather than silently
truncating or rejecting it. Verify stock and authored boundaries with actual
contacts, freeze and retirement, then save/reload the edited fighter and repeat
the contact checks. DK's [APP11 down-tilt Lab review](../../../../docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/runtime/full-dtilt-lab-checkpoint-11/observations.json)
passed106 checks, including a five-step custom action retaining source-window
[3,8) and40 actual shoulder/head contacts across Test Fight and reload. That
proves the declared resampling adapter, not native custom-timing behavior.

For passive objects that retain a dormant damaging definition, prove damage
suppression with independently measured overlap against an actual vulnerable
receiving primitive at a completed physics sample. Record the active region,
world geometry and unchanged damage/contact ledger. Also verify gravity has
one trajectory owner, settlement, physical reacquisition and offstage/timeout
retirement. DK's source-scoped heavy drop passed these gates on APP10 in
[five actual cases/25 checks](../../../../docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/runtime/heavy-armor-passive-checkpoint-10/observations.json),
with [separate actual-trace gravity analysis](../../../../docs/review/2026-09-25/donkeykong-character/completion-2026-10-08/runtime/checkpoint-10-passive-gravity-analysis.json).
That verifies the declared passive adapter; source-native status dispatch
requires its own evidence.

Use available package commands; adapt executable paths to the environment.
For a new fighter, run typecheck, the relevant roster/registry/serialization and
animation suites, fighter behavior tests, and a production build. Shared engine
changes warrant broader regression coverage. A narrow art or data fix can use
focused checks; do not rerun unrelated suites repeatedly after they pass.

```sh
npm run typecheck
npx vitest run <affected test files>
npm run build
```

Do not reuse a stale bundle or claim a command passed when it failed. Environment
workarounds belong in the evidence record, not in gameplay code.

Coordinate resource-heavy builds with generation and browser ownership when
they share a constrained machine. On the Pikachu WSL setup, loaded Comfy models
occupied about10GiB RAM and one SwiftShader browser about2GiB; overlapping a
gallery build failed with ENOMEM. At a confirmed empty generation queue,
unloading idle model memory allowed the build and preview to succeed. Serialize
browser probes on that setup and build at an unloaded-model checkpoint. A later
single-browser replay beside loaded generation still failed WSL asset reads
with ENOMEM; on that setup, also run browser qualification and compiler checks
at unloaded-model checkpoints, retaining generation's completed output before
pausing its next submission. A lightweight compiled static server avoids Vite's
per-request asset-directory case scans, but does not establish enough memory
for concurrent generation. Measure
resources before generalizing this schedule to another backend or machine;
retain failed runs and the exact restored build identity in the evidence.

Examples to adapt, not copy blindly:

- `Character.referenceLocomotion.physics.test.ts` and
  `Character.airMovement.physics.test.ts`: real-contact movement trajectories.
- `Link.normals.physics.test.ts`: active intervals and follow-up behavior.
- `HitboxDamageHandler.collisionHits.physics.test.ts`: geometry reaching damage
  delivery, regional selection and mirroring.
- `character*Serializer.test.ts`, `characterFactory.test.ts`,
  `authorableCharacterRegistry.test.ts`: authored data surviving construction.
- `simulationSpriteAnimation.test.ts` and `CharacterLabSession.test.ts`: pose
  selection, freeze, direct Lab entry and editor behavior.

Tests should establish observable behavior. Check the first/last active frame,
first actionable frame, dead gaps, one-hit identity versus intentional re-hits,
buffer expiry and both facings. For motion, separate dash carry from air
acceleration and landing contact from airborne duration. Explain a tolerance
using the actual integrator/contact behavior; do not loosen it to hide drift.

For actions with their own movement/control, require the applicable
[move-behavior scenarios](move-behavior.md#verify-the-behavior), including recovery
after a real launch, the full useful trajectory, phase boundaries, freeze/resume,
legal and prohibited cancels, interruptions, landing and resource resets. Use
`stepCharacterPhysics.ts` and the real MatchScene rather than an isolated velocity
assignment. Separate independently sourced expectations from local calibration
checks; the latter do not establish Ultimate motion parity.

Use the same prepare/world/constraints order in older physics fixtures too.
Direct `Engine.update` after input can bypass a fighter's world-gravity
cancellation; DK's ordinary vertical review then falsely measured hop heights
134/50px while the match path measured its selected170/86.5px constraints.
Retain the failed fixture result, correct the omitted consumer and rerun the
affected scope. Do not change source-height assertions to accept a bypassed
physics path or carry an obsolete native airtime claim onto an authored curve.

## Launch and KO verification

For a reported ejection problem, identify the running game before attributing
the cause or changing balance. Record its URL, browser-loaded bundle identity
and engine/build identity, actual platform geometry and blast bounds, and both
fighters' BASE or selected saved-tune snapshots. A current checkout or local
preview does not identify the user's served build. If their build or tune cannot
be inspected, keep that comparison explicitly unverified.

- Check the reported percent plus a low-percent control with ordinary attacks
  and finishers, both facings, and relevant grounded/airborne branches. Include
  recipients with different weights and launch profiles; a DK/Link-only result
  does not cover recipients without reference launch physics.
- Use real contacts through `HitboxDamageHandler` and `stepCharacterPhysics`.
  Record the selected move/window/region, charge and stale/rage modifiers,
  percent before/after damage, release vector, displacement and trajectory
  through hitstun and the first actionable step. Distinguish ordinary trajectory
  ticks from displayed frames when launch speed-up groups them. Observe floor
  interruptions and applicable jump/attack/dodge behavior after hitstun.
- Record offstage travel separately from a blast-zone crossing and stock loss;
  check the actual stage, spacing and contact conditions. Use sourced opening,
  linking/fixed-knockback, bury and weak-hit behavior to choose expectations.
  Do not require every attack at 200% to cause an immediate KO or increase
  shared percent growth to make those exceptions behave like finishers.
- Compare saved move/tuning records with BASE data explicitly. An old tune can
  preserve legacy knockback despite updated movement defaults. Do not silently
  upgrade or overwrite authored moves; preserve the snapshot and report the
  difference. Formula agreement and isolated flight checks support diagnosis,
  but do not prove the behavior of the served game.

## Production acceptance

Run a production preview on an available port with the production base
(`npm run preview`, i.e. `vite preview --base /platform-fighter/`): the built
`index.html` references `/platform-fighter/assets/...`, so a preview served at
`/` answers those URLs with the SPA fallback page (HTTP 200, `text/html`) and
the game never boots. Check one asset URL's content type before trusting a
200 from the index. Record the exact built asset or
build identity and verify the browser loaded it. Reuse relevant harnesses under
`tools/` such as `link-movement-probe.mjs`, `link-defense-parity.mjs`,
`frame-inspection-acceptance.mjs`, `animation-acceptance.mjs` and the Link
collision/special probes. Read their inputs and assertions before adapting them;
a Link-only probe does not verify a newly added character automatically.

For a clip with unequal held pose windows, use the same sample clock in the
match and the Lab's portrait, receiving and attack overlays. Atlas phase cell
counts do not specify those windows. Exercise default timing and actual Lab
phase edits through save/reload and Test Fight; retain fractional source ages
inside a finite final pose window. DK's October 9 eight-pose jab verified this
with 54 Lab checks and a fractional-end unit case. See its
[exact-build receipt](../../../../docs/review/2026-09-25/donkeykong-character/completion-2026-10-08/runtime/checkpoint-09-full-jab-summary.json).

A probe must exercise the engine the way a player does, or its result is
about the probe (Donkey Kong, 2026-09-25: the first probe reported zero
scenarios with exit 0 because its page-side step helper returned nothing,
then four scenario groups failed for probe reasons). Checklist before
trusting a probe's verdict: the page helper returns per-frame state and each
scenario records at least one check; input objects use the fields the human
input path actually builds (the match resolver maps the dedicated `smash`
action to `attackHeavy`; keyboard defaults are P1 V / P2 Numpad 0, and
`attack` + a stick flick from rest also selects a smash). Inspect current
bindings and `buildCharacterInputFromResolver`, not a legacy adapter; opponents
spawn outside the sum of the two body half-widths, otherwise Matter's contact resolution
pushes them apart during settle and close-range checks whiff; expected damage
includes staleness (a fresh move lands at ×1.05); and a sub-test that needs
the opponent to act after the fighter's own hit connects must place the
opponent where that hit cannot reach him first. When a check fails for an
engine reason, keep the assertion and record the frame-by-frame evidence and
the gap; when the failing expectation turns out to be the probe author's
assumption rather than a sourced fact, rewrite the check to the sourced
behaviour and say so (DK's probe asserted a second Hand Slap hit on the same
target; the sources give the first hit BKB 85 at 78°, which launches the
target out of the ground-only second window).

Reject missing or nonfinite numeric operands and results before comparing them
with a tolerance. In JavaScript, `NaN > tolerance` is false and JSON serializes
`NaN` as `null`; neither is a passing measurement. Require positive independent
sample coverage for every affected actor/clip/facing, and record genuine undrawn
pose exclusions separately. Use a pinned, reviewed alternate coordinate basis
when a fighter's metadata omits another fighter's field; do not silently use an
undefined offset or infer missing provenance from matching runtime consumers.
This corrected Pikachu's phase-8 rendered-grip analysis: the source's 25-world-pixel
body/root basis replaced an absent DK-only field, and the retained captures
then produced finite independent errors without another game build.

For browser keypad scenarios, observe the actual DOM key code and resolved
action before interpreting a failed interaction. In the DK October 9 capture
probe, Playwright's Numpad4 produced move-left; a native Chromium keypad event
with the existing binding's key code100 resolved grab without changing the
resolver. Also establish the captor's actual grounded state before its fresh
grab: `resetForRound` placement was airborne until physics updated. Repositioning
the already settled neutral body preserved a legal entry and both capture cases
passed. These are fixture corrections for that runtime/browser, not changes to
fighter controls. The exact-build receipt above retains both failed attempts.

For a new fighter, cover:

- Select and spawn the fighter; verify body size, idle/motion and both facings.
- Measure walk/dash/run, hops, air drift and fall; check first actionable steps
  after landing, defense and recovery against the coverage record.
- Demonstrate each movement-altering move's recorded phases, steering and exits.
  Show the recovery after jump use and real knockback as applicable; attack end,
  powered-motion end, helplessness and landing lag need distinct observations.
- Exercise neutral/cardinal/diagonal inputs, held directions versus flicks,
  queued actions, all move families and relevant ground/air variants.
- Show real contact, misses at the edge, shield interaction and target damage;
  test distinct strike windows and optional follow-ups. Verify visible
  projectiles/entities track their collision and disappear correctly.
- For sourced protection and interaction rules, run the applicable
  [contact checks](ufd-smashwiki.md#verify-the-consumed-mechanics): named parts
  versus whole-body windows, distinct intangibility/invincibility/armor outcomes,
  boundaries, freeze/resume and exit cleanup. Exercise documented flags in
  actual collision rather than merely inspecting their stored values.
- Inspect startup/contact/gap/recovery art, hitlag/pause and gameplay-scale
  weapon/body alignment. Capture images for altered poses or geometry.
- Verify each supported pickup item and its applicable fighter contexts using
  [weapon/item match checks](weapon-compatibility.md#verify-in-the-match), including
  new-shot turning, moving upper/lower composition, charge feedback and item
  ownership/release. Generic fallback routes and one sample weapon are insufficient.
- For UFD kits, compare each action's recorded motion/behavior cues with the
  source at verified corresponding frames and review target gameplay playback.
  Record recognizable features, deviations and unverified judgments; matching
  move names/numbers alone does not establish the intended moveset resemblance.
- For custom body geometry, verify hurtboxes follow target torso/limbs through
  standing, crouch, airborne, extension and retraction poses. Prove contact on
  a vulnerable limb outside the movement collider and misses through source/old-limb
  space no longer occupied by any target hurtbox. Check vulnerability-state boundaries, both
  facings, freeze/resume and target reach edges; save/load must preserve geometry.
  Measure changed body/reach envelopes and applicable multihit/spacing effects
  without claiming identical balance. Inspect target-sized movement contact,
  shield coverage, ledge alignment and grab/victim/release placement where affected.
- Enter Character Lab directly; edit/save/reload and use that tune in a match.
  Check palettes and existing pickup/grab/throw interactions as applicable.
  For an exact JSON round-trip comparison, account for JSON's conversion of
  numeric negative zero to zero. Normalize only that representation difference
  on both sides and record the affected paths; preserve every other field and
  numeric value. Keep a failed strict comparison when it identified this issue.

Use actual keyboard/gamepad events through the normal input pipeline for input
claims. Deterministic step/probe injection is useful for frame measurements but
does not alone verify physical bindings. Report simulated gamepad testing as
simulated, and human controller feel as untested unless a person checked it.

Save expected/measured data, screenshots, page/asset errors and commands in
the evidence record. A screenshot establishes appearance, not collision
delivery; an assertion against a move constant establishes data, not gameplay
timing. Require evidence at the layer the claim describes. If tooling blocks a
layer, finish independent checks and report precisely what remains unverified.
