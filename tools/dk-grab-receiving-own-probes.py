"""Own target-label probes and both-face world diagnostics, not collision proof.

Skin/core selection uses actual target labels/EDT before querying fit geometry.
Gap selection uses transparent target alpha and independent anatomical centroids.
Failed points are retained; no selecting only covered skin to conceal a miss.
"""
from pathlib import Path
import argparse
import hashlib
import json
import math

ROOT = Path(__file__).resolve().parents[1]


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def distance(point, box):
    c = box['capsule']; a = c['start']; b = c['end']
    dx, dy = b['x'] - a['x'], b['y'] - a['y']
    t = max(0, min(1, ((point['x'] - a['x']) * dx + (point['y'] - a['y']) * dy) / max(1e-12, dx * dx + dy * dy)))
    return math.hypot(point['x'] - a['x'] - t * dx, point['y'] - a['y'] - t * dy) - c['radius']


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--ownership', type=Path, required=True)
    parser.add_argument('--expected-ownership-sha256', required=True)
    parser.add_argument('--candidate', type=Path, required=True)
    parser.add_argument('--expected-candidate-sha256', required=True)
    parser.add_argument('--output-stem', type=Path, required=True)
    parser.add_argument('--detail-handl', action='store_true')
    parser.add_argument('--cpu-slot-released', action='store_true')
    args = parser.parse_args()
    if not args.cpu_slot_released:
        raise ValueError('Coordinator must release own probe/diagnostic CPU slot')
    packet = json.loads(args.ownership.read_text()); candidate = json.loads(args.candidate.read_text())
    if sha(args.ownership) != args.expected_ownership_sha256 or sha(args.candidate) != args.expected_candidate_sha256:
        raise ValueError('Own packet/fit bytes differ')
    if candidate['targetOwnershipProposalSha256'] != args.expected_ownership_sha256:
        raise ValueError('Candidate not fitted to this own target ownership')
    outputs = [Path(str(args.output_stem) + suffix) for suffix in ['-probes.json', '-quarter-probes.png', '-bothface-world.png']]
    if any(p.exists() for p in outputs):
        raise ValueError('Preserve all previous probe/diagnostic outputs')
    from PIL import Image, ImageDraw
    import numpy as np
    from scipy.ndimage import distance_transform_edt
    image = Image.open(packet['targetImage']).convert('RGBA'); labels = np.asarray(Image.open(packet['labelImage']))
    if sha(Path(packet['targetImage'])) != packet['targetImageSha256'] or sha(Path(packet['labelImage'])) != packet['labelImageSha256']:
        raise ValueError('Own actual target/labels changed')
    alpha = np.asarray(image)[:, :, 3] >= 32
    root = packet['root']; scale = packet['scaleToWorld']; boxes = candidate['hurtboxPoses'][0]['hurtboxes']
    probes = []; centres = {}; edt_by_region = {}
    def point(x, y):return {'x': (x + .5 - root[0]) * scale, 'y': 42 + (y + .5 - root[1]) * scale}
    def add(x, y, name, region, expected):
        p = point(x, y); signed = min(distance(p, b) for b in boxes)
        probes.append({'name': name, 'region': region, 'quarterPixel': [x, y], 'actorRelativeWorld': p,
            'expected': expected, 'selection': 'actual own target-label/alpha feature chosen before fit query',
            'targetAlphaAtPoint': int(np.asarray(image)[y, x, 3]),
            'receivingSignedDistanceWorld': signed, 'probeRadiusWorld': .05,
            'matchesExpectedFit': signed <= -.15 if expected == 'skin' else signed > .25,
            'outsideMovementBody': abs(p['x']) > 30.15 or abs(p['y']) > 42.15,
            'worldBothFaces': [{'facing': f, 'actorRelativeWorld': {'x': p['x'] * f, 'y': p['y']}} for f in [1, -1]]})
    for region, label in packet['regionLabelIds'].items():
        mask = (labels == label) & alpha; yy, xx = np.where(mask)
        if not len(xx): continue
        centres[region] = [float(xx.mean()), float(yy.mean())]
        edt = distance_transform_edt(mask); edt_by_region[region] = edt
        y, x = np.unravel_index(edt.argmax(), edt.shape)
        add(int(x), int(y), 'regional-core-' + region, region, 'skin')
    if args.detail_handl:
        mask = (labels == packet['regionLabelIds']['handl']) & alpha
        yy, xx = np.where(mask); cutoff = np.quantile(yy, .42)
        # Own exposed upper-hand partitions are candidate fingertip/core points,
        # never a claim that every partition is a distinct anatomical digit.
        upper = mask & (np.indices(mask.shape)[0] <= cutoff)
        y2, x2 = np.where(upper); edges = np.linspace(x2.min(), x2.max() + 1, 6)
        for i in range(5):
            part = upper & (np.indices(mask.shape)[1] >= edges[i]) & (np.indices(mask.shape)[1] < edges[i + 1])
            scores = np.where(part, edt_by_region['handl'], 0)
            if scores.max() < 1: continue
            y, x = np.unravel_index(scores.argmax(), scores.shape)
            add(int(x), int(y), f'handl-own-upper-partition-{i}', 'handl', 'skin')
    yy, xx = np.where(alpha); outside = distance_transform_edt(~alpha) * scale
    ygrid, xgrid = np.indices(alpha.shape)
    gaps = (~alpha) & (outside >= 1.6) & (outside <= 6) & (xgrid >= xx.min()) & (xgrid <= xx.max()) & (ygrid >= yy.min()) & (ygrid <= yy.max())
    gy, gx = np.where(gaps)
    for first, second in [('head', 'handl'), ('head', 'handr'), ('footl', 'footr'), ('hip', 'handr')]:
        if not len(gx) or first not in centres or second not in centres:continue
        centre = (np.asarray(centres[first]) + np.asarray(centres[second])) / 2
        index = int(np.argmin((gx - centre[0]) ** 2 + (gy - centre[1]) ** 2))
        add(int(gx[index]), int(gy[index]), f'alpha-gap-near-{first}-{second}', None, 'gap')
    quarter = Image.new('RGBA', image.size, (25, 30, 39, 255)); quarter.alpha_composite(image)
    draw = ImageDraw.Draw(quarter)
    for i, probe in enumerate(probes):
        x, y = probe['quarterPixel']; color = 'lime' if probe['matchesExpectedFit'] else 'red'
        draw.ellipse((x-2, y-2, x+2, y+2), outline=color, width=1); draw.text((x+3, y-4), str(i), fill=color)
    quarter.save(outputs[1])
    # Scientific world registration adapter: exact declared root/scale, actor
    # centre fixed and X mirrored once; only visualization resamples pixels.
    world = Image.new('RGBA', (640, 300), (25, 30, 39, 255)); wd = ImageDraw.Draw(world)
    for col, facing in enumerate([1, -1]):
        cx, cy = col * 320 + 160, 185
        transformed = image.transform(world.size, Image.Transform.AFFINE,
            (facing/scale, 0, root[0]-facing*cx/scale, 0, 1/scale, root[1]-(cy+42)/scale), Image.Resampling.BICUBIC)
        world.alpha_composite(transformed); wd = ImageDraw.Draw(world)
        wd.line((col*320, cy+42, col*320+320, cy+42), fill=(95,113,140), width=1)
        wd.rectangle((cx-30, cy-42, cx+30, cy+42), outline=(90,90,90), width=1)
        wd.text((col*320+5, 5), f'face {facing:+d}; source age {packet["gameplayAge"]}', fill='white')
        for box in boxes:
            c=box['capsule'];a=c['start'];b=c['end'];r=c['radius']
            aw=(cx+a['x']*facing,cy+a['y']);bw=(cx+b['x']*facing,cy+b['y'])
            theta=math.atan2(bw[1]-aw[1],bw[0]-aw[0])
            outline=[]
            for centre,start in [(bw,theta-math.pi/2),(aw,theta+math.pi/2)]:
                for step in range(13):
                    angle=start+math.pi*step/12
                    outline.append((centre[0]+r*math.cos(angle),centre[1]+r*math.sin(angle)))
            wd.line(outline+[outline[0]],fill=(80,220,245),width=1)
        for i,probe in enumerate(probes):
            p=probe['actorRelativeWorld'];x=cx+p['x']*facing;y=cy+p['y'];color='lime' if probe['matchesExpectedFit'] else 'red'
            wd.ellipse((x-2,y-2,x+2,y+2),outline=color,width=1);wd.text((x+3,y-5),str(i),fill=color)
    world.save(outputs[2])
    result={'state':'OWN_TARGET_PROBES_AND_FIT_DIAGNOSTICS_ACTUAL_REVIEW_PENDING','nativeSample':packet['nativeSample'],
        'artFrameIndex':candidate['artFrameIndex'],'sourceGameplayAge':packet['gameplayAge'],
        'ownership':{'path':str(args.ownership),'sha256':args.expected_ownership_sha256},
        'candidate':{'path':str(args.candidate),'sha256':args.expected_candidate_sha256},'probes':probes,
        'failures':[p['name'] for p in probes if not p['matchesExpectedFit']],
        'views':[{'path':str(p),'sha256':sha(p)} for p in outputs[1:]],
        'limits':['Target-label/alpha expectations are independent of fitted capsule query; failed points are preserved.',
                  'Whole-sprite resampling/overlay are review diagnostics, not native rendering or gameplay contact proof.',
                  'Receiving preserves own1world authored contour margin; exact visible alpha parity not claimed.'],
        'actualMatchProof':False,'canonicalChanged':False}
    outputs[0].write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'path':str(outputs[0]),'sha256':sha(outputs[0]),'probes':len(probes),'failed':result['failures']}))


if __name__=='__main__':main()
