# Windows Edge first-use shader query profile

A passive expanded-GL timing probe and CDP CPU sampling identify a concrete
first-shooting stall: **`getProgramInfoLog` blocks for 30.0 ms** during the first
Link Final at age61. All **19 CPU samples** inside that measured query interval
are in native `getProgramInfoLog`, called from Three's first-use render path:
`A → gi → renderBufferDirect → render → frame` in
`presenter-BL7Bq70h.js`. The corresponding installed source is
`node_modules/three/src/renderers/webgl/WebGLProgram.js`, `onFirstUse`, where
`getProgramInfoLog` precedes shader info-log and program-status queries.

This establishes the stall route in this run. It does **not** retroactively prove
that every millisecond of the preceding baseline's 116.5 ms shooting callback
was the same query; that earlier run did not time it. This fresh profile process
reproduces a smaller stall. Driver/OS shader caches survive disposable browser
profiles, instrumentation and CPU sampling alter timing, and display/process
conditions differ between runs.

Actual browser: **Windows Edge 155.0.4283.45**, headless, fresh disposable TEMP
profile; actual game context: **Intel Iris Xe / Direct3D11**, maximum texture size
16384. No adapter override is applied. Browser version, Windows `Edg` user agent,
renderer before/after, profile clocks and exact script SHA256 are retained in
[report.json](report.json). Application/build/assets remain unchanged:
`game-B95Fcp5p.js`, identity
`platform-fighter-sha256-74c2fec99c76cdc7942171c69ff8c02f7c207d50263dffea93787a7d94040101`.

| Measurement | First activation | Second activation |
| --- | ---: | ---: |
| Startup observer wall gap median / p95 / maximum | 6.8 / 8.4 / 49.8 ms | 7.0 / 8.3 / 8.8 ms |
| Startup host callback median / p95 / maximum | 2.7 / 3.9 / 35.5 ms | 2.4 / 3.3 / 4.0 ms |
| Age61 host callback | 35.5 ms | 2.6 ms, then 2.0 / 2.0 ms |
| Age61 advance / view | 0.9 / 0.6 ms | 0.7 / 0.0 ms on first observation |
| Age61 outside advance/view | 34.0 ms | 1.9 ms on first observation |
| Age61 `getProgramInfoLog` | **30.0 ms** | No call |
| Owner native page upload | 4.8 ms at age1 | No upload |
| Missing submitted/visible active owner presentations | 0 of 330 | 0 of 340 |

The first query interval is page time **5478.4→5508.4 ms**, inside host callback
**5473.7→5509.2 ms**. Other new shader calls are short; uniform/attribute lookup
calls do not account for that interval. First shooting allocates new program,
shader, geometry and texture resources. Thus the owner sheet uploaded at age1
and the renderer's first shooting shader use are separate measured costs.

A separate first-run age63→66 observer gap is **49.8 ms**, with a 41.7 ms RAF
timestamp gap; surrounding host callbacks take 1.9 and 4.7 ms. The CPU/query
finding does not explain all outside-callback scheduling. Neither activation
records a long task above the browser's threshold in this profiled pair. Both
complete naturally at age143 without page errors, match faults, context loss or
owner texture deletion. Native owner texture ID28 is reused by the second.

The same Link + DK + Pikachu fixture, saved keyboard binding, flat stage and
placement/resource setup are used. Before both activations position, velocity,
facing and damage are asserted identical. The same match clock, AI/RNG history,
transient effects and caches persist; this is a bounded warm control, not a
byte-identical whole-state replay. Display cadence samples include multiple
observations per 60 Hz simulation tick, so observation count is not tick count.
No human feel, ordinary Edge-profile behavior, screenshot pixel quality or
unknown original freeze trigger is qualified by this probe.

No screenshots, readback, forced draw, manual stepping or evaluation polling
occur during either observation. `Profiler.start` precedes each observation and
`Profiler.stop` follows it. CPU sampling interval is requested at 1000 µs; actual
sample spacing varies. Broad GL wrappers include info-log/status/uniform/
attribute operations and retain calls >=5 ms with exact page-side intervals.
`finish`/`flush`/`readPixels` are instrumented if called by the application, never
invoked by the harness. Passive instrumentation and sampling add overhead.

Artifacts:

- [report.json](report.json): exact per-frame page/RAF/host/phase/GL/render observations.
- [activation-1.cpuprofile](activation-1.cpuprofile) and
  [activation-2.cpuprofile](activation-2.cpuprofile): native DevTools CPU profiles.
- [profile-analysis.json](profile-analysis.json): sampled stacks in the age61
  host/query windows. Sample timestamps are `profile.startTime + cumulative
  timeDeltas`; page windows are aligned using CDP `NavigationStart` from the
  saved `Performance.getMetrics` clock metadata. Counts are samples, not exact
  milliseconds.
- [harness-at-run.mjs](harness-at-run.mjs): exact source snapshot with SHA256
  `0be67175bb3d3fd3f681f1d4d7ed4881875692372eef4c78f3923c8030741c80`.
  Run the maintained tool from the repository root; this archived snapshot's
  relative imports are not adjusted.

The bridge owner held `.tmp/dk-heavy.lock` throughout the coordinated fresh
launch/attached run. The harness created/closed only its own context, then
CDP disconnected; the bridge stopped its owned Edge process and confirmed
`profileRemoved=true` before releasing the lock. Its separate bridge evidence
retains exact process launch/cleanup receipts.

```sh
node tools/link-final-repeat-raf-acceptance.mjs \
  --cdp '<owned bridge WebSocket endpoint>' --cpu-profile \
  --out docs/review/2026-10-15/user-bugs/final/edge-link-first-profile
```
