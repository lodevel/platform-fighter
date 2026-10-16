from pathlib import Path
import json,hashlib
import numpy as np
from PIL import Image,ImageDraw
from scipy.ndimage import distance_transform_edt
R=Path(__file__).resolve().parents[1];A=R/'docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/art';F='dk-fullgrab-standing-remaining04-attempt1'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def pin(p):return {'path':str(p.relative_to(R)),'sha256':sha(p)}
p=A/(F+'-clean2-review.json');receipt=A/(F+'-clean3-review.json')
if receipt.exists():raise ValueError('Preserve derivative')
d=json.loads(p.read_text());rows=[]
for r in d['rows']:
 src=R/r['target']['path'];old=np.asarray(Image.open(src).convert('RGBA'));out=old.copy();rgb=out[:,:,:3];domain=np.zeros(old.shape[:2],bool);alphaDomain=np.zeros(old.shape[:2],bool)
 if r['nativeSample']==24:
  domain[475:513,744:765]=True
  change=domain&(old[:,:,3]>0)
  rgb[change]=[190,22,5]
  alphaDomain[450:502,554:646]=True
 else:
  change=domain.copy();alphaDomain[236:282,558:634]=True
 from scipy.ndimage import binary_erosion
 alphaChange=alphaDomain&binary_erosion(old[:,:,3]>=32,iterations=2)&(old[:,:,3]>=32)&(old[:,:,3]<255)
 out[:,:,3][alphaChange]=255
 assert np.array_equal(out[:,:,3]>=32,old[:,:,3]>=32);assert np.array_equal(out[:,:,3]==0,old[:,:,3]==0);assert np.array_equal(out[~(change|alphaChange)],old[~(change|alphaChange)]);
 stem=F+f'-fullgrab01-grab-native{r["nativeSample"]}-clean3';im=Image.fromarray(out);target=A/(stem+'-cutout.png');im.save(target);q=A/(stem+'-quarter.png');im.resize((384,256),Image.Resampling.LANCZOS).save(q);m=A/(stem+'-observed-rgb-speck-domain.png');Image.fromarray(change.astype('uint8')*255).save(m)
 for mode,col in [('dark',(25,30,39)),('light',(247,246,238))]:
  b=Image.new('RGBA',im.size,col+(255,));b.alpha_composite(im);b.convert('RGB').save(A/(stem+'-'+mode+'.png'))
 world=Image.new('RGBA',(1000,330),(25,30,39,255));ImageDraw.Draw(world).line((0,230,1000,230),fill=(95,113,140));ref=Image.open(A/'dk-grabpilot-batch01-attempt1-grab-native8-clean3-cutout.png').convert('RGBA')
 for cx,b,rx in [(130,ref,512),(440,im,512),(780,im.transpose(Image.Transpose.FLIP_LEFT_RIGHT),1024)]:world.alpha_composite(b.resize((295,197),Image.Resampling.LANCZOS),(cx-round(rx*5/26),230-round(832*5/26)))
 world.convert('RGB').save(A/(stem+'-reference-bothface-world.png'));rows.append({**r,'target':pin(target),'quarterTarget':pin(q),'observedRGBSpeckRepair':{'parent':pin(src),'domain':pin(m),'changedPixels':int(change.sum()),'alphaChangedPixels':int(alphaChange.sum()),'alpha32AndAlphaZeroSpacesAndOutsideDomainRGBAUnchanged':True},'actualVisualReview':'pending'})
d.update({'rows':rows,'parentCleanup':pin(p),'state':'OBSERVED_FACE_BRIDGE_RGB_EAR_CREST_MATERIAL_DERIVATIVES_PENDING_VISUAL_REVIEW'});receipt.write_text(json.dumps(d,indent=2)+'\n');print(pin(receipt))
