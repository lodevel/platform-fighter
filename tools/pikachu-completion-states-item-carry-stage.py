"""Stage separately inspected source-matched authored WaitItem art reuse."""
from pathlib import Path
import copy,hashlib,json,sys
import numpy as np
from PIL import Image
ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT/'tools'))
from pikachu_native_pose import PikachuNativePose,MOTIONS
E=ROOT/'docs/review/2026-10-06/pikachu-character';B=E/'art/completion-states-items'
R=B/'carry-source-review';D=B/'staged-carry';A=ROOT/'assets/characters/pikachu'
for p in [D,D/'animations',D/'pose-batches',D/'originals']:p.mkdir(exist_ok=True)
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();checkpoints={};files=[]
def read(p):
 data=p.read_bytes();checkpoints[p]=hashlib.sha256(data).hexdigest();return data
def installfile(live,p):
 before=checkpoints.get(live)
 if live.exists():
  assert before and sha(live)==before,'Source changed during staging'
  backup=D/'originals'/(before+'-'+live.name)
  if not backup.exists():backup.write_bytes(live.read_bytes())
 else:backup=None
 files.append({'live':str(live.relative_to(ROOT)),'priorSha256':before,'priorBackup':str(backup.relative_to(ROOT)) if backup else None,'candidate':str(p.relative_to(ROOT)),'candidateSha256':sha(p),'newFile':before is None})
receiptPath=R/'preparation.json';receipt=json.loads(receiptPath.read_text())
assert receipt['state']=='source_carry_reuse_paired_visually_reviewed_runtime_pending'
assert receipt.get('actualVisualReview',{}).get('runtimeQualified') is False
for r in receipt['rows']:assert sha(ROOT/r['review'])==r['reviewSha256']
atlas=ROOT/receipt['idleAtlas'];assert sha(atlas)==receipt['idleAtlasSha256'];checkpointIdle=read(atlas)
packing=ROOT/receipt['idlePackingMetadata'];assert sha(packing)==receipt['idlePackingMetadataSha256'];read(packing)
framesPath=A/'frames.json';framesText=read(framesPath).decode();frames=json.loads(framesText)
idle=frames['animations']['idle'];assert idle['sha256']==sha(atlas)
leaf=ROOT/'src/characters/pikachuAuxiliaryBody.ts';leafText=read(leaf).decode();prefix='const profiles: Readonly<Record<string, SourceProfile>> = '
start=leafText.index(prefix)+len(prefix);end=leafText.index(';',start);old=json.loads(leafText[start:end]);profiles=copy.deepcopy(old)
sheet='item_carry';assert sheet not in profiles and sheet not in frames['animations']
source=Image.open(atlas).convert('RGBA');strip=Image.new('RGBA',(2560,640))
for i,row in enumerate(receipt['rows']):
 col,line=idle['sourceCells'][i];w,h=idle['frameWidth'],idle['frameHeight'];body=source.crop((col*w,line*h,(col+1)*w,(line+1)*h))
 assert hashlib.sha256(body.tobytes()).hexdigest()==row['sourceIdleCellSha256']
 strip.alpha_composite(body,(i*512,0))
png=D/'animations'/'item_carry.png';strip.save(png);installfile(A/'animations'/png.name,png)
samples=[0,26,53,79,106];windows=[{'startFrame':a,'endFrame':b,'artFrameIndex':i} for i,(a,b) in enumerate(zip(samples,samples[1:]))]
pose=PikachuNativePose(MOTIONS/'a00waititem.nuanmb');path=[]
for age in range(107):
 p=pose.matrices(age,['Trans'])['Trans']@np.array([0,0,0,1]);path.append({'x':float(p[2])*5,'y':-float(p[1])*5})
