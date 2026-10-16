# DonkeyKongJab1 — UFD "Jab 1"

Source: https://ultimateframedata.com/hitboxes/donkey_kong/DonkeyKongJab1.gif | images: 24 | canvas: 598x474 | delays: uniform 130ms per frame (all 24 frames)
UFD row: startup 5, active 5—6, total 24, endlag 18, hitbox notes whichhitbox "--" (single hitbox, no early/late split), damage 4.0, notes "Transitions to Jab 2 as early as frame 8."

## Overlay observations
| Index range | What is visible | Interpretation basis |
|---|---|---|
| 0–3 | Compact crouched gorilla silhouette, pale hurtbox volumes over whole body, near fist cocked near chest/face, far arm reaching low-forward for balance, small pink tie/DK-logo patch visible through the translucent hurtbox near the hip | hurtbox display |
| 4–5 | Two overlapping red circles with white radius lines at the fully extended near fist | attack region |
| 6–23 | Pale body volumes only; fist retracts and the crouch settles back to the same compact guard pose, held static for the tail of the clip (idle/ready hold) | hurtbox display |

## Mapping check
- image_count vs UFD total: 24 vs 24 → equal
- red-region image indices + 1 vs UFD active frames: [4,5]+1 = frames 5,6 vs active 5—6 → match
- Verdict: **verified 1:1**

## Motion by phase (index ranges, right-facing)
- Anticipation/windup 0–3: DK stays low on all fours, weight settling into a crouch; the near-side (front) arm curls its fist up toward the chest/chin while the far arm plants low and forward for balance; head stays tucked down between the shoulders; feet stay planted, no forward travel.
- Strike 4–5: the near fist snaps straight out to the right in a short, flat jab; torso rotates slightly forward with the punch; contact is at the knuckles of the extended fist, no body translation.
- Recovery 6–23: the fist retracts back toward the chest, torso unwinds, and DK settles back into the same crouched double-guard pose he started in; this held pose occupies the bulk of the remaining frames (roughly 10 onward looks identical), consistent with the long-ish 18-frame endlag and the frame-8 cancel window into Jab 2.

## Contact part(s)
Near-arm fist (single straight jab).

## Proposed drawings (pose keys)
- `guard-crouch` | source index 0 | Large cartoon gorilla crouched low on all four limbs, right-facing; near arm's fist curled up near the chin, far arm's palm planted flat on the ground out in front for balance, head lowered between hunched shoulders, weight compact and coiled.
- `cock-back` | source index 2 | Same low crouch, near fist pulled in tighter against the chest, elbow bent sharply, shoulder rotated back slightly as if loading a short punch; far arm still grounded for balance.
- `jab-extended` | source index 5 | Crouched gorilla stance with the near arm now fully extended straight out to the right at chest height, fist clenched at full reach, shoulder rotated forward into the punch, far arm still low and grounded, back leg braced.
- `retract` | source index 8 | Near arm midway back from full extension toward the chest, elbow bending again, torso unwinding back toward the crouch, far arm still grounded.
- `guard-reset` | source index 14 | Gorilla back in the same compact double-guard crouch as the opening pose, both fists drawn in near the chest, ready to jab again or idle.

## Uncertainties
None of the frames are ambiguous; the whole clip stays in a single static camera composition and DK faces right throughout. The long static tail (roughly indices 10–23) shows no visible change, so it was treated as one held recovery pose rather than several distinct beats.
