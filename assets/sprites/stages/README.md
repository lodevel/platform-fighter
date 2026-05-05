# `assets/sprites/stages/`

Engine-facing tileset and background sprite assets for the in-game
stages, organised one folder per stage id.

This directory is the stage-side analog of `assets/sprites/characters/`
— it contains the **derivative / curated** tile cuts the engine
actually loads, while the canonical upstream packs live at
`assets/stages/<id>/` (so the asset-licence audit can trace any
sprite back to its source pack with one `find`).

## Layout

```
sprites/stages/
└── m1/                         # M1 flat stage (Sub-AC 2 of AC 10002)
    ├── LICENSE.txt
    ├── README.md
    ├── frames.json
    ├── platforms/              # Curated single-tile PNGs for platform faces
    ├── background/             # Curated single-tile PNGs for the back-most layers
    └── tilemap/                # Packed atlas sheets (when one texture load is preferred)
```

Future milestones populate sibling folders:

- `m2/` — second hazard stage (M2 roster expansion).
- `m3/` — third hazard stage.
- `m4/` — fourth hazard stage.

Each per-stage folder follows the same `platforms/ + background/ +
tilemap/ + frames.json + README.md + LICENSE.txt` layout so a single
`StageRenderer` lookup pattern can reach every stage's art without
per-stage special-casing.

## Sourcing rules

Same priority order as the rest of `assets/`:

1. **Primary** — free CC0 / CC-BY packs from
   [itch.io](https://itch.io/game-assets/free),
   [Kenney.nl](https://kenney.nl/assets), or
   [OpenGameArt.org](https://opengameart.org).
2. **Fallback** — procedural pixel art generated in TypeScript via
   `Phaser.GameObjects.Graphics`. Mark source files with
   `// procedural fallback`.

CC-BY packs **must** be credited in repo-root `ATTRIBUTION.md` with
the new path added under "Used in"; CC0 packs are recommended-but-not-
required to be listed there for traceability.

## See also

- [`../characters/README.md`](../characters/README.md) — the analogous
  per-character sprite folder.
- [`../../stages/m1/README.md`](../../stages/m1/README.md) — the
  upstream Kenney *Pixel Platformer* (v1.2) pack, kept verbatim as
  the licence root for the M1 stage's art.
- [`../../../ATTRIBUTION.md`](../../../ATTRIBUTION.md) — the single
  source of truth for every third-party asset shipped under `assets/`.
