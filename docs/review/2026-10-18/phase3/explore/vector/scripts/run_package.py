"""Whole packages: trace every drawing (layered medium), count bytes/triangles, error at match size,
and compare with BC7, compressed raster files and 4-bit indexed storage."""
import json, sys, io, time
from multiprocessing import Pool
import numpy as np
from PIL import Image
import vec, layered as L

PK = '/home/lombet/Workspace/platform-fighter/.tmp/character-packages'
OUT = sys.argv[1]
_pages = {}


def page(c, file):
    key = (c, file)
    if key not in _pages:
        if len(_pages) > 8: _pages.clear()
        _pages[key] = Image.open(f'{PK}/{c}/{file}').convert('RGBA')
    return _pages[key]


def run(job):
    c, did, d, file = job
    x, y, w, h = d['rect']
    im = page(c, file).crop((x, y, x + w, y + h))
    scale = d['scale']
    t = time.time(); lay = L.trace(im, 'medium', scale); dt = time.time() - t
    m = L.measure(lay)
    ref = vec.reference(im, scale, vec.ZOOM_MATCH)
    e_vec = vec.error(ref, L.render(lay, im.size, scale, vec.ZOOM_MATCH))
    e_r2 = vec.error(ref, L.raster_at(im, 2, scale, vec.ZOOM_MATCH)[0])
    r_idx, idx_bytes = L.indexed(im, 16, scale, vec.ZOOM_MATCH)
    e_idx = vec.error(ref, r_idx)
    png = io.BytesIO(); im.save(png, 'PNG', compress_level=9)
    webp = io.BytesIO(); im.save(webp, 'WEBP', lossless=True, method=4)
    return {'c': c, 'id': did, 'w': w, 'h': h, 'scale': scale, 'bc7': vec.bc7_bytes(w, h), 'png': png.tell(),
            'webp': webp.tell(), 'indexed16': idx_bytes, 'traceSeconds': round(dt, 3), **m,
            'maeVector': round(e_vec['mae'], 4), 'maeRasterHalf': round(e_r2['mae'], 4), 'maeIndexed16': round(e_idx['mae'], 4)}


if __name__ == '__main__':
    jobs = []
    for c in ('donkeykong', 'link', 'pikachu'):
        p = json.load(open(f'{PK}/{c}/character.json'))
        for did, d in sorted(p['drawings'].items(), key=lambda kv: kv[1]['page']):
            jobs.append((c, did, d, p['pages'][d['page']]['file']))
    t = time.time()
    with Pool(20) as pool:
        rows = pool.map(run, jobs, chunksize=8)
    json.dump(rows, open(f'{OUT}/package-drawings.json', 'w'))
    print('done', len(rows), round(time.time() - t, 1), 's')
