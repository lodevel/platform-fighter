"""Stage bounded corrections from the exact actual played-floor failures.

No GPU submission or live asset write. Existing first-drawing corrections remain
untouched; source samples are identified by retained packing records, not by
assuming that art indices are native frames.
"""
from pathlib import Path
import argparse, copy, hashlib, json, re
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
EVIDENCE = ROOT / 'docs/review/2026-10-06/pikachu-character'
BASE = EVIDENCE / 'art/completion-states-attack-late-floor'
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
parser = argparse.ArgumentParser()
parser.add_argument('--batch', type=int, choices=range(8), required=True)
args = parser.parse_args()
key = f'full-completion-states-attack-late-floor-batch{args.batch}-source0'
prep_path = BASE / 'full-pilot-preparation.json'
prep = json.loads(prep_path.read_text()) if prep_path.exists() else {'records': []}
assert not any(r['key'] == key for r in prep['records']), 'Prepared job immutable'
frames_path = ROOT / 'assets/characters/pikachu/frames.json'
frames_hash = sha(frames_path)
frames = json.loads(frames_path.read_text())
report_path = EVIDENCE / 'integration/completion-first-sprite-floor-production/played-floor-audit.json'
report = json.loads(report_path.read_text())
assert report['pixelCentres'] and report['alphaThreshold'] == 32
assert len(report['failedPlayedCells']) == 32
cases = report['failedPlayedCells'][args.batch*4:(args.batch+1)*4]
seed = Image.new('RGB', (2048, 2560), '#cc498c')
mask = Image.new('L', seed.size)
review = Image.new('RGBA', (2048, 640), '#e4e3df')
cells = []
actions = {'jab': 'jab', 'dtilt': 'down-tilt', 'dsmash': 'down-smash'}
leaves = {'jab': ('pikachuJabHurtboxes.ts', 'PIKACHU_JAB_AUTHORED_HURTBOX_POSES'),
          'dtilt': ('pikachuVerticalTiltHurtboxes.ts', 'PIKACHU_VERTICAL_TILT_AUTHORED_HURTBOX_POSES'),
          'dsmash': ('pikachuSmashHurtboxes.ts', 'PIKACHU_SMASH_AUTHORED_HURTBOX_POSES')}
