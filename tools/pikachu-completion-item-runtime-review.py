#!/usr/bin/env python3
"""Prepare camera-derived, lossless item screenshots and immutable floor checks.

This creates inspection evidence only. It never accepts art or changes assets.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
from PIL import Image, ImageDraw

parser = argparse.ArgumentParser()
parser.add_argument('observations', type=Path)
parser.add_argument('metadata', type=Path)
parser.add_argument('staged_art', type=Path)
args = parser.parse_args()
report = json.loads(args.observations.read_text())
metadata = json.loads(args.metadata.read_text())
assert report['result'] == 'PASS', 'Run exact-build behavior acceptance first'
sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
assert sha(args.metadata) == report['build']['pikachuFramesSha256'], 'Review metadata differs from qualified immutable build'
directory = args.observations.parent
review = {'state': 'actual_runtime_images_created_inspection_pending',
          'bundle': report['bundle'], 'bundleSha256': report['bundleSha256'],
          'observationsSha256': sha(args.observations), 'metadataSha256': sha(args.metadata),
          'galleries': [], 'inspectionPages': []}
floor_rows = []
cells = {}
inspection_tiles = []
for case in report['cases']:
    captures = case['captures']
    columns = min(4, len(captures))
    gallery = Image.new('RGB', (columns * 360, ((len(captures) + columns - 1) // columns) * 250), '#202633')
    crops = []
    for index, capture in enumerate(captures):
        source_path = directory / capture['screenshot']
        source = Image.open(source_path).convert('RGB')
        actor = capture['observation']['actor']
        camera, canvas = capture['camera'], capture['canvas']
        world = camera['worldView']
        x = canvas['left'] + (camera['x'] + (actor['position']['x'] - world['x']) * camera['zoom']) * canvas['width'] / canvas['internalWidth']
        y = canvas['top'] + (camera['y'] + (actor['position']['y'] - world['y']) * camera['zoom']) * canvas['height'] / canvas['internalHeight']
        box = [round(x - 180), round(y - 100), round(x + 180), round(y + 100)]
        offset = ((index % columns) * 360, (index // columns) * 250)
        gallery.paste(source.crop(box), (offset[0], offset[1] + 50))
        draw = ImageDraw.Draw(gallery)
        draw.text((offset[0] + 4, offset[1] + 4), capture['screenshot'], fill='white')
        draw.text((offset[0] + 4, offset[1] + 21), f"{actor['texture'].split('.')[-1]} cell{actor['textureFrame']} facing{case['facing']}", fill='white')
        crops.append({'screenshot': capture['screenshot'], 'sha256': sha(source_path), 'crop': box})
        tile = Image.new('RGB', (360, 250), '#202633')
        tile.paste(source.crop(box), (0, 50))
        tile_draw = ImageDraw.Draw(tile)
        tile_draw.text((4, 4), capture['screenshot'], fill='white')
        tile_draw.text((4, 21), f"{actor['texture'].split('.')[-1]} cell{actor['textureFrame']} facing{case['facing']}", fill='white')
        inspection_tiles.append((tile, {'case': case['id'], **crops[-1]}))
    name = case['id'] + '-actual-runtime-review.png'
    gallery.save(directory / name)
    review['galleries'].append({'case': case['id'], 'file': name, 'sha256': sha(directory / name), 'captures': crops})
    observations = [(key, index, observation)
                    for key in ['trace', 'jumpTrace', 'takeoffTrace', 'landingTrace', 'hitlag']
                    for index, observation in enumerate(case.get(key, []))]
    observations += [(key, None, case[key])
                     for key in ['entry', 'exit', 'jump', 'takeoff', 'landing', 'interrupt', 'resume']
                     if key in case]
    observations += [('capture', index, capture['observation'])
                     for index, capture in enumerate(captures)]
    for route, route_index, observation in observations:
        actor = observation['actor']
        sheet = actor['texture'].removeprefix('char.pikachu.')
        if not actor['grounded'] or not sheet.startswith('item_'):
            continue
        clip = metadata['animations'][sheet]
        # Qualify this actual transform, not an assumed physical-body offset.
        assert actor['rotation'] == 0, 'Item floor oracle requires unrotated actual sprite'
        assert actor['flip']['y'] is False, 'Item floor oracle requires unflipped actual vertical axis'
        assert actor['mirror'] == math.copysign(1, actor['scale'][0]) * (-1 if actor['flip']['x'] else 1)
        expected_origin = [clip['root'][0] / clip['frameWidth'], clip['root'][1] / clip['frameHeight']]
        for actual, expected in zip(actor['origin'], expected_origin):
            assert math.isclose(actual, expected, rel_tol=0, abs_tol=1e-12), 'Observed origin differs from accepted root'
        for actual in actor['scale']:
            assert math.isclose(actual, clip['scaleToWorld'], rel_tol=0, abs_tol=1e-12), 'Observed scale differs from accepted scale'
        assert math.isclose(actor['spritePosition']['x'], actor['position']['x'], rel_tol=0, abs_tol=1e-9)
        assert math.isclose(actor['spritePosition']['y'], actor['position']['y'] + 25, rel_tol=0, abs_tol=1e-9)
        cell_key = (sheet, actor['textureFrame'])
        if cell_key not in cells:
            path = args.staged_art / clip['strip']
            assert sha(path) == clip['sha256'], 'Immutable item strip changed'
            image = Image.open(path).convert('RGBA')
            width, height = clip['frameWidth'], clip['frameHeight']
            columns_count = clip.get('columns', image.width // width)
            index = actor['textureFrame']
            x, y = index % columns_count * width, index // columns_count * height
            bounds = image.crop((x, y, x + width, y + height)).getchannel('A').point(lambda v: 255 if v >= 32 else 0).getbbox()
            assert bounds
            cells[cell_key] = bounds
        bounds = cells[cell_key]
        # PIL's bbox bottom is exclusive. Measure the centre of the final
        # alpha32 pixel, half a packed pixel below its integer row index.
        # Using bottom-1 would undercount visible ink by half a packed pixel.
        bottom = actor['spritePosition']['y'] + (bounds[3] - .5 - clip['frameHeight'] * actor['origin'][1]) * actor['scale'][1]
        floor_rows.append({'case': case['id'], 'sheet': sheet, 'artFrameIndex': actor['textureFrame'],
                           'observationRoute': route, 'observationIndex': route_index,
                           'actualTransform': {key: actor[key] for key in ['spritePosition', 'origin', 'scale', 'rotation', 'flip', 'mirror']},
                           'nativeAge': (actor['item'] or {}).get('nativeAge'), 'alpha32Bounds': list(bounds),
                           'stripSha256': clip['sha256'], 'clearanceWorldPx': observation['floorY'] - bottom})
violations = [row for row in floor_rows if row['clearanceWorldPx'] < -.55 - 1e-8]
for start in range(0, len(inspection_tiles), 24):
    group = inspection_tiles[start:start + 24]
    page = Image.new('RGB', (1440, ((len(group) + 3) // 4) * 250), '#202633')
    for index, (tile, _) in enumerate(group):
        page.paste(tile, ((index % 4) * 360, (index // 4) * 250))
    name = f'actual-runtime-inspection-page-{start // 24:02}.png'
    page.save(directory / name)
    review['inspectionPages'].append({'file': name, 'sha256': sha(directory / name),
                                    'captures': [record for _, record in group],
                                    'scope': 'Lossless camera-derived native screenshot crops; all captures retained in order.'})
floor = {'state': 'FAIL' if violations else 'PASS', 'bundleSha256': report['bundleSha256'],
         'observationsSha256': sha(args.observations), 'metadataSha256': sha(args.metadata),
         'scope': 'Immutable item alpha32 pixel centres transformed by each actual observed sprite position/origin/scale. Actual rotation and flip axes qualified explicitly; accepted metadata agreement and physical root offset asserted independently. Screenshots need independent visual inspection.',
         'pixelConvention': 'PIL alpha32 bbox bottom is exclusive; last visible pixel centre is bottom-.5.',
         'tolerance': {'inkEdgeWorldPx': .5, 'matterSolverContactSlopWorldPx': .05, 'combinedWorldPx': .55},
         'toleranceWorldPx': .55, 'rows': floor_rows, 'violations': violations}
(directory / 'floor-alpha-observations.json').write_text(json.dumps(floor, indent=2) + '\n')
(directory / 'visual-review-preparation.json').write_text(json.dumps(review, indent=2) + '\n')
print(json.dumps({'galleries': len(review['galleries']), 'captures': sum(len(g['captures']) for g in review['galleries']),
                  'groundedItemSamples': len(floor_rows), 'floorResult': floor['state'], 'actualVisualReview': 'pending'}))
assert floor_rows and not violations
