# DonkeyKongHeadbuttA — UFD "Side B (Headbutt)" (aerial)

Source: https://ultimateframedata.com/hitboxes/donkey_kong/DonkeyKongHeadbuttA.gif | images: 62 | canvas: 1044x698 | delays: uniform 130 ms across all 62 frames
UFD row: startup 20, active 20—21, total 62, endlag 41, landing lag --, hitbox notes --, damage 10.0, notes "Super armor on frame 5-14 on the ground and in the air."

## Overlay observations
| Index range | What is visible | Interpretation basis |
|---|---|---|
| 0–3 | Pale hurtbox only; DK airborne, tucked with arms in front and legs bent | hurtbox display (windup) |
| 4–13 | Whole body tinted dark purple/near-black; DK compact and airborne, legs tucked | other layer (dark tint) — correlates with the noted air super-armor window (frames 5-14) |
| 14–18 | Pale hurtbox only; leading arm rises and cocks, body extends out of the tuck, head lowers | hurtbox display (final windup) |
| 19–20 | Overlapping RED and MAGENTA circles centered on the head/face | attack region (headbutt contact) |
| 21–39 | Pale hurtbox only; body stretched out roughly horizontal, head/arm thrust forward, legs trailing behind in the air | hurtbox display (contact follow-through / tumble) |
| 40–61 | Pale hurtbox only; limbs splay further, one hand opens and rises, body curls into a falling/helpless-looking silhouette | hurtbox display (recovery, airborne tumble) |

## Mapping check
- image_count vs UFD total: 62 vs 62 → equal
- red-region image indices + 1 vs UFD active frames: [19,20]+1 = [20,21] vs "20—21" → match
- Verdict: **verified 1:1** — the dark-tint window at 4–13 matches the noted super-armor frames 5-14 exactly

## Motion by phase (index ranges, right-facing)
- Anticipation/windup 0–3: DK airborne, tucked with arms drawn in front and legs bent, beginning the move.
- Armored charge 4–13: body stays compact and airborne while dark-tinted to flag super armor, legs tucked beneath.
- Final windup 14–18: the leading arm rises and cocks back, body extends out of the tuck, head lowers, coiling for the headbutt.
- Strike 19–20: the head thrusts forward into the overlapping red/magenta region, arm swinging alongside, body extending horizontally in the air.
- Recovery 21–61: the body stays stretched out roughly horizontal with the head/arm still forward (21–39), then limbs splay further and one hand opens and rises as DK tumbles into a falling, helpless-looking silhouette (40–61).

## Contact part(s)
The head — an airborne headbutt/dive, with the leading arm swinging alongside.

## Proposed drawings (pose keys)
- `airborne-tuck` | source index 1 | A large cartoon gorilla airborne, tucked with arms drawn in front and legs bent beneath it, facing right.
- `armor-charge` | source index 8 | A large cartoon gorilla airborne, compact and tucked, rendered with heavier, darker shading to suggest a braced charge, facing right.
- `cock-back` | source index 16 | A large cartoon gorilla airborne, leading arm raised and cocked back, body extending out of its tuck with the head lowering, facing right.
- `headbutt-strike` | source index 19 | A large cartoon gorilla airborne, head thrust forward leading the attack, arm swinging forward alongside it, body stretching horizontally, facing right.
- `dive-hold` | source index 30 | A large cartoon gorilla airborne, body stretched roughly horizontal with the head and arm still thrust forward, legs trailing behind, facing right.
- `tumble-splay` | source index 45 | A large cartoon gorilla airborne, limbs splaying outward, one hand opening and rising, body beginning to tumble, facing right.
- `helpless-fall` | source index 58 | A large cartoon gorilla airborne, one hand fully open and raised, body curling into a loose falling silhouette, facing right.

## Uncertainties
None major. Unlike the two Giant Punch variants, the aerial/grounded distinction here IS visually confirmed — the body stretches into a horizontal tumble with splaying limbs (this file) rather than the grounded version's all-fours crawl-and-stand recovery.
