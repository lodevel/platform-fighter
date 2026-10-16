"""Compact capsule chains bounded by measured per-pose anatomical surfaces.

Every mask pixel must be covered. Capsule raster coverage must remain inside
an explicitly declared Euclidean mask margin. This is target authoring, not
native collision parity. PCA chooses axes only; it never defines the anatomy.
"""
import numpy as np
def expanded_mask(mask,margin):
 out=mask.copy();h,w=mask.shape;limit=int(np.ceil(margin))
 for dy in range(-limit,limit+1):
  for dx in range(-limit,limit+1):
   if dx*dx+dy*dy>margin*margin:continue
   y0=max(0,dy);y1=min(h,h+dy);x0=max(0,dx);x1=min(w,w+dx)
   out[y0:y1,x0:x1]|=mask[y0-dy:y1-dy,x0-dx:x1-dx]
 return out
def capsule_coverage(points,a,b,r):
 ab=b-a;den=ab@ab;t=np.clip((points-a)@ab/den,0,1)if den>1e-10 else np.zeros(len(points));return np.linalg.norm(points-(a+t[:,None]*ab),axis=1)<=r+1e-8
def fit(mask,margin):
 ys,xs=np.where(mask);points=np.c_[xs,ys].astype(float);allowed=expanded_mask(mask,margin);h,w=mask.shape;accepted=[];fallback=[]
 def candidate(p):
  centre=p.mean(0)
  axis=np.linalg.svd(p-centre,full_matrices=False)[2][0] if len(p)>1 else np.array([1.,0.])
  normal=np.array([-axis[1],axis[0]]);u=p@axis;v=p@normal;mid=(v.min()+v.max())/2;vv=v-mid;radius=float(np.max(np.abs(vv)))+.35
  reach=np.sqrt(np.maximum(0,radius*radius-vv*vv));start=float(np.min(u+reach));end=float(np.max(u-reach))
  if start>end:start=end=(start+end)/2
  a=axis*start+normal*mid;b=axis*end+normal*mid
  # Guarantee all current subset points after endpoint collapse/rounding.
  ab=b-a;den=ab@ab;t=np.clip((p-a)@ab/den,0,1)if den>1e-10 else np.zeros(len(p));radius=max(radius,float(np.linalg.norm(p-(a+t[:,None]*ab),axis=1).max())+1e-7)
  return a,b,radius,axis,u
 def within(a,b,r):
  lo=np.floor(np.minimum(a,b)-r).astype(int);hi=np.ceil(np.maximum(a,b)+r).astype(int)
  if lo[0]<0 or lo[1]<0 or hi[0]>=w or hi[1]>=h:return False
  yy,xx=np.mgrid[lo[1]:hi[1]+1,lo[0]:hi[0]+1];p=np.c_[xx.ravel(),yy.ravel()];inside=capsule_coverage(p,a,b,r);return not np.any(inside&~allowed[p[:,1],p[:,0]])
 def recurse(p,depth=0):
  a,b,r,axis,u=candidate(p)
  if within(a,b,r):accepted.append((a,b,r));return
  if len(p)<=3 or depth>=16:
   # Exact tiny-pixel witnesses stay bounded and explicit, never silently lost.
   for q in p:accepted.append((q.copy(),q.copy(),.35));fallback.append(q.tolist())
   return
  order=np.argsort(u,kind='stable');half=len(p)//2;recurse(p[order[:half]],depth+1);recurse(p[order[half:]],depth+1)
 recurse(points)
 covered=np.zeros(len(points),bool)
 for a,b,r in accepted:covered|=capsule_coverage(points,a,b,r)
 assert covered.all()
 bad=sum(not within(a,b,r)for a,b,r in accepted)
 if bad:raise ValueError(('CAPSULE_OUTSIDE_DECLARED_ANATOMICAL_MARGIN',bad))
 return accepted,{'surfacePixels':len(points),'capsules':len(accepted),'uncoveredSurfacePixels':int((~covered).sum()),'capsulesOutsideDeclaredMargin':bad,'declaredEuclideanMarginPixels':margin,'tinyPixelWitnesses':len(fallback),'fitPolicy':'Recursive per-pose anatomical-region PCA envelopes; exact pixel-centre coverage and Euclidean-dilated target surface bounds. No constant limb template or source-radius parity.'}
