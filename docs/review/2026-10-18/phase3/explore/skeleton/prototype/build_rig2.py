"""Rig v2: body from jab/4 plus swappable part variants cut from other jab drawings
(near arm: guard / extended / across chest; head: closed / open mouth), the way
cutout animation swaps attachments. Everything is placed at the shared root."""
import numpy as np, json, sys
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage as ndi
S='/tmp/claude-1000/-home-lombet-Workspace-platform-fighter/a7dfccb5-31fd-4c9e-86a2-6a914ded46da/scratchpad/explore-skeleton'
OUT=f'{S}/rig2'
CW,CH=460,320; ROOT=(200,290)
pkg=json.load(open('/home/lombet/Workspace/platform-fighter/.tmp/character-packages/donkeykong/character.json'))
def src(name):
  d=pkg['drawings'][name.replace('_','/')]; off=(ROOT[0]-d['anchor'][0],ROOT[1]-d['anchor'][1])
  c=Image.new('RGBA',(CW,CH)); c.paste(Image.open(f'{S}/dk/{name}.png').convert('RGBA'),off)
  return np.asarray(c).astype(np.float32)/255, off
def mask(off,pts,blur=0.8):
  m=Image.new('L',(CW,CH)); ImageDraw.Draw(m).polygon([(x+off[0],y+off[1]) for x,y in pts],fill=255)
  return np.asarray(m.filter(ImageFilter.GaussianBlur(blur))).astype(np.float32)/255
# name: (drawing, parent, pivot (drawing px), polygon (drawing px), z)
PARTS=[
 ('far_fist','jab_4','body',(68,72),[(0,40),(20,22),(45,18),(58,24),(68,40),(74,62),(72,85),(62,98),(40,102),(14,100),(0,80)],1),
 ('arm_ext','jab_1','body',(180,100),[(176,72),(200,70),(230,75),(260,88),(285,108),(300,128),(306,160),(298,196),(276,202),(252,192),(226,182),(220,152),(196,146),(178,140),(172,110)],2),
 ('head_closed','jab_4','body',(140,105),[(116,42),(132,28),(160,18),(183,20),(194,35),(200,60),(202,92),(198,118),(190,140),(165,150),(135,144),(120,126),(114,98),(112,68)],3),
 ('head_open','jab_1','body',(135,110),[(110,50),(125,35),(150,27),(172,25),(184,42),(187,62),(186,95),(182,122),(178,142),(160,152),(130,147),(106,128),(100,100),(102,72)],3),
 ('arm_guard','jab_4','body',(196,72),[(186,56),(204,56),(222,66),(234,86),(214,94),(250,92),(270,98),(277,122),(274,160),(258,172),(226,172),(200,172),(186,154),(190,136),(200,110),(186,84)],4),
 ('arm_cross','jab_3','body',(205,105),[(186,96),(206,92),(226,104),(237,124),(237,160),(226,176),(216,200),(206,216),(180,216),(150,213),(122,201),(117,180),(125,165),(150,148),(178,140),(186,120)],4),
]
body,off4=src('jab_4'); a=body[...,3].copy()
removed=np.zeros((CH,CW),np.float32)
for n,dr,par,pv,poly,z in PARTS:
  if dr=='jab_4': removed=np.maximum(removed,mask(off4,poly))
body_a=a*(1-removed)
hull=Image.new('L',(CW,CH)); ImageDraw.Draw(hull).polygon([(x+off4[0],y+off4[1]) for x,y in [(60,20),(110,5),(160,8),(200,35),(222,70),(226,110),(214,150),(200,178),(160,192),(70,172),(55,100)]],fill=255)
hull=np.asarray(hull)>0
ok=(body_a>0.95)&(body[...,:3].max(-1)>0.42)&(body[...,:3].min(-1)<0.3)  # brown fur only, no outline / tan / red
idx=ndi.distance_transform_edt(~ok,return_distances=False,return_indices=True)
fz=hull&(removed>0.02)
B=np.concatenate([body[...,:3],body_a[...,None]],-1)
B[fz,:3]=body[idx[0][fz],idx[1][fz],:3]; B[fz,3]=1
import os; os.makedirs(OUT,exist_ok=True)
meta={'canvas':[CW,CH],'root':list(ROOT),'order':['body'],'parts':{'body':{'parent':None,'pivot':list(ROOT),'source':'jab/4'}}}
layers={'body':B}
for n,dr,par,pv,poly,z in sorted(PARTS,key=lambda p:p[5]):
  img,off=src(dr); m=mask(off,poly)
  layers[n]=np.concatenate([img[...,:3],(img[...,3]*m)[...,None]],-1)
  meta['order'].append(n); meta['parts'][n]={'parent':par,'pivot':[pv[0]+off[0],pv[1]+off[1]],'source':dr.replace('_','/')}
for n in meta['order']:
  L=layers[n]; al=L[...,3]>0.02; ys,xs=np.nonzero(al)
  meta['parts'][n]['bbox']=[int(xs.min()),int(ys.min()),int(xs.max()-xs.min()+1),int(ys.max()-ys.min()+1)]
  meta['parts'][n]['pixels']=int(al.sum())
  Image.fromarray((np.clip(L,0,1)*255).astype(np.uint8)).save(f'{OUT}/{n}.png')
meta['variants']={'arm':['arm_guard','arm_ext','arm_cross'],'head':['head_closed','head_open']}
json.dump(meta,open(f'{OUT}/rig.json','w'),indent=1)
# exploded view
tiles=[Image.open(f'{OUT}/{n}.png') for n in meta['order']]
sheet=Image.new('RGBA',(CW*3,CH*3),(232,232,232,255)); d=ImageDraw.Draw(sheet)
for i,(n,t) in enumerate(zip(meta['order'],tiles)):
  x,y=(i%3)*CW,(i//3)*CH; sheet.alpha_composite(t,(x,y)); d.text((x+6,y+6),f"{n} (from {meta['parts'][n]['source']}) {meta['parts'][n]['bbox'][2]}x{meta['parts'][n]['bbox'][3]}",fill=(0,0,0))
  px,py=meta['parts'][n]['pivot']; d.ellipse([x+px-3,y+py-3,x+px+3,y+py+3],fill=(255,0,0))
sheet.save(f'{S}/out/rig2_parts.png')
print({n:(meta['parts'][n]['bbox'][2:],meta['parts'][n]['pixels']) for n in meta['order']})
