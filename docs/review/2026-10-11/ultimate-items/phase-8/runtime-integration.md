# Phase 8 runtime integration

Implemented for the active Donkey Kong/Pikachu roster. Initial delivery honored
the user's request to omit checks. The user subsequently authorized targeted
verification: carry source/Matter evidence is in `verification/carry/`, container
evidence in `verification/container-results.json`; exact-build browser acceptance belongs
to the coordinator. This record does not establish native common-status parity.

## Source and state contracts

- Container fields and source labels: `sources.json`, `container-contract.md`
  and `src/items/itemContainer.ts`. Existing native Crate throw kinetics stay
  intact. Barrel/Capsule append to the catalog, preserving earlier indices.
- Pikachu callbacks use retained
  `docs/review/2026-10-06/pikachu-character/sources/scripts/pikachu/ItemHeavy*.txt`:
  pickup 4; forward release 22; back reverses 19 **before** release 22;
  up 15/down 14. Command offsets are retained independently of sprite sockets.
  Strong scripts have the same chronology. Native motion-end/action-cancel
  adapters retain the project's unit-rate action convention; unresolved common
  pickup/throw rate consumers are not claimed as recovered.
- Heavy throw speeds/angles reuse the existing native common heavy-item table;
  Pikachu uses its own sourced .93 toss-speed multiplier, DK retains 1.09.
  DK's existing after-release back reversal remains unchanged. The earlier
  DK down-strong -90 degree defect is corrected to the pinned Item_throw
  heavy table's -70 degrees (ordinary remains -90); both fighters consume it.
- Pikachu heavy carry is ground-only, no attack/special/dash/shield/dodge/jump,
  throws in four directions ordinary/strong. Support loss and landed damage
  release the heavy item without a thrown attack. DK retains its existing
  SuperLift jump, fall, pass, throw and conditional reaction resistance. Its
  cliff/footstool air policy remains explicitly DK-only; Pikachu does not
  inherit those native DK exception flags.

## Explicit adaptations

- Pikachu heavy common lift status/kinetic consumer is unavailable. The retained
  fighter_param lift speed .84208 uses a direct native-parameter-supported
  cap adapter (4.2104px/frame); acceleration remains calibrated .5 ordinary
  ground acceleration, and immediate turn registration remains authored. Heavy wait
  holds the native HeavyGet frame25 drawing (selector age24). It does **not**
  substitute the light-item SquatWaitItem drawing.
- DK slow/middle/fast carry drawings select normalized speed using retained
  native fighter_param middle=.5/fast=.75 as a parameter-supported adapter. Inspected
  retained SuperLiftWalk init/exec/main functions delegate to
  `sub_walk_uniq_process_init_common`/`sub_walk_uniq_process_main_common`;
  the acquired source does not contain those common implementations. The threshold
  consumer is inferred and drawing playback rate is authored, not native gait parity.
- Barrel ground motion uses the supplied native ground brake/cap with the
  helper's authored near-zero stop. Weak melee/projectile hits start it at the
  cap in the attack direction. Contact opens the Barrel; edge loss resumes
  native item gravity. Rolling uses the existing horizontal platform bounds;
  slope-specific projection/acceleration is not implemented. Existing TTL owns
  retirement. Rolling barrels cannot be picked up until stopped.
- Container receiving geometry uses item bounds/radius adapters. Melee damage
  comes from the live hitbox plugin; one strike body/re-hit window damages a
  container once. Rehit timestamps use the owning attack age; Hammer uses
  its item identity/motionElapsed and existing source interval, so hitlag
  cannot mature its cooldown or transfer it onto a newly picked Hammer. Projectiles collect
  containers in the same travel-order list as fighters/reflectors. Exact ties
  prioritize reflector, fighter, container (authored world-item arbitration).
- Capsule's existing one-sphere thrown contact adaptation remains. It may hit
  its user after first clearing the release body; downward throws retain owner
  immunity. Crate/Barrel direct thrown attacks retain ordinary owner exclusion.
  Container blasts include their user except Capsule downward throws, unlike
  Bob-omb's separately retained always-immune user rule.

## Opening and lifecycle

`MatchScene.openContainer` supplies one private `item-container` seeded draw set
and chooses one enabled eligible item definition. Food chooses one variant and
all emitted copies use it. Crate/Barrel permit Capsule contents; Capsule self
recursion is excluded by the helper's authored rule. Empty eligible catalogs
produce zero contents. Content count/distribution and small deterministic
horizontal separation remain authored as recorded in the source contract.

The entity commits one explicit falling/held/grounded-to-broken transition, then
the scene detaches inventory, interrupts heavy carry/action, removes the old
visual and trajectory, and emits contents or one explosion. Newly emitted
contents survive the enclosing flight loop's survivor replacement. Crate/
Capsule thrown terrain impacts open; Barrel terrain contact starts rolling.
Spawn falls and passive damage drops settle without a thrown-impact opening.

Explosive Capsule contact omits the ordinary thrown-hit packet. Nonexplosive
contact uses `thrownItemHit`'s action-specific Wiki damage once. Explosions use
the helper's action-specific packet once, with common receiving/contact,
shield, invulnerability, hitlag and match combat modifiers; no additional toss
power or velocity damage is added to the supplied Wiki final damage.
Explosions can open other containers and chain Bob-ombs through the shared
world-item pass. Broken/despawned entries do not run another trajectory.

Held containers render upright at their registered attachment without ordinary
weapon swing angle/foreshortening. Barrel rolling rotates its image around its
body centre while the item root remains at the floor. Retirement clears strike
latches; match resets clear the map. F3 continues to own diagnostic shapes.

Container positions always represent the bottom root, including while held.
Melee and chain-blast receiving centres subtract native mapBottom times the
item's pixelsPerUnit; emitted blast centres subtract centreAboveRoot. Projectile
receiving applies the same registered bottom-relative bounds offsets in held
and free states. Bob-omb's separate held-centre convention is unchanged.
These registrations remain unverified in a running match.

Previous ground turn-and-fire facing, shooting anatomy/charge feedback,
pass-through item landing and removed decorative attack rings are preserved.

## Pending acceptance

Targeted source/Matter checks are recorded separately; controller feel and native
common-consumer parity remain unqualified. Both facings, release boundaries,
armor/drop conditions, seeded contents/explosion branches, platform settlement,
rolling/contact, interruption, pause/hitlag and stock/reset still require match
acceptance when the user asks for checks. Build/publication belong to the
coordinator and are distinct from gameplay verification.
