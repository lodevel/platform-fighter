# DonkeyKongGiantPunchAMax — UFD "Giant Punch, Full Charge" (aerial)

Source: https://ultimateframedata.com/hitboxes/donkey_kong/DonkeyKongGiantPunchAMax.gif | images: 47 | canvas: 1256x727 | delays: uniform 130 ms across all 47 frames
UFD row: startup 19, active 19—20, total 47, endlag 27, landing lag --, hitbox notes --, damage Grounded: 28.0%/18.0% | Aerial: 25.0, notes "Ground version has Super Armor frames 9-20. Air version has Super Armor frames 15-20. Takes 111 frames to reach full charge. Cannot rebound."

## Overlay observations
| Index range | What is visible | Interpretation basis |
|---|---|---|
| 0–13 | Pale hurtbox only; DK crouches in a tuck with one fist cocked back against the chest | hurtbox display (windup) |
| 14–17 | Whole body tinted dark purple/near-black, same cocked-fist tuck held | other layer (dark tint) — correlates closely with the noted air super-armor window (frames 15-20) |
| 18–19 | 2–3 merged RED circles on the punching fist | attack region |
| 20–31 | Pale hurtbox only; arm fully extended from the punch, body pitched forward; a small pink mark near the hip persists | hurtbox display (follow-through) |
| 32–46 | Pale hurtbox only; arm retracts, body relaxes back toward a neutral aerial tuck | hurtbox display (recovery) |

## Mapping check
- image_count vs UFD total: 47 vs 47 → equal
- red-region image indices + 1 vs UFD active frames: [18,19]+1 = [19,20] vs "19—20" → match
- Verdict: **verified 1:1** — the dark-tint window at 14–17 lines up closely with the noted air super-armor frames 15-20

## Motion by phase (index ranges, right-facing)
- Anticipation/windup 0–13: DK holds a low crouch-like tuck with the fist cocked back against the chest, normal colouring for longer than the grounded full-charge capture before the armor tint appears.
- Charge/armor 14–17: the whole body takes on a dark tint while holding the same tuck, flagging the super-armor state as the charge completes.
- Strike 18–19: the fist punches straight out, red-flagged on the knuckles.
- Follow-through 20–31: the arm remains fully extended from the punch, body pitched forward.
- Recovery 32–46: the arm retracts and the body relaxes back toward a compact neutral aerial stance.

## Contact part(s)
The punching fist/forearm (near arm, straight punch).

## Proposed drawings (pose keys)
- `crouch-cock` | source index 3 | A large cartoon gorilla airborne, tucked into a low crouch-like pose with one fist cocked back against its chest, facing right.
- `armor-glow` | source index 15 | A large cartoon gorilla airborne, same cocked-fist pose rendered with heavier, darker shading suggesting a fully charged state, facing right.
- `punch-strike` | source index 18 | A large cartoon gorilla airborne, fist punching straight forward, arm fully extended, torso leaning hard into the punch, facing right.
- `punch-extend` | source index 26 | A large cartoon gorilla airborne, arm still fully extended from the punch, body pitched forward, facing right.
- `retract-rise` | source index 38 | A large cartoon gorilla airborne, arm bending back toward the chest, body straightening out, facing right.
- `neutral-tuck` | source index 45 | A large cartoon gorilla airborne, body relaxed into a compact neutral aerial stance, facing right.

## Uncertainties
As with DonkeyKongGiantPunchA, no ground plane or falling motion is visible to confirm this is the aerial variant beyond the frame-accurate match to the Full Charge row and the slightly later dark-tint onset (starting ~14) consistent with the noted "Air version...frames 15-20" versus the grounded "frames 9-20" (tint starts ~8 there).
