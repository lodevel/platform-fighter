# Hardware first Link Final comparison

Exact production `game-B95Fcp5p.js`, identity `74c2fec9…`. The actual game
context reports **ANGLE / D3D12 / NVIDIA GeForce RTX 4070 Laptop GPU**, with
maximum texture size 16384. D3D12 + NVIDIA is asserted; software renderer
names fail qualification. The process-local launch is retained in the report.

The Link + DK + Pikachu fixture activates the real first Final using the
saved DOM special key after explicit resource/placement setup. The 13.33 MB
owner page is not GPU prepared beforehand. There is no pre-draw, screenshot,
poll or manual stepping during the 120-tick natural RAF interval.

All 109 active owner observations contain the actual submitted native Final
frame, alpha 1, with zero missing art, page errors or match faults.

| Measurement | Hardware median / p95 / maximum | Software median / p95 / maximum |
| --- | --- | --- |
| Observer wall gap | 16.4 / 23.4 / 861.7 ms | 82.9 / 254 / 619.5 ms |
| Host RAF callback | 4.5 / 8.4 / 29.3 ms | 9.3 / 25 / 372.8 ms |
| Fixed simulation tick | 1.1 / 2.4 / 7.9 ms | 1 / 2.6 / 13 ms |
| View construction | 0.2 / 0.5 / 1.4 ms | 0.3 / 0.7 / 1 ms |

The first actual owner texture upload takes 6.7 ms; its entire host callback
takes 22.5 ms. At shooting, age 61, the host callback takes 29.3 ms rather
than the software run's 372.8 ms outlier. These results disqualify forced
SwiftShader timings as the user's hardware frame-rate estimate.

**A cold-start scheduling outlier remains:** between ages 3 and 9 there is
an 861.7 ms actual observer gap, while the next host callback takes only
12 ms, including 8 ms in simulation advance and 0.3 ms in view construction.
The measurement does not identify the outside-JavaScript GPU/compositor/
driver scheduling cause, so this is not a claim of universally smooth Final
startup. No simulation/history bottleneck or permanent freeze occurs in
this interval. No gameplay speed or shader was changed to suppress the result.
