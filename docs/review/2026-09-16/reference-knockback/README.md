# Reference knockback for Link's measured strikes

Continuation after the [launch and gravity recovery measurements](../README.md).
This pass converts forward tilt and both up-air strengths to explicit base
knockback, growth and angle. Fighter reference weight is independent of Matter
mass. Other moves retain their authored launch model.

## Authored values and units

| Strike | Damage | Base KB | Growth | Angle | Direction |
|---|---:|---:|---:|---:|---|
| Forward tilt | 13 | 55 | 82 | 361 | Facing |
| Up air, early | 15 | 23 | 93 | 85 | Away from Link's position |
| Up air, late | 13 | 18 | 88 | 85 | Away from Link's position |

The pinned vanilla [AttackS3](https://github.com/WuBoytH/SSBU-Dumped-Scripts/blob/59004685238a3f6f93bae905d3a4e079701c40b4/smashline/lua2cpp_link/link/AttackS3.txt)
and [AttackAirHi](https://github.com/WuBoytH/SSBU-Dumped-Scripts/blob/59004685238a3f6f93bae905d3a4e079701c40b4/smashline/lua2cpp_link/link/AttackAirHi.txt)
declarations supply these values and facing rules; copies are in `sources/`.
When attacker and defender have exactly equal x coordinates, up air keeps
attacker facing as the project's explicit tie rule.

Reference weights are [Link 104](https://github.com/rubendal/SSBU-Calculator/blob/gh-pages/Data/link/data.json)
and [Donkey Kong 127](https://github.com/rubendal/SSBU-Calculator/blob/gh-pages/Data/donkey/data.json).
Other fighters currently use neutral weight 100 when receiving a reference
strike; they need independently authored weights before roster parity is claimed.
Physical mass continues to control Matter collisions and legacy launch scaling.

For the measured fresh attacks with no rage, let `P` be post-hit percent and
`D` be the hit's damage. Damage is accumulated once:

```text
KB = ((P/10 + P*D/20) * 1.4 * 200/(weight+100) + 18) * growth/100 + base
speed = KB * 0.03 * 5 pixels per game unit
decay = 0.051 * 5 = 0.255 pixels per fixed step
ordinary hitstun = floor(max(5, KB*0.4)) - 1
```

The [calculator formulas](https://github.com/rubendal/SSBU-Calculator/blob/master/js/formulas.js)
and [launch implementation](https://github.com/rubendal/SSBU-Calculator/blob/master/js/knockback.js)
supply the ordinary math, angle 361 resolution, grounded horizontal-speed
adjustment and tumble threshold of KB >= 80. The existing DI rotation now uses
that tumble decision for reference attacks. Decay travels with each queued
launch, so an interrupted reference launch cannot change a later legacy hit.

## Integration and authoring

- Reference base, growth and angle survive move windows, collision delivery,
  hitlag, crouching, and the project's existing sweet-spot, rage and stale modifiers.
- Link/DK weight and the new move fields survive JSON save/load, custom factory
  construction and Lab edits. Old files inherit the fighter's reference weight.
  The Lab shows reference controls and hides inactive legacy vector controls.
- Old move records without reference fields retain their prior behavior. Legacy
  vector fields remain in converted records for format compatibility; they do
  not participate in those reference launches.
- Reference knockback combined with charge is rejected during import until
  charge interpolation supports the new units, avoiding silent loss of data.
- The preceding collision-aware gravity correction remains active. Tests cover
  weight versus mass, release timing, decay, DI/tumble, late up air, real wall
  and ceiling contacts, and the first steps after hitstun.

## Measurements and verification

The independent numerical fixtures expect the following results, before DI or
Matter's first integration. Percent is the defender's meter before contact.

| Strike / defender | KB | Speed (px/step) | Ordinary hitstun |
|---|---:|---:|---:|
| Forward tilt / Link 0% | 80.733529 | 12.110029 | 31 |
| Forward tilt / Link 100% | 165.145294 | 24.771794 | 65 |
| Forward tilt / DK 100% | 155.480705 | 23.322106 | 61 |
| Early up air / Link 100% | 164.515000 | 24.677250 | 64 |
| Late up air / Link 100% | 136.204706 | 20.430706 | 53 |

The real-contact fixture exports [launch traces](launch-after.json), using the
same five cases as the preceding pass. Wall impact now returns Link to the
floor in tumble and enters knockdown; zero hitstun therefore does not imply
an immediately available action. The production probe keeps that distinction.

The stronger trajectories required better fixture isolation: original arena
platform masks are disabled during measurement, the wall target establishes
ground contact before the hit, and the attacker moves aside after contact so
soft fighter separation does not add a second impulse at recovery. Target
movement stays entirely under the real simulation after staging.

The wall comparison also exposed a fixture configuration gap. Phaser's
`MatterPhysics` sets normal/tangent resting thresholds to **4/6**, while raw
Matter defaults to **2/sqrt(6)**. The fixture now uses Phaser's settings and
restores the module defaults afterward. The old short trajectories did not
expose this tangential-friction difference. No gameplay solver value changed.

The open-world KO regression uses the actual flat-stage blast zone and Link's
supported ground-center position. At 0/100%, neither strike crosses a boundary
during hitstun; at 200/300%, tilt crosses right and up air crosses top. Each case
checks the crossing and exactly one KO notification. These are project regression
brackets without intervening platforms, not Ultimate KO thresholds.

- [Aggregate tests](full-tests.txt): **331 files / 10,616 tests passed**.
  The runtime and authoring implementation remained unchanged afterward.
- [Final launch fixture rerun](launch-final-tests.txt): **6 tests passed** after
  correcting contact setup, coordinate alignment and Phaser's solver defaults.
  These final fixture-only changes were verified separately from the aggregate.
- [TypeScript](typecheck.txt) and [production build](build.txt): passed.
  Artifact: **index-CG_wzv95.js**.
- [Production trace and Lab report](production/link-launch.json): **5 scenarios,
  349 frames** agree with the standalone physics fixture; maximum position
  discrepancy is below `2.6e-12` px and velocity discrepancy below `1.2e-13`
  px/step. Ceiling recovery returns to 8 px/step. Reference controls and label
  fit pass at 1280x720 and 390x844. No page errors or failed resource requests.
- Whitespace verification passed with `git -c core.autocrlf=false diff --check`.

To regenerate with Node 20 and the production preview at `/platform-fighter/`:

```sh
LINK_LAUNCH_TRACE_PATH=docs/review/2026-09-16/reference-knockback/launch-after.json node node_modules/vitest/vitest.mjs run src/characters/Link.launch.physics.test.ts --maxWorkers=4 --minWorkers=1
PF_LAUNCH_PHYSICS_REPORT=docs/review/2026-09-16/reference-knockback/launch-after.json node tools/link-launch-calibration.mjs
```

## Limits and next work

This is a reference **launch calculation**, not complete Ultimate trajectory
parity. It deliberately preserves the project's current hitlag, uniform staling,
fresh multiplier 1, maximum rage 1.15, ordinary Matter gravity and control after
hitstun. The calculator instead has weighted stale slots, fresh bonus 1.05,
maximum rage 1.1 and separate authored/staled damage contributions. No current-hit
1v1 or short-hop damage rule is newly introduced here.

Next, resolve damage-energy momentum after hitstun, gravity launch boost,
vertical tumble gravity and tumble speed-up together. The ordinary hitstun count
above does not include the reference's time compression. Keep the production
trace comparison while introducing those rules, then migrate more of Link's kit
and author remaining fighter weights. Precise directional-dodge calibration,
human controller/audio/balance acceptance remain open. Replay playback stays
ultralow priority and 3D remains deferred.
