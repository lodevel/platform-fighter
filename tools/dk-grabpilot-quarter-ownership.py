"""One released cached-cloud ownership proposal; no mesh evaluation or fitter."""
from pathlib import Path
import argparse,json,hashlib
import numpy as np
from PIL import Image,ImageDraw
from scipy.ndimage import gaussian_filter,convolve
from scipy.spatial import cKDTree

ROOT=Path(__file__).resolve().parents[1]
ART=ROOT/'docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/art'
SCALE=5/6.5
PALETTE=[(217,70,70),(170,65,170),(240,190,50),(75,150,230),(40,210,200),(30,160,80),(150,100,230),(60,90,200),(245,130,40),(130,185,50),(215,110,175),(100,215,140),(150,155,245),(245,130,150),(230,220,120)]
# Initial explicit proposed cosmetic-only pendant tips; these require review.
COSMETIC={'grab':[(579,747),(615,740),(646,753),(670,794),(653,827),(614,827),(578,806)],'dash_grab':[(630,733),(670,720),(695,741),(698,788),(674,823),(646,801)],'pivot_grab':[(820,735),(847,718),(878,724),(913,746),(941,742),(915,780),(871,783),(843,765)],'grab_pull':[(589,725),(649,716),(659,760),(649,806),(620,829),(580,804)],'grab_hold':[(546,707),(575,683),(586,713),(569,764),(536,774),(520,748)]}
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def mask(size,points):
    m=Image.new('L',size);ImageDraw.Draw(m).polygon([(x/4,y/4) for x,y in points],fill=255);return np.asarray(m)>0
