"""Differentiable cutout-rig renderer: parts in rest pose, hierarchical 2D transforms."""
import json, math, numpy as np, torch, torch.nn.functional as F
from PIL import Image
S='/tmp/claude-1000/-home-lombet-Workspace-platform-fighter/a7dfccb5-31fd-4c9e-86a2-6a914ded46da/scratchpad/explore-skeleton'
import os
dev=os.environ.get('RIG_DEV','cuda' if torch.cuda.is_available() else 'cpu')
torch.set_num_threads(int(os.environ.get('RIG_THREADS','8')))
def load_rig(d=f'{S}/rig'):
  meta=json.load(open(f'{d}/rig.json'))
  layers=[]
  for n in meta['order']:
    a=np.asarray(Image.open(f'{d}/{n}.png')).astype(np.float32)/255
    a[...,:3]*=a[...,3:4]  # premultiply
    layers.append(torch.tensor(a).permute(2,0,1))
  return meta, torch.stack(layers).to(dev)
def local(theta,dx,dy,sx,sy,cx,cy):
  # T(c+d) R S T(-c) as 3x3, batched
  c,s=torch.cos(theta),torch.sin(theta)
  B=theta.shape[0]; M=torch.zeros(B,3,3,device=theta.device); M[:,2,2]=1
  M[:,0,0]=c*sx; M[:,0,1]=-s*sy; M[:,1,0]=s*sx; M[:,1,1]=c*sy
  M[:,0,2]=cx+dx-(M[:,0,0]*cx+M[:,0,1]*cy); M[:,1,2]=cy+dy-(M[:,1,0]*cx+M[:,1,1]*cy)
  return M
def world(meta,P):
  """P: dict part -> tensor [B,5] (theta, dx, dy, log sx, log sy)."""
  W={}
  for n in meta['order']:
    p=meta['parts'][n]; q=P[n]; cx,cy=p['pivot']
    L=local(q[:,0],q[:,1],q[:,2],torch.exp(q[:,3]),torch.exp(q[:,4]),cx,cy)
    W[n]=L if p['parent'] is None else W[p['parent']]@L
  return W
def render(meta,layers,P,down=1,vis=None):
  CW0,CH0=meta['canvas']; CW,CH=CW0//down,CH0//down; B=next(iter(P.values())).shape[0]
  W=world(meta,P)
  ys,xs=torch.meshgrid(torch.arange(CH,device=dev,dtype=torch.float32)+0.5,torch.arange(CW,device=dev,dtype=torch.float32)+0.5,indexing='ij')
  xs=xs*down; ys=ys*down
  pts=torch.stack([xs,ys,torch.ones_like(xs)],-1).reshape(-1,3)
  out=torch.zeros(B,4,CH,CW,device=dev)
  for i,n in enumerate(meta['order']):
    inv=torch.linalg.inv(W[n])
    src=(inv@pts.T).transpose(1,2)[...,:2]  # B,N,2 source px
    g=torch.stack([src[...,0]/CW0*2-1,src[...,1]/CH0*2-1],-1).reshape(B,CH,CW,2)
    smp=F.grid_sample(layers[i:i+1].expand(B,-1,-1,-1),g,mode='bilinear',padding_mode='zeros',align_corners=False)
    if vis is not None: smp=smp*vis[:,i].view(B,1,1,1)
    out=smp+out*(1-smp[:,3:4])
  return out
def zero_pose(meta,B):
  return {n:torch.zeros(B,5,device=dev) for n in meta['order']}
def to_img(t):
  a=t.detach().clamp(0,1).permute(1,2,0).cpu().numpy().copy()
  al=a[...,3:4]; a[...,:3]=np.where(al>1e-4,a[...,:3]/np.maximum(al,1e-4),0)
  return Image.fromarray((a*255+0.5).astype(np.uint8),'RGBA')
