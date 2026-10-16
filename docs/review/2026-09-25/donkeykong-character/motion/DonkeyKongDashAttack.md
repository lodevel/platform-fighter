# DonkeyKongDashAttack — UFD "Dash Attack"

Source: https://ultimateframedata.com/hitboxes/donkey_kong/DonkeyKongDashAttack.gif | images: 34 | canvas: 993x422 | delays: uniform 130ms per frame (all 34 frames)
UFD row: startup 9, active 9—12/13—24 (Early/Late), total 34, endlag 10, hitbox notes whichhitbox "Early/Late", damage 12.0/9.0, notes "--"

## Overlay observations
| Index range | What is visible | Interpretation basis |
|---|---|---|
| 0–3 | Running/crouched start pose, pale hurtbox volumes over the whole body, both hands rising up near the head as if preparing to tuck | hurtbox display |
| 4–7 | Pale body volumes only; body curls tighter into a rounded ball shape (head tucks down, arms wrap in) while the visible silhouette shrinks and shifts rightward across the wide canvas, consistent with forward travel/camera pull-back rather than an actual size change | hurtbox display |
| 8–11 | A single red circle with a white radius line on the curled body, no other colour present | attack region |
| 12–23 | A single magenta/pink circle with a white radius line on the curled body — same size and position pattern as the red one, but a distinctly different, non-red colour | other layer (magenta, not an attack region) |
| 24–27 | Pale body volumes only, with a bright white glow/flash effect on the curled ball as it decelerates | hurtbox display (plus a bright highlight effect, not a hitbox) |
| 28–33 | Pale body volumes only; body uncurls back to a standing/crouched pose | hurtbox display |

## Mapping check
- image_count vs UFD total: 34 vs 34 → equal
- red-region image indices + 1 vs UFD active frames: [8,9,10,11]+1 = frames 9–12 vs active "Early" 9—12 → match; the "Late" window (active 13—24) is rendered in magenta/pink (indices 12–23), not red, so it is not counted under the task's red-only rule
- Verdict: **unverified** for the full move (only the Early hitbox window is confirmed by a strictly red region; the Late hitbox window sits at the correct indices [12–23]→frames 13–24 but is shown in a non-red colour, so it does not satisfy the strict red-circle check)

## Motion by phase (index ranges, right-facing)
- Anticipation/windup 0–3: DK starts from a low running crouch and both hands rise up near the head, as if winding up to tuck into a roll; no curling yet.
- Tuck-and-travel 4–7: the head drops and the arms wrap inward as the body curls into a tight rounded ball; the silhouette appears to shrink and slide rightward across the wide canvas, reading as DK tumbling forward across the stage while the camera tracks/zooms with him.
- Strike (early) 8–11: still curled into the rolling ball shape, a red hitbox sits on the leading edge of the body as it continues rolling forward — the whole curled torso/back is the striking surface, not a limb.
- Strike (late) 12–23: the roll continues for a long stretch with a magenta/pink circle in the same position, describing a sustained rolling hit; body shape stays a tight curled ball, still translating forward.
- Deceleration 24–27: the ball slows, marked by a bright white glow/flash effect (not a hitbox), body starting to unwind.
- Recovery 28–33: DK uncurls back out of the ball shape into a standing/crouched pose, arms and legs extending back out, coming to rest.

## Contact part(s)
Whole curled-up body (torso/back), rolling forward like a cannonball rather than striking with a single limb.

## Proposed drawings (pose keys)
- `run-windup` | source index 1 | Large cartoon gorilla in a low running crouch, right-facing, both hands rising up near the head as if about to tuck into a roll.
- `tuck-start` | source index 4 | Body beginning to curl, head dropping down and arms wrapping inward, torso starting to round into a ball shape, still recognizably crouched.
- `rolling-ball-early` | source index 9 | Body fully curled into a tight round ball shape, limbs tucked in tight, tumbling forward low to the ground.
- `rolling-ball-sustain` | source index 16 | Same tightly curled ball shape continuing to tumble forward, maintaining the compact rounded silhouette.
- `decelerate-flash` | source index 25 | Curled ball shape starting to slow and unwind slightly, with a bright glowing highlight on the body suggesting impact/deceleration.
- `uncurl-recover` | source index 30 | Body uncurling back out of the ball, arms and legs extending outward again, transitioning back toward a standing crouch.
- `rest-crouch` | source index 33 | Fully uncurled, settled into the resting crouch stance, ready to act again.

## Uncertainties
The apparent shrinking of DK's silhouette during the roll (indices 4–7 and again briefly later) is read as camera pull-back/pan following his forward travel across the wide 993px canvas, not an actual change in his size — this is the one move in the set with clear on-screen forward translation. The colour split between the Early hitbox (pure red, indices 8–11) and the Late hitbox (pure magenta/pink, indices 12–23) is unambiguous in the source images, but per the task's strict red-only attack-region rule, only the Early window is confirmed as an "attack region"; the Late window's true position is inferred from its matching index range and colour-swap pattern rather than from a red circle.
