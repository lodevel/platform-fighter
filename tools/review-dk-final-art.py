"""Review all packed DK Final drawings against their paired source geometry.

Panels use one fixed logical canvas and thumbnail scale across every drawing.
Cyan is the source root, purple the explicitly authored receiving recipe,
red the active selected native ATTACK capsules, and yellow the authored pocket.
"""
from pathlib import Path
import hashlib
import json
import math
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
E = ROOT / 'docs/review/2026-10-15/dk-final'
A = E / 'owner-art-staging'
sha = lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()


def role_at(sheet, sample):
    # Runtime age is the actual zero-based native index. Finisher contacts
    # are queried after the captive presentation/control lease is released.
    if sheet.endswith('_start'):
        return 'dk-detection' if 28 <= sample <= 33 else None
    if sheet.endswith('_end'):
        return 'dk-finisher' if 6 <= sample < 8 else None
    frame = sample + 1
    if 6 <= frame <= 75 and (frame - 6) % 4 <= 1:
        return 'dk-early'
    if 79 <= frame <= 127 and (frame - 79) % 4 == 0:
        return 'dk-late'
    return None


def capsule(draw, cap, root, scale, color):
    radius = cap['radius'] / scale
    points = [(root[0] + cap[k]['x'] / scale, root[1] + cap[k]['y'] / scale) for k in ['start', 'end']]
    # An outline around the actual swept circular region, rather than an AABB.
    a, b = points
    if a == b:
        draw.ellipse((a[0]-radius, a[1]-radius, a[0]+radius, a[1]+radius), outline=color, width=3)
        return
    angle = math.atan2(b[1]-a[1], b[0]-a[0])
    boundary = []
    for centre, start in [(a, angle+math.pi/2), (b, angle-math.pi/2)]:
        for i in range(25):
            t = start + i*math.pi/24
            boundary.append((centre[0]+radius*math.cos(t), centre[1]+radius*math.sin(t)))
    draw.line([*boundary, boundary[0]], fill=color, width=3, joint='curve')


def main():
    art_path = A / 'art-clips.json'
    art = json.loads(art_path.read_text())
    geometry = json.loads((E / 'owner-geometry.json').read_text())
    assert geometry['planSha256'] == sha(E / 'owner-art-plan.json')
    rows = []
    padding, cell_width, cell_height, columns = 128, 320, 285, 6
    for sheet, clip in art.items():
        atlas = Image.open(A / clip['strip']).convert('RGBA')
        assert sha(A / clip['strip']) == clip['sha256']
        shape = geometry['clips'][sheet]
        assert clip['nativeSampleIndices'] == shape['nativeSampleIndices']
        width, height = clip['frameWidth'] + padding * 2, clip['frameHeight'] + padding * 2
        factor = min((cell_width-12)/width, (cell_height-52)/height)
        target_size = (round(width*factor), round(height*factor))
        panels = {kind: Image.new('RGB', (columns*cell_width, math.ceil(clip['frameCount']/columns)*cell_height), '#23334a')
                  for kind in ['body', 'capsules']}
        for index, (x, y, cw, ch, left, top) in enumerate(clip['trims']):
            body = Image.new('RGBA', (width, height))
            body.alpha_composite(atlas.crop((x, y, x+cw, y+ch)), (left+padding, top+padding))
            root = [v+padding for v in clip['root']]
            overlay = Image.new('RGBA', body.size)
            draw = ImageDraw.Draw(overlay)
            for box in shape['hurtboxPoses'][index]['hurtboxes']:
                capsule(draw, box['capsule'], root, clip['scaleToWorld'], (171, 141, 255, 210))
            sample = clip['nativeSampleIndices'][index]
            role = role_at(sheet, sample)
            if role:
                for hit in shape['attackCollisionPosesByRole'][role][index]['collisionHits']:
                    capsule(draw, hit['capsule'], root, clip['scaleToWorld'], (255, 85, 75, 230))
            anchor = shape['sourceAttachmentPoses'][index]['attachments'][0]['point']
            px, py = root[0]+anchor['x']/clip['scaleToWorld'], root[1]+anchor['y']/clip['scaleToWorld']
            draw.ellipse((px-8, py-8, px+8, py+8), fill='yellow')
            draw.line((root[0]-16, root[1], root[0]+16, root[1]), fill='cyan', width=4)
            draw.line((root[0], root[1]-16, root[0], root[1]+16), fill='cyan', width=4)
            combined = body.copy()
            combined.alpha_composite(overlay)
            ox, oy = index % columns * cell_width, index // columns * cell_height
            for kind, image in [('body', body), ('capsules', combined)]:
                reduced = image.resize(target_size, Image.Resampling.LANCZOS)
                panels[kind].paste(reduced, (ox+(cell_width-reduced.width)//2, oy+42), reduced)
                text = ImageDraw.Draw(panels[kind])
                text.text((ox+7, oy+5), f'{sheet}: native {sample+1} /raw {sample} /cell {index}', fill='white')
                text.text((ox+7, oy+21), role or 'no active source attack', fill='#ffb0a0' if role else '#bac5d5')
        paths = {}
        for kind, panel in panels.items():
            path = A / (sheet + '-all-drawings-' + kind + '.jpg')
            panel.save(path, quality=92)
            paths[kind] = {'path': str(path.relative_to(ROOT)), 'sha256': sha(path)}
        rows.append({'sheet': sheet, 'drawings': clip['frameCount'], 'fixedThumbnailScale': factor, 'panels': paths})
    receipt = {'schema': 'donkeykong-final-all-drawing-panels/1', 'artManifestSha256': sha(art_path),
        'geometrySha256': sha(E / 'owner-geometry.json'), 'reviewerSha256': sha(__file__), 'rows': rows,
        'scope': 'Actual packed art at a common logical registration; explicit authored receiving and pocket; active selected native outgoing packets. Human visual acceptance remains required.'}
    (A / 'all-drawings-panels.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps(rows))


if __name__ == '__main__':
    main()
