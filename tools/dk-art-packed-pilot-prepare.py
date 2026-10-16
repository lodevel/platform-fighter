#!/usr/bin/env python3
"""Prepare source-only uniform packing candidates; never writes delivered assets."""
from pathlib import Path
import hashlib
import json
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
ART = ROOT / 'docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/art'

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def main():
    accepted = json.loads((ART / 'firstcontact-clean3-static-acceptance.json').read_text())
    records = []
    for sample in accepted['samples']:
        source = ART / sample['image']
        if sha(source) != sample['sha256']:
            raise ValueError('Accepted source image changed')
        original = Image.open(source).convert('RGBA')
        if original.size != (1536, 1024):
            raise ValueError('Unexpected accepted source dimensions')
        key = source.stem.removeprefix('firstcontact-clean3-').removesuffix('-cutout')
        tile_width = 360
        world_comparison = Image.new('RGB', (tile_width * 3, 260), '#252a35')
        draw = ImageDraw.Draw(world_comparison)
        for col, factor in enumerate([1, .5, .25]):
            size = tuple(round(v * factor) for v in original.size)
            candidate = original if factor == 1 else original.resize(size, Image.Resampling.LANCZOS)
            root = [512 * factor, 832 * factor]
            scale = 5 / (26 * factor)
            mask = candidate.getchannel('A').point(lambda a: 255 if a >= 32 else 0)
            bounds = mask.getbbox()
            if bounds is None:
                raise ValueError('No alpha32 body')
            last_y = bounds[3] - 1
            delta = (last_y + .5 - root[1]) * scale
            if factor != 1:
                path = ART / f'{key}-packed-scale-{factor:g}-candidate.png'
                candidate.save(path)
                records.append({'key': key, 'factor': factor, 'image': path.name,
                    'sha256': sha(path), 'sourceImage': source.name,
                    'sourceSha256': sha(source), 'dimensions': list(size), 'root': root,
                    'pixelsPerNativeUnit': 26 * factor, 'scaleToWorld': scale,
                    'bodyCentreFromRootY': -42, 'alpha32Bounds': list(bounds),
                    'alpha32LastPixelY': last_y, 'floorPixelCentreDeltaWorld': delta,
                    'floorToleranceWorld': .55, 'floorPass': abs(delta) <= .55,
                    'collisionPolicy': 'Actor-relative receiving/attack geometry unchanged. Packed contour agreement and both-facing runtime must be rechecked.',
                    'accepted': False})
            display_size = [round(v * scale) for v in candidate.size]
            display = candidate.resize(display_size, Image.Resampling.LANCZOS)
            anchor = [col * tile_width + 100, 210]
            top_left = (round(anchor[0] - root[0] * scale), round(anchor[1] - root[1] * scale))
            world_comparison.paste(display, top_left, display)
            draw.line((col * tile_width, 210, (col + 1) * tile_width - 1, 210), fill='#6cc0d0')
            draw.text((col * tile_width + 10, 5), f'scale {factor:g}; floor {delta:+.3f}', fill='white')
        world_comparison.save(ART / f'{key}-packed-scale-world-comparison.png')
    receipt = {'state': 'source_only_uniform_downscale_candidates_not_installed_or_accepted',
        'resampling': 'Pillow RGBA LANCZOS, unchanged full-cell canvas scaled uniformly',
        'scope': 'Packing study only. Current delivered review pilots remain byte-identical; actual pilot match gate still required.',
        'records': records}
    (ART / 'firstcontact-uniform-downscale-candidates.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps([{'key':r['key'],'factor':r['factor'],'floorDelta':r['floorPixelCentreDeltaWorld'],'pass':r['floorPass']} for r in records], indent=2))

if __name__ == '__main__':
    main()
