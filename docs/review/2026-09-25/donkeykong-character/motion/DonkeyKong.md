# DonkeyKong — Ledge Roll

Source: https://ultimateframedata.com/ledgerolls/DonkeyKong.gif | images: 54 | canvas: 1451x844 | delays: uniform 60ms per frame (all 54 frames)
UFD row: no UFD row numbers (Misc Info "Ledge Roll" entry has no startup/total/damage stats); ledge stats: "Roll": "1-28 intangible / 45 total".

## Overlay observations
| Index range | What is visible | Interpretation basis |
|---|---|---|
| 0–11 | DK hangs from a fixed ledge-corner reference point (a static crosshair/marker in the scene, left of center in the oversized canvas), body curled into a compact ball just below and left of the marker, tumbling/rotating in place with little horizontal travel; solid color, no overlay | solid-color body, ledge-hang phase |
| 12–19 | DK climbs up past the ledge marker and extends across the top of the platform line, body unfurling and beginning to roll rightward along the surface, crossing from left of the marker to right of it | solid-color body, roll begins |
| 20–27 | Continued tumbling roll further right along the platform line, limbs cycling through a curled rotation, hands briefly visible raised above the body mid-tumble; solid color, no overlay | solid-color body, roll continues |
| 28–43 | Pale purple/white hurtbox overlay appears over his whole body as the roll continues rightward and gradually slows, body passing through curled and half-extended shapes along the platform line | hurtbox display |
| 44–52 | Overlay continues as DK settles from the tumble into a compact seated/crouched shape, still moving slightly rightward, coming to rest well right of the ledge marker | hurtbox display |
| 53 | Overlay clears; DK is in a solid-color, low crouched ready stance, facing right, well right of the ledge marker and above the platform line | solid-color body, recovered stance |

## Mapping check
- image_count vs UFD total: 54 vs 45 (Ledge Stats "Roll" total) → differs by 9
- red-region image indices + 1 vs UFD active frames: none (no red attack regions were visible in any frame — this is a defensive/evasive option, not an attack) vs active n/a (not published)
- Verdict: **unverified** (no published UFD startup/active/total numbers exist for this move; the ledge-stat total of 45 does not match the 54 extracted images 1:1, and there is no active-hitbox data to compare since the ledge roll has no attack)

## Motion by phase (index ranges, right-facing)
- Anticipation/windup 0–11: DK hangs from the ledge at a fixed grab point, body curled into a tight ball just below the platform edge, rotating/settling in place with minimal horizontal movement.
- Strike/travel 12–43: there is no attack here — instead this is the roll's travel phase. DK climbs up past the ledge edge and rolls continuously rightward along the top of the platform, tumbling head-over-heels through curled and extended shapes as he crosses from the ledge corner out onto the stage surface; travel direction is left-to-right, away from the ledge.
- Recovery 44–53: the tumble decelerates and DK settles into a low crouched ready stance, ending well to the right of the ledge edge and facing right, prepared to act.

## Contact part(s)
n/a (evasive ledge-recovery option, not an attack — no hitbox is ever shown, only the hurtbox overlay during part of the roll).

## Proposed drawings (pose keys)
- `ledge-hang-curl` | source index 4 | Large cartoon gorilla curled into a tight ball, right-facing convention, knees drawn up toward the chest, one arm reaching up and back as if gripping a ledge above him, head tucked down.
- `climb-extend` | source index 15 | Gorilla unfurling from the curl, body stretched roughly horizontal, one arm reaching forward along the ground, legs trailing behind, torso beginning to roll onto its side.
- `tumble-open` | source index 20 | Gorilla mid-tumble, body twisted with both arms flung outward and up above the torso, legs bent beneath, caught in a rolling rotation.
- `tumble-curl` | source index 26 | Gorilla curled compactly again mid-roll, limbs drawn in tight, head tucked, body rotated onto its back.
- `roll-continue` | source index 34 | Gorilla stretched out low and long, arms and legs trailing behind in the direction of travel, body skimming close to the ground as the roll carries him forward.
- `settle-crouch` | source index 46 | Gorilla easing out of the tumble into a low crouch, torso lifting slightly, arms bracing near the ground, legs bending underneath, weight starting to settle.
- `stand-ready` | source index 53 | Gorilla in a low, hunched, right-facing ready stance, both hands loosely curled near chest height, knees bent, weight balanced and alert, facing the direction he rolled toward.

## Uncertainties
Per the source manifest, every frame of this GIF uses the full uncropped 1451x844 canvas (disposal_method 2, transparency_index 255), so DK's sprite occupies only a small portion of each frame near the left-center of the huge canvas rather than filling it — this is expected and not missing content. A thin horizontal line and a small fixed crosshair marker are visible in every frame at the same screen position; these read as a static ledge/platform-edge reference overlay rather than any hitbox or hurtbox element, so they are not described as DK's body. No red attack region appears anywhere in the 54 frames, consistent with the ledge roll being a non-attacking recovery option. The exact frame at which the hurtbox overlay begins (roughly index 28) and ends (index 53) is a visual estimate from the contact sheets and may be off by one or two frames from the true toggle point.
