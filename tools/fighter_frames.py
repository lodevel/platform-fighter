"""Read a fighter drawing's cell (frameWidth x frameHeight RGBA) from either frames.json layout.

Used by tools/fighter-pack.py (packer self-check, --repack-installed) and tools/contact-sheet.py.
Import from a script with:  sys.path.insert(0, str(Path(__file__).resolve().parent)); import fighter_frames

Layouts (one frames.json animation entry, `strip` = the atlas PNG):
  grid   `sourceCells` [[col, row], ...] (or row-major when absent) in a grid of frameWidth x frameHeight cells.
  tight  `atlas` [W, H] and `trims` [[x, y, w, h, dx, dy], ...]: rect (x, y, w, h) of the atlas holds the drawing's
         alpha bounding box (+1 px); it sits at offset (dx, dy) of the cell, every other cell texel is transparent.
         This is Phaser's trimmed JSON-hash frame (frame / spriteSourceSize / sourceSize).
Entries with `pages` (the removed paging layout) are rejected.
"""
import hashlib
from pathlib import Path

import numpy as np
from PIL import Image


def layout_of(entry) -> str:
    if 'pages' in entry:
        raise ValueError('paged clips are no longer supported; re-pack the clip with --layout tight')
    return 'tight' if 'trims' in entry else 'grid'


def cell_count(entry) -> int:
    return len(entry['trims']) if layout_of(entry) == 'tight' else entry['frameCount']


def read_cell(entry, atlas: np.ndarray, i: int) -> np.ndarray:
    """Cell `i` of the entry as a (frameHeight, frameWidth, 4) uint8 array, rebuilt from the atlas pixels."""
    fw, fh = entry['frameWidth'], entry['frameHeight']
    if layout_of(entry) == 'tight':
        x, y, w, h, dx, dy = entry['trims'][i]
        cell = np.zeros((fh, fw, 4), np.uint8)
        cell[dy:dy + h, dx:dx + w] = atlas[y:y + h, x:x + w]
        return cell
    if 'sourceCells' in entry:
        col, row = entry['sourceCells'][i]
    else:
        col, row = i % (atlas.shape[1] // fw), i // (atlas.shape[1] // fw)
    return atlas[row * fh:(row + 1) * fh, col * fw:(col + 1) * fw].copy()


def read_cells(entry, atlas: np.ndarray) -> list:
    return [read_cell(entry, atlas, i) for i in range(cell_count(entry))]


def load_atlas(fighter_dir, entry) -> np.ndarray:
    return np.array(Image.open(Path(fighter_dir) / entry['strip']).convert('RGBA'))


def load_cells(fighter_dir, entry) -> list:
    """All cells of one frames.json entry; fighter_dir holds frames.json and the `animations/` folder."""
    return read_cells(entry, load_atlas(fighter_dir, entry))


def premultiply(cell: np.ndarray) -> np.ndarray:
    out = cell.copy()
    out[..., :3] = ((cell[..., :3].astype(np.uint16) * cell[..., 3:4] + 127) // 255).astype(np.uint8)
    return out


def rgba_sha256(cell: np.ndarray) -> str:
    """sha256 of the premultiplied RGBA bytes of a cell (transparent texels hash as zero whatever their RGB)."""
    return hashlib.sha256(premultiply(cell).tobytes()).hexdigest()
