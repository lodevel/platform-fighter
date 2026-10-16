# DonkeyKongDSmash — UFD "Down Smash"

Source: https://ultimateframedata.com/hitboxes/donkey_kong/DonkeyKongDSmash.gif | images: 55 | canvas: 663x509 | delays: uniform 130ms per frame (all 55 frames)
UFD row: startup 11, active 11—12/13—14 (Early Fist/Late Fist/Arms), total 55, endlag 41, hitbox notes whichhitbox "Early Fist/Late Fist/Arms", damage 17.0/18.0/14.0, notes "Arm intangibility on frame 11-14. Charge hold is frame 2. Cannot rebound."

## Overlay observations
| Index range | What is visible | Interpretation basis |
|---|---|---|
| 0–9 | Camera faces DK roughly head-on (not the right-profile view used elsewhere); pale hurtbox volumes over the whole body; both fists raised straight up overhead symmetrically, held static for a charge pause | hurtbox display |
| 10–11 | A red circle with a white radius line on each forearm (inner, closer to the torso) plus a magenta/purple circle on each fist (outer, further from the torso) — both hands mirrored | attack region (red, inner) plus one other layer (magenta, outer, not an attack region) |
| 12–13 | A bold red circle on each fist (outer) plus a lighter salmon/red circle on each forearm (inner) — both hands mirrored, no magenta present | attack region (red, both positions) |
| 14–31 | Pale body volumes only; both arms held straight out flat to the sides at ground level, body prone/low, held static for a long stretch | hurtbox display |
| 32–47 | Pale body volumes only; arms sweep back inward and up from the sides through several crawling positions | hurtbox display |
| 48–54 | Pale body volumes only; body returns to a compact crouched profile similar to the other moves' resting pose | hurtbox display |

## Mapping check
- image_count vs UFD total: 55 vs 55 → equal
- red-region image indices + 1 vs UFD active frames: [10,11,12,13]+1 = frames 11–14 vs combined active 11—12/13—14 (11–14) → match
- Verdict: **verified 1:1** for the combined Early+Late Fist window (red is continuously present across indices 10–13); the brief magenta circle at the outer/fist position in indices 10–11 is a non-red "other layer" per the task's colour rule and is not counted toward the attack-region check
- Note: the third listed hitbox ("Arms") is not separately distinguishable by colour from "Late Fist" in this render — both appear in red-family circles at indices 12–13.

## Motion by phase (index ranges, screen-relative — see Uncertainties on facing)
- Anticipation/windup 0–9: DK crouches facing the camera and raises both fists straight up overhead symmetrically, holding a static charge pose (matching the "charge hold is frame 2" note).
- Strike 10–13: both arms swing down and outward to the sides simultaneously in a wide double hammer-fist motion; red hitboxes appear on both fists/forearms as the arms come down and out — first with a magenta circle at the outer fist position and a red circle at the inner forearm position (indices 10–11), then both positions turn red-family as the arms reach full extension to the sides (indices 12–13); this reads as a double ground/floor slam hitting to both the left and right of DK simultaneously.
- Hold-out 14–31: both arms stay extended flat out to the sides at ground level, body prone and low, held static for a long stretch (matching the very large 41-frame endlag).
- Recovery 32–47: the arms sweep back in from the sides, bending at the elbow and drawing closer to the body through several crawling intermediate positions.
- Settle 48–54: DK returns to a compact, low crouched pose similar to the resting stance seen in the other moves, easing back toward a side profile.

## Contact part(s)
Both fists/forearms, slammed down and out to the sides simultaneously (double ground slap, hitting both sides at once).

## Proposed drawings (pose keys)
- `overhead-charge` | source index 4 | Large cartoon gorilla crouched low, facing the camera, both fists raised straight up overhead symmetrically, torso braced, holding a static charge pose.
- `double-swing-early` | source index 10 | Both arms swinging down and outward from overhead, elbows bending, fists dropping toward shoulder height on each side, torso beginning to lower.
- `double-slam-extended` | source index 12 | Both arms fully extended out to the sides at low/ground height, fists clenched, torso low and wide, legs braced — the moment of the double ground slam.
- `arms-out-hold` | source index 20 | Both arms held flat out to the sides at ground level, body prone and low, static hold pose.
- `arms-sweep-in` | source index 38 | Arms bending back inward from the sides, drawing closer to the body, torso beginning to rise from the prone position.
- `settle-crouch` | source index 52 | Body returned to a compact, low crouched profile similar to the resting stance, arms tucked back in.

## Uncertainties
Like Up Smash, Down Smash renders DK facing the camera (front-on) for most of the animation rather than in right-facing profile; both arms move symmetrically, so "near/far arm" language does not apply — phase descriptions above use screen-relative/symmetric language instead. The camera only returns to something resembling the standard side profile in the last few frames (48–54). The three UFD hitbox labels ("Early Fist/Late Fist/Arms") cannot be cleanly separated by colour in this render: a magenta "other layer" circle is visible only at the outer/fist position in indices 10–11, while all other circles in the active window are red-family and were grouped together for the mapping check.