for j, failure in enumerate(cases):
    sheet, index = failure['sheet'], failure['artFrameIndex']
    clip = frames['animations'][sheet]
    assert index != 0 and clip['root'] == [256, 288]
    source = ROOT / 'assets/characters/pikachu' / clip['strip']
    assert sha(source) == clip['sha256']
    packing_path = ROOT / clip['packingMetadata']
    assert sha(packing_path) == clip['packingMetadataSha256']
    packing = json.loads(packing_path.read_text())
    source_row = [r for r in packing['sources'] if r['action'] == actions[sheet]][index]
    sample = int(re.search(r'-source(\d+)-attempt', source_row['file']).group(1))
    leaf_path = ROOT / 'src/characters' / leaves[sheet][0]
    leaf_text = leaf_path.read_text()
    literal = re.search(r'export const '+leaves[sheet][1]+r'\s*=\s*(\[.*?\])\s*as const;', leaf_text, re.S).group(1)
    array = json.loads(re.sub(r',\s*([\]}])', r'\1', literal))
    row = [r for r in array if r['action'] == actions[sheet]][index]
    assert row.get('sourceIndex', row.get('nativeSample')) == sample
    assert row['startElapsed'] == clip['frameWindows'][index]['startFrame']
    assert row['endElapsed'] == clip['frameWindows'][index]['endFrame']
    w, h = clip['frameWidth'], clip['frameHeight']
    col, line = clip['sourceCells'][index]
    original = Image.open(source).convert('RGBA').crop((col*w, line*h, (col+1)*w, (line+1)*h))
    body = Image.new('RGBA', (512, 640)); body.alpha_composite(original)
    bounds = body.getchannel('A').point(lambda a: 255 if a >= 32 else 0).getbbox()
    first, last, end = 279, bounds[3], 289
    assert last > end
    low = body.crop((0, first, 512, last)).resize((512, end-first), Image.Resampling.LANCZOS)
    body.paste(Image.new('RGBA', (512, 640-first)), (0, first)); body.alpha_composite(low, (0, first))
    region = np.asarray(original.getchannel('A')) > 0
    region[:first-4] = False
    part = Image.new('L', body.size)
    part.paste(Image.fromarray(region.astype('uint8')*255).filter(ImageFilter.MaxFilter(7)), (0, 0))
    data = np.asarray(part).copy(); data[end:] = 0; part = Image.fromarray(data)
    offset = (j%2*1024, j//2*1280)
    matte = Image.new('RGBA', body.size, '#cc498c'); matte.alpha_composite(body)
    seed.paste(matte.convert('RGB').resize((1024, 1280), Image.Resampling.NEAREST), offset)
    mask.paste(part.resize((1024, 1280), Image.Resampling.NEAREST), offset)
    panel = Image.new('RGBA', body.size, '#e4e3df'); panel.alpha_composite(body)
    ImageDraw.Draw(panel).line((0, 288, 512, 288), fill='red')
    ImageDraw.Draw(panel).text((8, 15), f'{sheet}/{index} source{sample}: bounded target', fill='black')
    review.alpha_composite(panel, (j*512, 0))
    cells.append({'sheet': sheet, 'artFrameIndex': index, 'sourceSampleIndex': sample,
                  'nativeSample': sample, 'sampleProvenance': 'Retained packing source filename and receiving row agree; source sample is not a new gameplay clock claim.',
                  'sourcePackingRow': source_row, 'packingMetadata': str(packing_path.relative_to(ROOT)),
                  'packingMetadataSha256': sha(packing_path), 'root': clip['root'], 'source': str(source.relative_to(ROOT)),
                  'sourceSha256': sha(source), 'sourceCellRgbaSha256': hashlib.sha256(original.tobytes()).hexdigest(),
                  'receivingLeaf': str(leaf_path.relative_to(ROOT)), 'receivingLeafSha256': sha(leaf_path),
                  'sourceReceiving': copy.deepcopy(row), 'offset': offset,
                  'actualFailure': failure, 'adaptation': {'kind': 'local undersideflex', 'originalArtBand': [first, last],
                   'targetArtBand': [first, end], 'maxDisplacementWorldPx': (last-end)*clip['scaleToWorld']}})
rgb = np.asarray(seed).astype(float); edges = np.zeros(rgb.shape[:2], dtype=bool)
for axis in (0, 1): edges |= np.max(np.abs(rgb-np.roll(rgb, 1, axis=axis)), axis=2) > 35
guide = Image.fromarray((edges*255).astype('uint8')).filter(ImageFilter.MaxFilter(3))
BASE.mkdir(exist_ok=True)
for kind, picture in [('seed', seed), ('guide', guide), ('render-mask', mask)]:
    picture.convert('RGB').save(BASE / f'{key}-{kind}.png')
review.save(BASE / f'{key}-input-review.png')
template = EVIDENCE / 'art/tiled-floor-retarget-medium-pilot-bounded-source0-attempt1.workflow.json'
graph = json.loads(template.read_text()); uploads = {}
for node, kind, role in [('10', 'guide', 'guide'), ('13', 'seed', 'seed'), ('16', 'render-mask', 'mask')]:
    remote = f'pf-{key}-{role}.png'; graph[node]['inputs']['image'] = remote
    uploads[remote] = f'{key}-{kind}.png'
graph['4']['inputs']['text'] = 'Four independent Pikachu fixed-root source attack drawings. Modify ONLY the supplied masked tiny underside paw/body/tail contours to follow the bounded seed precisely. Preserve all unmasked upper body, face, ears, native attack orientation, core, stripes, scale and tail attachment. Keep each drawing distinct; no whole-body lift or replacement, no extra limb, shadow, floor or text. Flat yellow mouse, black outlines and ear tips, source red cheeks only where visible. Uniform magenta. '+', '.join(f'cell{i+1} {c["sheet"]} source{c["sourceSampleIndex"]}' for i,c in enumerate(cells))
for node, role in [('9', 'masked-final'), ('20', 'raw')]:
    graph[node]['inputs']['filename_prefix'] = f'pf-{key}-attempt1-{role}'
(BASE / f'{key}-attempt1.workflow.json').write_text(json.dumps(graph, indent=2)+'\n')
assert sha(frames_path) == frames_hash
prep['records'].append({'key': key, 'state': 'prepared_actual_input_review_pending', 'source_index': 0,
 'source_path': str((BASE/f'{key}-seed.png').relative_to(ROOT)), 'source_sha256': sha(BASE/f'{key}-seed.png'),
 'workflow': f'{key}-attempt1.workflow.json', 'upload_mapping': uploads,
 'hashes': {kind: sha(BASE/f'{key}-{kind}.png') for kind in ['seed', 'guide', 'render-mask']},
 'coordinate_contract': {'canvas': [2048, 2560], 'root': None, 'world_scale': 70/300},
 'cells': cells, 'input_review_sha256': sha(BASE/f'{key}-input-review.png'), 'parentGraphSha256': sha(template),
 'actualPlayedFailureReport': str(report_path.relative_to(ROOT)), 'actualPlayedFailureReportSha256': sha(report_path),
 'limits': ['Explicit bounded beta anatomy; no native pixel parity claim.', 'Receiving endpoints can be adapted only inside the same underside band; source radii, core, root, attack geometry and clocks remain exact.', 'Actual output inspection and exact-build gameplay recheck remain required.']})
prep_path.write_text(json.dumps(prep, indent=2)+'\n')
ledger = BASE/'full-generation-ledger.json'
if not ledger.exists(): ledger.write_text('[]\n')
print(json.dumps({'key': key, 'cells': len(cells), 'review': str(BASE/f'{key}-input-review.png'), 'GPU': False}))
