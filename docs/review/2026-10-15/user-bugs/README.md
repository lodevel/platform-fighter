# Repairs following user play

**2026-10-16 continuation:** the preview now serves `game-CICNsKxD.js` /
`65ef0281…87aa`, with loading-time effect shader preparation. See the
[new candidate and exact-build checks](../../2026-10-16/shader-preparation/README.md).
The B95 qualification and measurements below remain historical evidence for B95.

**Resumed after the PC restart.** The user confirmed Edge as the browser used
for the reported problems. Read [PAUSED.md](PAUSED.md) for the historical
handoff and resumed checkpoint. Those first-use rendering controls led to the
shader-preparation candidate linked above.

The user retested **match start in Edge** and reports that Link is smooth now;
the brief loading at the beginning is low priority. They explicitly have **not
tested Final Smash**. Further human/controller testing is currently unavailable
because their USB ports are not working. Automated saved-key Final checks
continue; they do not replace that missing human acceptance.

The pre-repair server on 4301 is **stopped at the user's request**. Its copied
assets and bundle `game-BYOl1XlT.js` remain frozen on disk; subsequent builds do
not update that copy.

The previous repair candidate at `http://localhost:4173/platform-fighter/` was
`game-B95Fcp5p.js`, source identity
`platform-fighter-sha256-74c2fec99c76cdc7942171c69ff8c02f7c207d50263dffea93787a7d94040101`.
Automated repair qualification is recorded in [qualification.json](qualification.json).
This document does not close the
[reopened plan acceptance](PLAN-AUDIT.md).

The first repair candidate, `game-rdv3pg8d.js` / `b242558d…72f9`, passed the
reports currently linked below. B95Fcp5p additionally removes generic
invincibility fading from active Final owners and exposes actual submitted
alpha for its browser gate. Gameplay and ordinary respawn blinking are unchanged.
Strict type/layers/build/static-copy checks and the complete suite
(554 files / 12,062 tests, 132 seconds) pass on B95Fcp5p. Its strengthened
[menu checks](menus/final2/report.json), [visual checks](final2/visuals/report.json)
and [scoped fighter checks](link/B95-qualification-summary.json) pass.
Performance remains open. Old receipts are retained with
their original identities, rather than relabeled as the new build.