def main():
    p=argparse.ArgumentParser();p.add_argument('--clip',required=True,choices=list(COSMETIC));p.add_argument('--ownership-slot-released',action='store_true');a=p.parse_args()
    if not a.ownership_slot_released:raise ValueError('Root must release cached ownership competition slot')
    plan=ART/'grab-first-five-receiving-catch-grip-fit-plan-01.json';row=next(r for r in json.loads(plan.read_text())['targets'] if r['clip']==a.clip)
    target=ROOT/row['quarterTarget']['path'];full=ROOT/row['target']['path'];assert sha(target)==row['quarterTarget']['sha256'] and sha(full)==row['target']['sha256']
    prior=ART/f'grabpilot-{a.clip}-native{row["nativeSample"]}-anatomy-source.json';source=json.loads(prior.read_text())
    export=ART/'grab-first-five-native-anatomy-source-export-review.json';match=next(r for r in json.loads(export.read_text())['rows'] if r['clip']==a.clip);assert sha(prior)==match['sha256']
    stem=f'grabpilot-{a.clip}-native{row["nativeSample"]}-quarter-ownership1';out=ART/(stem+'-proposal.json')
    if out.exists():raise ValueError('Preserve prior ownership proposal')
    prepname='dk-grabpilot-batch02-attempt2-preparation.json' if a.clip=='pivot_grab' else 'dk-grabpilot-batch01-preparation.json' if a.clip in ['grab','dash_grab'] else 'dk-grabpilot-batch03-preparation.json'
    preparation=json.loads((ART/prepname).read_text());prepared=next(r for r in preparation['records'] if r['clip']==a.clip);warp=prepared['floorTransform'];ratio=(warp['targetLastPixelY']-warp['inputBandStartPixelY']+1)/(warp['inputLastPixelY']-warp['inputBandStartPixelY']+1)
    image=Image.open(target).convert('RGBA');pixels=np.asarray(image);visible=pixels[:,:,3]>=32;cosmetic=visible&mask(image.size,COSMETIC[a.clip]);anatomy=visible&~cosmetic
    root=row['registration']['quarterRoot'];ys,xs=np.where(anatomy);coords=np.stack(((xs+.5-root[0])*SCALE,42+(ys+.5-root[1])*SCALE),axis=1);regions=list(source['projectedPointsByRegion']);distances=[]
    for region in regions:
        points=np.array(source['projectedPointsByRegion'][region],float);py=832+(points[:,1]-42)/(5/26);py=np.where(py>=warp['inputBandStartPixelY'],warp['inputBandStartPixelY']+(py-warp['inputBandStartPixelY'])*ratio,py);points[:,1]=42+(py-832)*5/26
        distances.append(cKDTree(points).query(coords,workers=1)[0])
    norm=gaussian_filter(anatomy.astype(float),3);smooth=[]
    for d in distances:
        f=np.zeros(anatomy.shape);f[ys,xs]=d;smooth.append((gaussian_filter(f,3)/np.maximum(norm,1e-9))[ys,xs])
    labels=np.zeros(anatomy.shape,np.uint8);labels[ys,xs]=np.asarray(smooth).argmin(axis=0)+1
    votes=np.stack([convolve((labels==i+1).astype(np.uint8),np.ones((3,3),np.uint8),mode='constant') for i in range(len(regions))]);labels[anatomy]=votes.argmax(axis=0)[anatomy]+1
    # Actual opaque cream in the independently reviewed active-palm ROI is a
    # named hand ownership override; it does not define a capture constraint.
    x0,y0,x1,y1=row['gripProposal']['roiExclusive'];roi=np.zeros(anatomy.shape,bool);roi[y0//4:(y1+3)//4,x0//4:(x1+3)//4]=True
    skin=anatomy&roi&(pixels[:,:,0]>170)&(pixels[:,:,1]>130)&(pixels[:,:,2]>65)&(pixels[:,:,0]>=pixels[:,:,1])&(pixels[:,:,1]>=pixels[:,:,2]);labels[skin]=regions.index(row['gripProposal']['owner'])+1
    records={};counts={};tint=np.zeros_like(pixels);tint[:,:,3]=np.where(anatomy,140,0)
    for i,region in enumerate(regions):
        yy,xx=np.where(labels==i+1);records[region]=np.stack(((xx+.5-root[0])*SCALE,42+(yy+.5-root[1])*SCALE),axis=1).round(6).tolist();counts[region]={'targetPixels':len(xx),'pixelBounds':None if not len(xx) else [int(xx.min()),int(yy.min()),int(xx.max()),int(yy.max())]};tint[labels==i+1,:3]=PALETTE[i]
    label=ART/(stem+'-labels.png');Image.fromarray(labels).save(label);cos=ART/(stem+'-cosmetic-mask.png');Image.fromarray((cosmetic*255).astype(np.uint8)).save(cos)
    overlay=Image.new('RGBA',image.size,(25,30,39,255));overlay.alpha_composite(image);overlay.alpha_composite(Image.fromarray(tint));draw=ImageDraw.Draw(overlay)
    for i,region in enumerate(regions):
        yy,xx=np.where(labels==i+1)
        if len(xx):draw.text((float(np.median(xx)),float(np.median(yy))),region,fill='white',stroke_width=1,stroke_fill='black')
    ov=ART/(stem+'-overlay.png');overlay.save(ov)
    last=int(np.where(visible)[0].max());floor=(last+.5-root[1])*SCALE;assert abs(floor)<=.55
    report={'state':'authored_target_ownership_proposal_actual_review_pending','clip':a.clip,'nativeSample':row['nativeSample'],'gameplayAge':row['selectedGameplayAge'],'artFrameIndex':0,'root':root,'scaleToWorld':SCALE,'bodyCentreFromRootY':-42,'dimensions':list(image.size),'targetImage':str(target.relative_to(ROOT)),'targetImageSha256':sha(target),'sourceFullImage':str(full.relative_to(ROOT)),'sourceFullImageSha256':sha(full),'sourceOwnershipPrior':str(prior.relative_to(ROOT)),'sourceOwnershipPriorSha256':sha(prior),'sourcePriorFloorWarp':{**warp,'inclusiveRatio':ratio},'floorPixelCentreWorldDelta':floor,'cosmeticReceivingExclusions':source['cosmeticReceivingExclusions'],'targetCosmeticOnlyMask':str(cos.relative_to(ROOT)),'targetCosmeticOnlyMaskSha256':sha(cos),'targetCosmeticOnlyExclusionPixels':int(cosmetic.sum()),'targetCosmeticPolygonFullArt':COSMETIC[a.clip],'alpha32VisibleTargetPixels':int(visible.sum()),'alpha32TargetPixels':int(anatomy.sum()),'projectedPointsByRegion':records,'targetRegionCounts':counts,'regionLabelIds':{r:i+1 for i,r in enumerate(regions)},'labelImage':str(label.relative_to(ROOT)),'labelImageSha256':sha(label),'overlayImage':str(ov.relative_to(ROOT)),'overlayImageSha256':sha(ov),'activePalmOverride':row['gripProposal'],'method':'cached15source-region nearest-distance competition,3quarterpixel Gaussian+3x3 majority, actual cream active-palm ownership override; actual target alpha unchanged','limits':['All face/head/wrist/torso/foot boundaries and cosmetic-only exclusions require actual overlay inspection.','Source priors not required enclosed; no native hit_data, target receiving or capture/socket acceptance.'],'reviewedForShipping':False,'actualContactVerified':False,'GPUUsed':False,'fitterRun':False,'toolSha256':sha(Path(__file__))}
    out.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'proposal':str(out.relative_to(ROOT)),'sha256':sha(out),'floor':floor}))
if __name__=='__main__':main()
