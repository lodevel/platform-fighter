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
| Input selection | `groundedAttackInput.ts`, `aerialAttackInput.ts`, `Character.ts`, `src/input/PlayerControlsInput.ts`; test the route actually used in a match |
| Instantiation/selection | `fighterRegistry.ts`, registry ID lists, `roster.ts`, roster ordering and `index.ts` exports |
| Authoring/save/load | `authorableCharacterRegistry.ts` compiled-kit map and slot export names, `characterSerializer.ts`, `characterFactory.ts`, `src/characterBuilder/characterStorage.ts` and match character snapshots |
| Animation | `groundedNormalDriver.ts`, `movesetAnimationDriver.ts`, `movesetAnimationCues.ts`, `defensiveAnimationState.ts`, `spriteAnimationDriver.ts` (`MOVE_SHEET_KEYS`, `MOVE_SHEET_SPECS`, `attackMoveToSheets`), `simulationSpriteAnimation.ts`; inspect runtime ID lists and dedicated clip routes |
| Assets/presentation | `src/assets/manifest.ts`, `visualScale.ts`, `handAnchors.ts`, `palettes.ts`, `assets/characters/<id>/frames.json` and final animation strips |
| Live contact | `attackHitWindows.ts`, `attackCollisionShapes.ts`, `src/match/HitboxDamageHandler.ts` and real Matter contact |
| Armour / variants | `AttackMove.armorWindows` (super armour, optional `minChargeRatio`) in `attacks.ts` and `Character.applyHit`; `downSpecialKind: 'shockwave'` (`aerialVariant`, mash `repeat`) in `downSpecialSchema.ts`; both parsed by `characterSerializer.ts` |
| World entities | Character special runtime, relevant `src/items/` adapters, `src/scenes/MatchScene.ts` rendering and cleanup |

Register forward/default attack slots deliberately, then explicitly wire
directional tilts/smashes/dash attacks and grab data. Aerial direction controls
dispatch. Preserve move IDs and export naming consumed by the authorable
registry. A fighter selectable in the roster must also be instantiable from
its saved Lab data; check optional follow-ups and nested tuning survive.

Keep random behavior seeded and gameplay on the fixed-step simulation. Use
each producer's coordinate contract for entities, including scaled or offset
stages. Some entities already provide world coordinates (traps currently do);
apply a stage-to-world transform only to values still in stage coordinates.
Test a visible projectile and its collision at the same position.

Legacy `data/characters/*.json`, `npm run validate:characters`,
`docs/CHARACTER-CHECKLIST.md` and
`.claude/skills/add-character/verify-character.sh` have historical coverage.
The script checks text presence; it cannot establish correct routing or play.
Inspect their actual fighter coverage before relying on them. The current
authorable registry is important for compiled fighters absent from legacy JSON.

## Choose meaningful checks

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

`npm run build` includes palette generation through `prebuild`. If using a
lower-level build command, account for applicable generated assets. Do not
reuse a stale bundle or claim a command passed when it failed. Environment
workarounds belong in the evidence record, not in gameplay code.

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

A probe must exercise the engine the way a player does, or its result is
about the probe (Donkey Kong, 2026-09-25: the first probe reported zero
scenarios with exit 0 because its page-side step helper returned nothing,
then four scenario groups failed for probe reasons). Checklist before
trusting a probe's verdict: the page helper returns per-frame state and each
scenario records at least one check; input objects use the fields the human
input path actually builds (`attack` + a stick flick from rest for a smash —
there is no `attackHeavy` for keyboard slots); opponents spawn outside the
sum of the two body half-widths, otherwise Matter's contact resolution
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
- Inspect startup/contact/gap/recovery art, hitlag/pause and gameplay-scale
  weapon/body alignment. Capture images for altered poses or geometry.
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

Use actual keyboard/gamepad events through the normal input pipeline for input
claims. Deterministic step/probe injection is useful for frame measurements but
does not alone verify physical bindings. Report simulated gamepad testing as
simulated, and human controller feel as untested unless a person checked it.

Save expected/measured data, screenshots, page/asset errors and commands in
the evidence record. A screenshot establishes appearance, not collision
delivery; an assertion against a move constant establishes data, not gameplay
timing. Require evidence at the layer the claim describes. If tooling blocks a
layer, finish independent checks and report precisely what remains unverified.
