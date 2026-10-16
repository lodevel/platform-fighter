"""Make actual screenshot crops for manual inspection; never emits acceptance."""
import argparse
import json
import math
from pathlib import Path
from PIL import Image, ImageDraw

parser = argparse.ArgumentParser()
parser.add_argument('directory', type=Path)
args = parser.parse_args()
record = json.loads((args.directory / 'observations.json').read_text())
cells = []
for case in record.get('cases', record.get('rows', [])) + record.get('protectionRows', []):
    for capture in case.get('captures', []):
        image = Image.open(args.directory / capture['screenshot']).convert('RGB')
        view = capture.get('view', capture)
        camera, canvas = view['camera'], view['canvas']
        world = camera['worldView']
        observation = capture['observation']
        if 'jumper' in observation:
            actors = [('jumper', observation['jumper']), ('target', observation['target'])]
            if 'holder' in observation:
                actors.append(('holder', observation['holder']))
        elif 'actor' in observation and 'target' in observation:
            actors = [('actor', observation['actor']), ('target', observation['target'])]
        else:
            actors = [('body', observation.get('actor', observation))]
        for name, actor in actors:
            root = actor['spritePosition']
            sx = canvas['width'] / canvas['internalWidth']
            sy = canvas['height'] / canvas['internalHeight']
            center_x = canvas['left'] + (camera['x'] + (root['x'] - world['x']) * camera['zoom']) * sx
            center_y = canvas['top'] + (camera['y'] + (root['y'] - world['y']) * camera['zoom']) * sy
            radius_x, radius_y = 105 * camera['zoom'] * sx, 105 * camera['zoom'] * sy
            box = (math.floor(center_x-radius_x), math.floor(center_y-radius_y), math.ceil(center_x+radius_x), math.ceil(center_y+radius_y))
            crop = image.crop(box).resize((300, 300), Image.Resampling.NEAREST)
            cell = Image.new('RGB', (320, 358), '#f6f6f6')
            cell.paste(crop, (10, 50))
            draw = ImageDraw.Draw(cell)
            state = actor.get('surface') or actor.get('auxiliary') or actor.get('recipient') or actor.get('presentation') or actor.get('recovery') or actor.get('reaction')
            age = state.get('framesElapsed') if state else None
            draw.text((8, 3), f"{capture['screenshot']} {name}"[:50], fill='#171717')
            draw.text((8, 19), f"{actor['texture'].split('.')[-1]} art{actor['textureFrame']} age{age}", fill='#171717')
            draw.text((8, 35), f"face{actor['facing']} caps{len(actor['receiving'])} protected{actor.get('invincible')}", fill='#171717')
            cells.append((cell, {'screenshot': capture['screenshot'], 'actor': name, 'cropBox': box, 'age': age, 'texture': actor['texture'], 'artFrame': actor['textureFrame']}))

pages = []
for start in range(0, len(cells), 24):
    selected = cells[start:start+24]
    page = Image.new('RGB', (1280, 358*math.ceil(len(selected)/4)), '#dedede')
    for i, (cell, _) in enumerate(selected):
        page.paste(cell, ((i % 4)*320, (i // 4)*358))
    name = f'actual-contact-page-{start//24+1}.png'
    page.save(args.directory / name)
    pages.append({'page': name, 'captures': [entry for _, entry in selected]})
(args.directory / 'actual-contact-pages.json').write_text(json.dumps({'state':'MANUAL_INSPECTION_REQUIRED', 'scope':'Crops from actual immutable MatchScene screenshots using recorded camera/canvas transforms. No automated visual acceptance.', 'pages':pages}, indent=2)+'\n')
print(json.dumps({'pages':len(pages), 'actorCrops':len(cells)}))
