# DK aerial Spinning Kong recovery

Targeted correction requested on 2026-10-02: verify that aerial up-special
reverses a fall, lifts DK and sustains recovery during the helicopter spin.
The existing fighter record remains in
[the character ledger](../../2026-09-25/donkeykong-character/README.md).

## Findings and correction

The original move did set upward velocity to −6 px/step, but then used
ordinary DK gravity and rise shaping. The real Matter integration test
ended game frame 43 **181.98 px below its starting point**. The original
focused suite failed six of nine checks: sustained lift, entry momentum
in both facings, and grounded Up + jump + special with 0/1/2-frame leads.
The three other checks passed. These are observations from the pre-fix
run, rather than claims from inspecting compiled data.

The aerial move now resets vertical velocity to −4.5 px/step and applies
0.02975 px/step² gravity through game frames 1–43. Ordinary gravity resumes
on frame 44. The spin remains finite and ends in helpless fall when still
airborne; it does not float indefinitely until landing. Damage interruption
and landing cancel the flight through the existing attack lifecycle.

Horizontal entry motion is retained instead of replaced with a facing
impulse. Neutral preserves momentum; directional input accelerates at
0.25 px/step² toward a maximum target speed of 8.5 px/step throughout the
move, including its recovery. Air drift processing before attack dispatch
still applies on the input press frame. Steering does not change facing.

Successful up-special starts clear the tap-jump/input buffers and pending
jumpsquat. Grounded W + G therefore stays a grounded spin instead of
launching an accidental full hop a few frames later. Outgoing hitlag
freezes the move; its release resumes special gravity without adding
ordinary jump-rise shaping.

## Sources and precision

