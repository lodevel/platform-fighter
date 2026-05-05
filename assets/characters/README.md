# Characters

Per-character art assets for the M1 / M2 / M2+ roster. Layout:

```
characters/
├── wolf/                   # M1 fighter — gray bipedal canine
│   ├── wolf_source_sheet.png   # original 1024×1024 source sheet
│   ├── frames.json             # cell size, grid dims, anim → cells map
│   └── animations/
│       ├── idle.png            # horizontal strip, 4 × 64×64
│       ├── run.png             # horizontal strip, 8 × 64×64
│       ├── jump.png            # horizontal strip, 5 × 64×64
│       └── attack.png          # horizontal strip, 4 × 64×64
└── cat/                    # M1 fighter — bandana cat
    ├── cat_source_sheet.png    # original 500×500 source sheet
    ├── frames.json             # cell size, grid dims, anim → cells map
    └── animations/
        ├── idle.png            # horizontal strip, 4 × 50×50
        ├── run.png             # horizontal strip, 10 × 50×50
        ├── jump.png            # horizontal strip, 5 × 50×50
        └── attack.png          # horizontal strip, 10 × 50×50
```

## Sourcing & licensing

Both M1 fighters use **CC-BY 3.0** sprite packs from OpenGameArt.org per
the Seed's PRIMARY rule (free CC0/CC-BY packs from itch.io / Kenney /
OpenGameArt). The required attribution lives in the repo-root
[`ATTRIBUTION.md`](../../ATTRIBUTION.md). Source packs:

- **Wolf** ← *Dog Fighter (Cat Fighter Remix Base + Add-on One)* by
  IsometricRobot (CC-BY 3.0). Remix of dogchicken's Cat Fighter, so the
  Wolf and Cat read as a matched pair stylistically.
- **Cat** ← *Cat Fighter Sprite Sheet* by dogchicken (CC-BY 3.0).

No procedural fallback was needed for these two characters — both packs
cover the M1.5 frame requirements (idle / run / jump / attack) at
adequate quality and bundle cost (32 KB + 19 KB raw sheets).

## Loading into Phaser

Each character ships a `frames.json` describing the cell grid for the
source sheet plus a per-animation map of `(col, row)` cell coordinates.
Two equally valid load paths:

1. **Spritesheet path (preferred for palette swaps).**
   Load `<char>_source_sheet.png` as a `this.load.spritesheet(...)` with
   `frameWidth` / `frameHeight` from `frames.json.meta`, then derive
   each animation's frame indices via `col + row * sheetCols` from
   `frames.json.animations.<anim>.sourceCells`. The palette-swap shader
   (M1.5) will operate on the single source texture this way.

2. **Strip path (lighter for a single palette).**
   Load `animations/<anim>.png` as a strip spritesheet with the
   per-anim `frameWidth` / `frameHeight` from `frames.json` — that PNG
   is already a row of N cells, so frame indices are just `0..N-1`.

The `PreloadScene` is the right place to wire these in once the M1.5
content-pipeline AC is picked up.

## Frame budget vs Seed target

The Seed targets ~1120 base sprite frames per character (10 moves ×
6–8 frames × N states). These four basic animations (idle/run/jump/
attack) deliver only ~27 cat frames + ~21 wolf frames toward that
target — **enough to satisfy this Sub-AC's requirement** ("idle/run/
jump/attack frames"), with the remaining moveset frames (tilt, smash,
specials, aerials, shield, dodge, edge-grab) to be extracted from the
same source sheets in later sub-ACs without re-sourcing art.
