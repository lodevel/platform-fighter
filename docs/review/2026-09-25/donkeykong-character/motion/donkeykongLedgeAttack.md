# donkeykongLedgeAttack — Ledge Attack (Getup Attacks)

Source: https://ultimateframedata.com/hitboxes/donkey_kong/donkeykongLedgeAttack.gif | images: 55 | canvas: 804x815 | delays: 130ms uniform across all 55 frames
UFD row: no UFD row numbers (shared "Getup Attacks" section header, no startup/total/damage); Ledge Stats: Attack Range "03) S" (short), Attack Frames "1-25 intangible / 55 total / -22 on shield"

## Overlay observations
| Index range | What is visible | Interpretation basis |
|---|---|---|
| 0-15 | Compact curled body mass, uniformly tinted a solid dark navy/blue (not his natural purple fur), tan hand and foot visible at the edges of the curl; shape sways/rotates slightly frame to frame but silhouette stays compact | Solid dark-blue full-body tint (distinct from the pale hurtbox bubbles seen later) reads as the INTANGIBLE state indicator; matches ledge-hang idle sway |
| 16-21 | Same dark-blue tint, but one arm extends diagonally outward with fingers splayed reaching away from the body; torso begins to uncurl/elongate | Still intangible (dark tint held), body transitioning from hang to swing — windup/coil |
| 22-24 | RED capsule/oval with a white cross overlays the forward arm and torso; a tan clenched hand pokes out of the leading (forward) end of the capsule; the trailing foot/leg at the far end of the frame is still dark-blue tinted | RED = active attack hitbox per task convention; capsule shape = a swept forearm/fist strike; leading arm connects first, trailing limb still shown intangible |
| 25-44 | Tint switches to pale translucent purple/white round blobs clustered over the torso, natural purple fur and tan skin now visible underneath; body in a low sprawled/crawling stance, one arm planted forward, legs trailing; a small maroon/pink tongue shape is visible sticking out of the mouth around the low-to-mid 30s | Pale round blobs = HURTBOX (per task convention) — DK has become vulnerable; sprawled pose = climbing from the ledge onto the stage; tongue = exertion/dazed facial detail, not an overlay |
| 45-54 | Body draws back into a small, compact crouch; fur colors read clearly with only small pale hurtbox bubbles left near the torso center | Vulnerable but settled — final idle/get-up crouch before returning to neutral |

## Mapping check
- image_count vs UFD total: 55 vs 55 → equal
- red-region image indices + 1 vs UFD active frames: 22-24 (→ frames 23-25) vs n/a (UFD only publishes the 1-25 intangible window and the 55-frame total for this move, not an explicit active-hitbox frame range)
- Verdict: **verified 1:1** — image_count exactly matches the published 55-frame total, and the visual intangibility cue (solid dark-blue body tint) holds continuously from index 0 through index 24 and is replaced by the pale hurtbox overlay starting at index 25, which lines up almost exactly with the published "1-25 intangible" window (indices 0-24 in 0-based terms). The attack hitbox (22-24) fires in the last three frames of that intangible window, consistent with a getup attack whose intangibility is timed to cover its own startup/strike.

## Motion by phase (index ranges, right-facing)
- Anticipation/windup 0-21: DK hangs from the ledge in a curled, compact pose (indices 0-15, idle sway with a grip hand overhead and legs dangling), then uncurls as his leading arm reaches out and up past the ledge lip, fingers splayed, torso beginning to twist forward to haul himself up (16-21).
- Strike/throw 22-24: the leading arm whips forward in a wide horizontal sweep (forearm/fist smash) across the ledge lip; the forward/leading side of his body connects first while the trailing leg is still swinging up off the ledge.
- Recovery 25-54: DK's body flattens into a low sprawl and crawls forward onto the stage, forward hand planted on the surface, legs trailing behind (25-44, tongue lolling from the exertion), before gathering back into a compact crouch and settling into a ready stance (45-54).

## Contact part(s)
Leading forearm/fist, swept forward in a single wide horizontal arc as he climbs over the ledge lip.

## Proposed drawings (pose keys)
- `ledge_hang_idle` | source index 0 | Large cartoon gorilla hangs below a ledge lip, gripping the edge overhead with one hand, torso curled and compact, other arm tucked near the chest, knees bent with both feet dangling loosely below, head tucked down toward the gripping hand.
- `hang_coil` | source index 16 | Gorilla begins hauling itself up: the leading arm now reaches up and forward past the ledge lip with fingers splayed wide, torso twisting forward and uncurling, the trailing arm still braced back near the grip point, legs drawing up and curling behind the body.
- `forward_swing` | source index 22 | Gorilla's torso has risen level with the ledge lip; the leading arm sweeps forward in a wide horizontal punch at chest height, fist clenched, elbow driving across the body; the trailing arm anchors back near the ledge edge for support, legs trailing below mid-climb.
- `climb_sprawl` | source index 35 | Gorilla sprawled low and forward across the stage surface, weight braced on a forward-planted hand and forearm, legs splayed out flat behind, head low with mouth open in exertion.
- `gather_crouch` | source index 44 | Gorilla draws back into a tight, rounded crouch on the stage, both arms pulled in close near the chest and knees, head lowered, compact huddled silhouette.
- `settle_stance` | source index 48 | Gorilla settles into a relaxed low crouch, knees bent, both hands resting near the knees with empty open palms, torso upright and head level, ready to rise to a neutral standing pose.

## Uncertainties
The UFD render appears to use a steeply angled/rotating camera rather than a flat side view (DK reads as a small, foreshortened, top-down-ish silhouette for most of the clip), so absolute on-screen left/right does not map cleanly to a conventional side-on "facing right" throughout — the pose descriptions above translate the observed body mechanics (grip, reach, swing direction, sprawl) into a standardized right-facing side view rather than literally reproducing the odd camera framing. The exact frame at which the dark intangible tint first fades to the pale hurtbox overlay (index 24 vs 25) is a close call at contact-sheet resolution; full-size frames were checked at indices 22 and 35 to confirm the transition but intermediate indices 25-34 were only reviewed at thumbnail size.
