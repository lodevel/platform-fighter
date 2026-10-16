"""Mechanical checks and actual-output review panels; never accepts drawings."""
from pathlib import Path
from collections import deque
import ast
import json
import sys
import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
B = ROOT / 'docs/review/2026-10-06/pikachu-character/art'
if len(sys.argv) != 2 or sys.argv[1] not in ['jab', 'dash-attack', 'forward-smash', 'up-smash', 'down-smash', 'forward-smash-charge', 'up-smash-charge', 'down-smash-charge', 'up-tilt', 'down-tilt', 'up-air', 'down-air', 'down-air-landing', 'neutral-air', 'back-air', 'back-air-landing', 'thunder-ground', 'thunder-air', 'thunder-self-contact-ground', 'thunder-self-contact-air']:
    raise SystemExit('Expected a prepared normal action')
action = sys.argv[1]
family = 'thunder' if action.startswith('thunder-') else 'normal'
rows = [r for r in json.loads((B/f'{family}-pilot-preparation.json').read_text())['records'] if r['action'] == action]
# Reuse the documented8-neighbour anatomy component measurement without
# executing the older authoring script's generation side effects.
node = next(n for n in ast.parse((B/'build-remaining-pilot-inputs.py').read_text()).body
    if isinstance(n, ast.FunctionDef) and n.name == 'components')
namespace = {'np': np, 'deque': deque}
exec(compile(ast.Module(body=[node], type_ignores=[]), 'components', 'exec'), namespace)
checks = []
for batch in range((len(rows)+3)//4):
    available = [r for r in rows[batch*4:(batch+1)*4] if (B/(r['key']+f"-attempt{r.get('chosen_art_attempt',1)}-cutout.png")).exists()]
    if not available:
        continue
    gallery = Image.new('RGB', (1800, 520*len(available)), '#17253a')
    draw = ImageDraw.Draw(gallery)
    for i, row in enumerate(available):
        key = row['key']
        attempt = row.get('chosen_art_attempt',1)
        job = key+f'-attempt{attempt}'
        inputs = row if attempt == 1 else row['attempts'][str(attempt)]
        image = Image.open(B/(job+'-cutout.png')).convert('RGBA')
        bounds = image.getbbox()
        if bounds is None:
            raise ValueError('Empty drawing: '+key)
        crop = image.crop((bounds[0]-20, bounds[1]-20, bounds[2]+20, bounds[3]+20))
        crop.thumbnail((840, 460))
        for j, color in enumerate(['#f7f5ef', '#17253a']):
            background = Image.new('RGBA', crop.size, color)
            background.alpha_composite(crop)
            gallery.paste(background.convert('RGB'), (j*900+(900-background.width)//2, i*520+45+(460-background.height)//2))
        draw.text((10, i*520+10), key+' actual generated final / light and dark alpha', fill='white')
        final = np.array(Image.open(B/(job+'.png')).convert('RGB'))
        seed = np.array(Image.open(B/inputs.get('input_files',{}).get('seed',key+'-seed.png')).convert('RGB'))
        mask = np.array(Image.open(B/inputs.get('input_files',{}).get('render-mask',key+'-render-mask.png')).convert('RGB'))[:, :, 0]
        pixels = np.array(image)
        protected_red = (seed[:, :, 0] > 160) & (seed[:, :, 1] < 90) & (seed[:, :, 2] < 65) & (mask == 0)
        checks.append({'key': key, 'canvas': list(image.size),
            'alpha_range': [int(pixels[:, :, 3].min()), int(pixels[:, :, 3].max())],
            'bounds': list(bounds), 'unmasked_changes': int(np.any(final != seed, axis=2)[mask == 0].sum()),
            'protected_red_pixels': int(protected_red.sum()),
            'protected_red_changes': int(np.any(final != seed, axis=2)[protected_red].sum()),
            'component_sizes': namespace['components'](pixels[:, :, 3] > 0)[1]})
    gallery.save(B/f'{family}-{action}-generated-alpha-review-{batch+1}.png')
(B/f'{family}-{action}-generated-mechanical-checks.json').write_text(json.dumps(checks, indent=2)+'\n')
print(json.dumps({'action': action, 'available': len(checks), 'planned': len(rows), 'visual_acceptance': 'pending actual inspection'}))
