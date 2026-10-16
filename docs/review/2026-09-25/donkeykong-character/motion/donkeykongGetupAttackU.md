# donkeykongGetupAttackU — Getup Attack (Face-Up)

Source: https://ultimateframedata.com/hitboxes/donkey_kong/donkeykongGetupAttackU.gif | images: 45 | canvas: 1164x658 | delays: uniform 130ms per frame (all 45 frames)
UFD row: no UFD row numbers (this GIF falls under the shared Misc Info section header "Getup Attacks", which has no startup/total/damage stats); ledge stats: "Neutral Getup": "1-33 intangible / 34 total".

## Overlay observations
| Index range | What is visible | Interpretation basis |
|---|---|---|
| 0–15 | DK lying on his back, camera/pose rotating from a near top-down view (both hands splayed out to the sides, feet near center) toward a side-on view as he rolls onto his front and tucks his legs beneath him, ending in a hunched push-up crouch | hurtbox display (pale purple/white body volumes throughout, no red) |
| 16 | Fully extended plank/push-up pose: one arm reaches straight out along the ground to the left, legs extended out to the right, no overlay tint (solid color) | solid-color body, pre-strike |
| 17–18 | Red capsule-shaped region with a white angle line covers the extended left arm/hand and the adjoining torso | attack region |
| 19–20 | Arm withdrawn, DK pulls back into a low push-up crouch, feet tucked, no red | hurtbox display returns briefly then clears |
| 21 | DK curls into a compact rounded ball shape (transition beat between the two sweeps) | solid-color body, no overlay |
| 22–23 | Red capsule-shaped region with a white angle line covers the opposite (right) arm/hand now reaching out along the ground to the right | attack region |
| 24–39 | Pale purple/white hurtbox overlay over his whole body as he pushes up through a hunched all-fours stance and begins rising | hurtbox display |
| 40–44 | Overlay fades to solid color; DK is upright in a hunched, ready stance, facing right | solid-color body, recovered stance |

## Mapping check
- image_count vs UFD total: 45 vs 34 (Ledge Stats "Neutral Getup" total) → differs by 11
- red-region image indices + 1 vs UFD active frames: [17,18,22,23]+1 = frames 18,19,23,24 vs active n/a (not published)
- Verdict: **unverified** (no published UFD startup/active/total numbers exist for this move; the only comparable number is the shared "Neutral Getup" ledge-stat total, which does not line up 1:1 with the 45 extracted images, so the count cannot be reconciled beyond noting the two visible attack windows)

## Motion by phase (index ranges, right-facing)
- Anticipation/windup 0–16: DK starts lying flat on his back with arms splayed to both sides; the camera/pose rotates as he rolls from a top-down supine view onto his front, tucking his legs beneath him and reaching one arm out along the ground until he is fully extended in a plank/push-up line from left hand to right foot.
- Strike 1 (left sweep) 17–18: the left arm sweeps flat along the ground to his left; contact part is the extended left hand/forearm.
- Transition 19–21: the arm withdraws, DK pulls into a low push-up crouch and briefly curls into a compact ball before re-extending to the other side.
- Strike 2 (right sweep) 22–23: the right arm now sweeps flat along the ground to his right — the opposite side from the first hit; contact part is the extended right hand/forearm. Together the two sweeps hit the left side first, then the right side, consistent with a getup attack covering both sides since he can't see which side an opponent is on while grounded.
- Recovery 24–44: DK pushes up through a hunched all-fours stance and rises to a hunched standing/ready posture, ending facing right.

## Contact part(s)
Both arms/hands sweeping flat along the ground in turn — left side first, then right side.

## Proposed drawings (pose keys)
- `supine-start` | source index 0 | Large cartoon gorilla lying flat on his back, right-facing convention, both arms splayed loosely out to the sides at shoulder height, knees relaxed and slightly bent, head resting flat.
- `roll-to-front` | source index 8 | Gorilla mid-roll from back to front, torso twisted to one side, one arm bent with the hand tucked near the chest, legs beginning to draw underneath the body.
- `plank-extend-left` | source index 16 | Gorilla in a full push-up/plank line along the ground, left arm fully extended straight out along the floor with an open hand, legs extended out behind to the right, torso flat and low.
- `sweep-left` | source index 17 | Gorilla low to the ground, left arm swept flat across the floor to the left with fingers splayed as if sweeping through the space beside him, torso braced low, right leg trailing.
- `curl-transition` | source index 21 | Gorilla curled into a compact rounded crouch, limbs tucked close to the body, head down, low to the ground.
- `sweep-right` | source index 22 | Gorilla low to the ground, right arm now swept flat across the floor to the right with fingers splayed, mirroring the first sweep, torso braced low.
- `rise-crouch` | source index 30 | Gorilla pushing up onto all fours, both arms bracing against the ground, hips lifting, legs bent beneath him, head still lowered.
- `stand-recover` | source index 44 | Gorilla in a hunched, upright ready stance, right-facing, arms relaxed at his sides near chest height, knees slightly bent, weight settled.

## Uncertainties
The camera/pose framing rotates and rescales during indices 0–15 (going from a near top-down view of him lying flat to a side-on view), which makes his exact facing hard to pin down during that stretch — it is treated here as a continuous roll rather than a camera cut. The transitions immediately around indices 19–21 are brief and could plausibly be split further, but they show no red region and were grouped as a single re-coil beat between the two strikes.
