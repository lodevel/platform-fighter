"""Measure reviewed atlas cells; these pixel bounds never qualify runtime clearance."""
import hashlib
import json
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'assets/characters/pikachu'
META = ASSETS / 'frames.json'
OUTPUT = ROOT / 'docs/review/2026-10-06/pikachu-character/art/packed-alpha-root-bounds.json'


def sha(data):
    return hashlib.sha256(data).hexdigest()


metadata_bytes = META.read_bytes()
metadata = json.loads(metadata_bytes)
rows = []
for sheet, row in metadata['animations'].items():
    path = ASSETS / row['strip']
    contents = path.read_bytes()
    image_sha = sha(contents)
    if image_sha != row['sha256']:
        raise ValueError(f'Reviewed PNG changed: {sheet}')
    width, height = row['frameWidth'], row['frameHeight']
    root = row['root']
    image = Image.open(path).convert('RGBA')
    if image.width % width or image.height % height:
        raise ValueError(f'Atlas dimensions are not whole cells: {sheet}')
    columns = row.get('columns', image.width // width)
    if columns != image.width // width:
        raise ValueError(f'Declared columns differ from actual PNG: {sheet}')
    for index in range(row['frameCount']):
        x, y = index % columns * width, index // columns * height
        cell = image.crop((x, y, x + width, y + height))
        alpha = cell.getchannel('A')
        bounds = {}
        for threshold in (1, 32, 128):
            box = alpha.point(lambda value: 255 if value >= threshold else 0).getbbox()
            bounds[str(threshold)] = None if box is None else {
                'cellPixels': list(box),
                'relativeToFootRootPixels': [box[0] - root[0], box[1] - root[1],
                                             box[2] - root[0], box[3] - root[1]],
            }
        rows.append({'sheet': sheet, 'artFrameIndex': index, 'stripSha256': image_sha,
                     'cellSize': [width, height], 'root': root, 'alphaBounds': bounds})
if META.read_bytes() != metadata_bytes:
    raise ValueError('Aggregate metadata changed during bounds measurement')
result = {'state': 'pixel_measurement_only_actual_runtime_clearance_unqualified',
          'aggregateSha256': sha(metadata_bytes), 'sheets': len(metadata['animations']),
          'cells': len(rows), 'rows': rows,
          'limits': ['Positive relative bottom means pixels extend below the declared foot root; '
                     'it is not evidence that an actor overlaps a stage.',
                     'Actual actor trajectory, body rotation, camera scale and collision floor '
                     'must be measured in the immutable running match.',
                     'No root shift, body scaling, source clock or alpha modification is applied.']}
temporary = OUTPUT.with_suffix('.tmp')
temporary.write_text(json.dumps(result, indent=2) + '\n')
temporary.replace(OUTPUT)
print(json.dumps({'sheets': result['sheets'], 'cells': result['cells'],
                  'state': result['state']}))
