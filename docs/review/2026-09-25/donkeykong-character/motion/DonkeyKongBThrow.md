# DonkeyKongBThrow — Backward Throw

Source: https://ultimateframedata.com/hitboxes/donkey_kong/DonkeyKongBThrow.gif | images: 39 | canvas: 817x530 | delays: 130ms flat, 39 frames
UFD row: startup=15, totalframes=39, basedamage=11.0, notes="--"; UFD active frames: n/a (not published for throws)

## Overlay observations
| Index range | What is visible | Interpretation basis |
|---|---|---|
| 0-10 | DK crouched low on all fours, facing right. A bright GREEN translucent circular-blob overlay (a color not defined in the brief's key — distinctly different from the pale purple/white hurtbox seen later) is tightly clustered over his upper back/shoulder region; purple fur and tan hands/feet are visible at the edges of the green cluster. | Grouped as the opening grab-hold pose — a stable, low, all-fours silhouette with the same unusual green overlay throughout. |
| 11-14 | The green overlay shifts and shrinks as one arm extends outward to the side with fingers splayed wide and the torso begins to twist. A small pink-and-yellow shape (read as his necktie's "DK" logo medallion, flipped forward by the deep crouch) is visible near his feet at index 11. | Grouped as the pivot/wind-up beat — a clear silhouette break from the static hold into an active spinning reach. |
| 15-16 | The overlay color switches abruptly from green to the standard pale purple/white hurtbox blob. DK's head/face reorients — he is now facing LEFT, having completed a turn from his starting right-facing. | Grouped as the turn-completion moment — both the overlay color and DK's facing change together in this narrow span. |
| 17-31 | Pale purple/white hurtbox blob continues, shaped like DK's own hunched torso. DK is crouched low, now facing left, one arm extended forward-left along the ground. A thin pink/red diagonal strap (his necktie) crosses his chest in several frames, and his tongue is visible in a few (e.g. ~30). | Grouped as the sustained low-crouch travel/settle after the turn — silhouette stays a consistent low, left-facing quadrupedal stance. |
| 32-38 | Same pale purple/white hurtbox pattern; DK still facing left in a low-to-mid crouch, gradually shifting weight and straightening slightly, tie strap still visible on his chest. | Grouped as the final recovery beat, easing toward a calmer stance without a sharp silhouette break from 17-31. |

## Mapping check
- image_count vs UFD total: 39 vs 39 → equal
- red-region image indices + 1 vs UFD active frames: none found (no red circle/white-cross hitbox is drawn in any of the 39 frames) vs n/a (not published for throws) → n/a
- Verdict: **partially verified** — frame count matches exactly, and the combined color-swap (green hurtbox-style overlay to pale purple/white) plus the facing-flip (right to left) both land at indices 15-16, a reasonably close match to UFD's startup=15. No drawn hitbox marker exists in any frame, and no distinct victim silhouette is ever rendered, so a true active window cannot be fully confirmed.

## Motion by phase (index ranges, right-facing at start)
- Anticipation/windup 0-10: DK crouches low on all fours facing right; a green-tinted hurtbox-style blob (distinct from his own purple/white one) sits clustered over his upper back/shoulder, read as the held opponent's hurtbox pressed close against him there.
- Strike/throw 11-16: DK's body coils and spins — one arm sweeps outward with fingers splayed as he slings the held opponent off his back, torso twisting through roughly a 180° turn; by index 16 he has completed the turn and now faces left, opposite his starting facing, meaning the victim is released toward the direction that was originally behind him.
- Recovery 17-38: DK settles into a low, wide crouch now facing left, one arm trailing forward from the swing, gradually shifting his weight and straightening slightly toward a neutral ready stance by the final frames.

## Contact part(s)
n/a — no victim dummy is ever rendered as a distinct silhouette. The green hurtbox-style blob at indices 0-10, positioned over DK's upper back/shoulder, is the best evidence for where the opponent is held; release is inferred at the pivot (indices 11-16), where the overlay disappears and DK completes his turn, sending the victim toward the direction that was originally behind him (screen-left relative to his start).

## Proposed drawings (pose keys)
- `crouch_carry` | source index 2 | large cartoon gorilla in a deep compact crouch on all fours, back rounded and slightly humped at the shoulders as though something is braced against his upper back, head dipped low, forearms planted on the ground for support, knees bent wide, facing right.
- `shift_load` | source index 7 | still crouched low on all fours, torso beginning to angle, one arm reaching forward along the ground for balance while the shoulders hunch upward as though adjusting a load riding on his back, facing right.
- `pivot_coil` | source index 11 | body coiling into a spin, one arm sweeping outward to the side at shoulder height with fingers spread wide as though flinging something clear of his back, torso twisting, weight shifting off his starting right-facing stance.
- `release_reach` | source index 13 | arm fully extended out to the side at shoulder height, fingers splayed open and empty, torso mid-turn, hips and legs pivoting to reverse his facing, head turning to look back over the opposite shoulder.
- `turn_complete` | source index 16 | low hunched crouch now facing the opposite direction from the start, one arm trailing down and forward from the swing, head level and turned to look forward in the new facing direction.
- `low_stride` | source index 23 | crouched quadrupedal stance facing the reversed direction, one arm extended forward along the ground, the opposite arm bent and tucked near the chest, legs bent wide for a stable low stance.
- `settle_recover` | source index 34 | slightly more upright crouch than the low stride, facing the reversed direction, mouth open, one arm relaxed near the torso, weight balanced evenly on both sides, easing toward a neutral ready stance.

## Uncertainties
The bright green circular-blob overlay at indices 0-10 is not covered by the color key given in the brief (only red=hitbox and pale purple/white=hurtbox were defined); it is inferred to be the held opponent's hurtbox rendered in a distinct color, based on its position over DK's upper back and its disappearance exactly when he completes his turn and releases — but no separate victim silhouette/body is ever directly visible to confirm this. The pink-and-yellow shape near DK's feet at index 11, and the pink/red diagonal strap on his chest from index ~17 onward, are both his own necktie accessory (pink fabric, yellow "DK" logo), not the victim, matching the same accessory identified on the sibling Down Throw and Cargo throw assets. Whether DK's turn is a true 180° pivot or some lesser angle cannot be pinned down exactly since no fixed background reference exists across frames; the "behind him" release direction is inferred from the facing-flip alone, not from a visible victim leaving the frame.
