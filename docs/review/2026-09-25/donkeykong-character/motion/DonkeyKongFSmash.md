# DonkeyKongFSmash — UFD "Forward Smash"

Source: https://ultimateframedata.com/hitboxes/donkey_kong/DonkeyKongFSmash.gif | images: 54 | canvas: 1282x601 | delays: uniform 130ms per frame (all 54 frames)
UFD row: startup 22, active 22—23, total 54, endlag 31, hitbox notes whichhitbox "Far/Close", damage 22.0/21.0, notes "Arm and head intangibility on frame 20-26. Charge hold is frame 14. Cannot rebound."

## Overlay observations
| Index range | What is visible | Interpretation basis |
|---|---|---|
| 0–20 | Pale hurtbox volumes over the whole body; both arms sweep through a large circular windmill motion — hands/fingers spread wide, arm swinging from low, around behind, and up over the shoulder, building momentum (charge hold pause visible around index 13) | hurtbox display |
| 21–22 | A red circle with a white radius line at the extended striking hand/fingers, overlapping a long magenta/purple capsule (pill) shape running along the forearm behind it | attack region (red) plus one other layer (magenta capsule, not an attack region) |
| 23–31 | Pale body volumes only; striking arm remains extended forward with fingers open, slowly relaxing | hurtbox display |
| 32–47 | Pale body volumes only; body hunches back down, hand returns with fingers spread, long slow retraction | hurtbox display |
| 48–53 | Pale body volumes only; final settle back into the low resting crouch | hurtbox display |

## Mapping check
- image_count vs UFD total: 54 vs 54 → equal
- red-region image indices + 1 vs UFD active frames: [21,22]+1 = frames 22,23 vs active 22—23 → match
- Verdict: **verified 1:1**

## Motion by phase (index ranges, right-facing)
- Anticipation/windup 0–20: DK winds up with a huge circular arm swing — starting low with fingers spread, sweeping the arm back and around behind him and up past the shoulder (a full windmill rotation), building momentum for the slap; a brief charge-hold pause is visible mid-swing (around index 13) matching the UFD "charge hold is frame 14" note; no forward body travel.
- Strike 21–22: the arm completes its swing and slams forward, striking with the open hand/fingers at full reach; a red hitbox sits at the fingertips with a long magenta capsule running along the forearm behind it; torso rotates fully into the swing.
- Follow-through 23–31: the striking arm stays extended forward with fingers open, slowly relaxing as the momentum bleeds off.
- Recovery 32–47: the body hunches back down and the hand returns with fingers spread, a long, slow retraction consistent with the sizeable 31-frame endlag.
- Settle 48–53: DK returns to the same low resting crouch as the opening pose.

## Contact part(s)
Near/swinging arm's open hand and fingers, driven by a full circular windmill swing.

## Proposed drawings (pose keys)
- `windup-low` | source index 2 | Large cartoon gorilla crouched low, right-facing, arm swinging low and back with fingers spread wide, beginning a big circular wind-up.
- `windmill-charge` | source index 13 | Arm swung up and back behind the body at the charge-hold point, fingers still spread, torso coiled and rotated away from the target, weight loaded on the back leg.
- `windmill-rising` | source index 18 | Arm continuing its circular path, now swinging up and over toward the front, torso beginning to rotate forward.
- `slap-extended` | source index 22 | Torso fully rotated into the swing, arm extended to full reach forward, open hand and fingers leading the strike, back leg braced, body low.
- `follow-through-open` | source index 26 | Striking arm still extended forward with fingers open, torso beginning to unwind, weight settling.
- `long-retract` | source index 40 | Body hunched low, arm partway back toward the body, fingers still spread, slow recovery underway.
- `rest-crouch` | source index 53 | Fully settled low crouch identical to the opening idle pose.

## Uncertainties
The windup is a long, continuous circular motion (roughly 20 frames) with no other distinct silhouette breaks besides the charge-hold pause around index 13; intermediate windup keys were chosen to represent the arc rather than every frame. The magenta capsule shape at indices 21–22 is a different shape (elongated pill, not a circle) from the other moves' non-red overlays, but is treated the same way per the task's colour rule (described, not interpreted as damage).
