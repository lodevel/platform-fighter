"""Show guarded source capsules on actually reviewed packed tiled body drawings."""
import argparse, json
import numpy as np
from PIL import Image, ImageDraw
from pikachu_native_pose import ROOT, MOTIONS, PikachuNativePose, sha
from pikachu_authored_pose_adaptation import apply_authored_receiving_adaptation

E = ROOT / 'docs/review/2026-10-06/pikachu-character'
OUT = E / 'sources/full-body-native-review/tiled-receiving'
OUT.mkdir(parents=True, exist_ok=True)
p = argparse.ArgumentParser()
p.add_argument('family')
args = p.parse_args()
prepared = json.loads((E / 'sources/full-body-native-review' / args.family / 'preparation.json').read_text())
caps = json.loads((E / 'sources/native-hurtbox-capsules.json').read_text())['capsules']
names = list(dict.fromkeys(['Trans'] + [r['bone']['label'] for r in caps]))
prior_path = OUT / (args.family + '-candidates.json')
prior = json.loads(prior_path.read_text())['rows'] if prior_path.exists() else []
rows, evaluators = [], {}
for meta in sorted((ROOT / 'assets/characters/pikachu/pose-batches').glob('full-*-tiled.json')):
    pack = json.loads(meta.read_text())
    if pack['state'] != 'packed_cells_visually_reviewed_runtime_pending':
        continue
    sources = pack['sources']
    if not sources or not any(r['key'] == sources[0]['sourceKey'] for r in prepared['records']):
        continue
    sheet, animation = next(iter(pack['animations'].items()))
    file = ROOT / 'assets/characters/pikachu' / animation['strip']
    if sha(file) != animation['sha256']:
        raise ValueError('Changed reviewed packed body')
    strip = Image.open(file).convert('RGBA')
    coords = pack['coordinateContract']
    width, height = coords['frameWidth'], coords['frameHeight']
    pixel_per_world = 1 / coords['scaleToWorld']
    root = coords['root']
    for index, source in enumerate(sources):
        r = next(r for r in prepared['records'] if r['key'] == source['sourceKey'])
        if r['motion'] not in evaluators:
            evaluators[r['motion']] = PikachuNativePose(MOTIONS / (r['motion'] + '.nuanmb'))
        pose = evaluators[r['motion']]
        matrices = pose.matrices(r['native_sample_index'], names)
        matrices, adaptation = apply_authored_receiving_adaptation(
            matrices, source, r['motion'], r['native_sample_index'])
        trans = matrices['Trans'][:3, 3]
        hurtboxes = []
        for cap in caps:
            matrix = matrices[cap['bone']['label']]
            radius = float(cap['size'] * max(np.linalg.norm(matrix[:3, n]) for n in range(3)) * 5)
            points = []
            for endpoint in ['endpoint1', 'endpoint2']:
                point = (matrix @ np.array([*cap[endpoint], 1]))[:3] - trans
                points.append({'x': float(5 * point[2]), 'y': float(25 - 5 * point[1])})
            a, b = points
            minimum = [min(a[k], b[k]) - radius for k in ['x', 'y']]
            maximum = [max(a[k], b[k]) + radius for k in ['x', 'y']]
            hurtboxes.append({'id': f'pikachu.{r["action"]}.{cap["index"]}.{cap["bone"]["label"]}',
                'offsetX': (minimum[0] + maximum[0]) / 2, 'offsetY': (minimum[1] + maximum[1]) / 2,
                'width': maximum[0] - minimum[0], 'height': maximum[1] - minimum[1],
                'capsule': {'start': a, 'end': b, 'radius': radius}})
        columns = animation.get('columns', animation['frameCount'])
        x, y = (index % columns) * width, (index // columns) * height
        body = strip.crop((x, y, x + width, y + height))
        bg = Image.new('RGBA', body.size, '#17253a')
        bg.alpha_composite(body)
        draw = ImageDraw.Draw(bg)
        for box in hurtboxes:
            c = box['capsule']
            radius = c['radius'] * pixel_per_world
            points = [(root[0] + p['x'] * pixel_per_world,
                       root[1] + (p['y'] - 25) * pixel_per_world) for p in [c['start'], c['end']]]
            draw.line(points, fill='#b5a6ff', width=1)
            for x, y in points:
                draw.ellipse((x-radius, y-radius, x+radius, y+radius), outline='#b5a6ff', width=1)
        bounds = body.getbbox()
        # Near-edge native tails can extend past this review margin. Clamp the
        # viewport so Pillow does not invent opaque black padding outside the
        # saved cell; this changes only the inspection crop, never body/root.
        bg = bg.crop((max(0, bounds[0]-25), max(0, bounds[1]-25),
                      min(bg.width, bounds[2]+25), min(bg.height, bounds[3]+25)))
        bg = bg.resize((bg.width * 2, bg.height * 2), Image.Resampling.NEAREST)
        bg.thumbnail((780, 530))
        panel = Image.new('RGB', (800, 580), '#17253a')
        panel.paste(bg.convert('RGB'), ((800-bg.width)//2, 40))
        ImageDraw.Draw(panel).text((8, 8), r['key'] + ' actual packed accepted body /12capsules', fill='white')
        path = OUT / (sheet + '-' + r['key'] + '-candidate.png')
        panel.save(path)
        window = next((w for w in animation['frameWindows'] if w['artFrameIndex'] == index), None)
        row = {'key': r['key'], 'action': r['action'], 'sheet': sheet, 'artFrameIndex': index,
            'nativeSample': r['native_sample_index'], 'frameWindow': window, 'hurtboxes': hurtboxes,
            'provenance': pose.provenance(), 'boneMatrices': {n: m.tolist() for n, m in matrices.items()},
            'packedBodySha256': sha(file), 'reviewPanel': str(path.relative_to(ROOT)),
            'reviewPanelSha256': sha(path), 'receivingReview': 'pending actual body/overlay inspection'}
        if adaptation:
            row['authoredGeometryAdaptation'] = adaptation
            row['geometryProvenance'] = 'Reviewed source-guided authored target anatomy; original ten core regions/radii retained, tail1/tail3 receiving rotates with target tail.'
        old = next((x for x in prior if x['key'] == row['key'] and x['sheet'] == sheet
                    and x['packedBodySha256'] == row['packedBodySha256']
                    and x['reviewPanelSha256'] == row['reviewPanelSha256']), None)
        if old:
            row['receivingReview'] = old['receivingReview']
        rows.append(row)
for sheet in dict.fromkeys(r['sheet'] for r in rows):
    selected = [r for r in rows if r['sheet'] == sheet]
    for start in range(0, len(selected), 4):
        gallery = Image.new('RGB', (1600, 1160), '#17253a')
        for i, r in enumerate(selected[start:start+4]):
            gallery.paste(Image.open(ROOT / r['reviewPanel']), (i % 2 * 800, i // 2 * 580))
        gallery.save(OUT / f'{sheet}-receiving-gallery-{start//4+1}.png')
prior_path.write_text(json.dumps({'state': 'pending actual receiving review', 'rows': rows,
    'capsulesSourceSha256': sha(E / 'sources/native-hurtbox-capsules.json'),
    'limits': ['Sparse target2D capsule adaptation; not native3D collision parity.',
               'Postaction source cells have null playable windows and stay excluded from runtime.']}, indent=2) + '\n')
print(json.dumps({'family': args.family, 'acceptedBodyCandidates': len(rows)}))
