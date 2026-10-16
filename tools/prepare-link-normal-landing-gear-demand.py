#!/usr/bin/env python3
"""Static stock unheld demand calculation; imports no production runtime.
The pinned source equations, not a match observation, supply these witnesses.
"""
import pathlib,json,re,hashlib,bisect,datetime,sys
R=pathlib.Path(__file__).resolve().parents[1]
def read(p):return json.loads((R/p).read_text())
def digest(p):return hashlib.sha256((R/p).read_bytes()).hexdigest()
normal=read('src/characters/linkNormalEquipmentFacts.json');landing=read('src/characters/linkLandingEquipmentFacts.json');packets=read('src/characters/linkSelectedNormalPackets.json')['normalPackets']
review=read('docs/review/2026-10-12/link-character/rework/art/ordinary-physical-corpus-review-v1/index.json')
text=(R/'src/characters/linkNormalRules.ts').read_text(); rules={}
for m in re.finditer(r"'(link\.[^']+)':rule\('([^']+)',(\d+),(\d+),\[(.*?)\](?:,|\))",text,re.S):
 windows=[]
 for w in re.finditer(r"window\((\d+),(\d+),'([^']+)'(?:,'([^']+)')?\)",m[5]):windows.append((int(w[1]),int(w[2]),w[4] or w[3]))
 rules[m[1]]={'motion':m[2],'faf':int(m[3]),'windows':windows}
labels={'early':'Early hit','clean':'Clean hit','late':'Late hit','clean1':'Clean hit 1','late1':'Late hit 1','clean2':'Clean hit 2','late2':'Late hit 2','hit1':'Hit 1','hit2':'Hit 2','hit3':'Hit 3'}
base={'sword':'normal','shield':'normal','bow':'hidden','heldItemVisible':True,'ancientBowVisible':False}
ids=['link.dashAttack','link.smash','link.smash2','link.usmash','link.dsmash','link.nair','link.fair','link.uair','link.dair','link.smash_hold','link.usmash_hold','link.dsmash_hold']
def mapage(id,age,pose):
 source=next(x for x in packets if x['runtimeMoveId']==id);points=[(0,0)]
 for first,last,packet in rules[id]['windows']:
  group=next(g for g in source['groups'] if g['group'] is None or g['group']==labels.get(packet))
  lexical=group['lexicalNativePhaseStart'];native=lexical-(1 if pose else 0);length=last-first+1
  points.extend([(first-1,native),(last,native+length)])
 points.sort()
 if age>=points[-1][0]:return points[-1][1]+age-points[-1][0]
 b=next(i for i,x in enumerate(points) if x[0]>age);a=max(0,b-1);x,y=points[a];xx,yy=points[b];return y+(yy-y)*(age-x)/max(1,xx-x)
def select(fact,script):
 gear=dict(base);applied=[]
 for e in fact['events']:
  if e['scriptNativeFrame']<=script and e.get('guard') is None:gear.update(e['changes']);applied.append(e['scriptNativeFrame'])
 return gear,sorted(set(applied))