UFD remains the main source. Its
[DK page](https://ultimateframedata.com/donkey_kong), checked 2026-10-02,
provides aerial attack windows ending at frame 43 and landing lag 38.
It supplies neither aerial total duration nor motion parameters.

Primary supplementary status scripts describe resetting speed from
`y_spd_air`, gravity from `air_accel_y × y_acl_mul`, steering from
`x_acl_air` / `x_spd_max_air`, and a transition to `FALL_SPECIAL` when
airborne motion ends:

The [primary source manifest](sources/primary-source-manifest.json) records
pinned raw URLs and SHA-256 hashes for the three captured files below. The
parameter-name Hash40 labels were verified against their string hashes.

- [SpecialHi initialization](https://github.com/Coolsonickirby/SSBU-Dumped-Status-Scripts/blob/b6bb1fecf7a0a3ee872cea73c94acccccadf8133/ghidra_scripts/lua2cpp_donkey.nro/donkey/donkey/status/SpecialHi/init.c).
- [SpecialHi motion-end transition](https://github.com/Coolsonickirby/SSBU-Dumped-Status-Scripts/blob/b6bb1fecf7a0a3ee872cea73c94acccccadf8133/ghidra_scripts/lua2cpp_donkey.nro/donkey/donkey/status/SpecialHi/main_loop.c).
- [Aerial ACMD](https://github.com/WuBoytH/SSBU-Dumped-Scripts/blob/59004685238a3f6f93bae905d3a4e079701c40b4/smashline/lua2cpp_donkey/donkey/SpecialAirHi.txt)
  clears attacks and sets `YACL_DEFAULT` at script frame 68. A local
  [existing digest](../../2026-09-25/donkeykong-character/sources/dk-scripts-digest.txt)
  also records that flag.

The numerical parameters 0.9 initial upward speed, 0.07 gravity multiplier,
0.05 horizontal acceleration and 1.7 maximum horizontal speed come from the
previous investigation's
[supplementary parameter table](https://www.ssbwiki.com/Donkey_Kong_(SSBU)/Up_special).
No raw vanilla parameter dump was found. At the project scale of 5 px/unit,
DK's 0.085 gravity gives `0.085 × 0.07 × 5 = 0.02975`.
The 43-frame gravity window is project calibration aligned to UFD's final
active frame, not a verified script-time conversion or measured Ultimate
trajectory. Do not infer game frame 44 solely by multiplying script frame
68 by motion rate 0.6. The existing 20-frame aerial recovery remains an
approximation. Grounded steering and arm intangibility remain separate gaps.

## Implementation and validation

The optional `multiHitRising.sustainedRise` record is strictly validated and
preserved through character JSON serialization and factory overrides.
Other rising specials that omit it retain their previous physics. Both
the DK literal and its generation template were updated; the full generator
was not rerun over the existing edited kit.

Focused real-physics verification: **13/13 pass**, covering lift, frame 44
gravity restoration, steering in both facings, finite spin, helpless repeat
blocking, landing reset, active landing with 38-frame lag, interruption,
outgoing hitlag, recovery after a reference launch, compressed integration
caused by another fighter, Wolf legacy behavior, and W-shaped jump input
with three special timings. Nine save/load/factory/validation checks pass.

The broader affected-area run passed 831/832 checks. Its sole failure was
a test setup that used Wolf, whose tuning does not enable the reference
physics grouping being tested. Using Link exercises that path; the
corrected focused suite then passed all 13 checks. The combined final
coverage is 832 passing checks across 15 files; the other 14 passing files
were not rerun after this test-only correction.

The final TypeScript check passed after the test-fixture correction. The full
`npm run build` passed, including palette generation (four cache hits, no
palette rebuilds). Production artifact: `index-1uuMguBt.js`, SHA-256
`051da41e653cd84dd53b2d1afb7ec60b6ffceaa0c7af5332fb4301f83c93a398`.
The build spent 10m57s transforming and copying the existing public assets,
including 724 MiB in `assets/gen`; no build configuration was changed.
Production browser verification: **34/34 checks pass**, with no page errors
or fatal errors. The browser fetched the exact artifact/hash above. Match
identity: `platform-fighter-sha256-3647ecf5ddbfc015ddde424da338515bb79671838f4cbb8fe33cf00166309c66`.
The [complete report](browser/dk-recovery-acceptance.json) contains per-frame
states, assertions and keyboard resolver observations.

| Production observation | Result |
| --- | --- |
| Activation from terminal fall | vy +8.15 → −4.47025 px/step on game frame 1 |
| Rise through game frame 43 | 165.3565 px; still rising at −3.22075 px/step |
| Gravity restoration on game frame 44 | vy increases by 0.5777778 px/step |
| Entry/neutral drift, both facings | vx −2.85 after press-frame ordinary drift; retained at neutral |
| Right steering, then left input | vx +4.65 after 30 right steps; subsequent left input decelerates; facing retained |
| Finite spin | ends on game frame 64, airborne/helpless, vy +8.15; another recovery is blocked |
| Landing | observed 38-frame lag; helpless clears and grounded variant becomes available |
| Actual W + G keyboard input | Up leads special by 0/1/2 frames; all stay grounded through game frame 26 |

Screenshots show [activation](browser/dk-recovery-frame-01.png),
[the lifted position at frame 43](browser/dk-recovery-frame-43.png),
[helpless fall](browser/dk-recovery-helpless.png) and
[the grounded keyboard spin](browser/dk-recovery-ground-keyboard-delay-2.png).
The lifted-position image was inspected. Existing art is retained; sprite
pose quality and spinning-animation parity are not established by these
motion checks.

The browser probe uses deterministic resolver overrides for motion scenarios,
then restores the ordinary resolver for real Playwright W/G events. It uses
the real MatchScene, stage support, camera and fixed-step physics. The landing
helper positions DK above the stage to isolate landing/reset behavior; it
does not establish an offstage edge-recovery playtest. Preview for review:
<http://127.0.0.1:4175/platform-fighter/>.

Commands use the existing WSL Node 22.23.3 because native Windows Node is
not on PATH. `npm run build` includes palette generation. Tests use Phaser's
Matter implementation and the same `stepCharacterPhysics` coordinator as
matches. Unit and physics results alone do not establish match behavior or
human controller feel.

## Workflow correction

The [character skill update](../character-skill-motion/README.md) now requires
a per-action movement/state contract and independent evidence for special
physics, phase endings, cancels and interruptions. Its evidence template and
acceptance procedure explicitly prevent treating the final attack frame as a
gravity cutoff or passing local calibration checks as proof of Ultimate parity.
The updated skill passed structural/link validation and two independent
walkthroughs; DK's exact phase-boundary research remains pending above.
