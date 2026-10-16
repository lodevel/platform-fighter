"""Prepare Thunder body references without assigning gameplay clocks or art approval.

Ground/air summon and ground/air self-contact are distinct native clips. These
registered CPU references omit helper constraints, material animation and VFX;
they are authoring inputs, never shipped fighter sprites or collision proof.
"""
from pathlib import Path
import hashlib
import importlib.util
import json
import sys
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
E = ROOT / 'docs/review/2026-10-06/pikachu-character'
# Thunder's raised tail exceeds the earlier normal-attack canvas. Keep that
# first pass for evidence and add top padding, retaining scale and world root.
padded = '--padded' in sys.argv[1:]
if any(arg != '--padded' for arg in sys.argv[1:]):
    raise SystemExit('Expected optional --padded')
suffix = '-padded' if padded else ''
OUT = ROOT / ('assets/gen/pikachu-native-reference/geometry-reference/thunder' + suffix)
REVIEW = E / ('sources/thunder-native-body-review' + suffix)
OUT.mkdir(parents=True, exist_ok=True)
REVIEW.mkdir(parents=True, exist_ok=True)
spec = importlib.util.spec_from_file_location('pikachu_thunder_guide', ROOT / 'tools/pikachu-native-guide.py')
guide = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guide)
guide.SIZE = (2048, 2048) if padded else (2048, 1536)
guide.ART_ROOT = (1024, 1664) if padded else (1024, 1152)
guide.VIEW_SIDE = 'negative'
guide.ROOT_REGISTRATION = 'remove-trans-translation'
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
clips = [
    ('thunder-ground', 'd03speciallw', [0, 4, 12, 16, 24, 32, 46, 92]),
    ('thunder-air', 'd03specialairlw', [0, 4, 12, 16, 24, 32, 46, 92]),
    ('thunder-self-contact-ground', 'd03speciallwhit', [0, 1, 3, 6, 15, 24, 35, 66]),
    ('thunder-self-contact-air', 'd03specialairlwhit', [0, 1, 3, 6, 15, 24, 35, 48]),
]
rows = []
for action, motion, indices in clips:
    panels = []
    for sample in indices:
        prefix = OUT / f'{action}-native{sample}'
        metadata = prefix.with_suffix('.json')
        if not metadata.exists():
            guide.render(motion, sample, prefix)
        data = json.loads(metadata.read_text())
        if data['canvas'] != list(guide.SIZE) or data['root'] != list(guide.ART_ROOT):
            raise ValueError('Changed registered Thunder reference')
        for name, expected in data['output_files'].items():
            if sha(OUT / name) != expected:
                raise ValueError('Changed native authoring input: ' + name)
        seed = Image.open(str(prefix) + '-palette-seed.png').convert('RGB')
        native = Image.open(str(prefix) + '-reference.png').convert('RGBA')
        mask = Image.open(str(prefix) + '-mask.png').convert('L')
        bounds = mask.getbbox()
        if bounds is None:
            raise ValueError('Empty Thunder body reference')
        if padded and (bounds[0] == 0 or bounds[1] == 0
                       or bounds[2] == guide.SIZE[0] or bounds[3] == guide.SIZE[1]):
            raise ValueError('Padded Thunder body still reaches canvas edge')
        # Crops are review-only; full registered originals remain unchanged.
        crop = (max(0, bounds[0]-25), max(0, bounds[1]-25),
                min(guide.SIZE[0], bounds[2]+25), min(guide.SIZE[1], bounds[3]+25))
        panel = Image.new('RGB', (1600, 550), '#17253a')
        background = Image.new('RGBA', native.size, '#17253a')
        background.alpha_composite(native)
        for side, im in enumerate([background.convert('RGB'), seed]):
            im = im.crop(crop)
            im.thumbnail((780, 490))
            panel.paste(im, (side*800+(800-im.width)//2, 40+(490-im.height)//2))
        ImageDraw.Draw(panel).text((8, 8),
            f'{action} / native sample{sample} / reference + palette seed / VFX omitted / inputs only', fill='white')
        filename = f'{action}-native{sample}-review.png'
        panel.save(REVIEW / filename)
        panels.append(panel)
        rows.append({'action': action, 'motion': motion, 'nativeSample': sample,
            'metadata': str(metadata.relative_to(ROOT)), 'metadataSha256': sha(metadata),
            'panel': str((REVIEW / filename).relative_to(E)), 'panelSha256': sha(REVIEW / filename),
            'bounds': list(bounds), 'canvas': list(guide.SIZE), 'root': list(guide.ART_ROOT),
            'sourceClock': 'native integer animation sample; fixed-step gameplay mapping unresolved'})
    for batch in range(2):
        gallery = Image.new('RGB', (1600, 2200), '#17253a')
        for i, panel in enumerate(panels[batch*4:(batch+1)*4]):
            gallery.paste(panel, (0, i*550))
        gallery.save(REVIEW / f'{action}-native-body-gallery-{batch+1}.png')
record = {'state': 'native_body_inputs_pending_actual_visual_review', 'rows': rows,
    'coordinateContract': {'canvas': list(guide.SIZE), 'root': list(guide.ART_ROOT),
        'worldScale': 70/600, 'topPaddingFromNormalCanvas': 512 if padded else 0,
        'registration': 'remove-trans-translation; scale and world-root location retained'},
    'galleries': {p.name: sha(p) for p in sorted(REVIEW.glob('*gallery-*.png'))},
    'limits': ['Native body clips are separate from cloud/bolt and conditional electrical effects',
        'No UFD-index/gameplay clock identity inferred from matching native/GIF sample counts',
        'Helper constraints, material animation/shader effects omitted by CPU reference renderer',
        'Root removes Trans translation for authoring only; kinetics not implemented',
        'No GPU submission, visual acceptance or full Thunder runtime qualification']}
(REVIEW / 'preparation.json').write_text(json.dumps(record, indent=2) + '\n')
print(json.dumps({'preparedNativeBodySamples': len(rows), 'manualReviewPending': True}), flush=True)
