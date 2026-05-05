# `assets/sprites/stages/m1/`

Tileset and background sprite assets for the **M1 flat stage**, organised
into the canonical `assets/sprites/<category>/` namespace alongside
`assets/sprites/characters/`. This directory satisfies **AC 10002 /
Sub-AC 2** of the M1.5 content pipeline:

> Source and place CC0/CC-BY sprite/tileset assets for the M1 stage
> under `assets/sprites/stages/` (platforms, background layers).

## Layout

```
sprites/stages/m1/
├── LICENSE.txt                       # Verbatim upstream CC0 license file
├── README.md                         # This file
├── frames.json                       # Tile-cell + atlas metadata (single source of truth)
├── platforms/                        # Curated single-tile PNGs for the M1 flat stage's platforms
│   ├── ground_top.png                #   18×18 — grass-capped dirt top
│   ├── ground_body.png               #   18×18 — plain dirt body
│   └── floating_platform.png         #   18×18 — grass-only drop-through
├── background/                       # Curated single-tile PNGs for the back-most parallax layers
│   ├── sky.png                       #   24×24 — plain sky (tileable)
│   ├── tree_silhouette_0.png         #   24×24 — distant tree variant A
│   └── tree_silhouette_1.png         #   24×24 — distant tree variant B
└── tilemap/                          # Packed atlas sheets (when the renderer prefers a single texture load)
    ├── tilemap.png                   #   18×18 platform-tile atlas (20×9 grid, 1 px gutter)
    ├── tilemap_packed.png            #   Same, no gutter
    ├── tilemap-backgrounds.png       #   24×24 background-tile atlas (8×3 grid, 1 px gutter)
    ├── tilemap-backgrounds_packed.png#   Same, no gutter
    ├── Tilesheet-Tiles.txt           #   Upstream Kenney metadata (tile size + grid)
    └── Tilesheet-Backgrounds.txt     #   Upstream Kenney metadata (background tile size + grid)
```

Total directory size ≈ **20 KB** (well under the 100 MB project
bundle budget).

## Sourcing & licensing

All art in this directory comes from **Kenney's *Pixel Platformer*
(v1.2)** pack — **CC0 1.0 / Public Domain** (attribution optional but
listed in repo-root [`ATTRIBUTION.md`](../../../../ATTRIBUTION.md) for
traceability per project asset policy).

