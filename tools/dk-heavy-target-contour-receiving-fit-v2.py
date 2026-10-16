"""Finite target-contour primitive proposals; never edits shipping art/metadata. Heavy v2 permits explicit ROOT outside canvas and preserves reviewed non-contact intervals.

Actual accepted target alpha bounds receiving. Native clouds are only regional
ownership/pose priors supplied by a separately inspected target segmentation.
Compact local pieces intentionally do not enclose every source mesh vertex.
"""
import argparse,hashlib,importlib.util,json
from pathlib import Path
import numpy as np
from PIL import Image

spec=importlib.util.spec_from_file_location('annotation',Path(__file__).with_name('dk-receiving-fit-compare.py'))
annotation=importlib.util.module_from_spec(spec);spec.loader.exec_module(annotation)
DEFAULT_SCALE=26/5

def dilation(mask,radius):
    out=np.zeros_like(mask)
    for dy in range(-int(radius),int(radius)+1):
        for dx in range(-int(radius),int(radius)+1):
            if dx*dx+dy*dy>radius*radius:continue
            y0,y1=max(0,dy),min(mask.shape[0],mask.shape[0]+dy)
            x0,x1=max(0,dx),min(mask.shape[1],mask.shape[1]+dx)
            out[y0:y1,x0:x1]|=mask[y0-dy:y1-dy,x0-dx:x1-dx]
    return out

def capsule_grid(a,z,r):
    lo=np.floor(np.minimum(a,z)-r-1).astype(int);hi=np.ceil(np.maximum(a,z)+r+1).astype(int)
    xx,yy=np.meshgrid(np.arange(lo[0],hi[0]+1),np.arange(lo[1],hi[1]+1))
    p=np.stack([xx+.5,yy+.5],axis=-1);v=z-a
    t=np.clip(((p-a)*v).sum(axis=-1)/max(1e-9,np.dot(v,v)),0,1)
    m=((p-(a+t[...,None]*v))**2).sum(axis=-1)<=r*r
    return xx[m],yy[m]

def safe(a,z,r,allowed,floor_pixel_y=832,scale=DEFAULT_SCALE):
    # Grounded review pilots share the physical root floor. Receiving margin
    # stays within the explicitly selected.55worldpx floor band.
    if max(a[1],z[1])+r>floor_pixel_y+.55*scale:return False
    x,y=capsule_grid(a,z,r)
    if len(x)==0:return False
    if x.min()<0 or y.min()<0 or x.max()>=allowed.shape[1] or y.max()>=allowed.shape[0]:return False
    return bool(allowed[y,x].all())

def fitted_piece(points,axis,allowed,floor_pixel_y=832,scale=DEFAULT_SCALE):
    centre=points.mean(axis=0);along=(points-centre)@axis
    low,high=np.percentile(along,[12,88]);normal=np.array([-axis[1],axis[0]])
    r0=max(2*scale/DEFAULT_SCALE,float(np.percentile(np.abs((points-centre)@normal),90)))
    best=None
    # Shrinking source endpoints is a finite contour adaptation, not a scalar
    # inflation to preserve source proportions. Score actual regional pixels.
    for fraction in [1,.75,.5,.25,0]:
        a=centre+axis*low*fraction;z=centre+axis*high*fraction
        lo,hi=0,r0+scale
        for _ in range(13):
            r=(lo+hi)/2
            if safe(a,z,r,allowed,floor_pixel_y,scale):lo=r
            else:hi=r
        if lo<scale/DEFAULT_SCALE:continue
        v=z-a;t=np.clip(((points-a)*v).sum(axis=1)/max(1e-9,np.dot(v,v)),0,1)
        covered=np.linalg.norm(points-(a+t[:,None]*v),axis=1)<=lo
        score=int(covered.sum())
        if best is None or score>best[0]:best=(score,a,z,lo,covered)
    return best

