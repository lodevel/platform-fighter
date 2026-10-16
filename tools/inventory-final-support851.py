#!/usr/bin/env python3
"""Read-only static same-source-root support inventory; no renderer/physics.
Reads actual completed physical mask PNGs and source matrices with retained
helper guards. No pixels, fits, source artifacts or production assets change.
"""
from pathlib import Path
import sys,json,hashlib,datetime,concurrent.futures,re
sys.path[:0]=['/tmp/pikachu-source-libs',str(Path(__file__).resolve().parent)]
import numpy as np
from PIL import Image
from dk_native_pose import DonkeyKongNativePose
from pikachu_native_pose import PikachuNativePose
ROOT=Path(__file__).resolve().parents[1]
CORPUS='docs/review/2026-10-12/link-character/rework/art/final-dk-selective-crown-repair-v3/completed-851-source-tuples.json'
FX='docs/review/2026-10-12/link-character/rework/art/final-fx-same-drawing-points-v1/index.json'
OUT=ROOT/'docs/review/2026-10-12/link-character/rework/runtime/final-support851-inventory-v1';OUT.mkdir(parents=True,exist_ok=True)
def sha(p):return hashlib.sha256((ROOT/p).read_bytes()).hexdigest()
def load(p):
 data=(ROOT/p).read_bytes();return json.loads(data),hashlib.sha256(data).hexdigest()
corpus,corpus_sha=load(CORPUS); rows=corpus['rows'];assert len(rows)==851 and len({r['key'] for r in rows})==851
fx,fxsha=load(FX);fxrows={(r['actor'],r['resource'],r['nativeSample']):r for r in fx['rows']}
# Derived from the real production class defaults; custom saved tuning is not
# this stock policy. Actual Matter chamfer geometry is a final runtime witness.
hulls={}
for actor,path,expected in [('donkeykong','src/characters/DonkeyKong.ts',(60,84,10,-42)),('pikachu','src/characters/Pikachu.ts',(40,50,8,-25))]:
 text=(ROOT/path).read_text();block=text.split('export const '+('DONKEYKONG_TUNING' if actor=='donkeykong' else 'PIKACHU_TUNING'),1)[1].split('};',1)[0]
 vals=tuple(float(re.search(r'\b'+key+r':\s*([\d.]+)',block)[1]) for key in ['width','height','chamfer']);assert vals==expected[:3]
 hulls[actor]={'classSource':path,'sha256':sha(path),'width':vals[0],'height':vals[1],'chamfer':vals[2],'bodyCentreFromRootY':expected[3],'nominalRectangleFloorFromSourceRoot':expected[3]+vals[1]/2,'precision':'stock source constructor rectangle; actual rounded Matter vertices/contact support require end-phase observation'}
poses={};sources={};journals={};projection_meta={};sharp={}
for actor in hulls:
 sharp_path=f'docs/review/2026-10-12/link-character/rework/art/final-toon-sharp-pages-review-v1-{actor}/index.json';si,ss=load(sharp_path)
 for g in si['groups']:
  for r in g['rows']:sharp[(actor,g['motion'],r['nativeSample'])]=(r,sharp_path,ss)
for r in rows:
 j,jsha=load(r['journal']);assert jsha==r['sha256'];base,base_path,base_sha=sharp[(r['actor'],r['resource'],r['nativeSample'])];assert base['cellSha256']==r['cellSha256'] and base['sourceRecordSha256']==r['sourceRecordSha256'];j={**base,**j};j['registrationMetadata']={'path':base_path,'sha256':base_sha};
 if 'projection' not in j:j['projection']=r['journal'].replace('-fit.json','-part-projection.json')
 s,ssha=load(r['sourceRecord']);assert ssha==r['sourceRecordSha256'];assert j['supportRetargetY']==0 and j['coordinateOrigin']=='actorSourceRoot';assert j['bodyCentreFromRootY']==hulls[r['actor']]['bodyCentreFromRootY']
 sources[r['key']]=s;journals[r['key']]=j;projection_meta[r['key']]=load(j['projection'])
 key=(r['actor'],s['motion']['path'])
 if key not in poses:
  assert sha(s['motion']['path'])==s['motion']['sha256'];poses[key]=(DonkeyKongNativePose if r['actor']=='donkeykong' else PikachuNativePose)(ROOT/s['motion']['path'])
