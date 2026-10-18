"""Fit rig v2 (with swappable arm/head variants) to today's DK jab drawings, or to Ultimate frames."""
import json, sys, math, itertools, numpy as np, torch, torch.nn.functional as F
from PIL import Image
sys.path.insert(0,'.')
from rig import *
RIG=f'{S}/rig2'
meta,layers=load_rig(RIG)
CW,CH=meta['canvas']; RX,RY=meta['root']; order=meta['order']
pkg=json.load(open('/home/lombet/Workspace/platform-fighter/.tmp/character-packages/donkeykong/character.json'))
def today_target(did):
  d=pkg['drawings'][did]; im=Image.open(f"{S}/dk/{did.replace('/','_')}.png").convert('RGBA')
  c=Image.new('RGBA',(CW,CH)); c.paste(im,(RX-d['anchor'][0],RY-d['anchor'][1]))
  a=np.asarray(c).astype(np.float32)/255; a[...,:3]*=a[...,3:4]
  return torch.tensor(a).permute(2,0,1).to(dev)
SC=torch.tensor([1,8,8,0.3,0.3],device=dev)
def visvec(arm,head):
  return torch.tensor([1.0 if (n in (arm,head) or n in ('body','far_fist')) else 0.0 for n in order],device=dev)
def run(lossf,tgt,tgt2,starts,iters=420,full_from=350):
  B=len(starts)
  P={n:torch.stack([torch.tensor(s['pose'].get(n,[0]*5),dtype=torch.float32) for s in starts]).to(dev)/SC for n in order}
  vis=torch.stack([visvec(s['arm'],s['head']) for s in starts])
  for q in P.values(): q.requires_grad_(True)
  opt=torch.optim.Adam(list(P.values()),lr=0.03)
  for it in range(iters):
    Q={n:P[n]*SC for n in P}; full=it>=full_from
    out=render(meta,layers,Q,1 if full else 2,vis)
    reg=sum(1e-4*(Q[n][:,1:3]**2).sum(1)+2*(Q[n][:,3:5]**2).sum(1) for n in Q if n!='body')+0.5*(Q['body'][:,3:5]**2).sum(1)
    L=lossf(out,tgt if full else tgt2)+0.01*reg
    opt.zero_grad(); L.sum().backward(); opt.step()
    if it==full_from:
      for g in opt.param_groups: g['lr']=0.01
  b=int(L.argmin()); Q={n:(P[n]*SC)[b].detach().cpu().tolist() for n in P}
  best=starts[b]; img=to_img(render(meta,layers,{n:torch.tensor([Q[n]],device=dev) for n in order},1,vis[b:b+1])[0])
  return dict(pose=Q,arm=best['arm'],head=best['head'],loss=float(L[b])),img
def rgba_loss(out,tgt):
  l=0
  for k in (1,2,6): l=l+((F.avg_pool2d(out,k) if k>1 else out)-(F.avg_pool2d(tgt[None],k) if k>1 else tgt[None])).abs().mean(dim=(1,2,3))
  return l
def starts_grid(base=None):
  st=[]
  for arm in meta['variants']['arm']:
    for head in meta['variants']['head']:
      for a in (0,35):
        pose={} if base is None else json.loads(json.dumps(base))
        pose[arm]=[math.radians(a),0,0,0,0]; st.append(dict(arm=arm,head=head,pose=pose))
  return st
if __name__=='__main__':
  import os; os.makedirs(f'{S}/fit2',exist_ok=True)
  frames=sys.argv[1].split(',')
  res={}
  for did in frames:
    tgt=today_target(did); r,img=run(rgba_loss,tgt,F.avg_pool2d(tgt[None],2)[0],starts_grid())
    res[did]=r; img.save(f"{S}/fit2/{did.replace('/','_')}.png"); print(did,r['arm'],r['head'],round(r['loss'],4),flush=True)
  for k,v in res.items(): json.dump({k:v},open(f"{S}/fit2/pose_{k.replace('/','_')}.json",'w'))
