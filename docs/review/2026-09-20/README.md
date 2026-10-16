# Reference tumble speed-up

Continuation after [launch energy and gravity](../2026-09-16/launch-energy/README.md).
Reference tumble speed-up is implemented for authored Link/DK launches.

Continued in the [launch-influence milestone](launch-influence/README.md), which
adds DI/LSI interaction, influenced trajectories and measured KO brackets.
Use that record for the current handoff; the results below describe speed-up.

The change groups ordinary launch-trajectory ticks into displayed frames for
eligible reference tumble. It advances launch displacement, decay and authored
gravity together. Inputs, attack and item clocks, unrelated movement, and total
world time keep their ordinary fixed-step cadence. The runtime coordinates
Matter substeps so contacts and blast-zone checks can observe intermediate
movement instead of teleporting directly to each group's endpoint.

## Timing source and indexing

The reference is the calculator author's implementation of damage speed-up,
which credits Arthur's conversion of `FighterStatusDamage_init_damage_speed_up`.
The inspected [formulas.js raw source](https://raw.githubusercontent.com/rubendal/SSBU-Calculator/refs/heads/gh-pages/js/formulas.js)
contains `InitDamageSpeedUp`, `ReactionFrameMulSpeedUp` and `DamageSpeedUpFrames`
at lines 988–1103. Its angle-rate parameter is 100%, so the angle adjustment is
an identity. Its magnification rises from 1 to 6 as ordinary reaction frames
rise from 30 to 80, then caps at 6. Its remaining-clock transition uses an end
rate of 70%.

The [global.js caller](https://raw.githubusercontent.com/rubendal/SSBU-Calculator/refs/heads/gh-pages/js/global.js)
at lines 658–663 passes ordinary first-actionable frame, including additional
hitstun, into `DamageSpeedUpFrames`; ordinary hitstun is passed separately to the
trajectory calculator. Lines 784–789 interpret the timing map's last entry as
accelerated first-actionable frame and subtract one for displayed hitstun.
Source URLs were inspected on 2026-09-20; cached branch and GitHub views can expose
different file revisions, so these line references describe the raw versions
used for this implementation, not an immutable commit snapshot.

Let ordinary hitstun be `H` and ordinary first-actionable frame be `F = H + 1`.
For a remaining reaction clock `r`, let `R(r)` be its remaining displayed frames.
The elapsed timing map is `S[n] = R(F) - R(F - n)`, for `n = 0..F`. Equal values
of `S[n]` group ordinary trajectory integrations `n = 0..H`; the final map entry
is the next, actionable boundary. Counts therefore sum to `H + 1`, and the
number of groups is the accelerated first-actionable frame.

| Ordinary FAF | Ordinary hitstun | Accelerated FAF | Displayed hitstun |
| ---: | ---: | ---: | ---: |
| 32 | 31 | 32 | 31 |
| 54 | 53 | 41 | 40 |
| 62 | 61 | 44 | 43 |
| 65 | 64 | 45 | 44 |
| 66 | 65 | 45 | 44 |
| 80 | 79 | 50 | 49 |

Tick `n=0` is the initial release integration: it uses launch velocity with
zero accumulated natural gravity. Later ticks in the same displayed step
advance decay and authored gravity. Release is not necessarily a singleton:
ordinary `H=65` begins with counts `[2,5,4,3,4,2]`; `H=61` begins
`[1,4,4,3,3,3]`; `H=64` begins `[1,4,4,4,3,3]`. Hitlag consumes no trajectory
ticks. The last locked integration is `n=H`, and free control begins on the
displayed step after its group.

The [trajectory visualizer](https://raw.githubusercontent.com/rubendal/SSBU-Calculator/refs/heads/gh-pages/js/knockback.js)
uses `GetFrameWithSpeedUp` to choose which integrated positions to emit. That
lookup changes index zero to one, merging its first plotted points even when
the timing map distinguishes them. This is a visualizer sampling convention;
the helper uses the reaction-clock map itself. At ordinary FAF 80 it keeps the
initial groups `[1,6,6,...]`, rather than interpreting the first plotted segment
as a seven-tick game frame. This adaptation is explicit and is not a claim of
frame-for-frame vanilla engine validation.

## Implementation boundaries

[`getReferenceDamageSpeedUpGroups`](../../../src/characters/referenceDamageSpeedUp.ts)
returns immutable counts, each from one through six for eligible launches.
Ineligible launches retain all-one schedules. The implementation evaluates the
geometric remaining-clock recurrence directly in linear time across the full
schedule. Tests compare it against an independently iterated source clock and
fixed checkpoints, including 1,000 ordinary ticks.

The helper rejects hitstun above 10,000 frames before allocating an array.
The runtime guard retains ordinary timing with a constant one-tick fallback
for larger custom imported values; this bounds scheduling work without turning
an extreme imported knockback number into a huge array. Such values are outside
the calibrated move range.

`ordinaryHitstunFrames` retains the uncompressed result for diagnostics;
`hitstunFrames` reports displayed hitstun. The five existing measured scenarios
keep their reference knockback values. Link tilt at 0% remains 31 displayed
frames; Link tilt at 100% becomes 44, DK receiving it becomes 43, and early
Link up air at 100% becomes 44.

This milestone preserves the project's Matter contact response and action
transition rules. It does not establish vanilla bounce/tech parity, LSI,
fixed/set-weight launch behavior, or universal action cancellation rules.
Speed-up is limited to the reference launch path; it is not a global match
time multiplier. The authored Lab controls remain the same.

The coordinator keeps the original single Matter integration whenever no launch
needs compression. Otherwise it splits the existing frame at each fighter's
reference-tick boundaries. Only launch and natural gravity receive accelerated
transport; carried velocity and wind still contribute once per outer frame.
Ordinary bodies receive their full-frame force, gravity and drag once, preserving
their free-flight positions and final velocities. Contact solver precision changes
within subdivided frames; this is not a claim that all ordinary collision responses
are numerically identical to a single Matter integration.

Canonical velocity remains available during collision callbacks, before Matter
normalizes its own velocity field. Solver-stopped contact normals remain stopped
when transport converts back to canonical units, including launches with external
carry. Tangential carry survives. Hitlag pauses the launch clock and resumes the
next group; damage, capture, floor contact or KO cancels remaining accelerated
transport. An interruption during a group discards its remaining travel under
the project's collision policy; no vanilla interruption-parity claim is made.

Landing classification, fighter separation, input, attacks, rule timers and wind
run once per gameplay frame. One-way platform checks, lava overlap and blast-zone
position checks observe intermediate collision segments. Temporary gravity/drag
overrides restore even if integration throws; forces queued by observers wait
for the next outer frame.

## Verification

- [Full tests](full-tests.txt): **338 files / 10,701 tests passed**. The final
  runtime and all added regressions are included; no later runtime edits.
- [Timing, trajectory and coordinator tests](focused-tests.txt): **104 passed**.
  [Final boundary tests](final-boundary-tests.txt): **6 passed**, covering actual
  collision callback velocities, paused launch resumption, gravity-disabled decay,
  canceled normal/tangential carry, transient lava crossings and once-frame wind.
  The carry test compares equivalent contacts to account for Matter's small
  tangential solver impulse; its final version is included in the aggregate.
- [Build](build.txt): **passed**, including TypeScript, artifact
  `index-C3CpODON.js`. Final standalone TypeScript check also passed.
- [Production evidence](production/link-launch.json): **passed**, comparing all
  **276 displayed frames** across five scenarios with the [physics trace](launch-after.json).
  Maximum position error is below `3e-13` pixels; zero page/load errors.
- The production probe checks **937 fixed steps** for single input/rule updates,
  one fixed duration of world time, and restored world gravity. A separate
  noncolliding body's ordinary ballistic path matches across **277 steps**.
  The first-free ceiling velocities remain `[8.52,8.04,8,8,8]`.
- Desktop **1280×720** and narrow **390×844** Lab checks pass. Link/DK launch
  profiles and reference strike controls remain correct; actual keyboard editing
  and undo preserve six-decimal gravity values.
- Whitespace check passed (`git -c core.autocrlf=false diff --check`).

The preview needed its production base path explicitly:
`vite preview --host 127.0.0.1 --port 4173 --strictPort --base /platform-fighter/`.
It is available at `http://127.0.0.1:4173/platform-fighter/`.

## Next step

Complete launch-speed influence (LSI) and verify its interaction with DI, then
remeasure open-air trajectories and KO boundaries together. Use that verified
launch model to extend reference parameters to more of Link's kit and the roster.
Detailed directional-dodge timing and vanilla collision/action transition rules
remain separate open work. Replay playback and 3D remain deferred.

Human controller, audio and balance acceptance remains outstanding.
