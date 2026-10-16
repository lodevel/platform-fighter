# Launch calibration and recovery from hitstun

Latest continuation: [reference knockback for Link's measured strikes](reference-knockback/README.md).
That pass introduces independent weight and reference base/growth/angle for forward
tilt and early/late up air. The measurements below retain this earlier milestone's
launch values; use the latest record for current verification and next work.

Continuation after [Link down-air rebound](../2026-09-15/rebound/README.md) on `rework/gameplay`. This pass measures the five launch scenarios in that handoff and fixes the gravity overspeed they exposed. The broader conversion to Ultimate knockback units remains open.

## Measured problem and correction

After Link's up air launches a target into a ceiling, collision resolution cancels upward launch. Gravity continues during hitstun and reaches **9.72222 px/step** by its last locked step. On return to normal control, the old terminal-speed guard classified that accumulated gravity as an external impulse and preserved it indefinitely, above Link's **8 px/step** ordinary limit.

The fixed-step caller now supplies the actual gravity increment separately from launch and external forces. Character tracks that contribution through hitstun, reconciles contacts on the final locked integration, then removes only its proven excess before the first free input step. The ceiling scenario now returns to **8 px/step**. Downward knockback, carried motion and wind keep their contributions; new actions own velocity after the correction. Incoming damage, capture and resets discard old recovery state.

The existing full-hitstun trajectory is preserved. Percent scaling, mass conversion, launch decay and the normal horizontal damping after hitstun retain their current values; changing those requires the coordinated units migration described below.

## Reproduction and measurements

`src/characters/Link.launch.physics.test.ts` drives real Matter collisions, fresh attacks, zero attacker damage and neutral DI. `tools/link-launch-calibration.mjs` runs the same conditions in the production MatchScene and compares every frame. The defender is placed once just before the first active step with zero velocity, then moves freely. Raised static fixtures keep unrelated stage platforms out of the measurement.

| Scenario | Release velocity before normal control (x, y), px/step | Last locked step after contact | First free step after contact |
|---|---|---|---|
| Forward tilt, airborne Link at 0% | (2.53462, -0.41348) | 14 | 15 |
| Forward tilt, airborne Link at 100% | (5.10862, -1.11548) | 19 | 20 |
| Forward tilt, grounded Link at 100%, near wall | (5.10862, -1.11548) | 19 | 20 |
| Forward tilt, airborne Donkey Kong at 100% | (3.40575, -0.65106) | 15 | 16 |
| Up air, Link at 100%, beneath ceiling | (1.38675, -17.74997) | 44 | 45 |

The release samples include their first Matter gravity integration. Trace coordinates are physical pixels at 60 Hz. A zero hitstun counter after a locked step is distinct from the next input step being actionable. The probe records the pre-input action gate; it is not a claim that every buffered action is available in every state.

- [Independent baseline trajectories](launch-before.json) and [production baseline](before/link-launch.json) agree across all **141 sampled frames**, with maximum position error below `4e-12` px and velocity error below `2e-13` px/step.
- [Failing regression](failing-before.txt) records the ceiling recovery retaining `9.72222` instead of respecting `8`.
- [Corrected physics traces](launch-after.json) include before-input, after-input, raw Matter and post-constraint samples, contact normals, launch angle, hitlag, apex and displacement through five steps after hitstun.

## Verification

- [Focused tests](focused-tests.txt): **4 files / 64 tests passed**, including the five-scenario fixture, failing-before ceiling regression, 11 recovery boundary cases and existing launch/rebound physics tests.
- [TypeScript](typecheck.txt) and [production build](build.txt): passed. Artifact: `index-CwD_deTz.js`.
- [Production comparison](production/link-launch.json): all five scenarios pass across **141 frames**, with maximum position error below `3.1e-12` px and velocity error below `2e-13` px/step. The ceiling's first free step is now 8 px/step. Zero page errors and zero failed resource requests.

- [Rebound browser regression](rebound-regression/link-rebound.json): the preceding milestone still passes damaging/shielded/whiff/fast-fall scenarios and Lab field checks on the same artifact. Zero page errors and zero failed resource requests.
- Whitespace checks passed for the tracked diff, new tests, browser probe and handoff.

- [Final aggregate](full-tests.txt): **327 files / 10,515 tests passed**. No runtime changes followed this run.

To regenerate the comparison from WSL with Node20 and the production preview running at `/platform-fighter/`:

```sh
LINK_LAUNCH_TRACE_PATH=docs/review/2026-09-16/launch-after.json node node_modules/vitest/vitest.mjs run src/characters/Link.launch.physics.test.ts --maxWorkers=4 --minWorkers=1
PF_LAUNCH_PHYSICS_REPORT=docs/review/2026-09-16/launch-after.json node tools/link-launch-calibration.mjs
```

## Units audit and remaining calibration

The current local model uses percent temper `0.09`, inverse physical mass `12/mass`, launch decay `0.34`, and hitstun `round(speed × 2)` clamped to 6–120. These are engine calibrations. Link's ordinary post-hitstun horizontal momentum switches to `0.96` air damping; this pass measures that transition rather than claiming it reproduces the original game's damage-energy system.

The primary [SSBU Calculator formulas](https://raw.githubusercontent.com/rubendal/SSBU-Calculator/master/js/formulas.js) implement launch speed `0.03 × KB`, decay `0.051`, base hitstun `floor(max(5, 0.4 × KB)) − 1`, and weight scaling through `200/(weight + 100)`. Its [trajectory implementation](https://raw.githubusercontent.com/rubendal/SSBU-Calculator/master/js/knockback.js) keeps launch and gravity separate beyond hitstun and also models tumble speed-up and special launch gravity. These are documented calculator behavior, not a direct port or verification of vanilla status code. Sources were inspected on September 16; the links track their upstream branches.

Extending the movement scale of 5 pixels/game unit would imply `0.15 px/step per KB` and `0.255 px/step` decay per reference frame. Those dimensional conversions alone do not justify replacing the current constants: authored attacks lack the corresponding reference base/growth/angle data, fighter mass is not reference weight, and tumble timing/gravity also differ.

## Next work

1. Introduce an explicit reference knockback model for measured Link strikes, with independently authored reference weight and base/growth/angle values. Validate damage scaling, trajectory, DI, hitstun and KO thresholds together before migrating the remaining kit.
2. Resolve launch momentum after hitstun, tumble speed-up and gravity as one model, including action cancellation and external forces. Preserve the new production/fixture comparison as the integration check.
3. Continue precise directional-dodge and remaining roster calibration, then human controller, sound and balance acceptance. Replay playback remains ultralow priority; 3D remains deferred.
