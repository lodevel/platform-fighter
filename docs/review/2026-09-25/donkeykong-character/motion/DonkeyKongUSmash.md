# DonkeyKongUSmash — UFD "Up Smash"

Source: https://ultimateframedata.com/hitboxes/donkey_kong/DonkeyKongUSmash.gif | images: 49 | canvas: 687x587 | delays: uniform 130ms per frame (all 49 frames)
UFD row: startup 14, active 14—15, total 49, endlag 34, hitbox notes whichhitbox "--" (single hitbox), damage 19.0, notes "Arm and head intangibility on frame 12-15. Charge hold is frame 6. Cannot rebound."

## Overlay observations
| Index range | What is visible | Interpretation basis |
|---|---|---|
| 0–9 | Camera faces DK roughly head-on (not the right-profile view used elsewhere); pale hurtbox volumes over the whole body; both hands sweep down low toward the ground symmetrically, small pink tongue visible sticking out, knees bent low | hurtbox display |
| 10–12 | Pale body volumes only; both arms swing upward and out to the sides, forearms taking on a dark-blue tint around index 11–12 | other layer (blue tint on forearms, not an attack region) |
| 13–14 | Two overlapping red circles with white radius lines above the head, at the two hands thrust straight overhead | attack region |
| 15–31 | Pale body volumes only; both fists held straight up overhead, then progressively lowering with elbows bending into a double-bicep "flex" pose | hurtbox display |
| 32–43 | Pale body volumes only; arms continue lowering toward the hips into a strongman double-fist pose, tongue visible again in some frames | hurtbox display |
| 44–48 | Pale body volumes only; body bends forward and the camera/pose returns to a compact crouched profile similar to the other moves' resting pose | hurtbox display |

## Mapping check
- image_count vs UFD total: 49 vs 49 → equal
- red-region image indices + 1 vs UFD active frames: [13,14]+1 = frames 14,15 vs active 14—15 → match
- Verdict: **verified 1:1**

## Motion by phase (index ranges, screen-relative — see Uncertainties on facing)
- Anticipation/windup 0–9: DK crouches low, facing the camera, and sweeps both hands down toward the ground symmetrically between his knees, gathering momentum; small tongue-out detail visible.
- Coil 10–12: both arms swing upward and out to the sides; forearms briefly take on a dark-blue tint (index 11–12), separate from the later red hitbox.
- Strike 13–14: both fists thrust straight up overhead simultaneously, red hitboxes appear above the head at both hands; this is a two-handed overhead double-fist smash.
- Follow-through 15–31: fists held straight up overhead at first, then arms progressively bend at the elbow into a double-bicep "flex" pose held at shoulder height.
- Recovery 32–43: arms continue lowering toward the hips into a strongman double-fist stance.
- Settle 44–48: body bends forward and returns to a compact, low crouched pose similar to the resting stance seen in the other moves, with the camera easing back toward a side view.

## Contact part(s)
Both fists/hands, thrust straight up overhead simultaneously (two-handed overhead punch).

## Proposed drawings (pose keys)
- `low-sweep-front` | source index 2 | Large cartoon gorilla crouched low, facing the camera, both hands sweeping down toward the ground between the knees, small tongue sticking out with effort, knees bent deep.
- `arms-rising-out` | source index 11 | Both arms swinging upward and outward to the sides symmetrically, torso beginning to rise out of the crouch.
- `double-uppercut` | source index 14 | Both fists thrust straight up directly overhead, arms fully extended vertically, torso upright, legs braced wide.
- `overhead-flex-hold` | source index 22 | Both fists still raised but now bent at the elbow into a double-bicep flex pose at shoulder height, chest puffed out.
- `hips-strongman` | source index 38 | Arms lowered further to hip height, fists clenched in a strongman pose, torso upright and facing forward.
- `bend-forward-settle` | source index 46 | Body bending forward, camera easing toward a side view, transitioning back toward the low resting crouch.

## Uncertainties
Unlike every other move in this set, Up Smash renders DK facing the camera (front-on) for most of the animation rather than in right-facing profile; "near/far arm" language does not apply cleanly here since both arms move symmetrically, so the phase descriptions above use screen-relative and symmetric language instead. The camera only returns to something resembling the standard side profile in the last few frames (44–48). The dark-blue tint on the forearms at indices 11–12 may coincide with the UFD note about arm/head intangibility on frames 12–15, but per the task's colour rule it is described as an observation only, not interpreted as a hitbox or damage region.
