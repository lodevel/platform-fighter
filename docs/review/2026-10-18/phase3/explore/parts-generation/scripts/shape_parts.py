"""Turn native per-part renders into clean part SHAPES and pack them onto generation sheets.

A part shape = its core triangles + a rounded disc at every joint (overlap material), smoothed.
Inside the shape, material classes come from the core render, the cap render (neighbouring mesh
around the joint) or the nearest core class. Interior guide lines come from the core render only.

usage: python3 shape_parts.py NATIVE_DIR OUT_DIR
Writes OUT_DIR/parts/<part>.npz (mask, classes, interior lines, joints) and OUT_DIR/sheet-<n>-{seed,guide,
render-mask}.png + OUT_DIR/layout.json.
"""
import json, sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

PALETTE = {  # class -> rgb (docs/review/.../rework-2026-10-10/art/fighter.json)
    'background': (204, 73, 140), 'fur': (112, 64, 34), 'skin': (236, 188, 130), 'tie': (214, 36, 36),
    'tie_lettering': (250, 210, 60), 'mouth': (60, 22, 22), 'eye_white': (250, 248, 240), 'iris': (70, 40, 20),
    'pupil': (22, 17, 16), 'teeth': (250, 244, 224), 'brow': (74, 40, 22)}
NAMES = list(PALETTE)
PAL = np.array(list(PALETTE.values()), np.int16)
INK = (22, 17, 16)

# part -> (native render name, parent, pivot bone, child joints {name: bone})
RIG = {
    'torso': ('torso', None, 'Hip', {'neck': 'Neck', 'tie': 'Necktie', 'shoulder_near': 'ShoulderR', 'shoulder_far': 'ShoulderL',
                                     'hip_near': 'LegR', 'hip_far': 'LegL'}),
    'head': ('head', 'torso', 'Neck', {}),
    'head_shout': ('head-shout', 'torso', 'Neck', {}),
    'head_grit': ('head-grit', 'torso', 'Neck', {}),
    'tie': ('tie', 'torso', 'Necktie', {}),
}
for side, s in (('near', 'R'), ('far', 'L')):
    RIG.update({
        f'upper_arm_{side}': (f'upper_arm_{s}', 'torso', f'Shoulder{s}', {'elbow': f'Arm{s}'}),
        f'forearm_{side}': (f'forearm_{s}', f'upper_arm_{side}', f'Arm{s}', {'wrist': f'Hand{s}'}),
        f'fist_{side}': (f'hand_{s}', f'forearm_{side}', f'Hand{s}', {}),
        f'open_hand_{side}': (f'hand_{s}-open', f'forearm_{side}', f'Hand{s}', {}),
        f'thigh_{side}': (f'thigh_{s}', 'torso', f'Leg{s}', {'knee': f'Knee{s}'}),
        f'shin_{side}': (f'shin_{s}', f'thigh_{side}', f'Knee{s}', {'ankle': f'Foot{s}'}),
        f'foot_{side}': (f'foot_{s}', f'shin_{side}', f'Foot{s}', {}),
    })
NO_PIVOT_DISC = {'torso', 'tie'}   # base part / hangs from the knot under the head


def classes_from_seed(seed):
    rgb = seed.astype(np.int16)
    d = np.abs(rgb[:, :, None, :] - PAL[None, None]).sum(-1)
    cls = d.argmin(-1).astype(np.uint8)
    ok = d.min(-1) == 0
    return cls, ok


def disc(shape, c, r):
    yy, xx = np.ogrid[:shape[0], :shape[1]]
    return (xx - c[0]) ** 2 + (yy - c[1]) ** 2 <= r * r


