"""Costume recolour on raster pixels vs on vector layer colours, same maths as character/render/recolor.ts."""
import json, colorsys, numpy as np
from PIL import Image, ImageDraw
import vec, layered as L

def hsv(hexc):
    c = int(hexc[1:], 16); return np.array(colorsys.rgb_to_hsv((c >> 16 & 255) / 255, (c >> 8 & 255) / 255, (c & 255) / 255))

def shifts(costumes, i):
    base, cos = costumes['list'][0]['slots'], costumes['list'][i]['slots']
    out = []
    for r in costumes['regions']:
        h0, h1 = hsv(base[r['slot']]), hsv(cos[r['slot']])
        out.append((hsv(r['color']), np.array(r['tolerance']), np.array([h1[0] - h0[0], h1[1] / h0[1] if h0[1] else 1, h1[2] / h0[2] if h0[2] else 1])))
    return out

def recolor(rgb, sh):
    """rgb: N x 3 unpremultiplied 0..1."""
    hs = np.array([colorsys.rgb_to_hsv(*p) for p in rgb]).reshape(-1, 3)
    best = np.full(len(hs), 1e9); pick = np.full(len(hs), -1)
    for i, (key, tol, _) in enumerate(sh):
        d = np.abs(hs - key); d[:, 0] = np.minimum(d[:, 0], 1 - d[:, 0])
        dist = np.linalg.norm(d / tol, axis=1); m = dist < best; best[m] = dist[m]; pick[m] = i
    out = rgb.copy()
    for i, (_, _, s) in enumerate(sh):
        m = (pick == i) & (best < 1)
        if not m.any(): continue
        moved = np.stack([(hs[m, 0] + s[0]) % 1, np.clip(hs[m, 1] * s[1], 0, 1), np.clip(hs[m, 2] * s[2], 0, 1)], 1)
        mrgb = np.array([colorsys.hsv_to_rgb(*p) for p in moved])
        t = 1 - np.clip((best[m] - 0.6) / 0.4, 0, 1); t = t * t * (3 - 2 * t)
        out[m] = rgb[m] + (mrgb - rgb[m]) * t[:, None]
    return out

meta = json.load(open('src/meta.json'))
tiles = []
for name, ci in (('donkeykong__jab_3', 2), ('pikachu__idle_0', 1), ('link__idle_0', 2)):
    im = vec.load(f'src/{name}.png'); costumes = meta[name]['costumes']; sh = shifts(costumes, ci); scale = meta[name]['scale']
    a = np.asarray(im, np.float32) / 255
    flat = a[..., :3].reshape(-1, 3); solid = a[..., 3].reshape(-1) > 0
    rec = flat.copy(); rec[solid] = recolor(flat[solid], sh)
    raster = Image.fromarray((np.concatenate([rec.reshape(a.shape[:2] + (3,)), a[..., 3:]], -1) * 255 + .5).astype(np.uint8), 'RGBA')
    layers = L.trace(im, 'medium', scale)
    vlayers = [(recolor(np.array([c], np.float64), sh)[0], p) for c, p in layers]
    row = [vec.reference(raster, scale, vec.ZOOM_FINAL), L.render(vlayers, im.size, scale, vec.ZOOM_FINAL)]
    for r, lab in zip(row, (f'raster, costume {ci} ({costumes["list"][ci]["name"]})', f'vector layers, costume {ci}')):
        img = vec.over(r, (118, 124, 132)); t = Image.new('RGB', (img.width, img.height + 16), (30, 30, 30))
        ImageDraw.Draw(t).text((3, 2), lab, fill=(230, 230, 230)); t.paste(img, (0, 16)); tiles.append(t)
W = sum(t.width for t in tiles); H = max(t.height for t in tiles)
sheet = Image.new('RGB', (W, H), (20, 20, 20)); x = 0
for t in tiles: sheet.paste(t, (x, 0)); x += t.width
sheet.save('out/recolour.png', optimize=True)
