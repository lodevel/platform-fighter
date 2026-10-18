# Phase 3 exploration: keyframe + changes

2026-10-18. Question: can a drawing be stored as "an earlier drawing, plus only
what changed"? Two forms were tried on all three fighters, starting from the
approved `<id>~holds-0.12` packages:

1. **Patch reuse.** Cut each drawing into square tiles on a grid fixed to the
   root. A tile is copied from an earlier drawing (same place, or shifted by a
   few pixels) when it matches within a tolerance. Only the tiles that match
   nothing are stored.
2. **Warp reuse.** Bend a keyframe with a coarse mesh to look like the next
   drawing. Store tiles only where the bent keyframe is still wrong.

Read-only experiment. Nothing in `src/`, `port/` or `character/` changed.
Scripts are in [scripts/](scripts/). Numbers are in [results.json](results.json).

**Verdict: not the smart technique.** On today's art, patch reuse stores 10–25% less
than tile storage alone. That is about the size of the holds saving: real, but
nowhere near an order of magnitude. Warp reuse explains more per pair, but it
breaks on occlusion and blurs outlines, and it still leaves every outline to
store. Both techniques rely on pixels repeating between drawings, and
independently generated drawings don't repeat pixels. The lever is upstream:
the pipeline would have to *author* the reuse (shared parts, masked
regeneration), and at that point it is the parts option, not this one.

## Method

- **Grid.** Tiles of T source px (T = 8, 16, 32) on a grid fixed to the root.
  Each action is placed on one shared canvas, so "same place" means the same
  position relative to the root.
- **References.** For drawing N in an action: the last 3 drawings plus the
  3 most similar earlier drawings (coarse signature). The references are
  *reconstructed* drawings, so errors cannot pile up unchecked: every tile is
  checked against N's real pixels. The "cross" runs also offer the 3 most similar
  drawings from earlier actions.
- **Search.** Offsets within ±S px (S = 0, 4). Offset (0,0) is preferred, then the
  smallest error.
- **Tolerance** per tile. The per-pixel error is the largest channel difference of
  premultiplied RGBA. It is judged over the pixels either drawing covers, on a
  scale of /255:

  | Name | Mean ≤ | Max ≤ |
  | --- | ---: | ---: |
  | exact | 0.5 | 1.5 |
  | tight | 2 | 16 |
  | medium | 4 | 48 |
  | loose | 8 | 96 |

- **Visual error at match size.** Both versions are composited on grey and
  area-scaled to match pixels: source px × 0.467 × zoom, where zoom is 1.4 for
  normal moves and 2.8 for Finals. The table below reports the share of character
  pixels off by more than 8/255.
- **Storage.** "Stored" counts the new tiles. "With gutters" stores each
  horizontal run of new tiles with a 2 px border, aligned to 4. Without that
  border, filtering bleeds across tiles. The baseline is the same tile storage
  without reuse, which is the "next candidate" in the Phase 3 README.

## 1. Patch reuse: results

Each cell gives stored area as a share of the drawings' non-empty tiles, then as
a share of today's rectangles.

| Run (T=16 unless noted) | DK | Link | Pikachu |
| --- | --- | --- | --- |
| Tiles only, no reuse (baseline) | 1.00 / 0.69 | 1.00 / 0.62 | 1.00 / 0.69 |
| S=0, tight | – | – | 0.93 / 0.64 |
| S=4, exact | 0.90 / 0.62 | 0.98 / 0.60 | – |
| S=4, tight | 0.80 / 0.56 | – | 0.89 / 0.61 |
| S=0, medium | 0.79 / 0.55 | – | – |
| **S=4, medium** | **0.75 / 0.52** | **0.90 / 0.56** | **0.84 / 0.58** |
| S=4, loose | 0.67 / 0.47 | – | – |
| S=0, loose | – | – | 0.86 / 0.59 |
| S=0, tight, + cross-action refs | – | – | 0.88 / 0.61 (vs 0.93) |
| T=8, S=4, medium | 0.60 / 0.38 | – | – |
| T=32, S=4, medium | 0.86 / 0.71 | – | – |

With gutters, against today's rectangles:

