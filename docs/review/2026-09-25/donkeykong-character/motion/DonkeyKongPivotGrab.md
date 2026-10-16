# DonkeyKongPivotGrab — Pivot Grab

Source: https://ultimateframedata.com/hitboxes/donkey_kong/DonkeyKongPivotGrab.gif | images: 41 | canvas: 910x476 | delays: uniform 130ms per frame (5.33s total across 41 frames)
UFD row: startup 12, active 12—14, total 41, endlag 27, landing lag --, hitbox notes not specified, damage --, notes --

## Overlay observations
| Index range | What is visible | Interpretation basis |
|---|---|---|
| 0–2 | Hurtbox blob only. DK is in a low running crouch, torso leaning forward/down, front hand reaching low, trailing leg stretched behind — this is his original right-facing dash approach (head/torso lean toward the right, forward hand on the right side, mirroring the DashGrab launch pose). | Establishes original facing = right, per legend, before any pivot occurs. |
| 3–7 | Hurtbox blob only. Both arms fling outward to opposite sides of the body (peak "cross"/T-pose at index 5), torso becoming more upright and frontal, legs planting beneath for balance. By index 7–8 the body has clearly rotated: muzzle and forward hand now read on the LEFT side. | This is the pivot/skid-turn itself — the transitional, near-symmetric silhouette makes an exact single "turn frame" hard to pin, but by index 8 the reversal is complete. |
| 8–10 | Hurtbox blob only. Now clearly left-facing: forward (left) arm reaching down/out with spread fingers, rear arm raised and bent near the shoulder, crouching lower in preparation for the grab thrust. | Post-pivot windup, facing now reversed from frames 0–2. |
| 11–13 | Hurtbox blob + the same magenta-purple capsule/pill region seen in the other two grabs (pink-to-purple gradient, open spread-fingered hand at the far tip), projecting to the LEFT of his torso at roughly chest height. Rear hand is a fist tucked near the muzzle. | GRAB region, reaching in the new (post-pivot) leftward direction. |
| 14–25 | Hurtbox blob only. Capsule gone; both hands become fists held close to the chin/chest, still facing left. Torso gradually rises from the low crouch across the range. | Whiffed-grab clutch hold, facing left throughout. |
| 26–40 | Hurtbox blob only. Continued straightening from crouch toward a compact standing-crouch, left-facing ready pose by the final frame. | Recovery tail, mirrors the other two grabs' endings but ends left-facing instead of right-facing. |

## Mapping check
- image_count vs UFD total: 41 vs 41 → equal
- grab-region (magenta capsule, not red) image indices + 1 vs UFD active frames: [11, 12, 13] + 1 = [12, 13, 14] vs UFD active "12—14" → match
- Verdict: **verified 1:1** — startup(12)+active(3, indices 11-13)+endlag(27) accounts for the full 41-frame span, and the capsule's index range converts exactly to UFD's active-frame numbers.

## Motion by phase (index ranges, right-facing at start, flips mid-animation)
- Anticipation/windup 0–7: DK approaches in a low running-crouch lean, originally facing/moving right (0–2); between roughly 3–7 he flings both arms out wide into a near-symmetric cross pose (peak at index 5) as he brakes and spins — this is the pivot itself.
- Turn complete / re-windup 8–10: now facing left, he crouches lower with the new forward (left) arm reaching down and the rear arm raised, priming the grab.
- Strike/hold 11–13: the forward (left) arm extends into the magenta grab capsule with an open hand at its tip; the rear hand curls into a fist near the muzzle.
- Recovery 14–40: hands withdraw into fists near the chin/chest (whiffed grab), held through an extended idle stretch (14–25) while the torso straightens, gradually rising into a compact standing-crouch, left-facing ready pose by 26–40.

## Contact part(s)
Single reaching hand (the forward/leading arm, now on the left after the pivot) — the magenta capsule marks the grab region at that hand; the rear hand stays a tucked fist near the muzzle throughout.

## Proposed drawings (pose keys)
- `pivot_run_approach` | source index 2 | large cartoon gorilla, right-facing, low running crouch with torso leaning forward and down, forward arm reaching low toward the ground, trailing leg stretched out behind, captured mid-stride of a forward dash.
- `pivot_turn_spread` | source index 5 | large cartoon gorilla, facing the camera mid-turn, both arms flung out wide to opposite sides at shoulder height, torso upright and centered, legs planted directly beneath for balance — the instant of reversing direction.
- `pivot_turn_settle` | source index 8 | large cartoon gorilla, now left-facing after completing the turn, low crouch stance, forward (left) arm reaching down and out with spread fingers, rear arm raised and bent near the shoulder, legs braced.
- `pivot_grab_extend` | source index 12 | large cartoon gorilla, left-facing, low crouch with legs braced, forward arm extended far out to the left at chest height ending in an open grasping hand reaching from the body, rear arm bent close to the chest.
- `pivot_grab_whiff` | source index 16 | large cartoon gorilla, left-facing, compact crouch, both hands clenched into fists held close near the chin and chest, shoulders raised, torso squared toward the reach direction.
- `pivot_grab_hold` | source index 26 | large cartoon gorilla, left-facing, standing crouch with knees bent, both fists held near the chest, weight settled in a relaxed idle stance.
- `pivot_grab_return` | source index 40 | large cartoon gorilla, left-facing, compact ready stance, one arm extended forward and down with an open hand, other arm bent near the torso, knees bent, weight low, settled into a neutral ready pose facing the new direction.

## Uncertainties
The exact single frame where the pivot "completes" is a judgment call: the turn is a gradual, near-symmetric rotation (indices 3–7) rather than a discrete snap, so the boundary between "still right-facing" and "now left-facing" is placed at index 8 based on the clearest read of muzzle/hand placement, but the true in-engine facing flip could land a frame or two earlier or later. Frames 0–1 are compact and ambiguous enough that facing direction can't be confirmed until index 2. No occlusion or lighting issues otherwise; background is flat throughout.
