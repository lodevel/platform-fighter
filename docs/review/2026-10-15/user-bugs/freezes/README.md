# Match freeze investigation

The original user freeze has no captured browser stack, so its exact trigger
remains unknown. The investigation found three concrete failure paths and
added bounded diagnostics for the next occurrence.

- The original shell requested its next animation frame after all callbacks.
  A single thrown update therefore permanently stopped the application. A
  controlled one-off `sim.view()` exception reproduced this on production
  `game-BYOl1XlT.js`: frame 15000 remained unchanged for two seconds. The new
  loop schedules first, suspends the affected match, retains its stack and
  build/frame context, and offers Restart match / Return to menu.
- A rejected image fetch/decode left `ready=false` permanently. Loading
  failures now use the same recovery UI, and an explicit new preload retries
  a failed texture instead of retaining a rejected promise forever.
- Disconnect handling could claim an existing manual pause and resume it on
  reconnect. It now owns only the pause it created. Reconnecting the same
  physical controller at a new browser index updates the live assignment.

Actual WebGL context loss is handled separately: the match stops, the browser
can restore its context, and Restart creates a fresh match without continuing
a partly completed tick. The shell retains the latest 20 fault records at
`window.__menu.faults`; `window.__sim.fault` includes the match frame and source
identity. Texture/GPU diagnostics are available through
`window.__sim.renderDiagnostics()`.

The live host does not serialize world evidence or compute canonical hashes
each frame. Input recording appends once per tick. A 15000-frame production
stress run with four real CPUs, high-frequency items and 16 Final activations
found no natural exception, unbounded body count or growing projectile loop.
Its final 300-frame batch took 947 ms; these accelerated headless timings are
diagnostic measurements, not a user-hardware frame-rate guarantee. The only
page error in `baseline.json` is the subsequent deliberate exception.

The renderer investigation also found roughly 2 GiB of decoded RGBA for a
DK/Pikachu pair before bitmap/GPU duplication. Lossless atlas packing and
obsolete-roster texture disposal are tracked by the renderer owner. Memory
pressure is a plausible contributor; this is not proof that it caused the
reported freeze.

## Verification

- `baseline.json`: original production stress and deliberately severed RAF.
- `recovery/report.json`: preliminary development-host actual reconnect,
  manual pause, one-off frame exception, Restart, and real
  `WEBGL_lose_context` loss/restoration. No unhandled page errors. This
  preliminary receipt predates the additional image-failure case and the
  final packed production candidate.
- `original-layout-dev/report.json`: all eight recovery checks passed on the
  restored original Pikachu grid layout, including an actual one-shot PNG
  fetch failure and successful retry, and cleanup-error menu recovery. Zero
  unhandled page errors; 1072899456 decoded RGBA bytes, 35659776 bytes warmed
  during loading (below the 64 MiB cap). This remains a development receipt.
- `packed-pikachu-dev/report.json`: interrupted by the coordinating agent's
  asset-policy hold before gameplay. Its closed-page failure is operational
  interruption evidence, not an application freeze or acceptance result.
- `tools/match-freeze-acceptance.mjs`: maintained browser regression, including
  a one-shot real PNG request abort and successful retry after Restart.
- `tools/match-freeze-stress.mjs`: maintained 15000-frame actual browser
  gameplay stress, plus ordinary RAF progression before and after it.
- Focused source checks: 57 tests across MatchSim entry/history, actual Inferno
  flash/history/flight expiry, reconnect, pause ownership and RAF isolation;
  strict TypeScript/layer checks passed.

Final production receipts will be added after the packed assets and other
user-bug fixes are consolidated by the coordinating agent.
