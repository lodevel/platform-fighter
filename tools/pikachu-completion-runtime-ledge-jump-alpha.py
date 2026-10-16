#!/usr/bin/env python3
"""Audit immutable ledge-jump alpha against the actual finite solid platform."""
import hashlib
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image

directory = Path(sys.argv[1])
report = json.loads((directory / 'ledge-jump-match-observations.json').read_text())
build = report['build']
metadata = json.loads(Path(build['sourceHashes'].replace('-source-hashes.json', '') + '-pikachu-frames.json').read_text())
cache = {}
rows = []
for row in report['rows']:
    samples = []
    observations = [('native', o) for o in row['trace'] if o['ledgeJump']]
    observations += [('hitlag', o) for freeze in row['freezes'] for o in freeze['frozen']]
    for phase, observation in observations:
        sheet = observation['texture'].split('.')[-1]
        clip = metadata['animations'][sheet]
        frame = observation['textureFrame']
        key = (sheet, frame)
        if key not in cache:
            strip = Path(build['outDir']) / 'characters/pikachu' / clip['strip']
            digest = hashlib.sha256(strip.read_bytes()).hexdigest()
            assert digest == clip['sha256']
            x = frame % clip['columns'] * clip['frameWidth']
            y = frame // clip['columns'] * clip['frameHeight']
            alpha = np.asarray(Image.open(strip).convert('RGBA').crop((x, y, x + clip['frameWidth'], y + clip['frameHeight'])))[:, :, 3]
            cache[key] = (alpha, digest)
        alpha, digest = cache[key]
        ys, xs = np.where(alpha >= 32)
        dx = (xs + .5 - observation['origin'][0] * clip['frameWidth']) * observation['scale'][0]
        dy = (ys + .5 - observation['origin'][1] * clip['frameHeight']) * observation['scale'][1]
        if observation['flipX']:
            dx *= -1
        if observation['flipY']:
            dy *= -1
        rotation = observation['rotation']
        world_x = observation['spritePosition']['x'] + dx * math.cos(rotation) - dy * math.sin(rotation)
        world_y = observation['spritePosition']['y'] + dx * math.sin(rotation) + dy * math.cos(rotation)
        support = observation['support']['bounds']
        eligible = (world_x >= support['min']['x']) & (world_x <= support['max']['x'])
        penetrating = eligible & (world_y > support['min']['y'] + .55) & (world_y < support['max']['y'])
        # The actual source attachment has not cleared the ledge in its early
        # rise. Keep that finite-band diagnostic separately from grounded art,
        # matching the reviewed ledge-getup/roll supported-root scope.
        applicable = (observation['geometricBottom'] <= support['min']['y'] + .050001
                      and not (observation.get('attachment') or {}).get('attached', False))
        floor_violations = eligible & (world_y > support['min']['y'] + .55) if applicable else np.zeros_like(eligible)
        samples.append({
            'phase': phase, 'owner': observation['ledgeJump'], 'sheet': sheet, 'cell': frame,
            'position': observation['position'], 'spritePosition': observation['spritePosition'],
            'platformBounds': support, 'opaquePixelsInsidePlatformBand': int(penetrating.sum()),
            'supportPlaneApplicable': applicable, 'supportedRootFloorViolations': int(floor_violations.sum()),
            'minimumVisibleTopGapAtPlatformX': support['min']['y'] - float(world_y[eligible].max()) if eligible.any() else None,
            'stripSha256': digest,
        })
    rows.append({'facing': row['facing'], 'route': row['route'], 'samples': samples,
                 'state': 'PASS' if all(s['supportedRootFloorViolations'] == 0 for s in samples) else 'FAIL'})
result = {
    'state': 'PASS' if all(r['state'] == 'PASS' for r in rows) else 'FAIL',
    'scope': 'Actual immutable alpha>=32 pixel centres under recorded sprite transforms versus the actual finite platform X range. The supported-floor gate applies once physical attachment releases and actual geometric feet clear its top; early source-ledged rise is explicitly outside that supported-root scope. Finite solid-band intersections are retained as independent diagnostics on every source age. A hanging tail outside platform X is not a floor failure. Source receiving capsules remain vulnerability geometry, not physical support. Other walls/solids need their own observations.',
    'alphaCutoff': 32, 'topTolerance': .55, 'bundleSha256': report['bundleSha256'], 'rows': rows,
}
(directory / 'floor-alpha32-observations.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({'state': result['state'], 'rows': [{'facing': r['facing'], 'route': r['route'], 'state': r['state'],
      'failedSamples': len([s for s in r['samples'] if s['supportedRootFloorViolations']])} for r in rows]}))
