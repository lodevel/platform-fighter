"""Cut generated parts out of sheet renders, close their outlines, downscale to drawing resolution, write parts.json.

usage: python post_parts.py LAYOUT.json OUT_DIR SHEET0.png [SHEET1.png ...]
Per part: key out the flat magenta (same key as rework-2026-10-10/art/dk-cutout.py), keep only what lies inside the
part's planned shape grown by GROW art px (stops neighbours/bleed), keep the largest component, darken a closed outline
ring where the generator left none, downscale by ART_TO_SOURCE (art px -> source px of today's drawings).
"""
import json, sys
from pathlib import Path
import numpy as np
from PIL import Image
from scipy import ndimage

KEY = np.array([204, 73, 140.])
INK = np.array([22, 17, 16.])
ART_TO_SOURCE = 0.1704901934040754 / 0.4666667   # design px per art px / design px per source px
GROW = 10
RING = 4            # art px outline width enforced (~1.5 source px)

PARENT_JOINT = {'head': 'neck', 'head_shout': 'neck', 'head_grit': 'neck', 'tie': 'tie'}
for side in ('near', 'far'):
    PARENT_JOINT.update({f'upper_arm_{side}': f'shoulder_{side}', f'forearm_{side}': 'elbow', f'fist_{side}': 'wrist',
                         f'open_hand_{side}': 'wrist', f'thigh_{side}': f'hip_{side}', f'shin_{side}': 'knee', f'foot_{side}': 'ankle'})
SLOTS = {'head': ['head', 'head_shout', 'head_grit'], 'hand_near': ['fist_near', 'open_hand_near'],
         'hand_far': ['fist_far', 'open_hand_far']}


def key_alpha(rgb):
    d = np.linalg.norm(rgb - KEY, axis=2)
    return np.clip((d - 18) / (60 - 18), 0, 1)


def cut(sheet, p, z):
    sh, x, y = p['sheet']
    h, w = z['mask'].shape
    m = GROW + 4
    big = np.zeros((h + 2 * m, w + 2 * m, 3))
    ys, xs = slice(max(0, y - m), y + h + m), slice(max(0, x - m), x + w + m)
    src = sheet[ys, xs]
    big[:] = KEY
    big[(max(0, y - m) - (y - m)):(max(0, y - m) - (y - m)) + src.shape[0], (max(0, x - m) - (x - m)):(max(0, x - m) - (x - m)) + src.shape[1]] = src
    shape = np.zeros(big.shape[:2], bool); shape[m:m + h, m:m + w] = z['mask']
    allowed = ndimage.binary_dilation(shape, iterations=GROW)
    alpha = key_alpha(big) * allowed
    solid = alpha > 0.5
    lab, n = ndimage.label(solid, structure=np.ones((3, 3)))
    if n > 1:
        sizes = ndimage.sum(solid, lab, range(1, n + 1)); keep = lab == 1 + int(np.argmax(sizes))
        alpha = np.where(ndimage.binary_dilation(keep, iterations=2), alpha, 0)
    alpha = np.where(ndimage.binary_fill_holes(alpha > 0.5), np.maximum(alpha, 1.0 * ndimage.binary_fill_holes(alpha > 0.5)), alpha)
    # despill: edge / pink pixels take the nearest solid interior colour
    core = ndimage.binary_erosion(alpha > 0.98, iterations=2)
    r, g, b = big[..., 0], big[..., 1], big[..., 2]
    pink = (r > 140) & (b > 90) & (g < 0.78 * np.minimum(r, b) + 20) & (b > g * 1.25)
    core &= ~pink
    idx = ndimage.distance_transform_edt(~core, return_distances=False, return_indices=True)
    rec = (alpha > 0) & (~core | pink)
    rgb = big.copy(); rgb[rec] = big[idx[0][rec], idx[1][rec]]
    # outline closure: measure how much of the silhouette edge the generator already inked, then ink the rest
    solid = alpha > 0.5
    ring = solid & ~ndimage.binary_erosion(solid, iterations=RING)
    edge = solid & ~ndimage.binary_erosion(solid, iterations=2)
    dark = rgb.mean(2) < 75
    near_dark = ndimage.binary_dilation(dark, iterations=2)
    inked_before = float((edge & near_dark).sum() / max(1, edge.sum()))
    rgb[ring] = rgb[ring] * 0.15 + INK * 0.85
    return rgb, alpha, m, inked_before