| | DK | Link | Pikachu |
| --- | ---: | ---: | ---: |
| Tiles only, T=16 | 0.89 | 0.81 | 0.90 |
| Tiles + patch reuse, T=16 S=4 medium | 0.68 | 0.73 | 0.77 |
| Tiles only, T=8 | 0.96 | 0.80 | 0.91 |
| Tiles + patch reuse, T=8 S=4 medium | 0.62 | – | – |

Small tiles find more reuse, but their borders eat the gain. At T=8 the
stored area falls to 0.38, yet with gutters it is still 0.62.

**Finals vs other moves** (S=4 medium, stored share of non-empty tiles):
DK 0.61 / 0.80, Link 0.91 / 0.90. DK's Finals contain exactly repeated
regions: even the exact tolerance stores only 0.71 of them. Pikachu's
`final2` stores 0.76 and DK's `final_start` 0.76. DK idle reaches 0.66. Jabs and
runs barely reuse anything (DK jab 0.84, Link jab 0.95).

**Quality.** Shares of character pixels off by more than 8/255 at match size,
mean over drawings, with the worst single drawing in brackets:

| Run | DK other | DK Finals | Link other | Link Finals | Pikachu other | Pikachu Finals |
| --- | --- | --- | --- | --- | --- | --- |
| S=4 tight | 0.000% (0.06%) | 0.22% (0.51%) | – | – | 0.002% (0.21%) | 0% |
| S=4 medium | 0.09% (1.1%) | 0.92% (1.9%) | 0.06% (1.2%) | 0.06% (0.24%) | 0.05% (1.2%) | 0.56% (1.6%) |
| S=4 loose | 0.95% (5.6%) | 2.8% (5.3%) | – | – | – | – |

At "medium", the errors are small seams and shifts along outlines; the
images below show them. At "loose", up to 5% of a drawing's pixels are visibly
off, so medium is the practical ceiling.

The DK and Link figures come from full runs; the Pikachu figures were read
from console output (listed separately in `results.json`). The coordinator stopped
the grid to free the GPU, so the empty cells were not run. They are not
extrapolated, except for this: the T and S trends measured on DK should hold for
the others, with smaller gains, because Link and Pikachu reuse less at every
point measured.

Images at match size. Columns: original | reconstruction | error ×4 | tile map
(red = new tile, blue tint = copied).

- [DK jab](patch-donkeykong-jab-T16-S4-medium.png): almost every tile is new; the
  whole body moves.
- [DK Final start](patch-donkeykong-final_start-T16-S4-medium.png)
- [Pikachu final2](patch-pikachu-final2-T16-S4-medium.png): flat interiors are
  copied, and every outline tile is new.
- [Link Final](patch-link-d04final-T16-S4-medium.png)

## 2. Warp reuse: prototype

The mesh is a grid of 16 px cells with a displacement at each vertex, applied
as a backward warp and interpolated linearly, which is what a textured
triangle mesh draws. It is fitted by gradient descent on premultiplied RGBA
from coarse blur to fine, starting from the best translation. Smoothness is
regularised. Tiles where the warped keyframe fails the tolerance become
residual tiles. "match" judges the tolerance on match-size pixels (mean ≤ 4,
max ≤ 40 per tile).

Single pairs (16 px tiles accepted out of the non-empty ones):

| Pair | Tiles | Plain copy, medium | Warp, medium | Plain copy, match | Warp, match |
| --- | ---: | ---: | ---: | ---: | ---: |
| Link idle 0→1 | 99 | 20 | 32 | 33 | **72** |
| DK jab 0→1 | 212 | 17 | 34 | 19 | 45 |
| DK jab 1→2 | 182 | 26 | 47 | 24 | 85 |
| DK Final start 10→11 | 495 | 39 | 75 | 44 | 100 |
| Link Final 10→11 | 121 | 13 | 14 | 13 | 57 |
| Pikachu final2 10→11 | 353 | 74 | 159 | 71 | **193** |

Whole-action runs (CPU, shortened after the GPU was released). A drawing became
a new keyframe when the warp explained less than half its tiles:

| Action | Drawings | Keyframes | Warp explains | Plain copy would | Stored |
| --- | ---: | ---: | ---: | ---: | ---: |
| DK jab | 6 | 6 | 0% | 0% | 100% |
| Pikachu final2 (first 12) | 12 | 8 | 23% | 7% | 77% |

