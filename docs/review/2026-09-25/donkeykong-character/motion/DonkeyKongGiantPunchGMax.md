# DonkeyKongGiantPunchGMax — UFD "Giant Punch, Full Charge" (grounded)

Source: https://ultimateframedata.com/hitboxes/donkey_kong/DonkeyKongGiantPunchGMax.gif | images: 47 | canvas: 1256x727 | delays: uniform 130 ms across all 47 frames
UFD row: startup 19, active 19—20, total 47, endlag 27, landing lag --, hitbox notes --, damage Grounded: 28.0%/18.0% | Aerial: 25.0, notes "Ground version has Super Armor frames 9-20. Air version has Super Armor frames 15-20. Takes 111 frames to reach full charge. Cannot rebound."

## Overlay observations
| Index range | What is visible | Interpretation basis |
|---|---|---|
| 0–7 | Pale hurtbox only; DK crouches low with one fist cocked back against the chest | hurtbox display (windup) |
| 8–17 | Whole body tinted dark purple/near-black, same crouched cocked-fist pose held | other layer (dark tint) — correlates closely with the noted "Super Armor frames 9-20" window, but is not itself a red attack region |
| 18–19 | 2–3 merged RED circles on the punching fist, plus one smaller MAGENTA circle near the shoulder/trailing arm | attack region (red) plus a second, smaller colour region near the trailing arm |
| 20–31 | Pale hurtbox only; arm fully extended straight out from the punch, torso in a low lunge; a small pink mark near the ankle persists | hurtbox display (follow-through); ankle mark likely a costume highlight |
| 32–46 | Pale hurtbox only; arm retracts and DK rises back toward a standing pose | hurtbox display (recovery) |

## Mapping check
- image_count vs UFD total: 47 vs 47 → equal
- red-region image indices + 1 vs UFD active frames: [18,19]+1 = [19,20] vs "19—20" → match
- Verdict: **verified 1:1** — the dark-tint window at 8–17 also lines up almost exactly with the noted ground super-armor frames 9-20

## Motion by phase (index ranges, right-facing)
- Anticipation/windup 0–7: DK crouches low, fist cocked back at the chest, normal colouring.
- Charge/armor 8–17: the whole body takes on a dark tint while holding the same crouched, cocked-fist pose — visually flagging the super-armor state as the charge completes.
- Strike 18–19: the fist punches straight out, red-flagged on the knuckles, with a smaller magenta region near the trailing shoulder/arm.
- Follow-through 20–31: the arm remains fully extended from the punch, torso low in the lunge.
- Recovery 32–46: the arm retracts and DK rises back up toward a standing stance by the end.

## Contact part(s)
The punching fist/forearm (near arm, straight punch) — same delivery as the uncharged version, with a possible secondary region near the trailing arm.

## Proposed drawings (pose keys)
- `crouch-cock` | source index 3 | A large cartoon gorilla standing, crouched low with one fist cocked back against its chest, facing right.
- `armor-glow` | source index 12 | A large cartoon gorilla standing, crouched in the same cocked-fist pose but rendered with heavier, darker shading suggesting a charged-up state, facing right.
- `punch-strike` | source index 18 | A large cartoon gorilla standing, fist punching straight forward, arm fully extended, torso leaning hard into the punch, facing right.
- `punch-extend` | source index 26 | A large cartoon gorilla standing, arm still fully extended from the punch, torso low in a forward lunge, facing right.
- `retract-rise` | source index 38 | A large cartoon gorilla standing, arm bending back toward the chest, torso rising out of the lunge, facing right.
- `neutral-stand` | source index 45 | A large cartoon gorilla standing upright in a relaxed ready stance, facing right.

## Uncertainties
Cannot tell from the render alone whether the dark body tint is meant to depict a "fully charged" glow versus the super-armor state specifically — both are simultaneously active in this window per the notes, so the visual cue may represent either or both.
