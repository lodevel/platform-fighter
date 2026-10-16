# Combat integration review

Reviewed 14 September 2026. Tests use Phaser's bundled Matter engine, live Link
fighters, `HitboxDamageHandler`, `applyHitDetailed`, mutual hitlag, launch decay,
gravity, actual collision events and the post-physics velocity contract.

## Reproduced failures

The earlier normal-move tests struck stationary sensors. They verified strike
windows and damage, but could not establish whether a launched fighter remained
in range for the following strike.

Against a live, idle Link at 0%, falling forward air dealt only its first 8%.
The first contact at elapsed 15 replaced the defender's falling velocity with
`(0.8144, -0.4072)`, while the attacker kept falling. The second swing at elapsed
23 missed. This was already reproducible at ordinary spacing, with no defensive
input. Back air connected against an idle opponent, but a fresh air jump after
its six-step hitstun escaped the second kick. Up smash also gave the defender
actionable intervals between its three swings.

The pinned vanilla [forward-air script](https://github.com/WuBoytH/SSBU-Dumped-Scripts/blob/59004685238a3f6f93bae905d3a4e079701c40b4/smashline/lua2cpp_link/link/AttackAirF.txt)
uses the special angle value 367 on airborne sword regions and ordinary angles
43/47 against grounded fighters. [Back air](https://github.com/WuBoytH/SSBU-Dumped-Scripts/blob/59004685238a3f6f93bae905d3a4e079701c40b4/smashline/lua2cpp_link/link/AttackAirB.txt)
and the first two [up-smash swings](https://github.com/WuBoytH/SSBU-Dumped-Scripts/blob/59004685238a3f6f93bae905d3a4e079701c40b4/smashline/lua2cpp_link/link/AttackHi4.txt)
use fixed-knockback declarations. The existing small, ordinary launch vectors
were an incomplete approximation of those linking hits. Source files were
retrieved directly with `Invoke-WebRequest`; the web reader returned cache misses.

## Bounded correction

Forward air's first strike carries the attacker's pre-collision velocity into an
airborne victim's launch. The snapshot is taken before collision callbacks can
freeze the attacker, so simultaneous victims receive identical carried motion.
The carry is added after DI; only the attack's own launch component decays or
qualifies for tumble. Grounded victims use the existing ordinary launch.

Authored minimum hitstun covers the interval to the following strike: fair 8,
bair 9, and up smash 15 then 16 simulation steps. These floors preserve modest
launch strength while removing accidental actionable gaps. Finishers retain
ordinary damage/percent/weight scaling. The move and hit-window serializer
preserves both the hitstun floor and the airborne-carry flag.

This is an engine calibration, not an exact implementation of Ultimate's 367
angle, fixed-knockback formula or skeletal collision volumes. There is no
position snap, ongoing target tracking or guaranteed conversion at arbitrary
spacing. The extreme-range regression explicitly allows outward SDI to escape
fair. Back air and up smash still use their existing launch-vector geometry;
all combinations of opponent movement and stage layout have not been calibrated.

## Landing and item boundary

Review of the new ordinary landing state found a separate order-of-operations
bug: items resolve before `Character.applyInput`, but a fresh Matter touchdown
was only converted into recovery inside that input call. A bomb could therefore
be thrown on the first locked landing step. Ordinary pickup also lacked a
commitment gate entirely.

`canUseItemsBeforeInput()` now predicts the upcoming landing drain without
advancing state. It recognizes pending touchdown, residual aerial landing
context and the last recovery step, and checks attack, charge, shield, hitlag,
hitstun, grab, dodge, helplessness, jump squat, knockdown, getup and ledge locks.
Pickup and remote-bomb throw both use this query.

Remote throw presses have a nine-step buffer, retaining press-time direction
and facing. The queued action belongs to the held entity and the fighter's
position-reset generation. Expiry, drop/reacquisition, replacement, elimination
and reset discard it. The pickup press still cannot throw its newly acquired
bomb. New tests execute adapter, pickup, Character input, Matter and post-physics
in the same order as the match.

Link's ordinary landing target is five steps for hard landings and two for soft
landings. The reference does not establish this engine's terminal-speed duration
threshold. [Ultimate Frame Data: landing stats](https://ultimateframedata.com/stats)

## Verification

- `Link.combat.integration.physics.test.ts`: 17 tests, including rising/falling
  fair, both facings, three target masses, actual directional dispatch, multiple
  victims, defensive jump/dodge attempts, ground/air distinction, outward SDI,
  independent DI/decay of carried motion, reset and unrelated-normal behavior.
- Eight affected combat/Character/serializer files: **797 tests passed**.
- Final item/combat/ordinary-landing subset: **86 tests passed** across seven
  files. The remote-bomb file includes five new landing/buffer lifecycle cases.
- Focused logs: [combat tests](combat-focused-tests.txt) and
  [item landing tests](item-landing-tests.txt). Root verification covers the
  final aggregate suite, production build and browser playtest separately.

The focused runs occasionally print Vite's occupied WebSocket-port message when
another agent runs a test server. Test assertions and exit status pass.
