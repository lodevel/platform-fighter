"""NEW frozen V7 recovery; full anatomical viewport, successful V6 unchanged."""
from pathlib import Path
import sys,json,hashlib,time,os,sqlite3,traceback
sys.path[:0]=['tools','/tmp/pikachu-source-libs']
import numpy as np
from PIL import Image,ImageDraw
from final_target_part_projection_v2 import project
from final_frozen_native_read_cache_v1 import install
from link_immutable_input_stage_v1 import ImmutableInputs,atomic_json
from fit_anatomical_capsule_chain_v7_score_distance import fit
from dk_native_pose import DonkeyKongNativePose
from pikachu_native_pose import PikachuNativePose
A=Path('docs/review/2026-10-12/link-character/rework/art');O=A/'final-actor-851-physical-fit-v1';D=A/'final-actor-851-physical-fit-recovery-v2';D.mkdir(exist_ok=True)
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
def mem():return {l.split(':')[0]:int(l.split()[1])for l in Path('/proc/self/status').read_text().splitlines()if l.startswith(('VmRSS:','VmHWM:'))}
def available():return int(next(l.split()[1]for l in Path('/proc/meminfo').read_text().splitlines()if l.startswith('MemAvailable:')))
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
class GeometryRejection(Exception):pass
class FrozenSourceViolation(Exception):pass
def guard(p,h):
 if sha(p)!=h:raise FrozenSourceViolation(str(p))
def cranium(r,recipe,poses):
 m=json.load(open(r['sourceRecord']));key=(r['actor'],m['motion']['path'])
 if key not in poses:poses[key]=(DonkeyKongNativePose if r['actor']=='donkeykong'else PikachuNativePose)(Path('/mnt/c/workspace/platform-fighter')/m['motion']['path'])
 mat=poses[key].matrices(r['nativeSample'],['Head','Trans']);head=mat['Head'];trans=mat['Trans'][:3,3]
 if r['actor']=='donkeykong'and not np.array_equal(head,np.asarray(m['bone_matrices']['Head'])):raise FrozenSourceViolation('Head stored/native mismatch '+r['key'])
 tt,pp=np.meshgrid(np.linspace(0,2*np.pi,161),np.linspace(0,np.pi,81));unit=np.stack([np.cos(pp),np.sin(pp)*np.cos(tt),np.sin(pp)*np.sin(tt)],-1).reshape(-1,3);local=unit*np.array(recipe['radii'])+np.array(recipe['centre']);world=(np.c_[local,np.ones(len(local))]@head.T)[:,:3]-trans;top=world[np.argmax(world[:,1])];point={'x':float(top[2]*5),'y':float(-top[1]*5)};root=np.array(r['knownRootAfterExactReductionCrop']);pixels=root+np.c_[world[:,2]*5,-world[:,1]*5]/r['scaleToWorld'];return pixels,point,head.tolist(),trans.tolist()
