"""Per-tick strips at match size for rig v2: today's schedule | rig interpolated every tick |
rig posed to Ultimate | Ultimate (UFD). Writes contact sheets and metrics."""
import json, sys, numpy as np, torch
from PIL import Image, ImageDraw
sys.path.insert(0,'.')
from rig import *
from compare import placed, cell
from metrics import sigdiff, iou
meta,layers=load_rig(f'{S}/rig2'); order=meta['order']
today=json.load(open(f'{S}/fit2/poses.json'))
ult=json.load(open(f'{S}/ultfit2/poses.json')) if len(sys.argv)>1 else {}
win=[(0,4,'jab/0'),(4,5,'jab/1'),(5,6,'jab/2'),(6,11,'jab/3'),(11,17,'jab/4'),(17,22,'jab/5'),(22,24,'jab/6')]
def draw(r):
  vis=torch.tensor([[1.0 if n in (r['arm'],r['head'],'body','far_fist') else 0.0 for n in order]],device=dev)
  return to_img(render(meta,layers,{n:torch.tensor([r['pose'][n]],device=dev) for n in order},1,vis)[0])
def lerp(r0,r1,u):
  if r0['arm']!=r1['arm'] or r0['head']!=r1['head']: return r0 if u<0.5 else r1
  return dict(arm=r0['arm'],head=r0['head'],pose={n:[(1-u)*a+u*b for a,b in zip(r0['pose'][n],r1['pose'][n])] for n in order})
def keyed(keys,t):
  for (t0,r0),(t1,r1) in zip(keys,keys[1:]):
    if t0<=t<t1: return lerp(r0,r1,(t-t0)/(t1-t0))
  return keys[-1][1]
tkeys=[(a,today[d]) for a,b,d in win]
rows={'today (drawings)':[], 'rig, every tick':[]}
for t in range(24):
  rows['today (drawings)'].append(placed(next(d for a,b,d in win if a<=t<b)))
  rows['rig, every tick'].append(draw(keyed(tkeys,t)))
if ult:
  ukeys=sorted((int(k),v) for k,v in ult.items())
  rows['rig posed to Ultimate']=[draw(keyed(ukeys,t)) for t in range(24)]
  rows['Ultimate (UFD)']=[Image.open(f'{S}/ultfit2/target_{t:02d}.png') if (int(t) in dict(ukeys)) else None for t in range(24)]
names=list(rows); crop=(60,40,440,300)
for mag,suf,ticks in ((1,'match',list(range(24))),(2,'x2',[0,2,4,5,7,9,12,16,20,23])):
  blank=Image.new('RGBA',(460,320))
  tiles=[[cell(rows[n][t] or blank,mag,crop) for t in ticks] for n in names]
  w,h=tiles[0][0].size; pad=3; lw=140
  im=Image.new('RGB',(lw+len(ticks)*(w+pad),16+len(names)*(h+pad)),(250,250,250)); d=ImageDraw.Draw(im)
  for j,t in enumerate(ticks): d.text((lw+j*(w+pad)+2,2),f'tick {t}',fill=(0,0,0))
  for i,n in enumerate(names):
    d.text((2,16+i*(h+pad)+h//2-6),n,fill=(0,0,0))
    for j,tl in enumerate(tiles[i]): im.paste(tl.convert('RGB'),(lw+j*(w+pad),16+i*(h+pad)))
  im.save(f'{S}/out/rig2_ticks_{suf}.png')
m={}
for d,r in today.items():
  img=draw(r); img.save(f"{S}/fit2/{d.replace('/','_')}.png")
  m[d]=dict(sigdiff=round(sigdiff(placed(d),img),3),iou=round(iou(placed(d),img),3),arm=r['arm'],head=r['head'])
out={'today_fit':m}
if ult:
  out['ultimate']={t:dict(today_iou=round(iou(rows['today (drawings)'][t],rows['Ultimate (UFD)'][t]),3),rig_iou=round(iou(rows['rig posed to Ultimate'][t],rows['Ultimate (UFD)'][t]),3)) for t,_ in ukeys}
json.dump(out,open(f'{S}/out/rig2_metrics.json','w'),indent=1); print(json.dumps(out))
