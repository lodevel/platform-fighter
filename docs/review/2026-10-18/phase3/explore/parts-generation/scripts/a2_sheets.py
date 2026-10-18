"""Approach A, stage 2: separate a generated whole-body render into the part layout and mark what must be inpainted.

For each part on the sheets: pixels the whole-body render shows for that part (native z-buffer) are copied in, minus a
band of BAND art px along every border with another part (the cut); the rest of the part shape (hidden areas, joint
caps, cut borders) keeps the flat seed and goes into the inpaint mask. Expression heads reuse the neutral head and
inpaint only where the face classes differ; open hands are fully regenerated (no visible source).

usage: python a2_sheets.py FULL_RENDER.png NATIVE_DIR SHEETS_DIR OUT_DIR
"""
import json, sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage
sys.path.insert(0, str(Path(__file__).parent))
from shape_parts import RIG, BASE_OF

FULL_OFFSET = (512, 272)   # fullbody canvas = native canvas crop at this offset
BAND = 8


def main():
    full = np.asarray(Image.open(sys.argv[1]).convert('RGB'))
    nd, sd, od = Path(sys.argv[2]), Path(sys.argv[3]), Path(sys.argv[4]); od.mkdir(parents=True, exist_ok=True)
    layout = json.loads((sd / 'layout.json').read_text())
    meta = json.loads((nd / 'parts-native.json').read_text())
    vis_full = np.asarray(Image.open(nd / 'visible-parts.png'))
    W, H = layout['sheet_size']
    seeds = [np.asarray(Image.open(sd / f'sheet-{s}-seed.png').convert('RGB')).copy() for s in range(layout['sheets'])]
    masks = [np.zeros((H, W), bool) for _ in range(layout['sheets'])]
    stats = {}
    for name, p in layout['parts'].items():
        s, x, y = p['sheet']
        z = np.load(sd / 'parts' / f'{name}.npz')
        h, w = z['mask'].shape
        ox, oy = p['origin_art']
        shape = z['mask']
        grown = ndimage.binary_dilation(shape, iterations=10)
        keep = np.zeros_like(shape)
        base = BASE_OF.get(name, name)
        if not name.startswith('open_hand'):
            vid = meta['visible_part_ids'][RIG[base][0]]
            v = vis_full[oy:oy + h, ox:ox + w]
            mine = v == vid
            others = (v != vid) & (v != 0)
            keep = mine & ~ndimage.binary_dilation(others, iterations=BAND) & ndimage.binary_dilation(shape, iterations=3)
            if name in ('head_shout', 'head_grit'):
                nz = np.load(sd / 'parts' / 'head.npz')
                differ = np.zeros_like(shape)
                hh, ww = min(h, nz['cls'].shape[0]), min(w, nz['cls'].shape[1])
                differ[:hh, :ww] = z['cls'][:hh, :ww] != nz['cls'][:hh, :ww]
                keep &= ~ndimage.binary_dilation(differ, iterations=12)
            fy, fx = oy - FULL_OFFSET[1], ox - FULL_OFFSET[0]
            src = full[fy:fy + h, fx:fx + w]
            region = seeds[s][y:y + h, x:x + w]
            region[keep] = src[keep]
        inpaint = grown & ~keep
        masks[s][y:y + h, x:x + w] |= inpaint
        stats[name] = {'reused_px': int(keep.sum()), 'inpainted_px': int((shape & ~keep).sum()),
                       'reused_share': round(float(keep.sum() / max(1, shape.sum())), 3)}
        print(name, stats[name])
    for s in range(layout['sheets']):
        Image.fromarray(seeds[s]).save(od / f'sheet-{s}-seed.png')
        m = Image.fromarray((masks[s] * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.GaussianBlur(2))
        m.convert('RGB').save(od / f'sheet-{s}-render-mask.png')
    (od / 'a2-stats.json').write_text(json.dumps(stats, indent=1))


if __name__ == '__main__':
    main()
