#!/usr/bin/env python3
"""Dry-run cleanup plan for docs/review and .tmp (run from the repo root); deletes nothing.

Usage: python3 tools/cleanup-plan.py <out-dir> [--keep <path-prefix> ...]
(`--keep` protects folders still in use, e.g. the current review dates.)

Keep in docs/review: *.md; non-image files under 1 MiB; anything inside a `sources/` folder;
files whose path starts with a reference found in src/ or port/ (game + tests); the Link
renderer inputs. Delete everything else there.
Keep in .tmp: the heavy lock and the two live galleries' current builds; delete the rest.
Writes delete-list.txt (one path per line) and prints MiB per top folder.
"""
import os, re, sys, collections
from pathlib import Path

ROOT = Path('.').resolve()
OUT = Path(sys.argv[1])
KEEP = tuple(sys.argv[i + 1] for i, a in enumerate(sys.argv) if a == '--keep')
IMAGE = {'.png', '.jpg', '.jpeg', '.webp', '.gif', '.mp4', '.webm', '.ktx2', '.npz', '.npy', '.zip', '.7z', '.bin'}
SMALL = 1 << 20
LINK_ART = 'docs/review/2026-10-12/link-character/rework/art/'
RENDERER = [LINK_ART + d for d in ('uv-atlas-pilot/', 'equipment-palette-v1/', 'native-pilot/', 'source-renderer-reference/')]
TMP_KEEP = ['.tmp/dk-heavy.lock', '.tmp/ssbu-decomp/', '.tmp/dk-live-gallery/platform-fighter/', '.tmp/pikachu-live-gallery/platform-fighter/']

ref_re = re.compile(r'docs/review/[A-Za-z0-9_.@/-]+')
refs = set()
for base in ('src', 'port/src', 'port/scripts'):
    for p in (ROOT / base).rglob('*'):
        if p.suffix in ('.ts', '.tsx', '.js', '.mjs', '.json') and p.is_file():
            for m in ref_re.findall(p.read_text(errors='ignore')):
                refs.add(m.rstrip('.,):;'))
# a reference to a whole topic folder is a comment-level citation, not a file read
refs = {r for r in refs if r.count('/') >= 4 or '.' in r.rsplit('/', 1)[-1]}

def keep_doc(rel, size):
    if rel.endswith('.md') or '/sources/' in rel or rel.startswith(KEEP):
        return True
    if any(rel.startswith(r) for r in RENDERER) or (rel.startswith(LINK_ART) and rel.count('/') == LINK_ART.count('/')):
        return True
    if any(rel.startswith(r) for r in refs):
        return True
    return size < SMALL and Path(rel).suffix.lower() not in IMAGE

deleted = collections.Counter(); kept = collections.Counter()
with open(OUT / 'delete-list.txt', 'w') as out:
    for top in ('docs/review', '.tmp'):
        for dirpath, dirs, files in os.walk(ROOT / top):
            for f in files:
                p = Path(dirpath) / f
                rel = str(p.relative_to(ROOT))
                try: size = p.lstat().st_size
                except OSError: continue
                group = '/'.join(rel.split('/')[:3 if top == 'docs/review' else 2])
                if top == '.tmp':
                    keep = any(rel == k or rel.startswith(k) for k in TMP_KEEP)
                else:
                    keep = keep_doc(rel, size)
                (kept if keep else deleted)[group] += size
                if not keep:
                    out.write(rel + '\n')
mib = lambda b: b / 2**20
for g in sorted(set(deleted) | set(kept), key=lambda g: -deleted[g])[:30]:
    print(f'{mib(deleted[g]):9.0f} MiB delete  {mib(kept[g]):7.0f} MiB keep  {g}')
print(f'TOTAL delete {mib(sum(deleted.values())):.0f} MiB, keep {mib(sum(kept.values())):.0f} MiB')
