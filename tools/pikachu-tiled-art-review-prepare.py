"""Prepare actual tiled output comparisons and checks; never auto-accept art."""
from pathlib import Path
from collections import deque
import argparse, ast, json
import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
B = ROOT / 'docs/review/2026-10-06/pikachu-character/art'
p = argparse.ArgumentParser()
p.add_argument('key')
p.add_argument('--attempt', type=int, choices=[1, 2, 3], default=1)
args = p.parse_args()
record = next(r for r in json.loads((B / 'tiled-pilot-preparation.json').read_text())['records']
              if r['key'] == args.key)
if args.attempt > 1:
    record = record['attempts'][str(args.attempt)]
output_key = args.key if args.attempt == 1 else args.key + f'-attempt{args.attempt}'
entry = next(r for r in json.loads((B / 'tiled-generation-ledger.json').read_text())
             if r['pose_key'] == args.key and r['attempt'] == args.attempt)
if entry['state'] not in ['succeeded', 'accepted', 'rejected']:
    raise ValueError('Output not completed')
component_node = next(n for n in ast.parse((B / 'build-remaining-pilot-inputs.py').read_text()).body
                      if isinstance(n, ast.FunctionDef) and n.name == 'components')
namespace = {'np': np, 'deque': deque}
exec(compile(ast.Module(body=[component_node], type_ignores=[]), 'components', 'exec'), namespace)
contract = record.get('coordinate_contract', {'cell_canvas': [512, 512], 'cell_root': [256, 416]})
width, height = contract['cell_canvas']
seed = Image.open(B / (args.key + '-seed.png')).convert('RGB')
guide = Image.open(B / (args.key + '-guide.png')).convert('RGB')
mask = np.asarray(Image.open(B / record.get('input_files', {}).get('render-mask', args.key + '-render-mask.png')).convert('L'))
final = Image.open(B / entry['outputs']['9']['file']).convert('RGB')
cutout = Image.open(B / entry['outputs']['cutout']['file']).convert('RGBA')
seed_pixels, final_pixels = np.asarray(seed), np.asarray(final)
changed = np.any(seed_pixels != final_pixels, axis=2)
checks = []
runtime_height = round(height / width * 512)
runtime_gallery = Image.new('RGB', (1024, (runtime_height + 36) * len(record['cells'])), '#17253a')
for cell in record['cells']:
    x, y = cell['offset']
    box = (x, y, x + width, y + height)
    art = cutout.crop(box)
    bounds = art.getbbox()
    if bounds is None:
        raise ValueError('Empty tiled cell')
    pixels = np.asarray(art)
    _, sizes = namespace['components'](pixels[:, :, 3] > 0)
    s = seed_pixels[y:y+height, x:x+width]
    m = mask[y:y+height, x:x+width]
    d = changed[y:y+height, x:x+width]
    protected = (s[:, :, 0] > 160) & (s[:, :, 1] < 90) & (s[:, :, 2] < 65) & (m == 0)
    checks.append({'cell': cell['index'], 'sourceKey': cell['sourceKey'],
                   'canvas': [width, height], 'root': contract['cell_root'],
                   'alphaBounds': list(bounds), 'componentSizes': sorted(sizes, reverse=True),
                   'unmaskedChanges': int(np.count_nonzero(d & (m == 0))),
                   'protectedRedPixels': int(protected.sum()),
                   'protectedRedChanges': int(np.count_nonzero(d & protected))})
    crop = (bounds[0]-15, bounds[1]-15, bounds[2]+15, bounds[3]+15)
    gallery = Image.new('RGB', (1600, 640), '#17253a')
    for column, im in enumerate([seed.crop(box), guide.crop(box), None, None]):
        if im is None:
            bg = Image.new('RGBA', art.size, '#f5f2ed' if column == 2 else '#17253a')
            bg.alpha_composite(art)
            im = bg.convert('RGB')
        im = im.crop(crop)
        scale = min(380/im.width, 580/im.height)
        im = im.resize((round(im.width*scale), round(im.height*scale)), Image.Resampling.NEAREST)
        gallery.paste(im, (column*400+(400-im.width)//2, 40+(580-im.height)//2))
    ImageDraw.Draw(gallery).text((8, 8), f'Actual cell{cell["index"]}: seed / control / generated light / generated dark', fill='white')
    gallery.save(B / (output_key + f'-actual-cell{cell["index"]}-review.png'))
    # Same final runtime pixel size, with uniform scale and no recentering.
    packed = art.resize((512, round(height/width*512)), Image.Resampling.LANCZOS)
    packed.save(B / (output_key + f'-cell{cell["index"]}-runtime-candidate.png'))
    top = cell['index'] * (runtime_height + 36)
    ImageDraw.Draw(runtime_gallery).text((8, top + 8), cell['sourceKey'] + ' actual512px candidate', fill='white')
    for side, color in enumerate(['#f5f2ed', '#17253a']):
        bg = Image.new('RGBA', packed.size, color)
        bg.alpha_composite(packed)
        runtime_gallery.paste(bg.convert('RGB'), (side * 512, top + 30))
runtime_gallery.save(B / (output_key + '-runtime-actual-review.png'))
(B / (output_key + '-mechanical-checks.json')).write_text(json.dumps(checks, indent=2) + '\n')
print(json.dumps({'cells': len(checks), 'mechanicalChecks': checks, 'actualVisualReview': 'pending'}))
