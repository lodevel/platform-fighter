"""Scoped local output checks; no global floor gate for valid hanging tail."""
from pathlib import Path
import hashlib,json,sys
import numpy as np
from PIL import Image,ImageDraw
ROOT=Path(__file__).resolve().parent.parent;B=ROOT/'docs/review/2026-10-06/pikachu-character/art/completion-states-local-floor'
key=sys.argv[1];sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
prep=next(r for r in json.loads((B/'full-pilot-preparation.json').read_text())['records'] if r['key']==key)
out=next(r for r in reversed(json.loads((B/'full-generation-ledger.json').read_text())) if r['pose_key']==key and r['state'] in ['succeeded','accepted'])
atlas=B/out['outputs']['cutout']['file'];assert sha(atlas)==out['outputs']['cutout']['sha256']
image=Image.open(atlas).convert('RGBA');seed=Image.open(B/(key+'-seed.png')).convert('RGB');final=Image.open(B/out['outputs']['9']['file']).convert('RGB');mask=Image.open(B/(key+'-render-mask.png')).convert('RGB');outside=np.asarray(mask)[:,:,0]==0
assert np.array_equal(np.asarray(seed)[outside],np.asarray(final)[outside])
checks=[];review=Image.new('RGBA',(1024*len(prep['cells']),640),'#e4e3df')
for i,c in enumerate(prep['cells']):
 bounds=c['offset'];x,y=bounds[:2];box=tuple(bounds) if len(bounds)==4 else (x,y,x+1024,y+1280);assert box[2]-box[0]==1024 and box[3]-box[1]==1280;new=image.crop(box).resize((512,640),Image.Resampling.LANCZOS)
 source=ROOT/c['source'];assert sha(source)==c['sourceSha256']
 frames=json.loads((ROOT/'assets/characters/pikachu/frames.json').read_text())['animations'][c['sheet']];w,h=frames['frameWidth'],frames['frameHeight'];col,row=frames['sourceCells'][c['artFrameIndex']]
 old=Image.open(source).convert('RGBA').crop((col*w,row*h,(col+1)*w,(row+1)*h));candidate=old.copy();left,top,right,bottom=c['authorizedRectangle'];candidate.paste(new.crop((left,top,right,bottom)),(left,top))
 valid=np.zeros((h,w),dtype=bool);valid[top:bottom,left:right]=True;assert np.array_equal(np.asarray(candidate)[~valid],np.asarray(old)[~valid]);alpha=np.asarray(candidate.getchannel('A'))
 assert not np.any(alpha[417:bottom,left:right]>=32),'New paw still violates supported pixel-center tolerance'
 candidate.save(B/(key+f'-packed-cell{i}.png'))
 for j,body in enumerate([old,candidate]):
  panel=Image.new('RGBA',(512,640),'#e4e3df');panel.alpha_composite(body);draw=ImageDraw.Draw(panel);draw.line((0,416,512,416),fill='red');review.alpha_composite(panel,((i*2+j)*512,0));ImageDraw.Draw(review).text(((i*2+j)*512+8,15),c['sheet']+' native'+str(c['nativeSample'])+' '+['original','tiny underside correction'][j],fill='black')
 checks.append({'sheet':c['sheet'],'artFrameIndex':c['artFrameIndex'],'protectedPixelChanges':0,'authorizedChangedPixels':int(np.count_nonzero(np.any(np.asarray(old)!=np.asarray(candidate),axis=2))),'originalRGBAsha256':hashlib.sha256(old.tobytes()).hexdigest(),'candidateRGBAsha256':hashlib.sha256(candidate.tobytes()).hexdigest(),'receivingChanged':False,'validHangingTailExact':bool(c.get('preserveValidHangingTail'))})
review.save(B/(key+'-actual-output-review.png'));(B/(key+'-mechanical-checks.json')).write_text(json.dumps({'key':key,'unmaskedGeneratedChanges':0,'checks':checks},indent=2)+'\n');print(json.dumps(checks))
