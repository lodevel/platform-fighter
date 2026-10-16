# DonkeyKongCargoUThrow — Cargo Up Throw

Source: https://ultimateframedata.com/hitboxes/donkey_kong/DonkeyKongCargoUThrow.gif | images: 29 | canvas: 609x606 | delays: uniform 130ms per frame (3.77s total across 29 frames)
UFD row: startup 15, active not specified, total 29, endlag not specified, landing lag not specified, hitbox notes not specified, damage 12.0, notes --

## Overlay observations
| Index range | What is visible | Interpretation basis |
|---|---|---|
| 0–9 | DK crouched low and hunched tightly into a compact ball, arms curled in near his own chest/head. A tiny pink dot (his tie) is briefly visible in a few frames. Hurtbox blob over torso, no red hitbox. | Deep windup — storing energy low to the ground before an upward heave. |
| 10–13 | DK begins rising out of the crouch, torso straightening, arms starting to lift from the sides. | Rise into the throw. |
| 14 | Standing tall, both arms fully extended straight up overhead in a symmetric "goalpost"/V pose, fingers spread, mouth open (roar), DK-tie flipped up his torso showing "DK" lettering. | Release instant — the tall canvas (606px) reflects this full vertical extension. Matches startup=15 (index 14 + 1 = 15). |
| 15–19 | Body immediately twists/leans to one side, one arm dropping while the other stays raised, momentum carrying him off-balance. | Recoil right after the throw. |
| 20–28 | DK holds a twisted, off-balance stance, one arm still raised and the other lowered, gradually settling; a maroon tongue-shape appears near his open mouth in the final frames. | Continued recovery; does not fully return to a neutral crouch within the captured 29 frames. The maroon shape is his own tongue during a roar/taunt face, matching the same feature seen in the other cargo throws. |

## Mapping check
- image_count vs UFD total: 29 vs 29 → equal.
- red-region image indices + 1 vs UFD active frames: no red hitbox circle is drawn in any frame of this move, and activeframes is "not specified." Comparing instead to startup=15: the symmetric double-arm overhead pose sits at source index 14, and index+1 = 15, an exact match.
- Verdict: **partially verified** — 1:1 frame count with the UFD total and the release pose lines up exactly with startup, but no drawn hit marker exists to confirm the true active window.

## Motion by phase (index ranges, right-facing)
- Anticipation/windup 0–9: deep crouch, body curled into a tight compact ball, arms drawn in close to the chest/head, storing energy low to the ground.
- Rise 10–13: torso uncurling and lifting upward out of the crouch, arms beginning to swing up from the sides.
- Throw/release 14: standing tall, both arms thrust straight up overhead in a symmetric V, fingers splayed, head back and mouth open — the carried opponent is launched straight upward at this instant.
- Recovery 15–28: body twists off-balance from the throw's momentum, one arm dropping while the other stays raised, gradually settling into a lopsided stance without fully returning to neutral by the last captured frame.

## Contact part(s)
Both arms/hands releasing the carried opponent straight upward at full overhead extension (source index 14); no drawn hit indicator is present on this move.

## Proposed drawings (pose keys)
- `cargouthrow_windup` | source index 0 | cartoon gorilla crouched into a tight compact ball low to the ground, arms curled in close against the chest, head tucked down between the shoulders, legs bent deeply, facing right, storing energy.
- `cargouthrow_rise` | source index 11 | torso lifting up out of the crouch, arms swinging upward from the sides, legs straightening but knees still bent, head lifting to look up, facing right.
- `cargouthrow_release` | source index 14 | standing tall with both arms thrust straight up overhead in a wide symmetric V, fingers spread open, head tipped back and mouth open in a roar, legs planted and slightly bent for balance, facing right, as if something has just been launched straight up off both raised hands.
- `cargouthrow_recoil` | source index 16 | body twisted off to one side, one arm still raised high and the other dropped low, legs staggered wide for balance, head turned to follow the twist, facing right.
- `cargouthrow_settle` | source index 24 | body leaning at an angle with one arm partway raised and the other lowered near the hip, legs bent and planted unevenly, head angled upward still watching, facing right, not yet back to neutral.

## Uncertainties
The carried opponent is never rendered as a distinct model; the upward release is inferred entirely from DK's symmetric overhead double-arm pose at index 14 matching startup=15, not from a visible victim leaving the frame. The clip ends (index 28) still in a twisted/off-balance recovery pose rather than a fully neutral stance, so the true end-of-move recovery frame may lie beyond the 29 captured images, and unspecified landing-lag data may cover additional untracked frames.
