# Pikachu Final display density — 2026-10-16

The Final body now displays every integer sample of the seven retained native motions. The old bank contained 187 selected drawings; the separate display bank contains 423 semantic samples (417 distinct texture drawings), adding 236 native poses. The 187 accepted drawings are copied exactly. No source timing, movement, receiving geometry, outgoing packet, attachment, effect-point clock, protection or capture rule changes.

| Motion sheet | Original samples | Display samples |
| --- | ---: | ---: |
| final |31|64|
| final_air |31|64|
| final_dash |7|7|
| final_dash_end |31|91|
| final_air_dash_end |22|62|
| final2 |42|95|
| final_air2 |23|40|

Most sparse clips previously held a drawing for three simulation ticks. Grounded miss motion advances at its existing 0.7 source rate, extending some holds to five simulation ticks. Display selection now floors the actual semantic motion age, preserving the six-sample dash loop and nonloop terminal holds. This improves pose density; it does not interpolate physical motion or claim a general FPS improvement.

The native NUANMB paths and hashes remain pinned by [the original source plan](../../2026-10-15/pikachu-final/owner-art-plan.json) and `source-and-generation.json`. Official visual references are [Pikachu's fighter page](https://www.smashbros.com/en_US/fighter/08.html) and [Ultimate Frame Data](https://ultimateframedata.com/pikachu). Native files remain the timing authority. The accepted CPU toon operator, palette, fixed camera, source-root registration and existing helper-constraint approximation are unchanged. Every new Trans sample is zero. All seven complete pose contact sheets were inspected.

`assets/characters/pikachu/final-visual-frames.json` is a separate display-only bank. `port/src/fighters/finalVisual.ts` samples its pages from `finalSmash.sheet/age`. The common legacy renderer uses this route for owner bodies, backend diagnostics and previews. Captured-victim selection takes precedence and retains its own original pages. The old seven owner pages stay in the manifest for explicit legacy consumers; ordinary match loading replaces them with the new pages.

The 14 lossless pages are at most 2048×2048 pixels and decode to 179,202,240 bytes (170.9006 MiB), within the 176 MiB limit. The old owner pages decoded to 82.63 MiB. Original full-resolution drawings are neither reduced nor dropped. Pages remain grouped by motion to limit unrelated page loads during a phase, and loading retains the existing 64 MiB total GPU warm budget. The [independent cold/warm natural-RAF receipt](../final-visual-pacing/qualification.json) measures first-use uploads, actual resident bytes and frame pacing; compressed PNG size is not used as a memory estimate.

Regeneration requires Python with NumPy, Pillow and `ssbh_data_py==0.9.1` (the retained local dependency directory is `.tmp/pikachu-final-libs`). It uses the retained native mesh/material/texture/motion inputs and these commands, serialized with the project lock:

```sh
PYTHONPATH=.tmp/pikachu-final-libs:tools flock .tmp/dk-heavy.lock python3 tools/render-pikachu-final-visual.py
python3 tools/install-pikachu-final-visual.py
flock .tmp/dk-heavy.lock node tools/pikachu-final-density-match.mjs --edge --require-hit --skip-pacing --out docs/review/2026-10-16/pikachu-final-density/runtime-after
node tools/qualify-pikachu-final-visual.mjs
```

The comparison command requires both raw captures from their matching before/after bundles; the permanent `qualification.json` records the completed comparison when disposable captures are cleaned.

The renderer uses 20 effective CPU workers, one BLAS thread each, persistent renderer instances, staggered initialization and dynamically assigned single-pose work. The four-pose pilot completed in 2.28 s at about 139 MiB peak RSS per worker. The remaining 232 poses used 38.91 s render wall time and 733.998 worker CPU seconds (18.86 effective cores), with 152.6 MiB maximum worker RSS; render plus packing completed in 44.23 s. `source-and-generation.json` preserves environment, operator/source hashes and measurement receipts. Intermediates are private `.tmp` outputs and can be regenerated.

`installation.json` records independent validation of all 187 accepted RGBA crops, complete 423-sample coverage, every page hash, logical bounds, roots/scales and decoded memory. Focused tests cover semantic age versus the unchanged authority clock, nonloop/loop behavior, repeated ticks and rewinds, backend reset/diagnostics, previews, captured-victim exclusion, resource loading and the explicit manifest whitelist. Only the seven authoritative Final clips are pinned by the test; unrelated Pikachu art can evolve.

The browser fixture runs eight actual matches (ground/air × left/right × hit/miss). Resource grant and placement are injected; activation uses the saved keyboard binding, followed by actual MatchSim physics and MatchView draws. `qualification.json` compares every captured authority row and verifies the selected display page on every owner tick, source registration, victim geometry/page identity, phase completion and damage. Representative actual phase screenshots are inspected separately from the source contact sheets.

Whole-world checkpoint replay is not claimed for this injected fixture. An attempted restore correctly rejected setup events absent from the saved input history, before drawing. That optional probe path was removed. Display seek/reset is covered by focused tests; genuine input-history Final replay remains covered by the existing full suite.

## Accepted runtime result

`qualification.json` passes all eight cases. Before/after authority hashes match exactly, as do every root, scale, facing, status rotation and victim page/geometry selection. All sampled owner drawings were resident and submitted. The generated twelve-image phase montage was inspected and accepted, including ground/air startup, dash, hit, attack, attack2, attack-finish, return, finish and miss. The on-screen FPS numbers in these manually stepped screenshot fixtures are not pacing measurements. Both disposable browser profiles were removed. Generated captures, per-drawing contact sheets and the phase montage are removed after acceptance under add-character skill section 8. The harness can regenerate the runtime captures, and the retained native inputs, generator and installed atlas metadata can regenerate the pose reviews. Compact numeric/source/qualification receipts are retained.

The separate natural-RAF checks observed roughly twice as many Pikachu body poses (76/77 to 157/158 across first/repeated playback), unchanged 350 active fixed ticks and 62.37 damage, and no frame intervals over 50 ms. First-use texture uploads changed from 12 to 14; repeated playback uploaded none. These are measured acceptance runs, not a universal frame-rate guarantee.

Accepted-review cleanup completed: the combined DK/Pikachu scope removed 6 generated directories and 7 separately listed review images (639 files, 181,769,349 bytes total). No tracked files or required inputs/fixtures were removed. Compact numeric/source records, regeneration tools/recipes, native/libs inputs and installed assets remain.
