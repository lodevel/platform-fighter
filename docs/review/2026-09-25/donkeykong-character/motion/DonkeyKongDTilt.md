# DonkeyKongDTilt — UFD "Down Tilt"

Source: https://ultimateframedata.com/hitboxes/donkey_kong/DonkeyKongDTilt.gif | images: 24 | canvas: 637x416 | delays: uniform 130ms per frame (all 24 frames)
UFD row: startup 6, active 6—7, total 24, endlag 17, hitbox notes whichhitbox "--" (single hitbox), damage 6.0, notes "Arm intangibility on frame 5-7"

## Overlay observations
| Index range | What is visible | Interpretation basis |
|---|---|---|
| 0–3 | Low, flat crouch, pale hurtbox volumes over the whole body, both hands open and reaching forward along the ground, fingers spread | hurtbox display |
| 4 | Pale body volumes plus a solid dark-blue circle at the near hand as it curls into a fist | other layer (blue, not an attack region) |
| 5–6 | Two overlapping red circles with white radius lines at the fully extended fist, low near ground height, fingers/claws splayed open at the reach | attack region |
| 7–23 | Pale body volumes only; the arm stays extended forward with the hand slowly relaxing and opening, then gradually retracts back toward the body over the rest of the clip | hurtbox display |

## Mapping check
- image_count vs UFD total: 24 vs 24 → equal
- red-region image indices + 1 vs UFD active frames: [5,6]+1 = frames 6,7 vs active 6—7 → match
- Verdict: **verified 1:1**

## Motion by phase (index ranges, right-facing)
- Anticipation/windup 0–3: DK flattens out low to the ground with both arms extended forward, fingers open and spread, in a low poking/reaching stance; no forward travel.
- Coil 4: the near hand curls into a loose fist (briefly marked by the unrelated blue overlay circle) as the arm draws back slightly to load the poke.
- Strike 5–6: the fist punches forward at very low, near-ground height, arm reaching to full extension with fingers splaying open at the moment of contact; torso stays flat and low, no body translation.
- Recovery 7–23: the arm remains extended forward for a while with the hand relaxing open, then slowly retracts back toward the body over the remaining frames, settling back toward the low flat stance.

## Contact part(s)
Near-hand fist/claw, punched forward low along the ground.

## Proposed drawings (pose keys)
- `low-reach-open` | source index 1 | Large cartoon gorilla flattened low to the ground, right-facing, both arms extended forward with open hands and spread fingers, body hugging the floor.
- `fist-coil` | source index 4 | Same low stance, near hand curling into a loose fist, arm drawing back slightly to load the strike.
- `low-poke-strike` | source index 6 | Arm punched forward to full extension at near-ground height, fist/claws splayed open at the moment of contact, torso flat and low, back leg braced.
- `hold-extended` | source index 10 | Arm still extended forward at low height, fingers relaxing open, torso beginning to ease back.
- `retract-settle` | source index 20 | Arm partway back toward the body, hand curling closed again, torso settling back into the low flat resting stance.

## Uncertainties
None of the frames are ambiguous; the whole clip stays low to the ground in a single flat crouching silhouette. The blue circle at index 4 does not match the red "attack region" convention and is described but not treated as damage.
