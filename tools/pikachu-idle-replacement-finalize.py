#!/usr/bin/env python3
"""Install an actually inspected replacement while retaining prior static art."""
import json
from pathlib import Path
from pikachu_native_pose import ROOT, sha

BASE = ROOT / 'assets/characters/pikachu'
STAGED = ROOT / 'docs/review/2026-10-06/pikachu-character/art/tiled-body/staged-replacements'
metadata = STAGED / 'full-idle-tiled.json'
data = json.loads(metadata.read_text())
if data['state'] != 'packed_cells_visually_reviewed_runtime_pending' or not data.get('packedVisualReview'):
    raise ValueError('Actual staged packed-cell visual review required')
for gallery, digest in data['galleries'].items():
    if sha(ROOT / gallery) != digest:
        raise ValueError('Changed actual inspected gallery')
replacement = data['stagedReplacement']
candidate, current = ROOT / replacement['candidateStrip'], ROOT / replacement['existingStrip']
if sha(candidate) != data['animations']['idle']['sha256'] or sha(current) != replacement['existingStripSha256']:
    raise ValueError('Changed staged or prior body')
prior_meta = BASE / 'registered-poses.json'
prior = json.loads(prior_meta.read_text())
if prior['animations']['idle']['sha256'] != sha(current):
    raise ValueError('Prior static qualification mismatch')
archive = STAGED / 'prior-static-idle.png'
if archive.exists() or (BASE / 'pose-batches/full-idle-tiled.json').exists():
    raise ValueError('Prior migration immutable')
archive.write_bytes(current.read_bytes())
(STAGED / 'prior-registered-poses.json').write_bytes(prior_meta.read_bytes())
del prior['animations']['idle']
prior['scope'] = 'Retained reviewed up-air source packing; prior static idle archived and superseded by actually reviewed native five-cell idle.'
current.write_bytes(candidate.read_bytes())
prior_meta.write_text(json.dumps(prior, indent=2) + '\n')
data['stagedReplacement']['priorStaticArchive'] = str(archive.relative_to(ROOT))
(BASE / 'pose-batches/full-idle-tiled.json').write_text(json.dumps(data, indent=2) + '\n')
print('Installed reviewed five-cell native idle; fresh runtime loader/clock qualification still required')
