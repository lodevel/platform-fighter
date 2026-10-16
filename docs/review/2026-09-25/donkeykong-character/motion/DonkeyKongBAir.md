# DonkeyKongBAir — UFD "Back Air"

Source: https://ultimateframedata.com/hitboxes/donkey_kong/DonkeyKongBAir.gif | images: 31 | canvas: 648x489 | delays: uniform 130 ms across all 31 frames
UFD row: startup 7, active 7—8/9—16, total 31, endlag 15, landing lag 11, hitbox notes Early/Late, damage 13.0/8.0, notes "Autocancels on frame 1-6 and 31 onward"

## Overlay observations
| Index range | What is visible | Interpretation basis |
|---|---|---|
| 0–5 | Pale hurtbox only. DK's open hand/fingers reach out to one side (his front); torso hunched, one leg tucking back for a kick. | hurtbox display (windup) |
| 6–7 | Two merged RED circles on the far side, opposite the open hand — behind him | attack region (early hit) |
| 8–15 | Two merged MAGENTA circles (same white-cross marker style) in the same position behind him, shrinking slightly toward the end | second colour, same marker style — read as the late-hit hitbox slot, not counted as red |
| 16–23 | Pale hurtbox only; open hand/fingers still visible, kicking leg lowering, body starting to level out | hurtbox display (immediate follow-through) |
| 24–30 | Pale hurtbox only; arms hang down, body rotates to a normal diagonal falling stance | hurtbox display (recovery) |

## Mapping check
- image_count vs UFD total: 31 vs 31 → equal
- red-region image indices + 1 vs UFD active frames: [6,7]+1 = [7,8] vs "7—8/9—16" → matches the early half exactly; the late half (9–16) is rendered in magenta at indices 8–15, not literally red
- Verdict: **verified 1:1** (union of red+magenta index ranges reproduces the full "7-8/9-16" split exactly)

## Motion by phase (index ranges, right-facing)
- Anticipation/windup 0–5: DK hunches forward with one open hand/arm reaching out in front for balance while the opposite leg cocks back behind him, readying a rear kick.
- Strike (early) 6–7: the cocked leg/foot snaps backward through the red-flagged region behind him; torso stays hunched, front arm still extended for balance.
- Strike (late) 8–15: the kicking leg continues sweeping through the same rearward arc, now flagged in magenta; the front hand/fingers remain open and extended.
- Recovery 16–30: the kicking leg lowers (16–23) as the open hand relaxes, then the whole body rotates back to a normal diagonal falling stance (24–30).

## Contact part(s)
The rear (kicking) foot/leg — the backward kick that gives Back Air its name.

## Proposed drawings (pose keys)
- `windup-reach` | source index 1 | A large cartoon gorilla airborne, one arm reaching straight out in front with fingers open, the opposite leg beginning to cock back behind it, torso hunched, facing right.
- `windup-cock` | source index 5 | A large cartoon gorilla airborne, front arm extended forward with an open hand, rear leg drawn back and bent, torso leaning forward, facing right.
- `kick-early` | source index 6 | A large cartoon gorilla airborne, rear leg snapping straight back behind the body with the foot leading, front arm still extended forward for balance, facing right.
- `kick-late` | source index 11 | A large cartoon gorilla airborne, rear leg fully extended behind the body continuing the kick, torso tilted forward, front hand open, facing right.
- `kick-settle` | source index 19 | A large cartoon gorilla airborne, kicking leg lowering back toward the body, front hand still open, torso leveling out, facing right.
- `neutral-fall` | source index 27 | A large cartoon gorilla airborne in a relaxed diagonal falling stance, arms hanging loosely, legs bent naturally, facing right.

## Uncertainties
DK's back faces the kick direction; since the task's convention treats DK as facing right throughout, the kicking leg extends to the left/behind him in these thumbnails — flagged here so the artist does not mistake the kick's direction of travel.
