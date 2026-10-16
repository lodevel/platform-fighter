# Capture-free first Link Final on natural RAF

Candidate `game-B95Fcp5p.js`, source
`platform-fighter-sha256-74c2fec99c76cdc7942171c69ff8c02f7c207d50263dffea93787a7d94040101`.

The roster is Link, DK and Pikachu. Resource and positions are controlled
setup; the real saved DOM special key activates Link's first Final. Its
13.33 MB owner page is **not** in the actual preload GPU preparation set.
No diagnostic Final pose is drawn first. The observer starts after a
presenter flush with a fresh clock boundary, then captures 121 actual
simulation ticks using normal RAF only. There are no screenshots, polling,
forced draws or additional evaluations during this observation.

All 34 active owner observations contain the real submitted `d04final`
drawing, with submitted alpha 1, no missing owner and no unhandled error.
The observation lasts 3577.8 ms. Actual observer wall gaps are median
82.9 ms, p95 254 ms, maximum 619.5 ms on forced headless SwiftShader;
this does not qualify 60 FPS performance.

Passive instrumentation separates the following costs:

| Measurement | Median | p95 | Maximum |
| --- | ---: | ---: | ---: |
| Host RAF callback | 9.3 ms | 25 ms | 372.8 ms |
| Fixed simulation tick | 1 ms | 2.6 ms | 13 ms |
| Complete simulation advance | 4.6 ms | 9.7 ms | 19.2 ms |
| View construction | 0.3 ms | 0.7 ms | 1 ms |

The first activation's owner texture upload takes 8.7 ms; its whole host
callback takes 24.8 ms. The largest host outlier occurs at owner age 62,
around shooting: 372.8 ms total, 9.7 ms in simulation advance, 0.5 ms in
view construction, and 362.6 ms outside those phases. Sampled WebGL
uploads and shader/link queries do not explain that outlier. This
reproduces slow host presentation in the software-rendering environment,
but does not isolate its precise renderer, audio or driver call. No
gameplay speed, shader or correctness gate was changed to hide it.

RAF, phase and WebGL wrappers add diagnostic overhead. The full per-draw
timestamps, actual owner frames, texture residency/preparation and phase
samples are retained in `report.json`; accelerated stress batch totals
must not substitute for these natural RAF measurements.
