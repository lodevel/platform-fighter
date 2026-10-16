# donkeykongTripAttack — Trip Attack (Getup Attacks)

Source: https://ultimateframedata.com/hitboxes/donkey_kong/donkeykongTripAttack.gif | images: 49 | canvas: 1148x607 | delays: 130ms uniform across all 49 frames
UFD row: no UFD row numbers (shared "Getup Attacks" section header, no startup/total/damage); ledge stats: no dedicated trip-attack entry published (n/a) — Ledge Stats only lists Attack Range/Attack Frames for the ledge attack, Neutral Getup, Roll, and Jump, not a trip-recovery attack

## Overlay observations
| Index range | What is visible | Interpretation basis |
|---|---|---|
| 0-6 | Compact curled body mass lying on the ground, tinted a solid dark navy/blue; one open hand splayed flat against the ground near the head, a small pink/maroon tongue shape visible lolling from the mouth | Solid dark-blue tint = INTANGIBLE indicator (matches ledge-attack convention); lying/curled posture matches the tripped starting state; tongue = dazed facial detail |
| 7-17 | Tint switches to pale translucent purple/white round blobs over the torso, natural purple fur visible underneath; both fists drawn up close near the head/chest, body still low and curled but tucked more tightly | Pale blobs = HURTBOX — DK becomes vulnerable here; gathering pose bracing to spin/push off the ground |
| 18-19 | RED capsule with white cross overlays the body's forward/RIGHT side; a splayed open hand is visible at the far LEFT edge (outside the red zone) while a clenched fist pokes out of the far RIGHT end of the red capsule | RED = active hitbox; the right-extending arm/fist connects first — a rightward arm sweep |
| 20-22 | Hurtbox blobs only, both arms now spread wide to either side at full extension, fists loosely clenched, body flat on the ground | Transitional mid-spin frame between the two hit windows, no active hitbox |
| 23-24 | RED capsule reappears, now over the body's LEFT side/head area; a clenched fist pokes out of the far LEFT end of the red capsule while the right arm (clenched fist, natural fur/tan color) sits outside the red zone at the far right | Second hitbox window on the opposite (left) side — confirms the move is a two-sided sweep, consistent with getup/trip attacks needing to threaten either side of the recovering fighter |
| 25-39 | Hurtbox blobs only; body remains flat/prone with both arms extended to the sides, then transitions into a plank-like press-up with hands/fists planted at both sides and the torso lifting off the ground | Rising out of the spin into a push-up motion, still vulnerable |
| 40-47 | Body curls back into a tight, rounded, kneeling gather; hurtbox blobs shrink and cluster near the torso center; natural fur color increasingly visible | Gathering back into a crouch before standing |
| 48 | Fully natural fur/skin colors, only small pale hurtbox bubbles remain near the torso, compact low crouch/ready stance | Final settled idle pose, same style as the ledge-attack's terminal frame |

## Mapping check
- image_count vs UFD total: 49 vs n/a → n/a (no comparable published total for this move)
- red-region image indices + 1 vs UFD active frames: 18-19 and 23-24 (→ frames 19-20 and 24-25) vs n/a (no Ledge Stats entry exists for the trip attack)
- Verdict: **unverified** — there is no published UFD numeric data for this move at all (shared header row, and no dedicated Ledge Stats line), so the frame count and hitbox timing cannot be checked against any source number. The visual read itself is internally consistent (two clearly separated red hitbox windows, one per side) but nothing external confirms it.

## Motion by phase (index ranges, right-facing)
- Anticipation/windup 0-17: DK lies curled on the ground, dazed (tongue out, one hand pressed flat to the ground) while intangible (0-6), then becomes vulnerable and draws both fists in tight near the head/chest as he braces to push off the ground (7-17).
- Strike/throw 18-24: a rightward-sweeping arm/fist sweep fires first (18-19, leading arm extended to the right, fist clenched, connecting on that side), followed by a brief transitional beat with both arms spread (20-22), then a mirrored leftward sweep fires (23-24, leading arm now extended to the left near the head) — the move deliberately hits on the right side first, then the left, so it threatens an opponent standing on either side.
- Recovery 25-48: both arms remain spread as DK's body lies flat, then presses up off the ground plank-style on extended arms (25-39), curls back into a rounded kneeling gather (40-47), and settles into a relaxed low crouch/ready stance (48).

## Contact part(s)
Both arms/fists, in two sequential wide sweeps — first to the right, then to the left — while the body is prone/spinning on the ground.

## Proposed drawings (pose keys)
- `lying_dazed` | source index 0 | Large cartoon gorilla lies curled on its side on the ground, knees drawn up toward the chest, one arm bent with an open palm pressed flat against the ground near the head, the other arm tucked beneath the body, head down and rounded back.
- `gather_fists` | source index 10 | Gorilla still low to the ground, both fists drawn up close beneath the chin, elbows bent and tucked at the sides, legs curled under the torso, head lifted slightly as if bracing to push off the ground.
- `sweep_right` | source index 18 | Gorilla lying flat on its stomach, one arm stretched out along the ground to the left with fingers splayed, the other arm whipped out straight to the right at shoulder height with a clenched fist, torso twisted flat against the ground, legs trailing behind, head low.
- `sweep_left` | source index 23 | Mirror of the right sweep: one arm now whipped out straight to the left with a clenched fist near the head, the other arm extended out to the right, torso flat against the ground, legs trailing behind.
- `press_rise` | source index 34 | Gorilla pushes itself up off the ground on both fully extended arms like a press-up, fists planted to either side at shoulder width, torso and hips lifting clear of the ground, legs stretched out flat behind, head up.
- `gather_crouch` | source index 44 | Gorilla curls back into a tight, rounded kneeling crouch, both arms drawn in close to the chest, knees bent under the body, head tucked down, compact huddled silhouette.
- `settle_stance` | source index 48 | Gorilla in a relaxed low crouch/ready stance, arms hanging loosely near the knees with empty open hands, knees bent, torso upright, head level.

## Uncertainties
No UFD numeric data exists for this move at all (no dedicated total-frame or active-hitbox figures in the shared "Getup Attacks" header row or in Ledge Stats), so the mapping check has nothing external to verify against beyond internal visual consistency. contact-sheet-004.png contains only a single, unusually small (256x224) thumbnail for index 48; the individual full-size source-00048.png was not separately opened since the thumbnail was already clear enough to read as the natural-color settled crouch pose consistent with the rest of the sequence. As with the ledge attack, the render uses an angled/foreshortened camera rather than a flat side view, so the "sweep right" / "sweep left" reading is based on which side of the on-screen composition the red hitbox and matching clenched fist appear on, translated into a standardized right-facing side view for the pose prompts.