def downscale(rgb, alpha, f):
    h, w = alpha.shape
    W, H = max(1, round(w * f)), max(1, round(h * f))
    pre = np.dstack((rgb * alpha[..., None], alpha * 255)).astype(np.float32)
    chans = [np.asarray(Image.fromarray(pre[..., i]).resize((W, H), Image.Resampling.LANCZOS)) for i in range(4)]
    a = np.clip(chans[3], 0, 255)
    col = np.stack(chans[:3], -1) / np.maximum(a[..., None] / 255, 1e-4)
    out = np.dstack((np.clip(col, 0, 255), a)).astype(np.uint8)
    out[a < 1] = 0
    return Image.fromarray(out, 'RGBA'), (W / w, H / h)


def main():
    layout = json.loads(Path(sys.argv[1]).read_text())
    od = Path(sys.argv[2]); od.mkdir(parents=True, exist_ok=True)
    sheets = [np.asarray(Image.open(s).convert('RGB')).astype(float) for s in sys.argv[3:]]
    parts_dir = Path(sys.argv[1]).parent / 'parts'
    order = sorted(layout['parts'], key=lambda n: layout['parts'][n]['draw_order'])   # back to front (z-buffer pairs)
    out = {'schema': 'dk-cutout-parts/1',
           'units': 'pixels of each part PNG = source px of the fighter drawings; 1 px = 0.4666667 design px',
           'designPxPerPx': 0.4666667,
           'view': 'fighting view, right-facing 3/4 (native Donkey Kong mesh, c00attack11 sample 18 = jab guard)',
           'root': 'ground root; torso.restPivot is the torso pivot (hip) relative to it',
           'slots': SLOTS, 'parts': {}}
    stats = {}
    joints_art = layout['joints_art_px']
    root_art = (1024, 1152)
    for name in order:
        p = layout['parts'][name]
        z = np.load(parts_dir / f'{name}.npz')
        rgb, alpha, m, inked = cut(sheets[p['sheet'][0]], p, z)
        img, (fx, fy) = downscale(rgb, alpha, ART_TO_SOURCE)
        img.save(od / f'{name}.png')
        def tr(pt):
            return [round((pt[0] + m) * fx, 2), round((pt[1] + m) * fy, 2)]
        j = {k: tr(v) for k, v in p['joints'].items()}
        rec = {'file': f'{name}.png', 'size': list(img.size), 'pivot': j.pop('pivot'), 'joints': j,
               'parent': p['parent'], 'parentJoint': PARENT_JOINT.get(name), 'drawOrder': order.index(name),
               'capRadius': {k: round(v * ART_TO_SOURCE, 1) for k, v in p['cap_radius'].items()}}
        if name == 'torso':
            hip = joints_art['Hip']
            rec['restPivot'] = [round((hip[0] - root_art[0]) * ART_TO_SOURCE, 2), round((hip[1] - root_art[1]) * ART_TO_SOURCE, 2)]
        out['parts'][name] = rec
        stats[name] = {'outline_inked_by_generator': round(inked, 3), 'size': list(img.size),
                       'opaque_px': int((np.asarray(img)[..., 3] > 127).sum())}
    (od / 'parts.json').write_text(json.dumps(out, indent=1))
    (od / 'post-stats.json').write_text(json.dumps(stats, indent=1))
    for n, s in stats.items():
        print(n, s)


if __name__ == '__main__':
    main()