def shape_part(nd, name, joints):
    native, parent, pivot, children = RIG[name]
    core = np.asarray(Image.open(nd / f'{native}-core-mask.png')) > 0
    cap = np.asarray(Image.open(nd / f'{native}-cap-mask.png')) > 0
    core_seed = np.asarray(Image.open(nd / f'{native}-core-seed.png').convert('RGB'))
    cap_seed = np.asarray(Image.open(nd / f'{native}-cap-seed.png').convert('RGB'))
    core_guide = np.asarray(Image.open(nd / f'{native}-core-guide.png').convert('L')) > 0
    depth = np.load(nd / f'{native}-core-depth.npy')
    core_cls, core_ok = classes_from_seed(core_seed)
    cap_cls, cap_ok = classes_from_seed(cap_seed)
    dt = ndimage.distance_transform_edt(core | cap)
    mask = core.copy()
    points = {'pivot': joints[pivot][:2], **{k: joints[b][:2] for k, b in children.items()}}
    radii = {}
    for k, p in points.items():
        if k == 'pivot' and name in NO_PIVOT_DISC or name == 'torso':
            continue
        x, y = int(round(p[0])), int(round(p[1]))
        win = dt[max(0, y - 20):y + 21, max(0, x - 20):x + 21]
        r = float(np.clip(win.max() * 0.95 if win.size else 20, 18, 90))
        radii[k] = r
        mask |= disc(mask.shape, p, r) & ndimage.binary_dilation(core | cap, iterations=4)
    # smooth the jagged triangle cuts: close, then round by blur-threshold
    mask = ndimage.binary_closing(mask, structure=disc((13, 13), (6, 6), 6), iterations=1)
    mask = ndimage.binary_fill_holes(mask)
    mask = ndimage.gaussian_filter(mask.astype(float), 7.0 if name == 'torso' else 3.0) > 0.5
    k = 10 if name == 'torso' else 3   # torso: remove the spikes left by the shoulder/neck cuts
    mask = ndimage.binary_opening(mask, structure=disc((2 * k + 1, 2 * k + 1), (k, k), k))
    lab, n = ndimage.label(mask)
    if n > 1:
        sizes = ndimage.sum(mask, lab, range(1, n + 1)); mask = lab == (1 + int(np.argmax(sizes)))
    # classes: core where valid, else cap, else nearest valid core class
    plain = name.split('_')[0] in ('upper', 'forearm', 'thigh', 'shin', 'torso')
    valid = core & core_ok & (core_cls != 0)
    if plain:   # occlusion ink read back as the pupil class: mesh creases, not drawing lines
        valid &= core_cls != NAMES.index('pupil')
    cls = np.zeros(mask.shape, np.uint8)
    cls[valid] = core_cls[valid]
    known = valid   # joint discs take the part's own nearest material, never the neighbour's
    idx = ndimage.distance_transform_edt(~known, return_distances=False, return_indices=True)
    fill = mask & ~known
    cls[fill] = cls[idx[0][fill], idx[1][fill]]
    cls[~mask] = 0
    # interior guide lines: core lines away from the core's own (jagged) cut boundary
    inner = core_guide & ndimage.binary_erosion(core, iterations=5) & mask
    if plain:
        inner[:] = False   # plain limb segments: mesh crease lines read as cuts; the generator draws its own folds
    d = np.where(np.isfinite(depth), depth, np.nan)
    return mask, cls, inner, points, radii, float(np.nanmedian(d)), parent


def guide_and_seed(mask, cls, inner):
    border = np.zeros(mask.shape, bool)
    for ax in (0, 1):
        border |= mask & np.roll(mask, 1, ax) & (cls != np.roll(cls, 1, ax))
    sil = mask & ~ndimage.binary_erosion(mask)
    lines = sil | border | inner
    guide = np.asarray(Image.fromarray((lines * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(3)))
    seed = PAL[cls].astype(np.uint8)
    seed[~mask] = PALETTE['background']
    outer = np.asarray(Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(5))) > 0
    seed[outer & ~mask] = INK
    seed[inner] = INK
    return guide, seed


def pack(items, W, H, gap):
    """Shelf packing, tallest first. items: [(name, w, h)] -> {name: (sheet, x, y)}."""
    out, sheet, x, y, shelf = {}, 0, gap, gap, 0
    for name, w, h in sorted(items, key=lambda t: -t[2]):
        if x + w + gap > W:
            x, y, shelf = gap, y + shelf + gap, 0
        if y + h + gap > H:
            sheet, x, y, shelf = sheet + 1, gap, gap, 0
        out[name] = (sheet, x, y); x += w + gap; shelf = max(shelf, h)
    return out


BASE_OF = {'head_shout': 'head', 'head_grit': 'head', 'open_hand_near': 'fist_near', 'open_hand_far': 'fist_far'}


