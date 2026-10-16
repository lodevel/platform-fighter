#!/usr/bin/env python3
"""dk-animation-counts.py — derive each Donkey Kong attack clip's `animation`
counts (drawings per startup / active / recovery) from the pose schedule.

Each drawing in a clip came from one UFD source frame (pose-schedule.json
`sourceIndex`). A drawing whose source frame falls before the move's first hit
window is a startup drawing, inside [first window start, last window end) an
active drawing, after it a recovery drawing. The counts must sum to the clip's
cell count in assets/characters/donkeykong/frames.json, otherwise
selectSimulationAttackFrame ignores them and spreads the drawings evenly.

    python3 tools/dk-animation-counts.py          # print derived vs current counts
Then copy any changed counts into the `animation:` literals of the record table
in tools/gen-donkeykong-kit.py, run it, and run
npx vitest run src/characters/DonkeyKong.test.ts.

A phase with 0 drawings cannot drive the selector; the one override used on
2026-09-25 is down_special [4, 2, 1] (the last pose moved into recovery).
"""
import json, os, re

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
KIT = os.path.join(ROOT, 'src', 'characters', 'DonkeyKong.ts')
SCHEDULE = os.path.join(ROOT, 'docs', 'review', '2026-09-25', 'donkeykong-character', 'pose-schedule.json')
FRAMES = os.path.join(ROOT, 'assets', 'characters', 'donkeykong', 'frames.json')

CLIPS = {'jab': 'JAB', 'jab2': 'JAB2', 'tilt': 'TILT', 'utilt': 'UTILT', 'dtilt': 'DTILT',
         'dash_attack': 'DASHATTACK', 'smash': 'SMASH', 'usmash': 'USMASH', 'dsmash': 'DSMASH',
         'nair': 'NAIR', 'fair': 'FAIR', 'bair': 'BAIR', 'uair': 'UAIR', 'dair': 'DAIR',
         'neutral_special': 'NEUTRAL_SPECIAL', 'side_special': 'SIDE_SPECIAL',
         'up_special': 'UP_SPECIAL', 'down_special': 'DOWN_SPECIAL'}
VARIANTS = {'up_special_ground': ('UP_SPECIAL', 'groundedVariant'),
            'down_special_air': ('DOWN_SPECIAL', 'aerialVariant')}
OVERRIDES = {'down_special': [4, 2, 1]}


def block(t, name):
    i = t.index(f'export const DONKEYKONG_{name}')
    j = t.find('\nexport const', i + 10)
    return t[i:j if j > 0 else len(t)]


def analyse(seg):
    su = int(re.search(r'startupFrames: (\d+)', seg).group(1))
    ac = int(re.search(r'activeFrames: (\d+)', seg).group(1))
    m = re.search(r'hitWindows: \[(.*?)\n\s*\],', seg, re.S)
    wins = [(int(a), int(b)) for a, b in re.findall(r'startFrame: (\d+), endFrame: (\d+)', m.group(1))] if m else []
    a0 = min(w[0] for w in wins) if wins else su
    a1 = max(w[1] for w in wins) if wins else su + ac
    cur = re.search(r'animation: \{ startupFrames: (\d+), activeFrames: (\d+), recoveryFrames: (\d+) \}', seg)
    return a0, a1, (list(map(int, cur.groups())) if cur else None)


def main():
    t = open(KIT).read()
    sched = json.load(open(SCHEDULE))
    cells = {k: v['frameCount'] for k, v in json.load(open(FRAMES))['animations'].items()}
    rows = []
    for clip, name in CLIPS.items():
        seg = block(t, name)
        for cut in ('groundedVariant', 'aerialVariant'):
            if cut in seg:
                seg = seg[:seg.index(cut)]
        rows.append((clip, seg))
    for clip, (name, key) in VARIANTS.items():
        seg = block(t, name)
        rows.append((clip, seg[seg.index(key):]))
    bad = 0
    for clip, seg in rows:
        a0, a1, cur = analyse(seg)
        idx = [e['sourceIndex'] for e in sched[clip]]
        derived = OVERRIDES.get(clip) or [sum(1 for i in idx if i < a0), sum(1 for i in idx if a0 <= i < a1), sum(1 for i in idx if i >= a1)]
        ok = cur == derived and sum(derived) == cells.get(clip)
        bad += not ok
        print(f"{clip:18s} active {a0:2d}..{a1:2d} sources {idx} -> derived {derived} current {cur} cells {cells.get(clip)}"
              f"{'' if ok else '   <-- UPDATE'}{'   (zero-length phase!)' if 0 in derived else ''}")
    print('all match' if not bad else f'{bad} clip(s) need their animation literal updated')


if __name__ == '__main__':
    main()
