# `assets/sprites/characters/`

Per-move horizontal strip PNGs for the 2 M1 fighters (**cat**, **wolf**),
organised by the in-engine moveset taxonomy. This directory satisfies
**AC 10001 / Sub-AC 1** of the M1.5 content pipeline:

> Source and place CC0/CC-BY sprite assets for the 2 M1 characters
> under `assets/sprites/characters/` (idle, walk, jump, attack frames
> for jab/tilt/smash/aerial, shield, dodge).

## Layout

```
sprites/characters/
├── cat/
│   ├── frames.json
│   └── animations/
│       ├── idle.png    (4 frames × 50×50)
│       ├── walk.png    (10 frames × 50×50)
│       ├── jump.png    (5 frames × 50×50)
│       ├── jab.png     (4 frames × 50×50)
│       ├── tilt.png    (4 frames × 50×50)
│       ├── smash.png   (8 frames × 50×50)
│       ├── aerial.png  (6 frames × 50×50)
│       ├── shield.png  (4 frames × 50×50)
│       └── dodge.png   (4 frames × 50×50)
└── wolf/
    ├── frames.json
    └── animations/
        ├── idle.png    (4 frames × 64×64)
        ├── walk.png    (8 frames × 64×64)
        ├── jump.png    (5 frames × 64×64)
        ├── jab.png     (4 frames × 64×64)
        ├── tilt.png    (4 frames × 64×64)
        ├── smash.png   (8 frames × 64×64)
        ├── aerial.png  (6 frames × 64×64)
        ├── shield.png  (4 frames × 64×64)
        └── dodge.png   (4 frames × 64×64)
```

Each `*.png` is a single horizontal strip of N cells at the source
sheet's native cell size — load it directly with

```ts
this.load.spritesheet('cat-jab',
  'assets/sprites/characters/cat/animations/jab.png',
  { frameWidth: 50, frameHeight: 50 });
```

`frames.json` ships per-character metadata: the source sheet path
(relative to the character folder), cell grid dimensions, license, and
a per-move `sourceCells` array of `[col, row]` coordinates so a build
step can reproduce the strips byte-for-byte by re-running
`scripts/extract-move-strips.py`.

## Sourcing & licensing

Both M1 fighters use **CC-BY 3.0** sprite packs from OpenGameArt.org per
the Seed's PRIMARY rule (free CC0 / CC-BY packs from itch.io / Kenney /
OpenGameArt). The required attribution lives in the repo-root
[`ATTRIBUTION.md`](../../../ATTRIBUTION.md) — both packs are listed
under the *CC-BY 3.0* section, with the new strip directory added to
each *Used in* line.

| Character | Source pack                                              | Author          |
|-----------|----------------------------------------------------------|-----------------|
| `cat/`    | *Cat Fighter Sprite Sheet*                               | dogchicken      |
| `wolf/`   | *Dog Fighter (Cat Fighter Remix Base + Add-on One)*      | IsometricRobot (remix of dogchicken) |

The canonical source sheets (`cat_source_sheet.png`,
`wolf_source_sheet.png`) live at `assets/characters/<id>/` so the
palette-swap pipeline (`scripts/palette-swap/`) can keep operating on
the single uncropped texture; this directory only ships the
move-aligned **derivative strips** consumed by the engine's animation
driver.

The wolf source sheet ships with a flat white backdrop instead of true
transparency. The extraction script chroma-keys any pixel with
`R, G, B ≥ 250` to `alpha = 0` so the wolf strips render correctly over
a stage background — this is per-character config (`chroma_key_white:
True`) inside the script, not a global rule.

## Move-to-cell mapping

The `sourceCells` arrays in each `frames.json` document the exact
mapping; below is a one-glance summary so reviewers can sanity-check
the extraction without parsing JSON.

```
            CAT  (10×10 / 50px)        WOLF (16×16 / 64px)
            -------------------------- ---------------------------
idle        r0  c0..3   (4 frames)     r0  c0..3   (4 frames)
walk        r2  c0..9   (10 frames)    r1  c0..7   (8 frames)
jump        r3  c5..9   (5 frames)     r3  c3..7   (5 frames)
jab         r4  c0..3   (4 frames)     r4  c3..6   (4 frames)
tilt        r4  c4..7   (4 frames)     r5  c0..3   (4 frames)
smash       r5  c0..7   (8 frames)     r14 c0..7   (8 frames)
aerial      r4  c4..9   (6 frames)     r10 c4..9   (6 frames)
shield      r1  c0..3   (4 frames)     r6  c0..3   (4 frames)
dodge       r3  c0..3   (4 frames)     r2  c0..3   (4 frames)
```

`idle / walk / jump` mirror the existing
`assets/characters/<id>/frames.json` extraction — the rest is new for
M1.5. Cells were chosen by visually grouping motion-related frames in
each source sheet (see `scripts/extract-move-strips.py` for the
mapping rationale and to re-run extraction after any source-art
update).

## Frame budget vs Seed target

The Seed targets ~1120 base sprite frames per character (10 moves ×
6–8 frames × N states). These nine strips deliver ~49 cat frames and
~47 wolf frames — **enough to cover this Sub-AC's required move
list** (idle/walk/jump + jab/tilt/smash/aerial + shield/dodge), with
edge-grab and the 2 specials extracted from the same source sheets in
later sub-ACs without re-sourcing art. Total disk cost across both
characters' new strips is **≈ 24 KB** — negligible against the 100 MB
bundle budget.

## Re-running the extraction

```
python3 scripts/extract-move-strips.py
```

The script is deterministic (same source PNG bytes + same mapping →
same output PNG bytes), so `git diff --exit-code
assets/sprites/characters/` is a valid CI guard.