def draw_order(nd, meta):
    """Back-to-front order from the whole-body z-buffer: in the overlap of two parts' cap masks, the part the
    native render shows more often is in front. Variants take their base part's place."""
    vis = np.asarray(Image.open(nd / 'visible-parts.png'))
    ids = meta['visible_part_ids']
    names = [n for n in RIG if n not in BASE_OF]
    masks = {n: np.asarray(Image.open(nd / f'{RIG[n][0]}-cap-mask.png')) > 0 for n in names}
    score = {n: 0.0 for n in names}
    front = {}
    for i, a in enumerate(names):
        for b in names[i + 1:]:
            ov = masks[a] & masks[b]
            if ov.sum() < 50:
                continue
            va, vb = int((vis[ov] == ids[RIG[a][0]]).sum()), int((vis[ov] == ids[RIG[b][0]]).sum())
            if va != vb:
                front[(a, b) if va > vb else (b, a)] = abs(va - vb)
    # topological sort (Kahn); cycles broken by the weakest edge
    order, left = [], set(names)
    while left:
        back = [n for n in left if not any((n, m) in front for m in left if m != n)]
        pick = sorted(back)[0] if back else min(left, key=lambda n: sum(w for (f, _), w in front.items() if f == n and _ in left))
        order.append(pick); left.remove(pick)
    full = []
    for n in order:
        full.append(n); full += [v for v, b in BASE_OF.items() if b == n]
    return full


def main():
    nd, od = Path(sys.argv[1]), Path(sys.argv[2])
    W, H = (int(sys.argv[3]), int(sys.argv[4])) if len(sys.argv) > 4 else (1536, 1024)
    GAP = 56
    (od / 'parts').mkdir(parents=True, exist_ok=True)
    meta = json.loads((nd / 'parts-native.json').read_text())
    joints = meta['joints_art_px']
    parts = {}
    for name in RIG:
        mask, cls, inner, points, radii, depth, parent = shape_part(nd, name, joints)
        ys, xs = np.nonzero(mask)
        x0, y0, x1, y1 = xs.min() - 8, ys.min() - 8, xs.max() + 9, ys.max() + 9
        crop = np.s_[y0:y1, x0:x1]
        guide, seed = guide_and_seed(mask[crop], cls[crop], inner[crop])
        np.savez_compressed(od / 'parts' / f'{name}.npz', mask=mask[crop], cls=cls[crop], inner=inner[crop])
        Image.fromarray(seed).save(od / 'parts' / f'{name}-seed.png')
        parts[name] = {'native': RIG[name][0], 'parent': parent, 'origin_art': [int(x0), int(y0)], 'size': [int(x1 - x0), int(y1 - y0)],
                       'joints': {k: [p[0] - x0, p[1] - y0] for k, p in points.items()}, 'cap_radius': radii, 'depth': depth,
                       'pixels': int(mask.sum())}
        print(name, parts[name]['size'], {k: round(v) for k, v in radii.items()})
    place = pack([(n, p['size'][0], p['size'][1]) for n, p in parts.items()], W, H, GAP)
    nsheets = 1 + max(s for s, _, _ in place.values())
    for s in range(nsheets):
        seed = np.zeros((H, W, 3), np.uint8); seed[:] = PALETTE['background']
        guide = np.zeros((H, W), np.uint8); shapes = np.zeros((H, W), bool)
        for n, (sh, x, y) in place.items():
            if sh != s:
                continue
            z = np.load(od / 'parts' / f'{n}.npz'); g, sd = guide_and_seed(z['mask'], z['cls'], z['inner'])
            h, w = z['mask'].shape
            region = np.s_[y:y + h, x:x + w]
            outer = np.asarray(Image.fromarray((z['mask'] * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(5))) > 0
            seed[region][outer] = sd[outer]; guide[region] = np.maximum(guide[region], g); shapes[region] |= z['mask']
        Image.fromarray(seed).save(od / f'sheet-{s}-seed.png'); Image.fromarray(guide).save(od / f'sheet-{s}-guide.png')
        Image.fromarray((shapes * 255).astype(np.uint8)).save(od / f'sheet-{s}-shapes.png')
        rm = Image.fromarray((shapes * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(21)).filter(ImageFilter.GaussianBlur(2))
        rm.convert('RGB').save(od / f'sheet-{s}-render-mask.png')
    for n, (sh, x, y) in place.items():
        parts[n]['sheet'] = [sh, x, y]
    order = draw_order(nd, meta)
    for n in parts:
        parts[n]['draw_order'] = order.index(n)
    print('draw order (back to front):', order)
    (od / 'layout.json').write_text(json.dumps({'sheet_size': [W, H], 'sheets': nsheets, 'rest': meta['rest'],
                                                 'art_px_per_native_unit': meta['art_px_per_native_unit'],
                                                 'joints_art_px': joints, 'parts': parts}, indent=1))
    print('sheets', nsheets)


if __name__ == '__main__':
    main()
