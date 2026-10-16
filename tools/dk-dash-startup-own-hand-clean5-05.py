"""Deterministic hand clean5 for DK dash-grab startup drawings (native1, native4).

clean4 parent -> (1) RGB-only pink/magenta fingertip-rim defringe inside the hand
mask, (2) source-derived occlusion lines drawn in the standing-grab hand linework
colour/weight. Alpha is byte-identical; nothing outside the hand mask changes.
No diffusion, no GPU, no randomness. Run: ~/ComfyUI/.venv/bin/python -I <this>
"""
from pathlib import Path
import argparse, hashlib, json
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parents[1]
ART = ROOT / 'docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/art'
STRIP = ROOT / 'assets/characters/donkeykong/animations/grab.png'
PREFIX = 'dk-fullgrab-dash-startup01-attempt1-dash_grab-native{n}-material-clean5-'
LIGHT, DARK = (247, 246, 238), (25, 30, 39)
SS = 4            # supersampling for line drawing
WIDTH_SCALE = 4   # strip cell -> 1536 canvas (user-specified)

HANDS = {
    1: {'rear': (562, 135, 777, 339), 'fore': (784, 545, 998, 777)},
    4: {'rear': (350, 80, 568, 272), 'fore': (806, 612, 944, 802)},
}
# Line contours: box-local polygons (x,y) restricting the ridge extraction.
LINES = {
    (1, 'rear'): [[(58, 50), (140, 50), (140, 125), (58, 125)]],           # thumb tip over middle digits
    (4, 'rear'): [[(94, 40), (146, 40), (146, 130), (94, 130)]],           # folded finger crease
    (4, 'fore'): [[(86, 55), (108, 55), (108, 138), (84, 138)]],           # curled finger fold
}
RIDGE_LO, RIDGE_HI, ERODE, MIN_LEN = 2.0, 10.0, 7, 25
# strip measurement ROIs: (cell index, x0,y0,x1,y1) on fist hands with crease lines
STRIP_ROIS = [(6, 215, 158, 235, 192), (8, 65, 150, 95, 195)]


def sha(p): return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def pin(p): return {'path': str(Path(p).relative_to(ROOT)), 'sha256': sha(p)}
def lum(a): return a[..., :3].astype(float) @ [.299, .587, .114]


def is_skin_like(rgb):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    return (r > 225) & (g > 185) & (b > 120) & (b < 190) & (r - g < 60)


def measure_strip():
    im = np.asarray(Image.open(STRIP).convert('RGBA')).astype(int)
    cores, widths, per = [], [], []
    for k, x0, y0, x1, y1 in STRIP_ROIS:
        c = im[y0:y1, k * 256 + x0:k * 256 + x1]
        rgb = c[..., :3]; opaque = c[..., 3] >= 250
        skin = np.median(rgb[opaque & is_skin_like(rgb)], axis=0)
        line = opaque & (rgb[..., 1] >= 90) & (rgb[..., 0] < 235) & (lum(rgb) < lum(skin) - 8)
        core_px = opaque & (rgb[..., 1] < 135) & (rgb[..., 1] >= 90)
        cores.append(rgb[core_px])
        lab, cnt = ndi.label(line, structure=np.ones((3, 3)))
        Ls = lum(skin[None, :])[0]
        for i in range(1, cnt + 1):
            ys, xs = np.nonzero(lab == i)
            ext = xs.max() - xs.min() + 1
            if ext < 8: continue
            per.append((k, int(ext), float(((Ls - lum(rgb[ys, xs])) / (Ls - 118.0)).clip(0, 1).sum())))
    core = np.round(np.median(np.concatenate(cores), axis=0)).astype(int)
    Lc = float(lum(core[None, :])[0])
    # recompute widths with the final core luminance
    ws = []
    for k, x0, y0, x1, y1 in STRIP_ROIS:
        c = im[y0:y1, k * 256 + x0:k * 256 + x1]; rgb = c[..., :3]; opaque = c[..., 3] >= 250
        skin = np.median(rgb[opaque & is_skin_like(rgb)], axis=0); Ls = lum(skin[None, :])[0]
        line = opaque & (rgb[..., 1] >= 90) & (rgb[..., 0] < 235) & (lum(rgb) < Ls - 8)
        lab, cnt = ndi.label(line, structure=np.ones((3, 3)))
        for i in range(1, cnt + 1):
            ys, xs = np.nonzero(lab == i); ext = xs.max() - xs.min() + 1
            if ext < 8: continue
            ws.append((k, int(ext), float(((Ls - lum(rgb[ys, xs])) / (Ls - Lc)).clip(0, 1).sum() / ext)))
    w = float(np.median([x[2] for x in ws]))
    return {'coreRGB': [int(v) for v in core], 'cellWidthPx': round(w, 3), 'widthPx1536': round(w * WIDTH_SCALE, 3),
            'widthScale': WIDTH_SCALE, 'components': [{'cell': a, 'xExtent': b, 'width': round(c, 3)} for a, b, c in ws],
            'rois': STRIP_ROIS, 'strip': pin(STRIP)}


