# DonkeyKongCargoBThrow — Cargo Backward Throw

Source: https://ultimateframedata.com/hitboxes/donkey_kong/DonkeyKongCargoBThrow.gif | images: 42 | canvas: 672x546 | delays: uniform 130ms per frame (5.46s total across 42 frames)
UFD row: startup 16, active not specified, total 42, endlag not specified, landing lag not specified, hitbox notes not specified, damage 13.0, notes --

## Overlay observations
| Index range | What is visible | Interpretation basis |
|---|---|---|
| 0–3 | Tight crouched ball, compact silhouette, small arm motions near the head. Hurtbox blob over torso, no red hitbox. | Windup — DK coiling low and compact before the swing. |
| 4–8 | One arm extends down/out to the lower-right, body leaning into the reach, still crouched. | Preparatory reach/test of the throwing arm. |
| 9–13 | Arm pulls back in close to the chest/chin, body hunched tighter; a pink fabric shape (his DK-tie) flutters near the chest in a couple of frames. | Gathering torque before the big swing. |
| 14–15 | One arm is thrown far out to the upper-left at full extension, fingers fully splayed, torso twisted hard in that direction. A pink/tan elongated shape appears near his chest/mouth. | Throw/pivot swing — the pink shape is DK's own necktie (printed "DK") flipping with the motion, not a hitbox or captive indicator. |
| 16–31 | Both arms spread wide, overhead and to the sides, in a sustained pose; body leans back and staggers; head tips back with mouth open (roar). | Recoil/follow-through carrying DK's momentum from the throw. |
| 32–41 | Arms lower, torso straightens back down into a settled crouch by 41. | Recovery back to a ready stance. |

No second dummy fighter or grab-hold sphere is distinguishable in any frame; the only non-hurtbox overlay colour seen is DK's own pink tie fabric.

## Mapping check
- image_count vs UFD total: 42 vs 42 → equal.
- red-region image indices + 1 vs UFD active frames: no red hitbox circle is drawn in any frame of this move, and activeframes is "not specified." Comparing instead to startup=16: the big one-armed throwing reach sits at source index 15, and index+1 = 16, an exact match.
- Verdict: **partially verified** — 1:1 frame count with the UFD total and the throw-swing pose lines up exactly with startup, but no drawn hitbox marker exists to confirm a true active window.

## Motion by phase (index ranges, right-facing)
- Anticipation/windup 0–8: tight crouched ball uncoiling slightly, one arm testing a reach down and out while the body stays low and compact.
- Wind-back 9–13: arm and torso pull in tight again, gathering torque, tie fabric flicking with the motion.
- Throw/release 14–16: one arm slings far out and up in a wide arc, torso twisting hard away from its start-facing, releasing the carried opponent at the top of the swing.
- Recovery/momentum 16–31: both arms fly wide, body leans back and staggers through the leftover rotational momentum of the throw, head thrown back.
- Return 32–41: arms settle down, torso straightens back into a grounded ready crouch.

## Contact part(s)
The throwing arm/hand releasing the carried opponent at the top of its wide swing (source index ~14–15); no drawn hit indicator is present on this move.

## Proposed drawings (pose keys)
- `cargobthrow_windup` | source index 0 | tightly crouched cartoon gorilla curled into a compact ball, knees drawn up, arms held close in front of the chest, head tucked down, facing right, weight low and coiled.
- `cargobthrow_reach` | source index 6 | still low and crouched, one arm extended down and out to the side with fingers open, torso leaning into the reach, other arm braced close to the body, facing right.
- `cargobthrow_windback` | source index 11 | hunched tight again, both arms pulled in close beneath the chin, torso coiled hard, legs bent under the body gathering for a big swing, facing right.
- `cargobthrow_throw` | source index 14 | torso twisted hard, one arm slung far out and up with fingers splayed wide at the top of a big arc, head turned to follow the arm, legs planted wide for leverage, facing right, as if something has just left the outstretched hand.
- `cargobthrow_followthrough` | source index 20 | body leaning back with both arms thrown wide to the sides, head tipped back and mouth open in a roar, legs staggered under the recoil of the swing, facing right.
- `cargobthrow_settle` | source index 36 | torso straightening back down into a balanced crouch, arms lowering to the sides, head leveling to look forward, facing right, calm ready stance.

## Uncertainties
The carried opponent is never rendered as a distinct model; the release direction is inferred from the arm's wide swing arc rather than from a visible victim leaving the frame. The move's name implies DK turns/pivots to throw the victim behind him, but the frames only show a strong torso lean/twist and a one-armed sweep — a full 180° turn of his facing is not unambiguously visible in this front-biased capture, so the exact behind-the-body release angle is an inference rather than a direct observation. The pink shape near his chest at index 14–16 is his own DK-tie fabric, confirmed by the visible "DK" lettering in nearby frames, not a hitbox or captive indicator.
