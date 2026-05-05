# M1 Stage Art

Background and platform-tile art for the **M1 flat stage** (Sub-AC 2 of
AC 10002). Sourced from Kenney's *Pixel Platformer* pack — **CC0
(public domain)**, no attribution required, listed in repo-root
`ATTRIBUTION.md` for traceability per project asset policy.

## License

**CC0 1.0 / Public Domain.** See `LICENSE.txt` (the upstream license
file shipped with the pack) for the full terms. Use freely for any
purpose, commercial or otherwise.

- Source pack: *Pixel Platformer* (v1.2)
- Author: **Kenney** (kenney.nl)
- URL: https://kenney.nl/assets/pixel-platformer

## Layout

```
assets/stages/m1/
├── LICENSE.txt           # Upstream CC0 license file (verbatim)
├── README.md             # This file
├── background/           # 24 distant-scenery background tiles
│   └── tile_0000.png … tile_0023.png   (24 × 24 px each)
├── tiles/                # 180 individual platform tiles
│   └── tile_0000.png … tile_0179.png   (18 × 18 px each)
└── tilemap/              # Packed atlas sheets + tilesheet metadata
    ├── tilemap.png                 # 18×18 tile atlas (20×9 grid, 1 px gutter)
    ├── tilemap_packed.png          # Same atlas, no gutter
    ├── tilemap-backgrounds.png     # 24×24 background atlas (8×3 grid, 1 px gutter)
    ├── tilemap-backgrounds_packed.png # Same atlas, no gutter
    ├── Tilesheet-Tiles.txt         # Upstream tile-size + grid metadata
    └── Tilesheet-Backgrounds.txt   # Upstream background-tile metadata
```

## Coordinate / cell conventions

- **Platform tiles**: `18 × 18 px` cells, `1 px` gutter between cells
  in the `tilemap.png` atlas, `20 × 9` grid (180 tiles total).
- **Background tiles**: `24 × 24 px` cells, `1 px` gutter in the
  `tilemap-backgrounds.png` atlas, `8 × 3` grid (24 tiles total).
- **Cell index → (col, row)** follows Phaser convention:
  `index = col + row × cols`.
- **`*_packed.png`** variants strip the 1 px gutter — pick whichever
  Phaser loader you prefer (`spritesheet` likes the gutter version,
  `image` of a single tile is simpler from a packed sheet).

## Recommended use for the M1 flat stage

The canonical M1 flat stage (`FLAT_STAGE` in
`src/stages/stageDefinitions.ts`) has:

- One wide solid ground platform at the bottom centre.
- Three smaller pass-through floating platforms (left / right / top).
- A four-side blast zone outset.

Suggested mapping (illustrative — final mapping lives with the
`StageRenderer` wiring):

| Stage element              | Suggested tile source                      |
|----------------------------|--------------------------------------------|
| Sky / scenery backdrop     | `background/tile_0000.png` (plain sky)     |
| Distant tree silhouette    | `background/tile_0001.png`–`tile_0007.png` |
| Solid ground top           | Grass-top dirt tile from `tiles/`          |
| Solid ground body          | Plain dirt tile from `tiles/`              |
| Pass-through float (top)   | Grass-top tile only (no body, drop-thru)   |

A renderer integration ticket can pin specific `tile_NNNN.png` indices
once the visual designer signs off — the layout above is intentionally
indirection-friendly so the choice doesn't block this Sub-AC.

## Bundle footprint

Total directory size ≈ **20 KB** (well under the 100 MB project bundle
limit). Individual tile files are ~600 bytes each; atlases are
≤ 7 KB.

## Notes for downstream wiring

- The pack is **CC0**, so palette swaps, edits, and recolours are
  permitted with no further licensing obligation. Any edited tiles
  should still be tracked here — mark TS-side procedural edits with
  the standard `// procedural fallback` source comment.
- M2 hazard stages (lava, wind, crumbling, moving) will get their own
  `assets/stages/m2/` folder following this same layout pattern.
- If a future M1 stage needs additional artistic flourish (parallax
  layers, foreground decals), prefer adding new tiles from this same
  CC0 pack before introducing a new third-party source — keeping the
  M1 stage to one upstream pack simplifies licensing review.
