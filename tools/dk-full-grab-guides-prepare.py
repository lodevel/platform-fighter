"""Prepare a reviewed full-grab source-guide batch only after the root CPU grant.

The default command is a lightweight hash/command preflight. Native rasterization
requires --source-raster-slot-released; this tool never submits generation jobs.
"""
from pathlib import Path
import argparse
import hashlib
import json
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
ART = ROOT / 'docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/art'
PLAN = ART / 'full-three-grab-minimal-next-batch-plan-01.json'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--batch', required=True)
    parser.add_argument('--source-raster-slot-released', action='store_true')
    args = parser.parse_args()
    plan = json.loads(PLAN.read_text())
    batch = next(b for b in plan['guideBatches'] if b['id'] == args.batch)
    if len(batch['poses']) > 2:
        raise ValueError('Bounded batch must contain at most two new source poses')
    rows = []
    for selection in batch['poses']:
        clip = next(c for c in plan['clips'] if c['sheet'] == selection['clip'])
        pose = next(p for p in clip['poses'] if p['nativeSample'] == selection['nativeSample'])
        if pose['targetArtStatus'] != 'requires_new_generation':
            raise ValueError('Do not rerender an accepted contact reuse')
        for ref in [clip['motionResource'], pose['sourceImage'], *plan['inputPins']]:
            if sha(ROOT / ref['path']) != ref['sha256']:
                raise ValueError(f"Changed reviewed input: {ref['path']}")
        canvas, root = clip['fullCanvas'], clip['fullRoot']
        dest = ART / pose['guidePrefix']
        metadata = Path(str(dest) + '.json')
        if any(Path(str(dest) + suffix).exists() for suffix in
               ['.json', '-reference.png', '-palette-seed.png', '-mask.png', '-guide.png']):
            raise ValueError('Preserve existing outputs; no automatic rerasterization')
        command = [sys.executable, str(ROOT / 'tools/dk-native-guide.py'),
                   Path(clip['motionResource']['path']).stem, str(pose['nativeSample']), str(dest),
                   '--width', str(canvas[0]), '--height', str(canvas[1]),
                   '--root-x', str(root[0]), '--root-y', str(root[1]),
                   '--view-side', 'negative', '--root-registration', 'remove-trans-translation']
        if args.source_raster_slot_released:
            subprocess.run(command, cwd=ROOT, check=True)
            native = json.loads(metadata.read_text())
            if native['root'] != root or native['canvas'] != canvas:
                raise ValueError('Renderer registration does not match plan')
            for filename, digest in native['output_files'].items():
                if sha(ART / filename) != digest:
                    raise ValueError('Source-guide output pin mismatch')
        rows.append({'clip': selection['clip'], 'gameplayAge': pose['gameplayAge'],
                     'nativeSample': pose['nativeSample'], 'command': command,
                     'metadata': str(metadata.relative_to(ROOT)),
                     'metadataSha256': sha(metadata) if metadata.exists() else None,
                     'actualGuideReview': 'pending', 'GPUUsed': False})
    result = {'batch': args.batch, 'planSha256': sha(PLAN), 'rows': rows,
              'nativeRasterExecuted': args.source_raster_slot_released,
              'targetGenerationSubmitted': False, 'shippingChanged': False}
    if args.source_raster_slot_released:
        receipt = ART / f'full-grab-{args.batch}-source-guide-preparation.json'
        if receipt.exists():
            raise ValueError('Preserve previous receipt')
        receipt.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
