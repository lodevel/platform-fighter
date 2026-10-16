# Link gameplay and movement milestone

Branch: `rework/gameplay`. The deterministic 60 Hz 2D engine remains the foundation. Replay playback and 3D are deferred.

## Changes

- Link's normals and aerials use the sourced action and contact timings. Forward air, back air and up smash have separate strikes with harmless gaps; down smash attacks the opposite side on its second swing. Lingering aerials and grounded Spin Attack change strength without hitting an already-struck victim twice.
- Jab follow-ups respect their authored opening. Forward smash has an optional second slash, a stronger sword tip and startup that pauses at its charge frame. Maximum charge adds exactly 60 frames. Early down air spikes airborne opponents and launches grounded opponents upward.
- Aerial landing recovery starts before action arbitration and lasts the authored number of steps. Forward air retains its landing penalty briefly after its action finishes. Action buffers, interruptions and drop-through respect that commitment.
- Final production review also found and fixed lost support after resetting on an existing floor contact. Active collision events now rebuild that contact; the failing-before case and 555 affected checks are recorded in [the reset regression](ground-reset-tests.txt).
- Link's full/short jump height ratio, airborne duration, air speed and fall speeds were calibrated together. The full jump falls from approximately 298 to 139 physical pixels; short jump rises from 51 to 66.9. Full/short/fast-fall durations are within one step of the reference targets. Other fighters retain their movement defaults, and launch/hitlag physics remain isolated from the new jump shaping.
- Remote bombs use the ordinary inventory: pull, carry, throw, pick up and transfer. The original Link retains remote detonation ownership. Throws happen in the same step regardless of player order; a detached explosion does not freeze its distant owner.
- Animation, swing trails and F3 geometry follow the actual strike windows and facing. Sensors ignore gravity, preventing drift during hit-stop. All strikes of one multihit share one stale-move occurrence.
- The editor preserves the new hit windows, follow-up, charge timing and jump fields through save/load and exposes the active jump controls.

## Reference and review

[Move timing and source assumptions](reference.md), [landing and movement measurements](landing-and-movement.md), and [animation review](animation.md) distinguish sourced frame/damage targets from fitted launch vectors and rectangular collision approximations. Separate agents implemented and cross-reviewed landing/movement, specials/items, and presentation; the root integrated normal hit scheduling and follow-ups.

Remaining detailed parity work includes normal landing recovery, distinct air-jump height, free-air turning outside aerial attacks, exact regional/skeletal hitboxes, down-air rebound, and the first forward-air hit's ground/air linking. The forward-smash follow-up closing frame is provisional. Existing animation strips still limit pose fidelity. Human balance, physical-controller and listening tests remain necessary; this milestone does not claim full Ultimate parity.

## Verification

**318 files / 10,342 tests passed** in the final [aggregate run](full-tests.txt), covering contact, charge, landing, movement, inventory and serialization regressions. TypeScript and the final production build passed: `index-N1cjduoM.js`; [build log](build.txt). Whitespace checking passed.

Production bomb/charge and ordinary-item checks passed with zero browser errors: [bomb and charge](link-bomb-charge-probe.json), [item coordinates](item-coordinate-probe.json). The browser probes use isolated storage and software WebGL.

[Production animation and Lab checks](production/README.md) verify all strike windows, reverse-facing feedback, frozen sensors, multihit staleness, and save → Test Fight → Return behavior. The evidence record identifies each build.

The [live movement probe](production/link-movement-probe.json) confirms 139/66.9 px jump heights, 45/32/31/23 airborne durations and 4.62 px/step air speed in the actual MatchScene, including repeated resets on the same floor. [Menu and match journeys](production/acceptance.json) pass all 20 scenarios, and [P1 CPU control checks](production/cpu-first-controls.json) pass card, Space, portrait and restored-lobby paths through restart. These final checks completed on 2026-09-10.
