"""Bounded six-sample source/mask qualification; no game checks."""
from pathlib import Path
import sys,json,hashlib,time,resource
sys.path[:0]=['tools','/tmp/pikachu-source-libs']
import numpy as np
from PIL import Image
from final_target_part_projection_v2 import project
A=Path('docs/review/2026-10-12/link-character/rework/art')
D=A/'final-target-part-six-hair-v2';D.mkdir(exist_ok=True)
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
rows=[]
for old in json.load(open(A/'final-target-part-six-preparation-v1/index.json'))['rows']:
 key=old['actor']+'-'+old['motion']+'-raw'+str(old['nativeSample']);prefix=D/key
 t=time.perf_counter();c=time.process_time()
 r=project(old['actor'],old['motion'],old['nativeSample'],prefix,compiled=False)
 timing={'wallSeconds':time.perf_counter()-t,'cpuSeconds':time.process_time()-c,'maxRssKiB':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss}
 def changed(p,q):
  x=np.array(Image.open(p));y=np.array(Image.open(q));assert x.shape==y.shape
  return int(np.count_nonzero(np.any(x!=y,axis=2) if x.ndim==3 else x!=y))
 rgba=changed(str(prefix)+'-reference.png',old['prefix']+'-reference.png');assert rgba==0
 diffs={str(n):changed(str(prefix)+f'-physical-region-{n}.png',old['prefix']+f'-physical-region-{n}.png')for n in range(1,17)}
 assert all(v==0 for n,v in diffs.items()if n!='15')
 if old['actor']=='pikachu':assert diffs['15']==0
 r.update({'prefix':str(prefix),'frozenReferenceRGBAChangedPixels':rgba,'physicalMaskChangedPixelsAgainstV1':diffs,'projectionTiming':timing,'frozenSourceRecord':old['frozenSourceRecord'],'frozenSourceRecordSha256':old['frozenSourceRecordSha256']})
 assert sha(r['frozenSourceRecord'])==r['frozenSourceRecordSha256']
 rows.append(r);print(key,timing,diffs,flush=True)
 (D/'index.json').write_text(json.dumps({'state':'SIX_SOURCE_RGBA_EXACT_PYTHON_HAIR_OWNER_REFINEMENT_QUALIFIED_REVIEW_PENDING','rows':rows,'compiledTrialRejected':{'reason':'DKStart28 forearm-R one pixel differed from original Python raster','retainedPrivateEvidence':str(A/'final-target-part-v2-backend-qualification-v1')},'gameChecksRun':False},indent=2)+'\n')
