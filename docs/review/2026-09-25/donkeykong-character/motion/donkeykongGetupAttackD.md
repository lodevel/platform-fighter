# donkeykongGetupAttackD — Getup Attack (Face-Down)

Source: https://ultimateframedata.com/hitboxes/donkey_kong/donkeykongGetupAttackD.gif | images: 45 | canvas: 1164x716 | delays: uniform 130ms per frame (all 45 frames)
UFD row: no UFD row numbers (this GIF falls under the shared Misc Info section header "Getup Attacks", which has no startup/total/damage stats); ledge stats: "Neutral Getup": "1-33 intangible / 34 total".

## Overlay observations
| Index range | What is visible | Interpretation basis |
|---|---|---|
| 0–15 | DK lying face-down (prone), viewed from a low side angle; body held in a compact hump with both hands tucked near his head/chest and legs trailing behind, pink foot soles visible; minor idle settling/wobble, no large pose change | hurtbox display (pale purple/white body volumes throughout, no red) |
| 16 | One arm extends down and forward along the ground, solid color (no overlay), windup for the first sweep | solid-color body, pre-strike |
| 17–18 | Red capsule-shaped region with a white angle line covers the extended right-reaching arm/hand and adjoining torso | attack region |
| 19–21 | Arm withdrawn; DK pulls into a tighter curled hump (transition beat between the two sweeps) | solid-color body, no overlay |
| 22–23 | Red capsule-shaped region with a white angle line now covers the opposite arm/hand reaching out along the ground to the left | attack region |
| 24–43 | Pale purple/white hurtbox overlay over his whole body as he pushes up onto hands and knees/feet and rises through a quadrupedal crouch | hurtbox display |
| 44 | Overlay fades to solid color; DK ends in a low, hunched all-fours crouch with both fists near the ground, not yet fully upright | solid-color body, recovered stance |

## Mapping check
- image_count vs UFD total: 45 vs 34 (Ledge Stats "Neutral Getup" total) → differs by 11
- red-region image indices + 1 vs UFD active frames: [17,18,22,23]+1 = frames 18,19,23,24 vs active n/a (not published)
- Verdict: **unverified** (no published UFD startup/active/total numbers exist for this move; the only comparable number is the shared "Neutral Getup" ledge-stat total, which does not line up 1:1 with the 45 extracted images, so the count cannot be reconciled beyond noting the two visible attack windows)

## Motion by phase (index ranges, right-facing)
- Anticipation/windup 0–16: DK lies prone in a compact hump with hands tucked near his head, settling with a small idle wobble, then plants one arm down and extends it forward along the ground.
- Strike 1 (right sweep) 17–18: that arm sweeps flat along the ground out to his right; contact part is the extended right hand/forearm.
- Transition 19–21: the arm withdraws and DK curls into a tighter hump before extending the other arm.
- Strike 2 (left sweep) 22–23: the opposite arm now sweeps flat along the ground out to his left — the opposite side from the first hit; contact part is the extended left hand/forearm. The face-down variant hits the right side first, then the left side (the reverse order from the face-up variant), again covering both sides since he can't see which side an opponent is on.
- Recovery 24–44: DK pushes up onto his hands and feet through a quadrupedal push-up motion, rising into a low hunched all-fours crouch with both fists near the ground; he has not yet reached a fully upright stance by the final frame.

## Contact part(s)
Both arms/hands sweeping flat along the ground in turn — right side first, then left side.

## Proposed drawings (pose keys)
- `prone-start` | source index 0 | Large cartoon gorilla lying face-down flat on the ground, right-facing convention, both hands tucked near his head/chest, legs trailing loosely behind with feet relaxed.
- `prone-settle` | source index 8 | Same prone hump pose, slight weight shift, hands still tucked near the head, legs relaxed behind — a held idle beat before the reach.
- `reach-extend-right` | source index 16 | Gorilla still low and prone, one arm now fully extended straight out along the ground to the right, open hand reaching, torso braced low, other arm still tucked near the head.
- `sweep-right` | source index 17 | Gorilla low to the ground, right arm swept flat across the floor to the right with fingers splayed as if sweeping through the space beside him, torso braced low, legs trailing.
- `curl-transition` | source index 21 | Gorilla curled into a tighter compact hump, limbs drawn close to the body, head down, low to the ground.
- `sweep-left` | source index 23 | Gorilla low to the ground, left arm now swept flat across the floor to the left with fingers splayed, mirroring the first sweep, torso braced low.
- `push-up-rise` | source index 32 | Gorilla pushing up off the ground into a quadrupedal stance, arms braced and extending, hips lifting, head rising, legs bending beneath him.
- `crouch-recover` | source index 44 | Gorilla settled into a low hunched all-fours crouch, right-facing, both hands curled into fists resting near the ground on either side, knees bent, head up and alert, not yet standing.

## Uncertainties
Indices 0–15 show only a small idle wobble rather than a clear pose change, so they are grouped as one settling phase rather than split further. The final frame (44) still shows DK in a crouched, hands-near-ground stance rather than fully upright, which differs from the companion face-up getup attack's ending pose — likely because the captured 45 frames end before the character fully stands, or the face-down variant's stand-up beat is inherently later in the real move than what this GIF captures.
