"""Prepare seven authored dash contact projections for manual review.

Native Trans translation is removed consistently with fixed-root art. This
does not establish dash actor kinetics, native collision radii or patch parity.
"""
from pathlib import Path
import hashlib, json
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
E = ROOT / 'docs/review/2026-10-06/pikachu-character'
B = E / 'art'
OUT = E / 'sources/posed-resources'
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
native_path = E / 'sources/native-attacks.json'
reference_path = OUT / 'dash-attack-reference-samples.json'
native = json.loads(native_path.read_text())['motions']['pikachu/AttackDash']
attacks = next(f['attacks'] for f in native['functions'] if f['name'] == 'game_attackdash')
samples = json.loads(reference_path.read_text())['frames']
rows = [r for r in json.loads((B/'normal-pilot-preparation.json').read_text())['records']
        if r['action'] == 'dash-attack' and 5 <= r['source_index'] <= 11]
assert len(rows) == 7
projected = []
gallery = Image.new('RGB', (2400, 650*2), '#17253a')
labels = ImageDraw.Draw(gallery)
for i, row in enumerate(rows):
    game = row['source_index'] + 1
    active = [a for a in attacks if a['frame'] <= game < a['end_frame']]
    assert len(active) == 1 and active[0]['bone'] == 'neck'
    attack = active[0]
    matrices = {k.lower(): v for k, v in samples[row['source_index']]['matrices'].items()}
    matrix, trans = matrices['neck'], [matrices['trans'][axis][3] for axis in range(3)]
    local = [attack['x'], attack['y'], attack['z']]
    local_end = [attack[k+'2'] if attack[k+'2'] is not None else attack[k] for k in ['x','y','z']]
    def point(coords):
        world = [sum(matrix[axis][j]*coords[j] for j in range(3))
                 + matrix[axis][3] - trans[axis] for axis in range(3)]
        return {'x': world[2]*5, 'y': 25-world[1]*5}
    start, end = point(local), point(local_end)
    projected.append({'gameFrame': game, 'sourceIndex': row['source_index'],
        'id': attack['id'], 'bone': attack['bone'], 'sourceLocal': local,
        'sourceEnd': local_end, 'start': start, 'end': end,
        'sourceDamage': attack['damage'], 'sourceSize': attack['size'],
        'authoredWorldRadius': attack['size']*5})
    job = row['key'] + f"-attempt{row.get('chosen_art_attempt',1)}-cutout.png"
    final = B/job
    im = Image.open(final if final.exists() else B/(row['key']+'-seed.png')).convert('RGBA')
    overlay = Image.new('RGBA', im.size)
    draw = ImageDraw.Draw(overlay)
    radius = attack['size']*5/(70/600)
    x, y = 1024+start['x']/(70/600), 1152+(start['y']-25)/(70/600)
    draw.ellipse((x-radius,y-radius,x+radius,y+radius), outline='#ff809c', width=5)
    im.alpha_composite(overlay)
    bounds = Image.open(B/(row['key']+'-anatomy-mask.png')).getbbox()
    im = im.crop((bounds[0]-230,bounds[1]-230,bounds[2]+230,bounds[3]+230))
    im.thumbnail((590,600))
    px, py = i%4*600, i//4*650
    gallery.paste(im.convert('RGB'), (px+(600-im.width)//2,py+40))
    labels.text((px+8,py+8), f'game{game} damage{attack["damage"]} / '+('actual final' if final.exists() else 'GUIDE ONLY'), fill='white')
gallery.save(B/'normal-dash-attack-contact-overlay-review.png')
record = {'state': 'manual_review_required_not_runtime_data',
    'referenceSha256': sha(reference_path), 'nativeAttacksSha256': sha(native_path),
    'sourceScriptSha256': native['sha256'],
    'coordinate_contract': 'Authored orthographic x=5*z, y=25-5*y after removing native Trans translation; common art root1024,1152 and scale70/600. Source size*5 is an authored circle radius; native consumer/patch parity unqualified.',
    'mapping': 'UFD source index=gameFrame-1; same-index native pose comparison inspected, 62-sample native clock and kinetic travel remain unqualified.',
    'overlaySha256': sha(B/'normal-dash-attack-contact-overlay-review.png'), 'rows': projected}
(OUT/'dash-attack-contact-candidates.json').write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps({'frames': len(projected), 'state': record['state']}))
