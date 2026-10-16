# DonkeyKongHeadbuttG — UFD "Side B (Headbutt)" (grounded)

Source: https://ultimateframedata.com/hitboxes/donkey_kong/DonkeyKongHeadbuttG.gif | images: 62 | canvas: 1178x611 | delays: uniform 130 ms across all 62 frames
UFD row: startup 20, active 20—21, total 62, endlag 41, landing lag --, hitbox notes --, damage 10.0, notes "Super armor on frame 5-14 on the ground and in the air."

## Overlay observations
| Index range | What is visible | Interpretation basis |
|---|---|---|
| 0–3 | Pale hurtbox only; DK crouches and leans forward, arms reaching, beginning a forward lunge | hurtbox display (windup) |
| 4–13 | Whole body tinted dark purple/near-black; DK lunges low on all fours, head down, one arm leading | other layer (dark tint) — correlates exactly with the noted super-armor window (frames 5-14) |
| 14–18 | Pale hurtbox only; leading arm rises and cocks back, head lowers further, torso leans forward | hurtbox display (final windup) |
| 19–20 | Overlapping RED and MAGENTA circles centered on the head/face | attack region (headbutt contact) |
| 21–31 | Pale hurtbox only; head/arm remain thrust forward in the contact pose | hurtbox display (immediate follow-through) |
| 32–47 | Pale hurtbox only; DK holds a long, frozen head-down all-fours crouch (a tiny dark dot near one foot around index 50 is a stray marker) | hurtbox display (long recovery hold) |
| 48–61 | Pale hurtbox only; DK gradually straightens from the head-down crouch back to standing | hurtbox display (recovery/stand) |

## Mapping check
- image_count vs UFD total: 62 vs 62 → equal
- red-region image indices + 1 vs UFD active frames: [19,20]+1 = [20,21] vs "20—21" → match
- Verdict: **verified 1:1** — the dark-tint window at 4–13 also matches the noted super-armor frames 5-14 exactly

## Motion by phase (index ranges, right-facing)
- Anticipation/windup 0–3: DK crouches and leans forward, arms reaching out, beginning to close distance.
- Armored charge 4–13: DK drives forward low on all fours, head down, one arm leading, entire body dark-tinted to flag super armor.
- Final windup 14–18: the leading arm rises and cocks back over the head while the head/torso lower further, coiling for the headbutt.
- Strike 19–20: the head thrusts forward and down into the overlapping red/magenta region, arm swinging forward alongside.
- Recovery 21–61: DK's head and arm stay thrust forward in the contact pose for a long stretch (21–47, reflecting the move's heavy 41-frame endlag), then gradually straightens back up to a standing stance by 61.

## Contact part(s)
The head — a running headbutt, with the leading arm swinging alongside.

## Proposed drawings (pose keys)
- `lunge-start` | source index 1 | A large cartoon gorilla standing, crouched and leaning forward with arms reaching out, beginning to charge forward, facing right.
- `armor-charge` | source index 8 | A large cartoon gorilla standing, driving forward low on all fours with its head down and one arm leading, rendered with heavier, darker shading to suggest a braced charge, facing right.
- `cock-back` | source index 16 | A large cartoon gorilla standing, leading arm raised and cocked back over its lowered head, torso leaning forward, coiling for a headbutt, facing right.
- `headbutt-strike` | source index 19 | A large cartoon gorilla standing, head thrust forward and down leading the attack, arm swinging forward alongside it, torso low and driving forward, facing right.
- `contact-hold` | source index 30 | A large cartoon gorilla standing, head and arm still thrust forward in the follow-through of the headbutt, body low on all fours, facing right.
- `recover-hold` | source index 42 | A large cartoon gorilla standing, frozen in a low, head-down, all-fours crouch during a long recovery, facing right.
- `rise-stand` | source index 55 | A large cartoon gorilla standing, straightening up from the head-down crouch, arms pulling upward, head lifting, facing right.

## Uncertainties
At index ~50 a tiny dark dot appears near one foot; it does not match any of the described colour categories and is most likely a stray rendering artifact or fixed marker, not a hitbox.