def fit(packet_path,output,overlay,protected_regions=(),core_probes=None,hand_piece_limit=None):
    p=json.loads(packet_path.read_text());target=Path(p['targetImage'])
    root=np.asarray(p.get('root',[512,832]),dtype=float)
    scale=1/float(p.get('scaleToWorld',5/26))
    if root.shape!=(2,) or not np.isfinite(root).all() or not np.isfinite(scale) or scale<=0:
        raise ValueError('Explicit target root and scale must be finite')
    if p.get('bodyCentreFromRootY',-42)!=-42:raise ValueError('DK84px body-centre contract changed')
    assert hashlib.sha256(target.read_bytes()).hexdigest()==p['targetImageSha256']
    if p.get('labelImageSha256'):
        assert hashlib.sha256(Path(p['labelImage']).read_bytes()).hexdigest()==p['labelImageSha256']
    if p.get('targetCosmeticOnlyMaskSha256'):
        assert hashlib.sha256(Path(p['targetCosmeticOnlyMask']).read_bytes()).hexdigest()==p['targetCosmeticOnlyMaskSha256']
    alpha=np.asarray(Image.open(target).convert('RGBA'))[:,:,3]>=32
    labels=np.asarray(Image.open(p['labelImage']))
    cores=json.loads(core_probes.read_text()) if core_probes else None
    if cores:assert cores['sourceOwnershipProposalSha256']==hashlib.sha256(packet_path.read_bytes()).hexdigest()
    anatomical=labels>0
    if alpha.shape!=labels.shape:raise ValueError('Target/label cell dimensions disagree')
    # Explicit packed ROOT can legitimately lie outside the transparent canvas.
    # Ground support is constrained only for source-reviewed contact drawings.
    floor_pixel_y=root[1] if p.get('sourceContactPolicy')=='ground-contact' else float('inf')
    allowed=dilation(anatomical,scale)
    protected_labels=[p['regionLabelIds'][r] for r in protected_regions]
    protected=np.isin(labels,protected_labels)
    protected_allowed=dilation(protected,scale)&allowed
    vulnerable_allowed=dilation(anatomical&~protected,scale)&allowed
    boxes=[];policies=[];union=np.zeros_like(alpha)
    for region,label in p['regionLabelIds'].items():
        ys,xs=np.where(labels==label);points=np.column_stack([xs+.5,ys+.5]).astype(float)
        if not len(points):continue
        centre=points.mean(axis=0);_,vec=np.linalg.eigh(np.cov((points-centre).T));axis=vec[:,-1]
        # Head and broad torso need local taper; flat hands/feet are handled
        # by short capsules rather than oversized whole-cloud rectangles.
        limit=hand_piece_limit if hand_piece_limit and region in ['handl','handr'] else 6 if region=='handl' and protected_regions else 4 if region=='head' else 3 if region in ['bust','hip','handl','handr','footl','footr'] else 2
        region_allowed=protected_allowed if region in protected_regions else vulnerable_allowed
        candidates=[]
        # Compare a fixed1/2/3/4 local partition menu, then retain the smallest
        # partition count with near-best anatomical coverage.
        for count in range(1,limit+1):
            splits=[axis,np.array([1.,0.]),np.array([0.,1.])] if region=='handl' and protected_regions or hand_piece_limit and region in ['handl','handr'] else [axis]
            for split in splits:
                t=(points-centre)@split;edges=np.linspace(t.min()-1,t.max()+1,count+1)
                pieces=[];coverage=np.zeros(len(points),dtype=bool)
                for i in range(count):
                    group=points[(t>=edges[i])&(t<edges[i+1])]
                    if len(group)<max(3,20*(scale/DEFAULT_SCALE)**2):continue
                    _,gv=np.linalg.eigh(np.cov((group-group.mean(axis=0)).T));local_axis=gv[:,-1]
                    options=[fitted_piece(group,a,region_allowed,floor_pixel_y,scale) for a in [axis,local_axis,np.array([1.,0.]),np.array([0.,1.])]]
                    options=[o for o in options if o is not None]
                    if not options:continue
                    _,a,z,r,_=max(options,key=lambda o:o[0]);pieces.append((a,z,r))
                    v=z-a;u=np.clip(((points-a)*v).sum(axis=1)/max(1e-9,np.dot(v,v)),0,1)
                    coverage|=np.linalg.norm(points-(a+u[:,None]*v),axis=1)<=r
                candidates.append((float(coverage.mean()),pieces))
        best=max(x[0] for x in candidates)
        coverage,pieces=next(x for x in candidates if x[0]>=best-.025)
        # A broad palm remains receiving between the thin separated digits.
        # This independently inspected actual-label core is bounded by the
        # same anatomical/protection mask, never by native source radius.
        if cores and region=='handl':
            point=next(row['actorRelativeWorldPoint'] for row in cores['probes'] if row['region']==region)
            core=root+np.array([point['x']*scale,(point['y']-42)*scale]);lo,hi=0,100.*scale/DEFAULT_SCALE
            for _ in range(16):
                r=(lo+hi)/2
                if safe(core,core,r,region_allowed,floor_pixel_y,scale):lo=r
                else:hi=r
            pieces.append((core,core,lo))
            mask=np.zeros(len(points),dtype=bool)
            for a,z,r in pieces:
                v=z-a;t=np.clip(((points-a)*v).sum(axis=1)/max(1e-9,np.dot(v,v)),0,1)
                mask|=np.linalg.norm(points-(a+t[:,None]*v),axis=1)<=r
            coverage=float(mask.mean())
        for i,(a,z,r) in enumerate(pieces):
            world=lambda v:{'x':round(float((v[0]-root[0])/scale),5),'y':round(float(42+(v[1]-root[1])/scale),5)}
            aw,zw=world(a),world(z);rw=round(r/scale,5)
            boxes.append({'id':f'donkeykong.target.{region}.{i}','region':region,'offsetX':(aw['x']+zw['x'])/2,'offsetY':(aw['y']+zw['y'])/2,'width':abs(aw['x']-zw['x'])+2*rw,'height':abs(aw['y']-zw['y'])+2*rw,'capsule':{'start':aw,'end':zw,'radius':rw}})
            x,y=capsule_grid(a,z,r);union[y,x]=True
        policies.append({'region':region,'pieces':len(pieces),'targetRegionalAlphaCoverage':coverage,'nativeCloudEnclosureRequired':False,'constraint':'same-vulnerability target label union +1worldpx; named source ownership retained by regional seed points'})
    unprotected_union=np.zeros_like(alpha)
    foreign_region_spill=[]
    for b in boxes:
        c=b['capsule'];a=root+np.array([c['start']['x']*scale,(c['start']['y']-42)*scale]);z=root+np.array([c['end']['x']*scale,(c['end']['y']-42)*scale]);x,y=capsule_grid(a,z,c['radius']*scale)
        region_mask=dilation(labels==p['regionLabelIds'][b['region']],scale)
        foreign_region_spill.append({'id':b['id'],'pixelsBeyondOwnRegionMargin':int((~region_mask[y,x]).sum())})
        if b['region'] not in protected_regions:unprotected_union[y,x]=True
    data={'state':'unaccepted_target_contour_receiving_proposal','artFrameIndex':p['artFrameIndex'],'nativeSample':p['nativeSample'],'bodyCentreFromRootY':-42,'targetImage':str(target),'targetImageSha256':p['targetImageSha256'],'targetOwnershipProposal':str(packet_path),'targetOwnershipProposalSha256':hashlib.sha256(packet_path.read_bytes()).hexdigest(),'cosmeticReceivingExclusions':p['cosmeticReceivingExclusions'],'authoredMarginWorld':1,'groundedReceivingFloorMaximumY':42.55 if p.get('sourceContactPolicy')=='ground-contact' else None,'sourceContactPolicy':p.get('sourceContactPolicy'),'geometryProvenance':'authored compact local capsules constrained by accepted target anatomical labels plus1worldpx, with cross-protection containment by same-vulnerability target label unions; source anatomy is ownership prior only, not native hit_data','primitiveCount':len(boxes),'anatomicalFitPolicies':policies,'hurtboxPoses':[{'artFrameIndex':p['artFrameIndex'],'nativeSample':p['nativeSample'],'hurtboxes':boxes}],'targetAlphaDiagnostics':{'receivingOutsideAlphaFraction':float((union&~alpha).sum()/max(1,union.sum())),'receivingOutsideAuthoredMarginPixels':int((union&~allowed).sum()),'targetAlphaCoverage':float((union&alpha).sum()/max(1,alpha.sum())),'anatomicalTargetCoverage':float((union&anatomical).sum()/max(1,anatomical.sum())),'cosmeticOnlyTargetIntersectionPixels':int((union&alpha&~anatomical).sum()),'cosmeticOnlyOutsideAnatomicalMarginPixels':int((union&alpha&~anatomical&~allowed).sum())},'regionalProtectionDiagnostics':{'sourceSelectedProtectedRegions':list(protected_regions),'unprotectedReceivingOnShoulderLArmLTargetPixels':int((unprotected_union&protected).sum()),'perPrimitiveOwnRegionMargin':foreign_region_spill,'interpretation':'joint overlaps within1worldpx are explicit authored margin; exposed protected limb centres must remain unmapped to vulnerable regions'},'reviewedForShipping':False,'actualContactVerified':False}
    data.update({'root':root.tolist(),'scaleToWorld':1/scale,'targetCellDimensions':[alpha.shape[1],alpha.shape[0]]})
    output.write_text(json.dumps(data,indent=2)+'\n');annotation.annotate(target,{'strategy':'actual target contour +1world margin','piecesPerRegion':'bounded local pieces','hurtboxes':boxes,'root':root.tolist(),'scaleToWorld':1/scale},overlay)
    return data

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--packet',type=Path,required=True);ap.add_argument('--output',type=Path,required=True);ap.add_argument('--overlay',type=Path,required=True);ap.add_argument('--protected-regions',default='');ap.add_argument('--core-probes',type=Path);ap.add_argument('--hand-piece-limit',type=int,choices=[3,4,5,6]);a=ap.parse_args()
    r=fit(a.packet,a.output,a.overlay,tuple(filter(None,a.protected_regions.split(','))),a.core_probes,a.hand_piece_limit);print(json.dumps({'primitives':r['primitiveCount'],'diagnostics':r['targetAlphaDiagnostics']}))
