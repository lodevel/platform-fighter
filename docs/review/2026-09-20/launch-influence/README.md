# Reference launch influence

Continuation after [reference tumble speed-up](../README.md).
Authored Link/DK reference launches now apply launch-speed influence (LSI) at
hitlag release, after directional influence (DI).

Continued in [September 21 — Link up/down tilt launches](../../2026-09-21/tilt-launches/README.md).
Use that record for the current handoff; the results below describe DI/LSI.

## Release contract

The source order is gravity boost, DI rotation, then LSI multiplication of the
boosted launch magnitude. Both influence rules require tumble and DI eligibility.
LSI uses the post-DI angle: the strict intervals `(65,115)` and `(245,295)` degrees
disable speed changes, while their endpoints remain eligible. Full upward input
multiplies speed by **1.095**; full downward input multiplies it by **0.92**.
Partial input interpolates linearly. These rules come from the calculator's
[LSI/DI formulas](https://raw.githubusercontent.com/rubendal/SSBU-Calculator/refs/heads/gh-pages/js/formulas.js)
and [Knockback.calculate caller](https://raw.githubusercontent.com/rubendal/SSBU-Calculator/refs/heads/gh-pages/js/knockback.js),
inspected on 2026-09-20. Branch URLs are not immutable engine snapshots.

The implementation keeps the project's existing resolved input convention:
screen Y points down, keyboard diagonals normalize to the unit disc, and partial
analog magnitude is preserved. The same normalized vector feeds DI and LSI.
The calculator instead preprocesses raw integer controller axes independently;
its deadzone/saturation is not applied again to this game's resolved input.
The existing near-horizontal exclusion is mirrored around both world-space
horizontal directions. This is an explicit input/coordinate adaptation, not
console controller parity.

Only the final hitlag input selects launch influence. Earlier held directions
can cause the existing SDI position nudge but do not latch a launch direction.
Subsequent held input does not repeatedly scale the launch. LSI includes the
already-added gravity boost, but excludes external carried velocity and natural
gravity accumulated during flight. Knockback, tumble, hitstun groups and the
pre-DI vertical-gravity classification stay fixed.

The change is scoped to launches with an authored `referenceLaunch` profile,
currently Link and Donkey Kong receiving the converted reference strikes.
Legacy moves and recipients without that profile retain their existing DI path.
The pure knockback result remains an uninfluenced pre-release diagnostic; the
actual released velocity depends on the final hitlag input.

## Measured KO brackets

The [real-Matter evidence](physics.json) places an airborne defender at the
actual flat stage's ground centre, one pixel above its standing centre. The
solid floor remains present. Inputs are neutral until the last hitlag step;
that step's full-stick SDI contributes its ordinary three-pixel offset.
Blast-zone detection runs after each coordinated physics substep.

Each pair below is **safe percent / KO percent** at neighboring integer
pre-hit damage values. The horizon includes release and the final locked
integration, and excludes the first actionable step. These are controlled
project regression brackets, not Ultimate KO thresholds or live-match survival
predictions; later actionable travel can still cross a boundary. The fixture
applies the authored hit directly, without attacker contact/stale/rage or stock
and respawn handling. Top crossings use the project's positional blast-zone rule.

| Defender | Strike | Neutral | Up | Down | Left | Right |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Link | Forward tilt | 176 / 177 | 174 / 175 | 181 / 182 | — | — |
| Donkey Kong | Forward tilt | 198 / 199 | 196 / 197 | 203 / 204 | — | — |
| Link | Up air | 167 / 168 | — | — | 167 / 168 | 171 / 172 |
| Donkey Kong | Up air | 188 / 189 | — | — | 188 / 189 | 192 / 193 |

Forward tilt crosses the right boundary; up air crosses the top. Up-air
directions change DI while retaining LSI immunity. The fixture derives each
candidate bracket independently, then confirms both neighboring percentages
with real bodies and the blast-zone watcher. A final locked integration can
have a remaining-hitstun counter of zero; that does not make it an actionable
integration.

## Verification

- [Full suite](full-tests.txt): **340 files / 10,751 tests passed** in one
  aggregate run, including the final runtime and all new physics regressions.
- [Focused tests](focused-tests.txt): **125 passed**, covering LSI boundaries,
  analog/diagonal input, DI ordering, mirrored eligibility and existing combat.
- [Physics integration](physics-tests.txt): **26 passed**, including independent trajectories for
  both weights, release-only sampling versus SDI, external carry, pre-DI vertical
  gravity, legacy/unprofiled compatibility and the **12 KO brackets** above.
- [Build](build.txt): **passed**, including TypeScript, artifact
  `index-CH7_8XA2.js`.
- [Production influence probe](production/launch-influence.json): **18 actual-hit
  scenarios / 778 displayed trajectory frames passed**. Independent arithmetic
  supplies the expected knockback, release vector, decay, gravity and reaction
  schedule. Maximum position error is below `1.64e-10` pixels. **3,116 fixed
  steps** preserve one input/rule update and one world timestep; zero page/load
  errors. The probe injects resolved stick input; it does not exercise controller
  hardware. Platforms and KO registrations are disabled for isolated trajectories
  through the final locked hitstun step.
- [Neutral production regression](neutral-production/link-launch.json): all
  **276 frames** match the prior physics trace, including wall/ceiling contacts
  and recovery. Desktop **1280x720** and narrow **390x844** Lab fields, keyboard
  editing and undo pass on the same artifact, with zero page/load errors.

Final standalone [TypeScript check](typecheck.txt) and whitespace check passed.
No runtime or test logic changed after these checks.

## Next step

Extend the verified launch model to the next bounded portion of Link's kit,
starting with sourced up/down tilt records and measured launch outcomes.
Charged smash attacks and connected multi-hit/set-weight behavior need their own
contracts before conversion.
Exact directional-dodge timing, broader roster calibration, vanilla collision
and action-transition parity remain open. Replay playback and 3D stay deferred.
Human controller, audio and balance acceptance remains outstanding.
