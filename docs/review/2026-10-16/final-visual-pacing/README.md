# Final animation playback and first-use pacing

**PASS for the observed device and fixtures.** The [compact qualification](qualification.json) retains build/tool/report hashes, input setup, measured intervals, resource counts, drawing digests and independent Link visual review. Reviewed raw traces have been removed after bounded cleanup; the live rerunnable tool remains `tools/final-visual-pacing-acceptance.mjs`.

The check opens a fresh real Windows Edge context per fighter. Pikachu hits a nearby DK; Link fires past a DK placed behind him. Each context runs the first Final and a repeat in the same match. Positions and Final resources are explicit setup fixtures; activation uses the saved DOM special-key binding. Normal RAF runs until the Final and projectile finish, followed by 60 fixed steps. The observer takes no screenshots, manual steps, redraws or host-process polls during playback and does not wrap simulation methods.

First use follows actual loading policy; resources are neither forcibly evicted nor prewarmed by a manual Final. Passive WebGL counters and per-RAF state reads add measurement overhead. These bounded observations do not establish universal performance, physical-controller feel, source timing parity, or GPU-driver compilation time.

## Exact builds and device

- Before: `game-BNZfv5Ng.js`, SHA-256 `66e3ae1472f058ad804b560ddfc6cd39c6a65bd971b81b8106ebfc88e303fc16`; source `platform-fighter-sha256-0067e47aa8dad11d9fe4e4501c5db226e6d40d5f9dc5ab70e8693fbb2a1bd191`.
- After: `game-_LoddHLw.js`, SHA-256 `45fcc17418246d97d688ec005ee47a72e13142af7f04c58bb4983076c93ab58d`; source `platform-fighter-sha256-e236b17191fa7db98aa7d508f28193b773b06ffa7632a37ea0ea5570b51cd1d9`.
- Windows Edge 155.0.4283.45; Intel Iris Xe (`0x0000A7A0`) through ANGLE/D3D11; parallel shader compilation available; viewport 1280 × 800, DPR 1. Owned Edge profiles removed after both runs.

## Measured playback

| Run | RAF p95 before → after | Largest RAF interval before → after | Texture uploads before → after |
| --- | ---: | ---: | ---: |
| Pikachu first | 13.9 → 14.0 ms | 41.6 → 41.6 ms | 12 → 14 |
| Pikachu repeat | 13.9 → 13.9 ms | 14.2 → 20.8 ms | 0 → 0 |
| Link first | 14.0 → 13.9 ms | 34.7 → 34.7 ms | 2 → 2 |
| Link repeat | 13.9 → 13.9 ms | 14.1 → 14.4 ms | 0 → 0 |

All eight observations have zero intervals over 50 ms, zero observed long tasks, zero action-time `compileShader`/`linkProgram` calls, and no missing owner drawings or runtime faults. Upload counts are `texSubImage2D` calls; first use creates the matching texture objects. Warm repeats add no textures or uploads.

Pikachu's preloaded decoded-RGBA estimate grows from 920,945,792 to 1,013,517,632 bytes (+92,571,840 bytes) for the denser bank. This is an estimate from image dimensions, not measured physical GPU memory. Decoded bytes/resident banks stay constant during every activation. First-use renderer textures rise from 14 to 26 before, and 15 to 29 after; the repeat stays at those totals. Link remains 1,011,946,048 decoded bytes and rises from 13 to 15 renderer textures on first use, then stays stable. Geometry count rises from 108 to 109 on first use in all four contexts and is stable on repeats.

Pikachu's distinct submitted owner drawings rise from 76/77 to 157/158 across first/repeat observations. Both builds capture one rival, deal 62.37% damage and complete in 350 active fixed ticks. Link misses and completes in 143 active fixed ticks in both builds. This natural-RAF sample supplements the [per-tick Pikachu density and authority checks](../pikachu-final-density/README.md).

Independent review of Link charge age 55 and projectile age 61, both facings and airborne, accepts the loaded-arrow alignment, bright charge and visible travel strip. The [Link record](../link-final-visuals/README.md) supplies deterministic authority and visual coverage. Screenshot FPS labels were not used as pacing measurements.

## Re-run

Generate a fresh report against each retained build, then compare the second to the first:

```sh
flock .tmp/dk-heavy.lock node tools/final-visual-pacing-acceptance.mjs \
  --url http://127.0.0.1:4173/platform-fighter/ --out .tmp/final-pacing-before
# Serve the candidate build at the same URL before the next command.
flock .tmp/dk-heavy.lock node tools/final-visual-pacing-acceptance.mjs \
  --url http://127.0.0.1:4173/platform-fighter/ --out .tmp/final-pacing-after \
  --compare .tmp/final-pacing-before/report.json
```

Cleanup completed after exact path/hash review: 2 generated files (2,817,928 bytes) removed from this evidence directory. The compact qualification and live rerunnable tool are retained.