| Aspect      | Value                                                           |
|-------------|-----------------------------------------------------------------|
| Source pack | *Pixel Platformer* (v1.2)                                       |
| Author      | **Kenney** (kenney.nl)                                          |
| URL         | https://kenney.nl/assets/pixel-platformer                       |
| License     | CC0 1.0 — https://creativecommons.org/publicdomain/zero/1.0/    |
| License file| `LICENSE.txt` (verbatim copy of the upstream pack's license)    |

The canonical upstream copy lives at `assets/stages/m1/` (the original
landing place from the asset-sourcing run); this `assets/sprites/stages/m1/`
folder is the **engine-facing namespace** for the same art. Keeping both
trees in sync mirrors how `assets/sprites/characters/` mirrors the source
sheets in `assets/characters/`.

## Coordinate / cell conventions

- **Platform tiles**: `18 × 18 px` cells, `1 px` gutter between cells
  in `tilemap/tilemap.png` (20 × 9 grid → 180 cells).
- **Background tiles**: `24 × 24 px` cells, `1 px` gutter in
  `tilemap/tilemap-backgrounds.png` (8 × 3 grid → 24 cells).
- **Cell index → (col, row)**: `index = col + row × cols` (Phaser
  spritesheet convention).
- **`*_packed.png`** variants strip the 1 px gutter — pick whichever
  loader call is more convenient (`load.spritesheet` likes the gutter
  variant + `margin: 0, spacing: 1`; `load.image` of a single tile is
  simpler from the packed sheet).

## How to load these in Phaser

```ts
// Atlas — one texture, addressable by frame index
this.load.spritesheet(
  'stage.m1.tilemap',
  'sprites/stages/m1/tilemap/tilemap.png',
  { frameWidth: 18, frameHeight: 18, margin: 0, spacing: 1 },
);

// Single tile — direct image load (drop-through floating platform)
this.load.image(
  'stage.m1.platform.floating',
  'sprites/stages/m1/platforms/floating_platform.png',
);

// Background plain-sky tile — used as a tiled-sprite repeat backdrop
this.load.image(
  'stage.m1.background.sky',
  'sprites/stages/m1/background/sky.png',
);
```

`frames.json` ships per-tile metadata (file path, source cell `[col,
row]`, source tile index, upstream file, and a one-line `purpose`
string) so a build step or test can verify the curated single-tile
PNGs are byte-identical to the right cell of the upstream atlas.

## Move-to-cell mapping (curated tiles)

```
                                    cell      sourceTileIndex   upstream file
            -------------------     --------  ---------------   --------------------------
platforms/ground_top.png            [1, 0]    1                 assets/stages/m1/tiles/tile_0001.png
platforms/ground_body.png           [1, 1]    21                assets/stages/m1/tiles/tile_0021.png
platforms/floating_platform.png     [11, 0]   11                assets/stages/m1/tiles/tile_0011.png

background/sky.png                  [0, 0]    0                 assets/stages/m1/background/tile_0000.png
background/tree_silhouette_0.png    [1, 0]    1                 assets/stages/m1/background/tile_0001.png
background/tree_silhouette_1.png    [2, 0]    2                 assets/stages/m1/background/tile_0002.png
```

Tile choices align with the suggested mapping in
`assets/stages/m1/README.md` ("Sky / scenery backdrop", "Distant tree
silhouette", "Solid ground top", "Solid ground body", "Pass-through
float (top)"). The mapping is intentionally indirection-friendly — the
final visual designer can swap the chosen `tile_NNNN.png` source by
re-running the (one-line `cp`) bootstrap; nothing in `StageRenderer`
hard-codes a Kenney-cell number.

## Recommended use for the M1 flat stage

The canonical M1 flat stage (`FLAT_STAGE` in
`src/stages/stageDefinitions.ts`) has:

- One wide solid ground platform at the bottom centre.
- Three smaller pass-through floating platforms (left / right / top).
- A four-side blast zone outset.

| Stage element              | Recommended sprite                                  |
|----------------------------|-----------------------------------------------------|
| Sky / scenery backdrop     | `background/sky.png` (tile-repeat)                  |
| Distant tree silhouette    | `background/tree_silhouette_0.png` / `_1.png`       |
| Solid ground top           | `platforms/ground_top.png` (1-cell-tall row)        |
| Solid ground body          | `platforms/ground_body.png` (tiled fill below)      |
| Pass-through float (top)   | `platforms/floating_platform.png` (single-cell row) |

The `StageRenderer` currently draws platforms as flat-colour rectangles
(`procedural fallback` — see the inline comment in
`src/stages/StageRenderer.ts`). A follow-up sub-AC will plumb tile
sprite refs through the `StageLayout` schema; the curated PNGs above
are the targets it will reference.

## Bundle footprint

| Subtree                             | Size    |
|-------------------------------------|---------|
| `platforms/` (3 × ~180 B PNGs)       | ≈ 0.6 KB |
| `background/` (3 × ~100 B PNGs)      | ≈ 0.3 KB |
| `tilemap/` (4 atlas PNGs + metadata) | ≈ 14 KB  |
| `LICENSE.txt`                        | ≈ 0.7 KB |
| `frames.json` + `README.md`          | ≈ 6 KB   |
| **Total**                            | **≈ 22 KB** |

## Notes for downstream wiring

- The pack is **CC0**, so palette swaps, edits, and recolours are
  permitted with no further licensing obligation. Any edited tiles
  should still be tracked here — mark TS-side procedural edits with
  the standard `// procedural fallback` source comment.
- M2 hazard stages (lava, wind, crumbling, moving) will get their own
  `assets/sprites/stages/m2/` folder following this same layout pattern.
- If a future M1 stage needs additional artistic flourish (parallax
  layers, foreground decals), add them under this folder by `cp`-ing
  more tiles from `assets/stages/m1/tiles/` or `assets/stages/m1/background/`
  before introducing a new third-party pack — keeping the M1 stage to
  one upstream pack simplifies licensing review.
- The two atlas PNGs in `tilemap/` are the same bytes as their
  counterparts in `assets/stages/m1/tilemap/`. Either path is safe to
  feed to Phaser; new code should prefer the `sprites/stages/m1/`
  path so all engine-facing sprite assets sit under one root.
