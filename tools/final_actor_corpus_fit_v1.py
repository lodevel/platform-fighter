"""Private dynamic851 V6 corpus, frozen inputs and actor-specific scalp.

Only pending rows are claimed. Existing six pilot journals are reused exactly.
Whole source RAW_FK pixels are compared each row; strict Head/Hip helpers remain
independent. No support retarget or native collision/particle parity is claimed.
"""
from pathlib import Path
import sys,json,hashlib,time,os,sqlite3,traceback
sys.path[:0]=['tools','/tmp/pikachu-source-libs']
import numpy as np
from PIL import Image,ImageDraw
from final_target_part_projection_v2 import project
from final_frozen_native_read_cache_v1 import install
from link_immutable_input_stage_v1 import ImmutableInputs,atomic_json
from fit_anatomical_capsule_chain_v6_scores import fit
from dk_native_pose import DonkeyKongNativePose
from pikachu_native_pose import PikachuNativePose
A=Path('docs/review/2026-10-12/link-character/rework/art');D=A/'final-actor-851-physical-fit-v1';D.mkdir(exist_ok=True)
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
def memory():return {l.split(':')[0]:int(l.split()[1])for l in Path('/proc/self/status').read_text().splitlines()if l.startswith(('VmRSS:','VmHWM:'))}
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
def scalp(actor,drawing,recipe):
 m=json.load(open(drawing['sourceRecord']));cls=DonkeyKongNativePose if actor=='donkeykong'else PikachuNativePose;pose=cls(Path('/mnt/c/workspace/platform-fighter')/m['motion']['path']);mat=pose.matrices(drawing['nativeSample'],['Head','Trans']);head=mat['Head'];trans=mat['Trans'][:3,3]
 if actor=='donkeykong':assert np.array_equal(head,np.asarray(m['bone_matrices']['Head']))
 theta,phi=np.meshgrid(np.linspace(0,2*np.pi,161),np.linspace(0,np.pi,81));unit=np.stack([np.cos(phi),np.sin(phi)*np.cos(theta),np.sin(phi)*np.sin(theta)],-1).reshape(-1,3)
 local=unit*np.array(recipe['radii'])+np.array(recipe['centre']);world=(np.c_[local,np.ones(len(local))]@head.T)[:,:3]-trans;crown=world[np.argmax(world[:,1])];point={'x':float(crown[2]*5),'y':float(-crown[1]*5)}
 root=np.array(drawing['knownRootAfterExactReductionCrop']);scale=drawing['scaleToWorld'];cell=Image.open(drawing['cell']);pixels=root+np.c_[world[:,2]*5,-world[:,1]*5]/scale;mask=Image.new('L',cell.size);ImageDraw.Draw(mask).polygon(hull(pixels),fill=255)
 return np.array(mask)>0,point,head.tolist(),trans.tolist()
