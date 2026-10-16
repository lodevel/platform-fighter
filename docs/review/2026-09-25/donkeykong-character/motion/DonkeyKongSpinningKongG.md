# DonkeyKongSpinningKongG — Up B (Spinning Kong)

Source: https://ultimateframedata.com/hitboxes/donkey_kong/DonkeyKongSpinningKongG.gif | images: 104 | canvas: 928x681 | delays: uniform 130ms per frame (13.52s total across 104 frames)
UFD row: startup 19/25/32/40/49/55/62, active ¯\_(ツ)_/¯ (19/25-27/32-33/40-42/49-50/55-58/62), total 104, endlag 42, landing lag --, hitbox notes First/multi/Final, damage 5.0/1.3/4.0, notes "Armor on frame 5-17. Arm intangibility on frame 19-24."

## Overlay observations
| Index range | What is visible | Interpretation basis |
|---|---|---|
| 0-3 | Crouched DK, pale/translucent purple-white hurtbox blob draped over whole body, arms drawn up, roughly facing camera-right | Windup pose; no red — matches armor window (UFD frame 5-17 ≈ index 4-16) starting to appear |
| 4-15 | Body rotates into a tight standing spin; view cycles through back-facing (dark rear silhouette) and side views; no red overlay | Startup spin-up before first hitbox; UFD startup 19 (index 18) has not been reached yet |
| 16-17 | DK pitches forward into a handspring/cartwheel plant, one arm reaching toward the ground; still no red | Transition from upright spin into grounded cartwheel; still pre-hit |
| 18 | Single red circle-with-cross trio strung along an extended limb reaching down-right, body bent forward with head low, legs tucked | First hitbox window, matches UFD startup frame 19 → index 18 exactly |
| 19-23 | No red; body cycles through crouched/upright poses, arm raised overhead | Gap between first and second hit windows; overlaps UFD "arm intangibility frame 19-24" ≈ index 18-23 |
| 24-26 | Red circle + magenta/purple spheres trailing to the right along an extended arm, body leaning left | Second hit window; matches UFD active "25-27" → index 24-26 |
| 27-30 | No red; brief crouch/upright recovery between spin passes | Gap between hit windows two and three |
| 31-32 | Red + magenta spheres reappear along extended arm, body leaning in cartwheel pose | Third hit window; matches UFD active "32-33" → index 31-32 |
| 33-38 | No red; DK cycles upright, arm raised, chest-forward crouch poses | Gap between hit windows three and four |
| 39-41 | Red + magenta spheres along extended arm/leg, cartwheel-leaning pose | Fourth hit window; matches UFD active "40-42" → index 39-41 |
| 42-47 | No red; recovery crouch/upright poses repeat | Gap between hit windows four and five |
| 48-49 | Red + magenta spheres reappear, extended-limb cartwheel pose | Fifth hit window; matches UFD active "49-50" → index 48-49 |
| 50-53 | No red; brief upright/crouch gap | Gap between hit windows five and six |
| 54-57 | Red + magenta spheres persist across four consecutive frames, cartwheel-leaning poses | Sixth (longest) hit window; matches UFD active "55-58" → index 54-57 |
| 58-60 | No red; DK arcs into a low forward-leaning crouch, arm swinging down | Gap before the final hit; final wind-up into the lunge |
| 61 | One large horizontally-stretched red pill/capsule with a single cross, overlaid across DK's torso and fully extended arm while he lies flattened in a horizontal belly-flop/lunge pose | Final hitbox window; matches UFD active "62" → index 61 exactly; visibly a single merged hitbox rather than the row-of-circles style used earlier |
| 62-103 | No red at all; DK returns upright and repeats a static "victory beat-chest" pose (alternating raised fists) for the remainder of the clip | Endlag; matches UFD endlag 42 (104-62=42 remaining indices) |

## Mapping check
- image_count vs UFD total: 104 vs 104 → equal
- red-region image indices + 1 vs UFD active frames: [19, 25, 26, 27, 32, 33, 40, 41, 42, 49, 50, 55, 56, 57, 58, 62] vs 19/25-27/32-33/40-42/49-50/55-58/62 → match
- Verdict: **verified 1:1** (every UFD active-frame window converts via F-1 to an observed red-overlay index range with no discrepancies; image_count equals totalframes exactly)