What the warp does:
- **It works on smooth motion of rigid shapes.** On Pikachu's Final and Link's
  breathing, a gentle bend lines up most fills
  ([Pikachu pair](warp-pair-pikachu-final2-source-px.png),
  [Link idle pair](warp-pair-link-idle-source-px.png)). It roughly triples what a
  plain copy explains.
- **It fails at outlines.** Even after a good fit, the 1–2 px dark outlines are off
  by a pixel, so every outline tile stays residual
  ([Pikachu action](warp-pikachu-final2.png); the tile map is the last column).
- **It fails at occlusion.** When DK's fist crosses his face, the fit smears the
  face and tie to lower the error
  ([DK jab pair](warp-pair-donkeykong-jab-source-px.png), third panel). Residual
  tiles hide this in the reconstruction, but a looser tolerance would show it.
- **It softens detail.** Bilinear resampling blurs line art slightly, and the blur
  accumulates if warps are chained.

## 3. Render cost, recolour and format

| | Today | Patch, T=16 | Patch, T=8 | Patch, T=32 | Warp mesh, 16 px |
| --- | --- | --- | --- | --- | --- |
| Quads per drawing | 1 | DK 350, Link 94, Pikachu 117 | DK 1,508 | DK 83 | ~1,300 vertices (~2,600 triangles) plus residual quads |
| Draws | 1 | 1 instanced draw per fighter | same | same | 1 mesh draw + 1 instanced draw |

- **GPU cost is no problem.** A few hundred quads per fighter is tiny. The real
  costs are elsewhere:
  - **Seams.** At Final zoom the art is magnified (1.31 match px per source px).
    Every tile edge then needs a gutter and pixel-snapped placement, or seams
    flicker.
  - **Blend order.** Copied tiles must not overlap, or premultiplied blending
    doubles the edges.
- **Recolour is compatible.** A copied tile holds the same texels, so
  `character/render/recolor.ts` gives the same result per texel. A warp
  resamples premultiplied texels before recolouring. That is the same situation as
  today's game, which recolours after scaling (the lab recolours before).
- **Format.** `Drawing` would need an alternative to its single `rect`, roughly:
  - `pieces: [{ page, src: [x, y, w, h], at: [dx, dy] }]` relative to the
    anchor (patch reuse);
  - `mesh: { key: DrawingId, cell: number, vertices: [dx, dy][] }` plus
    `pieces` for the residual tiles (warp).

  The validator would check that pieces stay inside their page and don't
  overlap. Mesh data is small: about 1,300 vertices × 8 bytes ≈ 10 KB per drawing.
  The lab and game renderers would need a multi-quad and a mesh draw path.

## Verdict

| | Patch reuse (T=16, ±4 px, medium) | Warp reuse |
| --- | --- | --- |
| Memory vs tile storage alone | ×0.75 DK, ×0.84 Pikachu, ×0.90 Link (with gutters ×0.77 / ×0.86 / ×0.90) | Finals only, roughly ×0.75–0.8 on the smooth ones; nothing on punches |
| Memory vs today's rectangles | ×0.52–0.58 (×0.68–0.77 with gutters) | not measured package-wide |
| Rough BC7 total (with gutters, if packing matches today's) | DK ~96 MiB, Link ~49, Pikachu ~33 (from 141 / 67 / 43) | – |
| Quality risk | Low at tight or medium (≤1% of pixels off by >8/255 in Finals, seams on outlines); loose shows tile steps | High: smeared occlusions, softened outlines, wobble in motion |
| Effort | Medium: compiler step, `pieces` format, multi-quad draw, gutters | High: fitting, mesh format and draw path, plus the residual path anyway |
| Fits generated art? | Poorly as an after-the-fact search. Generated frames are redrawn whole, and outlines, shading bands and noise move every frame | Poorly. Generated frames don't share geometry precisely enough |

Most of the gain is already captured by tile storage, which needs no
matching at all. On top of it, patch reuse adds 10–25%. That is worth having
only if the compiler gets a `pieces` path anyway for tiles, and then the
copy search is a cheap extra.

For pipeline art, reuse must be authored, not discovered:
- masked regeneration that keeps unchanged regions pixel-identical (it then
  dedups exactly and costs nothing in quality);
- better still, shared parts with transforms.

That moves the saving into the parts/hybrid option. Keyframe + changes is not
the order-of-magnitude answer.
