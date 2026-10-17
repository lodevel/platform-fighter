#!/usr/bin/env python3
"""Encode every runtime fighter spritesheet to UASTC KTX2 for the optional compressed texture quality.

Usage: python3 tools/encode-compressed-sheets.py [--fighters donkeykong,link,pikachu] [--jobs N] [--force]

Sheets come from assets/characters/<id>/frames.json (animations[*].strip) plus
final-visual-frames.json pages when present. Each PNG is prepared exactly as the
renderer's PNG upload does (compressed textures cannot do this at upload time):
pad right/bottom to a multiple of 4, flip vertically, premultiply alpha. Output:
assets/characters/<id>/compressed/<strip path>.ktx2 and compressed/index.json.
Prepared intermediates live in .tmp/compressed-sheets/. Needs PIL + numpy.
"""
import argparse, hashlib, json, math, os, subprocess, sys, time
import numpy as np
from PIL import Image
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
BASISU = ROOT + '/.tmp/basisu-src/bin/basisu'
WORK = ROOT + '/.tmp/compressed-sheets'
ENCODER = 'basis_universal v1_60 323239a'
ARGS = ['-ktx2', '-uastc', '-uastc_level', '2', '-ktx2_zstandard_level', '6', '-linear']
PREP = 'pad right/bottom to multiple of 4, flip vertically, premultiply alpha'
MIB = 1024 * 1024


def strips(fighter):
    """Sorted unique strip paths (relative to the fighter folder) used at runtime."""
    base = f'{ROOT}/assets/characters/{fighter}'
    found = {a['strip'] for a in json.load(open(base + '/frames.json'))['animations'].values()}
    final = base + '/final-visual-frames.json'
    if os.path.exists(final):
        found |= {p['strip'] for p in json.load(open(final))['pages'].values()}
    return sorted(found)


def prepare(src, dest):
    a = np.array(Image.open(src).convert('RGBA'))
    h, w = a.shape[:2]
    W, H = (w + 3) // 4 * 4, (h + 3) // 4 * 4
    p = np.zeros((H, W, 4), np.uint8)
    p[:h, :w] = a
    p = p[::-1].copy()
    alpha = p[..., 3:4].astype(np.uint32)
    p[..., :3] = ((p[..., :3].astype(np.uint32) * alpha + 127) // 255).astype(np.uint8)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    Image.fromarray(p, 'RGBA').save(dest)
    return w, h, W, H


def encode(job):
    fighter, rel, sha, previous, force = job
    src = f'{ROOT}/assets/characters/{fighter}/{rel}'
    out = f'{ROOT}/assets/characters/{fighter}/compressed/{rel[:-4]}.ktx2'
    if not force and previous and previous['sourceSha256'] == sha and os.path.exists(out):
        return rel, previous, False
    prepared = f'{WORK}/{fighter}/{rel}'
    w, h, W, H = prepare(src, prepared)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    r = subprocess.run([BASISU, *ARGS, '-file', prepared, '-output_file', out], capture_output=True, text=True)
    if r.returncode or not os.path.exists(out):
        raise RuntimeError(f'basisu failed for {fighter}/{rel}:\n{(r.stdout + r.stderr)[-800:]}')
    return rel, {'url': f'compressed/{rel[:-4]}.ktx2', 'sourceSha256': sha, 'width': W, 'height': H,
                 'sourceWidth': w, 'sourceHeight': h, 'bytes': os.path.getsize(out)}, True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--fighters', default='donkeykong,link,pikachu')
    ap.add_argument('--jobs', type=int, default=os.cpu_count())
    ap.add_argument('--force', action='store_true')
    args = ap.parse_args()
    if not os.path.exists(BASISU):
        sys.exit(f'basisu not found at {BASISU}; build it with tools/build-basisu.sh')
    started = time.time()
    for fighter in args.fighters.split(','):
        base = f'{ROOT}/assets/characters/{fighter}'
        index_path = base + '/compressed/index.json'
        old = json.load(open(index_path)) if os.path.exists(index_path) else {}
        # Reuse previous outputs only when they came from this encoder, settings and preparation.
        old = old['sheets'] if (old.get('encoder'), old.get('settings'), old.get('prep')) == (ENCODER, ' '.join(ARGS), PREP) else {}
        rels = strips(fighter)
        jobs = [(fighter, rel, hashlib.sha256(open(f'{base}/{rel}', 'rb').read()).hexdigest(), old.get(rel), args.force)
                for rel in rels]
        with ThreadPoolExecutor(args.jobs) as ex:
            results = list(ex.map(encode, jobs))
        sheets = {rel: entry for rel, entry, _ in results}
        os.makedirs(base + '/compressed', exist_ok=True)
        with open(index_path, 'w') as f:
            json.dump({'schema': 'compressed-sheets/1', 'encoder': ENCODER, 'settings': ' '.join(ARGS), 'prep': PREP,
                       'sheets': sheets}, f, indent=1, sort_keys=True)
            f.write('\n')
        png = sum(os.path.getsize(f'{base}/{rel}') for rel in rels)
        ktx = sum(e['bytes'] for e in sheets.values())
        rgba = sum(e['width'] * e['height'] * 4 for e in sheets.values())
        bc7 = sum(math.ceil(e['width'] / 4) * math.ceil(e['height'] / 4) * 16 for e in sheets.values())
        print(f'{fighter}: sheets {len(sheets)}, encoded {sum(c for *_, c in results)}, skipped {sum(not c for *_, c in results)}, '
              f'PNG {png / MIB:.1f} MiB, KTX2 {ktx / MIB:.1f} MiB, RGBA8 {rgba / MIB:.1f} MiB, BC7 {bc7 / MIB:.1f} MiB')
    print(f'wall time {time.time() - started:.1f}s')


if __name__ == '__main__':
    main()
