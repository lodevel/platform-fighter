"""Prepare down-throw body references without resolving its gameplay clock.

The victim/attachment, overlay status and release physics are separate inputs.
These CPU mesh references are authoring inputs, never distributed fighter art.
"""
from pathlib import Path
import hashlib
import importlib.util
import json
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
E = ROOT / 'docs/review/2026-10-06/pikachu-character'
OUT = ROOT / 'assets/gen/pikachu-native-reference/geometry-reference/down-throw'
REVIEW = E / 'sources/down-throw-native-body-review'
OUT.mkdir(parents=True, exist_ok=True)
REVIEW.mkdir(parents=True, exist_ok=True)
spec = importlib.util.spec_from_file_location('pikachu_throw_guide', ROOT / 'tools/pikachu-native-guide.py')
guide = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guide)
guide.SIZE = (2048, 2048)
guide.ART_ROOT = (1024, 1664)
guide.VIEW_SIDE = 'negative'
guide.ROOT_REGISTRATION = 'remove-trans-translation'
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
rows, panels = [], []
for sample in [0, 4, 8, 13, 14, 20, 21, 24, 28, 35, 43, 54]:
    prefix = OUT / f'down-throw-native{sample}'
    metadata = prefix.with_suffix('.json')
    if not metadata.exists():
        guide.render('e01throwlw', sample, prefix)
    data = json.loads(metadata.read_text())
    if data['canvas'] != list(guide.SIZE) or data['root'] != list(guide.ART_ROOT):
        raise ValueError('Changed registered down-throw reference')
    for name, expected in data['output_files'].items():
        if sha(OUT / name) != expected:
            raise ValueError('Changed native input: ' + name)
    seed = Image.open(str(prefix) + '-palette-seed.png').convert('RGB')
    native = Image.open(str(prefix) + '-reference.png').convert('RGBA')
    bounds = Image.open(str(prefix) + '-mask.png').getbbox()
    if bounds is None or bounds[0] == 0 or bounds[1] == 0 or bounds[2] == 2048 or bounds[3] == 2048:
        raise ValueError('Empty or clipped native body reference')
    crop = (max(0, bounds[0]-25), max(0, bounds[1]-25), min(2048, bounds[2]+25), min(2048, bounds[3]+25))
    background = Image.new('RGBA', native.size, '#17253a')
    background.alpha_composite(native)
    panel = Image.new('RGB', (1600, 550), '#17253a')
    for side, im in enumerate([background.convert('RGB'), seed]):
        im = im.crop(crop)
        im.thumbnail((780, 490))
        panel.paste(im, (side*800+(800-im.width)//2, 40+(490-im.height)//2))
    ImageDraw.Draw(panel).text((8, 8), f'Down throw native{sample} / reference + palette seed / victim omitted / inputs only', fill='white')
    panels.append(panel)
    rows.append({'nativeSample': sample, 'metadata': str(metadata.relative_to(ROOT)), 'metadataSha256': sha(metadata), 'bounds': list(bounds)})
for start in range(0, len(panels), 4):
    gallery = Image.new('RGB', (1600, 2200), '#17253a')
    for i, panel in enumerate(panels[start:start+4]):
        gallery.paste(panel, (0, i*550))
    gallery.save(REVIEW / f'native-body-gallery-{start//4+1}.png')
record = {'state': 'native_body_inputs_pending_actual_visual_review', 'rows': rows,
    'coordinateContract': {'canvas': list(guide.SIZE), 'root': list(guide.ART_ROOT), 'worldScale': 70/600, 'registration': 'remove-trans-translation'},
    'galleries': {p.name: sha(p) for p in sorted(REVIEW.glob('*gallery-*.png'))},
    'limits': ['Native integer samples are not assigned gameplay frames; UFD29/native21 release remains unresolved',
        'Victim pose, attachment, status, launch and collisions not supplied by this body-only renderer',
        'Helper constraints, material animation and VFX omitted',
        'No generation submission, visual approval or runtime qualification']}
(REVIEW / 'preparation.json').write_text(json.dumps(record, indent=2)+'\n')
print(json.dumps({'nativeBodyInputs': len(rows), 'review': 'pending actual inspection'}), flush=True)
