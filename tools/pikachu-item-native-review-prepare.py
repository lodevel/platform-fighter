"""Inspect essential held-item body/contact references; no GPU or gameplay clocks.

The existing framework has immediate pickup/throw events. Source ACMD contact
frames below are native reference cues, not new action commitments.
"""
import importlib.util, json, sys
from pathlib import Path
from PIL import Image, ImageDraw
import yaml

sys.path.insert(0, '/tmp/pikachu-source-libs')
from pikachu_native_pose import ROOT, MOTIONS, PikachuNativePose, sha

E = ROOT / 'docs/review/2026-10-06/pikachu-character'
OUT = E / 'sources/item-native-review'
OUT.mkdir(parents=True, exist_ok=True)
motion_list = E / 'sources/motion-list.yml'
declarations = yaml.safe_load(motion_list.read_bytes())['list']
attacks = json.loads((E / 'sources/native-attacks.json').read_text())['motions']
spec = importlib.util.spec_from_file_location('item_native_guide', ROOT / 'tools/pikachu-native-guide.py')
guide = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guide)
guide.SIZE = (2048, 2560)
guide.ART_ROOT = (1024, 1664)
guide.VIEW_SIDE = 'negative'
guide.ROOT_REGISTRATION = 'remove-trans-translation'

plan = [('wait_item', [0, 26, 53, 79, 106]), ('item_light_get', [0, 2, 7]), ('item_light_walk_get', [2])]
for suffix in ['f', 'b', 'hi', 'lw', 'air_f', 'air_b', 'air_hi', 'air_lw', 'drop']:
    action = 'item_light_throw_' + suffix
    script = next(v for v in attacks.values() if any(f['name'] == declarations[action]['game_script'] for f in v['functions']))
    release = next(e['frame'] for f in script['functions'] for e in f['events'] if 'THROW_ITEM_OFFSET' in e.get('raw', ''))
    if release != int(release):
        raise ValueError('Fractional contact cue requires explicit native sampling')
    plan.append((action, [int(release)]))

rows, panels = [], []
for action, samples in plan:
    declaration = declarations[action]
    motion = Path(declaration['animations'][0]['name']).stem
    pose = PikachuNativePose(MOTIONS / (motion + '.nuanmb'))
    script = next((v for v in attacks.values() if any(f['name'] == declaration['game_script'] for f in v['functions'])), None)
    if script is not None and sha(ROOT / script['path']) != script['sha256']:
        raise ValueError('Changed native contact script')
    for sample in samples:
        key = f'{action}-native{sample:g}'
        prefix = OUT / key
        if not prefix.with_suffix('.json').exists():
            guide.render(motion, sample, prefix)
        meta = json.loads(prefix.with_suffix('.json').read_text())
        for filename, digest in meta['output_files'].items():
            if sha(OUT / filename) != digest:
                raise ValueError('Changed retained native guide')
        matrices = pose.matrices(sample, ['Trans', 'HandR', 'HaveR', 'HandL', 'HaveL', 'Have'])
        trans = matrices['Trans'][:3, 3]
        joints = {}
        body = Image.open(str(prefix) + '-palette-seed.png').convert('RGB')
        draw = ImageDraw.Draw(body)
        for node, color in [('HandR', '#00ffff'), ('HaveR', '#ff8800'), ('HandL', '#ffffff'), ('HaveL', '#00ff00'), ('Have', '#aa88ff')]:
            point = matrices[node][:3, 3] - trans
            projected = {'x': float(5 * point[2]), 'y': float(25 - 5 * point[1])}
            joints[node] = {'matrix': matrices[node].tolist(), 'projectedBodyOffset': projected}
            x = guide.ART_ROOT[0] + point[2] * guide.ART_PIXELS_PER_UNIT
            y = guide.ART_ROOT[1] - point[1] * guide.ART_PIXELS_PER_UNIT
            draw.ellipse((x-12, y-12, x+12, y+12), outline=color, width=5)
        bounds = Image.open(str(prefix) + '-mask.png').getbbox()
        crop = (max(0, bounds[0]-45), max(0, bounds[1]-45), min(body.width, bounds[2]+45), min(body.height, bounds[3]+45))
        panel = Image.new('RGB', (1100, 580), '#17253a')
        for column, image in enumerate([Image.open(str(prefix)+'-reference.png').convert('RGBA'), body]):
            if image.mode == 'RGBA':
                bg = Image.new('RGBA', image.size, '#17253a'); bg.alpha_composite(image); image = bg.convert('RGB')
            image = image.crop(crop); image.thumbnail((530, 510))
            panel.paste(image, (column*550+(550-image.width)//2, 55+(510-image.height)//2))
        ImageDraw.Draw(panel).text((8, 8), key+' native / seed with HandR cyan, HaveR orange, HandL white, HaveL green, Have violet', fill='white')
        path = OUT / (key+'-review.png'); panel.save(path); panels.append(path)
        rows.append({'key': key, 'sourceAction': action, 'nativeSample': sample, 'motionDeclaration': declaration,
            'provenance': pose.provenance(), 'nativeGuideMetadata': str(prefix.with_suffix('.json').relative_to(ROOT)),
            'nativeGuideMetadataSha256': sha(prefix.with_suffix('.json')), 'script': script,
            'joints': joints, 'capturedTrans': trans.tolist(), 'runtimeClock': None,
            'nativeAttachmentNodeBinding': None, 'reviewPanel': str(path.relative_to(ROOT)),
            'reviewPanelSha256': sha(path), 'actualVisualReview': 'pending'})
galleries = {}
for start in range(0, len(panels), 3):
    path = OUT / f'gallery-{start//3+1:02}.png'
    image = Image.new('RGB', (1100, 580*len(panels[start:start+3])), '#17253a')
    for index, p in enumerate(panels[start:start+3]): image.paste(Image.open(p), (0, index*580))
    image.save(path); galleries[str(path.relative_to(ROOT))] = sha(path)
result = {'state': 'native_item_cues_pending_actual_review', 'scope': 'Existing six item types pickup/carry/throw only; no full native weapon-use branches or generation',
    'motionListSha256': sha(motion_list), 'rows': rows, 'galleries': galleries,
    'limits': ['Native contact cue samples do not establish the immediate framework event playback duration.',
        'Hand/Have bone projections are candidate attachments; item node/orientation and item grip offsets require native binding.',
        'Preview omits helper orient constraints and material animation, never generated fighter art or native collision proof.']}
(OUT/'preparation.json').write_text(json.dumps(result, indent=2)+'\n')
print(json.dumps({'nativeReferenceCues': len(rows), 'galleries': len(galleries), 'generation': 'none'}))
