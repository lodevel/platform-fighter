# Combat physics follow-up — 9 September 2026

The deterministic 2D engine remains the gameplay authority. This pass fixes
demonstrated state/physics defects and corrects the verified directional-
influence rule. Knockback speed, gravity, hitstun, and defensive timing constants
remain at their authored values.

## Reproductions and fixes

| Reproduction | Before | Corrected behavior |
| --- | --- | --- |
| Exhaust jumps/air dodge, take a hard launch, press an unavailable jump/dodge/attack/special after hitstun | The raw press cleared tumble even though no action started | Only a successful action clears tumble; an eventual unteched landing still knocks down |
| Press shield or dodge during the last frozen hitlag frame, hold through a real floor collision | Hitlag latched the button and discarded its tech edge | The existing eight-step tech window accepts the edge while a hard launch is queued |
| Spend all jumps, use recovery, then get hit out of special fall | Recovery restored the entire jump budget | Recovery preserves spent and remaining jumps; landing/ledge attachment still replenishes them |
| Launch into the side of a platform whose center is below the fighter | Side contact counted as a landing and could cause knockdown/reset air resources | Upward live Matter normals establish floor support; side/ceiling/sensor/disabled contacts do not |
| Leave an ongoing contact as its normal changes from floor to side | A start/end counter retained the old support classification | Grounding reads the current pair rather than a stale counter |
| Place a trap, then freeze, hit, or grab its owner | Hitlag froze its clock; damage/capture erased the independent object | Flight, arming, and expiry advance once per simulation step independently of owner lockout |
| Reset a stock/round or destroy an owner with an armed trap | Cleanup shared the ordinary attack interruption path | Explicit placed-object cleanup still removes sensors on reset/destroy |
| Trigger Link's remote bomb | Explosion appeared one simulation step after the move became active | The sensor appears at elapsed 11 (human frame 12), stays for the move's two active steps, then expires |
| Influence a launch with the stick | Even light hits and horizontal launches rotated, with a maximum 18-degree angle | Eligible tumble launches use a 0.17-radian limit; nearly horizontal launches keep their angle; over-length keyboard diagonals normalize to a unit stick |

The attack animation query exposes live charge state and landing recovery;
stored charge alone does not request a charging pose.

## Measured units and trajectory

`Character.physics.test.ts` drives Phaser's bundled Matter implementation with
real `Engine.update(1000 / 60)` calls. It does not mock gravity, integration,
collision normals, or the solver. The scene adapter supplies only body creation
and event registration. Every step calls `applyInput`, updates Matter, then calls
`applyPostPhysicsVelocityConstraints`, matching the match scene's contract.

Body positions are viewport pixels. Matter velocity is pixels per base step;
at the fixed 60 Hz step, a velocity of 9 moves 9 pixels on the release frame.
For the generic Wolf fixture (mass 16), a base horizontal knockback of 12 with
zero percent scaling produces launch speed 9 and 18 hitstun ticks. Measurements
include the release integration followed by all 18 hitstun integrations:

| Matter gravity Y | Release speed X | Final speed X | Horizontal displacement | Final speed Y | Vertical displacement |
| --- | ---: | ---: | ---: | ---: | ---: |
| 0 | 9 | 2.88 | 112.86 px | 0 | 0 px |
| 1, scale 0.001 | 9 | 2.88 | 112.86 px | 5.27777778 | 52.77777778 px |

Both traces are checked against independent arithmetic-series expectations at
seven decimal places. With `n = 18`, launch decay `d = 0.34`, and initial speed
`v = 9`, horizontal travel is `(n + 1)v - d*n*(n + 1)/2`. Gravity accumulates
separately at `0.001*(1000/60)^2` pixels per step squared. Other real-Matter tests
verify exact frozen positions, a permitted SDI flick, and no reverse acceleration
after launch momentum is removed by a wall, ceiling, or floor collision.

These are controlled displacement measurements, not KO-percent predictions.
Stage dimensions, launch position, target mass, DI, collisions, and post-hitstun
movement all affect whether a hit crosses a blast boundary. Old comments claiming
specific KO percentages from a model without launch decay have been removed.