def process(r):
 j=journals[r['key']];s=sources[r['key']];p,phash=projection_meta[r['key']];root=np.asarray(p['root'],dtype=float);ppu=float(p['artPixelsPerNativeUnit']);scale=5/ppu;hull=hulls[r['actor']];floor=hull['nominalRectangleFloorFromSourceRoot'];prefix=(ROOT/j['projection']).with_name(Path(j['projection']).name.replace('-part-projection.json',''))
 region_names=p['regions'];feet=[]
 for region in ['11','14']:
  assert region_names[region] in ['foot-L','foot-R'];mp=Path(str(prefix)+f'-physical-region-{region}.png');raw=mp.read_bytes();im=Image.open(mp);a=np.asarray(im);mask=a>0 if a.ndim==2 else a[:,:,3]>0;ys,xs=np.nonzero(mask)
  feet.append({'regionId':int(region),'part':region_names[region],'path':str(mp.relative_to(ROOT)),'sha256':hashlib.sha256(raw).hexdigest(),'dimensions':list(im.size),'physicalSurfacePixels':int(mask.sum()),'pixelCentreBottomSourceRootWorldY':float((ys.max()-root[1])*scale) if len(ys) else None,'pixelCellBottomSourceRootWorldY':float((ys.max()+.5-root[1])*scale) if len(ys) else None,'pixelCentreBoundsSourceRootWorld':{'left':float((xs.min()-root[0])*scale),'right':float((xs.max()-root[0])*scale),'top':float((ys.min()-root[1])*scale),'bottom':float((ys.max()-root[1])*scale)} if len(ys) else None})
 cp=ROOT/r['cell'];assert sha(r['cell'])==r['cellSha256'];image=Image.open(cp).convert('RGBA');alpha=np.asarray(image)[:,:,3];ys,xs=np.nonzero(alpha);packedroot=np.asarray(j['knownRootAfterExactReductionCrop']);cellscale=float(j['scaleToWorld']);bottom=float((ys.max()+.5-packedroot[1])*cellscale) if len(ys) else None
 receiving=[c for c in j['receiving'] if c.get('region')=='foot'];receivebottom=max((max(c['start']['y'],c['end']['y'])+c['radius'] for c in receiving),default=None)
 pose=poses[(r['actor'],s['motion']['path'])];bone_names=[b.name for b in pose.skeleton.bones if b.name.lower() in ['trans','footl','footr','toel','toer','toel2','toer2']];bones=[];gaps=[]
 try:
  matrices=pose.matrices(r['nativeSample'],bone_names);trans=matrices['Trans'][:3,3];assert np.array_equal(trans,np.asarray(s['captured_trans_translation']))
  for name,m in matrices.items():
   if name=='Trans':continue
   delta=float(np.max(np.abs(m-np.asarray(s['bone_matrices'][name])))) if name in s.get('bone_matrices',{}) else None
   if delta is not None:assert delta==0
   point=m[:3,3]-trans;bones.append({'name':name,'nativeRootRelativePosition':point.tolist(),'sourceRootWorldPoint':{'x':float(point[2]*5),'y':float(-point[1]*5)},'matrix':m.tolist(),'deltaFromStoredSourceRecord':delta})
 except (ValueError,KeyError) as e:gaps.append('Guarded source foot hierarchy unavailable: '+str(e))
 for needed in ['FootL','FootR']:
  if not any(b['name']==needed for b in bones):gaps.append('Required source support anchor missing: '+needed)
 if not any(b['name'].startswith('Toe') for b in bones):gaps.append('No captured Toe named bone in this skeleton; foot origin is not a sole-bottom measurement')
 fxrow=fxrows[(r['actor'],r['resource'],r['nativeSample'])];assert fxrow['sourceRecordSha256']==r['sourceRecordSha256'];assert fxrow['uniformSupportRetargetWorldY']==0
 footbottom=max((f['pixelCellBottomSourceRootWorldY'] for f in feet if f['pixelCellBottomSourceRootWorldY'] is not None),default=None)
 return {'key':r['key'],'actor':r['actor'],'resource':r['resource'],'nativeSample':r['nativeSample'],'logicalArtFrameIndex':r['logicalArtFrameIndex'],'sourceRecord':r['sourceRecord'],'sourceRecordSha256':r['sourceRecordSha256'],'physicalJournal':r['journal'],'physicalJournalSha256':r['sha256'],'projection':j['projection'],'projectionSha256':phash,'sourceRoot':{'x':0,'y':0},'supportRetargetWorldY':0,'bodyCentreFromRootY':hull['bodyCentreFromRootY'],'nominalHullFloorWorldY':floor,'sourceFootToeAnchors':bones,'physicalFeet':feet,'physicalFootPixelBottomWorldY':footbottom,'physicalFootGapAboveNominalHullFloor':None if footbottom is None else floor-footbottom,'footReceivingBottomWorldY':receivebottom,'footReceivingGapAboveNominalHullFloor':None if receivebottom is None else floor-receivebottom,'packedRgbaCell':r['cell'],'packedRgbaCellSha256':r['cellSha256'],'packedRgbaVisibleBottomWorldY':bottom,'sameDrawingEffectPoints':fxrow['sourceEffectPointPoses'],'sameDrawingEffectInputSha256':fxsha,'gaps':gaps,'policy':'Read-only unchanged SOURCE_ROOT/retarget0. Per-pose foot lift and later actual trajectory remain intact. Positive gap is lift above nominal floor, negative is geometry below it; neither triggers floor-snap or new kinetics. Pixel-centre/grid precision distinct from capsule union bound.'}
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
 results=list(executor.map(process,rows))
