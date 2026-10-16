"""Prepare actual WaitItem/accepted-art/caps/socket comparisons, no acceptance.

Explicit permitted authored reuse requires an independent saved visual review;
no runtime alias, generic fallback or native bitmap equality is claimed.
"""
from pathlib import Path
import copy,hashlib,json,sys
import numpy as np
from PIL import Image,ImageDraw
ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT/'tools'))
from pikachu_native_pose import PikachuNativePose,MOTIONS
E=ROOT/'docs/review/2026-10-06/pikachu-character';B=E/'art/completion-states-items'
D=B/'carry-source-review';D.mkdir(exist_ok=True)
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
framesPath=ROOT/'assets/characters/pikachu/frames.json';frames=json.loads(framesPath.read_text())
clip=frames['animations']['idle'];atlas=ROOT/'assets/characters/pikachu'/clip['strip'];assert sha(atlas)==clip['sha256']
image=Image.open(atlas).convert('RGBA');packing=ROOT/clip['packingMetadata'];assert sha(packing)==clip['packingMetadataSha256'];meta=json.loads(packing.read_text())
source=E/'sources/item-native-review/preparation.json';nativeRows=[r for r in json.loads(source.read_text())['rows'] if r['sourceAction']=='wait_item']
assert [r['nativeSample'] for r in nativeRows]==clip['nativeSampleIndices']==[0,26,53,79,106]
caps=json.loads((E/'sources/native-hurtbox-capsules.json').read_text())['capsules']
pose=PikachuNativePose(MOTIONS/'a00waititem.nuanmb');rows=[]
for i,row in enumerate(nativeRows):
 guideMeta=ROOT/row['nativeGuideMetadata'];assert sha(guideMeta)==row['nativeGuideMetadataSha256'];guideData=json.loads(guideMeta.read_text())
 for f,h in guideData['output_files'].items():assert sha(E/'sources/item-native-review'/f)==h
 guidePath=E/'sources/item-native-review'/(row['key']+'-reference.png')
 nativeBody=Image.open(guidePath).convert('RGBA').resize((512,640),Image.Resampling.LANCZOS)
 col,line=clip['sourceCells'][i];w,h=clip['frameWidth'],clip['frameHeight'];body=image.crop((col*w,line*h,(col+1)*w,(line+1)*h))
 bounds=body.getchannel('A').point(lambda a:255 if a>=32 else 0).getbbox()
 assert bounds and bounds[3]-1<=416,'All five accepted idle cells must be floor corrected before explicit carry reuse'
 adaptation=meta['sources'][i]['authoredGeometryAdaptation']['kind']
 assert adaptation['kind']=='local undersideflex'
 matrices=pose.matrices(row['nativeSample'],list(dict.fromkeys(['Trans']+[c['bone']['label'] for c in caps])))
 trans=matrices['Trans'][:3,3];boxes=[];originalBoxes=[]
 for c in caps:
  m=matrices[c['bone']['label']];points=[]
  for endpoint in ['endpoint1','endpoint2']:
   p=(m@np.array([*c[endpoint],1]))[:3]-trans;points.append({'x':float(p[2])*5,'y':25-float(p[1])*5})
  a,b=points;r=float(c['size'])*float(np.linalg.norm(m[:3,:3],axis=0).max())*5
  region={'id':f'item_carry.{c["index"]}.{c["bone"]["label"]}','capsule':{'start':a,'end':b,'radius':r}}
  originalBoxes.append(copy.deepcopy(region))
  for p in points:
   y=416+(p['y']-25)/clip['scaleToWorld'];first,last=adaptation['originalArtBand'];start,end=adaptation['targetArtBand']
   if y>=first:p['y']=25+(start+(y-first)*(end-start)/(last-first)-416)*clip['scaleToWorld']
  region.update(offsetX=(a['x']+b['x'])/2,offsetY=(a['y']+b['y'])/2,width=abs(a['x']-b['x'])+2*r,height=abs(a['y']-b['y'])+2*r);boxes.append(region)
 socket=row['joints']['Have']['projectedBodyOffset']
 gallery=Image.new('RGBA',(1536,680),'#e4e3df')
 for j,im in enumerate([nativeBody,body,body]):
  panel=Image.new('RGBA',(512,640),'#e4e3df');panel.alpha_composite(im);draw=ImageDraw.Draw(panel);draw.line((0,416,512,416),fill='red')
  if j==2:
   for box in boxes:
    cap=box['capsule'];pts=[(256+p['x']/clip['scaleToWorld'],416+(p['y']-25)/clip['scaleToWorld']) for p in [cap['start'],cap['end']]];radius=cap['radius']/clip['scaleToWorld'];draw.line(pts,fill='#13798b',width=2)
    for x,y in pts:draw.ellipse((x-radius,y-radius,x+radius,y+radius),outline='#13798b',width=2)
   x=256+socket['x']/clip['scaleToWorld'];y=416+(socket['y']-25)/clip['scaleToWorld'];draw.ellipse((x-4,y-4,x+4,y+4),fill='#de098b')
  gallery.alpha_composite(panel,(j*512,40));ImageDraw.Draw(gallery).text((j*512+8,8),'WaitItem native'+str(row['nativeSample'])+' '+['native guide','accepted authored art','source12caps + Have'][j],fill='black')
 review=D/('native'+str(row['nativeSample'])+'-paired-review.png');gallery.save(review)
 rows.append({'nativeSample':row['nativeSample'],'sourceIdleArtFrameIndex':i,'sourceIdleCellSha256':hashlib.sha256(body.tobytes()).hexdigest(),'sourceIdleAlpha32Bounds':bounds,'nativeGuide':str(guidePath.relative_to(ROOT)),'nativeGuideSha256':sha(guidePath),'review':str(review.relative_to(ROOT)),'reviewSha256':sha(review),'sourceHurtboxes':originalBoxes,'hurtboxes':boxes,'sourceHaveBODYCENTRE':socket,'authoredGeometryAdaptation':adaptation,'sourceDeclaration':row['motionDeclaration']})
assert sha(atlas)==clip['sha256'] and sha(packing)==clip['packingMetadataSha256'],'Idle changed during inspection preparation'
(D/'preparation.json').write_text(json.dumps({'state':'source_carry_reuse_paired_visual_review_pending','idleAtlas':str(atlas.relative_to(ROOT)),'idleAtlasSha256':sha(atlas),'idlePackingMetadata':str(packing.relative_to(ROOT)),'idlePackingMetadataSha256':sha(packing),'sourcePreparationSha256':sha(source),'sourceMotion':pose.provenance(),'rows':rows,'limits':['Explicit authored reuse of source-near-identical idle art; not a generic runtime alias or native bitmap parity.','Genuine WaitItem source twelve receiving regions and source Have are recomputed for every sparse sample.','Native loop106 excludes endpoint106; endpoint remains source-only in pack.','Source Have is authored beta mouth socket; item node/orientation remains unresolved.','Actual running-match acceptance pending.']},indent=2)+'\n')
print(json.dumps({'actualPairedReviewFiles':5,'nativeReceivingRegions':60,'review':str(D)}))