| User report | Implemented correction | Evidence and remaining limits |
| --- | --- | --- |
| Smash meter absent by default | Fresh matches enable the meter; explicit saved Off remains Off. HUD bar spans the player card. | [Production visual checks](final2/visuals/report.json), [latest menu checks](menus/final2/report.json). |
| Returning gamepads claim different slots | Preserve actual device ownership through stage selection, matches and results. | Production keyboard plus two simulated gamepads retain slots, palettes and profiles across two matches. Human controller feel remains open. |
| Y does nothing; cursor jumps; palette difficult | Y opens the owning player's usable controls editor; analog movement no longer also snaps; stable palette targets retain clicks. | [Production menu report](menus/final2/report.json): pointer palette selection, analog/d-pad targeting, saved keyboard/gamepad bindings drive the original players. |
| Inferno differs from preview | Scenic camera retains the full authored composition and expands for launched targets. | [Production screenshots and corner measurements](final2/visuals/report.json). User visual acceptance remains open. |
| Inferno head instantly removes killed bodies | Accepted stock-loss receipts drive 100 simulation ticks of detached native tumble art, including eliminated players. | [Last-stock flight report](final/inferno-knockout/report.json): all three fighter bodies submitted through age 99, crouching survivor spared. [Capture-free normal-RAF control](final/inferno-knockout-raf-control/report.json) on B95 submits all three bodies throughout 29 on-screen flight samples, with no missing quads. Software-renderer pacing remains slow, so this qualifies visibility rather than smoothness. |
| Link disappears | Register the genuine ground/air blank-side-special aliases present in retained native motion data. Compose native upper/lower shooting body layers. | Old ground/air repeated-boomerang routes omitted 35/35 drawings each; [B95 ground/air routes](link/B95-blank/report.json) submit all 70. [Neutral-fire then walking fixture](link/B95-layer-ledge-loop-wait/report.json) observes 40 layered Flower samples and 30 visible ledge samples. Earlier simultaneous direction/attack correctly threw the item and did not qualify shooting. |
| Intro teleports or holds actors in air | Establish real support contact before the source intro; preserve continuous roots and use denser retained Link motion. | Focused simulation/contact/transition checks pass. Actual playback and final presentation qualification remain open. |
| Link Final has few poses and stalls | Retain all old drawings and add native intermediate samples: 72 ground and 57 air poses; improve Ancient Arrow presentation; keep active Final owners fully opaque. | [Eight B95 ground/air, left/right hit/miss routes](link/B95-final8/report.json) pass full simulation selection traces and 132 actual GPU checkpoints with owner alpha 1. Hits deal 44.1%, misses 0. Art inspected, retained drawings compared. [Natural first activation](final/link-final-raf/report.json) keeps all 34 observed owner draws visible, but includes a 373 ms shooting host outlier under SwiftShader. Cause and healthy FPS remain open. |
| Star Rod / Fire Flower look poor | New procedural five-point star and directional animated flame recipes. | [Actual production packets rendered](final2/visuals/report.json), both flame directions inspected. Appearance needs user acceptance. |
| Permanent freezes | Frame loop survives faults and exposes Restart/Menu; retry failed loads; recover context loss; preserve disconnect pause ownership. | [Eight production recovery cases](final/freezes/recovery/report.json). [Stress run](final/freezes/stress/report.json): 15,126 frames and 16 Finals, no unrecovered fault. Long timing spikes remain unresolved; this is not proof all freezes are fixed. |
| Violent ordinary launches vanish | Investigate actual submitted quads and playback timing. | [Natural-RAF launch report](final/launch-raf/report.json): all three fighters remain submitted and on screen throughout sampled 1.54–1.59 second flights. Disappearance not reproduced; choppy software-renderer pacing remains a limitation. No blanket fix claim. |

Pikachu's Final is playable end to end: startup, hit/capture, attack sequence,
miss, release and finish routes were qualified in the takeover record. It is a
source-guided 2D adaptation with documented native-engine/presentation limits,
not a claim of exact Ultimate parity. The B95 [normal-RAF release check](link/B95-pikachu-release-raf/report.json)
observes the captured victim and five on-screen post-release body draws with
no missing quads. Its slow software-renderer pacing is explicitly unqualified.

The authorized DK/Pikachu lossless packing preserves all 2,495 logical drawings,
visible pixels, ROOT anchors and timing. Combined decoded sheet storage falls
from about 2,043 MiB to 876.60 MiB. Source-pixel reconstruction passes; a six-draw
nearest-filter GPU control is exact. Linear filtering has small raster edge
differences: the six-draw pilot averages 0.264–0.533 channel values out of 255
over visible pixels, with identical alpha bounds; the broader 60-draw run has
maximum channel difference 27. Explicit high precision and a four-texel manual
filter do not remove the differences. Runtime filtered output is therefore not
claimed pixel-identical; no production shader/filter change was made. These
results are separate from the still unfinished Link KTX2 path and
the general character memory policy; see [the memory audit](MEMORY-AUDIT.md).

The current candidate passes [strict type/layers/build/static checks](final2/build.txt)
and [12,062 tests in 554 files](final2/tests.txt). Browser evidence above
identifies its exact bundle. [Replay regression](final2/replay/report.json)
matches 22,200 frames across nine checks: eight ordinary frozen scenarios and
a pre-bug browser reference containing actual Final activations. Five ordinary
checks completed before the presentation-only opacity delta; the other four
completed on B95. Simulation source was unchanged between these runs. The
composite report retains both identities and does not call this nine fresh B95
runs. Interrupted diagnostics are marked incomplete and do not qualify cases
they did not finish. Original broader matrices remain historical evidence for
their recorded builds.

Nothing has been committed or pushed. The old cleanup deletion lists have not
been executed. Packing approval covers lossless layout changes for DK/Pikachu;
it does not authorize thinning, rescaling or lossy GPU compression of those two
fighters, nor settle a general roster memory budget.
