from pathlib import Path
import json,hashlib
import numpy as np
from PIL import Image,ImageDraw
from scipy.ndimage import distance_transform_edt
R=Path(__file__).resolve().parents[1];A=R/'docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/art';F='dk-fullgrab-standing-remaining04-attempt1'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def pin(p):return {'path':str(p.relative_to(R)),'sha256':sha(p)}
p=A/(F+'-clean3-review.json');receipt=A/(F+'-clean4-review.json')
if receipt.exists():raise ValueError('Preserve derivative')
d=json.loads(p.read_text());rows=[]
for r in d['rows']:
 src=R/r['target']['path'];old=np.asarray(Image.open(src).convert('RGBA'));out=old.copy();rgb=out[:,:,:3];domain=np.zeros(old.shape[:2],bool);alphaDomain=np.zeros(old.shape[:2],bool)
 if r['nativeSample']==24:
  m=Image.new('L',(1536,1024));ImageDraw.Draw(m).polygon([[738,463],[748,470],[764,489],[772,499],[776,528],[738,528]],fill=255);domain=np.asarray(m)>0
  change=domain&(old[:,:,3]>0)
  # Same local source-adapted fur palette as the adjoining face/forearm,
  # extending through the actually reviewed bridge shape, not a rectangle.
  rgb[change]=[177,24,3]
 else:change=domain.copy()
 alphaChange=alphaDomain.copy()
 assert np.array_equal(out[:,:,3],old[:,:,3]);assert np.array_equal(out[~change],old[~change]);
 stem=F+f'-fullgrab01-grab-native{r["nativeSample"]}-clean4';im=Image.fromarray(out);target=A/(stem+'-cutout.png');im.save(target);q=A/(stem+'-quarter.png');im.resize((384,256),Image.Resampling.LANCZOS).save(q);m=A/(stem+'-observed-rgb-speck-domain.png');Image.fromarray(change.astype('uint8')*255).save(m)
 for mode,col in [('dark',(25,30,39)),('light',(247,246,238))]:
  b=Image.new('RGBA',im.size,col+(255,));b.alpha_composite(im);b.convert('RGB').save(A/(stem+'-'+mode+'.png'))
 world=Image.new('RGBA',(1000,330),(25,30,39,255));ImageDraw.Draw(world).line((0,230,1000,230),fill=(95,113,140));ref=Image.open(A/'dk-grabpilot-batch01-attempt1-grab-native8-clean3-cutout.png').convert('RGBA')
 for cx,b,rx in [(130,ref,512),(440,im,512),(780,im.transpose(Image.Transpose.FLIP_LEFT_RIGHT),1024)]:world.alpha_composite(b.resize((295,197),Image.Resampling.LANCZOS),(cx-round(rx*5/26),230-round(832*5/26)))
 world.convert('RGB').save(A/(stem+'-reference-bothface-world.png'));rows.append({**r,'target':pin(target),'quarterTarget':pin(q),'observedRGBSpeckRepair':{'parent':pin(src),'domain':pin(m),'changedPixels':int(change.sum()),'alphaChangedPixels':int(alphaChange.sum()),'allAlphaAndOutsideDomainRGBAUnchanged':True},'actualVisualReview':'pending'})
d.update({'rows':rows,'parentCleanup':pin(p),'state':'OBSERVED_FACE_BRIDGE_RGB_EAR_CREST_MATERIAL_DERIVATIVES_PENDING_VISUAL_REVIEW'});receipt.write_text(json.dumps(d,indent=2)+'\n');print(pin(receipt))
