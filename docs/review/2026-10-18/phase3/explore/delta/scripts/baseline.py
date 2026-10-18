"""Tile-storage baseline without reuse: non-empty root-aligned tiles, and the same tiles stored in
horizontal runs with a 2 px gutter (4-aligned), as patch_reuse counts its new tiles."""
import sys, json, math, numpy as np
sys.path.insert(0, '.')
from common import Package, place, nonempty
from multiprocessing import Pool
def one(f):
    pk = Package(f); out = {}
    for T in (8, 16, 32):
        rect = ne = gut = 0
        for d in pk.pkg['drawings']:
            img, (ax, ay), _ = pk.drawing(d); ax, ay = int(round(ax)), int(round(ay))
            C, _ = place(img, (ax, ay), T); m = nonempty(C, T)
            rect += img.shape[0] * img.shape[1]; ne += int(m.sum()) * T * T
            for row in m:
                run = 0
                for v in list(row) + [False]:
                    if v: run += 1
                    elif run: gut += math.ceil((run * T + 4) / 4) * 4 * math.ceil((T + 4) / 4) * 4; run = 0
        out[T] = dict(rect=rect, nonempty=ne / rect, nonempty_gutter=gut / rect)
    return f, out
with Pool(3) as p: res = dict(p.map(one, ['donkeykong', 'link', 'pikachu']))
print(json.dumps(res, indent=1)); json.dump(res, open('baseline.json', 'w'), indent=1)
