"""Greedy medial discs merged into verified compact anatomical capsule chains.

Anatomical part pixels define coverage; the union of actual physical body parts
defines the permitted envelope, with a declared Euclidean retarget margin.
"""
import numpy as np
from fit_anatomical_capsule_envelope_v1 import expanded_mask,capsule_coverage
def fit(mask,physical_union,margin):
 ys,xs=np.where(mask);p=np.c_[xs,ys].astype(float);h,w=mask.shape;allowed=expanded_mask(physical_union,margin)
 # The false pixels adjacent to this exact allowed surface are its boundary.
 border=np.zeros_like(allowed)
 for dy,dx in [(-1,0),(1,0),(0,-1),(0,1)]:
  shifted=np.roll(allowed,(dy,dx),(0,1));border|=~allowed&shifted
 yy,xx=np.where(border);outside=np.c_[xx,yy].astype(float)
 # Include viewport outside so every geometric primitive has a real bound.
 outside=np.concatenate([outside,np.c_[np.arange(w),np.full(w,-1)],np.c_[np.arange(w),np.full(w,h)],np.c_[np.full(h,-1),np.arange(h)],np.c_[np.full(h,w),np.arange(h)]])
 centres=p[::2];radii=[]
 for start in range(0,len(centres),128):
  q=centres[start:start+128];dist=np.min(np.sum((q[:,None,:]-outside[None,:,:])**2,axis=2),axis=1);radii.extend(np.sqrt(dist)-.08)
 radii=np.maximum(.35,np.array(radii));covered=np.zeros(len(p),bool);chosen=[]
 while not covered.all():
  remaining=p[~covered];best=-1;bestScore=-1
  for start in range(0,len(centres),128):
   q=centres[start:start+128];r=radii[start:start+128];scores=np.sum(np.sum((q[:,None,:]-remaining[None,:,:])**2,axis=2)<=r[:,None]**2,axis=1)
   i=int(np.argmax(scores));score=int(scores[i])
   if score>bestScore:bestScore=score;best=start+i
  if bestScore<=0:
   q=remaining[0];chosen.append((q,q,.35));covered|=capsule_coverage(p,q,q,.35);continue
  q=centres[best];r=radii[best];chosen.append((q,q,float(r)));covered|=capsule_coverage(p,q,q,r)
 def allowed_cap(a,b,r):
  lo=np.floor(np.minimum(a,b)-r).astype(int);hi=np.ceil(np.maximum(a,b)+r).astype(int)
  if lo[0]<0 or lo[1]<0 or hi[0]>=w or hi[1]>=h:return False
  yy,xx=np.mgrid[lo[1]:hi[1]+1,lo[0]:hi[0]+1];q=np.c_[xx.ravel(),yy.ravel()];inside=capsule_coverage(q,a,b,r);return not np.any(inside&~allowed[q[:,1],q[:,0]])
 # Keep geometric identity per anatomical part. Merging requires both the same
 # exact surface coverage and the same permitted envelope, never guessed joints.
 improved=True
 while improved:
  improved=False
  for i in range(len(chosen)):
   if improved:break
   for j in range(i+1,len(chosen)):
    aa,ab,ar=chosen[i];ba,bb,br=chosen[j];points=np.array([aa,ab,ba,bb]);pairs=[(float(np.linalg.norm(points[a]-points[b])),a,b)for a in range(4)for b in range(a+1,4)];_,ia,ib=max(pairs);a,b=points[ia],points[ib];r=max(ar,br)
    if not allowed_cap(a,b,r):continue
    old=capsule_coverage(p,aa,ab,ar)|capsule_coverage(p,ba,bb,br);new=capsule_coverage(p,a,b,r)
    if np.any(old&~new):continue
    chosen[i]=(a,b,r);chosen.pop(j);improved=True;break
 coverage=np.zeros(len(p),bool)
 for a,b,r in chosen:
  assert allowed_cap(a,b,r);coverage|=capsule_coverage(p,a,b,r)
 assert coverage.all()
 return chosen,{'surfacePixels':len(p),'capsules':len(chosen),'uncoveredSurfacePixels':0,'capsulesOutsideDeclaredPhysicalUnionMargin':0,'declaredEuclideanMarginPixels':margin,'algorithm':'Part-owned medial discs and exact-coverage/bounds capsule-chain merging. Each measured anatomical part fully covered; capsule union constrained to physical body-part union plus declared margin. No constant template.'}
