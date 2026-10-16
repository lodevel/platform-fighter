# Same-browser Link Final first/second activation control

The bounded RTX control reproduces a large first-use startup gap, followed by a
smooth second activation in the same browser/page/WebGL context. This points to
first-use work or scheduling below/around the renderer rather than a repeating
fixed-step CPU cost. It does **not** isolate texture upload, shader compilation,
GPU completion, compositor scheduling, or a driver stall as the cause.

The actual game context before and after reports `ANGLE (Microsoft Corporation,
D3D12 (NVIDIA GeForce RTX 4070 Laptop GPU), OpenGL ES 3.1)`, maximum texture size
16384, without context loss. This is headless Chromium in WSL/Mesa, **not the
user's Windows Edge browser**. No application, build, asset, driver or persistent
configuration changed. The production bundle remains `game-B95Fcp5p.js`, build
identity `platform-fighter-sha256-74c2fec99c76cdc7942171c69ff8c02f7c207d50263dffea93787a7d94040101`.

| Startup measurement, through age 120 | First activation | Second activation |
| --- | ---: | ---: |
| Observer wall gap median / p95 / maximum | 16.7 / 18.1 / **537.2 ms** | 16.7 / 17.4 / **18.0 ms** |
| RAF timestamp gap median / p95 / maximum | 16.7 / 16.7 / **533.2 ms** | 16.7 / 16.8 / **16.8 ms** |
| Host callback median / p95 / maximum | 2.5 / 4.2 / 16.7 ms | 2.4 / 3.1 / 3.4 ms |
| Fixed step median / p95 / maximum | 0.6 / 1.5 / 3.9 ms | 0.7 / 1.1 / 1.5 ms |
| Actual owner page `texSubImage2D` | 4.7 ms | No upload |
| Missing active native owner presentations | 0 of 135 | 0 of 139 |

The first owner sheet is already decoded but not GPU prepared: 2192×1520,
13,327,360 RGBA bytes; loading-policy preparation excludes it. The diagnostic
records its first `texStorage2D` and `texSubImage2D` on native texture ID 28 at
age 1. The texture is never deleted and the second activation performs no owner
upload, so owner reuse is directly observed. No texture/shader eviction is forced.
Other first-use work also becomes warm; the result cannot attribute the benefit
to owner residency alone.

The cold gap is age **2→8**, frame **252→258**. The age-2 host callback runs
9889.7→9893.9 ms (4.2 ms); the next starts at 10424.8 ms and ends at 10431.1 ms
(6.3 ms). Thus about **530.9 ms lies between those host callbacks**. The owner
upload had ended at 9885.3 ms, before a subsequent normal host callback. No
observed long task spans the gap. GL API CPU timings and callback instrumentation
do not measure GPU completion or explain why the next RAF was delayed.

The first shooting transition at age 61 has a 16.7 ms host callback and records
shader/program work; a later age63→66 wall gap is 56.3 ms. The warm activation has
no recorded shader/program/upload calls in this startup window. These are
first-use clues, without a GPU-process trace proving causation.

The fixture uses the same Link + DK + Pikachu roster, flat stage, saved keyboard
special binding, no items, neutral placement/resource setup and natural host RAF.
Positions, velocity, facing and damage match exactly before both activations and
are asserted. The first Final completes naturally at age 143 before the second
fixture resets positions/resources; no active Final is forcibly canceled. The
same match clock, RNG/AI history, transient effects and renderer caches are not
reset byte-for-byte, so this is a practical same-context warm control rather than
an isolated driver microbenchmark. Both Finals complete; no page errors or match
faults occur. Submitted/visible native-frame metrics are observed; no screenshot
or pixel-quality acceptance is claimed.

During each observation one awaited page-side promise runs its own RAF observer;
there is no evaluation polling, screenshot, manual simulation stepping, forced
draw or GPU readback. Passive RAF/GL wrappers, phase timers, render diagnostics and
a long-task observer add observation overhead. This single pair is bounded
evidence, not a percentile estimate across launches or a proof of freeze absence.

Raw timestamps, GL counters, host intervals, view/fixed-step phases, per-frame
render counters, fixture diagnostics and the first/second comparison are retained
in [report.json](report.json). The harness is
[`tools/link-final-repeat-raf-acceptance.mjs`](../../../../../../tools/link-final-repeat-raf-acceptance.mjs),
adapted from the existing `tools/link-final-raf-profile.mjs`; the older
`tools/final-real-raf-acceptance.mjs` name does not exist. The harness subsequently
gained optional Windows Edge CDP support and browser/script metadata; the raw
receipt here predates those additions and has not been rewritten.

Command used (under the shared heavy lock):

```sh
flock -n .tmp/dk-heavy.lock node tools/link-final-repeat-raf-acceptance.mjs
```
