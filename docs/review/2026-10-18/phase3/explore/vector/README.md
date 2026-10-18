# Phase 3 option: vector shapes instead of textures

2026-10-18. One of the four options in [Phase 3](../../README.md#next). Question: can the
fighters be drawn as shapes (paths, triangle meshes, distance fields, palette indices)
instead of full-colour textures, and does that save memory at the art's quality?

**Verdict.** Pure vectors do not pay off. Indexed colour does.

| Candidate | Memory vs BC7 | Quality at match size | Effort |
| --- | --- | --- | --- |
| Vector meshes, all drawings on the GPU | **1.2× (DK) to 4.8× (Link) more** | Worse than a half-size raster in 99–100% of drawings | High |
| Vector paths in RAM, meshes built on demand | 0.27× DK, 1.17× Link, 0.20× Pikachu | Same | High, plus 0.4–5.4 ms CPU per new drawing |
| Vector + low-res shading texture | 1.7× | Slightly better than plain vector | High |
| Colour + distance fields at 1/2 res | 0.51× | Like a half-size raster; thin lines break | Medium |
| **Indexed colour, 16 per character, 4 bits** | **0.49×** | **Near-lossless (MAE 0.006–0.015)** | Medium: one shader |
| Indexed 16 at half resolution | 0.125× | Close to a half-size raster (0.029 vs 0.025) | Stacks with the resolution option |

Vectors only look better at zoom 2.8, where they stay sharp. At match size the art's
1–2 px lines and small details become sub-pixel. There, any shift of a traced edge costs
more than it gains. The useful result is **palette-indexed drawings**. They halve memory at
almost no visible cost, and costumes become exact palette swaps. They stack with smaller
drawings, holds and tiles. The generation pipeline would have to emit palette-clean art.

## Setup

- 13 drawings from today's packages: DK `jab/0`, `jab/3`, `idle/0`, `final_attack/3`, `final_attack/40`;
  Link `idle/0`, `jab/2`, spin attack `d02specialhi/1` and `/5`, Final `d04final/30`;
  Pikachu `idle/0`, `jab/4` and a `final2` drawing. Then **every drawing of all three
  packages** (4,802) with the main candidates.
- Shown size: drawing scale × zoom 1.4 (match) and × 2.8 (Final). For the usual scale
  0.467, that is 0.65 and 1.31 screen px per source px. The reference is the original
  drawing, area-filtered down or bilinear up, as the game samples it.
- Error: mean absolute premultiplied-RGBA difference over the pixels either image covers
  (0–1, like `signatureDiff`), and PSNR. As a scale: a raster stored at half size scores 0.025.
- GPU bytes for a mesh: 12 B per vertex (float x, y + RGBA8 colour) + 6 B per triangle
  (uint16 indices). Curves are flattened to 0.25 screen px at zoom 2.8, so one mesh serves
  every zoom. Stored bytes: int16 polygon vertices + small headers. BC7: 1 B/px of the
  drawing rectangle.
- Tools: a Python venv in the scratch folder with `vtracer`, OpenCV, `cairosvg` and
  `potracer`. No system install. Scripts: [scripts/](scripts/).

## 1. Off-the-shelf tracing loses the outlines

`vtracer` (colour, stacked shapes, splines) merges the 1–2 px dark outlines into the
neighbouring fill at every setting that keeps the shape count sane. Only near-pixel tracing
keeps them (11,480 paths, 850 KB SVG for one DK drawing). Left: original. Middle: finest
setting. Right: coarsest ([image](vtracer-drops-outlines.png)).

So I wrote a tracer for this art style ([layered.py](scripts/layered.py)):
- **Line art.** Lines are found with a morphological black-hat, a filter that keeps thin
  dark structures and ignores large dark fills. They go into up to 3 ink layers on top.
- **Fills.** An edge-preserving denoise, then the fewest k-means colours that keep 95% of
  pixels within a tolerance (`fine` 0.05, `medium` 0.09, `coarse` 0.15). Drawings that
  are already posterised, such as DK's Final at 13 colours, keep their exact colours.
- **Stacking.** Layers are stacked largest first, so there are no gaps between regions.
  Contours come from a 4× soft mask and are simplified to the chord tolerance.

## 2. Results on the samples

Medians over the 13 drawings. Resident = what stays in memory during a match.

| Method | Resident / BC7 | Stored / BC7 | MAE zoom 1.4 | MAE zoom 2.8 | PSNR 1.4 |
| --- | ---: | ---: | ---: | ---: | ---: |
| original (BC7) | 1.00 | 1.00 | 0 | 0 | — |
| raster at 1/2 size (BC7) | 0.25 | 0.25 | 0.025 | 0.024 | 28.4 |
| raster at 1/4 size (BC7) | 0.07 | 0.07 | 0.050 | 0.049 | 23.9 |
| vtracer medium (mesh) | 0.71 | 0.23 | 0.047 | 0.045 | 23.3 |
| layered fine (mesh) | 2.56 | 0.61 | 0.033 | 0.029 | 25.6 |
| layered medium (mesh) | 1.67 | 0.39 | 0.033 | 0.031 | 25.6 |
| layered coarse (mesh) | 1.49 | 0.36 | 0.032 | 0.031 | 25.4 |
| layered medium + shading texture 1/4 | 1.73 | 0.46 | 0.029 | 0.028 | 26.5 |
| layered medium + shading texture 1/8 | 1.69 | 0.41 | 0.033 | 0.031 | 26.0 |
| colour + 2 distance fields, 1/2 | 0.51 | 0.51 | 0.028 | 0.027 | 26.1 |
| colour + 2 distance fields, 1/4 | 0.13 | 0.13 | 0.035 | 0.038 | 23.8 |
| **indexed, 16 colours** | **0.49** | 0.49 | **0.012** | **0.012** | **34.4** |
| indexed 16 + shading channel 1/2 | 0.62 | 0.62 | 0.012 | 0.011 | 34.7 |
| indexed 16 at half size | 0.125 | 0.125 | 0.029 | — | — |

Images: one strip per drawing at match size (shown 2× with pixels kept), and a 3×3 sheet
at zoom 2.8, in [samples/](samples/). The most telling ones:
- [Link idle, zoom 2.8](link-idle-zoom2.8.png): all candidates side by side.
- [DK jab at match size](dk-jab-match-size.png).
- [DK Final, zoom 2.8](dk-final-zoom2.8.png): flat art, the best case for vectors.

## 3. Whole packages

Every drawing, `layered medium`, against the drawing rectangles in BC7. Page packing adds
about 10% more on top of today's BC7 figures.
Data: [package-summary.json](package-summary.json), per drawing in
[package-drawings.json.gz](package-drawings.json.gz).

| | DK | Link | Pikachu |
| --- | ---: | ---: | ---: |
| Drawings | 1,627 | 1,753 | 1,422 |
| BC7, drawing rectangles | 143.5 MiB | 63.1 MiB | 56.6 MiB |
| PNG / lossless WebP files | 74.7 / 51.9 MiB | 48.0 / 35.2 MiB | 20.5 / 15.7 MiB |
| **Vector meshes on the GPU** | **166.7 MiB** | **304.4 MiB** | **47.8 MiB** |
| Vector paths stored (int16) | 38.8 MiB | 73.7 MiB | 11.4 MiB |
| **Indexed 16 (4 bits per pixel)** | **71.1 MiB** | **31.2 MiB** | **28.0 MiB** |
| Triangles per drawing, median / p95 / max | 4,634 / 12,269 / 16,963 | 8,202 / 15,752 / 24,271 | 1,771 / 2,429 / 4,249 |
| Colour layers per drawing, median / max | 6 / 15 | 27 / 35 | 7 / 11 |
| MAE at match size, median: vector / half-size raster / indexed 16 | 0.020 / 0.015 / 0.006 | 0.043 / 0.031 / 0.015 | 0.030 / 0.024 / 0.010 |
| Drawings where the vector is worse than the half-size raster | 99.1% | 100% | 99.5% |
| Trace time per drawing, median | 0.32 s | 0.72 s | 0.14 s |

All 4,802 drawings traced in 3 min 54 s on 20 cores.

Why the mesh loses: a drawing is only about 200 px tall, and BC7 costs just 1 byte per
pixel. A traced drawing has thousands of edge vertices (outlines, folds, noise
boundaries), and each one costs 12–18 bytes on the GPU. Link is worst. His art has many
small colour regions (belt, crest, hair strands, 27 layers per drawing), and 25% of his
pixels are semi-transparent edges.

## 4. Artefacts against the art style

- **Soft shading becomes flat bands.** The art has cel shading with a subtle gradient,
  plus per-pixel noise: DK's normal drawings use 5,000–7,000 colours, his Final drawings
  13. A low-res shading texture brings some gradient back, but costs more than it saves.
- **Outlines get heavier and jagged.** Lines are 1–2 source px, which is 0.65–1.3 screen
  px at match size. As filled shapes they come out bolder, darker and broken where the
  original line fades. A stroke model with variable width would be closer, but needs a
  centre-line tracer.
- **Small details melt.** Link's eyes, the Hylian crest and finger creases merge or
  vanish at `medium`/`coarse`. Keeping them pushes Link to 35 layers and 300+ MiB.
- **Distance fields break thin lines.** A field stored at 1/2 or 1/4 resolution cannot
  hold a line thinner than a texel: lines go dotted, and dark interior detail (the shield
  crest) becomes blobs. Distance fields also hold one boundary per channel, while these
  drawings have 6–35 colour regions. They suit a silhouette or a single ink layer, not
  the whole drawing.
- **Where vectors win:** at zoom 2.8 and DPR 2 the edges stay sharp, while the raster
  blurs ([DK Final](dk-final-zoom2.8.png)). The Final is drawn at scale 0.341, which is
  0.95 screen px per source px at 2.8, so the gain is small for today's sizes.

## 5. Recolour

Vectors and indexed colour both make costumes exact. A layer or palette entry has one
colour, so recolouring means changing ≤16 values, not testing every pixel against HSV
tolerances. The test below applied the same maths as `character/render/recolor.ts`
(`costumeShifts` and the GLSL) to the layer colours ([image](recolour.png): DK Cobalt,
Pikachu Scarlet, Link Goron). The raster version leaves stray unshifted pixels at
anti-aliased edges and on Pikachu's feet; the vector version does not.

A single palette per character works as well as one per drawing. Over the samples, one
shared 16-colour palette gives median MAE 0.007 (DK), 0.018 (Link), 0.012 (Pikachu); 32
colours give 0.005 / 0.012 / 0.011. So the palette can be the costume: costume N is
palette N, with no colour regions or tolerances.

## 6. Render cost in Three.js / WebGL

- **Meshes.** One fighter's drawing fits one indexed triangle list with vertex colours,
  drawn in layer order with blending: **one draw call**. 2–24k triangles per fighter is
  trivial for the GPU. The main renderer already has MSAA (`antialias: true` in
  `port/src/engine/renderer.ts`), so edges get 4-sample anti-aliasing. Sprites are
  filtered more smoothly.
- **Building meshes on demand** keeps only the paths resident. But Three's
  `ShapeUtils.triangulateShape` (earcut) takes 0.44 ms (Pikachu idle), 1.7 ms (DK jab),
  3.3 ms (Link spin) and 5.4 ms (Link idle) per new drawing on this PC
  ([tess.mjs](scripts/tess.mjs)). Four fighters changing drawing on the same tick would
  cost 7–20 ms, against a 16.7 ms frame. That needs a cache, or the stencil-then-cover
  method (no triangulation, but 2 draw calls per layer, which is 12–70 per fighter).
- **Indexed textures.** WebGL2 has no 4-bit format: pack two indices per byte in an R8
  texture. The shader then:
  - reads 4 texels with `texelFetch`;
  - takes each nibble and looks up a 16-entry palette uniform;
  - blends the 4 results bilinearly in premultiplied space.

  Hardware mipmaps cannot average indices. Below 0.5× (Pikachu's Final shows at 0.33×),
  precompute quantised index mips, or use RGBA for those drawings. The recolour then
  becomes palette selection, with no per-pixel HSV search.

## 7. Animation and pipeline implications

- Vectors are still one stored shape set per drawing. Like the textures, they save
  nothing on the number of drawings. Morphing between vector keyframes needs matching
  topology between drawings, which tracing does not give. That would be the 2D-rig or
  parts option, with authored shapes, not traced ones.
- For vectors, the pipeline would have to output layered vector art (fills plus
  variable-width strokes) directly. Image models produce raster output, so that means
  tracing after generation, which is the lossy step measured here.
- For indexed colour, the pipeline only has to output **palette-clean raster**: posterise
  to the character's palette, with the outline as one palette entry. DK's Final drawings
  are already in that form (13 colours, hard alpha), and index them losslessly. Generating
  with a fixed palette also makes costumes free and removes the region/tolerance step.

## Recommendation

Drop vectors and distance fields as the main representation.

Carry **palette-indexed drawings (16 colours per character, 4 bits per pixel)** forward as
a format layer:
- It is 2× smaller than BC7 at near-lossless quality.
- Costumes become exact.
- It stacks with the resolution, holds, tiles and delta options: half size plus indexed
  is 1/8 of today.

Open questions before adopting it:
- the manual-filtering shader and its frame cost on Iris Xe;
- index mipmaps for drawings shown below 0.5×;
- whether the soft shading that indexing removes should come back as a small shading
  channel (+0.13×, which bought little here).
