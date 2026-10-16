# Windows Edge default-hardware Link Final repeat baseline

A fresh disposable **Windows Edge 155.0.4283.45** process, attached through the
owned loopback CDP bridge, selects **Intel Iris Xe / D3D11** by default. No GPU
preference or adapter override is supplied. The actual game context is
`ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x0000A7A0) Direct3D11 vs_5_0 ps_5_0,
D3D11)`, maximum texture size 16384, with no context loss. The Windows user agent
contains `Edg/155.0.0.0`; this is a headless diagnostic Edge process with a fresh
profile, rather than the user's ordinary open Edge profile/window.

The production bundle remains `game-B95Fcp5p.js`, build identity
`platform-fighter-sha256-74c2fec99c76cdc7942171c69ff8c02f7c207d50263dffea93787a7d94040101`.
Application/build/assets are unchanged. The harness SHA256 at this run is
`6cefb0520f18a7ac1d524ee931f5f2bdaf9d95446283059bfb2430369bebf1ab` and is retained
in [report.json](report.json), together with exact browser version/user agent.

| Startup through age 120 | First activation | Second activation |
| --- | ---: | ---: |
| Observer wall gap median / p95 / maximum | 9.2 / 12.6 / **119.1 ms** | 9.2 / 11.6 / **19.3 ms** |
| RAF timestamp gap median / p95 / maximum | 7 / 14 / **118.1 ms** | 7 / 14 / **21.0 ms** |
| Host callback median / p95 / maximum | 6.4 / 8.8 / **116.5 ms** | 6.4 / 8.4 / **14.7 ms** |
| Fixed step median / p95 / maximum | 1.6 / 2.8 / 8.8 ms | 1.6 / 2.4 / 3.9 ms |
| Owner page `texSubImage2D` | 8.6 ms at age 1 | No upload |
| Native active owner missing presentations | 0 of 240 | 0 of 251 |
| Observed long tasks | 118 ms at shooting | None |

The large first-use stall here is at **shooting, age 60→61**, not the WSL RTX
age2→8 outside-callback stall. At age61 the host runs 12434.6→12551.1 ms,
116.5 ms total, including 1.5 ms simulation advance and 1.3 ms view construction;
**113.7 ms remains outside those two measured phases**. A passive long-task entry
starts at 12434.6 ms and lasts 118 ms. Owner upload completed around one second
earlier, so simply pre-uploading the owner sheet cannot explain this cost.

That shooting callback also allocates one geometry/texture and records two shader
compiles, one program link and three program-parameter calls (largest 0.7 ms).
Those particular GL calls do not account for the callback duration. Other GL
queries, material preparation, GPU synchronization and first-use CPU work were
not fully instrumented in this baseline. Installed Three's first-use shader route
calls `getProgramInfoLog` and `getShaderInfoLog` before `getProgramParameter`;
these are specific unmeasured candidates, not an established diagnosis. A separate
profile run may test them without rewriting this receipt.

The second activation reuses native owner texture ID28, without owner deletion,
reupload or context loss. Both Finals finish naturally at age143; the second
placement/velocity/facing/damage fixture exactly matches the first. No manual
steps, forced draw, screenshots or evaluation polling occur during observation;
only a page-side promise, natural RAF and passive instrumentation run. The first
fixture manually advances the ready match 240 ticks then resets placement and
steps 10 ticks. Between activations the same match is retained and only the
placement/resource setup is repeated; elapsed match state, AI/RNG history,
transient effects and caches are not byte-identically reset. No freeze occurs
within these two bounded activations; the user's original freeze trigger remains
unidentified. There is no screenshot/pixel-quality or ordinary-profile/human-feel
acceptance claim.

The Windows run follows a different browser, operating-system driver path,
adapter and display cadence from the WSL Chromium RTX control. Its sub-16.7 ms RAF
samples should not be compared as though both runs used identical presentation
conditions. Both controls show a first-use benefit; their stalls have different
measured locations.

The bridge owner held `.tmp/dk-heavy.lock` for this coordinated attached run;
the harness created/closed only its own browser context and disconnected CDP.
The bridge then stopped only its dedicated Edge process and removed its profile.
See the bridge's environment evidence for its exact launch/cleanup receipt. The
harness is [`tools/link-final-repeat-raf-acceptance.mjs`](../../../../../../tools/link-final-repeat-raf-acceptance.mjs)
with `--cdp <owned bridge endpoint> --out docs/review/2026-10-15/user-bugs/final/edge-link-repeat-raf`.
