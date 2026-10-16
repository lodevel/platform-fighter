#!/usr/bin/env python3
"""Aggregate accepted Pikachu packing metadata without inventing missing clips."""
import hashlib
import json
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'assets/characters/pikachu'


def main():
    animations = {}
    for path in [BASE / 'registered-poses.json', *sorted((BASE / 'pose-batches').glob('*.json'))]:
        data = json.loads(path.read_text())
        if (path.name.startswith('full-') or path.name.startswith('thunder-')) and data.get('state') != 'packed_cells_visually_reviewed_runtime_pending':
            raise ValueError(f'{path.name}: actual packed-cell visual review required before registration')
        contract = data['coordinateContract']
        for key, row in data['animations'].items():
            strip = BASE / row['strip']
            digest = hashlib.sha256(strip.read_bytes()).hexdigest()
            if digest != row['sha256']:
                raise ValueError(f'{key}: changed packed strip')
            width, height = contract['frameWidth'], contract['frameHeight']
            columns = row.get('columns', row['frameCount'])
            rows = (row['frameCount'] + columns - 1) // columns
            if Image.open(strip).size != (width * columns, height * rows):
                raise ValueError(f'{key}: incorrect packed dimensions')
            if key in animations:
                raise ValueError(f'{key}: duplicate metadata')
            animations[key] = {
                **row, 'frameWidth': width, 'frameHeight': height,
                'root': contract['root'], 'scaleToWorld': contract['scaleToWorld'],
                'sourceCells': [[i % columns, i // columns] for i in range(row['frameCount'])],
                'packingMetadata': str(path.relative_to(ROOT)),
                'packingMetadataSha256': hashlib.sha256(path.read_bytes()).hexdigest(),
            }
    actual = {p.stem for p in (BASE / 'animations').glob('*.png')}
    if actual != set(animations):
        raise ValueError(f'Packed strips and metadata differ: {actual ^ set(animations)}')
    result = {'meta': {
        'source': 'Reviewed local ComfyUI body art, source-guided native poses, fixed-root registered packing',
        'cellWidth': 512,
        'cellHeight': 384,
        'perAnimationDimensionsRequired': True,
        'scope': 'Accepted rough body strips only; missing state/special strips omitted, full-match completion remains pending',
    }, 'animations': dict(sorted(animations.items()))}
    temporary = BASE / 'frames.json.write.tmp'
    temporary.write_text(json.dumps(result, indent=2) + '\n')
    temporary.replace(BASE / 'frames.json')
    print(json.dumps({'animations': len(animations), 'cells': sum(r['frameCount'] for r in animations.values())}))


if __name__ == '__main__':
    main()