origin=path[0];deltas=[{'x':p['x']-origin['x'],'y':p['y']-origin['y']} for p in path]
profiles[sheet]={'endExclusive':107,'drawings':[{'start':w['startFrame'],'end':w['endFrame'],'artFrameIndex':w['artFrameIndex'],'nativeSample':samples[w['artFrameIndex']],'hurtboxes':receipt['rows'][w['artFrameIndex']]['hurtboxes']} for w in windows],
 'sourceRootDelta':deltas,'sourceStatus':{'cancelFrame':None,'intangibilityStartFrame':None,'intangibilityEndExclusive':None},'sourceLoop':True,'loopFrames':106}
clip={'strip':'animations/item_carry.png','frameCount':5,'sha256':sha(png),'frameWindows':windows,'frameWidth':512,'frameHeight':640,'root':[256,416],'scaleToWorld':70/150,'sourceCells':[[i,0] for i in range(5)],'nativeSampleIndices':samples,
 'nativeWindows':[{'nativeStart':w['startFrame'],'nativeEnd':w['endFrame'],'artFrameIndex':w['artFrameIndex'],'nativeSample':samples[w['artFrameIndex']]} for w in windows],
 'runtimeClock':'Source WaitItem loop106 with native106 endpoint source-only; explicitly reviewed authored near-identical idle art reuse, genuine WaitItem12caps/Have for each sparse drawing. Held item context has no new commitment and fresh actions interrupt.',
 'packingMetadata':'assets/characters/pikachu/pose-batches/full-item_carry-tiled.json'}
meta={'state':'saved_packed_carry_body_visual_review_pending','animations':{sheet:copy.deepcopy(clip)},'sourceMotion':pose.provenance(),'sourceDeclaration':receipt['rows'][0]['sourceDeclaration'],'sourceOnlyEndpointIndices':[4],
 'explicitAuthoredReuse':{'kind':'independently_inspected_source_near_identical_idle_art','receipt':str(receiptPath.relative_to(ROOT)),'receiptSha256':sha(receiptPath),'idleAtlas':receipt['idleAtlas'],'idleAtlasSha256':receipt['idleAtlasSha256'],'separateOwnedBitmap':True,'runtimeAlias':False},'sources':receipt['rows'],'limits':receipt['limits']}
metaPath=D/'pose-batches'/'full-item_carry-tiled.json';metaPath.write_text(json.dumps(meta,indent=2)+'\n');installfile(A/'pose-batches'/metaPath.name,metaPath)
clip['packingMetadataSha256']=sha(metaPath);frames['animations'][sheet]=clip
for k,v in old.items():assert profiles[k]==v
p=D/'pikachuAuxiliaryBody.ts';p.write_text((leafText[:start]+json.dumps(profiles,separators=(',',':'))+leafText[end:]).replace('export type PikachuAuxiliaryBodySheet = ',"export type PikachuAuxiliaryBodySheet = 'item_carry' | ",1));installfile(leaf,p)
needle='"animations": {';pos=framesText.index(needle)+len(needle);addition='\n    "item_carry": '+json.dumps(clip,indent=2).replace('\n','\n    ')+','
newFrames=framesText[:pos]+addition+framesText[pos:];assert json.loads(newFrames)['animations']==frames['animations']
p=D/'frames.json';p.write_text(newFrames);installfile(framesPath,p)
assert all(sha(p)==h for p,h in checkpoints.items()),'Source changed before candidate receipt'
(D/'candidate.json').write_text(json.dumps({'state':'saved_packed_carry_body_visual_review_pending','installFiles':files,'profiles':[{'sheet':sheet,'nativeSamples':samples,'pairedReviewFiles':[r['review'] for r in receipt['rows']]}],'allExistingProfilesExact':True,'allExistingFramesEntriesExact':True,'reservedTextureKeys':['char.pikachu.item_carry'],'runtimeQualified':False},indent=2)+'\n')
print(json.dumps({'newBodyFamilies':1,'sourceMatchedDrawings':5,'files':len(files),'review':str(D)}))
