# DonkeyKongHandSlapA — Hand Slap, Air

Source: https://ultimateframedata.com/hitboxes/donkey_kong/DonkeyKongHandSlapA.gif | images: 49 | canvas: 682x788 | delays: uniform 130ms per frame (6.37s total across 49 frames)
UFD row: startup 19/28, active 19—21/28—30, total 49, endlag 19, landing lag 10, hitbox notes First/Second, damage 5.0/6.0, notes "Transcendent priority."

## Overlay observations
| Index range | What is visible | Interpretation basis |
|---|---|---|
| 0-17 | No red. DK airborne, body continuously rotating/tumbling; one arm bent with a curled hand near his own face/chest, the other arm swinging between an extended-down and raised-overhead position as the body turns. | Windup/tumble poses, no hitbox present. |
| 18-20 | A single RED circle with white cross appears around one hand/forearm, extended out and down from the torso. The other arm is raised high overhead and back, out of the hit region. | First attack hitbox window (matches UFD's first active window, damage 5.0). |
| 21-26 | No red. DK continues tumbling in the air; the arm that struck retracts back near the torso/chest, the other arm swings from overhead down toward a bent, ready position. | Hitbox cleared; transition/second windup. |
| 27-29 | A single RED circle again, now around the other hand/forearm, extended out from the torso at a different rotation angle than the first window. The remaining arm is flung up and back. | Second attack hitbox window (matches UFD's second active window, damage 6.0). |
| 30-48 | No red. DK's tumble slows, both arms settle in loosely near the torso, and the legs progressively extend downward into a falling/landing posture by the final frames. | Recovery/falling phase leading into a landing (10-frame landing lag if grounded here). |

## Mapping check
- image_count vs UFD total: 49 vs 49 → equal
- red-region image indices + 1 vs UFD active frames: [19, 20, 21, 28, 29, 30] vs 19—21/28—30 → match
- Verdict: **verified 1:1** — the GIF has exactly one image per game frame (49 = 49), and the red hitbox windows land exactly on UFD's stated active frames (19-21 for the first hit, 28-30 for the second), with no offset.

## Motion by phase (index ranges, right-facing)
- Anticipation/windup 0-17: DK is airborne and tumbling continuously (his whole body slowly rotates through the sequence). One arm stays bent with an open/curled hand held close to his face or chest (the leading hand at the animation's start), while the other arm swings from an extended, flung-back position up and around overhead (the trailing hand), tracking the body's rotation.
- Strike/hold 18-20 (hit 1, 5.0 dmg): the hand that had been held close to the torso swings outward and down, its open palm active inside the small hit region at the end of its reach; the other arm is raised high overhead and back, clear of the hitbox. Based on the frame-0 baseline (leading hand tucked near the chest/jaw, trailing hand flung down-back), this first hit is thrown by the **leading hand**.
- Recovery/transition 21-26: the hitbox clears; the arm that just struck retreats back toward the torso, while the other arm swings down from overhead toward a bent, wound-up position, as DK's body keeps rotating.
- Strike/hold 27-29 (hit 2, 6.0 dmg): the second arm (previously the one raised/overhead) now swings out to strike, its open palm active inside a small hit region positioned differently than the first (reflecting the body's continued rotation), while the first arm sweeps up and back out of the way. This reads as an **alternating hand** strike — the opposite hand from hit 1 — consistent with the ground version's alternating-palm pattern, though see Uncertainties.
- Recovery 30-48: both arms settle loosely near the torso as the spin slows, and the legs extend downward through the last third of the sequence into a falling posture, preparing to land (the move's 10-frame landing lag applies if DK touches ground here).

## Contact part(s)
One open palm/forearm at a time (alternating between the two hits), each producing a small, localized hitbox that travels with the swinging arm — unlike the wide, ground-spanning hit area seen on the grounded Hand Slap, this air version's threat region stays close to the striking hand itself.

## Proposed drawings (pose keys)
- `tumble_start` | source index 0 | Large cartoon gorilla airborne, tucked into a tight tumbling posture, right-facing; one arm bent with the hand curled near his own jaw/chest, the other arm flung down and back with fingers splayed open, knees drawn up, no ground contact.
- `arm_raise_prewindup` | source index 16 | Large cartoon gorilla airborne mid-tumble, body angled diagonally; one arm stretched straight up above the rotated torso, the other arm bent close to the chest with an open palm, legs trailing loosely below, no ground contact.
- `slap_1_impact` | source index 18 | Large cartoon gorilla airborne, one arm swung outward and down with the open palm striking through the air at full reach, the other arm raised high overhead and back; body angled diagonally mid-spin, no ground contact.
- `between_slaps` | source index 23 | Large cartoon gorilla airborne continuing to tumble, both arms drawn in loosely near the torso with open relaxed hands, body rotated to a new diagonal angle compared to the first strike, no ground contact.
- `arm_raise_second_windup` | source index 26 | Large cartoon gorilla airborne mid-tumble, one arm raised high overhead again, the other arm bent near the chest holding ready, torso rotated further around from the first strike's angle, no ground contact.
- `slap_2_impact` | source index 28 | Large cartoon gorilla airborne, the opposite arm now swung outward and down with the open palm striking through the air, the other arm flung up and back, mirroring the first impact from a rotated body angle, no ground contact.
- `tumble_recovery` | source index 35 | Large cartoon gorilla airborne settling out of the spin, arms drawn in loosely near the torso, legs beginning to extend downward, body orienting toward a more upright, falling angle, no ground contact.
- `falling_prelanding` | source index 46 | Large cartoon gorilla airborne in a relaxed falling posture, body oriented upright, arms bent near the torso, legs extended downward reaching toward the ground in preparation to land.

## Uncertainties
- DK's body rotates/tumbles continuously through this animation rather than holding a fixed facing, so identifying each strike as strictly "his left hand" vs "his right hand" (rather than just leading/trailing relative to the frame-0 orientation) is a best-effort read, not a certainty — by the second strike the body has rotated enough that the frame of reference has shifted.
- A small pink mark visible on DK's hip/belt in several non-hit frames (e.g. source-00040) resembles a hitbox at a glance but was confirmed on close inspection to be his "DK" belt-buckle logo, not an attack region — flagged in case it's mistaken for a third hit window.
- No purple/magenta grab-style overlay was observed anywhere in this move; only the two red hit windows and the ever-present pale hurtbox layer are present.
