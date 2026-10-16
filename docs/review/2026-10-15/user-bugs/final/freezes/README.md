# Production freeze recovery and liveness

Candidate: `game-rdv3pg8d.js`, simulation identity
`platform-fighter-sha256-b242558db2524371b13e21af73a9b1032a7f783d9ced183983d1bcb25b5a72f9`.

`recovery/report.json` passes eight actual-browser checks: one-shot real PNG
fetch failure and successful retry after Restart, same-controller reconnect
at a new index, retaining a manual pause, one-off match update error,
Restart without reload, real `WEBGL_lose_context` loss/restoration and
Restart, and menu navigation after a screen cleanup error. Deliberate
injections are recorded separately; there were no unhandled page errors.
The Pikachu pair used 205874112 decoded RGBA bytes and warmed 23379456 bytes
during loading, within the 64 MiB GPU warming budget.

`stress/report.json` passes liveness checks through 15000 accelerated real
CPU/gameplay ticks plus normal animation frames before and after: frame
0→61, then 15061→15126. Four CPUs, high-frequency items and 16 actual Final
activations ran with no fault, lost graphics context or unhandled page
error. Body count remained 12–13 in the recorded final batches and input
history grew once per tick. Texture residency was unchanged at 1209731648
decoded RGBA bytes; loading warmed 59834944 bytes.

This stress result is **not a frame-rate acceptance**. Its 300-tick batches
include 300 presentation updates and 30 GPU draws and deliberately block
the browser while executing. Median batch time was 2581.6 ms, maximum
15715.2 ms near frame 7561. The earlier baseline used only ten GPU draws
per batch, so the two batch totals are not directly comparable. Individual
simulation, view and GPU timings are being investigated separately.

The exact trigger of the user's original freeze remains unknown; the
recovery and memory-pressure fixes close reproduced failure classes and
preserve bounded stack/build/frame diagnostics for a future occurrence.
