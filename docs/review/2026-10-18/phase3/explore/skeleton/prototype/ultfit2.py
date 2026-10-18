"""Pose rig v2 to Ultimate jab1 frames (silhouette + skin colour), starting from its fits to today's art."""
import json, sys, math, numpy as np, torch, torch.nn.functional as F
from PIL import Image
sys.path.insert(0,'.')
import fit2
from fit2 import *
SCALE=0.755
def skin_of(rgb):
  r,g,b=rgb[...,0],rgb[...,1],rgb[...,2]; return ((r>0.78)&(g>0.55)&(r-b>0.12)).astype(np.float32)
L=layers.cpu().numpy(); sk=[]
for i in range(L.shape[0]):
  a=L[i,3]; rgb=np.where(a>1e-3,L[i,:3]/np.maximum(a,1e-3),0).transpose(1,2,0); s=skin_of(rgb)*a
  sk.append(np.stack([s,s,np.zeros_like(a),a]))
SKL=torch.tensor(np.stack(sk)).to(dev)
fit2.layers=SKL   # run() renders the (skin, skin, 0, alpha) stack
body=L[0,3]; ys,xs=np.nonzero(body>0.5); fb=ys.max(); fx=xs[ys>fb-15].mean()
def ult_target(i):
  im=np.asarray(Image.open(f'{S}/ult/{i:02d}.png')).astype(np.float32)/255
  a=im[...,3]; ys,xs=np.nonzero(a>0.5); by=ys.max(); bx=xs[ys>by-20].mean(); h,w=a.shape
  pil=Image.fromarray((im*255).astype(np.uint8),'RGBA').resize((round(w*SCALE),round(h*SCALE)),Image.LANCZOS)
  c=Image.new('RGBA',(CW,CH)); c.paste(pil,(round(fx-bx*SCALE),round(fb-by*SCALE)))
  t=np.asarray(c).astype(np.float32)/255; s=skin_of(t[...,:3])*t[...,3]
  cm=Image.open(f'{S}/ult/care_{i:02d}.png').resize((round(w*SCALE),round(h*SCALE)),Image.BILINEAR)
  care=Image.new('L',(CW,CH),255); care.paste(cm,(round(fx-bx*SCALE),round(fb-by*SCALE)))
  global CARE; CARE=torch.tensor(np.asarray(care).astype(np.float32)/255).to(dev)[None,None]
  return torch.tensor(np.stack([s,s,np.zeros_like(s),t[...,3]])).to(dev), c
def sk_loss(out,tgt):
  care=CARE if out.shape[-1]==CW else F.avg_pool2d(CARE,2)
  out=out*care; tgt=tgt*care[0]
  l=0
  for k in (1,3,8): l=l+((F.avg_pool2d(out,k) if k>1 else out)-(F.avg_pool2d(tgt[None],k) if k>1 else tgt[None]))[:,[0,3]].abs().mean(dim=(1,2,3))
  return l+((F.avg_pool2d(out[:,:1],3))-(F.avg_pool2d(tgt[None,:1],3))).abs().mean(dim=(1,2,3))
today=json.load(open(f'{S}/fit2/poses.json'))
ticks=[int(t) for t in sys.argv[1].split(',')]
import os; os.makedirs(f'{S}/ultfit2',exist_ok=True)
res={}
for t in ticks:
  tgt,c=ult_target(t); c.save(f'{S}/ultfit2/target_{t:02d}.png')
  st=[dict(arm=r['arm'],head=r['head'],pose=r['pose']) for k,r in today.items() if k!='jab/0']
  st+=starts_grid(today['jab/4']['pose'])
  r,_=run(sk_loss,tgt,F.avg_pool2d(tgt[None],2)[0],st,iters=380,full_from=320)
  res[t]=r; print('tick',t,r['arm'],r['head'],round(r['loss'],4),flush=True)
for k,v in res.items(): json.dump({k:v},open(f'{S}/ultfit2/pose_{k:02d}.json','w'))
