# DonkeyKongFAir — UFD "Forward Air"

Source: https://ultimateframedata.com/hitboxes/donkey_kong/DonkeyKongFAir.gif | images: 55 | canvas: 837x791 | delays: uniform 130 ms across all 55 frames
UFD row: startup 18, active 18—20/21—23, total 55, endlag 32, landing lag 17, hitbox notes Early/Late Meteor/Late Arms, damage 16.0/15.0/13.0, notes "Autocancels on frame 56 onward"

## Overlay observations
| Index range | What is visible | Interpretation basis |
|---|---|---|
| 0–16 | Pale hurtbox only. DK curls forward in the air; arms raised near the head lower progressively while one arm cocks back near the chest and the other reaches forward-down. | hurtbox display (windup) |
| 17–19 | One RED circle over the reaching arm/fist, growing and shifting slightly toward the head/chest | attack region (early hit) |
| 20–22 | A smaller RED circle (upper) plus a larger MAGENTA circle (lower) appear simultaneously | two simultaneous regions — red likely one late hitbox ("arms"), magenta the other ("meteor"); colour alone doesn't confirm which |
| 23 | Pale hurtbox only | hurtbox display (hit ended) |
| 24–47 | Pale hurtbox only; DK curls tightly into a compact ball with arms wrapped around the body | hurtbox display (long endlag hold, tumbling ball) |
| 48–54 | Pale hurtbox only; DK uncurls, arms rise, legs spread, returning to a normal aerial stance | hurtbox display (recovery) |

## Mapping check
- image_count vs UFD total: 55 vs 55 → equal
- red-region image indices + 1 vs UFD active frames: [17,18,19,20,21,22]+1 = [18,19,20,21,22,23] vs "18—20/21—23" → match (combined early+late ranges reproduced exactly)
- Verdict: **verified 1:1**

## Motion by phase (index ranges, right-facing)
- Anticipation/windup 0–16: DK hunches forward in the air; arms raised near the head at first, then the near arm draws back close to the chest while the body compresses forward, readying a forward punch.
- Strike (early) 17–19: the near arm/fist reaches forward and down into the red-flagged region; torso leans into the punch.
- Strike (late) 20–22: a second, lower region (magenta) appears alongside the red one — consistent with a lower "meteor" hit alongside a separate "arms" hit occurring in the same window.
- Recovery 23–54: DK curls tightly forward into a compact tumbling ball immediately after the hit (23–47, a long held silhouette), then uncurls — arms rising, legs spreading — back to a neutral aerial stance by 54.

## Contact part(s)
Near-arm fist (early hit), with a simultaneous lower "meteor" region and a separate "arms" region during the late window — leading fist plus trailing arm/leg area.

## Proposed drawings (pose keys)
- `windup-raise` | source index 1 | A large cartoon gorilla airborne, both arms raised near its head, torso curling forward, legs bent beneath, facing right.
- `windup-cock` | source index 10 | A large cartoon gorilla airborne, one arm drawn back tight against the chest, the other hanging forward, torso hunched and compact, facing right.
- `strike-early` | source index 17 | A large cartoon gorilla airborne, one arm thrust forward and slightly down with the fist leading, torso leaning into the punch, other arm trailing back, facing right.
- `strike-late` | source index 21 | A large cartoon gorilla airborne, arm still extended forward from the punch, body tilted so the lower body/trailing limb dips below the fist, facing right.
- `tumble-ball` | source index 35 | A large cartoon gorilla airborne, curled into a tight ball with both arms wrapped around the torso and knees drawn up, facing right.
- `uncurl-recover` | source index 50 | A large cartoon gorilla airborne, arms unwrapping and rising, legs beginning to spread, torso opening back up from the tucked ball, facing right.
- `neutral-end` | source index 54 | A large cartoon gorilla airborne in a relaxed falling stance, arms near shoulder height, legs spread naturally, facing right.

## Uncertainties
The UFD row names three hitboxes (Early / Late Meteor / Late Arms) but only two colours (red, magenta) are visible in the late window (20–22); colour alone cannot confirm which of the two visible regions is "meteor" versus "arms".
