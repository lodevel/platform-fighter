# Link charged down-smash reference launches

Latest continuation: [up-smash fixed linking launches](../../2026-09-22/up-smash-launches/README.md).

Continuation after [forward-smash reference launches](../forward-smash-launches/README.md).
Down smash now uses distinct front and back launch records, with damage-only
charge and position-based launch direction for both sweeps.

## Source records

| Sweep | Damage at 0 / 30 / 60 charge frames | Base KB | Growth | Angle |
| --- | --- | ---: | ---: | ---: |
| Front, inner sword | 16 / 19.2 / 22.4 | 40 | 88 | 78 |
| Back, sword | 12 / 14.4 / 16.8 | 80 | 63 | 30 |

The pinned vanilla [AttackLw4 script](https://github.com/WuBoytH/SSBU-Dumped-Scripts/blob/59004685238a3f6f93bae905d3a4e079701c40b4/smashline/lua2cpp_link/link/AttackLw4.txt)
provides these records. Both use target position (`LR_CHECK_POS`), ordinary
recipient weight, zero fixed knockback and the same records for ground/air
recipients. The front tip deals 17 and clavicle deals 14; the back arm deals 11
and clavicle deals 10, with each sweep retaining its own common launch values.
The existing rectangles represent the front inner sword and back sword.
Full source details and hashes are in [the provenance manifest](sources/provenance.json).

The [previous charge audit](../forward-smash-launches/README.md#source-records-and-charge)
pins the community calculator's ordinary damage multiplier `1 + heldFrames / 150`.
The existing 0–60 charge range now uses `knockbackMode: 'damage-only'`: charged
damage feeds the reference formula while base/growth/angle remain fixed. The
back window receives the same damage multiplier as the front.

Existing gameplay strike windows **[11,13)** and **[23,25)**, charge hold frame
**3**, and total **56** steps remain. These correspond to the one-based
12–13/24–25 active frames and frame-4 hold listed by
[Ultimate Frame Data](https://ultimateframedata.com/link). The script includes
motion-rate changes, so its animation-frame events are not directly substituted
for those gameplay windows.

## Implementation and limits

`launchAwayFromSource: true` selects the target's side of Link for both sweeps.
The back window retains `facing: -1` to place its hitbox behind Link; that
geometry flag does not force the launch direction. A target overlapping the
near edge from across Link's root is therefore sent toward its own side.

The Lab exposes the front reference record and separate back-window record.
Independent edits survive JSON save/load and live factory overrides. Inactive
legacy charge endpoints remain stored for compatibility and hidden in the Lab.

This pass does not recreate the source's bone-attached spheres, trip parameter,
low attack-height rules or hitlag/status logic. Existing rectangular collision,
hitlag tiers, stale/rage modifiers and recovery remain project policies. The
back hit is measured after the front whiffs; these independent launches do not
establish uninterrupted two-hit connectivity or balance acceptance.

## Before and after

The [parameter comparison](parameter-comparison.json) evaluates 24 fresh,
airborne, neutral-input hits across two weights, two starting percents and
three charge levels. At full charge against Link starting at 100%:

| Sweep | Previous speed, px/step | Reference speed, px/step |
| --- | ---: | ---: |
| Front | 59.280 | 35.431 |
| Back | 52.457 | 28.208 |

These are formula comparisons, not captured pre-change trajectories. The old
shared shallow launch is replaced by the source's distinct 78° front and 30°
back launches.

## Verification

The [real-Matter fixture](physics.json) independently predicts knockback,
gravity, DI/LSI, decay and reaction-clock groups through three actionable
integrations. Its 17 cases cover both sweeps at 0/30/60 charge against Link and
Donkey Kong starting at 100%, grounded front/back hits at 0%, a mirrored back
hit, an overlapping front target across Link's root, and back-hit DI/LSI.

The attacker settles on a real support pad and charges through actual input,
including automatic release at 60. Grounded recipients also settle on a broad
pad before contact; that pad is removed after impact to isolate free flight.
Other targets are staged immediately before their selected contact. The
attacker moves aside after the hit, and the back cases whiff the front sweep.
This measures launch delivery and recovery, not environment or KO behavior.

- [Existing combat regressions](runtime-tests.txt): **4 files / 65 tests passed**.
- [Authoring checks](authoring-tests.txt): **20 tests passed**.
- [Independent physics checks](physics-tests.txt): **17 tests passed**, exporting
  **17 scenarios / 1,007 displayed frames**.
- [Build and TypeScript](build.txt): **passed**, artifact `index-DNmiPqYT.js`.
  The [built source map](build-source-check.json) matches the changed runtime
  source exactly.
- [Production comparison](production/down-smash-launches.json): **all 1,007
  frames match exactly** before input, after input and after constraints.
  Its 17 cases preserve **3,768 ordinary input/rule/world steps**, **1,007
  ordinary gravity witness steps** and **258 attack cadence checks**. Maximum
  world-time error is below 7.6e-13 ms, witness position error below 7.7e-12 px
  and witness velocity error below 2.6e-13 px/step.
- Separate resolver checks use **attack + a fresh downward stick flick**,
  hold 30 charge frames and deliver front **19.2** or back **14.4** damage with
  the correct reference KB and outward direction. These pass **338 steps**,
  bringing checked input/rule/world steps to **4,106**.
- The Lab exposes both records and hides inactive endpoints at
  [1280x720](production/lab-1280.png) and [390x844](production/lab-390.png).
  Back-window controls are reachable at both
  [desktop](production/lab-back-1280.png) and
  [narrow](production/lab-back-390.png) sizes. The narrow layout retains the
  existing scaled canvas; this is layout/access coverage, not human usability
  acceptance. There are **zero page/load errors**.
- The [aggregate run](full-tests.txt): **346 files / 10,873 tests passed**.
  No runtime or test edits followed that run.
- Whitespace and local evidence-link checks pass.

The production trajectory checks inject `attackHeavy` and downward input at
the Character input boundary. The separate resolver checks do not override
Character input: they use the normal attack mapping with controlled action and
stick responses. Neither claims physical keyboard/gamepad event coverage.

## Next step

The pinned [AttackHi4 script](https://github.com/WuBoytH/SSBU-Dumped-Scripts/blob/59004685238a3f6f93bae905d3a4e079701c40b4/smashline/lua2cpp_link/link/AttackHi4.txt)
shows that up smash's linking strikes use **nonzero fixed knockback,
`setWeight: true`, ground/air-specific records and three added reaction
frames at initial hitbox creation**. Reaction-frame retention through the late
aerial replacement still needs verification. These use ordinary launch angles.
Implement and independently verify those launch contracts before replacing
the existing calibrated linking vectors and minimum hitstun. Then verify
all three strikes and connected-hit behavior together.

Detailed spatial hitboxes, precise directional dodge and wider roster values
remain open. Replay playback and 3D remain deferred; human controller, audio
and balance acceptance remains outstanding.
