# Inferno head in standalone builds

The existing head image was loaded from a local private route and was absent from a fresh checkout's standalone build. It is now a manifest-listed runtime asset at `assets/stages/inferno-head.png`, copied to `dist/stages/inferno-head.png`. The theme resolves its URL beneath the configured application base. The image is unchanged: SHA-256 `d3b36e7ddabf88738c28f9b845c38f64419bab9f1b501be7e249ca02110f5540`, 798,404 bytes, 1024 × 1024 RGBA. The local private copy is preserved.

The acceptance harness serves only files physically present beneath the selected `dist` folder using Node's HTTP server. It has no Vite middleware, source asset route, private image route, response interception, or renderer replacement. It checks that both former private paths return 404, and that the real Inferno theme requests the shipped PNG as an image with HTTP 200, `image/png`, and the exact source hash.

The match then advances genuine fixed ticks to frame 1499 (dormant), 1620 (rising), 1740 and 1840 (glare). Screenshots at each point establish whether the actual image is visibly used after rising. The hazard clock and theme are unmodified. This qualification covers shipping and rendering the image; it does not repeat a full hazard gameplay audit.

```sh
flock .tmp/dk-heavy.lock node tools/inferno-shipped-head-acceptance.mjs \
  --dist dist --port 4194 \
  --out docs/review/2026-10-16/inferno-shipped-head/after
```

**PASS:** [compact standalone qualification](qualification.json), real Windows Edge with Intel Iris Xe/D3D11. The retained `.tmp/game-bugs-base-fps-dist` build serves `game-BNZfv5Ng.js`, SHA-256 `66e3ae1472f058ad804b560ddfc6cd39c6a65bd971b81b8106ebfc88e303fc16`. Both private paths return 404. The real texture request returns the exact 798,404-byte shipped image with `image/png`, resource type `image`, and HTTP 200. No page errors, network failures, or match faults occur; the owned browser profile and static server are cleaned up.

Visual review confirms the actual photographic head behind the arena after rising: glare begins at frame 1740 and glowing eyes are visible at frame 1840. The clean frame 1740 capture was the primary image-shipping evidence. Accepted image hashes and observations remain in the compact qualification after capture cleanup.

## Persistent FPS counter

The noninteractive top-left counter is readable on the title screen and in the match. It samples successful RAF render calls across a rolling second, publishes at most four times per second, and resets on visibility changes. It does not count fixed simulation steps or explicit probe redraws.

The independent observer ran 2,201.2 ms of ordinary RAF match playback, observing 138 RAF callbacks while simulation advanced 132 fixed steps. After warmup, the four changed displayed readings—62, 61, 64, and 65 FPS—each exactly matched the independent callback count for that second. This checks counter accuracy for the observed cadence, not a performance guarantee. Values shown during startup and manually stepped screenshots are not used as performance benchmarks.

Eight focused sampler/frame-loop checks pass (receipt hash in the compact qualification), covering 30/60/120 FPS, slower rendering, update throttling, visible stalls, hidden-tab resets, and invalid or duplicate timestamps.

The qualification preserves simulation identity `platform-fighter-sha256-0067e47aa8dad11d9fe4e4501c5db226e6d40d5f9dc5ab70e8693fbb2a1bd191`, exact device identifiers, network receipts and screenshot hashes. Reviewed captures and copied logs have been removed after bounded cleanup; the live acceptance tool and shipped asset remain.

Cleanup completed after exact path/hash review: 7 generated files (3,468,931 bytes) removed from this evidence directory. The compact qualification and live rerunnable tool are retained.
