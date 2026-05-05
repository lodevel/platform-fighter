# Cat

M1 fighter — small bandana-wearing feline brawler. Pairs visually with
the Wolf since the Wolf's source pack is a direct remix of this one.

## License

**CC-BY 3.0.** Attribution is mandatory and lives in the repo-root
[`ATTRIBUTION.md`](../../../ATTRIBUTION.md).

- Source pack: *Cat Fighter Sprite Sheet*
- Author: **dogchicken**
- URL: https://opengameart.org/content/cat-fighter-sprite-sheet

## Files

| Path                          | Notes                                            |
|-------------------------------|--------------------------------------------------|
| `cat_source_sheet.png`        | Raw 500×500 OpenGameArt sheet (10×10 grid).      |
| `frames.json`                 | Cell metadata + per-animation `(col, row)` map.  |
| `animations/idle.png`         | Idle strip — 4 frames at 50×50.                  |
| `animations/run.png`          | Run strip — 10 frames at 50×50.                  |
| `animations/jump.png`         | Jump strip — 5 frames at 50×50.                  |
| `animations/attack.png`       | Attack strip — 10 frames at 50×50.               |

## Source-sheet layout

The source sheet uses **50×50** cells in a **10×10** grid; only the
upper 6 rows hold sprite data. The animation strips above were
extracted from these cell ranges:

| Animation | Cells `(col, row)`                          | Frame count |
|-----------|---------------------------------------------|-------------|
| idle      | `(0..3, 0)` — standing poses                | 4           |
| run       | `(0..9, 2)` — full run cycle                | 10          |
| jump      | `(5..9, 3)` — air / fall poses              | 5           |
| attack    | `(0..9, 4)` — kick / strike sequence        | 10          |

Strip frame indices are `0..N-1` left-to-right; the source-sheet
indices follow Phaser's standard `index = col + row * sheetCols`.

## Notes for downstream wiring

These strips satisfy AC 10001 Sub-AC 1 only (idle / run / jump /
attack). The full Cat moveset — jab, tilt, smash, 2 specials, 3
aerials, shield, dodge, edge-grab — needs additional frames pulled
from the same source sheet in later sub-ACs. **No re-sourcing of
art is required** for those extractions; just extend `frames.json`
and add new strips under `animations/`.
