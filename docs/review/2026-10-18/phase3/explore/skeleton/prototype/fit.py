"""Fit rig poses to today's DK jab drawings by gradient descent (multi-start)."""
import json, sys, itertools, math, numpy as np, torch, torch.nn.functional as F
from PIL import Image
sys.path.insert(0,'.')
from rig import *
meta,layers=load_rig()
CW,CH=meta['canvas']; RX,RY=meta['root']
pkg=json.load(open('/home/lombet/Workspace/platform-fighter/.tmp/character-packages/donkeykong/character.json'))
def target(did):
  d=pkg['drawings'][did]; im=Image.open(f"{S}/dk/{did.replace('/','_')}.png").convert('RGBA')
  c=Image.new('RGBA',(CW,CH)); c.paste(im,(RX-d['anchor'][0],RY-d['anchor'][1]))
  a=np.asarray(c).astype(np.float32)/255; a[...,:3]*=a[...,3:4]
  return torch.tensor(a).permute(2,0,1).to(dev)
def loss_fn(out,tgt,P):
  l=0
  for k in (1,2,6):
    o=F.avg_pool2d(out,k) if k>1 else out; t=F.avg_pool2d(tgt[None],k) if k>1 else tgt[None]
    l=l+(o-t).abs().mean(dim=(1,2,3))
  reg=0
  for n,q in P.items():
    if n=='body': reg=reg+0.5*(q[:,3:5]**2).sum(1)
    else: reg=reg+1e-4*(q[:,1:3]**2).sum(1)+2.0*(q[:,3:5]**2).sum(1)
  return l+reg*0.01
def fit(tgt,starts):
  B=len(starts)
  P={n:torch.zeros(B,5,device=dev) for n in meta['order']}
  for b,s in enumerate(starts):
    for n,ang in s.items(): P[n][b,0]=math.radians(ang)
  for q in P.values(): q.requires_grad_(True)
  opt=torch.optim.Adam([{'params':[P[n] for n in P]}],lr=0.03)
  scale=torch.tensor([1,8,8,0.3,0.3],device=dev)  # step scale per param kind
  tgt2=F.avg_pool2d(tgt[None],2)[0]
  for it in range(450):
    Q={n:P[n]*scale for n in P}
    full=it>=380
    out=render(meta,layers,Q,1 if full else 2); L=loss_fn(out,tgt if full else tgt2,Q)
    opt.zero_grad(); L.sum().backward(); opt.step()
    if it==380:
      for g in opt.param_groups: g['lr']=0.01
  Q={n:(P[n]*scale).detach() for n in P}
  out=render(meta,layers,Q); L=loss_fn(out,tgt,Q)
  b=int(L.argmin())
  return {n:Q[n][b:b+1] for n in Q}, out[b], float(L[b])
grid=[-120,-60,0,60,120]
starts=[{'near_upper':u,'near_fist':f} for u in grid for f in grid]
frames=sys.argv[1].split(',') if len(sys.argv)>1 else [f'jab/{i}' for i in range(7)]
res={}
for did in frames:
  tgt=target(did); P,out,L=fit(tgt,starts)
  res[did]={n:P[n][0].tolist() for n in P}; res[did]['_loss']=L
  to_img(out).save(f"{S}/fit/{did.replace('/','_')}.png")
  print(did, round(L,4), {n:[round(math.degrees(P[n][0,0].item()),1)] for n in P}, flush=True)
json.dump(res,open(f'{S}/fit/poses.json','w'),indent=1)
