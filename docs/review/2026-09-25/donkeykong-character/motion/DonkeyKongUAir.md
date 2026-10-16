# DonkeyKongUAir — UFD "Up Air"

Source: https://ultimateframedata.com/hitboxes/donkey_kong/DonkeyKongUAir.gif | images: 37 | canvas: 648x588 | delays: uniform 130 ms across all 37 frames
UFD row: startup 6, active 6—10, total 37, endlag 27, landing lag 15, hitbox notes --, damage 13.0, notes "Head intangibility on frame 5-10. Autocancels on frame 1-5 and 26 onward"

## Overlay observations
| Index range | What is visible | Interpretation basis |
|---|---|---|
| 0–3 | Pale hurtbox only; DK curled tightly in a ball, limbs tucked in | hurtbox display (windup) |
| 4 | Pale hurtbox plus a small BLUE dot near the upper-left of the body | other layer (blue) — not interpreted as an attack region |
| 5–9 | One RED circle directly above DK's head, connected to a thin white stem/line | attack region |
| 10–36 | Pale hurtbox only; body continues rotating through a full flip/somersault, gradually settling | hurtbox display (recovery) |

## Mapping check
- image_count vs UFD total: 37 vs 37 → equal
- red-region image indices + 1 vs UFD active frames: [5,6,7,8,9]+1 = [6,7,8,9,10] vs "6—10" → match
- Verdict: **verified 1:1**

## Motion by phase (index ranges, right-facing)
- Anticipation/windup 0–4: DK curls into a tight ball in midair, limbs drawn close, beginning to rotate.
- Strike 5–9: the body arcs upward, head/upper back leading into the red-flagged region directly above him, torso continuing to rotate through the swing.
- Recovery 10–36: DK's body continues a full rotating flip through the air, gradually slowing and unfurling, settling into a normal falling posture by the end.

## Contact part(s)
The top of the head/upper back, swung upward through a flip (consistent with the "head intangibility" note — his own head passes through the region his attack creates).

## Proposed drawings (pose keys)
- `tuck-start` | source index 1 | A large cartoon gorilla airborne, curled into a tight ball with knees drawn to the chest and arms wrapped in close, facing right.
- `pre-flip` | source index 4 | A large cartoon gorilla airborne, still curled tightly, torso beginning to tilt as the flip starts, facing right.
- `strike-rise` | source index 5 | A large cartoon gorilla airborne, torso arcing upward with the head/upper back leading the motion, body beginning to invert, facing right.
- `strike-peak` | source index 9 | A large cartoon gorilla airborne, body further into the upward arc, rotated past vertical with legs trailing above, facing right.
- `flip-mid` | source index 18 | A large cartoon gorilla airborne mid-somersault, body inverted, limbs tucked close as it rotates through the flip, facing right.
- `flip-late` | source index 28 | A large cartoon gorilla airborne continuing to rotate out of the flip, body unfurling slightly, facing right.
- `neutral-settle` | source index 34 | A large cartoon gorilla airborne, body settled back into a compact falling stance after the flip, facing right.

## Uncertainties
The small blue dot at index 4 doesn't match the task's colour key (blue is listed as an "other layer" not to be read as damage); it is most likely a stray marker/anchor point rather than a hitbox, but this is not confirmed.
