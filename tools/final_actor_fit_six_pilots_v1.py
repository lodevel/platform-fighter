"""Six guarded private V6 fits. Actual mesh+authored scalp; no native parity."""
from pathlib import Path
import sys,json,hashlib,time,os
sys.path[:0]=['tools','/tmp/pikachu-source-libs']
import numpy as np
from PIL import Image
from final_target_part_projection_v2 import project
from fit_anatomical_capsule_chain_v6_scores import fit
A=Path('docs/review/2026-10-12/link-character/rework/art');D=A/'final-actor-fit-six-pilots-v1';D.mkdir(exist_ok=True)
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
def mem():
 return {line.split(':')[0]:int(line.split()[1])for line in Path('/proc/self/status').read_text().splitlines()if line.startswith(('VmRSS:','VmHWM:'))}
refs=json.load(open(A/'final-target-part-six-hair-v2/index.json'))['rows'];cranial=json.load(open(A/'final-actor-cranial-six-pilots-v1/index.json'))['rows']
guards={str(p):sha(p)for p in [Path(__file__),Path('tools/final_target_part_projection_v2.py'),Path('tools/final_target_part_projection_v1.py'),Path('tools/fit_anatomical_capsule_chain_v6_scores.py'),Path('tools/fit_anatomical_capsule_envelope_v1.py')]}
for r in refs:
 for p in [r['sourceGuide'],r['frozenSourceRecord'],r['prefix']+'-reference.png']+[r['prefix']+f'-physical-region-{i}.png'for i in range(1,17)]:guards[p]=sha(p)
for c in cranial:
 for p in [c['physicalCranialEnvelope'],c['recipe']]:guards[p]=sha(p)
(D/'frozen-inputs.json').write_text(json.dumps(guards,indent=2)+'\n');done=[]
for r in refs:
 actor=r['actor'];motion=r['motion'];n=r['nativeSample'];key=actor+'-'+motion+'-raw'+str(n);prefix=D/key
 index=json.load(open(A/f'final-toon-sharp-pages-review-v1-{actor}/index.json'))
 drawing=next(q for g in index['groups']if g['motion']==motion for q in g['rows']if q['nativeSample']==n)
 assert sha(drawing['cell'])==drawing['cellSha256'];crown=next(c for c in cranial if c['actor']==actor and c['resource']==motion and c['nativeSample']==n)
 t=time.perf_counter();cpu=time.process_time();project(actor,motion,n,prefix,compiled=False)
 projection={'wallSeconds':time.perf_counter()-t,'cpuSeconds':time.process_time()-cpu,'liveMemoryKiB':mem()}
 assert np.array_equal(np.array(Image.open(str(prefix)+'-reference.png')),np.array(Image.open(r['prefix']+'-reference.png')))
 cell=Image.open(drawing['cell']);crop=drawing['crop2x'];root=np.array(drawing['knownRootAfterExactReductionCrop']);scale=drawing['scaleToWorld'];masks={}
 for rr in range(1,17):
  raw=Image.open(str(prefix)+f'-physical-region-{rr}.png');assert np.array_equal(np.array(raw),np.array(Image.open(r['prefix']+f'-physical-region-{rr}.png')))
  reduced=np.array(raw.resize((raw.width//2,raw.height//2),Image.Resampling.NEAREST))>0
  assert not np.any(reduced[:crop[1]])and not np.any(reduced[crop[3]:])and not np.any(reduced[:, :crop[0]])and not np.any(reduced[:,crop[2]:]),('PHYSICAL_VIEWPORT_CLIP',key,rr)
  mask=np.zeros((cell.height,cell.width),bool);mask[:crop[3]-crop[1],:crop[2]-crop[0]]=reduced[crop[1]:crop[3],crop[0]:crop[2]];masks[rr]=mask
 masks[15]|=np.array(Image.open(crown['physicalCranialEnvelope']))>0
 union=np.logical_or.reduce(list(masks.values()));caps=[];parts=[];fit_wall=fit_cpu=0
 for rr,mask in masks.items():
  name=r['regions'][str(rr)]
  if not mask.any():parts.append({'part':name,'surfacePixels':0,'state':'NO_PROJECTED_ACTUAL_SURFACE'});continue
  t=time.perf_counter();cpu=time.process_time();chain,proof=fit(mask,union,1/scale);wall=time.perf_counter()-t;cpu_elapsed=time.process_time()-cpu;fit_wall+=wall;fit_cpu+=cpu_elapsed
  region='head'if rr==15 else'torso'if rr in (1,2,16)else'foot'if rr in (11,14)else'leg'if rr in (9,10,12,13)else'arm'
  for i,(aa,bb,radius)in enumerate(chain):caps.append({'id':name+'-'+str(i),'region':region,'start':dict(zip(('x','y'),((aa-root)*scale).tolist())),'end':dict(zip(('x','y'),((bb-root)*scale).tolist())),'radius':float(radius*scale)})
  parts.append({'part':name,'runtimeRegion':region,'proof':proof,'wallSeconds':wall,'cpuSeconds':cpu_elapsed});print(key,name,round(wall,3),len(chain),mem(),flush=True)
 t=time.perf_counter();cpu=time.process_time()
 record={'actor':actor,'motion':motion,'nativeSample':n,'logicalArtFrameIndex':drawing['logicalArtFrameIndex'],'packedCell':drawing['cell'],'packedCellSha256':drawing['cellSha256'],'sourceRecord':drawing['sourceRecord'],'sourceRecordSha256':drawing['sourceRecordSha256'],'receiving':caps,'parts':parts,'headContact':crown['headContact'],'cranialRecipe':crown['recipe'],'cranialRecipeSha256':crown['recipeSha256'],'sourceRoot':root.tolist(),'scaleToWorld':scale,'supportRetargetY':0,'supportState':'SOURCE_ROOT_UNSHIFTED_SUPPORT_FIT_PENDING','precision':'Discrete known mesh+authored scalp surface centre coverage and union bounds with1WORLDunit margin, not native capsules/continuous geometry/vulnerability parity','tailPolicy':'Actual Pika tail receiving retained as explicit tail-* identities, runtime torso region adaptation; DK emptytail explicit','projectionTiming':projection,'fittingTiming':{'wallSeconds':fit_wall,'cpuSeconds':fit_cpu,'liveMemoryKiB':mem()},'gameChecksRun':False}
 path=D/(key+'-fit.json');path.write_text(json.dumps(record,indent=2)+'\n');serialization={'wallSeconds':time.perf_counter()-t,'cpuSeconds':time.process_time()-cpu,'bytes':path.stat().st_size,'liveMemoryKiB':mem()}
 done.append({'key':key,'journal':str(path),'sha256':sha(path),'projectionTiming':projection,'fittingTiming':record['fittingTiming'],'serializationTiming':serialization,'capsules':len(caps)})
 (D/'index.json').write_text(json.dumps({'state':'SIX_PRIVATE_ACTOR_V6_PILOTS_PROGRESS','pid':os.getpid(),'rows':done,'gameChecksRun':False},indent=2)+'\n')
assert all(sha(p)==h for p,h in guards.items())
(D/'terminal.json').write_text(json.dumps({'state':'SIX_PRIVATE_V6_FITS_COMPLETE_FROZEN_INPUTS_UNCHANGED_REVIEW_PENDING','pid':os.getpid(),'count':len(done),'guards':len(guards),'liveMemoryKiB':mem(),'gameChecksRun':False},indent=2)+'\n')
