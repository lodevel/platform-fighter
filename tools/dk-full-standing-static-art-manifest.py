"""Read-only collected static art pins. Does not qualify receiving or gameplay."""
from pathlib import Path
import json,hashlib
R=Path(__file__).resolve().parents[1];A=R/'docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/art'
def pin(p):return {'path':str(p.relative_to(R)),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
rows=[]
for n,f in [(1,'root-full-grab-startup-native1-static-review-01.json'),(4,'root-full-grab-startup-native4-static-review-01.json')]:
 p=A/f;d=json.loads(p.read_text());rows.append({'nativeSample':n,'target':d['target'],'quarterTarget':d['quarterTarget'],'staticReview':pin(p),'staticAccepted':True,'sourceGuide':pin(A/f'fullgrab01-grab-native{n}.json')})
files=['full-grab-native7-9-final-static-specialist-review.json','full-grab-native10-11-final-static-specialist-review.json','full-grab-native33-final-static-specialist-review.json','full-grab-native38-final-static-specialist-review.json']
if (A/'full-grab-native24-final-static-specialist-review.json').exists():files.append('full-grab-native24-final-static-specialist-review.json')
for f in files:
 p=A/f;d=json.loads(p.read_text())
 for r in d['rows']:
  own={k:r[k] for k in ['nativeSample','target','quarterTarget']};own.update(staticReview=pin(p),staticAccepted=True,sourceGuide=r.get('sourceGuide',pin(A/f'fullgrab01-grab-native{r["nativeSample"]}.json')))
  if 'floorTransform' in r:own['floorTransform']=r['floorTransform']
  rows.append(own)
p=A/'root-grab-first-four-corrected-target-static-review.json';rows.append({'nativeSample':8,'target':pin(A/'dk-grabpilot-batch01-attempt1-grab-native8-clean3-cutout.png'),'quarterTarget':pin(A/'dk-grabpilot-batch01-attempt1-grab-native8-clean3-quarter.png'),'staticReview':pin(p),'staticAccepted':True,'sourceGuide':pin(A/'grab-first-five-native-guides-01/grab-native8.json'),'reusedAcceptedContact':True})
order=[1,4,7,8,9,10,11,24,33,38];ages=[0,3,6,7,8,9,10,23,32,37]
for r in rows:
 i=order.index(r['nativeSample']);r.update(clip='grab',artFrameIndex=i,gameplayAge=ages[i],frameWindow={'startFrame':ages[i],'endFrame':ages[i+1] if i<9 else 38,'artFrameIndex':i},root=[128,208],scaleToWorld=5/6.5,bodyCentreFromRootY=-42,receivingAccepted=False)
rows.sort(key=lambda r:r['artFrameIndex']);missing=[n for n in order if n not in [r['nativeSample'] for r in rows]];d={'state':'STATIC_ART_ONLY_FULL_SEQUENCE' if not missing else 'STATIC_ART_ONLY_INCOMPLETE','rows':rows,'missingNativeSamples':missing,'canonicalChanged':False,'wholeActionQualified':False,'sourcePlan':pin(A/'full-three-grab-minimal-next-batch-plan-01.json')};p=A/f'full-standing-grab-{len(rows)}-static-targets-art-manifest.json';assert not p.exists();p.write_text(json.dumps(d,indent=2)+'\n');print(pin(p))
