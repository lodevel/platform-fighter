# DonkeyKongFTilt — UFD "Forward Tilt" (no angle)

Source: https://ultimateframedata.com/hitboxes/donkey_kong/DonkeyKongFTilt.gif | images: 34 | canvas: 776x431 | delays: uniform 130ms per frame (all 34 frames)
UFD row: startup 7, active 7—9, total 34, endlag 25, hitbox notes whichhitbox "No angle/angled", damage 8.0/9.0, notes "Arm intangibility on frame 6-9"

## Overlay observations
| Index range | What is visible | Interpretation basis |
|---|---|---|
| 0–4 | Low crouch, pale hurtbox volumes over the whole body, near arm bent up near the head, far arm reaching down-forward, feet planted | hurtbox display |
| 5 | Pale body volumes plus a solid dark-blue circle at the reaching (far) hand, one frame before the strike | other layer (blue, not an attack region) |
| 6–8 | Three overlapping red circles with white radius lines at the fully extended far fist, roughly chest height | attack region |
| 9–23 | Pale body volumes only; near/off hand rises to an open palm held up near the head for many frames while the body stays low and leaning forward | hurtbox display |
| 24–33 | Pale body volumes only; the raised hand lowers and the body settles back down into the resting crouch | hurtbox display |

## Mapping check
- image_count vs UFD total: 34 vs 34 → equal
- red-region image indices + 1 vs UFD active frames: [6,7,8]+1 = frames 7,8,9 vs active 7—9 → match
- Verdict: **verified 1:1**

## Motion by phase (index ranges, right-facing)
- Anticipation/windup 0–4: DK stays low on all fours, far arm reaching forward along the ground, near arm bent up near the head; body leans forward and slightly rocks back to load the swing; feet stay planted.
- Coil 5: the far hand curls into position (marked briefly by the unrelated blue overlay circle) just before the swing.
- Strike 6–8: the far arm swings forward across the body and extends to full reach at roughly chest height, fist/knuckles leading; torso rotates forward with the swing; no forward travel of the body.
- Follow-through/hold 9–23: after the swing, the near (off) hand rises up near the head with an open palm and is held there for a long stretch while the torso stays low and leaning forward — this is the long visible recovery pose.
- Recovery/settle 24–33: the raised hand lowers, torso straightens back up slightly, and DK returns to the same low resting crouch as the opening frame.

## Contact part(s)
Far-arm fist/forearm, swung forward in a backhand-style chop across the body.

## Proposed drawings (pose keys)
- `windup-crouch` | source index 1 | Large cartoon gorilla low on all fours, right-facing; far arm reaching forward along the ground, near arm bent with fist near the head, torso leaning forward, feet planted.
- `coil-load` | source index 5 | Same low stance, far arm now curled back closer to the body with the hand balled, torso rotated slightly away from the target as if loading a swing.
- `chop-extended` | source index 7 | Torso rotated forward, far arm fully extended out to the right at chest height, fist leading the strike, near arm still bent near the head, weight low and braced.
- `palm-raise` | source index 12 | Torso still low and leaning forward, far arm relaxing back down after the strike, near/off hand now raised up beside the head with an open palm, fingers spread.
- `settle-return` | source index 28 | Gorilla lowering the raised hand back down, torso straightening slightly, returning toward the low resting crouch, both arms coming back in.
- `rest-crouch` | source index 33 | Fully settled low crouch identical to the opening idle pose, both arms tucked in close, ready to act again.

## Uncertainties
The single dark-blue circle at index 5 does not match the red "attack region" convention and does not recur as a hitbox in later frames; it is described but not treated as damage per the task's colour rule. The long open-palm hold (roughly indices 9–23) shows no further visible change, so it is treated as one sustained pose rather than several distinct beats.
