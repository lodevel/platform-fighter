# DonkeyKongPummel — Pummel

Source: https://ultimateframedata.com/hitboxes/donkey_kong/DonkeyKongPummel.gif | images: 7 | canvas: 641x425 | delays: uniform 130ms per frame (0.91s total across 7 frames)
UFD row: startup 2, active not specified, total 21, endlag not specified, landing lag not specified, hitbox notes not specified, damage 1.6, notes "Total frames includes 15 frames of hitlag"

## Overlay observations
| Index range | What is visible | Interpretation basis |
|---|---|---|
| 0 | Hunched crouch; right hand raised beside his own temple, left hand held low near his chin/mouth. Pale purple-white hurtbox blob draped over torso, no red hitbox. | Anticipation pose before the strike; no attack marker present yet. |
| 1 | Right arm thrust forward/out to roughly head height; a RED circle-with-cross hitbox is centered directly on the hand. | The pummel's strike/contact frame — the only frame in the set with a drawn hitbox. |
| 2–3 | Hand continues forward and slightly down, fingers open, no hitbox visible; extension reaches its furthest reach by index 3. | Strike follow-through past the hit frame. |
| 4–5 | Hand retracts back toward the chin/mouth, fingers curling inward; other hand stays raised near the head. | Recovery/retraction of the striking arm. |
| 6 | Silhouette closely mirrors index 0 (hunched crouch, one hand up near head, one near chin), ready to loop. | Loop point back into index 0 for the repeated mash-attack cycle. |

No grab-hold sphere, second dummy fighter, or other overlay colour (blue/yellow/green) is visible in any of the 7 frames — only the hurtbox blob and the single red hitbox at index 1.

## Mapping check
- image_count vs UFD total: 7 vs 21 → differs by 14. The note explains this: total frames "includes 15 frames of hitlag" (freeze-frames on hit), which are not separately drawn/sampled in this GIF capture; 21 − 15 = 6 non-hitlag frames, close to the 7 images actually present.
- red-region image indices + 1 vs UFD active frames: activeframes is "not specified" for this move. Comparing instead to startup=2: the red hitbox appears at source index 1, and index+1 = 2, which matches startup exactly.
- Verdict: **partially verified** — the single visible hit frame lines up exactly with the given startup value, but activeframes/endlag/landinglag are all unspecified, so timing beyond that one anchor point cannot be confirmed.

## Motion by phase (index ranges, right-facing)
- Anticipation/windup 0: hunched crouch, striking hand raised beside his own head, other hand held low near the chin.
- Strike/hold 1–3: forward jab/slap into the held captive — hand thrust out with the hitbox appearing at 1, continuing to full extension by 3.
- Recovery 4–6: hand retracts to the chin/mouth, torso settles back into the crouched holding pose, looping back to the start pose.

## Contact part(s)
Free hand (open palm/loose fist) jabbing forward into the grabbed opponent, held roughly at DK's own chest-to-head height while his other arm implicitly keeps the victim pinned (the captive itself is not rendered in this capture).

## Proposed drawings (pose keys)
- `pummel_windup` | source index 0 | crouched cartoon gorilla, weight low over bent legs, one huge hand raised beside his own temple, other hand held low in front of his chin, head tucked down between hunched shoulders, grounded stance, facing right.
- `pummel_strike` | source index 1 | same low crouch, right arm thrust forward at roughly chin height with the hand a loose fist/open-slap shape striking toward an unseen captive held at chest level, torso leaning into the punch, facing right.
- `pummel_extend` | source index 3 | crouch continues, striking arm at full forward extension with fingers splayed open, torso leaning further forward following the strike through, facing right.
- `pummel_retract` | source index 5 | striking arm pulled back close to the chin with fingers curling inward, other hand raised beside the head, torso settling back into the hunched crouch, facing right.

## Uncertainties
No second/captive fighter model is visible in any of the 7 frames — the grabbed opponent is presumably held in front of or below DK during a real pummel but is not rendered by this UFD hitbox capture (the same absence is seen in all three cargo throws below). Because totalframes (21) includes 15 hitlag frames that are not depicted here, the mapping between GIF index and true in-game frame number beyond the single confirmed hit frame (index 1 → startup 2) is unresolved.