def defringe(rgb, alpha, hand):
    """RGB-only: returns new rgb and the changed mask."""
    rgbi = rgb.astype(int); r, g, b = rgbi[..., 0], rgbi[..., 1], rgbi[..., 2]
    op = alpha == 255
    inner = ndi.binary_erosion(alpha > 0, iterations=3)
    seed = hand & op & inner & is_skin_like(rgb)
    skin = np.median(rgbi[seed], axis=0)
    # tint test relative to median skin: pinker (more blue-over-green, more red-over-green) or redder/darker
    d_bg = (b - g) - (skin[2] - skin[1]); d_rg = (r - g) - (skin[0] - skin[1])
    tinted = (d_bg > 14) | (d_rg > 24) | ((g < skin[1] - 40) & (r > 120) & (r - g > 55))
    # protect the red fur cuff: large strong-red opaque component (+3 px blend ring)
    strong = op & (r > 140) & (g < 100) & (r - g > 90)
    lab, cnt = ndi.label(strong, structure=np.ones((3, 3)))
    sizes = ndi.sum(strong, lab, range(1, cnt + 1))
    big = np.isin(lab, [i + 1 for i, s in enumerate(sizes) if s >= 400])
    cuff = ndi.binary_dilation(big, iterations=3)
    target = hand & (alpha > 0) & tinted & ~cuff
    valid = hand & op & inner & ~tinted & is_skin_like(rgb)
    _, (iy, ix) = ndi.distance_transform_edt(~valid, return_indices=True)
    out = rgb.copy(); out[target] = rgb[iy[target], ix[target]]
    return out, target, {'medianSkinRGB': [int(v) for v in skin], 'cuffProtectedPx': int((cuff & hand).sum()),
                         'skinSeedPx': int(seed.sum())}


def ridges(src, c4alpha, hand):
    s = src.astype(float); L = ndi.gaussian_filter(lum(s), 1.2)
    gy, gx = np.gradient(L); g = np.hypot(gx, gy)
    H, W = g.shape; yy, xx = np.mgrid[:H, :W]; ux = gx / (g + 1e-9); uy = gy / (g + 1e-9)
    a = ndi.map_coordinates(g, [yy + uy, xx + ux], order=1); b = ndi.map_coordinates(g, [yy - uy, xx - ux], order=1)
    er = ndi.binary_erosion((src[..., 3] > 128) & (c4alpha > 128), iterations=ERODE) & hand
    nms = (g >= a) & (g >= b) & er
    low = nms & (g > RIDGE_LO); lab, _ = ndi.label(low, structure=np.ones((3, 3)))
    ids = np.unique(lab[low & (g > RIDGE_HI)]); return np.isin(lab, ids[ids > 0])


def poly_mask(shape, polys, ox, oy):
    im = Image.new('L', (shape[1], shape[0]), 0); d = ImageDraw.Draw(im)
    for p in polys: d.polygon([(x + ox, y + oy) for x, y in p], fill=1)
    return np.asarray(im) > 0


def draw_coverage(shape, pts_mask, width):
    """Anti-aliased even-weight coverage: stamp discs of diameter `width` on an SS grid."""
    ys, xs = np.nonzero(pts_mask)
    if len(ys) == 0: return np.zeros(shape)
    y0, y1, x0, x1 = ys.min() - 6, ys.max() + 7, xs.min() - 6, xs.max() + 7
    big = Image.new('L', ((x1 - x0) * SS, (y1 - y0) * SS), 0); d = ImageDraw.Draw(big); r = width * SS / 2
    for y, x in zip(ys, xs):
        cx, cy = (x - x0 + .5) * SS, (y - y0 + .5) * SS; d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=255)
    cov = np.asarray(big.resize((x1 - x0, y1 - y0), Image.BOX)).astype(float) / 255
    out = np.zeros(shape); out[y0:y1, x0:x1] = cov; return out


