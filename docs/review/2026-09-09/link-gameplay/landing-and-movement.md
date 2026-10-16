# Landing timing and Link movement calibration

Checked 9 September 2026. The fixed 2D physics engine remains authoritative.
`Character.landing.physics.test.ts` uses Phaser's actual bundled Matter engine,
collision normals, floor solver, and 60 Hz integration. Every simulation step
runs input, Matter, then the post-physics velocity contract.

## Landing behavior

Landing recovery now resolves before shield, dodge, jump, attack, and movement
arbitration. Touchdown is recovery step 1. A six-step penalty blocks steps 1–6;
step 7 accepts an action. Previously touchdown stamped six and then six more
steps elapsed before input could act. A one-step penalty similarly lasted two.
The aerial's ordinary attack cooldown is replaced by the landing penalty.

The regressions cover startup, active, recovery, and both autocancel boundaries;
last-step buffered jumps and attacks; hitlag freezing recovery; sensor cleanup;
and drop-through commitment. A zero-penalty autocancel now permits defense on the
same input step. Previously the still-active aerial swallowed the shield edge
before landing interrupted it. Thirteen failing-before cases reproduced the
extra step, lost autocancel defense, delayed buffers, and drop-through bypass.

Link's forward aerial retains a narrow landing flag after commitment ends:
elapsed 51 remains punishable; elapsed 52 autocancels. This does not extend the
move's action lockout. A successful replacement action, hit, capture, ledge grab,
or reset discards the old flag. The schema supports this distinction instead of
forcing every completed aerial to autocancel. The reference combines UFD's
gameplay timing with the pinned vanilla landing flag and motion cancellation
records described in [the normal-move reference](reference.md).

The concrete Link boundary tests check nair `[0,3)` / `35+`, fair `52+`, bair
`28+`, uair `[0,10)` / `42+`, and dair `[0,9)` / `64+`, with move penalties
6 / 11 / 6 / 14 / 19. [Ultimate Frame Data: Link](https://ultimateframedata.com/link)

Autocancel currently removes the move-specific penalty entirely. A separate
ordinary hard/soft landing state is still absent; Ultimate lists Link's hard
landing as five frames and universal soft landing as two. This pass does not
claim those are implemented. [Ultimate Frame Data: landing stats](https://ultimateframedata.com/stats)

## Units, targets, and fitted parameters

Calibration uses **5 physical viewport pixels per reference unit**. This is a
chosen scale for Link's movement, not a claim that stage geometry or every combat
distance has already been converted. Ground run speed stays at 7.8 px/step for
compatibility; the reference value would map to 7.67. Air speed becomes 4.62,
air acceleration 0.25, ordinary fall speed 8, and fast fall speed 15.2.
The targets come from Link's air speed 0.924, air acceleration 0.05, and fall
speeds 1.6 / 3.04. [Ultimate Frame Data: Link stats](https://ultimateframedata.com/link)

Full/short hop height targets are 27.8 / 13.38 reference units, or 139 / 66.9
physical pixels. Reference full/short/fast-full/fast-short durations are
45 / 33 / 30 / 22. [Ultimate Frame Data: jump stats](https://ultimateframedata.com/stats)

Matter contributes `0.001 × (1000/60)² = 0.277777…` px/step². Link's additional
full-rise and descent acceleration is **fitted** at 0.34, giving 0.617777… total.
The short-rise addition is 0.202222…, giving 0.48 total (reference gravity 0.096
times the chosen scale). These are explicit separate arc parameters, not a
literal port of all of Ultimate's jump internals.

The full-hop impulse is 13.414603174603174; the short-hop impulse is
8.25529411764706 px/step. They are derived from the discrete upward displacement
sum `H = n*v - g*n*(n+1)/2`: full rise uses n=21 / H=139 / g=0.617777…;
short rise uses n=17 / H=66.9 / g=0.48. Actual floor settling introduces less
than 0.001 px difference from that independent ballistic prediction.

An explicit short-hop impulse selects its arc during jumpsquat; releasing the
button after takeoff no longer changes Link's full hop into an intermediate
height. The optional rise/short-rise/short-impulse/air-speed fields are validated
and retained through JSON serialization. Other fighters omit these additions
and retain their existing movement behavior. Airborne aerials also retain their
captured facing while drifting; free-air turning outside attacks remains the
existing behavior.

## Measured before and after

Takeoff occurs on input step 4 in every grounded-jump trace: the initial press
plus the existing three-step squat. Duration below counts integrations from
takeoff through the first resolved floor contact, inclusive. Contact step is
also listed to make the counting convention explicit.

| Jump | Before height px | After height px | Before contact step | After contact step | Before duration | After duration | Reference duration |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Full | 297.722041 | 138.999819 | 86 | 48 | 83 | 45 | 45 |
| Short | 50.962041 | 66.899819 | 36 | 35 | 33 | 32 | 33 |
| Full + fast fall | 297.722041 | 138.999819 | 67 | 34 | 64 | 31 | 30 |
| Short + fast fall | Not measured | 66.899819 | Not measured | 26 | Not measured | 23 | 22 |

The short/full height ratio changes from approximately 0.17117 to 0.48129,
matching the reference height ratio. All four durations are within one step of
their targets. A late jump release reproduces the full-hop trace. Sustained
air input reaches 4.62 px/step; actual descent caps are 8 and 15.2, within
floating-point tolerance.

Knockback constants are unchanged. An additional real-Matter regression compares
Link with and without the new rise acceleration through hitlag and every
hitstun step: positions and velocities are identical. Ordinary movement shaping
starts after that launch lockout. The existing launch sweep and collision
measurements remain in [the combat evidence](../combat-physics-followup.md).

Remaining calibration boundaries include normal landing recovery, distinct air
jump height, free-air turning, and collision/body geometry. The measurements
establish this grounded-jump calibration; they do not establish complete
Ultimate physics parity.

Reproduce the printed arc observations:

```sh
PF_PHYSICS_MEASUREMENTS=1 npx --yes --package=node@20 node \
  node_modules/vitest/vitest.mjs run src/characters/Character.landing.physics.test.ts
```

The final broad focused run passed 705 tests across Character behavior, real
Matter physics, Link normals/bow/bomb/spin, serialization, and the authorable
registry. Follow-up launch-isolation and custom-override checks are also covered
in the targeted closeout run. TypeScript checking passed.
