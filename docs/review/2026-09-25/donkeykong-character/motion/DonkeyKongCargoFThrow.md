# DonkeyKongCargoFThrow — Cargo Forward Throw

Source: https://ultimateframedata.com/hitboxes/donkey_kong/DonkeyKongCargoFThrow.gif | images: 45 | canvas: 690x559 | delays: uniform 130ms per frame (5.85s total across 45 frames)
UFD row: startup 15, active not specified, total 45, endlag not specified, landing lag not specified, hitbox notes not specified, damage 12.0, notes --

## Overlay observations
| Index range | What is visible | Interpretation basis |
|---|---|---|
| 0–3 | Crouched all-fours (knuckle-walking) stance, body arching/rearing upward out of a tucked crouch. Hurtbox blob over torso, no red hitbox. | Windup — DK coiling before moving forward. |
| 4–12 | DK advances hunched forward on bent arms and legs, torso pitched low, head leading. No second character silhouette is distinguishable from DK's own body. | Carry phase: DK hauling the (unseen) captive forward a step or two before the throw. |
| 13–15 | DK arches backward, head tips up, one arm sweeps from low up to a fully raised, fingers-splayed position by 14–15, reaching up-and-forward. A small maroon patch is visible right at his open mouth. | Throw/release swing. The maroon patch here reads as his own open-mouth interior (roar face), not a separate figure — it moves together with his jaw. |
| 16–31 | DK curls into a tight tucked ball and rolls forward continuously; silhouette resembles a numeral "2". A small maroon/burgundy patch is visible peeking from under his folded arm near his torso, distinct from his face which is separately visible nearby. | Momentum roll after the throw. The under-arm patch is plausibly a glimpse of the carried opponent tucked against his body, though the model itself is never clearly rendered — see Uncertainties. |
| 32–44 | DK unrolls, arms and legs extending back out, returning through a crouched all-fours stance nearly identical to index 0. | Recovery back to neutral/ready crouch, loop point. |

## Mapping check
- image_count vs UFD total: 45 vs 45 → equal.
- red-region image indices + 1 vs UFD active frames: no red hitbox circle is drawn anywhere in this move's frames (unlike Pummel), and activeframes is "not specified." Comparing instead to startup=15: the big overhead-forward arm-release pose sits at source index 14, and index+1 = 15, an exact match.
- Verdict: **partially verified** — frame count matches 1:1 with the UFD total and the release-swing pose lines up exactly with startup, but no hitbox marker is drawn on this move, so the true active window cannot be confirmed beyond that single anchor.

## Motion by phase (index ranges, right-facing)
- Anticipation/windup 0–3: crouched low on all fours/knuckles, back rounded, weight gathering before advancing.
- Carry 4–12: hunched forward crawl on bent arms and legs, torso pitched low and forward, held opponent implicitly braced against DK's body as he advances.
- Throw/release 13–16: DK arches upright, head thrown back, far arm swings from low to fully raised overhead-forward with fingers spread — the victim is launched forward and slightly upward along this arc; DK's own momentum then carries him into a forward tuck.
- Recovery/roll 16–31: DK curls into a tight ball and somersaults forward along the ground, unwinding gradually.
- Return 32–44: arms and legs unfold, DK settles back into the crouched all-fours ready stance.

## Contact part(s)
Both arms/hands releasing the carried opponent during the big overhead-forward swing (source index ~13–15); no drawn hit indicator is present on this move.

## Proposed drawings (pose keys)
- `cargofthrow_windup` | source index 0 | crouched cartoon gorilla low on all fours/knuckles, back rounded, head tucked down between the shoulders, legs bent under the body, facing right, coiled to lunge forward.
- `cargofthrow_carry` | source index 7 | hunched forward crawl on bent arms and legs, torso pitched low and forward, head low and forward-facing, weight shifting onto the leading knuckles, facing right, as if hauling something braced against the chest.
- `cargofthrow_liftback` | source index 13 | rearing upward out of the crouch, head tipped back, one arm drawn up high past the shoulder with fingers open, torso twisting to lead the swing, legs still bent and grounded, facing right.
- `cargofthrow_release` | source index 14 | body arched fully upright, both arms swept overhead-forward at full extension with fingers splayed wide, mouth open in a roar, weight rocked onto the back leg as if something has just been flung off the raised arm, facing right.
- `cargofthrow_tuck` | source index 20 | body curled into a tight ball, knees drawn to the chest, head tucked down near the knees, one arm wrapped around the shins, rolling forward along the ground, facing right.
- `cargofthrow_unroll` | source index 35 | body unfurling from the tucked roll, one arm and leg extending back out while the torso is still low and rounded, head lifting to look forward, facing right.
- `cargofthrow_settle` | source index 44 | crouched on all fours again, weight balanced evenly over bent arms and legs, head level and facing forward, back rounded in a calm ready stance, facing right.

## Uncertainties
The carried opponent is never distinctly rendered as a separate character model in any of the 45 frames. A small maroon patch visible under DK's arm during the roll (index ~16–31) may be a glimpse of the tucked victim, but it cannot be fully distinguished from DK's own anatomy given the tight curl and the semi-transparent hurtbox overlay. The exact instant of "release" is inferred from the arm-sweep pose (index 14–15) matching startup=15, not from a visible victim leaving the frame. Because no red hitbox marker is drawn on this move, activeframes remain unverified beyond that inference.