summary=[]
for actor in hulls:
 for resource in sorted({r['resource'] for r in results if r['actor']==actor}):
  group=[r for r in results if r['actor']==actor and r['resource']==resource];vals=[r['physicalFootGapAboveNominalHullFloor'] for r in group if r['physicalFootGapAboveNominalHullFloor'] is not None];summary.append({'actor':actor,'resource':resource,'drawings':len(group),'physicalFootGapMin':min(vals) if vals else None,'physicalFootGapMax':max(vals) if vals else None,'minimumKey':min(group,key=lambda r:r['physicalFootGapAboveNominalHullFloor'] if r['physicalFootGapAboveNominalHullFloor'] is not None else float('inf'))['key'],'maximumKey':max(group,key=lambda r:r['physicalFootGapAboveNominalHullFloor'] if r['physicalFootGapAboveNominalHullFloor'] is not None else -float('inf'))['key'],'rowsWithDependencies':sum(bool(r['gaps']) for r in group)})
paths=[CORPUS,FX,'src/characters/characterFactory.ts','src/characters/fighterRegistry.ts','src/characters/Character.ts','tools/dk_native_pose.py','tools/pikachu_native_pose.py','tools/inventory-final-support851.py']
output={'schema':'final-support851-static-inventory/1','status':'MEASURED_SOURCE_AND_CURRENT_MASKS_NOT_RUNTIME_ACCEPTED','updatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'drawingCount':len(results),'hullDefaults':hulls,'inputHashes':{p:sha(p) for p in paths},'scope':'851 completed same native tuples, helper guards retained, no rendering/refitting/asset writes/physics/browser/build/tests. Existing support shift0 selected, no ground snap.','summary':summary,'rows':results,'gameChecksRun':[]}
(OUT/'index.json').write_text(json.dumps(output,indent=2)+'\n');(OUT/'summary.json').write_text(json.dumps({k:v for k,v in output.items() if k!='rows'},indent=2)+'\n');print(json.dumps({'path':str((OUT/'index.json').relative_to(ROOT)),'drawings':len(results),'summary':summary},indent=2),flush=True)
