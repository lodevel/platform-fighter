"""Restore local GPU corrections to fixed full-body coordinates; no acceptance."""
from pathlib import Path
from PIL import Image,ImageDraw
import numpy as np,json,hashlib
ROOT=Path(__file__).resolve().parent.parent;BASE=ROOT/'docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/art'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
prep=json.loads((BASE/'dk-firstcontact-pilot-correction-preparation.json').read_text())
generated=np.asarray(Image.open(BASE/'dk-firstcontact-pilot-attempt2.png').convert('RGB'));mask=np.asarray(Image.open(BASE/'dk-firstcontact-pilot-correction-render-mask.png').convert('L'))
if generated.shape[:2]!=(1024,1024):raise ValueError('Canvas drift')
ref=ROOT/prep['identity_reference']['file'];reference=np.asarray(Image.open(ref).convert('RGBA')).copy();v=reference[:,:,:3].astype(float);p=(v[:,:,2]>v[:,:,0]*.7)&(v[:,:,2]>v[:,:,1]*1.25)&(v[:,:,2]>115);reference[p,3]=0;r=Image.fromarray(reference);r=r.crop(r.getbbox());r=r.resize((round(r.width*104/r.height),104),Image.Resampling.LANCZOS)
rows=[]
for row in prep['records']:
 cell=row['cell'];key=row['key'];x=(cell%2)*512;y=(cell//2)*512
 full=np.asarray(Image.open(BASE/row['bodyFile']).convert('RGBA')).copy();original=full.copy();x0,y0,x1,y1=row['crop'];piece=full[y0:y1,x0:x1];m=mask[y:y+512,x:x+512]>0;opaque=piece[:,:,3]>=254;selected=m&opaque
 # SaveImage19 already composites the generated RGB exactly once through local mask.
 piece[selected,:3]=generated[y:y+512,x:x+512][selected]
 out=Image.fromarray(full);stem='firstcontact2-'+key;path=BASE/(stem+'-cutout.png');out.save(path)
 for mode,color in [('light',(247,246,238)),('dark',(25,30,39))]:
  bg=Image.new('RGB',(1536,1024),color);bg.paste(out,mask=out.getchannel('A'));bg.save(BASE/(stem+'-'+mode+'.png'))
 yy,xx=np.where(full[:,:,3]>=32);record={'key':key,'input':row['bodyFile'],'inputSha256':row['bodySha256'],'output':path.name,'outputSha256':sha(path),'crop':row['crop'],'changedRGBPixels':int(np.count_nonzero(np.any(full[:,:,:3]!=original[:,:,:3],2))),'alphaIdenticalToInput':bool(np.array_equal(full[:,:,3],original[:,:,3])),'root':[512,832],'scaleToWorld':5/26,'bodyCentreFromRootY':-42,'alpha32Bounds':[int(xx.min()),int(yy.min()),int(xx.max()),int(yy.max())],'floorPixelCentreWorldDelta':(int(yy.max())+.5-832)*5/26,'accepted':False,'runtime':'Actual full-size/light/dark/reference-world visual review and paired receiving pending; no shipping change'};rows.append(record)
 canvas=Image.new('RGBA',(780,330),(25,30,39,255));ImageDraw.Draw(canvas).line((0,230,780,230),fill=(95,113,140),width=1);canvas.alpha_composite(r,(110-r.width//2,230-r.height));view=out.resize((round(1536*5/26),round(1024*5/26)),Image.Resampling.LANCZOS)
 for cx,facing in [(330,1),(645,-1)]:
  im=view if facing==1 else view.transpose(Image.Transpose.FLIP_LEFT_RIGHT);rx=round(512*5/26) if facing==1 else im.width-round(512*5/26);canvas.alpha_composite(im,(cx-rx,230-round(832*5/26)))
 canvas.convert('RGB').save(BASE/(stem+'-reference-bothface-world.png'))
(BASE/'dk-firstcontact-pilot-attempt2.output-review-preparation.json').write_text(json.dumps({'state':'actual_output_visual_review_pending','records':rows,'scope':'Localized eye/tie/color RGB patches, fixed alpha/root/scale; not published'},indent=2)+'\n');print(json.dumps(rows))
