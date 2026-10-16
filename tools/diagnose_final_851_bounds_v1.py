"""Actual guard failures and pre-raster authored scalp bounds, original immutable."""
from pathlib import Path
import sys,json,hashlib,time,types
sys.path[:0]=['tools','/tmp/pikachu-source-libs']
import numpy as np
from PIL import Image,ImageDraw
from dk_native_pose import DonkeyKongNativePose
from pikachu_native_pose import PikachuNativePose
from final_frozen_native_read_cache_v1 import install
from fit_anatomical_capsule_envelope_v1 import expanded_mask,capsule_coverage
A=Path('docs/review/2026-10-12/link-character/rework/art');B=A/'final-actor-851-physical-fit-v1';D=B/'bounds-diagnosis-v1';D.mkdir(exist_ok=True)
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
plan=json.load(open(B/'plan.json'));cache,hits=install(plan['inputHashes']);poses={};recipes={actor:json.load(open(A/f'final-actor-cranial-six-pilots-v1/{actor}-cranial-recipe.json'))for actor in ['donkeykong','pikachu']}
theta,phi=np.meshgrid(np.linspace(0,2*np.pi,161),np.linspace(0,np.pi,81));unit=np.stack([np.cos(phi),np.sin(phi)*np.cos(theta),np.sin(phi)*np.sin(theta)],-1).reshape(-1,3)
def hull(points):
 p=sorted(set(map(tuple,points)))
 def cross(a,b,c):return(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
 def half(seq):
  out=[]
  for q in seq:
   while len(out)>=2 and cross(out[-2],out[-1],q)<=0:out.pop()
   out.append(q)
  return out
 return half(p)[:-1]+half(p[::-1])[:-1]
rows=[];by_key={r['key']:r for r in plan['rows']}
for r in plan['rows']:
 actor=r['actor'];m=json.load(open(r['sourceRecord']));key=(actor,m['motion']['path'])
 if key not in poses:poses[key]=(DonkeyKongNativePose if actor=='donkeykong'else PikachuNativePose)(Path('/mnt/c/workspace/platform-fighter')/m['motion']['path'])
 mat=poses[key].matrices(r['nativeSample'],['Head','Trans']);head=mat['Head'];trans=mat['Trans'][:3,3];recipe=recipes[actor];local=unit*np.array(recipe['radii'])+np.array(recipe['centre']);world=(np.c_[local,np.ones(len(local))]@head.T)[:,:3]-trans;root=np.array(r['knownRootAfterExactReductionCrop']);scale=r['scaleToWorld'];points=root+np.c_[world[:,2]*5,-world[:,1]*5]/scale;cell=Image.open(r['cell']);lo=points.min(0);hi=points.max(0)
 rows.append({'key':r['key'],'hullMin':lo.tolist(),'hullMax':hi.tolist(),'originalCellDimensions':list(cell.size),'preRasterHullOutsideOriginalCell':bool(lo[0]<0 or lo[1]<0 or hi[0]>cell.width-1 or hi[1]>cell.height-1),'declaredMarginPixels':1/scale,'requiredSafePaddingPixels':int(np.ceil(1/scale))+2,'root':root.tolist(),'headMatrixSha256':hashlib.sha256(np.array(head).tobytes()).hexdigest(),'sourceRecordSha256':r['sourceRecordSha256']})
 if r['key']in {json.load(open(p))['key']for p in B.glob('worker-*/failure.json')}:
  p=D/(r['key']+'-scalp-points.json');p.write_text(json.dumps({'points':points.tolist(),'worldContact':{'x':float(world[np.argmax(world[:,1]),2]*5),'y':float(-world[np.argmax(world[:,1]),1]*5)}},indent=1)+'\n')
(D/'all851-pre-raster-scalp-bounds-audit.json').write_text(json.dumps({'rows':rows,'originalPhysicalReceiptsUntouched':True,'clippedHullCount':sum(r['preRasterHullOutsideOriginalCell']for r in rows),'gameChecksRun':False},indent=1)+'\n');print('scalpOutside',sum(r['preRasterHullOutsideOriginalCell']for r in rows),flush=True)
code=Path('tools/fit_anatomical_capsule_chain_v6_scores.py').read_text();old='assert allowed_cap(a,b,r);coverage|=capsule_coverage(p,a,b,r)';new="assert allowed_cap(a,b,r), {'start':a.tolist(),'end':b.tolist(),'radius':float(r),'bboxLo':np.floor(np.minimum(a,b)-r).astype(int).tolist(),'bboxHi':np.ceil(np.maximum(a,b)+r).astype(int).tolist(),'viewport':[w,h]};coverage|=capsule_coverage(p,a,b,r)";assert old in code;mod=types.ModuleType('privateFailurePrimitiveDiagnostic');exec(compile(code.replace(old,new),'private V6 failure diagnostic','exec'),mod.__dict__);failures=[]
for path in sorted(B.glob('worker-*/failure.json')):
 f=json.load(open(path));r=by_key[f['key']];prefix=path.parent/r['key'];cell=Image.open(r['cell']);crop=r['crop2x'];masks={}
 for rr in range(1,17):
  raw=Image.open(str(prefix)+f'-physical-region-{rr}.png');reduced=np.array(raw.resize((raw.width//2,raw.height//2),Image.Resampling.NEAREST))>0;mask=np.zeros((cell.height,cell.width),bool);mask[:crop[3]-crop[1],:crop[2]-crop[0]]=reduced[crop[1]:crop[3],crop[0]:crop[2]];masks[rr]=mask
 points=json.load(open(D/(r['key']+'-scalp-points.json')))['points'];scalp=Image.new('L',cell.size);ImageDraw.Draw(scalp).polygon(hull(points),fill=255);masks[15]|=np.array(scalp)>0;union=np.logical_or.reduce(list(masks.values()));diagnostic=None
 for rr,mask in masks.items():
  if not mask.any():continue
  try:mod.fit(mask,union,1/r['scaleToWorld'])
  except AssertionError as e:diagnostic={'partRegion':rr,'primitive':e.args[0]if e.args else None,'maskPixelBounds':{'min':np.array(np.where(mask))[::-1].min(1).tolist(),'max':np.array(np.where(mask))[::-1].max(1).tolist()}};break
 assert diagnostic is not None,('FAILURE_NO_LONGER_REPRODUCES',r['key']);entry={'key':r['key'],'originalFailure':str(path),'originalFailureSha256':sha(path),**diagnostic};failures.append(entry);print(entry,flush=True)
 (D/'failed-part-and-primitive-diagnostics.json').write_text(json.dumps({'state':'ACTUAL_ORIGINAL_V6_GUARD_FAILURES_REPRODUCED_WITHOUT_WEAKENING_PROOF','operatorSha256':sha('tools/fit_anatomical_capsule_chain_v6_scores.py'),'rows':failures,'gameChecksRun':False},indent=2)+'\n')
