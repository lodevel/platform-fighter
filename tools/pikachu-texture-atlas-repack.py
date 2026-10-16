#!/usr/bin/env python3
"""Repack reviewed linear strips without changing a single RGBA cell pixel."""
import hashlib
import json
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'assets/characters/pikachu'
EVIDENCE = ROOT / 'docs/review/2026-10-06/pikachu-character/art/texture-atlas-repack'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    result = {'state': 'layout_visual_and_actual_webgl_review_pending',
              'reason': 'Actual production WebGL MAX_TEXTURE_SIZE8192; long linear strips rendered black quads.',
              'maximumAtlasDimension': 4096, 'records': []}
    for path in [BASE / 'registered-poses.json', *sorted((BASE / 'pose-batches').glob('*.json'))]:
        data = json.loads(path.read_text())
        changed = False
        for key, row in data['animations'].items():
            source = BASE / row['strip']
            image = Image.open(source).convert('RGBA')
            if max(image.size) <= 4096:
                continue
            width, height = data['coordinateContract']['frameWidth'], data['coordinateContract']['frameHeight']
            count = row['frameCount']
            if image.size != (count * width, height) or sha(source) != row['sha256']:
                raise ValueError('Changed/nonlinear reviewed source: ' + key)
            archive = EVIDENCE / (key + '-reviewed-linear.png')
            if archive.exists():
                raise ValueError('Immutable prior layout already exists: ' + key)
            archive.write_bytes(source.read_bytes())
            columns = min(count, 4096 // width)
            rows = (count + columns - 1) // columns
            if rows * height > 4096:
                raise ValueError('Atlas partition required: ' + key)
            atlas = Image.new('RGBA', (columns * width, rows * height))
            cells = []
            for i in range(count):
                cell = image.crop((i * width, 0, (i + 1) * width, height))
                x, y = (i % columns) * width, (i // columns) * height
                atlas.paste(cell, (x, y))
                cells.append({'index': i, 'cell': [i % columns, i // columns],
                              'rgbaSha256': hashlib.sha256(cell.tobytes()).hexdigest()})
            atlas.save(source)
            reopened = Image.open(source).convert('RGBA')
            for cell in cells:
                x, y = cell['cell'][0] * width, cell['cell'][1] * height
                actual = reopened.crop((x, y, x + width, y + height))
                if hashlib.sha256(actual.tobytes()).hexdigest() != cell['rgbaSha256']:
                    raise ValueError('Cell pixels changed: ' + key)
            gallery = Image.new('RGB', atlas.size, '#17253a')
            for cell in cells:
                x, y = cell['cell'][0] * width, cell['cell'][1] * height
                color = '#f7f5ef' if sum(cell['cell']) % 2 == 0 else '#17253a'
                bg = Image.new('RGBA', (width, height), color)
                bg.alpha_composite(atlas.crop((x, y, x + width, y + height)))
                gallery.paste(bg.convert('RGB'), (x, y))
                ImageDraw.Draw(gallery).text((x + 8, y + 8), f'{key} frame{cell["index"]}', fill='#828282')
            gallery.thumbnail((2048, 2048))
            review = EVIDENCE / (key + '-layout-review.png')
            gallery.save(review)
            proof = {'sheet': key, 'previousLayout': str(archive.relative_to(ROOT)),
                     'previousSha256': sha(archive), 'sha256': sha(source),
                     'dimensions': list(atlas.size), 'columns': columns, 'rows': rows,
                     'cellPixelsUnchanged': True, 'cells': cells,
                     'layoutReview': str(review.relative_to(ROOT)), 'layoutReviewSha256': sha(review)}
            row.update(sha256=proof['sha256'], columns=columns, rows=rows, atlasRepack=proof)
            result['records'].append(proof)
            changed = True
        if changed:
            path.write_text(json.dumps(data, indent=2) + '\n')
    if not result['records']:
        raise ValueError('No new linear atlases need repacking')
    (EVIDENCE / 'preparation.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({'repacked': [r['sheet'] for r in result['records']], 'review': 'pending actual layout/WebGL'}))


if __name__ == '__main__':
    main()
