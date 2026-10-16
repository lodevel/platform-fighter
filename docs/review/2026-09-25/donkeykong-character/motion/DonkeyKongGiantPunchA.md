# DonkeyKongGiantPunchA — UFD "Neutral B (Giant Punch)" (aerial, uncharged)

Source: https://ultimateframedata.com/hitboxes/donkey_kong/DonkeyKongGiantPunchA.gif | images: 62 | canvas: 729x461 | delays: uniform 130 ms across all 62 frames
UFD row: startup 19(+7), active 26—27 (19—20 after starting charge), total 62, endlag 35, landing lag --, hitbox notes --, damage 10.0—27.0, notes "Entering charge window takes 7 frames. 4 to cancel with shield. Arm intangibility on frame 4-20. Cannot rebound."

## Overlay observations
| Index range | What is visible | Interpretation basis |
|---|---|---|
| 0–3 | Pale hurtbox only; DK is drawn into a low crouch-like tuck, one fist pulling back close to the chest/hip | hurtbox display (windup) |
| 4–17 | Pale hurtbox plus a dark BLUE/navy oval glow over the cocked fist, held in an unchanging tuck for many frames | other layer (blue) — a charge-related glow, not itself an attack region |
| 18–19 | 2–3 merged RED circles on the punching fist/forearm | attack region |
| 20–31 | Pale hurtbox only; arm remains fully extended straight out from the punch, body pitched forward | hurtbox display (follow-through) |
| 32–61 | Pale hurtbox only; arm gradually retracts and the body relaxes back toward a compact neutral tuck; a small pink mark near the wrist is visible for much of this range | hurtbox display (recovery); pink wrist mark likely a costume highlight, not a hitbox |

## Mapping check
- image_count vs UFD total: 62 vs 62 → equal
- red-region image indices + 1 vs UFD active frames: [18,19]+1 = [19,20] vs "26—27 (19—20 after starting charge)" → matches the "started charging" timing exactly (19–20)
- Verdict: **verified 1:1** — same charge-release timing as the grounded uncharged capture

## Motion by phase (index ranges, right-facing)
- Anticipation/windup 0–17: DK is drawn into a low crouch-like tuck in the air and cocks one fist back against his chest/hip, holding this loaded stance through an extended charge window while a blue glow builds over the cocked fist.
- Strike 18–19: the fist explodes forward in a straight punch, red-flagged on the knuckles/forearm.
- Follow-through 20–31: the arm stays fully extended straight out in front from the punch, body pitched forward.
- Recovery 32–61: the arm bends back in and the body straightens out of the lean, settling back into a compact neutral aerial stance by the end.

## Contact part(s)
The punching fist/forearm (near arm, straight punch).

## Proposed drawings (pose keys)
- `airborne-cock` | source index 2 | A large cartoon gorilla airborne, drawn into a low crouch-like tuck with one fist pulled back tight against its chest, facing right.
- `charge-hold` | source index 10 | A large cartoon gorilla airborne, still tucked with the fist cocked back, a glowing aura building around the cocked hand, facing right.
- `punch-strike` | source index 18 | A large cartoon gorilla airborne, fist punching straight forward, arm fully extended, torso leaning into the punch, facing right.
- `punch-extend` | source index 25 | A large cartoon gorilla airborne, arm still extended straight out from the punch, body pitched forward, facing right.
- `retract-rise` | source index 42 | A large cartoon gorilla airborne, arm bending back in toward the chest, body straightening from the punch's lean, facing right.
- `neutral-tuck` | source index 58 | A large cartoon gorilla airborne, body relaxed back into a compact neutral aerial stance, fists near its chest, facing right.

## Uncertainties
The render shows no ground plane and no obvious falling motion, so the "aerial" nature of this variant cannot be visually confirmed from the pose sequence alone — it is essentially indistinguishable from the grounded DonkeyKongGiantPunchG capture at this crop. The only aerial/grounded differentiator available from the extracted data is that both hit the identical 19–20 charge-release timing here, which is not itself conclusive.
