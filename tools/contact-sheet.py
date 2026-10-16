#!/usr/bin/env python3
"""Contact sheets of a fighter's clips for visual acceptance, from either frames.json layout (grid or tight).

For every clip of <fighter>/frames.json writes <out>/<clip>.png with two rows: the clip's cells as shipped
(right-facing) and mirrored (how the game shows the left facing), each cell drawn on a neutral grey with a
1-px cell border and its frame index. A thin line at the cell bottom marks the baseline, a red dot the clip root.
Also writes <out>/index.json and <out>/cell-stats.json (per-cell alpha bounds).

Usage: ~/ComfyUI/.venv/bin/python -I tools/contact-sheet.py <fighter | fighter-dir> <out-dir> [clip,clip,...]
  <fighter-dir> is any directory holding frames.json and animations/ (e.g. a staging dir); a bare fighter id
  means assets/characters/<id>.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageOps

sys.path.insert(0, str(Path(__file__).resolve().parent))   # python -I does not add the script dir
import fighter_frames

ROOT = Path(__file__).resolve().parent.parent
PAD, LABEL_H = 6, 18


def cell_stats(cell):
    a = cell[..., 3] > 32
    rows, cols = np.nonzero(a.sum(1) >= 3)[0], np.nonzero(a.sum(0) >= 3)[0]
    if len(rows) == 0:
        return {'empty': True}
    return {'top': int(rows.min()), 'bottom': int(rows.max()), 'left': int(cols.min()), 'right': int(cols.max()),
            'height': int(rows.max() - rows.min() + 1), 'width': int(cols.max() - cols.min() + 1)}


def clip_sheet(clip, entry, cells):
    cw, ch = entry['frameWidth'], entry['frameHeight']
    n = len(cells)
    sheet = Image.new('RGB', (n * (cw + PAD) + PAD, 2 * (ch + PAD + LABEL_H) + PAD), (96, 96, 96))
    dr = ImageDraw.Draw(sheet)
    for row, mirror in enumerate((False, True)):
        for i, arr in enumerate(cells):
            cell = Image.fromarray(arr, 'RGBA')
            if mirror:
                cell = ImageOps.mirror(cell)
            x, y = PAD + i * (cw + PAD), PAD + row * (ch + PAD + LABEL_H)
            dr.rectangle([x - 1, y - 1, x + cw, y + ch], outline=(140, 140, 140))
            dr.line([x, y + ch - 1, x + cw, y + ch - 1], fill=(200, 60, 60))
            sheet.paste(cell, (x, y), cell)
            if 'root' in entry:
                rx = cw - entry['root'][0] if mirror else entry['root'][0]
                dr.ellipse([x + rx - 2, y + entry['root'][1] - 2, x + rx + 2, y + entry['root'][1] + 2], fill=(220, 40, 40))
            dr.text((x + 2, y + ch + 2), f'{clip} {i}' + (' (mirrored)' if mirror else ''), fill=(255, 255, 255))
    return sheet


def main(argv):
    target, out = argv[1], Path(argv[2])
    only = set(argv[3].split(',')) if len(argv) > 3 else None
    fighter_dir = Path(target) if Path(target).is_dir() else ROOT / 'assets/characters' / target
    frames = json.loads((fighter_dir / 'frames.json').read_text())
    out.mkdir(parents=True, exist_ok=True)
    index, stats = {}, {}
    for clip, entry in sorted(frames['animations'].items()):
        if only and clip not in only:
            continue
        cells = fighter_frames.load_cells(fighter_dir, entry)
        clip_sheet(clip, entry, cells).save(out / f'{clip}.png')
        index[clip] = {'frames': len(cells), 'sheet': str(out / f'{clip}.png')}
        stats[clip] = [{'frame': i, **cell_stats(c)} for i, c in enumerate(cells)]
    (out / 'index.json').write_text(json.dumps(index, indent=1))
    (out / 'cell-stats.json').write_text(json.dumps(stats, indent=0))
    print(f'{len(index)} sheets -> {out}')


if __name__ == '__main__':
    main(sys.argv)
