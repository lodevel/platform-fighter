"""745 current-pixel review manifest with source-guided Bair back-shield exception.

This proposal retains rejected held-shield trials separately. No installation,
refit or game checks. Original Bair bytes retain original registration/crop.
"""
from pathlib import Path
import json,hashlib,math
from PIL import Image,ImageDraw
A=Path('docs/review/2026-10-12/link-character/rework/art');S=A/'normal-exclusive-equipment-745-bank-v1';D=A/'normal-exclusive-equipment-745-corrected-review-v2';D.mkdir(exist_ok=True)
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
plan=json.load(open(S/'plan.json'));committed={};shards=[]
for i in range(8):
 p=S/f'worker-{i:02}/index.json';j=json.load(open(p));shards.append({'path':str(p),'sha256':sha(p),'count':len(j['rows'])})
 for r in j['rows']:
  if r['resource']=='c05attackairb':continue
  key=(r['resource'],r['nativeSample']);assert key not in committed;committed[key]=r
assert len(committed)==695
rows=[]
for r in plan['rows']:
 if r['resource']=='c05attackairb':
  assert r['originalRenderedGearVisibility']=={'link_ken':True,'link_kenb':False,'link_tate':False,'link_tateb':True}
  new={**r,'cell':r['previousCell'],'cellSha256':r['previousCellSha256'],
       'effectiveEquipmentContext':{'sword':'normal','shield':'back','bow':'hidden','heldItemVisible':False,'ancientBowVisible':False},
       'sourceMotionEquipmentException':'ACTUAL_UFD_BAIR_EMPTY_FIST_EXCLUSIVE_BACK_SHIELD_NO_EXPRESSION_PLACEMENT_COMMAND',
       'pixelDisposition':'EXACT_SOURCE_GUIDED_ORIGINAL_BAIR_BYTE_REUSE_NO_TRIAL_HELD_SHIELD',
       'needsSelectedGearDerivative':False,'originalWasProposedForUnsupportedHeldShieldDerivative':True,
       'geometryReuse':'Exact original cell/ROOT/crop/body/head/clock bytes and values retained; no fit rerun',
       'visualReview':'PENDING_ALL_CURRENT745_FINAL_REVIEW'}
 else:
  new={**committed[(r['resource'],r['nativeSample'])],
       'effectiveEquipmentContext':plan['equipmentContext'],'pixelDisposition':'SELECTED_NORMAL_EXCLUSIVE_DERIVATIVE' if r['needsSelectedGearDerivative']else'ORIGINAL_BYTE_REUSE',
       'visualReview':'PENDING_ALL_CURRENT745_FINAL_REVIEW'}
 assert sha(new['cell'])==new['cellSha256'];assert sha(new['sourceRecord'])==new['sourceRecordSha256']
 rows.append(new)
assert len(rows)==745 and sum(r['needsSelectedGearDerivative']for r in rows)==184
panels=[]
resources=list(dict.fromkeys(r['resource']for r in rows))
for resource in resources:
 group=[r for r in rows if r['resource']==resource];folder=D/resource;folder.mkdir(exist_ok=True)
 width=max(r['cellDimensions'][0]for r in group);height=max(r['cellDimensions'][1]for r in group)
 for start in range(0,len(group),12):
  cells=group[start:start+12];cols=min(4,len(cells));count=math.ceil(len(cells)/cols)
  panel=Image.new('RGBA',(width*cols,(height+24)*count),'#182738');draw=ImageDraw.Draw(panel)
  for i,r in enumerate(cells):
   x=(i%cols)*width;y=(i//cols)*(height+24);panel.alpha_composite(Image.open(r['cell']).convert('RGBA'),(x,y+24))
   draw.text((x+4,y+4),resource+' raw'+str(r['nativeSample'])+' '+('single BackShield'if resource=='c05attackairb'else'single normal gear'),fill='white')
  p=folder/f'all-current-pixels-{start//12+1}.png';panel.save(p)
  panels.append({'resource':resource,'panel':str(p),'panelSha256':sha(p),'count':len(cells),'sourceNativeSamples':[r['nativeSample']for r in cells],
                 'actualReview':'PENDING_ALL_CURRENT_PIXELS'})
manifest={'state':'CORRECTED745_CURRENT_PIXELS_SOURCE_BAIR_BACK_EXCEPTION_COORDINATOR_ACCEPTANCE_PENDING',
 'drawingCount':745,'changedNormalGearDrawings':184,'originalByteReusedDrawings':561,'rows':rows,'panels':panels,
 'sourcePlan':str(S/'plan.json'),'sourcePlanSha256':sha(S/'plan.json'),'sourcePartialShardIndexes':shards,
 'rejectedTrials':'normal-exclusive-equipment-745-bank-v1/viewport-v2-terminal-private-rejection-receipt.json retained, never installed',
 'equipmentPolicy':'Normal Sword+normal Shield exclusive selected unheld baseline; actual UFD Bair0..49 source-exclusive backShield motion exception. Bair SCRIPT commandless remains commandless. Captured four stow callbacks outside745scope untouched. External Bow existing actualowner context stays independent.',
 'physicalReuse':'184changed exact14mask+faceRGBA+dome/38anchors/Head/ROOT/canvas/clock guards; all561 unchangedRGBA fitreuse. WORLD receiving/headContact copiedunchanged; no anatomicalrefit, recentering or floorsnap.',
 'sourceBairCrossreadReceipt':'Pending source specialist retained primary UFD/source evidence attachment',
 'gameChecksRun':False,'shippingAssetsChanged':False,'operator':str(Path(__file__)),'operatorSha256':sha(__file__)}
(D/'index.json').write_text(json.dumps(manifest,indent=2)+'\n');print('745',len(panels),'panels',len(resources),'resources',flush=True)
