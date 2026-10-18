#!/usr/bin/env python3
"""Measure how much of an exported character package simple drawing reuse could save.

Usage: python3 tools/character-reuse-scan.py [--packages .tmp/character-packages] [--out report.json] [ids...]

For every drawing of each package (character-package/1), crops it from its page and
compares it with every other drawing of similar size, both as is and mirrored:
  identical  - the same pixels (premultiplied RGBA, exact)
  near       - mean absolute difference under 1.5/255 on a 96 px thumbnail, mirrored or not
Drawings are then grouped (union-find); a group needs one stored drawing. The
report gives the drawn pixels each kind of reuse would remove. Read-only probe:
it changes no package or asset. Needs PIL + numpy.
"""
import argparse, hashlib, json, os, sys
import numpy as np
from PIL import Image

NEAR = 1.5 / 255
THUMB = 96


def load(package_dir):
    pkg = json.load(open(os.path.join(package_dir, 'character.json')))
    pages = {pid: Image.open(os.path.join(package_dir, page['file'])).convert('RGBA') for pid, page in pkg['pages'].items()}
    return pkg, pages


def premultiplied(img):
    a = np.asarray(img, dtype=np.float32) / 255
    a[..., :3] *= a[..., 3:4]
    return a


def scan(package_dir):
    pkg, pages = load(package_dir)
    ids = sorted(pkg['drawings'])
    rows = []
    for did in ids:
        d = pkg['drawings'][did]
        x, y, w, h = d['rect']
        crop = pages[d['page']].crop((x, y, x + w, y + h))
        exact = hashlib.sha256(crop.tobytes() + bytes(str((w, h)), 'ascii')).hexdigest()
        scale = THUMB / max(w, h)
        tw, th = max(1, round(w * scale)), max(1, round(h * scale))
        thumb = premultiplied(crop.resize((tw, th), Image.BILINEAR))
        rows.append({'id': did, 'w': w, 'h': h, 'px': w * h, 'exact': exact, 'thumb': thumb,
                     'mirror': thumb[:, ::-1], 'action': did.rsplit('/', 1)[0]})

    parent = list(range(len(rows)))
    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]; i = parent[i]
        return i
    def union(i, j):
        a, b = find(i), find(j)
        if a != b: parent[max(a, b)] = min(a, b)

    kinds = {}
    by_exact = {}
    for i, r in enumerate(rows):
        if r['exact'] in by_exact: union(i, by_exact[r['exact']]); kinds[(by_exact[r['exact']], i)] = 'identical'
        else: by_exact[r['exact']] = i
    # Near duplicates: compare drawings whose sizes are within 4% (sorted sweep on width).
    order = sorted(range(len(rows)), key=lambda i: (rows[i]['w'], rows[i]['h']))
    for n, i in enumerate(order):
        ri = rows[i]
        for j in order[n + 1:]:
            rj = rows[j]
            if rj['w'] > ri['w'] * 1.04 + 1: break
            if abs(rj['h'] - ri['h']) > ri['h'] * 0.04 + 1 or ri['thumb'].shape != rj['thumb'].shape: continue
            if find(i) == find(j): continue
            plain = float(np.abs(ri['thumb'] - rj['thumb']).mean())
            mirror = float(np.abs(ri['thumb'] - rj['mirror']).mean())
            if min(plain, mirror) < NEAR:
                union(i, j); kinds[(i, j)] = 'near' if plain <= mirror else 'near-mirrored'

    groups = {}
    for i in range(len(rows)): groups.setdefault(find(i), []).append(i)
    total_px = sum(r['px'] for r in rows)
    kept_px = sum(max(rows[i]['px'] for i in g) for g in groups.values())
    multi = [g for g in groups.values() if len(g) > 1]
    by_kind = {}
    for (i, j), kind in kinds.items(): by_kind[kind] = by_kind.get(kind, 0) + 1
    cross_action = [g for g in multi if len({rows[i]['action'] for i in g}) > 1]
    examples = sorted(multi, key=lambda g: -sum(rows[i]['px'] for i in g))[:12]
    return {
        'package': pkg['id'], 'revision': pkg['revision'], 'drawings': len(rows), 'drawnPixels': total_px,
        'groups': len(groups), 'groupsWithReuse': len(multi), 'crossActionGroups': len(cross_action),
        'links': by_kind, 'pixelsAfterReuse': kept_px, 'savedShare': round(1 - kept_px / total_px, 4),
        'largestGroups': [[rows[i]['id'] for i in g] for g in examples],
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--packages', default='.tmp/character-packages')
    ap.add_argument('--out')
    ap.add_argument('ids', nargs='*')
    args = ap.parse_args()
    ids = args.ids or sorted(d for d in os.listdir(args.packages) if os.path.exists(os.path.join(args.packages, d, 'character.json')))
    report = {'schema': 'character-reuse-scan/1', 'near': f'mean |diff| < {NEAR:.5f} on {THUMB}px premultiplied thumbnails', 'packages': []}
    for pid in ids:
        r = scan(os.path.join(args.packages, pid))
        report['packages'].append(r)
        print(f"{pid}: {r['drawings']} drawings, {r['groupsWithReuse']} reuse groups ({r['crossActionGroups']} across actions), "
              f"links {r['links']}, drawn pixels {r['drawnPixels'] / 1e6:.1f} M → {r['pixelsAfterReuse'] / 1e6:.1f} M ({r['savedShare']:.1%} saved)")
    if args.out:
        with open(args.out, 'w') as f: json.dump(report, f, indent=1); f.write('\n')


if __name__ == '__main__':
    sys.exit(main())