## Motion by phase (index ranges, right-facing)
- Anticipation/windup 0-17: DK crouches low with a pale armor-tinted hurtbox overlay, arms drawn up near the chest, then spins upright in place (feet planted, body rotating through back-facing views) before pitching forward and planting a hand on the ground to begin the cartwheel — no limb has left the body silhouette yet.
- Strike/hold 18-61: DK performs a repeating grounded cartwheel/handspring — at least one hand or foot stays in contact with the ground at all times (never fully airborne), while his opposite arm/leg swings outward in a wide arc, sweeping through 6 short hit windows (18, 24-26, 31-32, 39-41, 48-49, 54-57) as he rotates through consecutive spin passes without net horizontal travel; the sequence ends with a single elongated final lunge (index 61) where he flattens into a horizontal belly-flop with one arm fully extended forward, carrying the largest, merged hitbox of the move.
- Recovery 62-103: DK pushes back upright to a standing stance and holds a repeating chest-thump idle (alternating raised fists in front of the chest) for the rest of the clip, with no further hitboxes — this is the 42-frame endlag.

## Contact part(s)
The extended/swinging arm (and occasionally the leading leg) during each cartwheel pass carries the small circular hitboxes; the final hit (index 61) is carried by the fully outstretched arm/torso in the horizontal belly-flop lunge.

## Proposed drawings (pose keys)
- `anticipation-crouch` | source index 0 | Large cartwheel-brown gorilla crouched low, knees bent wide, both fists drawn up near the chest, torso hunched forward, head tucked down, standing grounded on both feet, facing right.
- `upright-spinup` | source index 8 | Gorilla mid-pirouette, torso twisted so the back faces camera-right, arms tucked in close to the body, feet planted shoulder-width on the ground, knees slightly bent, spinning in place.
- `handspring-plant` | source index 16 | Gorilla pitching forward into a handstand transition, one arm reaching down and forward to plant a fist on the ground, opposite arm bent near the head, both legs lifting off the ground behind him, torso at a diagonal.
- `first-strike-sweep` | source index 18 | Gorilla braced on one bent leg with head low and one arm tucked near the face, opposite arm/leg swept out low and to the right at full extension, fist leading, grounded stance, facing right.
- `cartwheel-extend` | source index 40 | Gorilla in mid-cartwheel with one hand planted on the ground beneath the torso, legs splayed apart with the trailing leg kicked up and outward to the right, opposite arm raised for balance, body diagonal, facing right.
- `cartwheel-high-arc` | source index 55 | Gorilla inverted mid-spin, one arm planted on the ground supporting the torso, both legs swung up and out to the right at the top of the arc, torso curved, head tucked, facing right.
- `belly-flop-final` | source index 61 | Gorilla flattened into a horizontal lunge low to the ground, chest and torso stretched forward, one arm fully extended straight out to the right ending in a forward fist, legs trailing bent behind, body nearly parallel to the ground, facing right.
- `recovery-chest-thump` | source index 80 | Gorilla standing upright on both feet, knees slightly bent, both fists raised in front of the chest mid-pound, torso puffed out, head upright, facing right, grounded neutral stance.

## Uncertainties
- Indices 4-15 and several points within the 16-61 cartwheel range show DK's back or a foreshortened top-down view facing camera, not a clean right-facing side silhouette — these are genuine ambiguous-facing moments inherent to a spinning move, not a misread; the pose-key prompts above pick the clearest right-facing instant near each phase instead of forcing a read on the ambiguous frames.
- The move is a continuous grounded cartwheel with brief moments where both feet leave the ground during leg-swing arcs (only the support hand stays grounded) — this is "grounded" in the sense that a hand/foot always touches the ground and he never leaves the ground entirely as a jump, but it is not a stationary plant-and-spin; worth flagging to the gameplay author since "grounded" doesn't mean fully static.
- Could not determine from the sprite alone whether DK's overall position drifts horizontally across the 7 hit passes (the GIF appears roughly camera-locked on his center of mass with no visible background reference), so any forward creep during the multi-hit spin is unconfirmed.
