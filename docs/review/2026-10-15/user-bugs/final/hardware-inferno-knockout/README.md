# Hardware Inferno flight comparison

Exact production `game-B95Fcp5p.js`, identity `74c2fec9…`. The actual game
context reports **ANGLE / D3D12 / NVIDIA GeForce RTX 4070 Laptop GPU**, maximum
texture size 16384. The tool asserts D3D12 + NVIDIA and rejects software
renderer names before qualifying. Only the child Chromium process uses the
documented Mesa D3D12 environment/ANGLE EGL launch; application code, drivers
and persistent settings are unchanged.

The same capture-free real-hazard fixture used in the software control
passes: all three victims have 25 actual native trimmed quads submitted
inside the viewport, zero missing quads, and 23 observations each at least
4×4 pixels. None exits the viewport during its lease. Stocks change exactly
`[3,3,3,3]` → `[2,2,2,3]`, with the croucher spared. Zero page errors/faults.

Flight visibility lasts **1580.5 ms**, compared with 7970.8 ms on forced
SwiftShader. Active-flight observer gaps have median 64.4 ms, p95 102.2 ms,
maximum 148 ms. The largest overall gap, 362.3 ms, occurs on the first
accepted flash drawing before that active-flight interval. This establishes
multiple visible wall-clock flight samples and a substantial software-GPU
confound; it does not establish smooth 60 FPS Inferno rendering or explain
every first-use stall.

The run performs no screenshots, polling, forced draws or subsequent page
evaluations during the natural RAF interval. Full launch configuration,
actual context identity, timestamps and projected pixel bounds are in
`report.json`. The older software and screenshot-contaminated receipts
remain separate.
