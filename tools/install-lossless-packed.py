#!/usr/bin/env python3
"""Guarded install of fighter-pack.py --repack-installed --all-grid output.
No resampling: logical canvases, ROOT, clocks and all geometry stay intact.
Only alpha-zero RGB may normalize to zero outside the tight drawing rect.
"""
import argparse
import hashlib
import json
import shutil
from pathlib import Path
import fighter_frames

ROOT = Path(__file__).resolve().parent.parent
LAYOUT = {'sourceCells', 'columns', 'rows', 'atlas', 'trims', 'pages', 'sha256'}

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('fighter', choices=['pikachu', 'donkeykong'])
    parser.add_argument('staging', type=Path)
    parser.add_argument('--backup', required=True, type=Path)
    args = parser.parse_args()
    target = ROOT / 'assets/characters' / args.fighter
    original = json.loads((target / 'frames.json').read_text())
    candidate = json.loads((args.staging / 'frames.json').read_text())
    report = json.loads((args.staging / 'repack-report.json').read_text())
    assert original.keys() == candidate.keys()
    assert original['meta'] == candidate['meta']
    assert original['animations'].keys() == candidate['animations'].keys()
    rows = []
    for sheet, old in original['animations'].items():
        new = candidate['animations'][sheet]
        assert {k: v for k, v in old.items() if k not in LAYOUT} == {k: v for k, v in new.items() if k not in LAYOUT}, sheet
        if sheet not in report['clipReports']:
            assert old == new, sheet
            assert sha(target / old['strip']) == sha(args.staging / new['strip']), sheet
            continue
        proof = report['clipReports'][sheet]
        before_cells = fighter_frames.load_cells(target, old)
        after_cells = fighter_frames.load_cells(args.staging, new)
        assert len(before_cells) == len(after_cells) == old['frameCount']
        for i, (a, b) in enumerate(zip(before_cells, after_cells)):
            expected = proof['drawings'][i]
            assert fighter_frames.rgba_sha256(a) == expected['beforePremultipliedRgbaSha256'] == expected['rgbaSha256'] == fighter_frames.rgba_sha256(b), (sheet, i)
            assert (a[a[..., 3] > 0] == b[a[..., 3] > 0]).all(), (sheet, i)
        rows.append({'sheet': sheet, 'beforePngSha256': sha(target / old['strip']),
            'afterPngSha256': sha(args.staging / new['strip']), 'frames': old['frameCount'],
            'logicalCanvas': [old['frameWidth'], old['frameHeight']], 'sourceRoot': old.get('root')})
    args.backup.mkdir(parents=True, exist_ok=True)
    shutil.copy2(target / 'frames.json', args.backup / 'frames.json')
    for row in rows:
        rel = original['animations'][row['sheet']]['strip']
        backup = args.backup / rel
        backup.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(target / rel, backup)
        shutil.copy2(args.staging / rel, target / rel)
    shutil.copy2(args.staging / 'frames.json', target / 'frames.json')
    receipt = {'fighter': args.fighter, 'toolSha256': sha(Path(__file__)),
        'metadataAndSourceRootUnchanged': True, 'allReconstructedPremultipliedRgbaIdentical': True,
        'allNontransparentRgbaIdentical': True, 'alphaZeroRgbMayNormalizeToZero': True,
        'decodedMiBBefore': report['decodedMiBBefore'], 'decodedMiBAfter': report['decodedMiBAfter'], 'rows': rows}
    (args.staging / 'install-receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(f"Installed {args.fighter}: {len(rows)} clips, {sum(r['frames'] for r in rows)} exact reconstructed drawings; {report['decodedMiBBefore']} -> {report['decodedMiBAfter']} MiB")

if __name__ == '__main__':
    main()
