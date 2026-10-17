# Texture density and GPU compression probe

2026-10-16. Phase 1 evidence for the [character system roadmap](../../../CHARACTER-SYSTEM-ROADMAP.md),
requested by the user. Probe only: no production module, asset, build input or
setting changed.

## Resolution: downscaling is not a meaningful lever

From installed metadata and the camera/renderer code (not a browser measurement):

- Every ordinary DK, Link and Pikachu clip has `scaleToWorld` 0.4667, i.e. 2.14
  texels per design px. DK's larger sheets come from a larger on-screen body, not
  higher density. DK Final clips are 0.341 (2.93 texels/px), Pikachu Final display
  pages 0.233 (4.29).
- The match camera's closest zoom is 1.4 (`MATCH_CAMERA_OPTIONS.maxZoom`), also the
  Final anchor zoom. The renderer caps DPR at 2; a 1920-wide drawing buffer gives
  1.4 screen px per design px at that zoom.
- Packing is tight: drawn pixels fill 85% (DK), 89% (Link), 82% (Pikachu) of atlases.

Projected RGBA8 totals with a per-action zoom policy (normal 1.4, Final 2× that),
never upscaling:

| Drawing buffer, headroom | DK | Link | Pikachu |
| --- | ---: | ---: | ---: |
| Current | 682 MiB | 257 MiB | 195 MiB |
| 1920, 1.0 | 434 | 123 | 86 |
| 1920, 1.25 | 551 | 180 | 132 |
| 2560 or wider | no gain | no gain | no gain |

Decision (user, 2026-10-16): downscaling, on-demand Final loading and general
lazy loading change when pixels are resident, not how many there are; they are
not pursued as the memory answer. A per-action zoom-class cap remains a useful
policy for future cinematic cameras (only the Final Smash is expected to zoom).

## GPU compression probe (KTX2 / UASTC)

Encoder: basis_universal v1_60 (`323239a`), `-ktx2 -uastc -uastc_level 2
-ktx2_zstandard_level 6 -linear`, no mipmaps, no RDO. Sheets are padded to
multiples of 4, flipped and premultiplied offline to match the game's PNG upload
([`tools/encode-compressed-sheets.py`](../../../../tools/encode-compressed-sheets.py)). Runtime:
three.js r170 `KTX2Loader` and its bundled transcoder.

[`tools/texture-compression-probe.mjs`](../../../../tools/texture-compression-probe.mjs)
loads [the probe page](../../../../port/src/entries/textureCompressionProbe.ts) on
the Vite dev server. For every drawing of each sheet and all 8 costumes, the
production `StagePresenter`/`SpriteLayer` renders it on the flat stage at the given
camera zoom, first with the game's PNG texture, then with the transcoded texture
swapped into the same resident sheet. A second PNG render is the noise control.

Hardware run ([report.json](report.json)): disposable Windows Edge 155 on
`ANGLE (Intel Iris Xe Direct3D11)`, 1920×1080 buffer, DPR 1. Exposed formats:
BPTC, RGTC, S3TC (+sRGB); no ASTC/ETC. The transcoder selected **BC7**. Control
renders differed by at most 2/255. The page logged one unidentified 404
resource error; every sheet, KTX2 file and transcoder load the probe needed
succeeded.

| Sheet, zoom | Drawings × costumes | Memory RGBA8 → BC7 | Transcode | Default costume >32/255 | Worst other costume >32/255 |
| --- | ---: | --- | ---: | ---: | ---: |
| DK forward smash, 1.4 | 96 | 4.1 → 1.0 MiB | 102 ms | 0.015% | 0.742% |
| DK Final attack, 1.4 | 592 | 70.8 → 17.7 MiB | 147 ms | 0.000% | 0.093% |
| DK Final attack, 2.8 | 592 | 70.8 → 17.7 MiB | 283 ms | 0.000% | 0.095% |
| Link forward smash, 1.4 | 88 | 1.8 → 0.4 MiB | 22 ms | 0.025% | 0.229% |
| Link idle, 1.4 | 88 | 1.4 → 0.3 MiB | 39 ms | 0.032% | 0.288% |
| Pikachu idle, 1.4 | 40 | 0.4 → 0.1 MiB | 10 ms | 0.026% | 0.523% |

Percentages are shares of the screen pixels around each drawing whose largest
RGB channel difference exceeds 32/255. The default costume's maximum channel
difference is 37–71. Alternative costumes reach 230 on isolated pixels: the
recolour shader selects HSV regions by tolerance, so a compressed outline texel
can fall on the other side of a region boundary. Worst-case crops (PNG,
compressed, difference ×8) are retained beside this file; at 4× they show
single outline pixels changing between costume and outline colour, in places
where the PNG render already shows the same costume fringe. A headless
SwiftShader run selected ASTC 4×4 and produced equivalent figures.

## Decision

The user reviewed the worst-case comparisons on 2026-10-16 and accepted the
quality, including the recoloured-costume outline differences. Compression may
become a player-facing texture-quality option in a future game-options menu, so
an integration keeps the PNG path selectable rather than replacing it.

## Remaining gaps

- No full-character load: total transcode time, worker scheduling and match-start
  latency for all 216 DK sheets are unmeasured. Single-sheet transcode times here
  include first-use worker start-up.
- Memory figures are payload sizes (`mipmaps[0].data`), not measured process/GPU
  usage. The production store also keeps decoded `ImageBitmap`s; a compressed path
  would hold the compressed payload instead, unverified.
- Only BC7 (hardware) and ASTC (software) were exercised. Safari/Apple, Android
  and the RGBA8 fallback path are untested.
- Costume fringe was accepted from these captures, not from live play; a
  region-mask approach would remove the tolerance sensitivity but belongs to the
  display-system work.
- Not integrated: no production loader, manifest format, build step or
  context-loss handling for compressed textures.
