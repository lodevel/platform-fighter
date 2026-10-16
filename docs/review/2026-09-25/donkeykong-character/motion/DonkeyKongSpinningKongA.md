# DonkeyKongSpinningKongA — Spinning Kong, Air

Source: https://ultimateframedata.com/hitboxes/donkey_kong/DonkeyKongSpinningKongA.gif | images: 70 | canvas: 1234x768 | delays: uniform 130ms per frame (9.1s total across 70 frames)
UFD row: startup 4/12..., active ¯\_(ツ)_/¯ (4-6/10-12/13-14/15-17/18-19/20-21/22-24/25-26/27-29/30-31/32-33/34-36/37-38/39-43), total -- (not listed by UFD), endlag --, landing lag 38, hitbox notes First/Multi/Final, damage 5.0/1.0/2.0, notes "Past frame 12, this move hits once every 1, 2, or 3 frames, seems inconsistent. Arm intangibility from frame 10-38."

## Overlay observations
| Index range | What is visible | Interpretation basis |
|---|---|---|
| 0–2 | Purple/white hurtbox glow only; DK curled into a tight airborne ball, no red anywhere | No red circles in any of the 3 thumbnails; pure hurtbox display layer |
| 3–5 | Two overlapping RED circles with white-cross marks appear over the torso/shoulder as the arm sweeps up/out | First visible hit window; matches UFD "First" hit (UFD frames 4-6, 1-based) |
| 6–8 | Red disappears completely; only hurtbox glow visible while the raised arm finishes its upward arc | Gap between the first hit and the multi-hit spin; matches UFD's unlisted gap (frames 7-9) |
| 9–42 | Red circles (1 to 3 overlapping, always with white crosses) continuously present at one or both extended arms/hands throughout the whole windmill spin | Matches the union of UFD's contiguous "Multi" windows 10-12 through 39-43 (1-based), which chain back-to-back with zero gaps between them |
| 43–69 | Red disappears entirely for the remainder of the clip; DK spreads into an X-pose, then retracts limbs, then curls into a falling/tumbling silhouette | Past UFD's last listed active window (39-43); consistent with the move's landing lag / post-spin helpless fall carrying no hitbox |

## Mapping check
- image_count vs UFD total: 70 vs -- → this move lists no total: UFD gives no total-frame value for Spinning Kong, Air, so image_count cannot be checked against it (explicitly unresolved, not "equal").
- red-region image indices + 1 vs UFD active frames: observed red at 0-based indices [3-5, 9-42] → +1 = [4-6, 10-43]. UFD's messy verbatim list "4-6/10-12/13-14/15-17/18-19/20-21/22-24/25-26/27-29/30-31/32-33/34-36/37-38/39-43" merges (all sub-windows from 10-12 onward are mutually contiguous) to exactly [4-6, 10-43] → **match**.
- Verdict: **partially verified** — the active-hit windows (4-6 and 10-43, 1-based) match UFD's messy notation exactly once its adjacent sub-ranges are merged, so hitbox timing is verified 1:1; however the overall total-frame count cannot be verified at all since UFD lists none, so the row as a whole is not "fully verified."

## Motion by phase (index ranges, right-facing)
- Anticipation/windup 0–8: DK curls into a tight ball while airborne (knees to chest, arms wrapped in), then uncoils — one arm sweeps up and out (producing the brief 3-5 hit) before rising fully overhead through a twisting, partly back-to-camera wind-up beat (6-8) with no further hit yet.
- Strike/hold 9–42: DK spins continuously with both arms flung outward like a windmill/pinwheel at roughly shoulder height; the leading hand/forearm is the striking part and alternates sides as the body rotates (a few frames show only one arm forward with the other swung behind the torso). Altitude and horizontal position look essentially held/stationary through this window — no clear travel is visible in the crops, just in-place spin.
- Recovery 43–69: the spin's momentum peaks in a wide arms-and-legs spread-eagle pose (43) with no more hits, then limbs retract and the body sags into an open reaching/drifting posture, finally curling into a compact, hunched, tumbling silhouette by the end — a helpless-fall look with no hitbox active.

## Contact part(s)
Both extended arms/fists while spinning (windmill-style), with the leading hand alternating sides as the rotation continues; briefly a single raised fist/forearm during the initial 3-5 hit.

## Proposed drawings (pose keys)
- `curl_tuck` | source index 0 | Large cartoon gorilla airborne, body curled into a tight ball facing right, knees drawn up to the chest, both arms wrapped in close to the torso, head tucked down toward the knees, no limbs extended — a compact coiled silhouette just before unwinding into a spin.
- `arm_sweep_start` | source index 5 | Large cartoon gorilla airborne and facing right, torso beginning to uncoil, one arm sweeping outward and upward past shoulder height while the other arm and both legs stay tucked near the body; the sweeping fist/forearm is the striking part, leading the start of the spin.
- `arm_raise_transition` | source index 7 | Large cartoon gorilla airborne, torso twisted so a back-quarter view faces the camera mid wind-up, one long arm raised straight overhead with fingers spread, the other arm and legs trailing loosely below — a coiled beat between the first swing and the full spin, not currently striking.
- `spin_full_extend` | source index 11 | Large cartoon gorilla airborne, facing right, both arms flung out straight to either side at shoulder height like a pinwheel, torso upright and centered, legs hanging loosely bent beneath the body; both extended fists/forearms are the striking parts as the body rotates.
- `spin_single_lead` | source index 19 | Large cartoon gorilla airborne, torso angled mid-rotation, one arm cocked in tight near the head/shoulder as the leading striking fist, the other arm swung behind the body and largely hidden by the rotation, legs bent and trailing below.
- `spread_eagle_end` | source index 43 | Large cartoon gorilla airborne, facing right, both arms and both legs flung fully outward into a wide X-shaped spread-eagle silhouette, torso flat and horizontal, head level with the shoulders — the spin's momentum peak at the instant the hit flurry ends.
- `drift_reach` | source index 50 | Large cartoon gorilla airborne, facing right, body upright and loosening, one arm reaching up and slightly forward with an open hand, the other arm relaxed at the side, legs bent and dangling — drifting with no attack active.
- `curled_helpless_fall` | source index 65 | Large cartoon gorilla airborne, facing right, body drawn back into a rounded, hunched silhouette with arms and legs loosely curled in front of the torso, head tucked slightly forward — a limp, tumbling helpless-fall pose with no striking part active.

## Uncertainties
- Ambiguous facing: during the wind-up (indices 6-8) and several isolated single-arm spin frames (16, 19, 26, 33, 37, 41), DK's torso twists so his back or a three-quarter-back view faces the camera rather than a clean right-facing read; treated as ambiguous rather than forced.
- Travel/altitude: each GIF frame is cropped to its own changed-pixel rectangle (per manifest disposal/source rectangles), not a fixed camera, so true world-space horizontal travel or rise/fall cannot be measured from crop coordinates. Visually the spin (9-42) appears to hold roughly the same position/altitude, and recovery (43-69) arcs into a fall, but this is a silhouette read, not a verified trajectory.
- A small pink/magenta blob appears near DK's hand at indices ~48-51; it does not match the red-hitbox color/cross styling nor a clear purple/magenta grab-sphere — likely a hurtbox-layer rendering artifact, not classified as an attack or grab region.
- No total-frame count is listed by UFD for this move, so the 27 trailing no-hitbox frames (43-69) can't be cross-checked against an official total; they most likely depict landing lag / post-spin helpless fall rather than being extraneous.
- All 70 frames were classified from the 5 contact-sheet thumbnails at sufficient clarity; no individual full-size source-NNNNN.png needed to be opened.
