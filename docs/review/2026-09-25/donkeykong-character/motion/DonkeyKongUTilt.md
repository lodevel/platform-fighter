# DonkeyKongUTilt — UFD "Up Tilt"

Source: https://ultimateframedata.com/hitboxes/donkey_kong/DonkeyKongUTilt.gif | images: 38 | canvas: 1030x788 | delays: uniform 130ms per frame (all 38 frames)
UFD row: startup 5, active 5—11, total 38, endlag 27, hitbox notes whichhitbox "--" (single hitbox), damage 10.0, notes "Arm intangibility on frame 5-11"

## Overlay observations
| Index range | What is visible | Interpretation basis |
|---|---|---|
| 0–3 | Low crouch on all fours, pale hurtbox volumes over the whole body, near arm already raised with an open hand near the head, pink tie with yellow "DK" logo visible through the translucent hurtbox on the chest | hurtbox display |
| 4–10 | A red circle with a white radius line present in every frame, always overlapping with an additional magenta/pink circle and a purple circle (three simultaneous, differently-coloured circles sweeping in an overhead arc from shoulder height, over the top of the head, down the far side) | attack region (red) plus two other layers (magenta and purple, not attacks) |
| 11–31 | Pale body volumes only; body holds a static, compact crouched pose with the arm back down | hurtbox display |
| 32–37 | Pale body volumes only; different silhouette — one arm reaches down toward the ground as the body leans forward, transitioning toward the idle knuckle-walking stance | hurtbox display |

## Mapping check
- image_count vs UFD total: 38 vs 38 → equal
- red-region image indices + 1 vs UFD active frames: [4,5,6,7,8,9,10]+1 = frames 5–11 vs active 5—11 → match
- Verdict: **verified 1:1**

## Motion by phase (index ranges, right-facing)
- Anticipation/windup 0–3: DK crouches low on all fours with the near arm already partly raised, open hand near the head/shoulder, other limbs planted; body coils slightly, no forward travel.
- Strike 4–10: the near arm swings through a large overhead circular arc — starting near shoulder height (index 4), rising above and just past the head at the peak (indices 6–8), then continuing the arc down the far side (indices 9–10); three overlapping hitbox circles (red plus the non-attack magenta/purple layers) travel together along the fist through the whole swing, consistent with a wide windmill-style overhead sweep; torso rotates with the arm, no body translation.
- Recovery 11–31: the arm returns to the body and DK holds a compact, low crouched pose — static and unchanging for a long stretch, matching the sizeable 27-frame endlag.
- Settle 32–37: the pose changes again — one arm reaches down toward the ground and the body leans forward, transitioning back toward the default knuckle-walking idle stance.

## Contact part(s)
Near-arm fist/palm, swept overhead in a wide circular arc.

## Proposed drawings (pose keys)
- `raised-ready` | source index 1 | Large cartoon gorilla crouched low on all fours, right-facing; near arm already raised with an open hand near the head/shoulder, other arm and legs planted, torso coiled slightly.
- `swing-rising` | source index 5 | Same low stance, near arm now swinging upward and forward, fist/hand rising past shoulder height toward the top of the arc.
- `swing-peak` | source index 7 | Near arm at the top of its arc directly above the head, torso rotated upward to follow the swing, other arm still braced low for balance.
- `swing-descending` | source index 9 | Near arm continuing its arc down the far side, past the peak, torso beginning to unwind back down.
- `guard-hold` | source index 18 | Gorilla settled into a compact, low crouched guard pose, both arms drawn back in near the body, held static.
- `reach-down-settle` | source index 34 | Body leaning forward with one arm reaching down toward the ground, transitioning back toward the default knuckle-walking stance.

## Uncertainties
Three simultaneous overlapping circles (red, magenta, purple) are visible together in every active frame (indices 4–10), unlike the single-hitbox moves. Per the task's colour rule only the red circle is treated as the attack region; the magenta and purple circles are described but not interpreted as damage, even though they likely represent additional simultaneous hitbox IDs along the swinging arm. The long static recovery hold (roughly indices 11–31) shows no visible change and was treated as one pose.
