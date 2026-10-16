"""Stage exact Have/Trans projection for each accepted sparse ordinary drawing.

No body alias, runtime selector, kinetic ownership or inferred joint fallback.
Expose raw source points; record bounded art-band differences separately so an
engine owner can choose an explicitly authored adaptation without hiding it.
"""
from pathlib import Path
import copy,hashlib,json,sys
import numpy as np
from PIL import Image,ImageDraw
ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT/'tools'))
from pikachu_native_pose import PikachuNativePose,MOTIONS
E=ROOT/'docs/review/2026-10-06/pikachu-character'
B=E/'art/completion-states-items';D=B/'staged-ordinary-sockets';D.mkdir(exist_ok=True)
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();checkpoints={}
def read(p):
 data=p.read_bytes();checkpoints[p]=hashlib.sha256(data).hexdigest();return data
leaf=ROOT/'src/characters/pikachuItemAttachment.ts';text=read(leaf).decode()
needle='const sourceHave: Readonly<Record<string, Readonly<Record<number, PikachuItemAttachment>>>> = '
start=text.index(needle)+len(needle);end=text.index(';',start);original=json.loads(text[start:end]);table=copy.deepcopy(original)
framesPath=ROOT/'assets/characters/pikachu/frames.json';frames=json.loads(read(framesPath))['animations']
clockPath=E/'sources/state-runtime-clock-contract.json';clock=json.loads(read(clockPath))['actions']
sheets=['idle','walk','walk_slow','walk_fast','dash','run','dash_turn','run_turn','run_brake','run_brake_left','crouch_start','crouch','crouch_end','crawl','crawl_back','jumpsquat','jump','jump_back','airjump','airjump_back','fall','fall_special','landing_soft','landing_hard','landing_special','wall_jump','ledge_jump_start','ledge_jump','footstool_jump']
rows=[];missing=[]
for sheet in sheets:
 if sheet not in frames:missing.append({'sheet':sheet,'reason':'No accepted packed sheet metadata'});continue
 clip=frames[sheet];binding=next((r for r in clock if r['sheet']==sheet),None)
 if binding is None:missing.append({'sheet':sheet,'reason':'No pinned source motion binding'});continue
 assert binding['nativeSampleIndices']==clip['nativeSampleIndices']
 motion=MOTIONS/(binding['sourceMotion']+'.nuanmb')
 if not motion.exists():missing.append({'sheet':sheet,'reason':'Pinned native motion unavailable','motion':str(motion)});continue
 pose=PikachuNativePose(motion)
 metaPath=ROOT/clip['packingMetadata'];assert sha(metaPath)==clip['packingMetadataSha256'];meta=json.loads(read(metaPath))
 atlas=ROOT/'assets/characters/pikachu'/clip['strip'];assert sha(atlas)==clip['sha256'];read(atlas);image=Image.open(atlas).convert('RGBA')
 table[sheet]={};drawingRows=[]
 gallery=Image.new('RGBA',(512*len(clip['nativeSampleIndices']),680),'#e4e3df')
 for index,sample in enumerate(clip['nativeSampleIndices']):
  try:matrices=pose.matrices(sample,['Trans','Have'])
  except Exception as error:
   missing.append({'sheet':sheet,'sample':sample,'reason':'Have/Trans extraction failed','detail':str(error)});continue
  trans=matrices['Trans'][:3,3];have=matrices['Have'][:3,3]-trans
  point={'x':float(have[2])*5,'y':25-float(have[1])*5};assert all(np.isfinite(v) for v in point.values())
  table[sheet][str(sample)]=point
  source=meta['sources'][index];assert source['nativeSample']==sample
  adaptation=source.get('authoredGeometryAdaptation',{}).get('kind');inBand=False;adapted=None
  if isinstance(adaptation,dict) and adaptation.get('kind')=='local undersideflex':
   artY=clip['root'][1]+(point['y']-25)/clip['scaleToWorld'];first,last=adaptation['originalArtBand'];targetFirst,targetLast=adaptation['targetArtBand']
   if artY>=first:
    inBand=True;adapted={'x':point['x'],'y':25+(targetFirst+(artY-first)*(targetLast-targetFirst)/(last-first)-clip['root'][1])*clip['scaleToWorld']}
  col,line=clip['sourceCells'][index];w,h=clip['frameWidth'],clip['frameHeight'];body=image.crop((col*w,line*h,(col+1)*w,(line+1)*h))
  panel=Image.new('RGBA',(512,640),'#e4e3df');panel.alpha_composite(body);draw=ImageDraw.Draw(panel);draw.line((0,clip['root'][1],512,clip['root'][1]),fill='red')
  x=clip['root'][0]+point['x']/clip['scaleToWorld'];y=clip['root'][1]+(point['y']-25)/clip['scaleToWorld'];draw.ellipse((x-3,y-3,x+3,y+3),fill='#de098b')
  if adapted:
   ax=clip['root'][0]+adapted['x']/clip['scaleToWorld'];ay=clip['root'][1]+(adapted['y']-25)/clip['scaleToWorld'];draw.ellipse((ax-4,ay-4,ax+4,ay+4),outline='#0873c8',width=2)
  gallery.alpha_composite(panel,(index*512,40));ImageDraw.Draw(gallery).text((index*512+8,8),sheet+' native'+str(sample)+' rawHave pink'+(' / authored-band blue' if adapted else ''),fill='black')
  drawingRows.append({'artFrameIndex':index,'nativeSample':sample,'sourceHaveBODYCENTRE':point,'capturedTransTranslation':trans.tolist(),'sourceHaveMatrix':matrices['Have'].tolist(),'sourceHaveInAuthoredBand':inBand,'authoredBandProjection':adapted,'boundedArtAdaptation':adaptation if inBand else None,'cellRGBAsha256':hashlib.sha256(body.tobytes()).hexdigest()})
 review=D/(sheet+'-source-have-review.png');gallery.save(review)
 rows.append({'sheet':sheet,'sourceMotion':pose.provenance(),'nativeSamples':clip['nativeSampleIndices'],'packedAtlas':str(atlas.relative_to(ROOT)),'packedAtlasSha256':sha(atlas),'packingMetadata':clip['packingMetadata'],'packingMetadataSha256':sha(metaPath),'drawings':drawingRows,'review':str(review.relative_to(ROOT)),'reviewSha256':sha(review)})
