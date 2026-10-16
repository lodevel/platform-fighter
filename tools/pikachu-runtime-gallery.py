#!/usr/bin/env python3
"""Crop actual browser screenshots for inspection; never alter game assets.

Records source screenshot hashes and crop rectangles, including explicit missing
visible-body tiles. Creating a gallery does not constitute visual acceptance.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
from PIL import Image, ImageDraw


def digest(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()


def body_centre(image):
    pixels = image.load()
    mask = set()
    for y in range(max(0, image.height - 130)):
        for x in range(image.width):
            red, green, blue = pixels[x, y]
            if red > 150 and green > 105 and blue < 105 and red > blue * 1.7:
                mask.add((x, y))
    components = []
    while mask:
        first = mask.pop()
        pending, component = [first], [first]
        while pending:
            x, y = pending.pop()
            for point in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if point in mask:
                    mask.remove(point)
                    pending.append(point)
                    component.append(point)
        components.append(component)
    if not components:
        return None
    component = max(components, key=len)
    return (sum(p[0] for p in component) / len(component),
            sum(p[1] for p in component) / len(component))


parser = argparse.ArgumentParser()
parser.add_argument('observations', type=Path)
args = parser.parse_args()
record = json.loads(args.observations.read_text())
output = args.observations.parent
rows = record.get('rows', []) + record.get('groundBodies', [])
review = {'state': 'gallery_created_actual_inspection_pending',
          'observations': args.observations.name,
          'observationsSha256': digest(args.observations), 'galleries': []}
for index, row in enumerate(rows):
    captures = row.get('captures', [])
    if not captures:
        continue
    columns = min(4, len(captures))
    gallery = Image.new('RGB', (columns * 400, math.ceil(len(captures) / columns) * 330), (36, 36, 42))
    draw = ImageDraw.Draw(gallery)
    crops = []
    for n, capture in enumerate(captures):
        file = output / capture['screenshot']
        image = Image.open(file).convert('RGB')
        centre = body_centre(image)
        rectangle = None
        if centre:
            x = max(0, min(image.width - 400, int(centre[0] - 200)))
            y = max(0, min(image.height - 300, int(centre[1] - 130)))
            rectangle = [x, y, x + 400, y + 300]
            tile = image.crop(rectangle)
        else:
            tile = image.resize((400, 225))
        offset = ((n % columns) * 400, (n // columns) * 330)
        gallery.paste(tile, (offset[0], offset[1] + 30))
        draw.text((offset[0] + 4, offset[1] + 7), file.name, fill='white')
        if centre is None:
            draw.text((offset[0] + 4, offset[1] + 275), 'NO VISIBLE PIKACHU: full viewport retained', fill='orange')
        crops.append({'screenshot': file.name, 'sha256': digest(file), 'crop': rectangle})
    name = f'actual-runtime-case-{index + 1:02d}-gallery.png'
    gallery.save(output / name)
    review['galleries'].append({'file': name, 'sha256': digest(output / name),
        'case': {key: row[key] for key in ['facing', 'air', 'hit', 'charge', 'second'] if key in row},
        'captures': crops})
(output / 'gallery-preparation.json').write_text(json.dumps(review, indent=2) + '\n')
print(json.dumps({'galleries': len(review['galleries']),
                  'captures': sum(len(g['captures']) for g in review['galleries']),
                  'actualInspection': 'pending'}))
