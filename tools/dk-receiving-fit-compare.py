"""Compare authored capsule fits from retained pose packets and target alpha.

This consumes cached point clouds only; it never re-evaluates the native model,
changes pixels, publishes frames.json, or labels a fit accepted. More than one
capsule may share a source anatomical region/protection identity.
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np


def fit_piece(points, axis, margin, inset_fraction):
    axis = np.asarray(axis, dtype=float)
    axis /= np.linalg.norm(axis)
    cross = np.array([-axis[1], axis[0]])
    along, across = points @ axis, points @ cross
    transverse = (across.min() + across.max()) / 2
    radial = float(np.max(np.abs(across - transverse)))
    inset = min(radial, float(np.ptp(along)) / 2) * inset_fraction
    a = axis * (along.min() + inset) + cross * transverse
    b = axis * (along.max() - inset) + cross * transverse
    segment = b - a
    length2 = float(segment @ segment)
    fractions = np.zeros(len(points)) if length2 == 0 else np.clip((points-a) @ segment / length2, 0, 1)
    radius = float(np.max(np.linalg.norm(points - (a + fractions[:, None] * segment), axis=1))) + margin
    length = float(np.linalg.norm(segment))
    return {'start': {'x': float(a[0]), 'y': float(a[1])},
        'end': {'x': float(b[0]), 'y': float(b[1])}, 'radius': radius}, 2*radius*length + np.pi*radius**2


def fit_region(points, strategy, pieces, margin):
    centre = points.mean(axis=0)
    _, _, axes = np.linalg.svd(points-centre, full_matrices=False)
    axis = {'horizontal': np.array([1., 0.]), 'vertical': np.array([0., 1.]), 'pca': axes[0]}[strategy]
    order = np.argsort(points @ axis)
    groups = np.array_split(order, pieces)
    result = []
    for group in groups:
        if not len(group):
            continue
        selected = points[group]
        candidates = [fit_piece(selected, axis, margin, inset) for inset in (0, .25, .5, .75, 1)]
        # Prefer a floor-safe enclosing candidate for anatomy within three world
        # pixels of the physical floor. This does not clip geometry or discard
        # points: zero-inset horizontal segments remain available as candidates.
        source_bottom = float(selected[:, 1].max())
        def score(row):
            capsule, area = row
            bottom = max(capsule['start']['y'], capsule['end']['y']) + capsule['radius']
            excess = max(0., bottom-source_bottom-margin-1e-8) if source_bottom > 39 else 0.
            return excess, area
        capsule, _ = min(candidates, key=score)
        result.append(capsule)
    return result


def as_hurtbox(capsule, region, identifier):
    a, b, r = capsule['start'], capsule['end'], capsule['radius']
    return {'id': identifier, 'region': region,
        'offsetX': (a['x']+b['x'])/2, 'offsetY': (a['y']+b['y'])/2,
        'width': abs(a['x']-b['x'])+2*r, 'height': abs(a['y']-b['y'])+2*r,
        'capsule': capsule}


def capsule_contains(points, capsule):
    a = np.array([capsule['start']['x'], capsule['start']['y']])
    b = np.array([capsule['end']['x'], capsule['end']['y']])
    segment = b-a
    length2 = float(segment @ segment)
    fraction = np.zeros(len(points)) if length2 == 0 else np.clip((points-a) @ segment / length2, 0, 1)
    return np.sum((points-(a+fraction[:, None]*segment))**2, axis=1) <= capsule['radius']**2 + 1e-9


def compare(packet, target_path=None):
    clouds = {name: np.asarray(points, dtype=float) for name, points in packet['projectedPointsByRegion'].items()}
    target = None
    if target_path:
        from PIL import Image
        image = Image.open(target_path).convert('RGBA')
        if image.size != (1536, 1024):
            raise ValueError('Target must be the registered 1536x1024 pilot cell, with root [512,832]')
        # Keep full resolution and unchanged pixels; this is diagnostic alpha sampling.
        target = np.asarray(image)[:, :, 3] >= 32
        yy, xx = np.indices(target.shape)
        pixel_points = np.column_stack(((xx.ravel()-512)*5/26, 42+(yy.ravel()-832)*5/26))
    proposals = []
    for strategy in ('horizontal', 'vertical', 'pca'):
        for pieces in (1, 2, 3, 4):
            boxes, per_region = [], []
            for region, points in clouds.items():
                capsules = fit_region(points, strategy, pieces, packet['authoredMarginWorld'])
                coverage = np.zeros(len(points), dtype=bool)
                for i, capsule in enumerate(capsules):
                    coverage |= capsule_contains(points, capsule)
                    boxes.append(as_hurtbox(capsule, region, f'donkeykong.fit.{strategy}.{pieces}.{region}.{i}'))
                bottom = max(max(c['start']['y'], c['end']['y'])+c['radius'] for c in capsules)
                per_region.append({'region': region, 'pointCount': len(points),
                    'sourcePointCoverage': float(coverage.mean()), 'capsuleCount': len(capsules),
                    'receivingBottomWorldY': bottom, 'receivingBelowPhysicalFloorWorld': max(0., bottom-42),
                    'sourcePointBottomWorldY': float(points[:, 1].max())})
            row = {'strategy': strategy, 'piecesPerRegion': pieces, 'capsuleCount': len(boxes),
                'regions': per_region, 'hurtboxes': boxes, 'reviewedForShipping': False}
            if target is not None:
                receiving = np.zeros(target.size, dtype=bool)
                for box in boxes:
                    c = box['capsule']
                    x0 = min(c['start']['x'], c['end']['x'])-c['radius']
                    x1 = max(c['start']['x'], c['end']['x'])+c['radius']
                    y0 = min(c['start']['y'], c['end']['y'])-c['radius']
                    y1 = max(c['start']['y'], c['end']['y'])+c['radius']
                    in_bounds = (pixel_points[:, 0]>=x0)&(pixel_points[:, 0]<=x1)&(pixel_points[:, 1]>=y0)&(pixel_points[:, 1]<=y1)
                    receiving[in_bounds] |= capsule_contains(pixel_points[in_bounds], c)
                alpha = target.ravel()
                row['targetAlphaDiagnostics'] = {'alphaThreshold': 32,
                    'receivingPixelCount': int(receiving.sum()), 'targetAlphaPixelCount': int(alpha.sum()),
                    'receivingOutsideAlphaFraction': float((receiving&~alpha).sum()/max(1, receiving.sum())),
                    'targetAlphaCoveredFraction': float((receiving&alpha).sum()/max(1, alpha.sum())),
                    'interpretation': 'whole-visible-alpha diagnostic; does not prove anatomical region ownership, native receiving parity, or intended cosmetic exclusion'}
            proposals.append(row)
    return {'sourceMotion': packet['sourceMotion'], 'nativeSample': packet['nativeSample'],
        'floorWarp': packet['floorWarp'], 'bodyCentreFromRootY': -42,
        'authoredMarginWorld': packet['authoredMarginWorld'], 'targetImage': str(target_path) if target_path else None,
        'targetImageSha256': hashlib.sha256(target_path.read_bytes()).hexdigest() if target_path else None,
        'selectionPolicy': 'within three world pixels of floor, minimize bottom extension beyond selected points plus margin before area; otherwise minimize capsule area; all selected points remain enclosed',
        'status': 'finite authored geometry comparison; all candidates unaccepted',
        'proposals': proposals, 'reviewedForShipping': False}


def annotate(target_path, proposal, output):
    from PIL import Image, ImageDraw
    source = Image.open(target_path).convert('RGBA')
    base = Image.new('RGBA', source.size, (35, 40, 48, 255))
    base.alpha_composite(source)
    overlay = Image.new('RGBA', source.size)
    draw = ImageDraw.Draw(overlay)
    palette = [(80, 220, 255), (255, 215, 80), (240, 100, 220), (100, 250, 140)]
    regions = list(dict.fromkeys(box['region'] for box in proposal['hurtboxes']))
    root=proposal.get('root',[512,832]);scale=1/proposal.get('scaleToWorld',5/26)
    def image_point(p):
        return root[0]+p['x']*scale,root[1]+(p['y']-42)*scale
    for box in proposal['hurtboxes']:
        color = palette[regions.index(box['region']) % len(palette)]
        if 'capsule' not in box:
            a=image_point({'x':box['offsetX']-box['width']/2,'y':box['offsetY']-box['height']/2})
            b=image_point({'x':box['offsetX']+box['width']/2,'y':box['offsetY']+box['height']/2})
            draw.rectangle((*a,*b),fill=(*color,35),outline=(*color,200),width=2)
            draw.text(image_point({'x':box['offsetX'],'y':box['offsetY']}),box['region'],fill=(*color,255),stroke_fill=(0,0,0,255),stroke_width=1)
            continue
        c = box['capsule'];a,b=image_point(c['start']),image_point(c['end']);r=c['radius']*scale
        draw.line([a,b], fill=(*color, 35), width=max(1,round(2*r)))
        for x,y in (a,b):draw.ellipse((x-r,y-r,x+r,y+r), fill=(*color, 35), outline=(*color, 190), width=2)
        draw.line([a,b], fill=(*color, 230), width=2)
        mid=((a[0]+b[0])/2,(a[1]+b[1])/2)
        draw.text(mid, box['region'], fill=(*color, 255), stroke_fill=(0,0,0,255), stroke_width=1)
    draw.line([(0,root[1]),(source.width-1,root[1])],fill=(255,255,255,220),width=2)
    draw.line([(root[0],root[1]-18),(root[0],root[1]+18)],fill=(255,255,255,220),width=2)
    draw.text((20,20), f"UNACCEPTED receiving candidate: {proposal['strategy']} / {proposal['piecesPerRegion']} pieces per region", fill=(255,255,255,255))
    draw.text((20,38), f'Physical floor y{root[1]}; authored receiving margin1world px; sprite floor acceptance is separate', fill=(255,255,255,255))
    base.alpha_composite(overlay)
    output.parent.mkdir(parents=True,exist_ok=True)
    base.convert('RGB').save(output)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--packet', type=Path, required=True)
    parser.add_argument('--target', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--overlay', type=Path)
    parser.add_argument('--strategy', choices=['horizontal','vertical','pca'], default='horizontal')
    parser.add_argument('--pieces', type=int, choices=[1,2,3,4], default=1)
    args = parser.parse_args()
    data = compare(json.loads(args.packet.read_text()), args.target)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(data, indent=2)+'\n')
    if args.overlay:
        if not args.target:raise ValueError('An annotated contour comparison requires actual target pixels')
        proposal=next(row for row in data['proposals'] if row['strategy']==args.strategy and row['piecesPerRegion']==args.pieces)
        annotate(args.target,proposal,args.overlay)
    print(args.output)