if sys.argv[1]=='plan':
 guards=dict(json.load(open(A/'dk-pikachu-full-final-toon-bank-v1/plan.json'))['inputHashes'])
 for name in ['skin-reference.png','face-reference.png','face2-reference.png','face3-reference.png','face4-reference.png']:
  p=Path('assets/gen/pikachu-native-reference/geometry-reference')/name;guards[str(p)]=sha(p)
 files=[Path(__file__),Path('tools/final_frozen_native_read_cache_v1.py'),Path('tools/final_target_part_projection_v1.py'),Path('tools/final_target_part_projection_v2.py'),Path('tools/link_immutable_input_stage_v1.py'),Path('tools/fit_anatomical_capsule_chain_v6_scores.py'),Path('tools/fit_anatomical_capsule_envelope_v1.py'),A/'final-native-memo-six-qualification-v1/qualification.json',A/'final-actor-fit-six-pilots-v1/terminal.json',A/'final-actor-fit-six-pilots-v1/index.json',A/'final-target-part-six-hair-review-v2/coordinator-six-refined-physical-inputs-review.json',A/'final-actor-cranial-six-pilots-v1/coordinator-six-scalp-crown-review.json']
 for actor in ['donkeykong','pikachu']:files += [A/f'final-toon-sharp-pages-review-v1-{actor}/index.json',A/f'final-actor-cranial-six-pilots-v1/{actor}-cranial-recipe.json']
 guards.update({str(p):sha(p)for p in files});assert all(sha(p)==h for p,h in guards.items())
 rows=[]
 for actor in ['donkeykong','pikachu']:
  for g in json.load(open(A/f'final-toon-sharp-pages-review-v1-{actor}/index.json'))['groups']:
   for r in g['rows']:
    reference=str(Path(r['sourceRecord']).with_suffix(''))+'-reference.png';assert sha(r['sourceRecord'])==r['sourceRecordSha256']and sha(r['cell'])==r['cellSha256']
    rows.append({**r,'actor':actor,'resource':g['motion'],'key':actor+'-'+g['motion']+'-raw'+str(r['nativeSample']),'frozenWholeReference':reference,'frozenWholeReferenceSha256':sha(reference)})
 assert len(rows)==851 and len({r['key']for r in rows})==851
 # Interleave actor queues; dynamic atomic claims prevent variable-tail stalls.
 dk=[r for r in rows if r['actor']=='donkeykong'];pk=[r for r in rows if r['actor']=='pikachu'];rows=[]
 for i in range(max(len(dk),len(pk))):
  if i<len(dk):rows.append(dk[i])
  if i<len(pk):rows.append(pk[i])
 plan={'state':'FROZEN_PRIVATE851_V6_DYNAMIC_ACTOR_FITS','rows':rows,'drawingCount':851,'inputHashes':guards,'supportRetarget':0,'workerWarmup':8,'measuredCapacityTarget':12,'numericThreads':1,'gameChecksRun':False,'sourceScope':'Actor-specific mesh receiving including Pika ears/tail; explicit DKNecktie/S_Hair1/2 exclusions; authored scalp highestWORLD-Y crown, no nativecapsule orvulnerability parity.'};atomic_json(D/'plan.json',plan)
 db=Path('/tmp')/('final851-v6-'+sha(D/'plan.json')[:16]+'.sqlite');assert not db.exists();con=sqlite3.connect(db);con.execute('CREATE TABLE jobs (key TEXT PRIMARY KEY,ordinal INTEGER,state TEXT,worker INTEGER,journal TEXT,sha TEXT)');pilots={r['key']:r for r in json.load(open(A/'final-actor-fit-six-pilots-v1/index.json'))['rows']}
 for i,r in enumerate(rows):
  p=pilots.get(r['key']);con.execute('INSERT INTO jobs VALUES (?,?,?,?,?,?)',(r['key'],i,'DONE'if p else'PENDING',-1 if p else None,p['journal']if p else None,p['sha256']if p else None))
 con.commit();con.close();atomic_json(D/'queue.json',{'database':str(db),'planSha256':sha(D/'plan.json'),'reusedExactSixPilotJournals':list(pilots.values())});print('851 frozen rows; six exact pilot reuses; pending845');raise SystemExit
