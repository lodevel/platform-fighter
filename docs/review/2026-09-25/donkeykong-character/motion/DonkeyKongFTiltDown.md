# DonkeyKongFTiltDown — UFD "Forward Tilt" (angled down)

Source: https://ultimateframedata.com/hitboxes/donkey_kong/DonkeyKongFTiltDown.gif | images: 34 | canvas: 776x428 | delays: uniform 130ms per frame (all 34 frames)
UFD row: startup 7, active 7—9, total 34, endlag 25, hitbox notes whichhitbox "No angle/angled", damage 8.0/9.0, notes "Arm intangibility on frame 6-9"

## Overlay observations
| Index range | What is visible | Interpretation basis |
|---|---|---|
| 0–4 | Low crouch, pale hurtbox volumes over the whole body, near arm bent up near the head, far arm reaching down-forward, feet planted | hurtbox display |
| 5 | Pale body volumes plus a solid dark-blue circle at the reaching (far) hand, one frame before the strike | other layer (blue, not an attack region) |
| 6–8 | Three overlapping red circles with white radius lines at the extended far fist, sitting slightly lower in the frame (near hip/ground height) than the no-angle version | attack region |
| 9–23 | Pale body volumes only; near/off hand rises to an open palm held up near the head for many frames while the body stays low and leaning forward | hurtbox display |
| 24–33 | Pale body volumes only; the raised hand lowers and the body settles back down into the resting crouch | hurtbox display |

## Mapping check
- image_count vs UFD total: 34 vs 34 → equal
- red-region image indices + 1 vs UFD active frames: [6,7,8]+1 = frames 7,8,9 vs active 7—9 → match
- Verdict: **verified 1:1**

## Motion by phase (index ranges, right-facing)
- Anticipation/windup 0–4: same low, all-fours posture as the other Forward Tilt variants — far arm reaching forward along the ground, near arm bent near the head, torso leaning forward.
- Coil 5: far hand curls into position, briefly marked by the unrelated blue overlay circle.
- Strike 6–8: far arm swings forward and extends to full reach, with the hitbox cluster sitting a touch lower in the frame (closer to hip/ground height) than the no-angle version, consistent with a downward-angled chop aimed at low/crouching targets; torso rotates forward, no body travel.
- Follow-through/hold 9–23: near hand rises to an open palm held near the head for a long stretch while the body stays low.
- Recovery/settle 24–33: raised hand lowers, body returns to the resting crouch.

## Contact part(s)
Far-arm fist/forearm, swung forward and slightly downward.

## Proposed drawings (pose keys)
- `windup-crouch` | source index 1 | Large cartoon gorilla low on all fours, right-facing; far arm reaching forward along the ground, near arm bent with fist near the head, torso leaning forward, feet planted.
- `coil-load` | source index 5 | Same low stance, far arm curled back closer to the body with the hand balled, torso rotated slightly away from the target.
- `chop-extended-down` | source index 7 | Torso rotated forward and hunched a little lower, far arm extended out and slightly downward toward hip/ground height, fist leading the strike, near arm still bent near the head.
- `palm-raise` | source index 12 | Torso low and leaning forward, far arm relaxing down after the strike, near/off hand raised beside the head with an open palm.
- `settle-return` | source index 28 | Gorilla lowering the raised hand, torso straightening slightly, returning toward the low resting crouch.
- `rest-crouch` | source index 33 | Fully settled low crouch identical to the opening idle pose.

## Uncertainties
Visually this clip is near-identical to the no-angle and angled-up Forward Tilt; the only distinguishable difference is the hitbox cluster sitting marginally lower in the frame during the strike (indices 6–8), read as the "angled down" trajectory. The body pose itself does not show a dramatically different arm angle at this render resolution. The blue circle at index 5 and the long open-palm hold (indices 9–23) are treated the same as in the other two Forward Tilt variants.