resources=[]
for id in ids+list(landing):
 fact=normal.get(id) or landing[id];resource=pathlib.Path(fact['nativeMetadata']['animations'][0]).stem
 indexed=next(x for x in review['resources'] if x['resource']==resource);index=read(indexed['index']);cells=[c for p in index['panels'] for c in p['rows']];cells.sort(key=lambda c:c['nativeSample']);samples=[c['nativeSample'] for c in cells]
 if '--uair14' in sys.argv and resource=='c05attackairhi':
  extra='docs/review/2026-10-12/link-character/rework/art/targeted-uair-native14-v1/c05attackairhi-raw14-fit.json'
  cells.append({'nativeSample':14,'journal':extra,'sha256':digest(extra)});cells.sort(key=lambda c:c['nativeSample']);samples=[c['nativeSample'] for c in cells]
 rows=[{'nativeSample':c['nativeSample'],'sourcePhysicalJournal':c['journal'],'sourcePhysicalJournalSha256':c['sha256'],'variants':[]} for c in cells]
 def add(pose,script,origin,age):
  if pose<0 or pose>=samples[-1]+1:return
  # Staging must preserve these declared source sample selection intervals.
  at=bisect.bisect_right(samples,pose)-1;gear,applied=select(fact,script);v=next((v for v in rows[at]['variants'] if v['equipmentContext']==gear),None)
  if v is None:v={'equipmentContext':gear,'gearOwner':{'kind':'captured-expression','motion':fact['motion'],'expressionFunction':fact['source']['function'],'sourceSha256':fact['source']['sha256']},'clockWitnesses':[]};rows[at]['variants'].append(v)
  v['clockWitnesses'].append({'origin':origin,'gameplayAge':age,'selectedPoseRawAge':pose,'scriptNativeFrame':script,'appliedCallbackFrames':applied})
 if id in landing:
  for age in range(samples[-1]+1):add(age,age,'independent-real-landing-rate1-natural-tail',age)
 elif id.endswith('_hold'):
  # No gear event changes after hold entry; source motion looping must be
  # separately qualified by the eventual profile, not invented here.
  gear,applied=select(fact,1)
  for row in rows:row['variants']=[{'equipmentContext':gear,'gearOwner':{'kind':'captured-expression','motion':fact['motion'],'expressionFunction':fact['source']['function'],'sourceSha256':fact['source']['sha256']},'clockWitnesses':[{'origin':'genuine-held-smash-owner','scriptNativeFrameRange':[1,179],'appliedCallbackFrames':applied,'sampleReachability':'conditional on exact installed hold loop/sampler; this static appearance demand does not grant full runtime reachability'}]}]
 else:
  hold={'link.smash':10,'link.usmash':6,'link.dsmash':5}.get(id)
  for age in range(samples[-1]+40):
   pose=mapage(id,age,True);script=mapage(id,age,False)
   add(pose,script,'actual-active-or-uncommitted-normal-tail',age)
  if hold is not None:
   for age in range(hold+1):add(mapage(id,age,True),mapage(id,age,False),'actual-charge-startup-before-hold',age)
 resources.append({'id':id,'resource':resource,'motion':fact['motion'],'physicalIndex':indexed['index'],'physicalIndexSha256':indexed['indexSha256'],'source':fact['source'],'rows':rows})
paths=['src/characters/FreshLink.ts','src/characters/linkNormalBodyClock.ts','src/characters/linkNormalRules.ts','src/characters/linkSelectedNormalPackets.json','src/characters/linkNormalEquipmentFacts.json','src/characters/linkLandingEquipmentFacts.json','src/characters/linkLandingPresentationLease.ts','tools/prepare-link-normal-landing-gear-demand.py']
out={'schema':'link-stock-unheld-normal-landing-gear-demand/1','status':'STATIC_SOURCE_CALCULATED_NOT_RUNTIME_VERIFIED','updatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'scope':'12 attack/hold resources plus5 landing resources, stock timing, actual unheld entity NONE, no own Bow article (hidden). No other context implied.','baseline':base,'equations':'Normal selected pose and SCRIPT are separately piecewise mapped from exact gameplay windows and lexical source landmarks. Only independently selected per-phase pose offsets apply; SCRIPT is never inferred from sampled native index. Landing SCRIPT=actual rawAge at rate1, including raw0 and raw1.','charge':'Startup follows actual startupElapsed. Real hold owns captured hold expression. Active fire retains actual charge gear, but Fsmash charge BACK0 can only transfer after hold admission at startupElapsed10, by which active captured BACK3 already owns; no extra unproved early BACK variant is emitted. Up/down hold commands are empty.','naturalTail':'Reachability depends on genuine no-new-owner continuation; no player lock or forced source endpoint is granted.','selectionIntervals':'Rows assume staged source sample intervals [nativeSample,nextNativeSample) with final end=last+1. Packing must validate these exact intervals or regenerate this demand; arbitrary adaptive intervals/custom Lab timing are outside this artifact.','sourceEvidence':[{'path':p,'sha256':digest(p)} for p in paths],'resources':resources,'checksRun':[]}
if '--uair14' in sys.argv:
 out['addedSourceSample']={'resource':'c05attackairhi','nativeSample':14,'journal':'docs/review/2026-10-12/link-character/rework/art/targeted-uair-native14-v1/c05attackairhi-raw14-fit.json','sha256':digest('docs/review/2026-10-12/link-character/rework/art/targeted-uair-native14-v1/c05attackairhi-raw14-fit.json')}
 out['supersedesDemandOnly']='normal-landing17-stock-gear-demand-v1.json; original preserved'
version='v2' if '--uair14' in sys.argv else 'v1'
p=R/f'docs/review/2026-10-12/link-character/rework/runtime/normal-landing17-stock-gear-demand-{version}.json';p.write_text(json.dumps(out,indent=2)+'\n');print(p.relative_to(R));print('resources',len(resources),'rows',sum(len(r['rows']) for r in resources),'variants',sum(len(row['variants']) for r in resources for row in r['rows']));print('sha256',hashlib.sha256(p.read_bytes()).hexdigest())
