"""Guarded native special receiving candidates; actual body review remains separate."""
import json, sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw
sys.path.insert(0, str(Path(__file__).resolve().parent))
from pikachu_native_pose import ROOT, MOTIONS, PikachuNativePose, sha

E = ROOT / 'docs/review/2026-10-06/pikachu-character'
B = E / 'art'
OUT = E / 'sources/full-body-native-review/special-receiving'
OUT.mkdir(parents=True, exist_ok=True)
caps = json.loads((E / 'sources/native-hurtbox-capsules.json').read_text())['capsules']
names = list(dict.fromkeys(['Trans'] + [h['bone']['label'] for h in caps]))
prepared = json.loads((B / 'thunder-pilot-preparation.json').read_text())['records']
prepared += json.loads((E / 'sources/full-body-native-review/specials/preparation.json').read_text())['records']
ledger = json.loads((B / 'thunder-generation-ledger.json').read_text())
rows = []
prior = json.loads((OUT / 'candidates.json').read_text())['rows'] if (OUT / 'candidates.json').exists() else []
evaluators = {}
for r in prepared:
    motion = r['motion']
    pose = evaluators.setdefault(motion, PikachuNativePose(MOTIONS / (motion + '.nuanmb')))
    sample = r['native_sample_index']
    matrices = pose.matrices(sample, names)
    trans = matrices['Trans'][:3, 3]
    boxes = []
    for h in caps:
        m = matrices[h['bone']['label']]
        radius = float(h['size'] * max(np.linalg.norm(m[:3, j]) for j in range(3)) * 5)
        points = []
        for end in ['endpoint1', 'endpoint2']:
            v = (m @ np.array([*h[end], 1]))[:3] - trans
            points.append({'x': float(v[2] * 5), 'y': float(25 - v[1] * 5)})
        a, z = points
        minx, maxx = min(a['x'], z['x']) - radius, max(a['x'], z['x']) + radius
        miny, maxy = min(a['y'], z['y']) - radius, max(a['y'], z['y']) + radius
        boxes.append({'id': f'pikachu.{r["action"]}.{h["index"]}.{h["bone"]["label"]}',
                      'offsetX': (minx + maxx) / 2, 'offsetY': (miny + maxy) / 2,
                      'width': maxx - minx, 'height': maxy - miny,
                      'capsule': {'start': a, 'end': z, 'radius': radius}})
    accepted = next((x for x in ledger if x['pose_key'] == r['key'] and x['state'] == 'accepted'), None)
    body = B / accepted['outputs']['cutout']['file'] if accepted else B / (r['key'] + '-seed.png')
    im = Image.open(body).convert('RGBA')
    bg = Image.new('RGBA', im.size, '#17253a')
    bg.alpha_composite(im)
    draw = ImageDraw.Draw(bg)
    for h in boxes:
        c = h['capsule']
        rad = c['radius'] / (70 / 600)
        pts = [(1024 + p['x'] / (70 / 600), 1664 + (p['y'] - 25) / (70 / 600))
               for p in [c['start'], c['end']]]
        draw.line(pts, fill='#b5a6ff', width=3)
        for x, y in pts:
            draw.ellipse((x-rad, y-rad, x+rad, y+rad), outline='#b5a6ff', width=3)
    bounds = im.getbbox() if accepted else Image.open(B / (r['key'] + '-anatomy-mask.png')).getbbox()
    crop = (bounds[0]-100, bounds[1]-100, bounds[2]+100, bounds[3]+100)
    bg = bg.crop(crop)
    bg.thumbnail((780, 530))
    panel = Image.new('RGB', (800, 580), '#17253a')
    panel.paste(bg.convert('RGB'), ((800-bg.width)//2, 40))
    ImageDraw.Draw(panel).text((8, 8), r['key'] + (' / actual accepted body' if accepted else ' / GUIDE ONLY'), fill='white')
    target = OUT / (r['key'] + '-candidate.png')
    panel.save(target)
    rows.append({'key': r['key'], 'action': r['action'], 'nativeSample': sample,
                 'provenance': pose.provenance(), 'capturedTrans': trans.tolist(),
                 'boneMatrices': {n: m.tolist() for n, m in matrices.items()},
                 'hurtboxes': boxes, 'bodyPath': str(body.relative_to(ROOT)), 'bodySha256': sha(body),
                 'bodyIsAcceptedFinal': bool(accepted), 'reviewPanel': str(target.relative_to(ROOT)),
                 'reviewPanelSha256': sha(target), 'receivingReview': 'pending actual body/overlay inspection'})
    old = next((x for x in prior if x['key'] == r['key'] and x['bodySha256'] == rows[-1]['bodySha256']
                and x['reviewPanelSha256'] == rows[-1]['reviewPanelSha256']), None)
    if old:
        rows[-1]['receivingReview'] = old['receivingReview']
galleries = {}
for action in dict.fromkeys(r['action'] for r in rows):
    selected = [r for r in rows if r['action'] == action]
    for start in range(0, len(selected), 4):
        gal = Image.new('RGB', (1600, 1160), '#17253a')
        for i, r in enumerate(selected[start:start+4]):
            gal.paste(Image.open(ROOT / r['reviewPanel']), (i % 2 * 800, i // 2 * 580))
        target = OUT / (action + f'-receiving-gallery-{start//4+1}.png')
        gal.save(target)
        galleries[str(target.relative_to(ROOT))] = sha(target)
(OUT / 'candidates.json').write_text(json.dumps({
    'state': 'source candidates, not qualified runtime receiving',
    'projection': {'nativeUnitsToWorld': 5, 'rootBelowBodyCentre': 25, 'removeTrans': True,
                   'radiusRule': 'maximum world matrix column length times native radius'},
    'capsulesSourceSha256': sha(E / 'sources/native-hurtbox-capsules.json'),
    'rows': rows, 'galleries': galleries,
    'limits': ['Authored sparse native samples; no interpolation or status-duration inference',
               'Guide-only rows cannot qualify receiving fit of future generated drawings',
               'Requires actual final body/overlay review, branch clock mapping, and running-match contacts'],
}, indent=2) + '\n')
print(json.dumps({'poses': len(rows), 'capsules': len(rows) * len(caps),
                  'acceptedFinalBodies': sum(r['bodyIsAcceptedFinal'] for r in rows)}))
