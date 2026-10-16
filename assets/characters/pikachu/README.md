# Pikachu registered sprite preparation

Partial reviewed pack: neutral, eleven up-air, twenty-two neutral-air, twenty-two
down-air, seven down-air landing, twelve up-tilt, six down-tilt, twenty-four
back-air, seven back-air landing and nine jab drawings. Full fighter,
manifest, roster and per-move routes remain incomplete.

`tools/pikachu-registered-pack.py` consumes hash-pinned rough source PNG approvals,
integer-pads neutral to2048x1536root1024,1152 and resamples every full canvas by1/4
with Pillow LANCZOS. Cells are512x384root256,288, displayed at4*70/600scale with
body centre25worldpx above root. There is no alpha-bound crop/recenter or per-pose
scale. `registered-poses.json` records sources, transforms, strip hashes and holds.

Source and packed output reviews/runtime evidence:
`docs/review/2026-10-06/pikachu-character/up-air/README.md`.
The reviewed isolated packed browser uses the same simulation sprite driver as
MatchScene via a Wolf fixture attack alias. Full Pikachu consumers remain pending.

`tools/pikachu-registered-normal-pack.py` applies the same fixed-canvas transform
to independently pinned `pose-batches/*.json`. All 29 down-air/landing and 18
vertical-tilt packed cells have been manually inspected. Their scoped packed
runtime checks and actual Canvas reviews now pass. Neutral air also passes an isolated packed build
using the shared Match sprite driver. See the corresponding character evidence
folders for approvals, captures and build identities.

All 31 back-air/landing packed cells and62both-facing packed Canvas poses are
manually inspected. Shared Match driver airborne/landing qualification passes
through presentation-only Link bair/tilt/idle aliases with Wolf physics/save fixtures. The full PNG back-air/landing browser preview
passes its separate scoped acceptance, recorded under `back-air/`.

All nine jab packed cells and18both-facing packed Canvas poses are manually inspected; shared Match sprite-driver qualification passes via the Wolf generic attack alias. Source region, saved grounded slot and fresh-press restart checks pass in the isolated full-PNG preview; see `jab/README.md` in the character evidence folder.

Packed down-air/landing and vertical tilts now have scoped shared Match-driver browser acceptance and actual Canvas inspection in `down-air/packed-browser` and `vertical-tilts/packed-browser`. Down air uses presentation-only Link dair/tilt/idle aliases; vertical tilts use Donkey Kong utilt/dtilt/idle aliases. Saved/physics fixtures remain Wolf. Vertical tilts now supply explicit drawing windows matching reviewed receiving holds through save/load. This closes the packed-fixture check only; dedicated Pikachu frame manifest/animation keys/roster/Lab/match remain incomplete. Existing landing floor outline overlap and native collision/status/root/patch gaps remain recorded.
