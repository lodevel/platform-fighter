# DonkeyKongNAir — UFD "Neutral Air"

Source: https://ultimateframedata.com/hitboxes/donkey_kong/DonkeyKongNAir.gif | images: 38 | canvas: 809x634 | delays: uniform 130 ms across all 38 frames
UFD row: startup 10, active 10—13/14—26, total 38, endlag 12, landing lag 10, hitbox notes Early/Late, damage 12.0/9.0, notes "Autocancels on frame 1-9 and 27 onward"

## Overlay observations
| Index range | What is visible | Interpretation basis |
|---|---|---|
| 0–8 | Pale hurtbox volumes only. DK curls into a tucked ball; one arm sweeps from near the head up overhead as the torso rotates and legs draw in. By 8 both arms are flung out horizontally to the sides. | hurtbox display (windup) |
| 9–12 | 2–3 merged RED circles across the chest and both fists | attack region (early hit) |
| 13–25 | 2–3 merged MAGENTA/pink circles (same white-cross marker style as the red ones) in the same chest/fists area, narrowing from three lobes to one by the end of the range | second colour, same marker style as the confirmed hitboxes — read as the late-hit hitbox slot, but not counted in the strict "red" tally |
| 26–27 | Pale hurtbox only; arms drawing back in toward the torso, spin visibly slowing | hurtbox display |
| 28–37 | Pale hurtbox only; body uncurls, legs extend down, DK settles into a normal falling/neutral aerial stance | hurtbox display (recovery) |

## Mapping check
- image_count vs UFD total: 38 vs 38 → equal
- red-region image indices + 1 vs UFD active frames: [9,10,11,12]+1 = [10,11,12,13] vs "10—13/14—26" → matches the early half exactly; the late half (14–26) is rendered in magenta at indices 13–25, not literally red
- Verdict: **verified 1:1** — image count matches exactly, and the union of red (9–12) + magenta (13–25) index ranges reproduces the full "10-13/14-26" active-frame split with no gaps. Caveat: only the early hit is literally red.

## Motion by phase (index ranges, right-facing)
- Anticipation/windup 0–8: DK curls into a tight ball in midair; one arm sweeps from low near the head up overhead while the torso rotates and legs tuck under; by frame 8 both arms are spread wide to the sides, torso compact, readying to spin.
- Strike (early) 9–12: both fists and the chest sweep through the red-flagged arc simultaneously as DK's body spins in place; arms stay spread wide, no net travel.
- Strike (late) 13–25: the spin continues; the magenta-flagged region tracks the same fists/chest rotating through the circle, narrowing from three lobes to one as the arms pass different points of the arc.
- Recovery 26–37: rotation slows and arms draw back toward the torso (26–27), then the body uncurls and legs extend, settling into a normal falling aerial pose by 37.

## Contact part(s)
Both fists/forearms (and chest) sweeping through a full-body spin — a double-fist spin punch.

## Proposed drawings (pose keys)
- `tuck-start` | source index 0 | A large cartoon gorilla airborne, curled into a tight ball, one arm bent up near its head, legs drawn up beneath the torso, facing right.
- `windup-spread` | source index 8 | A large cartoon gorilla airborne, torso compact and slightly rotated, both arms flung straight out to the sides at shoulder height, legs tucked underneath, facing right, about to spin.
- `spin-strike-early` | source index 10 | A large cartoon gorilla airborne mid-spin, both arms swept out to the sides with fists leading, torso twisted so the chest faces forward, legs tucked, facing right.
- `spin-strike-late` | source index 18 | A large cartoon gorilla airborne continuing the spin, one arm swept across the front of the chest with the other trailing behind, torso rotated further than the early strike, legs tucked, facing right.
- `spin-strike-tail` | source index 24 | A large cartoon gorilla airborne finishing the spin, arms coming back together in front of the chest, rotation beginning to slow, legs tucked, facing right.
- `spin-slow` | source index 27 | A large cartoon gorilla airborne, arms drawn back close to the torso, spin visibly slowing, legs bent beneath the body, facing right.
- `recover-neutral` | source index 33 | A large cartoon gorilla airborne, body uncurled, arms relaxed near the torso, legs extended downward, settling into a normal falling stance, facing right.

## Uncertainties
The magenta late-hit colour is inferred to be a second hitbox slot (not literally red) based on the identical white-cross marker style shared with the confirmed red region; this is an observation from the render, not a confirmed fact from source code.
