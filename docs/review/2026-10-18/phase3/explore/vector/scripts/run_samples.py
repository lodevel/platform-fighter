"""Every method on every sample drawing: bytes, triangles, error at zoom 1.4 and 2.8, strips."""
import json, sys, time, os
from multiprocessing import Pool
import numpy as np
from PIL import Image, ImageDraw
import vec, layered as L

SRC = sys.argv[1]; OUT = sys.argv[2]
META = json.load(open(f'{SRC}/meta.json'))


def vector_entry(layers_or_svg, kind, scale, im):
    if kind == 'vtracer':
        m = vec.measure(layers_or_svg, scale)
        return {'storedBytes': m['binaryBytes'], 'svgGzip': m['svgGzip'], 'verts': m['verts_final'],
                'tris': m['tris_final'], 'gpuBytes': m['gpuBytes_final'], 'paths': m['paths']}
    m = L.measure(layers_or_svg)
    return {'storedBytes': m['storedBytes'], 'verts': m['verts'], 'tris': m['tris'], 'gpuBytes': m['gpuBytes'],
            'paths': m['layers']}


def run(name):
    meta = META[name]; scale = meta['scale']
    im = vec.load(f'{SRC}/{name}.png')
    w0, h0 = im.size
    res = {'name': name, 'size': [w0, h0], 'scale': scale, 'bc7Bytes': vec.bc7_bytes(w0, h0), 'methods': {}}
    t = time.time(); svg_vt = vec.trace(im, 'medium'); t_vt = time.time() - t
    layered = {}
    for lv in L.LEVELS:
        t = time.time(); layered[lv] = (L.trace(im, lv, scale), time.time() - t)
    shown = {}
    for zoom in (vec.ZOOM_MATCH, vec.ZOOM_FINAL):
        ref = vec.reference(im, scale, zoom)
        w, h = ref.shape[1], ref.shape[0]
        cands = {'original (BC7)': (ref, {'bytes': res['bc7Bytes']})}
        for f in (2, 4):
            r, b = L.raster_at(im, f, scale, zoom); cands[f'raster 1/{f} (BC7)'] = (r, {'bytes': b})
        cands['vtracer medium'] = (vec.rasterize_svg(svg_vt, w, h), {**vector_entry(svg_vt, 'vtracer', scale, im), 'traceSeconds': t_vt})
        for lv, (lay, dt) in layered.items():
            cands[f'layered {lv}'] = (L.render(lay, im.size, scale, zoom), {**vector_entry(lay, 'layered', scale, im), 'traceSeconds': dt})
        for f in (4, 8):
            r, b = L.vector_plus_residual(im, layered['medium'][0], f, scale, zoom)
            cands[f'layered medium + shading 1/{f}'] = (r, {**vector_entry(layered['medium'][0], 'layered', scale, im), 'textureBytes': b})
        for f in (2, 4):
            r, b = L.color_plus_sdf(im, f, scale, zoom); cands[f'colour + SDF 1/{f}'] = (r, {'bytes': b})
        r, b = L.indexed(im, 16, scale, zoom); cands['indexed 16'] = (r, {'bytes': b})
        r, b = L.indexed(im, 16, scale, zoom, 2); cands['indexed 16 + shading 1/2'] = (r, {'bytes': b})
        for k, (r, info) in cands.items():
            e = vec.error(ref, r)
            res['methods'].setdefault(k, dict(info))[f'z{zoom}'] = {a: round(v, 4) for a, v in e.items()}
        shown[zoom] = cands
    # strips: match size (x2 nearest so pixels are visible) and zoom 2.8 (native)
    for zoom, mag in ((vec.ZOOM_MATCH, 2), (vec.ZOOM_FINAL, 1)):
        keys = ['original (BC7)', 'raster 1/2 (BC7)', 'vtracer medium', 'layered fine', 'layered medium', 'layered coarse',
                'layered medium + shading 1/4', 'colour + SDF 1/2', 'indexed 16']
        tiles = []
        for k in keys:
            img = vec.over(shown[zoom][k][0], (118, 124, 132)).resize(
                (shown[zoom][k][0].shape[1] * mag, shown[zoom][k][0].shape[0] * mag), Image.NEAREST)
            lab = Image.new('RGB', (img.width, 16), (30, 30, 30)); ImageDraw.Draw(lab).text((3, 2), k, fill=(230, 230, 230))
            col = Image.new('RGB', (img.width, img.height + 16)); col.paste(lab, (0, 0)); col.paste(img, (0, 16))
            tiles.append(col)
        if zoom == vec.ZOOM_FINAL:  # 3 x 3 grid
            cw, ch = tiles[0].size
            sheet = Image.new('RGB', (cw * 3, ch * 3), (20, 20, 20))
            for i, t in enumerate(tiles): sheet.paste(t, ((i % 3) * cw, (i // 3) * ch))
        else:
            sheet = Image.new('RGB', (sum(t.width for t in tiles), tiles[0].height), (20, 20, 20))
            x = 0
            for t in tiles: sheet.paste(t, (x, 0)); x += t.width
        sheet.save(f'{OUT}/{name}__z{zoom}.png', optimize=True)
    return res


if __name__ == '__main__':
    names = sorted(META)
    with Pool(min(20, len(names))) as p:
        results = p.map(run, names)
    json.dump(results, open(f'{OUT}/samples.json', 'w'), indent=1)
    print('done', len(results))
