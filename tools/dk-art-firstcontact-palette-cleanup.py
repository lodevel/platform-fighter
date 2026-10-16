"""Color-only DK pilot cleanup, with source garment mask as an authored shape guide.

No native RGB, shader textures or full source render becomes delivered artwork.
All original generated images remain unchanged. Outputs remain review candidates.
"""
from pathlib import Path
from PIL import Image,ImageFilter,ImageDraw
import numpy as np,json,hashlib
ROOT=Path(__file__).resolve().parent.parent;BASE=ROOT/'docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/art'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
def region(shape,box):
 m=np.zeros(shape,bool);x0,y0,x1,y1=box;m[y0:y1,x0:x1]=True;return m
def fill(arr,box,bad,valid):
 x0,y0,x1,y1=box;rgb=arr[y0:y1,x0:x1,:3].astype(float);todo=bad[y0:y1,x0:x1].copy();known=valid[y0:y1,x0:x1].copy()&~todo;initial=todo.copy()
 for _ in range(120):
  if not todo.any():break
  count=np.zeros(todo.shape);total=np.zeros(rgb.shape)
  for dy,dx in [(-1,0),(1,0),(0,-1),(0,1),(-1,-1),(-1,1),(1,-1),(1,1)]:
   shifted=np.roll(known,(dy,dx),(0,1));values=np.roll(rgb,(dy,dx),(0,1));
   if dy<0:shifted[-1,:]=False
   if dy>0:shifted[0,:]=False
   if dx<0:shifted[:,-1]=False
   if dx>0:shifted[:,0]=False
   count+=shifted;total+=values*shifted[:,:,None]
  ready=todo&(count>0)
  if not ready.any():break
  rgb[ready]=total[ready]/count[ready,None];known[ready]=True;todo[ready]=False
 if todo.any():raise ValueError('Unable to fill selected local palette defect')
 target=arr[y0:y1,x0:x1,:3];target[initial]=np.rint(rgb[initial]).astype(np.uint8)
def polygon_mask(points):
 m=Image.new('L',(1536,1024));ImageDraw.Draw(m).polygon(points,fill=255);return np.asarray(m)>0
