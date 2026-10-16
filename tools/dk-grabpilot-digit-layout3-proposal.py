"""Manual actual-target digit layouts and probes; no fitter/optimizer or shipping."""
from pathlib import Path
import json,hashlib,math,importlib.util
import numpy as np
from PIL import Image,ImageDraw
ROOT=Path(__file__).resolve().parents[1]
ART=ROOT/'docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/art'
AXES={
 'grab':[((220,147),(230,138),(241,147)),((236,157),(253,158),(249,163)),((234,166),(247,170),(244,175)),((229,176),(237,180),(237,183)),((222,179),(236,188),(243,191))],
 'dash_grab':[((230,145),(242,136),(256,146)),((244,156),(266,157),(265,163)),((241,166),(262,169),(258,175)),((238,176),(250,181),(250,184)),((231,181),(244,188),(254,192))],
 'pivot_grab':[((110,142),(98,137),(96,145)),((108,153),(81,154),(85,160)),((109,161),(87,165),(93,170)),((109,171),(94,175),(103,182)),((110,179),(99,185),(109,188))]}
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def signed_inset(point,c):
 a=np.array([c['start']['x'],c['start']['y']]);z=np.array([c['end']['x'],c['end']['y']]);v=z-a;t=np.clip(np.dot(point-a,v)/max(1e-12,np.dot(v,v)),0,1);return c['radius']-float(np.linalg.norm(point-(a+t*v)))
