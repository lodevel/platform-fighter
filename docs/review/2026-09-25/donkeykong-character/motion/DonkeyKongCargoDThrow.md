# DonkeyKongCargoDThrow — Cargo Down Throw

Source: https://ultimateframedata.com/hitboxes/donkey_kong/DonkeyKongCargoDThrow.gif | images: 44 | canvas: 536x458 | delays: 130ms flat, 44 frames
UFD row: startup=17, totalframes=44, basedamage=11.0, notes="--"; UFD active frames: n/a (not published for throws)

## Overlay observations
| Index range | What is visible | Interpretation basis |
|---|---|---|
| 0-3 | DK crouched, one arm raised high overhead with hand open and fingers spread, the other arm reaching forward-down; a pale purple/white hurtbox blob begins to appear over his chest. Facing right. | Grouped as the opening hold/lift pose — hand-up, reaching silhouette, before any curling begins. |
| 4-15 | DK's torso curls forward and down into an increasingly tight hunch, head dropping toward the ground; the hurtbox blob balloons to cover most of his chest/torso. A small pink triangular shape (his tongue) is visible near his chin/feet in a couple of frames (e.g. 3, 8) as his head nears the ground. | Grouped as the compress/curl-forward beat — a continuous, gradually deepening hunch with no sharp silhouette break. |
| 16-31 | DK reaches his most compact, near ball-shaped crouch, head tucked down between his shoulders; the hurtbox blob is at its largest/most opaque (near-solid white over the chest). A small orange/pink patterned shape pokes out near his feet — most likely his necktie's yellow "DK" logo medallion flipped down by the deep fold-over. | Grouped as the sustained low "slam/pin" hold — the manifest's per-frame crop rectangle shrinks sharply starting at index 16, confirming a genuine pose change here that aligns with UFD's startup=17. |
| 32-38 | DK begins to uncurl, torso rising, the hurtbox blob shrinking back toward chest-only coverage. A thin pink/red diagonal strap (his necktie, hanging normally again) becomes visible crossing his chest/shoulder as he straightens. | Grouped as the start of the recovery unwind, distinct from the static low hold in 16-31. |
| 39-43 | DK returns to a wide, upright ready-crouch stance facing right, hurtbox blob settled at normal chest-sized coverage, both arms bent in front at chest height with hands open and empty. | Grouped as the final neutral/settle beat, ending the clip near a resting stance. |

## Mapping check
- image_count vs UFD total: 44 vs 44 → equal
- red-region image indices + 1 vs UFD active frames: none found (no red circle/white-cross hitbox is drawn in any of the 44 frames) vs n/a (not published for throws) → n/a
- Verdict: **partially verified** — frame count matches exactly, and the pose reaches its deepest, most compact "slam/pin" compaction right around index 16-17 (also where the manifest's per-frame crop rectangle sharply shrinks, confirming a real pose change there), which lines up convincingly with UFD's startup=17. No drawn hitbox marker exists in any frame and no victim dummy is rendered to directly confirm the hit/pin moment, so this stays partial rather than fully verified.

## Motion by phase (index ranges, right-facing)
- Anticipation/windup 0-3: DK crouches with one arm raised high overhead, hand splayed, while the other arm reaches forward-down; weight low, as though bracing to bring something down.
- Strike/throw 4-31: DK curls his torso forward and down into an increasingly tight, ball-like crouch, pressing his chest and arms down toward the ground in front of his own feet; peak compaction (the presumed slam/pin moment) sits around indices 16-20, matching UFD's startup=17. No victim character is rendered as a distinct silhouette in any frame, so the exact carry point and release direction are inferred from DK's own body motion; the downward pressing/curling motion (rather than any upward or outward fling) is consistent with a "Down Throw" that pins the held opponent to the ground in front of him.
- Recovery 32-43: DK gradually uncurls, torso rising and shoulders opening as he straightens back to a wide, upright ready-crouch stance, ending with both hands open and empty at chest height.

## Contact part(s)
n/a — no victim dummy is rendered as a distinct silhouette anywhere in the clip. The implied contact point is DK's own torso/arms pressing down toward the ground in front of his feet at the deepest point of the crouch (indices ~16-20); release is inferred as downward, with the victim implied to land at ground level directly in front of/beneath him.

## Proposed drawings (pose keys)
- `grab_lift_high` | source index 0 | large cartoon gorilla in a crouched stance, right arm raised high overhead with hand open and fingers spread as though hoisting something up, left arm extended forward and down at hip height, knees bent deep, weight low, torso leaning slightly forward, facing right.
- `curl_begin` | source index 6 | torso beginning to round forward and down, head dropping toward the chest, both arms drawing in front of the stomach as though cradling something against the torso, back rounding, knees bent deeper, facing right.
- `hunch_tight` | source index 12 | torso fully rounded forward, head tucked down near the chest, both arms curled in tight against the stomach as though hugging something pinned to the torso, hips low, feet planted wide, facing right.
- `slam_peak` | source index 18 | lowest, most compact ball-like crouch, head down between the shoulders, both arms tucked under the chest and pressed down toward the ground in front of the feet as though pinning something flat to the floor, knees drawn up tight, facing right.
- `hold_ground` | source index 26 | sustained compact crouch, arms still pressed down and forward at ground level, weight fully lowered, back rounded, head bowed, facing right.
- `rise_unwind` | source index 35 | torso beginning to lift and open, head rising, one arm extending down and forward as though just releasing something at ground level, the other arm drawing back near the chest, knees still bent, facing right.
- `stand_ready` | source index 42 | wide, upright ready-crouch stance, chest open facing forward, both arms bent at chest height with hands loosely open and empty, knees bent, head level, facing right.

## Uncertainties
The pink triangular shape near DK's chin/feet at indices ~3-14, and the orange/pink patterned medallion shape near his feet at indices ~16-34, are both most likely fragments of his own necktie (pink fabric with a yellow "DK" logo circle) swinging into view as his head bends down close to his feet during the deep crouch — not a separate held victim — matching the same accessory identified on the sibling Down Throw and Cargo Backward Throw assets. No victim/dummy character is ever rendered as a distinct silhouette in any of the 44 frames, so the true grip point on the victim and the exact release velocity/arc cannot be directly confirmed; they are inferred from DK's own curling-and-uncurling body motion. No red hitbox marker appears anywhere, so the active-frame side of the mapping check cannot be verified against UFD (which itself does not publish active frames for throws).