def on_bg(rgba, bg):
    base = Image.new('RGBA', rgba.size, bg + (255,)); base.alpha_composite(rgba); return base.convert('RGB')


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--out-dir', type=Path, default=ART); args = ap.parse_args()
    meas = measure_strip(); width = meas['widthPx1536']; core = np.array(meas['coreRGB'])
    for n in (1, 4):
        pre = PREFIX.format(n=n); out = args.out_dir
        if list(out.glob(pre + '*')) and out == ART: raise SystemExit('clean5 outputs exist; versioned outputs are never overwritten')
        P = {'c4': ART / f'dk-fullgrab-dash-startup01-attempt1-dash_grab-native{n}-material-clean4-cutout.png',
             'src': ART / f'fullgrab01-dash_grab-native{n}-reference.png',
             'mask': ART / f'dk-fullgrab-dash-startup01-attempt2-localhand-native{n}-hand-mask.png',
             'decision': ART / 'root-full-dash-grab-startup-attempt2-actual-output-review-01.json'}
        c4 = np.asarray(Image.open(P['c4']).convert('RGBA')); src = np.asarray(Image.open(P['src']).convert('RGBA'))
        hand = np.asarray(Image.open(P['mask']).convert('L')) > 0
        assert c4.shape == (1024, 1536, 4) and src.shape == c4.shape and hand.shape == c4.shape[:2]
        alpha = c4[..., 3]
        rgb2, fr, fstat = defringe(c4[..., :3], alpha, hand)
        res = c4.copy(); res[..., :3] = rgb2
        line_cov = np.zeros(alpha.shape); rec_lines = {}
        ridge_all = ridges(src, alpha, hand)
        for (nn, name), polys in LINES.items():
            if nn != n: continue
            x0, y0, x1, y1 = HANDS[n][name]
            sel = ridge_all & poly_mask(alpha.shape, polys, x0, y0)
            lab, cnt = ndi.label(sel, structure=np.ones((3, 3)))
            keep = np.zeros_like(sel)
            for i in range(1, cnt + 1):
                if (lab == i).sum() >= MIN_LEN: keep |= lab == i
            line_cov = np.maximum(line_cov, draw_coverage(alpha.shape, keep, width))
            rec_lines[name] = {'polygonsBoxLocal': polys, 'ridgePx': int(keep.sum()), 'box': [x0, y0, x1, y1]}
        line_cov *= (hand & (alpha > 0))
        cv = line_cov[..., None]
        res[..., :3] = np.round(res[..., :3] * (1 - cv) + core[None, None, :] * cv).astype(np.uint8)
        # assertions
        assert np.array_equal(res[..., 3], c4[..., 3])
        diff = np.any(res != c4, axis=2)
        assert not diff[~hand].any(), 'pixels changed outside hand mask'
        files = {}
        def save(name, im): p = out / (pre + name); im.save(p); files[name] = pin(p) if out == ART else {'path': str(p), 'sha256': sha(p)}
        rim = Image.fromarray(res, 'RGBA'); save('cutout.png', rim)
        light, dark = on_bg(rim, LIGHT), on_bg(rim, DARK); save('light.png', light); save('dark.png', dark)
        s_im, c_im = Image.fromarray(src, 'RGBA'), Image.fromarray(c4, 'RGBA')
        for name, box in HANDS[n].items():
            for bgn, bg in (('light', LIGHT), ('dark', DARK)):
                tiles = [on_bg(im.crop(box), bg) for im in (s_im, c_im, rim)]
                w, h = tiles[0].size; sheet = Image.new('RGB', (w * 3 + 8, h), (128, 128, 128))
                for i, t in enumerate(tiles): sheet.paste(t, (i * (w + 4), 0))
                save(f'{name}hand-compare-{bgn}.png', sheet)
        counts = {}
        for name, (x0, y0, x1, y1) in HANDS[n].items():
            sub = diff[y0:y1, x0:x1]; counts[name] = {'changedPx': int(sub.sum()), 'defringePx': int(fr[y0:y1, x0:x1].sum()),
                                                      'linePx': int((line_cov[y0:y1, x0:x1] > 0).sum())}
        counts['totalChangedPx'] = int(diff.sum()); counts['alphaIdentical'] = True; counts['outsideHandMaskChangedPx'] = 0
        receipt = {'state': 'OWN_DETERMINISTIC_HAND_CLEAN5_ACTUAL_ROOT_REVIEW_PENDING', 'accepted': False, 'native': n,
                   'tool': pin(Path(__file__).resolve()), 'inputs': {k: pin(v) for k, v in P.items()},
                   'defringe': {'rule': 'inside hand mask, alpha>0: tinted if (B-G)-(skinB-skinG)>14 or (R-G)-(skinR-skinG)>24 or (G<skinG-40 and R>120 and R-G>55); skin = median of opaque inner skin-like pixels; excluded = strong-red opaque components >=400px dilated 3px (red fur cuff); replacement = nearest untinted opaque inner skin pixel RGB; alpha untouched',
                                **fstat},
                   'lineMeasurement': meas, 'lineParams': {'ridgeLo': RIDGE_LO, 'ridgeHi': RIDGE_HI, 'alphaErodePx': ERODE, 'minLenPx': MIN_LEN, 'drawWidthPx': width, 'colorRGB': meas['coreRGB'], 'supersample': SS},
                   'lines': rec_lines, 'changedCounts': counts, 'outputs': files}
        (out / (pre + 'receipt.json')).write_text(json.dumps(receipt, indent=1))
        print(n, json.dumps(counts), meas['coreRGB'], width)


if __name__ == '__main__': main()
