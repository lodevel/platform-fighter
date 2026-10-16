"""Bounded reviewed digit-axis/palm fit; preserves every other region exactly."""
from pathlib import Path
import argparse,json,hashlib,importlib.util
import numpy as np
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]
ART=ROOT/'docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/art'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def inset(point,c):
    a=np.array([c['start']['x'],c['start']['y']]);z=np.array([c['end']['x'],c['end']['y']]);v=z-a;t=np.clip(np.dot(point-a,v)/max(1e-12,np.dot(v,v)),0,1);return c['radius']-float(np.linalg.norm(point-(a+t*v)))
def main():
    ap=argparse.ArgumentParser();ap.add_argument('--clip',required=True,choices=['grab','dash_grab','pivot_grab']);ap.add_argument('--fitter-resource-released',action='store_true');args=ap.parse_args()
    if not args.fitter_resource_released:raise ValueError('Root must release bounded fitter resource')
    n={'grab':8,'dash_grab':11,'pivot_grab':12}[args.clip];prefix=f'grabpilot-{args.clip}-native{n}-quarter-branchcore1';out=ART/(prefix+'-receiving-candidate.json');logpath=ART/(prefix+'-fit-log.json');assert not out.exists() and not logpath.exists()
    layoutpath=ART/f'grabpilot-{args.clip}-native{n}-quarter-digit-layout4-proposal.json';layout=json.loads(layoutpath.read_text());inputreview=ART/'root-grab-first-three-manual-digit-layout4-input-review.json';assert sha(inputreview)=='e8937d35e65c038d35ca963f46d0a6bfa779afa1de2a1789ac2c28efd6cf1400'
    pins=json.loads((ART/'grab-first-three-manual-digit-layout4-proposal-pins.json').read_text());assert sha(layoutpath)==next(r for r in pins['rows'] if r['clip']==args.clip)['sha256']
    ownerpath=ROOT/layout['sourceOwnershipProposal'];assert sha(ownerpath)==layout['sourceOwnershipProposalSha256'];p=json.loads(ownerpath.read_text());target=ROOT/layout['targetImage'];assert sha(target)==layout['targetImageSha256'];labelpath=ROOT/p['labelImage'];assert sha(labelpath)==p['labelImageSha256'];labels=np.asarray(Image.open(labelpath));alpha=np.asarray(Image.open(target).convert('RGBA'))[:,:,3]>=32;region=layout['activeHandRegion'];handmask=labels==p['regionLabelIds'][region]
    sourcepath=ROOT/layout['sourceReceivingCandidate'];assert sha(sourcepath)==layout['sourceReceivingCandidateSha256'];source=json.loads(sourcepath.read_text());other=[b for b in source['hurtboxPoses'][0]['hurtboxes'] if b['region']!=region];otherbytes=json.dumps(other,separators=(',',':')).encode();assert hashlib.sha256(otherbytes).hexdigest()==layout['unchangedOtherRegionPrimitivesSha256']
    spec=importlib.util.spec_from_file_location('static_capsule_validator',Path(__file__).with_name('dk-target-contour-receiving-fit.py'));module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    scale=p['scaleToWorld'];pixel_scale=1/scale;root=np.array(p['root'],float);allowed=module.dilation(handmask,pixel_scale)&module.dilation(labels>0,pixel_scale);gap=[np.array([d['transparentGapMiss']['actorRelativeWorldPoint']['x'],d['transparentGapMiss']['actorRelativeWorldPoint']['y']]) for d in layout['digits']]
    evaluations=0;log=[]
    def capsule(a,z,r):return {'start':{'x':float(a[0]),'y':float(a[1])},'end':{'x':float(z[0]),'y':float(z[1])},'radius':float(r)}
    def safe(a,z,r):
        nonlocal evaluations;evaluations+=1
        if max(a[1],z[1])+r>42.55:return False
        c=capsule(a,z,r)
        if any(inset(point,c)>-.151 for point in gap):return False
        aa=root+np.array([a[0]*pixel_scale,(a[1]-42)*pixel_scale]);zz=root+np.array([z[0]*pixel_scale,(z[1]-42)*pixel_scale]);return module.safe(aa,zz,r*pixel_scale,allowed,root[1],pixel_scale)
    boxes=list(other);selected=[]
    for d in layout['digits']:
        base=d['capsule'];a0=np.array([base['start']['x'],base['start']['y']]);z0=np.array([base['end']['x'],base['end']['y']]);centre=(a0+z0)/2;points=np.array(d['actualNamedSkinSubcloudActorWorld']);probe=np.array([d['contactProbe']['actorRelativeWorldPoint']['x'],d['contactProbe']['actorRelativeWorldPoint']['y']]);candidates=[]
        for fraction in [1,.85,1.15]:
            a=centre+(a0-centre)*fraction;z=centre+(z0-centre)*fraction;axis=(z-a)/np.linalg.norm(z-a);normal=np.array([-axis[1],axis[0]]);rmax=float(np.max(np.abs((points-centre)@normal)))+1;lo,hi=0,rmax
            for _ in range(14):
                r=(lo+hi)/2
                if safe(a,z,r):lo=r
                else:hi=r
            c=capsule(a,z,lo);v=z-a;t=np.clip(((points-a)*v).sum(axis=1)/np.dot(v,v),0,1);coverage=float((np.linalg.norm(points-(a+t[:,None]*v),axis=1)<=lo).mean());ok=lo>0 and inset(probe,c)>.15
            candidates.append({'endpointFraction':fraction,'radiusWorld':lo,'subcloudCoverage':coverage,'contactInsetWorld':inset(probe,c),'validContact':ok,'capsule':c})
        feasible=[c for c in candidates if c['validContact']];assert feasible,(args.clip,d['digit'],'no bounded feasible candidate');chosen=max(feasible,key=lambda c:(c['subcloudCoverage'],c['radiusWorld']));log.append({'digit':d['digit'],'finiteMenu':candidates,'selected':chosen});selected.append({'digit':d['digit'],'capsule':chosen['capsule']})
    core=layout['palmCore']['capsule'];a=np.array([core['start']['x'],core['start']['y']]);z=a.copy();sourceplan=json.loads((ART/'grab-first-five-receiving-catch-grip-fit-plan-01.json').read_text());seed=next(r for r in sourceplan['targets'] if r['clip']==args.clip)['gripProposal'];lo,hi=0,float(seed['interiorSkinDistanceWorld'])+1
    for _ in range(16):
        r=(lo+hi)/2
        if safe(a,z,r):lo=r
        else:hi=r
    assert lo>0;selected.append({'digit':'palmcore','capsule':capsule(a,z,lo)});log.append({'palmCoreMaximumBoundFromActualSkinWorld':hi,'selectedRadiusWorld':lo,'binarySteps':16})
    for item in selected:
        c=item['capsule'];a,z=c['start'],c['end'];r=c['radius'];boxes.append({'id':f'donkeykong.target.{region}.branchcore1.{item["digit"]}','region':region,'offsetX':(a['x']+z['x'])/2,'offsetY':(a['y']+z['y'])/2,'width':abs(a['x']-z['x'])+2*r,'height':abs(a['y']-z['y'])+2*r,'capsule':c})
    assert otherbytes==json.dumps([b for b in boxes if b['region']!=region],separators=(',',':')).encode();union=np.zeros(labels.shape,bool);anatomical_allowed=module.dilation(labels>0,pixel_scale)
    for b in boxes:
        c=b['capsule'];a=root+np.array([c['start']['x']*pixel_scale,(c['start']['y']-42)*pixel_scale]);z=root+np.array([c['end']['x']*pixel_scale,(c['end']['y']-42)*pixel_scale]);x,y=module.capsule_grid(a,z,c['radius']*pixel_scale);union[y,x]=True
    probes=[]
    for d in layout['digits']:
        point=np.array(list(d['contactProbe']['actorRelativeWorldPoint'].values()));contact=max(inset(point,b['capsule']) for b in boxes if b['region']==region);point=np.array(list(d['transparentGapMiss']['actorRelativeWorldPoint'].values()));clearance=-max(inset(point,b['capsule']) for b in boxes);assert contact>.15 and clearance>.15;probes.append({'digit':d['digit'],'contactProbe':d['contactProbe'],'transparentGapMiss':d['transparentGapMiss'],'finalActiveHandPrimitiveInsetWorld':contact,'finalAllPrimitiveGapClearanceWorld':clearance})
    diagnostics={'targetAlphaCoverage':float((union&alpha).sum()/alpha.sum()),'anatomicalTargetCoverage':float((union&(labels>0)).sum()/(labels>0).sum()),'activeHandTargetCoverage':float((union&handmask).sum()/handmask.sum()),'receivingOutsideAuthoredMarginPixels':int((union&~anatomical_allowed).sum()),'cosmeticOnlyTargetIntersectionPixels':int((union&alpha&(labels==0)).sum()),'cosmeticOnlyOutsideAnatomicalMarginPixels':int((union&alpha&(labels==0)&~anatomical_allowed).sum()),'maxReceivingBottomWorld':max(max(b['capsule']['start']['y'],b['capsule']['end']['y'])+b['capsule']['radius'] for b in boxes)};assert diagnostics['receivingOutsideAuthoredMarginPixels']==0 and diagnostics['maxReceivingBottomWorld']<=42.55
    execution={'state':'one_bounded_branch_and_palm_fit_completed','toolSha256':sha(Path(__file__)),'layoutSha256':sha(layoutpath),'inputOwnershipSha256':sha(ownerpath),'sourceReceivingSha256':sha(sourcepath),'endpointMenu':[1,.85,1.15],'radiusBinaryStepsPerBranch':14,'palmBinarySteps':16,'evaluationCount':evaluations,'maximumEvaluationCount':226,'log':log};assert evaluations<=226;logpath.write_text(json.dumps(execution,indent=2)+'\n')
    result={'state':'bounded_branchcore_receiving_candidate_actual_review_pending','nativeSample':n,'artFrameIndex':0,'targetImage':p['targetImage'],'targetImageSha256':p['targetImageSha256'],'targetOwnershipProposal':str(ownerpath.relative_to(ROOT)),'targetOwnershipProposalSha256':sha(ownerpath),'reviewedDigitLayout':str(layoutpath.relative_to(ROOT)),'reviewedDigitLayoutSha256':sha(layoutpath),'sourceReceivingCandidate':str(sourcepath.relative_to(ROOT)),'sourceReceivingCandidateSha256':sha(sourcepath),'root':p['root'],'scaleToWorld':scale,'bodyCentreFromRootY':-42,'activeHandRegion':region,'authoredMarginWorld':1,'groundedReceivingFloorMaximumY':42.55,'primitiveCount':len(boxes),'hurtboxPoses':[{'artFrameIndex':0,'nativeSample':n,'hurtboxes':boxes}],'targetAlphaDiagnostics':diagnostics,'finalDigitProbes':probes,'allOtherRegionPrimitivesByteEquivalent':True,'otherRegionPrimitiveSerializationSha256':hashlib.sha256(otherbytes).hexdigest(),'fitLog':str(logpath.relative_to(ROOT)),'fitLogSha256':sha(logpath),'geometryProvenance':'bounded actual target-label branch thickness/endpoints and independent palm-core, native anatomy ownership priors only; not native hit_data','targetRGBAChanged':False,'ownershipChanged':False,'canonicalWrites':False,'GPUUsed':False,'actualContactVerified':False,'reviewedForShipping':False};out.write_text(json.dumps(result,indent=2)+'\n');overlay=ART/(prefix+'-receiving-overlay.png');module.annotation.annotate(target,{'strategy':'bounded reviewed five branches + palm core, unaccepted candidate','piecesPerRegion':'active hand6 pieces; other-region geometry unchanged','hurtboxes':boxes,'root':p['root'],'scaleToWorld':scale},overlay);print(json.dumps({'clip':args.clip,'candidate':str(out.relative_to(ROOT)),'sha256':sha(out),'diagnostics':diagnostics,'evaluations':evaluations}))
if __name__=='__main__':main()
