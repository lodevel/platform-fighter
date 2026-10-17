# Texture quality option: full-character match measurement

2026-10-16. Milestone requested by the user after accepting the
[compression probe](../texture-compression-probe/README.md): an opt-in compressed
texture quality for every fighter, selectable from a new Options menu, with PNG
("Full quality") as the default.

## What was built

- `tools/encode-compressed-sheets.py` (`npm run assets:compress`): every runtime
  fighter sheet (DK 216, Link 232, Pikachu 216 including its 14 Final display
  pages) padded to multiples of 4, flipped, premultiplied and UASTC-encoded to
  `assets/characters/<id>/compressed/` with an `index.json` (source SHA-256, sizes).
  Incremental; 66 s for all three on 20 jobs. Outputs are git-ignored.
  A manifest cross-check found every `char.*` spritesheet entry listed.
- `src/config/gameSettings.ts`: `platformfighter.settings.v1` with `textureQuality`.
- `TextureStore`: in `compressed`, character sheets load through one `KTX2Loader`
  (worker limit min(cores, 8)) with per-sheet PNG fallback and recorded reasons;
  padded texture size drives UVs. Transcoder workers are disposed after one idle
  second because their WASM heaps stay grown to the largest sheet. Switching
  quality evicts the other quality's character sheets. Menu snapshot renderers
  keep PNG.
- Options screen (title card 03): Texture quality row, keyboard/gamepad/mouse,
  saved immediately, shows detected formats or that the device saves nothing.
- `scripts/copy-runtime-assets.ts` ships compressed banks (when present) and the
  Basis transcoder to `dist/`; dev/preview serve `/basis/`.
- The Link-only pilot builder `port/scripts/build-ktx2.mjs` was removed as
  superseded; its failed texel-gate record is marked superseded, not passed.

## Verification

- `npm run typecheck`, full `npx vitest run` (576 files, 12,189 tests), `npm run build`
  and `npm run assets:copy` passed before the final worker-release change; after it,
  the sprite/fighter checks (53 tests plus the new idle-release check), `tsc` and
  the production build passed again.
- [report.json](report.json) from `tools/texture-quality-match-probe.mjs`: production
  preview, fresh disposable Windows Edge per run on Intel Iris Xe (D3D11),
  1920×1080, DPR 1, DK + Link + Pikachu hard CPUs on Flat, 1,200 manually stepped
  and drawn frames, runs ordered full, compressed, compressed, full.

| Run | Prep | Fighter textures | Edge private | GPU process | Page process | JS heap | Frame mean / p99 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Full | 5.0 s | 1,248 MiB (657 RGBA8) | 2,837 MiB | 751 MiB | 1,874 MiB | 50 MiB | 3.96 / 9.8 ms |
| Compressed | 3.7 s | 313 MiB (657 BC7) | 1,759 MiB | 468 MiB | 1,082 MiB | 371 MiB | 4.24 / 9.2 ms |
| Compressed | 3.9 s | 313 MiB (657 BC7) | 1,701 MiB | 462 MiB | 1,039 MiB | 368 MiB | 4.25 / 8.2 ms |
| Full | 4.6 s | 1,248 MiB (657 RGBA8) | 2,772 MiB | 765 MiB | 1,794 MiB | 51 MiB | 4.40 / 9.5 ms |

Process figures are Windows `Win32_Process.PrivatePageCount` sums for the
disposable profile's Edge processes after play; GPU "shared usage" counters fell
from ~650 to ~337 MiB; dedicated usage reads 0 on this integrated GPU. Before
idle worker release, compressed runs measured 2,036–2,077 MiB private.
Frame times are CPU step+draw, equivalent within run-to-run noise. All runs end
with identical damage (37.19 / 69.74 / 44.1), so gameplay is unchanged by the
setting. Zero fallbacks. Both qualities log the same two console 404s (not
character resources; the response listener saw no failing page request).

The compressed payload stays in the JS heap (~313 MiB) for context-loss
re-upload, as decoded ImageBitmaps (~1.25 GB) do in full quality.

[options-production.json](options-production.json) drives the production build in
Edge: gate → title → Options → Compressed (saved), then a same-page DK vs Pikachu
match loaded 425 character sheets as BC7 with no fallbacks or page errors
([menu](options-production-edge.png), [match](match-compressed-production-edge.png)).

## Open items

- **Deployment (decided 2026-10-17):** the user chose CI encoding over committing
  the ~71 MiB bank. `.github/workflows/deploy.yml` builds basis_universal v1_60
  with `tools/build-basisu.sh` and runs `npm run assets:compress` before
  `assets:copy`, caching the binary and the bank. A local `--force` re-encode
  with a freshly built binary was byte-identical, so cached and fresh banks
  match. Not yet exercised on a GitHub runner.
- Freeing the retained CPU copies after upload (bitmaps in full, payloads in
  compressed) would save a further ~1.2 GB / ~0.3 GB but needs re-fetch on
  context loss; not done.
- Apple/Android (ASTC/ETC2) and the no-compression fallback device path remain
  unmeasured; default stays Full quality.
