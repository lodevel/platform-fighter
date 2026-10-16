# Strike-timed presentation verification

The simulation owns the animation clock. Authored hit windows now select the contact pose only while the corresponding sensor is live. Harmless gaps reuse the existing release and windup poses; adjacent early/late damage windows remain one continuous motion. The next strike can change visual facing without changing the fighter's control facing.

The loaded art remains a constraint. Link's current back-air sheet depicts a forward sword slash, so it faces toward the rear sensor; this does not reproduce Ultimate's two backward kicks. Sparse strips cannot supply new poses. One- and two-frame fallback strips remain valid, while the loaded three- and four-frame clips distinguish windup, contact and release.

MatchScene now reads the actual sensor for both F3 geometry and swing-trail geometry. Trails hide in gaps and restart their fade at each separate strike. This fixes a visible gold trail on the wrong side of down-smash's reverse strike.

Focused validation: 63 animation tests pass (26 simulation-driver tests and 37 clip-selection tests). Another 72 tests pass for strike-window serialization and all-roster runtime parity (38 new serializer cases and 34 registry cases). Those serialization cases preserve follow-up moves, charge hold timing, strike groups, reverse facing, per-strike damage/geometry/sweet spots and ground-specific launch vectors, and reject malformed timing/metadata.

`tools/link-hit-window-animation.mjs` runs an isolated real Phaser/Matter match with software WebGL. It records six full attack timelines, F3 snapshots, actual sprite frames, reverse-facing trails, pause/hitlag samples and live three-hit damage. Aerial fixtures stay above the floor so landing cannot truncate the animation measurement. The damage fixture keeps the victim in range: it establishes correct per-attack hit identity and staleness, not a guaranteed natural combo.

The first run found that dynamic attack sensors still received Matter gravity during fighter hitlag. The fighter and its art stayed frozen but sensor Y and swept bounds drifted. The failing observations are preserved in `animation-before-sensor-freeze.json`. Root corrected the attack/grab factories to ignore gravity and added a real-Matter regression. `animation-runtime-observations.json` is the latest browser run; the three PNGs show first strike, harmless gap and reverse strike.

The final browser run exited 0: all three scenario groups passed with zero page errors. Strike/gap and trail assertions cover every recorded frame. Reverse-strike sensor geometry and sprite pose stay identical through seven hitlag steps and a 250 ms pause. Live up-smash hits at elapsed 9/24/40 for 4/3/11 damage, and stale history changes from zero to one only. TypeScript also passes.

Reference timing and remaining calibration limits are in [reference.md](reference.md). Existing code approximates skeletal hit regions and knockback; this is not a full Ultimate animation or physics port.
