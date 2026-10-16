# DonkeyKongGrab — Grab

Source: https://ultimateframedata.com/hitboxes/donkey_kong/DonkeyKongGrab.gif | images: 38 | canvas: 605x476 | delays: uniform 130ms per frame (4.94s total across 38 frames)
UFD row: startup 8, active 8—10, total 38, endlag 28, landing lag --, hitbox notes not specified, damage --, notes --

## Overlay observations
| Index range | What is visible | Interpretation basis |
|---|---|---|
| 0–6 | Hurtbox blob only (pale translucent purple-white spheres over the whole body). DK sinks into a low compact crouch; one arm (rear) sweeps up near the head/mouth while the other stays low and bent. No colour overlay. | Windup body language before any coloured region appears. |
| 7–9 | Hurtbox blob + a solid capsule/pill-shaped region in a deep magenta-purple (darker/richer than the pale hurtbox tone), gradient from lighter pink-magenta near the body to darker purple at the far tip, with an open hand and spread pink-toned fingers visible poking through the far end. Sits at roughly chest height, projecting to the right (forward) of his torso. Rear hand is a tucked fist near the chin. | This is the GRAB region per the legend — colour is precisely a magenta/dark-pink capsule, distinct from the pale purple hurtbox and from a red attack hitbox (no red circles appear anywhere in this move). |
| 10–15 | Hurtbox blob only. Capsule is gone. Both hands are now clenched fists held close to the chest/chin; torso still low/crouched. | Whiffed-grab "clutch" pose — the classic empty-handed recovery after a grab that connects on nothing. |
| 16–31 | Hurtbox blob only. Same fists-near-chest pose held with only minor idle sway; body gradually rises from the low crouch toward a more upright stance across the range. | Long static hold consistent with grab's 28-frame endlag. |
| 32–37 | Hurtbox blob only. One arm extends forward again with an open hand (no colour overlay this time — not an active hitbox), other arm bent at the torso; DK settles into a compact standing-crouch ready pose. | Tail motion returning to the neutral/loop-start silhouette; visually similar reach to 7–9 but never re-acquires the magenta colour, so it is not a second hitbox window. |

## Mapping check
- image_count vs UFD total: 38 vs 38 → equal
- grab-region (magenta capsule, not red) image indices + 1 vs UFD active frames: [7, 8, 9] + 1 = [8, 9, 10] vs UFD active "8—10" → match
- Verdict: **verified 1:1** — startup(8)+active(3, indices 7-9)+endlag(28) accounts for all 38 frames, and the magenta capsule's index range converts exactly to the UFD active-frame numbers.

## Motion by phase (index ranges, right-facing)
- Anticipation/windup 0–6: DK drops into a low, wide four-point crouch, torso bowing forward; his rear hand sweeps up near his head/mouth as if bracing while the other stays low, weight settling onto bent legs.
- Strike/hold 7–9: the forward (right-side) arm shoots out to the right, ending in the magenta grab capsule with an open, spread-fingered hand at its tip; the rear hand stays as a tucked fist near the chin.
- Recovery 10–37: hands withdraw into fists drawn to the chest/chin (grab whiffed), holding this clutch pose through a long idle stretch (10–31), body slowly straightening; then one arm reaches forward once more, open-handed but uncoloured (32–37), before settling into a compact ready stance.

## Contact part(s)
Single reaching hand (the forward/leading arm) — the magenta capsule marks the grab region at that hand; the rear hand stays tucked near the chest/chin throughout.

## Proposed drawings (pose keys)
- `windup_crouch` | source index 0 | large cartoon gorilla, right-facing, low compact crouch on all fours, both feet planted wide with knees bent, head tucked low with chin near the chest, both arms bent close to the body, weight centered and coiled.
- `windup_reach_up` | source index 4 | large cartoon gorilla, right-facing, low crouched stance, rear arm sweeping upward near the head/muzzle while the forward arm stays low and bent, torso leaning slightly forward, legs braced wide.
- `grab_reach_extend` | source index 8 | large cartoon gorilla, right-facing, low crouch stance with legs braced, forward arm fully extended out to the right at chest height ending in an open hand with spread fingers reaching far from the body, rear arm bent and drawn close to the chest.
- `grab_whiff_clutch` | source index 14 | large cartoon gorilla, right-facing, upright partial crouch, both arms drawn in with hands clenched into fists held close in front of the chest and chin, shoulders raised, torso squared forward.
- `grab_hold_idle` | source index 24 | large cartoon gorilla, right-facing, standing crouch with knees slightly bent, both fists still held near the chest, weight settled in a relaxed idle stance.
- `grab_recover_reach` | source index 34 | large cartoon gorilla, right-facing, standing crouch, one arm extended forward with an open hand reaching out at chest height, other arm bent close to the torso, legs planted shoulder-width apart.
- `grab_return_neutral` | source index 37 | large cartoon gorilla, right-facing, compact ready stance, both arms bent in front of the torso with hands loosely open, knees bent, weight low and centered.

## Uncertainties
No occlusion or camera motion issues; background is flat and DK stays roughly centered in frame throughout. The tail motion (32–37) visually echoes the grab reach but never regains the magenta colour, so it is treated as cosmetic recovery rather than a second active window — worth flagging to the gameplay author in case the real hitbox timing differs from the render. Whether the rear (tucked) hand also carries a hidden, uncoloured hitbox component cannot be confirmed from the render alone; only one hand is ever coloured at a time.
