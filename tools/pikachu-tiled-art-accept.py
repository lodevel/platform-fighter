"""Record a specialist's actual tiled review; generation never calls this tool.

The explicit flags attest that the caller viewed every comparison and runtime
gallery. Pixel checks alone cannot qualify identity, pose or source agreement.
"""
import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
B = ROOT / 'docs/review/2026-10-06/pikachu-character/art'
p = argparse.ArgumentParser()
p.add_argument('key')
p.add_argument('--attempt', type=int, choices=[1, 2, 3], default=1)
p.add_argument('--actually-viewed-cells', required=True)
p.add_argument('--actually-viewed-runtime-gallery', action='store_true', required=True)
p.add_argument('--observation', required=True)
p.add_argument('--tool-profile', default='tiled-generation-tool-profile.json', help='Exact tested profile for this actual output; basename only')
args = p.parse_args()

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

ledger_path = B / 'tiled-generation-ledger.json'
job = args.key + f'-attempt{args.attempt}'
row = next(r for r in json.loads(ledger_path.read_text()) if r['job_key'] == job)
if row['state'] != 'succeeded':
    raise ValueError('Only a completed, not previously decided output can be accepted')
prefix = args.key if args.attempt == 1 else job
checks_path = B / (prefix + '-mechanical-checks.json')
checks = json.loads(checks_path.read_text())
viewed = [int(x) for x in args.actually_viewed_cells.split(',')]
if viewed != [r['cell'] for r in checks] or not checks:
    raise ValueError('Actual inspection must attest every cell in order')
if any(r['unmaskedChanges'] or r['protectedRedChanges'] for r in checks):
    raise ValueError('Protected source pixels changed')
cutout = B / row['outputs']['cutout']['file']
if sha(cutout) != row['outputs']['cutout']['sha256']:
    raise ValueError('Generated cutout changed since the retained render')
galleries = [B / (prefix + f'-actual-cell{i}-review.png') for i in viewed]
galleries.append(B / (prefix + '-runtime-actual-review.png'))
if Path(args.tool_profile).name != args.tool_profile or not args.tool_profile.endswith('.json'):
    raise ValueError('Profile must be a local JSON basename')
profile = B / args.tool_profile
profile_sha = sha(profile)
profile_snapshot = B / 'tool-profile-snapshots' / (profile_sha + '.json')
profile_snapshot.parent.mkdir(exist_ok=True)
if profile_snapshot.exists():
    if sha(profile_snapshot) != profile_sha:
        raise ValueError('Immutable tool-profile snapshot changed')
else:
    profile_snapshot.write_bytes(profile.read_bytes())
review_path = B / (job + '.review.json')
if review_path.exists():
    raise ValueError('Existing review is immutable')
review = {
    'state': 'accepted_for_scoped_rough_tiled_body',
    'reviewer': 'pikachu_art_motion actual enlarged source/control/generated light/dark panels plus512px candidate gallery',
    'cutoutSha256': sha(cutout), 'cells': checks,
    'mechanicalChecksSha256': sha(checks_path),
    'observations': [args.observation],
    'limits': ['Rough source-palette interior retained; actual body acceptance separate from runtime clock/receiving match.'],
    'toolProfile': profile.name, 'toolProfileSha256AtReview': profile_sha,
    'toolProfileSnapshot': str(profile_snapshot.relative_to(B)),
    'reviewedGalleries': {f.name: sha(f) for f in galleries},
}
review_path.write_text(json.dumps(review, indent=2) + '\n')
# Read fresh after image inspection; preserve the serial renderer's newer jobs.
ledger = json.loads(ledger_path.read_text())
current = next(r for r in ledger if r['job_key'] == job)
if current['state'] != 'succeeded' or current['outputs'] != row['outputs']:
    raise ValueError('Render state changed during review')
current.update(state='accepted', acceptance=review['state'],
               review_file=review_path.name, review_sha256=sha(review_path))
temporary = B / (job + '.review-write.tmp')
temporary.write_text(json.dumps(ledger, indent=2) + '\n')
temporary.replace(ledger_path)
print(json.dumps({'accepted': args.key, 'actuallyViewedCells': viewed}))
