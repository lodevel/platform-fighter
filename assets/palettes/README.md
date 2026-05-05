# Palette Definitions

Per-character palette swap definition files. Each `<characterId>.json`
declares the canonical (source) atlas colours a character's sprite sheet
is authored with, and the **8 named target variants** the hue-shift batch
script (M1.5) and the runtime palette-swap shader use to recolour that
sheet.

This satisfies the Seed contract:

> "8 manual palette swaps per character via hue-shift batch script"

and is **Sub-AC 1 of AC 10201** (M1.5 content pipeline → palette
definition file format + per-character files for all 4 fighters).

## Files

```
assets/palettes/
├── palette.schema.json   # JSON Schema (draft-07) for the format
├── wolf.json             # Wolf — 8 variants
├── cat.json              # Cat  — 8 variants
├── owl.json              # Owl  — 8 variants
├── bear.json             # Bear — 8 variants
└── README.md             # this file
```

Every character file declares its `$schema` as `./palette.schema.json` so
JSON-aware editors (VS Code, JetBrains) get IntelliSense and inline
validation for free.

## Format at a glance

```jsonc
{
  "$schema": "./palette.schema.json",
  "characterId": "wolf",
  "displayName": "Wolf",

  // Colours present in the canonical authored sprite sheet.
  // The hue-shift script scans the input PNG for these RGB values.
  "source": {
    "body":      "#c24a4a",  // dominant fur / skin
    "accent":    "#ffe0a0",  // outline / detail strokes
    "highlight": "#ffe0a0"   // highlights (eyes, sheen) — may equal accent
  },

  // Exactly 8 entries, ascending index 0..7.
  // Index 0 is canonical: target == source for all slots.
  "variants": [
    {
      "index": 0,
      "name": "Crimson",
      "isCanonical": true,
      "mappings": {
        "body":      { "from": "#c24a4a", "to": "#c24a4a" },
        "accent":    { "from": "#ffe0a0", "to": "#ffe0a0" },
        "highlight": { "from": "#ffe0a0", "to": "#ffe0a0" }
      }
    },
    {
      "index": 1,
      "name": "Cobalt",
      "mappings": {
        "body":      { "from": "#c24a4a", "to": "#4a6ec2" },
        "accent":    { "from": "#ffe0a0", "to": "#a0c8ff" },
        "highlight": { "from": "#ffe0a0", "to": "#a0c8ff" }
      }
    }
    // …six more variants
  ]
}
```

## Schema invariants (locked down by `palette.schema.json`)

1. `characterId` is one of `"wolf" | "cat" | "owl" | "bear"`.
2. `source` declares **exactly three** slot colours: `body`, `accent`,
   `highlight`. Names match the `PaletteSlot` union in
   [`src/characters/paletteSwapShader.ts`](../../src/characters/paletteSwapShader.ts).
3. `variants` length is **exactly 8**, `index` values are exhaustive
   over `[0, 7]` in ascending order with no gaps.
4. Each variant carries one `mapping` per slot:
   - `from` = the source pixel colour to match (must equal the file-root
     `source.<slot>`; the hue-shift script always reads pixels from the
     canonical atlas, never from a previously generated variant)
   - `to` = the target pixel colour to write
5. Every colour is `#RRGGBB` lowercase hex (`^#[0-9a-fA-F]{6}$`). Alpha
   is implicit `0xFF` — palette swaps preserve the source pixel's alpha
   so transparent edges stay intact.
6. Variant 0 is canonical (`isCanonical: true`, `to === from` for all
   slots). Its colours match the corresponding entry in
   [`src/characters/palettes.ts`](../../src/characters/palettes.ts) so
   the runtime TS table and the JSON pipeline data never drift.

## Why JSON (and not a TS literal in `palettes.ts`)?

The colour data ALSO needs to be readable by:

- **The hue-shift batch script** (M1.5, sub-AC X) — a Node CLI that
  walks each character's source PNG and emits 8 PNGs by remapping
  pixels. The script is build-time tooling; it must not pull in the
  Phaser-typed runtime table.
- **The asset-licence audit / CI** — checks every variant's `to` colour
  is sane (in 24-bit range, no NaN, no duplicates of `from` outside
  index 0).
- **Future external editors** — drag-drop palette pickers can mutate
  these files without touching TS.

A JSON file with a JSON Schema is the format every consumer on that
list can read with zero friction. The runtime
[`src/characters/palettes.ts`](../../src/characters/palettes.ts) keeps
its TS literal as the in-engine source of truth for now (Phaser /
shader uniforms read from there); a follow-up sub-AC can add a loader
that hydrates that table from these JSON files at boot, replacing the
hand-maintained literal. Until then the schema-locked JSON files act
as the **machine-readable contract** the build pipeline can target,
and the TS literal is its mirror.

## Cross-references

- Slot model (`body / accent / highlight`):
  [`src/characters/paletteSwapShader.ts`](../../src/characters/paletteSwapShader.ts)
  → `PaletteSlot`, `CharacterSourcePalette`, `getCharacterSourcePalette`.
- Runtime palette ladders & per-character `displayName` strings:
  [`src/characters/palettes.ts`](../../src/characters/palettes.ts)
  → `WOLF_PALETTES`, `CAT_PALETTES`, `OWL_PALETTES`, `BEAR_PALETTES`.
- `CharacterId` enum: [`src/types`](../../src/types).
- Seed: ["8 manual palette swaps per character via hue-shift batch
  script"](../../fighter-seed.yaml).
