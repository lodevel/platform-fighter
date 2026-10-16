"""Guarded additive installation of the reviewed Final owner art+geometry.

Run only after the coordinator has inspected the staged contact sheets. This
does not build, publish or remove any existing clip. Re-running checks equality.
"""
from pathlib import Path
import hashlib,json,os,shutil,sys
ROOT=Path(__file__).resolve().parents[1]
E=ROOT/'docs/review/2026-10-15/pikachu-final'
STAGE=E/'owner-art-staging';TARGET=ROOT/'assets/characters/pikachu'
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
plan=json.loads((E/'owner-art-plan.json').read_text())
geometry=json.loads((E/'owner-geometry.json').read_text())
art=json.loads((STAGE/'art-clips.json').read_text())
assert geometry['planSha256']==sha(E/'owner-art-plan.json')
assert set(art)==set(geometry['clips'])=={c['sheet']for c in plan['clips']}
frames=TARGET/'frames.json';before=frames.read_bytes();bank=json.loads(before);original=json.loads(before)
additions={};files=[]
for clip in plan['clips']:
 sheet=clip['sheet'];drawing=art[sheet];shapes=geometry['clips'][sheet]
 assert drawing['nativeSampleIndices']==shapes['nativeSampleIndices']==clip['samples']
 assert drawing['frameCount']==len(clip['samples'])==len(shapes['hurtboxPoses'])
 assert drawing['coordinateOrigin']==shapes['coordinateOrigin']=='actorSourceRoot'
 assert drawing['sourceSampleBasis']==shapes['sourceSampleBasis']=='zero-based-native-index'
 assert drawing['root']==[512,1152] and drawing['bodyCentreFromRootY']==-25
 assert drawing['scaleToWorld']==7/30
 assert len(drawing['trims'])==drawing['frameCount']
 assert all(len(t)==6 and t[2]>0 and t[3]>0 and t[4]>=0 and t[5]>=0 and t[4]+t[2]<=drawing['frameWidth']and t[5]+t[3]<=drawing['frameHeight']for t in drawing['trims'])
 assert sha(ROOT/clip['motionPath'])==clip['motionSha256']==drawing['artProvenance']['motionSha256']
 source=STAGE/drawing['strip'];dest=TARGET/drawing['strip'];assert sha(source)==drawing['sha256']
 merged={**{key:value for key,value in drawing.items()if key!='drawingReceipts'},**shapes}
 # All art registration metrics remain unchanged by collision integration.
 for key in ['frameWidth','frameHeight','root','scaleToWorld','bodyCentreFromRootY','trims','atlas']:assert merged[key]==drawing[key]
 if sheet in bank['animations']:
  assert bank['animations'][sheet]==merged,'Existing different Final clip cannot be overwritten'
  assert dest.exists() and sha(dest)==drawing['sha256']
 else:
  if dest.exists():assert sha(dest)==drawing['sha256'],'Unregistered different art cannot be overwritten'
  additions[sheet]=merged
  if not dest.exists():files.append((source,dest))
bank['animations'].update(additions)
assert all(bank[k]==v for k,v in original.items()if k!='animations')
assert all(bank['animations'][k]==v for k,v in original['animations'].items())
if '--stage-only'in sys.argv:
 candidate=STAGE/'frames-candidate.json';candidate.write_text(json.dumps(bank,indent=2)+'\n')
 print(json.dumps({'candidate':str(candidate),'sha256':sha(candidate),'drawings':sum(art[k]['frameCount']for k in art),'installedAssetsChanged':False}));raise SystemExit
for source,dest in files:shutil.copyfile(source,dest);assert sha(source)==sha(dest)
assert frames.read_bytes()==before,'Concurrent metadata edit: retry additive merge against current bank'
temporary=TARGET/'frames.json.pikachu-final-stage'
temporary.write_text(json.dumps(bank,indent=2)+'\n');os.replace(temporary,frames)
receipt={'schema':'pikachu-final-owner-install/1','beforeFramesSha256':hashlib.sha256(before).hexdigest(),'afterFramesSha256':sha(frames),
 'artStageSha256':sha(STAGE/'art-clips.json'),'geometrySha256':sha(E/'owner-geometry.json'),'planSha256':sha(E/'owner-art-plan.json'),
 'addedClips':list(additions),'drawings':sum(art[k]['frameCount']for k in art),'preservedEveryPreviousClipAndTopLevelProperty':True,
 'sourceFidelity':'Retained native positions/timing; authored toon art and TOP projection adapter. Native camera/angle and common victim dispatcher precision remain separate limits.',
 'gameChecksRun':False}
(E/'owner-install.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(receipt))
