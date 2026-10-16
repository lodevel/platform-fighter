# DonkeyKongJab2 — UFD "Jab 2"

Source: https://ultimateframedata.com/hitboxes/donkey_kong/DonkeyKongJab2.gif | images: 31 | canvas: 915x747 | delays: uniform 130ms per frame (all 31 frames)
UFD row: startup 4, active 4—6, total 31, endlag 25, hitbox notes whichhitbox "--" (single hitbox), damage 6.0, notes "--"

## Overlay observations
| Index range | What is visible | Interpretation basis |
|---|---|---|
| 0–2 | Compact low crouch, pale hurtbox volumes over the whole body, near fist swinging down/back near the hip with the pink DK-tie patch visible, torso hunched forward and head lowered | hurtbox display |
| 3–5 | Three overlapping red circles with white radius lines climbing from mid-body height up toward the head/upper-shoulder area | attack region |
| 6–30 | Pale body volumes only; DK curls back into a tight guard ball with both fists near the face and holds that pose for the remainder of the clip | hurtbox display |

## Mapping check
- image_count vs UFD total: 31 vs 31 → equal
- red-region image indices + 1 vs UFD active frames: [3,4,5]+1 = frames 4,5,6 vs active 4—6 → match
- Verdict: **verified 1:1**

## Motion by phase (index ranges, right-facing)
- Anticipation/windup 0–2: from the Jab-1 guard, DK dips lower and drops his near fist down past his hip, torso hunching further forward and rounding, head tucking between the shoulders; feet stay planted, no forward travel.
- Strike 3–5: the near fist rises in a rising hook/uppercut arc — starting near the hip (index 3), passing shoulder height (index 4), and topping out near head height (index 5); torso uncoils and rotates upward with the swing; contact is at the fist through the whole rising arc.
- Recovery 6–30: the arm comes back down and DK folds back into a tight, rounded double-guard crouch with both fists drawn up near the face; this compact held pose fills almost the entire recovery window (matching the long 25-frame endlag), essentially returning to the same silhouette as the Jab 1 reset pose.

## Contact part(s)
Near-arm fist, rising hook/uppercut (hip to head height).

## Proposed drawings (pose keys)
- `low-coil` | source index 1 | Large cartoon gorilla in a deep, hunched crouch, right-facing; near arm's fist dropped down past the hip, far arm braced low, torso rounded forward, head tucked low between the shoulders, coiling for an upward swing.
- `uppercut-rising` | source index 3 | Same crouch with the near fist now swinging upward and forward, elbow driving up past hip height, torso beginning to uncoil and rotate upward.
- `uppercut-peak` | source index 5 | Torso rotated upward, near fist at its highest point near head/shoulder height, arm extended up-and-out in a hooking arc, chin lifted, weight still low on the legs.
- `guard-fold` | source index 9 | Gorilla folding back down into a tight rounded crouch, both fists drawn up close to the face, elbows in, torso compact and hunched.
- `guard-hold` | source index 20 | Fully settled tight guard ball: both fists held near the face, torso rounded and low, head down, identical to the resting pose held for the rest of the clip.

## Uncertainties
The camera/canvas for this clip is notably larger (915x747) than Jab 1's, but the pose progression reads the same way; no ambiguous frames were found. The long static tail (roughly indices 9–30) shows no visible change, so it was treated as a single held recovery/guard pose.
