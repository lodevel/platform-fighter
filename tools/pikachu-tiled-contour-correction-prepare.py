"""Prepare a bounded contour-only correction; preserve rejected originals."""
import copy, json
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from pikachu_native_pose import ROOT, sha

B = ROOT / 'docs/review/2026-10-06/pikachu-character/art'
key = 'tiled-tilts-medium-pilot-source0'
p = B / 'tiled-pilot-preparation.json'
data = json.loads(p.read_text())
row = next(r for r in data['records'] if r['key'] == key)
if '2' in row.get('attempts', {}):
    raise ValueError('Prepared correction is immutable')
ledger = json.loads((B / 'tiled-generation-ledger.json').read_text())
if next(r for r in ledger if r['pose_key'] == key and r['attempt'] == 1)['state'] != 'rejected':
    raise ValueError('Actual first-attempt rejection required')
mask = Image.open(B / (key + '-render-mask.png')).convert('L')
seed = Image.open(B / (key + '-seed.png')).convert('RGB')
protected = Image.new('L', mask.size, 0)
for cell in row['cells']:
    anatomy = Image.open(B / (cell['sourceKey'] + '-anatomy-mask.png')).convert('L')
    # Preserve original interior, including source occluded features/markings.
    # Uniformly scaled 21-native-pixel erosion gives a five-pixel contour band.
    interior = anatomy.filter(ImageFilter.MinFilter(21)).resize((1024, 1024), Image.Resampling.NEAREST)
    protected.paste(interior, tuple(cell['offset']))
pixels = np.asarray(seed)
features = ((pixels[:, :, 0] > 110) & (pixels[:, :, 1] < 125) & (pixels[:, :, 2] < 80))
features |= np.max(pixels, axis=2) < 70
identity = Image.fromarray(features.astype('uint8') * 255).filter(ImageFilter.MaxFilter(3))
locked = (np.asarray(protected) > 0) | (np.asarray(identity) > 0)
bounded = Image.fromarray(np.where(locked, 0, np.asarray(mask)).astype('uint8')).convert('RGB')
maskfile = key + '-attempt2-render-mask.png'
bounded.save(B / maskfile)
graph = json.loads((B / row['workflow']).read_text())
remote = 'pf-pikachu-' + key + '-bounded-contour-attempt2-mask.png'
graph['16']['inputs']['image'] = remote
for node, kind in [('9', 'masked-final'), ('20', 'raw-diagnostic')]:
    graph[node]['inputs']['filename_prefix'] = f'pf-pikachu-20261008-{key}-attempt2-{kind}'
workflow = key + '-attempt2.workflow.json'
(B / workflow).write_text(json.dumps(graph, indent=2) + '\n')
correction = copy.deepcopy(row)
correction.pop('attempts', None)
correction['workflow'] = workflow
correction['input_files'] = {'seed': key+'-seed.png', 'guide': key+'-guide.png', 'render-mask': maskfile}
correction['upload_mapping'] = {k: v for k, v in row['upload_mapping'].items() if v != key+'-render-mask.png'}
correction['upload_mapping'][remote] = maskfile
correction['hashes']['render-mask'] = sha(B / maskfile)
correction['state'] = 'prepared; bounded contour correction requires actual input review'
correction['correction_scope'] = 'Protect eroded source interior and brown/red/black identity pixels; permit original contour band only'
row.setdefault('attempts', {})['2'] = correction
p.write_text(json.dumps(data, indent=2) + '\n')
review = Image.new('RGB', (1600, 800), '#17253a')
for i, im in enumerate([seed, bounded]):
    im = im.resize((780, 780), Image.Resampling.NEAREST)
    review.paste(im, (i*800+10, 20))
ImageDraw.Draw(review).text((8, 4), 'Actual bounded contour correction input: source seed / changed edit mask', fill='white')
review.save(B / (key+'-attempt2-input-review.png'))
print({'workflow': workflow, 'editablePixels': int(np.count_nonzero(np.asarray(bounded)[:, :, 0]))})
