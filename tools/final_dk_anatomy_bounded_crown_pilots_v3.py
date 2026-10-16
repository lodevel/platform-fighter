"""Small concrete DK braincase correction constrained by known actual anatomy.

Head-local ellipse is only a braincase selection gate. Actual independently
projected anatomical Head tissue excludes S_Hair/Necktie; contact uses its
supported scalp boundary within that gate, not global Head mask minY.
Pikachu recipes and actual receiving ears remain unchanged.
"""
from pathlib import Path
import sys,json,hashlib,time
sys.path[:0]=['tools','/tmp/pikachu-source-libs']
import numpy as np
from PIL import Image,ImageDraw
from final_target_part_projection_v2 import project
from dk_native_pose import DonkeyKongNativePose
from pikachu_native_pose import PikachuNativePose
from final_frozen_native_read_cache_v1 import install
A=Path('docs/review/2026-10-12/link-character/rework/art');O=A/'final-actor-851-physical-fit-v1';D=A/'final-dk-anatomy-bounded-crown-fourteen-v3';D.mkdir(exist_ok=True)
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
plan=json.load(open(O/'plan.json'));install(plan['inputHashes']);refs=json.load(open(A/'final-target-part-six-hair-v2/index.json'))['rows'];keys={r['actor']+'-'+r['motion']+'-raw'+str(r['nativeSample'])for r in refs}|{r['key']for r in json.load(open(O/'bounds-diagnosis-v1/all851-pre-raster-scalp-bounds-audit.json'))['rows']if r['preRasterHullOutsideOriginalCell']};recipes={actor:json.load(open(A/f'final-actor-cranial-six-pilots-v1/{actor}-cranial-recipe.json'))for actor in ['donkeykong','pikachu']};poses={};rows=[]
recipe={'actor':'donkeykong','kind':'AUTHORED_KNOWN_ANATOMY_BOUNDED_CRANIAL_PROJECTION','braincaseSelectionGate':recipes['donkeykong'],'surfaceBound':'Intersect projected authored braincase gate with exact independently self-depth-projected known anatomicalHead mask15. Actual S_Hair1/2 andNecktie excluded by qualifiedV2; real face/ears remain receiving separately. This never promotes a cosmetic/globalHead minimum to crown.','receiving':'Full actual Head15 stays intact; authored braincase cannot add exterior receiving beyond known anatomicalHead. Other actual16 masks unchanged.','crown':'Highest WORLD-Y supported boundary within anatomical braincase intersection; x=the actual supported top-row pixel nearest that row centre, converted using unchanged SOURCE ROOT/scale. Explicit discrete authoredcontact, not nativeFootstool/capsule.','sampling':'Known anatomical Head mask exact nearest half reduction, original sourceRoot registration. Empty intersection is fatal authoring failure, never fallback to global Head minY.','support':'No support change; later approved uniform shift exactlyonce.','visualReview':'PENDING_ACTUAL_FIRST6_AND_EIGHT_TILTED_COMPARISONS','gameChecksRun':False};recipePath=D/'donkeykong-known-scalp-bounded-recipe.json';recipePath.write_text(json.dumps(recipe,indent=2)+'\n')
tt,pp=np.meshgrid(np.linspace(0,2*np.pi,161),np.linspace(0,np.pi,81));unit=np.stack([np.cos(pp),np.sin(pp)*np.cos(tt),np.sin(pp)*np.sin(tt)],-1).reshape(-1,3)
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
for r in plan['rows']:
 if r['key']not in keys:continue
 actor=r['actor'];m=json.load(open(r['sourceRecord']));posekey=(actor,m['motion']['path'])
 if posekey not in poses:poses[posekey]=(DonkeyKongNativePose if actor=='donkeykong'else PikachuNativePose)(Path('/mnt/c/workspace/platform-fighter')/m['motion']['path'])
 mat=poses[posekey].matrices(r['nativeSample'],['Head','Trans']);head=mat['Head'];trans=mat['Trans'][:3,3];oldRecipe=recipes[actor];local=unit*np.array(oldRecipe['radii'])+np.array(oldRecipe['centre']);world=(np.c_[local,np.ones(len(local))]@head.T)[:,:3]-trans;root=np.array(r['knownRootAfterExactReductionCrop']);scale=r['scaleToWorld'];points=root+np.c_[world[:,2]*5,-world[:,1]*5]/scale;oldCrown=root+np.array([world[np.argmax(world[:,1]),2]*5,-world[np.argmax(world[:,1]),1]*5])/scale
 prefix=next((p/r['key']for p in O.glob('worker-*')if p.is_dir()and Path(str(p/r['key'])+'-physical-region-15.png').exists()),None)
 if prefix is None:
  pilot=next((x for x in refs if x['actor']==actor and x['motion']==r['resource']and x['nativeSample']==r['nativeSample']),None)
  if pilot:prefix=Path(pilot['prefix'])
  else:prefix=D/r['key'];project(actor,r['resource'],r['nativeSample'],prefix,compiled=False);assert np.array_equal(np.array(Image.open(str(prefix)+'-reference.png')),np.array(Image.open(r['frozenWholeReference'])))
 raw=Image.open(str(prefix)+'-physical-region-15.png');reduced=raw.resize((raw.width//2,raw.height//2),Image.Resampling.NEAREST);cell=Image.open(r['cell']).convert('RGBA');crop=r['crop2x'];pad=np.array([20,20]);dims=(cell.width+40,cell.height+40);actual=np.array(reduced.crop((crop[0]-20,crop[1]-20,crop[0]+cell.width+20,crop[1]+cell.height+20)))>0;gate=Image.new('L',dims);ImageDraw.Draw(gate).polygon(hull(points+pad),fill=255);ellipse=np.array(gate)>0;bounded=actual&ellipse if actor=='donkeykong'else ellipse;yy,xx=np.where(bounded);assert len(xx);top=int(yy.min());crown=np.array([float(xx[yy==top][np.argmin(np.abs(xx[yy==top]-xx[yy==top].mean()))]),float(top)])if actor=='donkeykong'else oldCrown+pad;contact=(crown-pad-root)*scale
 base=Image.new('RGBA',dims,'#182738');base.alpha_composite(cell,tuple(pad));oldview=base.copy();newview=base.copy();od=ImageDraw.Draw(oldview);oldHull=hull(points+pad);od.line(oldHull+[oldHull[0]],fill='#ff8e7b',width=2)
 rgba=np.zeros((dims[1],dims[0],4),np.uint8);rgba[bounded]=[87,223,195,80];newview.alpha_composite(Image.fromarray(rgba));nd=ImageDraw.Draw(newview)
 for v,q in [(oldview,oldCrown+pad),(newview,crown)]:
  d=ImageDraw.Draw(v);d.line([(q[0]-6,q[1]),(q[0]+6,q[1])],fill='#ff7ecc',width=2);d.line([(q[0],q[1]-6),(q[0],q[1]+6)],fill='#ff7ecc',width=2);p=root+pad;d.line([(p[0]-7,p[1]),(p[0]+7,p[1])],fill='white');d.line([(p[0],p[1]-7),(p[0],p[1]+7)],fill='white')
 panel=Image.new('RGBA',(dims[0]*2,dims[1]+25),'#182738');panel.alpha_composite(oldview,(0,25));panel.alpha_composite(newview,(dims[0],25));ImageDraw.Draw(panel).text((4,4),r['key']+' oldgate/crown | known-scalp bounded candidate (Pika unchanged)',fill='white');p=D/(r['key']+'-comparison.png');panel.save(p);maskPath=D/(r['key']+'-bounded-cranium.png');Image.fromarray(bounded.astype('uint8')*255).save(maskPath)
 rows.append({'key':r['key'],'actor':actor,'resource':r['resource'],'nativeSample':r['nativeSample'],'view':str(p),'viewSha256':sha(p),'knownHeadProjection':str(prefix)+'-physical-region-15.png','knownHeadProjectionSha256':sha(str(prefix)+'-physical-region-15.png'),'bodyCell':r['cell'],'bodyCellSha256':r['cellSha256'],'originalRoot':root.tolist(),'reviewPaddingPixels':20,'boundedCranium':str(maskPath),'boundedCraniumSha256':sha(maskPath),'oldAuthoredEnvelopePixels':int(ellipse.sum()),'newBoundedPixels':int(bounded.sum()),'domePixelsExcludedByKnownAnatomy':int((ellipse&~actual).sum())if actor=='donkeykong'else 0,'actualHeadReceivingMaskUnchanged':True,'nonHeadAnatomyUntouched':True,'headContactWorld':dict(zip(('x','y'),contact.tolist())),'recipe':str(recipePath)if actor=='donkeykong'else str(A/f'final-actor-cranial-six-pilots-v1/{actor}-cranial-recipe.json'),'gameChecksRun':False});print(r['key'],rows[-1]['headContactWorld'],flush=True)
(D/'index.json').write_text(json.dumps({'state':'FOURTEEN_SMALL_CURRENT_BODY_CRANIAL_BOUND_COMPARISONS_REVIEW_PENDING','rows':rows,'successfulBodyJournalsUntouched':True,'gameChecksRun':False},indent=2)+'\n')
