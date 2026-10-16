"""Prepare saved actual output galleries and mechanical checks; no acceptance."""
from pathlib import Path
import json,sys,hashlib
import numpy as np
from PIL import Image,ImageDraw
ROOT=Path(__file__).resolve().parent.parent;B=ROOT/'docs/review/2026-10-06/pikachu-character/art/completion-states-throw-floor';key=sys.argv[1]
p=next(r for r in json.loads((B/'full-pilot-preparation.json').read_text())['records'] if r['key']==key);r=next(r for r in reversed(json.loads((B/'full-generation-ledger.json').read_text())) if r['pose_key']==key and r['state'] in ('succeeded','accepted'))
if r['attempt']>1:p=p['attempts'][str(r['attempt'])]
assert r['state'] in ('succeeded','accepted');sha=lambda x:hashlib.sha256(x.read_bytes()).hexdigest();atlas=B/r['outputs']['cutout']['file'];assert sha(atlas)==r['outputs']['cutout']['sha256'];cutout=Image.open(atlas).convert('RGBA');final=Image.open(B/r['outputs']['9']['file']).convert('RGB');seed=Image.open(B/p.get('input_files',{}).get('seed',key+'-seed.png')).convert('RGB');mask=Image.open(B/p.get('input_files',{}).get('render-mask',key+'-render-mask.png')).convert('RGB');a=np.asarray(mask)[:,:,0];outside=a==0;changes=int(np.count_nonzero(np.any(np.asarray(seed)[outside]!=np.asarray(final)[outside],axis=1)));assert changes==0
checks={'key':key,'unmaskedChanges':changes,'cells':[]};gallery=Image.new('RGBA',(512*len(p['cells']),640),'#e4e3df')
for j,c in enumerate(p['cells']):
 x,y=c['offset'];im=cutout.crop((x,y,x+1024,y+1280)).resize((512,640),Image.Resampling.LANCZOS);im.save(B/(key+f'-cell{j}.png'));bounds=im.getchannel('A').point(lambda a:255 if a>=32 else 0).getbbox();checks['cells'].append({'sheet':c['sheet'],'frame':c['artFrameIndex'],'bounds':bounds,'floorWorldPx':(bounds[3]-.5-416)*70/150});assert bounds[3]-1<=416;panel=Image.new('RGBA',im.size,'#e4e3df');panel.alpha_composite(im);ImageDraw.Draw(panel).line((0,416,512,416),fill='red');ImageDraw.Draw(panel).text((8,15),c['sheet']+'/'+str(c['artFrameIndex']),fill='black');gallery.alpha_composite(panel,(j*512,0))
 frames=json.loads((ROOT/'assets/characters/pikachu/frames.json').read_text())['animations'][c['sheet']];w,h=frames['frameWidth'],frames['frameHeight'];col,row=frames['sourceCells'][c['artFrameIndex']];source=ROOT/c['source'];old=Image.open(source).convert('RGBA').crop((col*w,row*h,(col+1)*w,(row+1)*h))
 expected=c.get('sourceCellRgbaSha256',c.get('sourceCellPixelSha256'))
 assert (expected and hashlib.sha256(old.tobytes()).hexdigest()==expected) or (not expected and sha(source)==c['sourceSha256']), 'Affected source cell changed'
 if c.get('acceptedIdentityBaseline'):
  baseline=c['acceptedIdentityBaseline'];baselinePath=ROOT/baseline['atlas'];assert sha(baselinePath)==baseline['atlasSha256'];assert sha(ROOT/baseline['receipt'])==baseline['receiptSha256'];old=Image.open(baselinePath).convert('RGBA').crop((col*w,row*h,(col+1)*w,(row+1)*h))
 sourceLabel='accepted source baseline' if c.get('acceptedIdentityBaseline') else 'source'
 comparison=Image.new('RGBA',(2048,h+40),'#17253a')
 for k,(body,bg,label) in enumerate([(old,'#f7f5ef',sourceLabel),(im.crop((0,0,w,h)),'#f7f5ef','generated'),(old,'#17253a',sourceLabel),(im.crop((0,0,w,h)),'#17253a','generated')]):
  canvas=Image.new('RGBA',body.size,bg);canvas.alpha_composite(body);ImageDraw.Draw(canvas).line((0,c.get('root',[256,416])[1],w,c.get('root',[256,416])[1]),fill='red');comparison.alpha_composite(canvas,(k*512,40));ImageDraw.Draw(comparison).text((k*512+8,8),c['sheet']+'/'+str(c['artFrameIndex'])+' '+label,fill='white')
 comparison.save(B/(key+f'-attempt{r["attempt"]}-cell{j}-light-dark-review.png'))
 first=c['adaptation']['originalArtBand'][0];root=c.get('root',[256,416])[1]
 zoom=comparison.crop((0,40+first-4,2048,40+root+8)).resize((4096,2*(root-first+12)),Image.Resampling.NEAREST)
 zoom.save(B/(key+f'-attempt{r["attempt"]}-cell{j}-underside-zoom.png'))
gallery.save(B/(key+'-actual-output-review.png'));(B/(key+'-mechanical-checks.json')).write_text(json.dumps(checks,indent=2)+'\n');print(json.dumps(checks))
