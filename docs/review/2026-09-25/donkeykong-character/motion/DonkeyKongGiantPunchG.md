# DonkeyKongGiantPunchG — UFD "Neutral B (Giant Punch)" (grounded, uncharged)

Source: https://ultimateframedata.com/hitboxes/donkey_kong/DonkeyKongGiantPunchG.gif | images: 62 | canvas: 729x461 | delays: uniform 130 ms across all 62 frames
UFD row: startup 19(+7), active 26—27 (19—20 after starting charge), total 62, endlag 35, landing lag --, hitbox notes --, damage 10.0—27.0, notes "Entering charge window takes 7 frames. 4 to cancel with shield. Arm intangibility on frame 4-20. Cannot rebound."

## Overlay observations
| Index range | What is visible | Interpretation basis |
|---|---|---|
| 0–3 | Pale hurtbox only; DK crouches low, pulling one fist back close to the chest/hip | hurtbox display (windup) |
| 4–17 | Pale hurtbox plus a dark BLUE/navy oval glow over the cocked fist, held in an unchanging crouch for many frames | other layer (blue) — a charge-related glow, not itself an attack region |
| 18–19 | 2–3 merged RED circles on the punching fist/forearm | attack region |
| 20–31 | Pale hurtbox only; arm remains fully extended straight out from the punch, torso in a low lunge | hurtbox display (follow-through) |
| 32–61 | Pale hurtbox only; arm gradually retracts and DK rises out of the lunge back to a standing ready stance; a small pink mark near the wrist is visible for much of this range | hurtbox display (recovery); pink wrist mark likely a costume highlight, not a hitbox |

## Mapping check
- image_count vs UFD total: 62 vs 62 → equal
- red-region image indices + 1 vs UFD active frames: [18,19]+1 = [19,20] vs "26—27 (19—20 after starting charge)" → matches the "started charging" timing exactly (19–20)
- Verdict: **verified 1:1** — this capture shows the charge-then-release timing variant of the move (frames 19–20), not the bare-tap timing (26–27)

## Motion by phase (index ranges, right-facing)
- Anticipation/windup 0–17: DK drops into a low crouch and cocks one fist back against his chest/hip, holding this loaded stance through an extended charge window while a blue glow builds over the cocked fist.
- Strike 18–19: the fist explodes forward in a straight punch, red-flagged on the knuckles/forearm as it connects.
- Follow-through 20–31: the arm stays fully extended straight out in front from the punch, torso committed low in the lunge.
- Recovery 32–61: the arm bends back in and DK slowly straightens up out of the lunge, returning to a normal standing stance by the end.

## Contact part(s)
The punching fist/forearm (near arm, straight punch).

## Proposed drawings (pose keys)
- `crouch-cock` | source index 2 | A large cartoon gorilla standing, crouched low with one fist pulled back tight against its chest, the other arm out for balance, facing right.
- `charge-hold` | source index 10 | A large cartoon gorilla standing, still crouched with the fist cocked back, a glowing aura building around the cocked hand, facing right.
- `punch-strike` | source index 18 | A large cartoon gorilla standing, fist punching straight forward at shoulder height, arm fully extended, torso leaning into the punch, facing right.
- `punch-extend` | source index 25 | A large cartoon gorilla standing, arm still extended straight out from the punch, torso low in a forward lunge, facing right.
- `retract-rise` | source index 40 | A large cartoon gorilla standing, arm bending back in toward the chest, torso beginning to rise out of the lunge, facing right.
- `neutral-stand` | source index 58 | A large cartoon gorilla standing upright in a relaxed ready stance, fists near its chest, facing right.

## Uncertainties
Whether this gif represents the bare tap (uncharged, 26–27) or the charge-then-release timing is ambiguous from pose alone; the frame-accurate red-index match to "19-20 after starting charge" (rather than "26-27") suggests it was captured mid-charge-release rather than a bare tap, despite the "G" (grounded uncharged) label.