worker=int(sys.argv[1]);plan=json.load(open(D/'plan.json'));queue=json.load(open(D/'queue.json'));assert sha(D/'plan.json')==queue['planSha256'];W=D/f'worker-{worker:02}';W.mkdir(exist_ok=True);memo=ImmutableInputs(plan['inputHashes'],plan['inputHashes']);memo.install();cache,hits=install(plan['inputHashes']);atomic_json(W/'frozen-inputs.json',{'rows':memo.rows});rows={r['key']:r for r in plan['rows']};con=sqlite3.connect(queue['database'],timeout=60);done=[];start=time.perf_counter();atomic_json(W/'run.json',{'pid':os.getpid(),'worker':worker,'state':'PRIVATE_V6_DYNAMIC_WORKER_RUNNING','numericThreads':{k:os.environ.get(k)for k in ['OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS']},'planSha256':queue['planSha256']})
recipes={actor:json.load(open(A/f'final-actor-cranial-six-pilots-v1/{actor}-cranial-recipe.json'))for actor in ['donkeykong','pikachu']}
try:
 while True:
  while available()<2*1024*1024:time.sleep(.5)
  con.execute('BEGIN IMMEDIATE');job=con.execute("SELECT key FROM jobs WHERE state='PENDING' ORDER BY ordinal LIMIT1".replace('LIMIT1','LIMIT 1')).fetchone()
  if not job:con.commit();break
  key=job[0];con.execute("UPDATE jobs SET state='RUNNING',worker=? WHERE key=?",(worker,key));con.commit();r=rows[key];actor=r['actor'];prefix=W/key;atomic_json(W/'current.json',{'key':key,'completed':len(done),'pid':os.getpid(),'memory':memory()})
  assert sha(r['sourceRecord'])==r['sourceRecordSha256']and sha(r['cell'])==r['cellSha256']and sha(r['frozenWholeReference'])==r['frozenWholeReferenceSha256']
  t=time.perf_counter();c=time.process_time();p=project(actor,r['resource'],r['nativeSample'],prefix,compiled=False);projection={'wallSeconds':time.perf_counter()-t,'cpuSeconds':time.process_time()-c,'memoryKiB':memory()}
  assert np.array_equal(np.array(Image.open(str(prefix)+'-reference.png')),np.array(Image.open(r['frozenWholeReference']))),('SOURCE_RGBA_CHANGED',key)
  cell=Image.open(r['cell']);crop=r['crop2x'];root=np.array(r['knownRootAfterExactReductionCrop']);scale=r['scaleToWorld'];masks={}
  for rr in range(1,17):
   raw=Image.open(str(prefix)+f'-physical-region-{rr}.png');reduced=np.array(raw.resize((raw.width//2,raw.height//2),Image.Resampling.NEAREST))>0
   assert not np.any(reduced[:crop[1]])and not np.any(reduced[crop[3]:])and not np.any(reduced[:,:crop[0]])and not np.any(reduced[:,crop[2]:]),('PHYSICAL_VIEWPORT_CLIP',key,rr)
   mask=np.zeros((cell.height,cell.width),bool);mask[:crop[3]-crop[1],:crop[2]-crop[0]]=reduced[crop[1]:crop[3],crop[0]:crop[2]];masks[rr]=mask
  cranium,point,head,trans=scalp(actor,r,recipes[actor]);masks[15]|=cranium;union=np.logical_or.reduce(list(masks.values()));caps=[];parts=[];fw=fc=0
  for rr,mask in masks.items():
   name=p['regions'][rr]if rr in p['regions']else p['regions'][str(rr)]
   if not mask.any():parts.append({'part':name,'surfacePixels':0,'state':'NO_PROJECTED_ACTUAL_SURFACE'});continue
   t=time.perf_counter();c=time.process_time();chain,proof=fit(mask,union,1/scale);wall=time.perf_counter()-t;cpu=time.process_time()-c;fw+=wall;fc+=cpu
   region='head'if rr==15 else'torso'if rr in (1,2,16)else'foot'if rr in (11,14)else'leg'if rr in (9,10,12,13)else'arm'
   for i,(aa,bb,radius)in enumerate(chain):caps.append({'id':name+'-'+str(i),'region':region,'start':dict(zip(('x','y'),((aa-root)*scale).tolist())),'end':dict(zip(('x','y'),((bb-root)*scale).tolist())),'radius':float(radius*scale)})
   parts.append({'part':name,'runtimeRegion':region,'proof':proof,'wallSeconds':wall,'cpuSeconds':cpu})
  recipePath=A/f'final-actor-cranial-six-pilots-v1/{actor}-cranial-recipe.json';row={**r,'receiving':caps,'parts':parts,'headContact':{'point':point,'reviewKey':sha(recipePath)+':'+key},'cranialRecipe':str(recipePath),'cranialRecipeSha256':sha(recipePath),'actualHeadMatrix':head,'capturedTrans':trans,'sourceRoot':root.tolist(),'supportRetargetY':0,'supportState':'SOURCE_ROOT_UNSHIFTED_SUPPORT_FIT_PENDING','sourceReferenceChangedPixels':0,'projection':str(prefix)+'-part-projection.json','projectionSha256':sha(str(prefix)+'-part-projection.json'),'projectionTiming':projection,'fittingTiming':{'wallSeconds':fw,'cpuSeconds':fc,'memoryKiB':memory()},'precision':'Discrete exact selected mesh+authored scalp pixels, capsulebounds physicalunion+1WORLDunit; no native/continuous/vulnerability parity','tailPolicy':'Pika actualtail retained tail-* identity/runtime torso adaptation; DK tail N/A actual0surface','gameChecksRun':False}
  t=time.perf_counter();c=time.process_time();journal=W/(key+'-fit.json');atomic_json(journal,row);entry={'key':key,'journal':str(journal),'sha256':sha(journal),'capsules':len(caps),'projectionTiming':projection,'fittingTiming':row['fittingTiming'],'serializationTiming':{'wallSeconds':time.perf_counter()-t,'cpuSeconds':time.process_time()-c},'memoryKiB':memory()};con.execute("UPDATE jobs SET state='DONE',journal=?,sha=? WHERE key=? AND worker=?",(str(journal),entry['sha256'],key,worker));con.commit();done.append(entry);atomic_json(W/'index.json',{'rows':done,'pid':os.getpid(),'gameChecksRun':False});atomic_json(W/'progress.json',{'pid':os.getpid(),'completed':len(done),'seconds':time.perf_counter()-start,'memoryKiB':memory(),'nativeCacheHits':hits,'parsedNativeInputs':len(cache)});print(key,len(caps),round(projection['wallSeconds']+fw,3),flush=True)
 memo.verify();atomic_json(W/'terminal.json',{'state':'ALL_CLAIMED_PRIVATE_V6_FITS_COMMITTED_FROZEN_INPUTS_UNCHANGED','pid':os.getpid(),'count':len(done),'seconds':time.perf_counter()-start,'memoryKiB':memory(),'gameChecksRun':False})
except BaseException:
 atomic_json(W/'failure.json',{'pid':os.getpid(),'key':key,'completed':len(done),'traceback':traceback.format_exc(),'preserved':True});raise
