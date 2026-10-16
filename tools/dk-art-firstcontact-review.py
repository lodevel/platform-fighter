"""Inspectable first-contact pilot outputs; does not accept, pack or change alpha."""
from PIL import Image,ImageDraw
from pathlib import Path
import numpy as np,json,hashlib
BASE=Path(__file__).resolve().parent.parent/'docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/art'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
attempt=1;job='dk-firstcontact-pilot-attempt'+str(attempt)
im=Image.open(BASE/(job+'-cutout.png')).convert('RGBA');W,H=1536,1024
if im.size!=(3072,2048):raise ValueError('Canvas drift')
records=[]
for cell,key,native,age in [(1,'jab1',5,4),(2,'jab2',4,3),(3,'dtilt',6,5)]:
 x=(cell%2)*W;y=(cell//2)*H;body=im.crop((x,y,x+W,y+H));stem=f'firstcontact{attempt}-{key}-native{native}'
 body.save(BASE/(stem+'-cutout.png'));a=np.asarray(body);ys,xs=np.where(a[:,:,3]>=32)
 for mode,color in [('light',(247,246,238)),('dark',(25,30,39))]:
  out=Image.new('RGB',(W,H),color);out.paste(body,mask=body.getchannel('A'));out.save(BASE/(stem+'-'+mode+'.png'))
 world=Image.new('RGBA',(650,300),(25,30,39,255));draw=ImageDraw.Draw(world);draw.line((0,200,650,200),fill=(95,113,140),width=1)
 scale=5/26;preview=body.resize((round(W*scale),round(H*scale)),Image.Resampling.LANCZOS)
 for root_x,facing in [(140,1),(480,-1)]:
  viewed=preview if facing==1 else preview.transpose(Image.Transpose.FLIP_LEFT_RIGHT);rx=round(512*scale) if facing==1 else viewed.width-round(512*scale)
  world.alpha_composite(viewed,(root_x-rx,200-round(832*scale)))
 world.convert('RGB').save(BASE/(stem+'-bothface-world.png'))
 last=int(ys.max());records.append({'key':key,'nativeSample':native,'gameAge':age,'files':{s:{'file':stem+s+'.png','sha256':sha(BASE/(stem+s+'.png'))} for s in ['-cutout','-light','-dark','-bothface-world']},'alpha32Bounds':[int(xs.min()),int(ys.min()),int(xs.max()),last],'floorPixelCentreWorldDelta':(last+.5-832)*scale,'floorToleranceWorld':.55,'root':[512,832],'scaleToWorld':scale,'bodyCentreFromRootY':-42,'runtime':'Art-only diagnostic, not Phaser/Matter proof; paired receiving and identity pending'})
(BASE/(job+'.output-review-preparation.json')).write_text(json.dumps({'state':'actual_output_visual_review_pending','records':records},indent=2)+'\n')
print(json.dumps(records))
