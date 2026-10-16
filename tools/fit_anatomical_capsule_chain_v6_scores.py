"""Output-equivalent coverage cache and bounded strict greedy score reuse.

Anatomical part pixels define coverage; the union of actual physical body parts
defines the permitted envelope, with a declared Euclidean retarget margin.
Candidate/tie order and every floating geometry operation stay identical to V3.
Only exact Boolean coverage of unchanged chosen primitives is reused.
"""
import numpy as np
from fit_anatomical_capsule_envelope_v1 import expanded_mask,capsule_coverage
STRICT_SCORE_MATRIX_BUDGET_BYTES=32*1024*1024
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
  q=centres[start:start+128]
  # The same two squared integer-grid components and sum as V3/V4, without
  # materializing their C×boundary×2 coordinate tensor. Min/sqrt/clamps/order
  # are unchanged; no approximate distance transform or new dependency.
  squared=(q[:,0,None]-outside[None,:,0])**2
  squared+=(q[:,1,None]-outside[None,:,1])**2
  dist=np.min(squared,axis=1);radii.extend(np.sqrt(dist)-.08)
 radii=np.maximum(.35,np.array(radii));covered=np.zeros(len(p),bool);chosen=[];chosen_coverage=[]
 # Score membership is STRICT squared distance <= r², exactly as V3. It is
 # deliberately separate from capsule_coverage's r+1e-8 chosen-disc coverage.
 # Each point exits the remaining set once; subtract its fixed score column.
 # Large parts retain the original bounded128-chunk scoring path.
 strict_scores=None;strict_membership=None
 if len(centres)*len(p)<=STRICT_SCORE_MATRIX_BUDGET_BYTES:
  strict_membership=np.empty((len(centres),len(p)),dtype=bool)
  for start in range(0,len(centres),128):
   q=centres[start:start+128];r=radii[start:start+128]
   strict_membership[start:start+128]=np.sum((q[:,None,:]-p[None,:,:])**2,axis=2)<=r[:,None]**2
  strict_scores=np.sum(strict_membership,axis=1,dtype=np.int64)
 def record_coverage(coverage):
  if strict_scores is not None:
   newly_covered=coverage&~covered
   strict_scores[:]-=np.sum(strict_membership[:,newly_covered],axis=1,dtype=np.int64)
  chosen_coverage.append(coverage);covered[:]|=coverage
 while not covered.all():
  remaining=p[~covered];best=-1;bestScore=-1
  if strict_scores is not None:
   best=int(np.argmax(strict_scores));bestScore=int(strict_scores[best])
  else:
   for start in range(0,len(centres),128):
    q=centres[start:start+128];r=radii[start:start+128];scores=np.sum(np.sum((q[:,None,:]-remaining[None,:,:])**2,axis=2)<=r[:,None]**2,axis=1)
    i=int(np.argmax(scores));score=int(scores[i])
    if score>bestScore:bestScore=score;best=start+i
  if bestScore<=0:
   q=remaining[0];chosen.append((q,q,.35));coverage=capsule_coverage(p,q,q,.35);record_coverage(coverage);continue
  q=centres[best];r=radii[best];chosen.append((q,q,float(r)));coverage=capsule_coverage(p,q,q,r);record_coverage(coverage)
 def allowed_cap(a,b,r):
  lo=np.floor(np.minimum(a,b)-r).astype(int);hi=np.ceil(np.maximum(a,b)+r).astype(int)
  if lo[0]<0 or lo[1]<0 or hi[0]>=w or hi[1]>=h:return False
  yy,xx=np.mgrid[lo[1]:hi[1]+1,lo[0]:hi[0]+1];q=np.c_[xx.ravel(),yy.ravel()];inside=capsule_coverage(q,a,b,r);return not np.any(inside&~allowed[q[:,1],q[:,0]])
 # Keep geometric identity per anatomical part. Merging requires both the same
 # exact surface coverage and the same permitted envelope, never guessed joints.
 # Counts reproduce OR of the same V3 Boolean masks. Signed integers avoid
 # underflow when removing two overlapping primitives from the exact union.
 coverage_count=np.sum(chosen_coverage,axis=0,dtype=np.int32)
 improved=True
 while improved:
  improved=False
  for i in range(len(chosen)):
   if improved:break
   for j in range(i+1,len(chosen)):
    aa,ab,ar=chosen[i];ba,bb,br=chosen[j];points=np.array([aa,ab,ba,bb]);pairs=[(float(np.linalg.norm(points[a]-points[b])),a,b)for a in range(4)for b in range(a+1,4)];_,ia,ib=max(pairs);a,b=points[ia],points[ib];r=max(ar,br)
    others=(coverage_count-chosen_coverage[i]-chosen_coverage[j])>0
    possible=None
    for rr in sorted(set([ar,br,(ar+br)/2,r])):
     if allowed_cap(a,b,rr):
      candidate_coverage=capsule_coverage(p,a,b,rr)
      if np.all(others|candidate_coverage):
       possible=rr;break
    if possible is None:continue
    coverage_count=coverage_count-chosen_coverage[i]-chosen_coverage[j]+candidate_coverage
    chosen_coverage[i]=candidate_coverage;chosen_coverage.pop(j)
    chosen[i]=(a,b,possible);chosen.pop(j);improved=True;break
 # Remove only provably redundant region primitives; all measured surface pixels remain covered.
 for i in range(len(chosen)-1,-1,-1):
  other=(coverage_count-chosen_coverage[i])>0
  if other.all():
   coverage_count-=chosen_coverage[i];chosen_coverage.pop(i);chosen.pop(i)
 coverage=np.zeros(len(p),bool)
 for a,b,r in chosen:
  assert allowed_cap(a,b,r);coverage|=capsule_coverage(p,a,b,r)
 assert coverage.all()
 return chosen,{'surfacePixels':len(p),'capsules':len(chosen),'uncoveredSurfacePixels':0,'capsulesOutsideDeclaredPhysicalUnionMargin':0,'declaredEuclideanMarginPixels':margin,'algorithm':'Part-owned medial discs and exact-coverage/bounds capsule-chain merging. Each measured anatomical part fully covered; capsule union constrained to physical body-part union plus declared margin. No constant template.'}
