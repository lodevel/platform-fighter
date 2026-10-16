# Link forward/back aerial launches

Continuation after [up-smash fixed linking launches](../up-smash-launches/README.md).
Forward air's finisher and both back-air strikes now use reference launch
records. Forward air's first hit remains an explicit project approximation:
the audited script supplies special angle 367 without its internal algorithm.

## Source and selected records

The pinned [AttackAirF](https://github.com/WuBoytH/SSBU-Dumped-Scripts/blob/59004685238a3f6f93bae905d3a4e079701c40b4/smashline/lua2cpp_link/link/AttackAirF.txt)
and [AttackAirB](https://github.com/WuBoytH/SSBU-Dumped-Scripts/blob/59004685238a3f6f93bae905d3a4e079701c40b4/smashline/lua2cpp_link/link/AttackAirB.txt)
scripts provide these records. Exact copies, hashes, omitted spatial variants
and the existing calculator contract are in [the provenance manifest](sources/provenance.json).

| Strike / recipient | Damage | Base KB | Growth | Angle | Fixed parameter | Forced weight |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Forward-air finisher / either | 10 | 43 | 120 | 44 | — | No |
| Back-air first / airborne | 5 | 0 | 100 | 70 | 36 | 100 |
| Back-air first / grounded | 5 | 0 | 100 | 73 | 50 | 100 |
| Back-air finisher / either | 7 | 45 | 98 | 361 | — | No |

Back air's single rectangle represents the distal-knee first-hit IDs 0/1.
The inner knee and hip use other first-hit angles and remain omitted spatial
detail. Both finishers share their launch values across their source hitboxes.
Normal back-aerial input already reverses the attack axis while preserving
the fighter's facing, matching the source backward launch orientation. Forward
air uses the forward axis. Neither move uses target-position-based orientation.

Back air's fixed parameter produces **KB 44.6 / 16 reaction frames** in air and
**KB 54.4 / 20 reaction frames** on ground. Its former minimum-nine-frame floor
is removed. Neither source script adds reaction frames. The existing fixed
launch contract excludes percent, damage, rage and stale launch scaling;
staling still affects damage, and each recipient retains its natural gravity.
Both finishers use ordinary damage/percent/weight knockback, with the existing
tumble, DI/LSI and reaction-clock rules.

The gameplay windows remain **[15,17), [23,25)** for forward air and
**[5,8), [14,17)** for back air. These follow the existing
[Ultimate Frame Data timings](https://ultimateframedata.com/link). Forward
air's raw motion-script frames differ; this pass does not claim to reproduce
its animation/status clock. Landing lag remains 11 and 6 frames respectively.

## Forward-air first hit and geometry limits

The outer and middle sword's airborne first hits use special angle 367. Its
algorithm is absent from the pinned scripts and calculator sources examined
here. Secondary descriptions alone were not used to invent an implementation.
The saved-data parser continues to reject 367 as an unsupported reference angle.

Forward air therefore retains its previous first-hit vector, eight-frame
minimum hitstun and airborne attacker-velocity carry. Its grounded first-hit
launch is also still calibrated. The source inner sword has ordinary angles,
but replacing the entire current sword rectangle with that inner record would
not establish the outer/middle sword's intended motion link. This milestone
converts only the finisher and keeps that limitation visible.

Both moves still use existing rectangular collision geometry rather than
animated bone spheres. Source hitlag multipliers, setoff behavior and exact
native clocks are outside this conversion. Local stale damage, rage for
ordinary launches, collision response and the five-pixels-per-unit scale
remain project policies. Save/load, factory construction and numeric Lab
controls preserve the reference records; forced weight and motion carry remain
JSON booleans rather than numeric Lab controls.

Back air's stronger sourced first launch changes which approaches connect.
In the measured Link-versus-Link starts, shared initial vertical velocities
of -8 and -12 px/step connect both kicks; 0 and -4 miss the second. Negative
velocity means rising. The misses occur while the victim still has hitstun:
Link and the launched target have separated beyond the existing second-kick
rectangle. There is no forced carry or extra lockout to hide that separation.
These are bounded collision measurements, not a claim that the original
game's animated hitboxes have the same connection limits.

The earlier integration test assumed every falling back air would link. Its
two failures are retained in [the initial run](initial-tests.txt). The updated
[18-test integration run](connected-regression-tests.txt) checks a rising
back air at 0/50/100/150%, fresh jump/dodge attempts between connected hits,
and a falling miss followed by natural hitstun recovery. The source values
and collision rectangles were not changed to preserve the older assumption.

## Verification

The [focused regressions](focused-tests.txt) pass **163 tests / six files**.
The [independent real-Matter fixture](physics-tests.txt) passes **34 scenarios**
and exports [1,419 displayed steps](physics.json). Its 22 isolated cases cover
both recipient weights, 0/100% damage, real grounded selection, mirrored normal
back-aerial dispatch, grounded Sakurai angles and diagonal DI/LSI. Twelve
sequence cases keep both fighters moving between hits, covering rising
connections, misses, other-weight/high-percent recipients and fresh defense
attempts. Connected finishers are checked against the independent launch and
trajectory oracle through three actionable steps. No connected sequence
repositions either fighter between its two hits.

The [first production run](browser-initial.txt) matched all 22 isolated cases,
then exposed a connected-fixture setup difference. Forward-air startup drift
closed the original one-pixel body gap and activated MatchScene's soft body
separation, which is outside the standalone launch fixture. Connected forward
air now starts with a five-pixel body gap and asserts no overlap before contact.
The [next browser run](browser-before-bair-staging.txt) found the same issue in
back air's one-pixel gap. Its connected start now uses three pixels; every
connected case checks separation before contact. The game retains its normal
separation pass. These fixture corrections preserve the launch, connection,
miss and recovery assertions. The aggregate run had already collected the
earlier fixture; the final focused rerun verifies the corrected setup.

The [production build](build.txt) passes as **`index-CU65TyEE.js`**, with
[matching source-map contents](build-source-check.json) for the launch,
collision and dispatch paths. A final `tsc --noEmit` after the new fixtures
were complete also passed (exit 0; [empty error log](typecheck.txt)).

The [aggregate suite](full-tests.txt) passes **350 files / 10,963 tests**. Its
runtime is the same as the final production build; the subsequent fixture-only
staging corrections are verified separately above.

The final [production report](production/fair-bair-launches.json) and
[browser output](browser.txt) pass all **34 scenarios / 1,419 trace frames** on
the same artifact. Receiver position error is at most **7.58e-11 px** and
velocity error at most **2.05e-12 px/step**. Comparisons include attacker
positions, real contact records, before/after-input and after-physics states,
hitlag, hitstun, actionability and attack clocks. All cases use normal resolved
attack-plus-direction input, including mirrored back-aerial dispatch.

The probe checks **5,309 outer world/input/rule steps**, **1,419 ordinary-body
gravity integrations** and **572 attacker animation-clock transitions**. The
separate fixed-launch smoke adds 106 steps, for **5,415 total**. That smoke
starts the attacker at 150% with three prior back-air uses: dealt damage falls
to **4.25**, while **KB 44.6 / 16 reaction frames** and the backward launch axis
are preserved; the stale count advances once from three to four.

The Lab exposes both finishers' reference fields, both back-air fixed records
and forward air's retained first-hit legacy controls. Field bounds and
navigation pass at 1280×720 and 390×844 with **zero page/load errors**. Eight
screenshots include [back-air first-hit controls](production/lab-bair-first-1280.png)
and [the narrow forward-air first-hit page](production/lab-fair-first-390.png).
The narrow canvas remains compressed/letterboxed, so this is a logical-layout
and reachability check rather than mobile-usability acceptance. Resolver input
is controlled; physical keyboard/gamepad play, audio and balance remain human
acceptance work. Whitespace verification passes.

## Next

Audit Link's three-stage jab launches and their contact/chain timing. A faithful
forward-air angle-367 port still requires verified algorithm and contact-motion
evidence; keep its current approximation visible while working through the
remaining kit. Detailed animated geometry, source hitlag/setoff behavior,
precise directional dodge and wider roster calibration remain open. Physical
controller, audio and human balance acceptance are still outstanding. Replay
playback stays ultralow priority and 3D presentation stays deferred.