records=[]
for key in ['jab1-native5','jab2-native4','dtilt-native6']:
 source=BASE/('firstcontact2-'+key+'-cutout.png');orig=np.asarray(Image.open(source).convert('RGBA'));a=orig.copy();changes=[]
 if key=='jab1-native5':
  r,g,b=a[:,:,:3].transpose(2,0,1).astype(float);roi=region(r.shape,(440,672,520,720));bad=roi&(r<100)&(g<80)&(b<80)&(a[:,:,3]>0);a[bad,:3]=[153,20,8];changes.append({'operation':'Opaque black hip/crotch ink recolored deep source-target red body shade','pixels':int(bad.sum())})
  brow=polygon_mask([(580,452),(629,467),(691,482),(691,499),(631,485),(579,465)]);cream=(r>230)&(g>160)&(g<235)&(b<220);chosen=brow&cream;a[chosen,:3]=[251,250,238];changes.append({'operation':'Actual generated cream brow rim recolored selected identity white, no change in eye placement or contour','pixels':int(chosen.sum())})
  garment=Image.open(BASE/'garment-jab1-native5-mask.png').convert('L');gm=np.asarray(garment)>0
  # Target facial/mouth coloration determines occlusion after source-pose garment guide.
  color=a[:,:,:3].astype(float);red=(color[:,:,0]>color[:,:,1]*1.8)&(color[:,:,2]<color[:,:,0]*.4)&(color[:,:,1]<95);visible=gm&red&(a[:,:,3]>0)
  interior=np.asarray(Image.fromarray((visible*255).astype('uint8')).filter(ImageFilter.MinFilter(3)))>0
  a[visible,:3]=[168,16,3];a[interior,:3]=[232,13,0]
  # Two smoothly curved cel tones, authored from selected target tie palette rather than mesh facets.
  contour=[(499+29*t,677+19*t*t) for t in np.linspace(0,1,12)]+[(528+60*t,696+14*np.sin(t*np.pi/2)) for t in np.linspace(0,1,18)]+[(588+72*t,710-22*t*t) for t in np.linspace(0,1,18)]+[(654,711),(631,725),(596,739),(558,735),(532,720),(508,700)]
  shade=polygon_mask(contour)&interior;a[shade,:3]=[205,11,0]
  changes.append({'operation':'Target-authored visible red necktie cloth with deep-red contour from source garment coverage clipped by actual generated face/skin occlusion; no native RGB used','pixels':int(visible.sum()),'celShadePixels':int(shade.sum()),'selectedReferenceTieRGB':[232,13,0],'sourceMask':'garment-jab1-native5-mask.png','nativeVisibility':json.loads((BASE/'garment-jab1-native5.json').read_text())['visibleTieBounds']})
 elif key=='jab2-native4':
  r,g,b=a[:,:,:3].transpose(2,0,1).astype(float);valid=(r>110)&(r>g*2)&(b<35)&(g<45)&(a[:,:,3]>0)
  for box in [(435,420,495,463),(530,461,595,510)]:
   initial=region(r.shape,box)&(g>40)&(b>r*.18)&(a[:,:,3]>0);bad=(np.asarray(Image.fromarray(initial.astype('uint8')*255).filter(ImageFilter.MaxFilter(5)))>0)&region(r.shape,box)&(a[:,:,3]>0);fill(a,box,bad,valid);changes.append({'operation':'Residual pale flank streak interpolated from retained local red fur colors','pixels':int(bad.sum()),'box':box})
 else:
  # Restore the original palm color field; remove only the red wedge rather than painting an entire rectangle.
  hand=np.asarray(Image.open(BASE/'firstcontact1-dtilt-native6-cutout.png').convert('RGBA'));box=(1068,708,1118,780);x0,y0,x1,y1=box;a[y0:y1,x0:x1,:3]=hand[y0:y1,x0:x1,:3];r,g,b=a[:,:,:3].transpose(2,0,1).astype(float);yy,xx=np.indices(r.shape);bad=(((xx-1091)/28)**2+((yy-744)/34)**2<=1)&region(r.shape,box)&(a[:,:,3]>0);valid=(r>240)&(g>200)&(b>135)&(a[:,:,3]>0);fill(a,box,bad,valid);changes.append({'operation':'Original palm gradient restored, red wedge/outline locally interpolated from retained cream surface; rectangular composite removed','pixels':int(bad.sum())})
  box=(816,712,840,744);bad=region(r.shape,box)&((g>55)|(b>35))&(a[:,:,3]>0);redvalid=(r>100)&(r>g*2)&(g<45)&(b<35)&(a[:,:,3]>0);fill(a,box,bad,redvalid);changes.append({'operation':'Stray cream fragment on red forearm interpolated from surrounding retained red','pixels':int(bad.sum()),'box':box})
  brow=polygon_mask([(690,648),(721,648),(773,660),(772,674),(731,661),(692,661)]);cream=(r>230)&(g>160)&(g<235)&(b<220);chosen=brow&cream;a[chosen,:3]=[251,250,238];changes.append({'operation':'Actual cream brow rim recolored identity white; generated sclera/pupil/nose placement unchanged','pixels':int(chosen.sum())})
 # Remove chroma residue only where adjacent to genuine alpha background; interior valid body never keyed by palette alone.
 r,g,b=a[:,:,:3].transpose(2,0,1).astype(float);pink=(b>g*1.10)&(b>r*.32)&(b>45)&(a[:,:,3]>0);background=np.asarray(Image.fromarray((a[:,:,3]==0).astype('uint8')*255).filter(ImageFilter.MaxFilter(7)))>0;edge=pink&background;a[edge,3]=0;changes.append({'operation':'Boundary-only magenta residue removed within3px of existing transparent background, no broad body palette key','pixels':int(edge.sum())})
 out=Image.fromarray(a);ys,xs=np.where(a[:,:,3]>=32);last=int(ys.max());floor=None
 if abs((last+.5-832)*5/26)>.55:
  start=760;target=830;im=Image.new('RGBA',out.size,(204,73,140,0));im.paste(out.crop((0,0,1536,start)),(0,0));im.paste(out.crop((0,start,1536,last+1)).resize((1536,target-start+1),Image.Resampling.BICUBIC),(0,start));out=im;a=np.asarray(out);ys,xs=np.where(a[:,:,3]>=32);floor={'startPixelY':start,'inputLastPixelY':last,'targetLastPixelY':target,'inclusiveRowsRatio':(target-start+1)/(last-start+1)}
 stem='firstcontact-clean3-'+key;path=BASE/(stem+'-cutout.png');out.save(path)
 for mode,c in [('light',(247,246,238)),('dark',(25,30,39))]:
  im=Image.new('RGB',out.size,c);im.paste(out,mask=out.getchannel('A'));im.save(BASE/(stem+'-'+mode+'.png'))
 records.append({'key':key,'input':source.name,'inputSha256':sha(source),'output':path.name,'outputSha256':sha(path),'operations':changes,'floorWarp':floor,'alphaChangedPixels':int(np.count_nonzero(a[:,:,3]!=orig[:,:,3])),'root':[512,832],'scaleToWorld':5/26,'bodyCentreFromRootY':-42,'alpha32LastPixelY':int(ys.max()),'floorPixelCentreWorldDelta':(int(ys.max())+.5-832)*5/26,'accepted':False,'nativeRGBDelivery':False})
 # At-game-scale reference + both facing comparisons.
 canvas=Image.new('RGBA',(780,330),(25,30,39,255));ImageDraw.Draw(canvas).line((0,230,780,230),fill=(95,113,140),width=1);ref=np.asarray(Image.open(ROOT/'docs/review/2026-09-25/donkeykong-character/art/idle-keyframe.png').convert('RGBA')).copy();v=ref[:,:,:3].astype(float);bg=(v[:,:,2]>v[:,:,0]*.7)&(v[:,:,2]>v[:,:,1]*1.25)&(v[:,:,2]>115);ref[bg,3]=0;ref=Image.fromarray(ref);ref=ref.crop(ref.getbbox());ref=ref.resize((round(ref.width*104/ref.height),104),Image.Resampling.LANCZOS);canvas.alpha_composite(ref,(110-ref.width//2,230-ref.height));view=out.resize((round(1536*5/26),round(1024*5/26)),Image.Resampling.LANCZOS)
 for cx,facing in [(330,1),(645,-1)]:
  v=view if facing==1 else view.transpose(Image.Transpose.FLIP_LEFT_RIGHT);rx=round(512*5/26)if facing==1 else v.width-round(512*5/26);canvas.alpha_composite(v,(cx-rx,230-round(832*5/26)))
 canvas.convert('RGB').save(BASE/(stem+'-reference-bothface-world.png'))
(BASE/'firstcontact-palette-cleanup3.json').write_text(json.dumps({'state':'actual_cleaned_visual_review_pending','records':records,'toolSha256':sha(Path(__file__)),'runtime':'Pilot shipping/paired attack and receiving acceptance pending, no production mutations'},indent=2)+'\n');print(json.dumps(records))