The DI sweep checks 11 launch angles in both directions and five axial/diagonal/
neutral stick inputs: 55 real-Matter trajectories. A separate weak-hit case
verifies non-tumbling launches cannot be redirected. Release speed magnitude is
unchanged, and the remainder of each full-hitstun trajectory is checked at seven
decimal places. Example measurements with gravity disabled are below. Screen
angles use right = 0 degrees, up = -90 degrees; stick Y points down. Travel starts
after the release integration so the independently permitted SDI nudge is excluded.

| Original angle | Stick X,Y | Release angle | Release velocity X,Y | Remaining hitstun travel X,Y (px) |
| ---: | --- | ---: | --- | --- |
| -90 | 1,0 | -80.25971748 | 1.52264114, -8.87026290 | 17.57127877, -102.36283389 |
| -90 | 1,1 | -83.11258018 | 1.07926975, -8.93505326 | 12.45477286, -103.11051466 |
| -45 | 1,1 | -35.25971748 | 7.34889293, -5.19555317 | 84.80622436, -59.95668361 |
| -5 | 0,1 | -5 | 8.96575228, -0.78440168 | 103.46478134, -9.05199544 |
| 180 | 0,1 | 180 | -9, 0 | -103.86, 0 |

## Reference boundary

[Nintendo's Ultimate technique page](https://www.smashbros.com/en_US/howtoplay/technique.html)
documents directional air dodging and simultaneous jump/attack short hopping.
It does not establish this project's tech, recovery, or knockback constants.

The original author's [SSBU calculator implementation](https://github.com/rubendal/SSBU-Calculator/blob/master/js/formulas.js)
uses launch conversion 0.03, decay 0.051, and hitstun factor 0.4. Their normalized
product explains the existing `0.34 * 2 = 0.68` design choice here, but does not
convert Ultimate distance units into this game's viewport pixels. The same
calculator uses DI parameter 0.17 radians. Its [knockback eligibility code](https://github.com/rubendal/SSBU-Calculator/blob/master/js/knockback.js)
requires tumble and excludes nearly horizontal launch angles.

[HDR's own developer documentation](https://hdr-development.github.io/hdr-website/engine/di.html)
independently identifies its changes from Ultimate: increasing the maximum from
9.74 degrees to 18 degrees and permitting DI on non-tumbling hits. This corroborates
that the previous 18-degree/all-launch behavior here followed those modded rules.

The corrected rule uses 0.17 radians and this engine's existing tumble threshold.
The reference's horizontal exclusion is mirrored into this engine's signed world
axes. Keyboard diagonals are normalized because this input API can supply both
axes at 1; analog magnitudes below 1 are preserved. SDI still moves position during
hitlag, while DI samples the release frame and preserves launch magnitude. This
does not add Ultimate's separate launch-speed influence (LSI), controller-specific
raw-stick calibration, or a conversion of its knockback/weight units. These sources
are primary community implementation/developer evidence, not an official Nintendo
specification or proof of full physics parity.

The eight-step tech window is this engine's current contract. It includes the
press step and advances during hitlag; an expired attempt enters the existing
lockout. No claim is made that this reproduces Ultimate's exact tech timings.

## Verification

Run with the project's working WSL Node 20 environment:

```sh
npx --yes --package=node@20 node node_modules/vitest/vitest.mjs run \
  src/characters/Character.physics.test.ts \
  src/characters/Character.test.ts \
  src/characters/combat.test.ts \
  src/characters/Link.specials.physics.test.ts
```

Failing-before runs reproduced the invalid-action, hitlag-tech, jump-reset,
sidewall/sensor, and independent-trap defects before their respective fixes.
The final focused run passed 583 tests across four files (32 real-Matter Character
physics tests, 452 Character behavior tests, 92 combat math tests, and 7 Link
special physics tests). The DI correction had 21 failing-before regressions across
math and real-Matter integration; the remote detonation test reproduced its delayed
sensor before the arming fix.
