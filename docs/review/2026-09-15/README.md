# Special and air-dodge landing commitment

Latest continuation: [September 16 launch calibration](../2026-09-16/README.md), following [Link down-air rebound](rebound/README.md). Use the latest record for current verification and next work; this page retains the special/dodge landing milestone evidence.

Continuation on `rework/gameplay` after the [September 14 movement and combat pass](../2026-09-14/README.md). This milestone completes the next landing transitions in that handoff, preserving the fixed 60 Hz simulation. Replay playback remains ultralow priority; 3D remains deferred.

## Changes

- Link's aerial Spin Attack now commits to 30 landing steps. Touchdown cancels the attack and its hitboxes; the same penalty survives normal move completion into helpless fall. Grounded Spin Attack retains its own attack and charge timeline.
- Landing during Link's neutral air dodge replaces the remaining airborne action with 10 landing steps. Directional dodge uses a provisional 19 steps. Landing ends the burst and dodge invincibility, so the fighter can be punished during recovery. An already completed dodge uses ordinary soft/hard landing.
- Buffered jumps, attacks and charged specials, held shield, and the item adapter's pre-input gate respect the first actionable step. Landing penalties replace each other instead of accumulating. Hitlag freezes recovery; incoming damage interrupts it.
- Damage, capture, ledge catches and round resets clear retained special/dodge commitments. Capture also clears completed special-fall helplessness. A fresh ledge catch restores the spent air dodge.
- The Lab and character save/load preserve `specialLandingLagFrames`, `airDodgeLandingFrames`, and `directionalAirDodgeLandingFrames`. Invalid frame values are rejected. Special landing data is optional; unauthored specials and movement profiles keep their previous behavior.

## Reference and limits

[Link's Ultimate Frame Data](https://ultimateframedata.com/link) lists 30 landing frames for aerial Spin Attack, 10 for neutral air dodge, and 11–19 for directional air dodge. The engine counts the first input step resolving Matter contact as landing step one. A 30-step landing blocks that step plus 29 more; step 31 is actionable.

**Directional dodge uses a fixed 19 steps as an explicit calibration.** The timing-dependent 11–19 rule has not been reproduced. Existing dodge travel, total airborne duration, intangibility windows and stale-dodge rules remain outside this milestone and are not claimed as Ultimate parity. Other fighters need their own authored values. Collision/launch calibration and human controller, sound and balance acceptance remain open. Down-air rebound is implemented in the linked continuation.

## Verification

- [Failing baseline](failing-before.txt): both initial real Matter regressions fail with zero landing recovery before the runtime change.
- `Character.specialLanding.physics.test.ts`: real contact and input through active/completed Spin, neutral/directional dodge phases, buffers, item gates, damage, capture, ledges and resets.
- `characterLandingSerializer.test.ts`: special-family validation, optional/zero values, save/load defaults and actual Lab edit-state persistence.
- [Initial focused run](landing-tests.txt): 67 tests passed across five physics/item files. Further interruption cases were added afterward and are covered by the final verification below.

- [Aggregate run](full-tests.txt): **322 files / 10,454 tests passed**, including all 25 final special/dodge physics cases. The new authoring test file was saved after aggregate discovery; its [separate run](authoring-tests.txt) passes **21 tests**. Thus **323 files / 10,475 distinct tests** are verified across the aggregate and authoring runs. No further runtime changes followed these checks.
- [TypeScript](typecheck.txt) and [production build](build.txt): passed. Artifact: `index-CdrKyzUi.js`.
- [Production browser report](production/special-landing.json): all three landing scenarios pass against that artifact, with exact 30/10/19-step recovery, vulnerable landing poses, and held shield on the first free step. Zero page errors and zero failed resource requests.
- Lab navigation and field bounds pass at [1280×720](production/landing-lab-1280.png) and [390×844](production/landing-lab-390.png). The narrow rendering remains very small; this is field-access/layout smoke coverage, not a mobile readability or human usability acceptance claim.
- Whitespace: `git -c core.autocrlf=false diff --check` passed.

The initial browser attempt could not boot because the preview lacked the production subpath. Start it with `npm run preview -- --host 0.0.0.0 --port 4173 --strictPort --base /platform-fighter/`. The corrected preview is available at `http://127.0.0.1:4173/platform-fighter/`.

## Next work

1. Link's down-air rebound is implemented in the [continuation](rebound/README.md). Next, revisit collision/launch calibration using consistent units and measured trajectories.
2. Reproduce the directional dodge landing rule and calibrate airborne dodge timing, travel and intangibility together; author the remaining roster's landing values.
3. Obtain human controller, sound and balance acceptance. Keep replay playback and 3D outside the critical path.
