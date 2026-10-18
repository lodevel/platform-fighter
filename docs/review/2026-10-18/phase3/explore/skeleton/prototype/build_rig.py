"""Cut a cutout rig out of one of today's DK jab drawings (jab/4) with hand polygons.
Parts are stored in rest pose on a canvas where the root sits at ROOT."""
import numpy as np, json
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage as ndi
S='/tmp/claude-1000/-home-lombet-Workspace-platform-fighter/a7dfccb5-31fd-4c9e-86a2-6a914ded46da/scratchpad/explore-skeleton'
CW,CH=460,320; ROOT=(200,290)
BASE='jab_4'; BASE_ANCHOR=(114,219)
im=Image.open(f'{S}/dk/{BASE}.png').convert('RGBA')
canvas=Image.new('RGBA',(CW,CH)); off=(ROOT[0]-BASE_ANCHOR[0],ROOT[1]-BASE_ANCHOR[1])
canvas.paste(im,off); src=np.asarray(canvas).astype(np.float32)/255
def poly(pts): return [(x+off[0],y+off[1]) for x,y in pts]
def pt(p): return (p[0]+off[0],p[1]+off[1])
# Hand-drawn part outlines on jab/4 (source px). Order = draw order (back to front).
PARTS={
 'far_fist': dict(parent='body', pivot=(68,72), poly=[(0,40),(20,22),(45,18),(58,24),(68,40),(74,62),(72,85),(62,98),(40,102),(14,100),(0,80)]),
 'head':     dict(parent='body', pivot=(140,105), poly=[(116,42),(132,28),(160,18),(183,20),(194,35),(198,60),(196,92),(194,118),(188,138),(165,148),(135,142),(120,125),(114,98),(112,68)]),
 'near_upper':dict(parent='body', pivot=(196,72), poly=[(186,56),(204,56),(222,66),(234,86),(232,100),(214,108),(196,106),(186,84)]),
 'near_fist':dict(parent='near_upper', pivot=(224,100), poly=[(214,94),(250,92),(270,98),(277,122),(274,160),(258,172),(226,172),(200,172),(186,154),(190,136),(212,120)]),
}
ORDER=['body','far_fist','head','near_upper','near_fist']
H,W=src.shape[:2]
masks={}
for n,p in PARTS.items():
  m=Image.new('L',(W,H)); ImageDraw.Draw(m).polygon(poly(p['poly']),fill=255)
  masks[n]=np.asarray(m.filter(ImageFilter.GaussianBlur(0.8))).astype(np.float32)/255
# later parts win overlaps
claimed=np.zeros((H,W),np.float32); final={}
for n in reversed(list(PARTS)):
  final[n]=masks[n]*(1-claimed); claimed=np.clip(claimed+final[n],0,1)
alpha=src[...,3]
layers={}
for n in PARTS: layers[n]=np.concatenate([src[...,:3],(alpha*final[n])[...,None]],-1)
body_a=alpha*(1-claimed)
# Fill what the cut parts covered on the body: nearest non-outline body colour, only
# inside the body's own outline extended under the removed parts (a hole a generator would paint).
hull=Image.new('L',(W,H)); ImageDraw.Draw(hull).polygon(poly([(70,30),(110,10),(150,10),(190,40),(212,70),(214,110),(208,150),(196,175),(160,190),(70,170),(60,100)]),fill=255)
hull=np.asarray(hull)>0
srcok=(body_a>0.95)&(src[...,:3].max(-1)>0.42)
idx=ndi.distance_transform_edt(~srcok,return_distances=False,return_indices=True)
fillzone=hull&(claimed>0.02)&(alpha>0.02)
body=np.concatenate([src[...,:3],body_a[...,None]],-1)
fy,fx=idx[0][fillzone],idx[1][fillzone]
body[fillzone,:3]=src[fy,fx,:3]
body[fillzone,3]=np.maximum(body_a[fillzone],1.0)
layers['body']=body
meta={'canvas':[CW,CH],'root':list(ROOT),'order':ORDER,'parts':{}}
meta['parts']['body']={'parent':None,'pivot':list(ROOT)}
for n,p in PARTS.items(): meta['parts'][n]={'parent':p['parent'],'pivot':list(pt(p['pivot']))}
# Measure part sizes (non-empty bbox and pixel count) in source px.
for n in ORDER:
  a=layers[n][...,3]>0.02; ys,xs=np.nonzero(a)
  meta['parts'][n]['bbox']=[int(xs.min()),int(ys.min()),int(xs.max()-xs.min()+1),int(ys.max()-ys.min()+1)]
  meta['parts'][n]['pixels']=int(a.sum())
  Image.fromarray((np.clip(layers[n],0,1)*255).astype(np.uint8)).save(f'{S}/rig/{n}.png')
json.dump(meta,open(f'{S}/rig/rig.json','w'),indent=1)
# Overview image: parts exploded with colour tints
ov=Image.new('RGBA',(W*2,H),(235,235,235,255))
ov.alpha_composite(canvas,(0,0))
tints={'body':(80,80,80),'far_fist':(0,160,255),'head':(255,170,0),'near_upper':(0,200,90),'near_fist':(220,0,160)}
for n in ORDER:
  L=Image.fromarray((np.clip(layers[n],0,1)*255).astype(np.uint8))
  t=Image.new('RGBA',(W,H),tints[n]+(0,)); a=np.asarray(L)[...,3]
  t.putalpha(Image.fromarray((a*0.45).astype(np.uint8)))
  ov.alpha_composite(L,(W,0)); ov.alpha_composite(t,(W,0))
d=ImageDraw.Draw(ov)
for n in ORDER:
  x,y=meta['parts'][n]['pivot']; d.ellipse([W+x-3,y-3,W+x+3,y+3],fill=(255,0,0,255))
ov.save(f'{S}/out/rig_parts.png')
print(json.dumps({n:(meta['parts'][n]['bbox'],meta['parts'][n]['pixels']) for n in ORDER}))
