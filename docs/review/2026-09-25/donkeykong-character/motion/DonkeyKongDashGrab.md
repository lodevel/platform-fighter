# DonkeyKongDashGrab — Dash Grab

Source: https://ultimateframedata.com/hitboxes/donkey_kong/DonkeyKongDashGrab.gif | images: 46 | canvas: 910x476 | delays: uniform 130ms per frame (5.98s total across 46 frames)
UFD row: startup 11, active 11—13, total 46, endlag 33, landing lag --, hitbox notes not specified, damage --, notes --

## Overlay observations
| Index range | What is visible | Interpretation basis |
|---|---|---|
| 0–9 | Hurtbox blob only. DK's body is nearly horizontal in a full-body forward dive/lunge, low to the ground, both arms stretched far out in front with open, spread fingers; trailing leg kicked out behind. He starts positioned in the left portion of the wide 910px canvas. | Diving dash-grab lunge, captured mid-air/mid-slide with full extension; no colour overlay yet. |
| 10–12 | Hurtbox blob + the same magenta-purple capsule/pill region seen in standing Grab (gradient pink-to-purple, open spread-fingered hand visible at the far tip), attached to the leading (forward) hand at roughly the reach's end. Rear hand is a curled fist tucked near the face. DK is now roughly centered on the canvas. | GRAB region — identical colour/shape language to DonkeyKongGrab's active frames. |
| 13–15 | Hurtbox blob only. Capsule gone; both hands become clenched fists drawn up near the chin/chest. Torso still low, beginning to rise out of the horizontal dive. | Whiffed-grab transition. |
| 16–31 | Hurtbox blob only. Fists stay held near the chest through a long hold; torso gradually straightens from the low dive lean toward a more upright crouch across the range. DK's position drifts rightward across the canvas. | Long endlag hold, consistent with 33-frame endlag; matches the "clutch" pose from standing Grab. |
| 32–45 | Hurtbox blob only. Continued straightening from crouch toward a compact standing-crouch ready pose; by the final frames DK sits near the right edge of the canvas. | Recovery tail, mirrors standing Grab's 32–37 but stretched over more frames and more distance. |

## Mapping check
- image_count vs UFD total: 46 vs 46 → equal
- grab-region (magenta capsule, not red) image indices + 1 vs UFD active frames: [10, 11, 12] + 1 = [11, 12, 13] vs UFD active "11—13" → match
- Verdict: **verified 1:1** — startup(11)+active(3, indices 10-12)+endlag(33) accounts for the full 46-frame span, and the capsule's index range converts exactly to UFD's active-frame numbers.

## Motion by phase (index ranges, right-facing)
- Anticipation/windup 0–9: DK dives forward almost horizontally, torso pitched low, both arms fully extended ahead with fingers spread, trailing leg stretched out behind — a full-speed sliding lunge captured over the extra-wide canvas as he travels left-to-right.
- Strike/hold 10–12: the leading arm ends in the magenta grab capsule with an open hand at its tip; the rear hand curls into a fist near the face while the low dive posture is maintained.
- Recovery 13–45: hands withdraw into fists near the chin/chest (whiffed grab) and hold that clutch pose through an extended idle stretch (13–31) while the torso gradually rises from the horizontal dive; by 32–45 DK straightens further into a compact standing-crouch ready stance, having visibly traveled across the canvas from left to right.

## Contact part(s)
Single reaching hand (the forward/leading arm) — the magenta capsule marks the grab region at that hand; the rear hand stays a tucked fist near the face throughout.

## Proposed drawings (pose keys)
- `dash_dive_launch` | source index 0 | large cartoon gorilla, right-facing, sprinting into a full-body forward dive, torso nearly horizontal and low to the ground, both arms stretched far out in front with open, spread fingers, trailing leg kicked out behind, front foot barely touching the ground.
- `dash_dive_reach` | source index 6 | large cartoon gorilla, right-facing, continuing a low horizontal dive lunge, both arms fully extended forward with fingers spread wide reaching ahead of the body, legs trailing behind and tucked, torso leaning hard into the forward momentum.
- `dash_grab_extend` | source index 11 | large cartoon gorilla, right-facing, low lunging stance with torso still leaning forward, forward arm reaching out ending in an open grasping hand at the end of the extended reach, rear arm bent up near the head, legs bent beneath the low torso.
- `dash_grab_whiff` | source index 15 | large cartoon gorilla, right-facing, low crouched stance rising out of the dive, both hands clenched into fists drawn close near the chin and chest, torso beginning to lift from the horizontal lean.
- `dash_grab_hold` | source index 24 | large cartoon gorilla, right-facing, a mid-height crouch with both fists held near the chest, torso partway between the low dive and a standing stance, legs bent and braced.
- `dash_grab_rise` | source index 34 | large cartoon gorilla, right-facing, rising further out of the crouch, both fists still close to the chest, torso more upright than the hold pose, weight shifting back onto the legs.
- `dash_grab_settle` | source index 45 | large cartoon gorilla, right-facing, compact standing crouch with knees bent, both arms bent in front of the torso with hands loosely open, fully settled from the dash's forward momentum, ready stance.

## Uncertainties
The canvas is confirmed to capture real horizontal travel, not just pose overflow: DK sits in the left third of the 910px frame at index 0 and has moved to the right third by index 45, consistent with a running dash carrying him forward through the move — this is the "surprising finding" flagged for the gameplay author (worth checking against the character's actual dash-grab travel distance). Because the background is flat grey with no ground line, it can't be confirmed whether he's airborne mid-lunge or sliding along the ground for indices 0–9. The exact frame where the torso finishes "standing up" (13–45) is a gradual continuum rather than a discrete pose change, so the 16–31 vs 32–45 split is an approximate reading, not a hard boundary.
