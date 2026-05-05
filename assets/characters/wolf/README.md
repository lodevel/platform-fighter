# Wolf

M1 fighter — gray-furred bipedal canine with a blue bandana, in the
Cat-Fighter style so the Wolf and Cat M1 pair read as a matched set.

## License

**CC-BY 3.0.** Attribution is mandatory and lives in the repo-root
[`ATTRIBUTION.md`](../../../ATTRIBUTION.md).

- Source pack: *Dog Fighter (Cat Fighter Remix Base + Add-on One)*
- Author: **IsometricRobot** (remix of dogchicken's Cat Fighter)
- URL: https://opengameart.org/content/dog-fighter-cat-fighter-remix-base-add-on-one

## Files

| Path                          | Notes                                            |
|-------------------------------|--------------------------------------------------|
| `wolf_source_sheet.png`       | Raw 1024×1024 OpenGameArt sheet (16×16 grid).    |
| `frames.json`                 | Cell metadata + per-animation `(col, row)` map.  |
| `animations/idle.png`         | Idle strip — 4 frames at 64×64.                  |
| `animations/run.png`          | Run strip — 8 frames at 64×64.                   |
| `animations/jump.png`         | Jump strip — 5 frames at 64×64.                  |
| `animations/attack.png`       | Attack strip — 4 frames at 64×64.                |

## Source-sheet layout

The source sheet uses **64×64** cells in a **16×16** grid (only the
upper-left rows hold sprite data — the rest of the canvas is empty).
The animation strips above were extracted from these cell ranges:

| Animation | Cells `(col, row)`                          | Frame count |
|-----------|---------------------------------------------|-------------|
| idle      | `(0..3, 0)`                                 | 4           |
| run       | `(0..7, 1)`                                 | 8           |
| jump      | `(3..7, 3)` — air / fall / land poses       | 5           |
| attack    | `(3..6, 4)` — punch / strike poses          | 4           |

Strip frame indices are `0..N-1` left-to-right; the source-sheet
indices follow Phaser's standard `index = col + row * sheetCols`.

## Notes for downstream wiring

These strips satisfy AC 10001 Sub-AC 1 only (idle / run / jump /
attack). The full Wolf moveset — jab, tilt, smash, 2 specials, 3
aerials, shield, dodge, edge-grab — needs additional frames pulled
from the same source sheet in later sub-ACs. **No re-sourcing of
art is required** for those extractions; just extend `frames.json`
and add new strips under `animations/`.
