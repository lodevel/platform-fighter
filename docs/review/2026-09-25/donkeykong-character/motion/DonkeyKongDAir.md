# DonkeyKongDAir — UFD "Down Air"

Source: https://ultimateframedata.com/hitboxes/donkey_kong/DonkeyKongDAir.gif | images: 54 | canvas: 465x608 | delays: uniform 130 ms across all 54 frames
UFD row: startup 14, active 14—16, total 54, endlag 38, landing lag 14, hitbox notes --, damage 16.0/13.0, notes "Autocancels on frame 1-2 and 50 onward"

## Overlay observations
| Index range | What is visible | Interpretation basis |
|---|---|---|
| 0–12 | Pale hurtbox only; DK falls in a crouched, cannonball-like tuck, knees bent up, arms drawn toward the chest/head. A tiny persistent pink mark near the hip appears from about frame 2 onward. | hurtbox display (windup); the small pink hip mark is likely a fixed costume highlight, not a hitbox |
| 13–15 | A MAGENTA circle stacked above a RED circle, both directly below DK's feet | attack region (two vertically stacked regions below the feet) |
| 16–53 | Pale hurtbox only; DK re-tucks into an arms-wrapped cannonball crouch and holds it for a long stretch while continuing to fall (small pink hip mark persists); by 44–53 the arms/legs begin to unfurl, reaching outward/downward | hurtbox display (long held recovery, then landing unfurl) |

## Mapping check
- image_count vs UFD total: 54 vs 54 → equal
- red-region image indices + 1 vs UFD active frames: [13,14,15]+1 = [14,15,16] vs "14—16" → match
- Verdict: **verified 1:1**

## Motion by phase (index ranges, right-facing)
- Anticipation/windup 0–12: DK falls with knees drawn up and arms wrapped near his chest/head in a tight cannonball tuck, legs positioned below the torso.
- Strike 13–15: both feet punch downward together into the stacked red/magenta region directly beneath him — a double-foot stomp.
- Recovery 16–53: DK immediately re-tucks into the same cannonball crouch and holds it while continuing to descend for a long stretch (this move's very long floaty hold), then in the last few frames (44–53) the limbs begin to unfurl outward and downward, preparing to land.

## Contact part(s)
Both feet together (a downward double-foot stomp).

## Proposed drawings (pose keys)
- `tuck-fall` | source index 3 | A large cartoon gorilla airborne, falling in a tight crouch with knees drawn up to the chest and arms wrapped around the head, facing right.
- `pre-stomp` | source index 11 | A large cartoon gorilla airborne, still tucked tightly, legs beginning to extend downward, arms close to the chest, facing right.
- `stomp-strike` | source index 13 | A large cartoon gorilla airborne, both legs kicking straight down together with feet leading, arms tucked close to the torso for balance, facing right.
- `stomp-extend` | source index 15 | A large cartoon gorilla airborne, legs at full downward extension from the stomp, torso compact above them, facing right.
- `hold-tuck` | source index 30 | A large cartoon gorilla airborne, re-tucked into a tight cannonball crouch with arms wrapped around the knees/head, continuing to fall, facing right.
- `hold-tuck-late` | source index 46 | A large cartoon gorilla airborne, still in the tucked cannonball hold, a long stretch into the fall, facing right.
- `unfurl-land` | source index 52 | A large cartoon gorilla airborne, arms and legs beginning to open outward and downward from the tuck, preparing to land, facing right.

## Uncertainties
A small pink/magenta mark near the hip is visible from roughly index 2 through 53; it does not carry the white-cross marker style of the confirmed hitboxes and stays fixed in place while the real hitbox (13–15) is a separate, larger red/magenta pair. Treated as a costume/colour artifact rather than a hitbox, but flagged since it persists long enough to be mistaken for one.
