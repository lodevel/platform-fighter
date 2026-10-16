#!/usr/bin/env python3
"""Decoded-texture budget of a fighter, per clip and in total (read-only on assets).

For every clip of a frames.json it reports three sizes in MiB of decoded RGBA8:
  today   the strip PNGs as installed (width x height x 4, all pages)
  tight   every drawing cut to its alpha bounding box + 1 px (clamped to the cell),
          shelf-packed (order -h, -w, index), 2 px gutter, origins 4 px aligned,
          atlas width (widest rect + gutter, then +128 steps, <= 4096) chosen to minimise area (docs/review/2026-10-14/art-budget/PLAN.md b)
  bc7     tight x 0.25 (BC7 / ASTC 4x4: 1 byte per texel)
With --keep <plan.json> (key-pose-plan.py output) a fourth pair is added, `thin` and
`thin+bc7`: only the drawings whose native sample is in the plan's nativeSamples.

  fighter-texture-budget.py --fighter donkeykong
  fighter-texture-budget.py --all
  fighter-texture-budget.py --frames docs/review/2026-10-14/link-takeover/A3-staging/frames.json \\
      [--keep docs/review/2026-10-14/art-budget/link-keep-plan.json] [--clips] [--json out.json]

Run with ~/ComfyUI/.venv/bin/python -I (CPU heavy: wrap in flock .tmp/dk-heavy.lock).
"""
import argparse
import json
import multiprocessing
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
MIB = 1024 * 1024
GUTTER, ALIGN, MAX_W, WIDTH_STEP = 2, 4, 4096, 128
BC7 = 0.25


