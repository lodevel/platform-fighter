"""Render reference-set previews at match size (zoom 1.4, 1920 buffer), one grid per motion.
Usage: python3 build-previews.py <repo root> <output dir>  (reads reference-set.json beside this file)"""
import json, math, os, sys
from PIL import Image
ROOT, OUT = sys.argv[1], sys.argv[2]
ref = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'reference-set.json')))
ZOOM = 1.4
meta = []
cache = {}
for r in ref['rows']:
    f, k = r['f'], r['key']
    if f not in cache: cache[f] = json.load(open(f'{ROOT}/assets/characters/{f}/frames.json'))['animations']
    a = cache[f][k]
    sheet = Image.open(f"{ROOT}/assets/characters/{f}/{a['strip']}").convert('RGBA')
    fw, fh, sc = int(a['frameWidth']), int(a['frameHeight']), float(a['scaleToWorld'])
    s = sc * ZOOM
    tr = a['trims']
    # Crop every drawing to the union of this motion's drawn areas (root alignment kept).
    ux0, uy0 = min(t[4] for t in tr), min(t[5] for t in tr)
    ux1, uy1 = max(t[4] + t[2] for t in tr), max(t[5] + t[3] for t in tr)
    ux0, uy0, ux1, uy1 = max(0, ux0 - 4), max(0, uy0 - 4), min(fw, ux1 + 4), min(fh, uy1 + 4)
    cw, ch = max(1, round((ux1 - ux0) * s)), max(1, round((uy1 - uy0) * s)); n = len(tr); cols = min(n, 8); rows = math.ceil(n / cols)
    grid = Image.new('RGBA', (cols * cw, rows * ch))
    for i, (x, y, w, h, ox, oy) in enumerate(tr):
        full = Image.new('RGBA', (fw, fh)); full.paste(sheet.crop((x, y, x + w, y + h)), (ox, oy))
        grid.paste(full.crop((ux0, uy0, ux1, uy1)).resize((cw, ch), Image.LANCZOS), ((i % cols) * cw, (i // cols) * ch))
    name = f'{f}-{k}.webp'
    grid.save(f'{OUT}/{name}', 'WEBP', lossless=True, method=4)
    ns = a.get('nativeSampleIndices') or list(range(n))
    end = int(a['loopDuration']) if a.get('loopDuration') else ns[-1] + 6
    holds = [max(1, (ns[i + 1] if i + 1 < n else end) - ns[i]) for i in range(n)]
    meta.append(dict(f=f, key=k, file=name, cw=cw, ch=ch, cols=cols, n=n, holds=holds,
                     loop=bool(a.get('loopDuration'))))
json.dump(meta, open(OUT + '/strips.json', 'w'))
print('ok', len(meta))