def main():
    spec=importlib.util.spec_from_file_location('grid_validator',Path(__file__).with_name('dk-target-contour-receiving-fit.py'));validator=importlib.util.module_from_spec(spec);spec.loader.exec_module(validator)
    plan=json.loads((ART/'grab-first-five-receiving-catch-grip-fit-plan-01.json').read_text());rows=[]
    for clip,n in [('grab',8),('dash_grab',11),('pivot_grab',12)]:
        stem=f'grabpilot-{clip}-native{n}-quarter-digit-layout3';out=ART/(stem+'-proposal.json');assert not out.exists()
        source=ART/f'grabpilot-{clip}-native{n}-quarter-hand6-receiving-candidate.json';j=json.loads(source.read_text());owner=ROOT/j['targetOwnershipProposal'];p=json.loads(owner.read_text());target=ROOT/p['targetImage'];assert sha(target)==p['targetImageSha256'];a=np.asarray(Image.open(target).convert('RGBA'));labels=np.asarray(Image.open(ROOT/p['labelImage']));root=np.array(p['root'],float);scale=p['scaleToWorld'];region='handr' if clip=='pivot_grab' else 'handl';label=p['regionLabelIds'][region]
        toworld=lambda xy:np.array([(xy[0]-root[0])*scale,42+(xy[1]-root[1])*scale])
        boxes=[b for b in j['hurtboxPoses'][0]['hurtboxes'] if b['region']!=region];unchanged=json.dumps(boxes,separators=(',',':')).encode();digits=[]
        for index,(start,end,gapseed) in enumerate(AXES[clip]):
            # Exact manually authored axes at pixel centres; no fitting/shrink.
            radius=.6 if index==3 and clip in ['grab','dash_grab'] else 1.2;start=np.array(start,float)+.5;end=np.array(end,float)+.5;wa,wz=toworld(start),toworld(end);c={'start':{'x':float(wa[0]),'y':float(wa[1])},'end':{'x':float(wz[0]),'y':float(wz[1])},'radius':radius};b={'id':f'donkeykong.target.{region}.digit{index}','region':region,'offsetX':float((wa[0]+wz[0])/2),'offsetY':float((wa[1]+wz[1])/2),'width':float(abs(wa[0]-wz[0])+2*radius),'height':float(abs(wa[1]-wz[1])+2*radius),'capsule':c};boxes.append(b)
            # Per-digit cloud is actual named hand pixels within3quarterpx of
            # the reviewed axis; this is an authoring input, not fitted bounds.
            yy,xx=np.where(labels==label);points=np.column_stack((xx+.5,yy+.5));v=end-start;t=np.clip(((points-start)*v).sum(axis=1)/max(1e-12,np.dot(v,v)),0,1);near=np.linalg.norm(points-(start+t[:,None]*v),axis=1)<=3;cloud=points[near]
            mid=(start+end)/2;choices=[]
            for y in range(max(0,int(mid[1])-3),min(labels.shape[0],int(mid[1])+4)):
                for x in range(max(0,int(mid[0])-3),min(labels.shape[1],int(mid[0])+4)):
                    pt=toworld((x+.5,y+.5));inset=signed_inset(pt,c)
                    if labels[y,x]==label and a[y,x,3]>=192 and inset>.15:choices.append((float(np.linalg.norm(np.array([x+.5,y+.5])-mid)),x,y,inset))
            assert choices, (clip,index,'missing actual skin core');_,x,y,inset=min(choices)
            digits.append({'digit':['thumb','index','middle','ring','little'][index],'axisQuarterPixelCentres':[start.tolist(),end.tolist()],'manualRadiusWorld':radius,'actualNamedSkinSubcloudPixelCentres':cloud.tolist(),'actualNamedSkinSubcloudActorWorld':[toworld(pt).tolist() for pt in cloud],'contactProbe':{'pixel':[x,y],'RGBA':a[y,x].tolist(),'region':region,'actorRelativeWorldPoint':{'x':float(toworld((x+.5,y+.5))[0]),'y':float(toworld((x+.5,y+.5))[1])},'primitiveInsetWorld':inset},'gapSeed':gapseed,'capsule':c,'tipScope':'manual straight thin axis intentionally inset from tips/side rims; final receiving adaptation and actual resolver tests pending'})
        seed=next(r for r in plan['targets'] if r['clip']==clip)['gripProposal'];core=np.array(seed['pixel'],float)/4+.125;wc=toworld(core);c={'start':{'x':float(wc[0]),'y':float(wc[1])},'end':{'x':float(wc[0]),'y':float(wc[1])},'radius':6};boxes.append({'id':f'donkeykong.target.{region}.palmcore','region':region,'offsetX':float(wc[0]),'offsetY':float(wc[1]),'width':12,'height':12,'capsule':c})
        for digit in digits:
            gx,gy=digit['gapSeed'];options=[]
            for y in range(max(0,gy-3),min(a.shape[0],gy+4)):
                for x in range(max(0,gx-3),min(a.shape[1],gx+4)):
                    pt=toworld((x+.5,y+.5));distance=-max(signed_inset(pt,b['capsule']) for b in boxes)
                    if a[y,x,3]==0 and distance>.15:options.append((math.hypot(x-gx,y-gy),x,y,distance))
            assert options,(clip,digit['digit'],'missing adjacent transparent miss');_,x,y,distance=min(options);digit['transparentGapMiss']={'pixel':[x,y],'RGBA':a[y,x].tolist(),'actorRelativeWorldPoint':{'x':float(toworld((x+.5,y+.5))[0]),'y':float(toworld((x+.5,y+.5))[1])},'distanceOutsideEveryCandidatePrimitiveWorld':distance,'scope':'actual alpha0 pixel outside proposed receiving; future normal resolver finite sensor footprint must also avoid neighboring anatomy'}
        assert unchanged==json.dumps([b for b in boxes if b['region']!=region],separators=(',',':')).encode()
        allowed=validator.dilation(labels>0,1/scale);union=np.zeros(labels.shape,bool);violations=[]
        for b in boxes:
            c=b['capsule'];aa=root+np.array([c['start']['x']/scale,(c['start']['y']-42)/scale]);zz=root+np.array([c['end']['x']/scale,(c['end']['y']-42)/scale]);x,y=validator.capsule_grid(aa,zz,c['radius']/scale);valid=(x>=0)&(y>=0)&(x<labels.shape[1])&(y<labels.shape[0]);spill=int((~valid).sum())+int((~allowed[y[valid],x[valid]]).sum());violations.append({'id':b['id'],'outside1WorldAnatomicalMarginPixels':spill});union[y[valid],x[valid]]=True
        overlay=Image.new('RGBA',tuple(p['dimensions']),(25,30,39,255));overlay.alpha_composite(Image.fromarray(a));draw=ImageDraw.Draw(overlay)
        for k,d in enumerate(digits):
            start,end=[tuple(t) for t in d['axisQuarterPixelCentres']];draw.line((start,end),fill=(70,190,250),width=2);draw.text(end,str(k),fill='white');x,y=d['contactProbe']['pixel'];draw.ellipse((x-1,y-1,x+2,y+2),fill=(40,255,100));x,y=d['transparentGapMiss']['pixel'];draw.line((x-2,y-2,x+2,y+2),fill=(255,100,230));draw.line((x-2,y+2,x+2,y-2),fill=(255,100,230))
        draw.ellipse((core[0]-6/scale,core[1]-6/scale,core[0]+6/scale,core[1]+6/scale),outline=(250,200,70));ov=ART/(stem+'-axes-skin-gap-overlay.png');overlay.resize((overlay.width*3,overlay.height*3),Image.Resampling.NEAREST).save(ov)
        digitmask=(labels==label);candidate={'state':'manual_actual_target_digit_layout_not_fitted_or_accepted','clip':clip,'nativeSample':n,'artFrameIndex':0,'sourceReceivingCandidate':str(source.relative_to(ROOT)),'sourceReceivingCandidateSha256':sha(source),'sourceOwnershipProposal':str(owner.relative_to(ROOT)),'sourceOwnershipProposalSha256':sha(owner),'targetImage':p['targetImage'],'targetImageSha256':p['targetImageSha256'],'root':p['root'],'scaleToWorld':scale,'bodyCentreFromRootY':-42,'activeHandRegion':region,'digits':digits,'palmCore':{'actualFullTargetPixel':seed['pixel'],'quarterPixelCentre':core.tolist(),'capsule':c,'radiusWorld':6,'scope':'actual independent palm skin seed, manually small radius; not native constraint'},'hurtboxPoses':[{'artFrameIndex':0,'nativeSample':n,'hurtboxes':boxes}],'unchangedOtherRegionPrimitivesSha256':hashlib.sha256(unchanged).hexdigest(),'allNonActiveHandPrimitivesUnchanged':True,'staticValidation':{'perPrimitiveMargin':violations,'outside1WorldAnatomicalMarginPixels':sum(v['outside1WorldAnatomicalMarginPixels'] for v in violations),'maxReceivingBottomWorld':max(max(b['capsule']['start']['y'],b['capsule']['end']['y'])+b['capsule']['radius'] for b in boxes),'activeHandTargetCoverage':float((union&digitmask).sum()/max(1,digitmask.sum()))},'annotatedLayout':str(ov.relative_to(ROOT)),'annotatedLayoutSha256':sha(ov),'fitterRun':False,'optimizerRun':False,'nativeEvaluationRun':False,'GPUUsed':False,'targetRGBAChanged':False,'ownershipChanged':False,'canonicalWrites':False,'actualContactVerified':False,'toolSha256':sha(Path(__file__))}
        # Correct core record explicitly: c in the validation loop is local.
        candidate['palmCore']['capsule']=boxes[-1]['capsule'];out.write_text(json.dumps(candidate,indent=2)+'\n');rows.append({'clip':clip,'proposal':str(out.relative_to(ROOT)),'sha256':sha(out),'staticValidation':candidate['staticValidation']})
    receipt=ART/'grab-first-three-manual-digit-layout3-proposal-pins.json';assert not receipt.exists();receipt.write_text(json.dumps({'state':'manual_target_layouts_actual_review_pending','rows':rows,'fitterRun':False,'optimizerRun':False,'canonicalWrites':False},indent=2)+'\n');print(receipt.name,sha(receipt))
if __name__=='__main__':main()