def align(v, a=ALIGN):
    return -(-v // a) * a


def alpha_bbox_rects(strip, cells, count, fw, fh):
    """Per cell: (w, h) of the alpha bounding box + 1 px each side, clamped to the cell.
    Clips without sourceCells (fx strips, installed Link) are row-major grids as wide as the strip."""
    image = Image.open(strip)
    if cells is None:
        cols = max(image.width // fw, 1)
        cells = [(i % cols, i // cols) for i in range(count)]
    alpha = np.asarray(image.convert('RGBA'))[:, :, 3] > 0
    out = []
    for col, row in cells:
        a = alpha[row * fh:(row + 1) * fh, col * fw:(col + 1) * fw]
        ys, xs = np.nonzero(a)
        if len(xs) == 0:
            out.append((1, 1))
            continue
        x0, x1 = max(xs.min() - 1, 0), min(xs.max() + 2, fw)
        y0, y1 = max(ys.min() - 1, 0), min(ys.max() + 2, fh)
        out.append((int(x1 - x0), int(y1 - y0)))
    return out


def shelf_height(rects, width):
    """Height of a shelf pack of rects into `width` (rects pre-sorted)."""
    x = y = shelf = 0
    for w, h in rects:
        if x + w > width and x > 0:
            y += align(shelf + GUTTER)
            x = shelf = 0
        x += align(w + GUTTER)
        shelf = max(shelf, h)
    return align(y + shelf)


def tight_pack(rects):
    """(W, H) of the smallest-area shelf atlas for rects [(w, h)]; W <= MAX_W."""
    if not rects:
        return 0, 0
    order = sorted(range(len(rects)), key=lambda i: (-rects[i][1], -rects[i][0], i))
    sorted_rects = [rects[i] for i in order]
    lo = align(max(w for w, _ in rects) + GUTTER)
    best = None
    for width in range(lo, MAX_W + 1, WIDTH_STEP):
        h = shelf_height(sorted_rects, width)
        if best is None or width * h < best[0] * best[1]:
            best = (width, h)
    return best


def load_clip(job):
    base, name, anim, keep = job
    fw, fh = anim['frameWidth'], anim['frameHeight']
    pages = anim.get('pages') or [dict(anim, frameStart=0)]
    today, rects = 0, []
    for page in pages:
        path = base / page['strip']
        with Image.open(path) as im:
            today += im.width * im.height * 4
        rects += alpha_bbox_rects(path, page.get('sourceCells'), page['frameCount'], fw, fh)
    samples = anim.get('nativeSampleIndices')
    kept = [r for i, r in enumerate(rects) if keep is None or (samples and samples[i] in keep)]
    return name, {'drawings': len(rects), 'today': today, 'tight': tight_pack(rects), 'keptDrawings': len(kept),
                  'thin': tight_pack(kept) if keep is not None else None}


def budget(frames_path, keep_plan=None, jobs=4):
    frames_path = Path(frames_path)
    anims = json.loads(frames_path.read_text())['animations']
    plan = json.loads(Path(keep_plan).read_text())['clips'] if keep_plan else None
    work = [(frames_path.parent, n, a, set(plan[n]['nativeSamples']) if plan and n in plan else None)
            for n, a in anims.items()]
    if plan:
        work = [w for w in work if w[3] is not None]
    with multiprocessing.get_context('fork').Pool(jobs) as pool:
        rows = dict(pool.map(load_clip, work, chunksize=2))
    out = {}
    for name in anims:
        if name not in rows:
            continue
        r = rows[name]
        tight = r['tight'][0] * r['tight'][1] * 4
        row = {'drawings': r['drawings'], 'todayMiB': r['today'] / MIB, 'tightMiB': tight / MIB,
               'bc7MiB': tight * BC7 / MIB, 'atlas': list(r['tight']),
               'overHeight': r['tight'][1] > MAX_W}
        if r['thin'] is not None:
            thin = r['thin'][0] * r['thin'][1] * 4
            row.update(keptDrawings=r['keptDrawings'], thinMiB=thin / MIB, thinBc7MiB=thin * BC7 / MIB)
        out[name] = row
    return out


def totals(rows):
    keys = [k for k in ('drawings', 'todayMiB', 'tightMiB', 'bc7MiB', 'keptDrawings', 'thinMiB', 'thinBc7MiB')
            if any(k in r for r in rows.values())]
    return {k: sum(r.get(k, 0) for r in rows.values()) for k in keys} | {'clips': len(rows)}


def report(label, rows, per_clip):
    t = totals(rows)
    if per_clip:
        head = f"{'clip':<28}{'draw':>6}{'today':>9}{'tight':>9}{'bc7':>8}"
        if 'thinMiB' in t:
            head += f"{'kept':>6}{'thin':>9}{'thin+bc7':>10}"
        print(head)
        for n, r in rows.items():
            line = f"{n:<28}{r['drawings']:>6}{r['todayMiB']:>9.2f}{r['tightMiB']:>9.2f}{r['bc7MiB']:>8.2f}"
            if 'thinMiB' in r:
                line += f"{r['keptDrawings']:>6}{r['thinMiB']:>9.2f}{r['thinBc7MiB']:>10.2f}"
            print(line)
    line = (f"{label}: {t['clips']} clips, {t['drawings']} drawings | today {t['todayMiB']:.0f} MiB | "
            f"tight {t['tightMiB']:.0f} MiB (x{t['tightMiB'] / t['todayMiB']:.2f}) | bc7 {t['bc7MiB']:.0f} MiB")
    if 'thinMiB' in t:
        line += f" | thinned {t['keptDrawings']} drawings: tight {t['thinMiB']:.0f} MiB, bc7 {t['thinBc7MiB']:.0f} MiB"
    over = [n for n, r in rows.items() if r['overHeight']]
    if over:
        line += f" | atlas taller than {MAX_W} px (needs paging or thinning): {len(over)} clips"
    print(line)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument('--fighter', help='folder name under assets/characters')
    g.add_argument('--all', action='store_true', help='every assets/characters/*/frames.json')
    g.add_argument('--frames', help='a frames.json (e.g. the Link staging)')
    ap.add_argument('--keep', help='key-pose-plan.py output: also size the thinned clip set')
    ap.add_argument('--clips', action='store_true', help='print every clip')
    ap.add_argument('--jobs', type=int, default=4)
    ap.add_argument('--json', help='write the per-clip rows here')
    args = ap.parse_args()
    if args.frames:
        targets = {Path(args.frames).parent.name: Path(args.frames)}
    elif args.fighter:
        targets = {args.fighter: ROOT / 'assets/characters' / args.fighter / 'frames.json'}
    else:
        targets = {p.parent.name: p for p in sorted((ROOT / 'assets/characters').glob('*/frames.json'))}
    result = {}
    for label, path in targets.items():
        rows = budget(path, args.keep, args.jobs)
        report(label, rows, args.clips)
        result[label] = {'clips': rows, 'totals': totals(rows)}
    if args.json:
        Path(args.json).write_text(json.dumps(result, indent=1) + '\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())