for key,value in original.items():assert table[key]==value
assert all(sha(p)==h for p,h in checkpoints.items()),'Live source changed during extraction; discard candidate and prepare again'
candidate=D/'pikachuItemAttachment.ts';newText=text[:start]+json.dumps(table,separators=(',',':'))+text[end:]
newText=newText.replace('Provenance: art/completion-states-items/source-cue-socket-plan.json.','Provenance: art/completion-states-items/source-cue-socket-plan.json and\n * staged-ordinary-sockets/source-have-projection.json. Ordinary points remain raw\n * native Have/Trans; bounded art-band socket adaptations are retained in evidence.');candidate.write_text(newText)
backup=D/(checkpoints[leaf]+'-original-pikachuItemAttachment.ts')
if not backup.exists():backup.write_bytes(leaf.read_bytes())
receipt={'state':'raw_source_have_contract_extracted_actual_saved_overlay_review_pending','rows':rows,'missing':missing,'originalItemSamplesExact':True,'socketSamples':sum(len(r['drawings']) for r in rows),'sourceClockContract':str(clockPath.relative_to(ROOT)),'sourceClockContractSha256':checkpoints[clockPath],
 'installFiles':[{'live':str(leaf.relative_to(ROOT)),'priorSha256':checkpoints[leaf],'priorBackup':str(backup.relative_to(ROOT)),'candidate':str(candidate.relative_to(ROOT)),'candidateSha256':sha(candidate)}],
 'limits':['Raw native Have minus Trans projected to BODYCENTRE at5px/native unit; face only in engine owner.','Source Have is an authored beta mouth attachment, native item node/orientation remains unresolved.','All original eighteen item cue/carry source points preserved exactly.','Source-derived underside-band adaptations are recorded separately; they are not silently applied to raw source table.','No new body alias or runtime selector; engine consumer and actual match qualification remain parent-owned.']}
(D/'source-have-projection.json').write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps({'ordinaryFamilies':len(rows),'ordinarySparseSockets':receipt['socketSamples'],'missing':missing,'sourceHaveInAuthoredBand':[(r['sheet'],d['nativeSample']) for r in rows for d in r['drawings'] if d['sourceHaveInAuthoredBand']],'candidateSha256':sha(candidate)}))
