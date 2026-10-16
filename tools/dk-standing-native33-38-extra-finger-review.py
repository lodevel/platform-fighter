"""Independent actual-target finger interiors/gaps; preserves original fit misses."""
from pathlib import Path
import json,hashlib,math
from PIL import Image,ImageDraw
import numpy as np
from scipy.ndimage import distance_transform_edt
R=Path(__file__).resolve().parents[1];D=R/'.tmp/dk-grab-receiving-preparation';rows=json.loads((D/'remaining-nine-fit-execution-09.json').read_text())['rows'];result=[]
def pin(p):return {'path':str(p.relative_to(R)),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
def inset(p,b):
 k=b['capsule'];a=k['start'];z=k['end'];v=(z['x']-a['x'],z['y']-a['y']);t=max(0,min(1,((p[0]-a['x'])*v[0]+(p[1]-a['y'])*v[1])/max(1e-12,v[0]*v[0]+v[1]*v[1])));return k['radius']-math.hypot(p[0]-a['x']-t*v[0],p[1]-a['y']-t*v[1])
for n,skin,gaps in [(33,[(209,105),(228,112),(230,123),(225,140),(220,142)],[(228,136),(235,128)]),(38,[(200,115),(222,114),(229,126),(225,136),(219,144)],[(229,119),(232,140)])]:
 r=next(r for r in rows if r['clip']=='grab' and r['nativeSample']==n);op=R/r['ownership']['path'];o=json.loads(op.read_text());cp=R/r['candidate']['path'];c=json.loads(cp.read_text());im=Image.open(R/o['targetImage']).convert('RGBA');l=Image.open(R/o['labelImage']);edt=distance_transform_edt(np.asarray(im)[:,:,3]>=32);boxes=c['hurtboxPoses'][0]['hurtboxes'];ps=[]
 for kind,points in [('skin',skin),('gap',gaps)]:
  for i,(x,y) in enumerate(points):
   rgba=im.getpixel((x,y));label=l.getpixel((x,y));assert label==6 and rgba[3]>=192 if kind=='skin' else label==0 and rgba[3]==0
   p=((x+.5-128)*5/6.5,42+(y+.5-208)*5/6.5);own=max(inset(p,b) for b in boxes if b['region']=='handl');allmax=max(inset(p,b) for b in boxes);ok=own>=.15 if kind=='skin' else allmax<=-.15;ps.append({'id':f'native{n}-visible-branch-{kind}-{i+1}','kind':kind,'region':'handl','quarterPixel':[x,y],'actualTargetRGBA':list(rgba),'actualOwnershipLabel':label,'actorRelativeWorldPoint':{'x':p[0],'y':p[1]},'probeRadiusWorld':.15,'actualAlphaInteriorDistanceWorld':float(edt[y,x]*5/6.5),'ownRegionMaximumInsetWorld':own,'allPrimitiveMaximumInsetWorld':allmax,'analyticalPass':ok,'selection':'Own visibly exposed actual finger interior or fully transparent adjacent gap; independently selected from actual target/label before fit inset comparison.'})
 bg=Image.new('RGBA',im.size,(25,30,39,255));bg.alpha_composite(im);dr=ImageDraw.Draw(bg)
 for p in ps:
  x,y=p['quarterPixel'];color=(0,255,90) if p['kind']=='skin' and p['analyticalPass'] else (255,30,30) if p['kind']=='skin' else (255,30,230);dr.ellipse((x-1,y-1,x+1,y+1),fill=color)
 vp=D/f'native{n}-extra-own-finger-probes.png';assert not vp.exists();bg.convert('RGB').save(vp);world=Image.new('RGBA',(650,300),(25,30,39,255));dr=ImageDraw.Draw(world);dr.line((0,230,650,230),fill=(95,113,140))
 for cx,b,rx in [(170,bg,128),(490,bg.transpose(Image.Transpose.FLIP_LEFT_RIGHT),256)]:world.alpha_composite(b.resize((295,197),Image.Resampling.LANCZOS),(cx-round(rx*5/6.5),230-round(208*5/6.5)))
 wp=D/f'native{n}-extra-own-finger-probes-bothface-world.png';world.convert('RGB').save(wp);result.append({'nativeSample':n,'ownershipProposal':pin(op),'candidate':pin(cp),'probes':ps,'actualViews':[pin(vp),pin(wp)],'allSkinPass':all(p['analyticalPass'] for p in ps if p['kind']=='skin'),'allGapPass':all(p['analyticalPass'] for p in ps if p['kind']=='gap'),'actualVisualReview':'pending','realMatterContactVerified':False})
p=D/'native33-38-extra-own-finger-probe-review.json';assert not p.exists();p.write_text(json.dumps({'state':'INDEPENDENT_EXTRA_EXPOSED_FINGER_PROBES_NATIVE33_MISSES_PRESERVED','rows':result,'canonicalChanged':False,'tool':pin(Path(__file__))},indent=2)+'\n');print(pin(p))
