# DonkeyKongHandSlapG — Down B (Hand Slap)

Source: https://ultimateframedata.com/hitboxes/donkey_kong/DonkeyKongHandSlapG.gif | images: 21 | canvas: 1008x639 | delays: uniform 130ms per frame (2.73s total across 21 frames)
UFD row: startup 12/23, active 12—13/23—24... (repeats every 26 frames if mashed), total 46, endlag 22, landing lag --, hitbox notes not specified, damage 14.0, notes "Each additional rep takes another 26 frames as you mash."

## Overlay observations
| Index range | What is visible | Interpretation basis |
|---|---|---|
| 0-3 | No overlay. DK crouched on all fours, one arm raised up and back over his head, the other arm/hand planted flat on the ground reaching forward; the raised arm progressively lowers frame to frame. | Pure hurtbox-free windup poses, no red present. |
| 4-5 | Four overlapping RED circles with white cross marks span most of the canvas width, centred low on DK's body. DK is prone, chest low, the previously-raised arm now tucked/curled near his torso (just impacted), the other arm still stretched forward along the ground. | Clear attack hitbox per the legend; four overlapping bubbles likely reflect GIF disposal-accumulation of the same hit's render across consecutive engine frames, not four separate hits. |
| 6-8 | No red. DK stays low/crouched, one hand still down near torso, other arm/hand resting or beginning to shift, head down. | Hitbox has cleared; body settles after first slap. |
| 9-12 | No red. The arm that was stretched forward on the ground lifts and rises overhead (mirrors the 0-3 windup but with the other arm). | Second windup, no hitbox yet. |
| 13-14 | Four overlapping RED circles again, same low/wide placement as 4-5. DK prone again, the newly-raised arm now tucked near torso (impact), the other arm stretched forward on the ground. | Second slap impact, same accumulation pattern as the first window. |
| 15-20 | No red. DK rises from the ground back toward the crouched idle stance, mouth open (roar) in the later frames, one arm lifting overhead again by frame 20, mirroring frame 0-3's opening pose. | Recovery/return to loop-ready stance for a mashed repeat; no hitbox present. |

## Mapping check
- image_count vs UFD total: 21 vs 46 → differs by 25 (GIF shows key poses only, not one image per game frame)
- red-region image indices + 1 vs UFD active frames: [5, 6, 14, 15] vs 12—13/23—24 → mismatch in absolute numbers, though the qualitative structure (two ~2-frame active windows, second one roughly 9 GIF-indices after the first, vs 11 game-frames in the UFD data) lines up in count and order.
- Verdict: **partially verified** — two distinct red-hitbox windows are present, matching the UFD data's two active windows (first slap, second slap) in count and relative order, but the manifest itself states gameplay_mapping is "unresolved," and the raw index numbers do not correspond 1:1 to UFD's frame numbers (21 images vs 46 total frames means this GIF condenses/skips non-eventful frames).

## Motion by phase (index ranges, right-facing)
- Anticipation/windup 0-3: DK crouches low on bent legs, one massive arm lifts from the ground up and back over his head (the arm that will strike first), while the other arm/hand stays planted flat on the ground in front of him for support.
- Strike/hold 4-5 (slap 1): the arm that was raised swings down and slaps its open palm onto the ground close to his own torso/chest — a short-range hit right under/beside him, not out at arm's length. Per the leg/end, this is the **trailing (rear) hand** — the one drawn up and back at the start of the loop. The other, **leading (front) hand**, stays extended forward along the ground as a static support/brace throughout this window.
- Recovery 6-8: both palms rest near the ground, torso stays low and hunched, no hitbox; DK holds this compact pose briefly between slaps.
- Anticipation/windup 9-12: the leading (front) hand, previously braced on the ground, lifts and rises up and back overhead — mirror image of the first windup, now performed by the other arm.
- Strike/hold 13-14 (slap 2): the leading hand swings down and slaps the ground close to his torso, in essentially the same low/close spot as slap 1; the trailing hand (used for slap 1) is now the one stretched forward along the ground as the brace. This confirms the two slaps **alternate hands** (trailing hand first, leading hand second).
- Recovery 15-20: DK pushes back up off the ground, mouth opens in a roar around 18-20, and one arm rises overhead again by frame 20 — reaching a pose matching the very start (0-3), i.e. the loop point that lets the player mash for another 26-frame rep.

## Contact part(s)
Both open palms, used one at a time in alternation; each slap lands close to DK's own body (near his chest/torso), not at extended arm's reach. The four-circle hitbox visual spans a good portion of the canvas width on both sides of his silhouette, suggesting the ground slap's threat region has some horizontal spread beyond a single point directly beneath him, rather than being a pinpoint hit.

## Proposed drawings (pose keys)
- `windup_a` | source index 0 | Large cartoon gorilla crouched low on bent legs, right-facing, knuckle-walking stance; one massive arm raised high overhead curling back behind the head, the other arm's open palm planted flat on the ground out in front of the torso for support; head down and forward, grounded.
- `slap_a_impact` | source index 4 | Large cartoon gorilla leaning far forward with chest low to the ground, right-facing; the arm that was raised has swung down, its open palm slapping flat against the ground beside the torso; the other arm remains stretched forward along the ground; legs splayed behind, fully grounded.
- `settle_low` | source index 6 | Large cartoon gorilla hunched in a compact low crouch, right-facing, both hands near the ground, head tucked down, weight settled forward between strikes; grounded, no arm raised.
- `windup_b` | source index 10 | Large cartoon gorilla rising slightly from the crouch, right-facing; the arm that was braced on the ground now lifts up and back overhead, the other arm/hand resting near the ground; torso beginning to shift the opposite way; grounded.
- `slap_b_impact` | source index 13 | Large cartoon gorilla leaning forward with chest low again, right-facing; the second arm's open palm slaps flat onto the ground beside the torso, the first arm now stretched forward along the ground; mirror of the first impact pose; grounded.
- `recovery_roar` | source index 18 | Large cartoon gorilla pushing upright out of the crouch, right-facing, mouth open in a roar; one arm raised high overhead, the other arm braced lower near the torso; legs bent, grounded, transitioning back to standing.
- `idle_loop_ready` | source index 20 | Large cartoon gorilla back in a compact crouch, right-facing, mouth open; one arm raised overhead ready to swing down again, the other hand/foot planted on the ground; pose mirrors the very first key, grounded and ready to repeat.

## Uncertainties
- The render uses a slightly angled 3D camera rather than a strict flat side profile, so DK's true left-hand/right-hand identity (as opposed to leading/trailing relative to his facing) cannot be confirmed with full certainty from the sprite alone.
- The four overlapping red circles per active window are almost certainly a GIF disposal-accumulation artifact (multiple undisposed hitbox draws compositing into one exported PNG) rather than four independently placed hitboxes; treat them as one "ground slap" region per window, not four.
- Because image_count (21) is far below UFD's total frame count (46), and the manifest explicitly marks gameplay_frame_mapping as unresolved, the exact game-frame each source index corresponds to is approximate, not exact.
