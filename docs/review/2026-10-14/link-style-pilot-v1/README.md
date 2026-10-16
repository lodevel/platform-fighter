# Link original-texture style pilot

The private 12-pose pilot makes a less cartoonish Link feasible without rebuilding every pose. The original blue Champion tunic, face, hair and equipment textures are recovered through the retained pixel-to-UV maps. The middle **native-blue** column is the useful visual direction; the right **fixed-alpha** column is a silhouette-preserving control and retains some green cap/border pixels. Nothing was installed or changed in the other active work.

View [the comparison at game scale](comparison-game-scale.png) and the larger originals: [sheet 1](comparison-closeups-1.png), [sheet 2](comparison-closeups-2.png), [sheet 3](comparison-closeups-3.png). The 12 poses cover neutral, dash, both sword directions, airborne attacks, crouched landing, and two actual composed HAND/ShieldBACK samples. Root viewed all four original sheets and approved them as a useful aesthetic/timing experiment, **not production art acceptance**. Native-blue is darker and quieter at game scale, and the sword lacks the original game's metal lighting. The mild continuous depth lighting is authored; native shaders, normal/specular materials and engine lighting are not reconstructed.

## Measured costs

| Measurement | Actual result |
|---|---:|
| Original texture setup, one process | 0.353 s wall / 0.171 s CPU |
| Retained-map pose, loading + recolor + three PNG writes | 0.320–0.387 s |
| Twelve poses: UV/depth/RGBA load/decode | 1.351 s wall total |
| Twelve poses: texture sampling and lighting | 1.216 s wall total |
| Twelve poses: three PNG outputs per pose | 1.739 s wall total |
| Complete first batch, including input/hash checks and comparison sheets | 15.344 s wall / 4.242 s CPU |
| Four persistent workers, second warm 12-pose batch | 3.189 s wall, **3.763 poses/s** |
| Four-worker warm batch CPU across workers | 2.759 s |
| Four workers: true per-child highwater | 170–192 MiB; aggregate peaks below 730 MiB |
| Fresh map: first Fsmash14 | 4.612 s wall / 0.689 s CPU |
| Fresh map: next Uair14 in the same process | 2.929 s wall / 0.645 s CPU |

The four-worker result is measured beside the other AI's existing Chromium workload. It provides modest practical improvement over the one-worker conversion; it does not justify assuming 20× scaling. Load/decode and PNG I/O accumulated 7.459 s wall but only 1.293 s CPU across the four workers. Reusing existing maps avoids rig/mesh parsing and rasterization. The large wall/CPU gap in fresh-map generation also includes source output/serialization and filesystem waits, not four seconds of pure triangle computation.

## Time estimate and scope

At the measured four-worker warm rate, **cached conversion alone** is about **8.2 minutes for the installed 1,842 drawings**, or **1.53 hours for the known 20,711 Link outputs**. This deliberately retains the pilot's three-output write cost. These are conditional extrapolations from 12 samples, not completion promises: only these 12 compatible retained UV/depth maps were verified, and corpus-wide map availability remains unaudited. Missing maps add fresh generation cost; the two-pose fresh-map sample is too small to promise full-bank throughput.

For scheduling, allow **roughly 1–3 hours for the installed style integration and review** if there are no major geometry issues. The known full corpus is a **several-hour job beyond its roughly 1.5-hour cached conversion component**. These are planning ranges for packing, actual encoded-size admission, scoped geometry/appearance review and integration. Human review time, requested lighting refinements, missing-map repairs and new source/gear/article/victim work are uncertain and can extend them. Tests/build/browser/gameplay verification remain the user's separate final phase and are excluded here.

The known scope is 9,513 ordinary drawings, 596 HAND, 730 conditional, 9,638 current composed tuples, and 234 private Link Final drawings: **20,711 total**. The installed 1,842 are a subset. Superseded banks are not counted again. Additional planned Bow poses, articles, cargo, victims and unresolved equipment variants are outside that closed count; DK/Pikachu art and their Final effects are excluded. The authoritative accounting is retained in [the scope receipt](../../2026-10-12/link-character/rework/runtime/visual-style-rerender-scope-v1.json).

## Geometry and transport limits

The cached style pass changes zero raw mesh-source alpha pixels. The fixed-alpha control changes zero current alpha pixels. The native-blue variant differs from the current packed art at **125,388 alpha values across the 12 poses**, principally removal of expanded ink and the authored cap; it cannot be called a pure RGB-equivalent replacement. All 14 saved physical part masks remain unchanged, with their exact source rig/root and source Head guards pinned. This avoids a whole-body refit, but source-mask reuse alone does not approve the new visible scalp/cranial contact or every changed occlusion. Actual production review remains required.

The fresh Fsmash14 reproduction matched recorded rig/root/mesh/equipment inputs but differed at **eight raw-alpha feather/quiver pixels**. That output is retained and quarantined as a timing sample; exact pixel equality was rejected. The second fresh Uair14 source-alpha comparison was exact. No completed bank was overwritten or refitted.

The exact standalone codec comparison of these same 12 cells grew from **866,914 to 1,350,678 encoded bytes (+55.8%)**, with identical 13,893,632 decoded bytes. This is not an atlas forecast. The current 128 MiB partial Link budget has only about 10.8% headroom, so a redesign needs actual packing/encoding and a new measured budget decision. See [the codec receipt](analysis/standalone-codec-same12-v1.json).

Reproduce only the private experiment from the repository root:

```sh
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 MKL_NUM_THREADS=1 python3 docs/review/2026-10-14/link-style-pilot-v1/operator.py
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 MKL_NUM_THREADS=1 python3 docs/review/2026-10-14/link-style-pilot-v1/fresh_and_parallel.py
```

Exact input/output hashes, stage timings, actual worker IDs and fresh `/proc` RSS/HWM are in [the initial timing receipt](timing-receipt.json), [fresh-map timings](fresh-map-timing.json), [four-worker timings](four-worker-timing.json), [Root's scoped visual review](coordinator-four-sheet12-pose-scoped-review.json), and [the summary](summary.json). No tests, builds, browser launches or game checks were run for this pilot; no full redesign has begun.
