# Link charged forward-smash reference launches

Latest continuation: [down-smash front/back reference launches](../down-smash-launches/README.md).

Continuation after [down-air reference launches](../down-air-launches/README.md).
Link's first inner hit, sword tip and optional second slash now use separate
reference launch records. Charging increases damage while preserving each
record's base knockback, growth and angle.

## Source records and charge

| Strike | Damage at 0 / 30 / 60 charge frames | Base KB | Growth | Angle |
| --- | --- | ---: | ---: | ---: |
| First slash, inner sword | 7 / 8.4 / 9.8 | 45 | 12 | 69 |
| First slash, tip | 14 / 16.8 / 19.6 | 30 | 100 | 361 |
| Second slash, sword | 13 / 15.6 / 18.2 | 85 | 89 | 48 |

The pinned vanilla [AttackS4](https://github.com/WuBoytH/SSBU-Dumped-Scripts/blob/59004685238a3f6f93bae905d3a4e079701c40b4/smashline/lua2cpp_link/link/AttackS4.txt)
and [AttackS4S2](https://github.com/WuBoytH/SSBU-Dumped-Scripts/blob/59004685238a3f6f93bae905d3a4e079701c40b4/smashline/lua2cpp_link/link/AttackS4S2.txt)
provide these records. All use attacker-facing orientation, ordinary recipient
weight, zero fixed knockback and the same records for ground/air recipients.
The first slash's torso record instead uses angle 60; the second slash's
arm/torso records deal 12 damage with the same launch parameters. The current
rectangles represent the inner sword, tip region and second sword respectively.

The pinned calculator's [ChargeSmash formula](https://github.com/rubendal/SSBU-Calculator/blob/233590e94bc4bd8813f2d1a2af45c8c46648f351/js/formulas.js)
uses damage multiplier `1 + heldFrames / 150` for the ordinary 1.4 charge cap.
Its [calculation ordering](https://github.com/rubendal/SSBU-Calculator/blob/233590e94bc4bd8813f2d1a2af45c8c46648f351/js/global.js)
passes charged damage into the knockback formula; it does not separately scale
base knockback or growth. The calculator's [ordinary defaults](https://github.com/rubendal/SSBU-Calculator/blob/233590e94bc4bd8813f2d1a2af45c8c46648f351/js/game.js)
also specify 60 frames and a 1.4 multiplier. This project retains its 0–60
charge range, with automatic release at 60. Source copies and provenance are
in [sources/](sources/).

First-slash gameplay startup/active timing remains **[16,18)**, and the optional
follow-up window remains **[21,36)**. The second slash has **[9,11)** active
frames on its own timeline. The first script changes animation rate, so raw
script frame numbers are not direct gameplay-frame counts. Existing input and
follow-up timing are preserved; the closing frame remains project calibration.

**The second slash retains charge inheritance as existing project policy.**
The scripts identify the combo flags and second hit, but do not independently
establish the original status implementation's inheritance rule. These tests
verify this project's behavior without claiming that missing source evidence.

## Implementation and authoring

- `charge.knockbackMode: 'damage-only'` opts into preserving the owning move's
  reference launch. Charged damage feeds growth once. Omitted mode retains
  legacy endpoint interpolation for existing moves and saved overrides.
- `sweetSpot.knockback` supplies an optional distinct absolute launch before
  any sweet-spot knockback multiplier. Link's tip keeps its damage multiplier
  of 2 and now selects the tip's base/growth/angle rather than the inner record.
- Save/load requires a main reference record for damage-only charge and rejects
  unsupported projectile usage or reference endpoint interpolation. The legacy
  endpoint records remain required for compatibility but are inactive in this
  mode. Top-level and hit-window sweet-spot launches receive normal validation.
- The Lab hides inactive charge endpoints and legacy launch vectors, exposing
  main/tip/second-slash reference values and charge damage limits. Edits survive
  save/load and live factory overrides independently.

Detailed bone geometry, the source sword beam at zero attacker damage, source
hitlag multipliers and original status logic are outside this melee-launch
pass. Existing hitlag tiers and tip bonus, stale/rage modifiers, input handling,
collision resolution and recovery transitions remain project policies.

## Before and after

The [parameter comparison](parameter-comparison.json) evaluates isolated fresh
airborne hits with neutral input, including eligible reference gravity boost.
At full charge against Link starting at 100%:

| Strike | Previous speed, px/step | Reference speed, px/step |
| --- | ---: | ---: |
| Inner | 43.731 | 8.674 |
| Tip | 54.812 | 34.119 |
| Second | 53.150 | 37.420 |

These are formula comparisons, not captured pre-change trajectories. The inner
strike now has the source's weak linking launch, distinct from the strong tip.
Independent second-hit measurements do not establish combo connectivity or
full-match balance acceptance.

## Verification

The [real-Matter fixture](physics.json) covers all three records at 0/30/60 charge
against Link and Donkey Kong starting at 100%, plus an uncharged inner hit at
0%, mirrored tip contact and full-charge tip DI/LSI. It predicts knockback,
gravity, influence, decay and reaction-clock groups independently of the runtime
helpers, through three actionable integrations after hitstun.

Charge tests use the actual attack input lifecycle, including the startup hold,
release and maximum-charge automatic release. The second slash starts from a
new press in the first slash's follow-up window and inherits its charge count.
The first slash whiffs in these second-hit measurements. Targets are staged
immediately before contact; the attacker stands on a narrow pad and moves aside
after impact to isolate recipient flight. These are bounded launch measurements,
not environmental collision, KO or uninterrupted-combo parity.

The 21 matching production traces inject `attackHeavy` at the Character input
boundary; that dedicated button is not currently mapped by the normal resolver.
A separate production check uses the existing resolver's **attack + fresh
horizontal stick flick**, holds 30 charge frames, releases an 8.4-damage inner
hit and requests a 15.6-damage second slash with a fresh attack press. It does
not override Character input. The victim is restaged between hits; resolver
action/vector responses are controlled, so this verifies reachable gameplay
dispatch, not physical keyboard/gamepad events or uninterrupted connectivity.

- [Charge, delivery and existing combat regressions](runtime-tests.txt):
  **134 passed**.
- [Independent physics checks](physics-tests.txt): **21 passed**, exporting
  **21 scenarios / 1,166 displayed frames**.
- [Final authoring checks](authoring-tests.txt): **162 passed**, including
  projectile rejection and main/tip/second-slash edits through save/load/factory.
- [Aggregate run](full-tests.txt): **344 files passed / one file failed;
  10,854 tests passed / one failed**. It overlapped the final projectile-guard
  edit and failed only the newly added boomerang rejection assertion. A fresh
  [post-aggregate authoring rerun](final-authoring-tests.txt) passes all **162
  tests**, including that case. Together these verify **345 files / 10,855
  distinct tests**; no fresh all-files rerun is claimed. No runtime or test
  logic changed after the final focused run.
- [Build and TypeScript](build.txt): **passed**, final artifact
  `index-DrN4gZWe.js`. Its [source-map contents](build-source-check.json) match
  all eight changed runtime files, including the final projectile import guard.
- [Production comparison](production/forward-smash-launches.json): **all 1,166
  frames match exactly** before input, after input and after constraints.
  The 21 cases preserve **4,743 ordinary input/rule/world steps**, with maximum
  timestamp error below 7.6e-13 ms. The ordinary gravity witness passes all
  **1,166 steps** (maximum position error below 1.1e-11 px), and **295 attack
  cadence checks** pass.
- The separate resolver check passes **190 steps**, bringing total checked
  input/rule/world steps to **4,933**. It verifies 30-frame charge, first inner
  damage 8.4, inherited second-slash damage 15.6 and both reference KB results.
- Main/tip/second-slash Lab fields and hidden inactive endpoints pass at
  [1280x720](production/lab-1280.png) and
  [390x844](production/lab-390.png). Narrow rendering retains the
  existing scaled canvas; this is layout/access coverage, not human usability
  acceptance. There are zero page/load errors.
- Whitespace checks pass.

## Next step

Audit and convert down smash's front/back launch records using the explicit
charge mode, then address up smash's linked strikes and any fixed/set-weight
contracts its source requires. Detailed spatial hitboxes, precise directional dodge
and wider roster calibration remain open. Replay playback and 3D remain
deferred; human controller, audio and balance acceptance remains outstanding.