def full_viewport(r,prefix,points):
 cell=Image.open(r['cell']);crop=r['crop2x'];raws={};bounds=[]
 for rr in range(1,17):
  raw=Image.open(str(prefix)+f'-physical-region-{rr}.png');reduced=raw.resize((raw.width//2,raw.height//2),Image.Resampling.NEAREST);raws[rr]=reduced;yy,xx=np.where(np.array(reduced)>0)
  if len(xx):bounds += [[float(xx.min()-crop[0]),float(yy.min()-crop[1])],[float(xx.max()-crop[0]),float(yy.max()-crop[1])]]
 bounds=np.array(bounds+[points.min(0).tolist(),points.max(0).tolist(),[0,0],[cell.width-1,cell.height-1]]);padding=int(np.ceil(1/r['scaleToWorld']))+2;lo=np.floor(bounds.min(0)).astype(int)-padding;hi=np.ceil(bounds.max(0)).astype(int)+padding+1;dims=hi-lo;offset=-lo;root=np.array(r['knownRootAfterExactReductionCrop'])+offset;rect=[int(lo[0]+crop[0]),int(lo[1]+crop[1]),int(hi[0]+crop[0]),int(hi[1]+crop[1])];masks={};restored={}
 for rr,raw in raws.items():
  mask=np.array(raw.crop(rect))>0;original=np.zeros((cell.height,cell.width),bool);old=np.array(raw.crop(crop))>0;original[:old.shape[0],:old.shape[1]]=old
  if not np.array_equal(mask[offset[1]:offset[1]+cell.height,offset[0]:offset[0]+cell.width],original):raise FrozenSourceViolation('Original known mask moved '+r['key'])
  masks[rr]=mask;restored[str(rr)]=int(mask.sum()-original.sum())
 shifted=points+offset
 if not(shifted.min(0)>=padding).all()or not(shifted.max(0)<dims-padding).all():raise GeometryRejection('SCALP_PRE_RASTER_CLIP '+r['key'])
 scalp=Image.new('L',tuple(map(int,dims)));ImageDraw.Draw(scalp).polygon(hull(shifted),fill=255);masks[15]|=np.array(scalp)>0
 return masks,root,{'originalCellDimensions':list(cell.size),'fitViewportOriginalPixelRect':[int(lo[0]),int(lo[1]),int(hi[0]),int(hi[1])],'fitViewportDimensions':dims.tolist(),'registeredSourceRootBefore':r['knownRootAfterExactReductionCrop'],'registeredSourceRootAfter':root.tolist(),'integerRegistrationOffsetPixels':offset.tolist(),'declaredMarginPixels':1/r['scaleToWorld'],'transparentMarginPaddingPixels':padding,'fullScalpPreRasterBoundsOriginal':{'min':points.min(0).tolist(),'max':points.max(0).tolist()},'fullScalpPreRasterInsideExpanded':True,'originalKnown16MasksExactAfterInverseOffset':True,'actualPartPixelsRestoredOutsideOriginalCell':restored,'bodyRGBAUnchanged':True,'worldRootRetarget':0,'precision':'Transparent fitting-only viewport expansion, all actual masks and full authored scalp. V7 output equivalence is separate; changed viewport does not claim old WORLD equality.'}
if sys.argv[1]=='plan':
 old=json.load(open(O/'plan.json'));guards=dict(old['inputHashes']);qualification=A.parent/'performance/compact-physical-operator-audit-v1/scores-v7/qualification.json';guard('tools/fit_anatomical_capsule_chain_v7_score_distance.py','53aa6a7f80ae748ca1a879a9ed27983478381f6223e33ffe402e27f41e19165b');guard(qualification,'e920f4d2abc93553d3adc60b89460627f7b6e2dfca7727871e48fcf11e5870eb')
 for p in [Path(__file__),O/'plan.json',qualification,Path('tools/fit_anatomical_capsule_chain_v7_score_distance.py'),O/'bounds-diagnosis-v1/all851-pre-raster-scalp-bounds-audit.json',O/'bounds-diagnosis-v1/failed-part-and-primitive-diagnostics.json']:guards[str(p)]=sha(p)
 review=O/'full-scalp-eight-and-foot-review-v2/coordinator-scoped-full-scalp-review.json';excluded=[]
 if review.exists():guards[str(review)]=sha(review)
 else:excluded=[r['key']for r in json.load(open(O/'bounds-diagnosis-v1/all851-pre-raster-scalp-bounds-audit.json'))['rows']if r['preRasterHullOutsideOriginalCell']]
 plan={**old,'state':'NEW_FROZEN_V7_RECOVERY_FULL_FIT_VIEWPORT_V2','inputHashes':guards,'excludedPendingFullScalpReview':excluded,'sourcePlan':str(O/'plan.json'),'sourcePlanSha256':sha(O/'plan.json'),'successfulOriginalJournalsMustRemainUntouched':True,'rows':old['rows'],'gameChecksRun':False};atomic_json(D/'plan.json',plan);queue=json.load(open(O/'queue.json'));queue['planSha256']=sha(D/'plan.json');queue['originalPlanSha256']=sha(O/'plan.json');atomic_json(D/'queue.json',queue);print('New V7 recovery plan, excluded',len(excluded));raise SystemExit
worker=int(sys.argv[1]);plan=json.load(open(D/'plan.json'));q=json.load(open(D/'queue.json'));guard(D/'plan.json',q['planSha256']);W=D/f'worker-{worker:02}';W.mkdir(exist_ok=True);assert not(W/'run.json').exists();memo=ImmutableInputs(plan['inputHashes'],plan['inputHashes']);memo.install();cache,hits=install(plan['inputHashes']);atomic_json(W/'frozen-inputs.json',{'rows':memo.rows});by_key={r['key']:r for r in plan['rows']};poses={};recipes={actor:json.load(open(A/f'final-actor-cranial-six-pilots-v1/{actor}-cranial-recipe.json'))for actor in ['donkeykong','pikachu']};con=sqlite3.connect(q['database'],timeout=60);done=[];rejected=[];lease=100+worker;start=time.perf_counter();atomic_json(W/'run.json',{'pid':os.getpid(),'worker':worker,'lease':lease,'state':'NEW_FROZEN_V7_FULL_VIEWPORT_WORKER_RUNNING','planSha256':q['planSha256'],'numericThreads':{k:os.environ.get(k)for k in ['OPENBLAS_NUM_THREADS','OMP_NUM_THREADS','MKL_NUM_THREADS']}})
try:
 while True:
  while available()<2*1024*1024:time.sleep(.5)
  con.execute('BEGIN IMMEDIATE');candidates=con.execute("SELECT key FROM jobs WHERE state IN ('PENDING','FAILED_GUARDED') ORDER BY CASE state WHEN 'FAILED_GUARDED' THEN0 ELSE1 END,ordinal".replace('THEN0','THEN 0').replace('ELSE1','ELSE 1')).fetchall();job=next((k for k, in candidates if k not in plan['excludedPendingFullScalpReview']),None)
  if job is None:con.commit();break
  con.execute("UPDATE jobs SET state='RUNNING',worker=? WHERE key=?",(lease,job));con.commit();r=by_key[job];atomic_json(W/'current.json',{'pid':os.getpid(),'key':job,'state':'UNCOMMITTED','memoryKiB':mem()})
  guard(r['sourceRecord'],r['sourceRecordSha256']);guard(r['cell'],r['cellSha256']);guard(r['frozenWholeReference'],r['frozenWholeReferenceSha256']);prefix=W/job;t=time.perf_counter();cpu=time.process_time();retained=next((p for p in O.glob('worker-*')if p.is_dir()and Path(str(p/job)+'-part-projection.json').exists()),None)
  if retained:
   sourcePrefix=retained/job;projectionPath=str(sourcePrefix)+'-part-projection.json';projection=json.load(open(projectionPath));guard(projection['sourceGuide'],projection['sourceGuideSha256']);guard(projection['operator'],projection['operatorSha256']);assert projection['physicalBackend']=='exact-original-python-raster-hair-exclusion';prefix=sourcePrefix;reuse={'prefix':str(prefix),'all16MasksAndReferenceHashes':{str(Path(str(prefix)+suffix)):sha(str(prefix)+suffix)for suffix in ['-reference.png','-part-projection.json']+[f'-physical-region-{i}.png'for i in range(1,17)]}}
  else:projection=project(r['actor'],r['resource'],r['nativeSample'],prefix,compiled=False);reuse=None
  if not np.array_equal(np.array(Image.open(str(prefix)+'-reference.png')),np.array(Image.open(r['frozenWholeReference']))):raise FrozenSourceViolation('SOURCE_RGBA_CHANGED '+job)
  pt={'wallSeconds':time.perf_counter()-t,'cpuSeconds':time.process_time()-cpu,'memoryKiB':mem(),'exactRetainedProjectionReuse':reuse is not None}
  try:
   points,point,head,trans=cranium(r,recipes[r['actor']],poses);masks,root,viewport=full_viewport(r,prefix,points);union=np.logical_or.reduce(list(masks.values()));caps=[];parts=[];fw=fc=0
   for rr,mask in masks.items():
    name=projection['regions'].get(rr,projection['regions'].get(str(rr)))
    if not mask.any():parts.append({'part':name,'surfacePixels':0,'state':'NO_PROJECTED_ACTUAL_SURFACE'});continue
    t=time.perf_counter();cpu=time.process_time()
    try:chain,proof=fit(mask,union,1/r['scaleToWorld'])
    except AssertionError as e:raise GeometryRejection(json.dumps({'partRegion':rr,'part':name,'actualFitterAssertion':str(e),'viewport':viewport}))from e
    wall=time.perf_counter()-t;c=time.process_time()-cpu;fw+=wall;fc+=c;region='head'if rr==15 else'torso'if rr in (1,2,16)else'foot'if rr in (11,14)else'leg'if rr in (9,10,12,13)else'arm'
    for i,(aa,bb,radius)in enumerate(chain):caps.append({'id':name+'-'+str(i),'region':region,'start':dict(zip(('x','y'),((aa-root)*r['scaleToWorld']).tolist())),'end':dict(zip(('x','y'),((bb-root)*r['scaleToWorld']).tolist())),'radius':float(radius*r['scaleToWorld'])})
    parts.append({'part':name,'runtimeRegion':region,'proof':proof,'wallSeconds':wall,'cpuSeconds':c})
   recipePath=A/f"final-actor-cranial-six-pilots-v1/{r['actor']}-cranial-recipe.json";row={**r,'receiving':caps,'parts':parts,'headContact':{'point':point,'reviewKey':sha(recipePath)+':'+job},'cranialRecipe':str(recipePath),'cranialRecipeSha256':sha(recipePath),'actualHeadMatrix':head,'capturedTrans':trans,'fitViewportQualification':viewport,'supportRetargetY':0,'supportState':'SOURCE_ROOT_UNSHIFTED_SUPPORT_FIT_PENDING','sourceReferenceChangedPixels':0,'projection':str(prefix)+'-part-projection.json','projectionSha256':sha(str(prefix)+'-part-projection.json'),'projectionReuse':reuse,'projectionTiming':pt,'fittingTiming':{'wallSeconds':fw,'cpuSeconds':fc,'memoryKiB':mem()},'precision':'Discrete all known actual16 surfaces+FULL authored scalp; capsulebounds full physicalunion+1WORLDunit, explicit fitting-only viewport change, no native/continuous/vulnerability parity','gameChecksRun':False};journal=W/(job+'-fit.json');t=time.perf_counter();cpu=time.process_time();atomic_json(journal,row);entry={'key':job,'journal':str(journal),'sha256':sha(journal),'capsules':len(caps),'projectionTiming':pt,'fittingTiming':row['fittingTiming'],'serializationTiming':{'wallSeconds':time.perf_counter()-t,'cpuSeconds':time.process_time()-cpu}};con.execute("UPDATE jobs SET state='DONE',journal=?,sha=? WHERE key=? AND worker=?",(str(journal),entry['sha256'],job,lease));con.commit();done.append(entry);atomic_json(W/'index.json',{'rows':done,'pid':os.getpid(),'rejections':rejected,'gameChecksRun':False});print(job,len(caps),round(fw+pt['wallSeconds'],3),flush=True)
  except GeometryRejection as e:
   failure=W/(job+'-geometry-rejection.json');atomic_json(failure,{'key':job,'pid':os.getpid(),'diagnostic':str(e),'originalSourceHashesPreserved':True,'noProofWeakened':True});con.execute("UPDATE jobs SET state='REJECTED_V2' WHERE key=? AND worker=?",(job,lease));con.commit();rejected.append({'key':job,'receipt':str(failure)});print('LOCAL_GEOMETRY_REJECTION',job,flush=True)
  atomic_json(W/'progress.json',{'pid':os.getpid(),'completed':len(done),'rejected':len(rejected),'seconds':time.perf_counter()-start,'memoryKiB':mem(),'parsedNativeInputs':len(cache),'nativeCacheHits':hits})
 memo.verify();atomic_json(W/'terminal.json',{'state':'NEW_V7_ALL_CLAIMED_ROWS_TERMINAL_INPUTS_UNCHANGED','pid':os.getpid(),'completed':len(done),'rejected':len(rejected),'memoryKiB':mem(),'gameChecksRun':False})
except BaseException:
 atomic_json(W/'fatal-source-or-process-failure.json',{'pid':os.getpid(),'key':job,'completed':len(done),'traceback':traceback.format_exc(),'preserved':True});raise
