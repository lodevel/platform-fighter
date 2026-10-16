"""Install an actually reviewed scoped candidate, with exact concurrency guards."""
from pathlib import Path
import json,hashlib,shutil
ROOT=Path(__file__).resolve().parent.parent;D=ROOT/'docs/review/2026-10-06/pikachu-character/art/completion-states-throw-floor/staged';p=D/'candidate.json';d=json.loads(p.read_text());sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
assert d['state']=='actual-saved-body-and-receiving-reviewed-ready-for-runtime'
assert d.get('coordination',{}).get('sourceBuildFreezeReleased') is True
for r in d['installFiles']:
 assert sha(ROOT/r['live'])==r['priorSha256'], 'Concurrent live mutation: '+r['live']
 assert sha(ROOT/r['candidate'])==r['candidateSha256'], 'Candidate changed after review: '+r['candidate']
for r in d['installFiles']:shutil.copy2(ROOT/r['candidate'],ROOT/r['live'])
d['currentInstallation']='reviewed-local-anatomy-candidate-installed-runtime-pending';p.write_text(json.dumps(d,indent=2)+'\n');print(json.dumps({'installed':len(d['installFiles']),'cells':len(d['changes']),'state':d['currentInstallation']}))
