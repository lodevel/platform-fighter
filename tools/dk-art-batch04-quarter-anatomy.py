#!/usr/bin/env python3
"""Quarter target-only anatomy proposals from cached source ownership priors.

No source mesh evaluation, GPU, shipping mutation or collision acceptance.
"""
from pathlib import Path
import hashlib,json,argparse
import numpy as np
from scipy.ndimage import gaussian_filter,convolve
from scipy.spatial import cKDTree
from PIL import Image,ImageDraw

ROOT=Path(__file__).resolve().parents[1]
ART=ROOT/'docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/art'
SCALE=5/6.5
COLORS=[(217,70,70),(170,65,170),(240,190,50),(75,150,230),(40,210,200),(30,160,80),(150,100,230),(60,90,200),(245,130,40),(130,185,50),(215,110,175),(100,215,140),(150,155,245),(245,130,150),(230,220,120)]
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def pmask(size,pts):
    m=Image.new('L',size);ImageDraw.Draw(m).polygon([(x/4,y/4) for x,y in pts],fill=255);return np.asarray(m)>0
HEAD={10:[(549,280),(540,244),(578,205),(638,202),(680,211),(696,253),(696,285),(716,311),(721,338),(743,374),(737,407),(700,422),(660,419),(616,408),(580,377),(562,339)]}
COSMETIC={10:[(630,568),(650,576),(689,599),(729,633),(744,651),(723,655),(688,632),(657,604)]}
def main():
    prep=json.loads((ART/'dk-firstclips-batch04-preparation.json').read_text());rows={r['nativeSample']:r for r in prep['records']};outputs=[]
    parser=argparse.ArgumentParser();parser.add_argument("--native",type=int,choices=[10]);args=parser.parse_args()
    for native in ([args.native] if args.native is not None else [10]):
        key=rows[native]['prefix'];stem=f'dk-firstclips-batch04-clean1-{key}'
        source=ART/(stem+'-cutout-candidate.png');full=Image.open(source).convert('RGBA');target=ART/(stem+'-quarter-candidate.png');img=full.resize((384,256),Image.Resampling.LANCZOS);img.save(target)
        a=np.asarray(img);visible=a[:,:,3]>=32;cosmetic=visible&pmask(img.size,COSMETIC[native]) if native in COSMETIC else np.zeros(visible.shape,bool)
        mask=visible&~cosmetic;ys,xs=np.where(mask);coords=np.stack(((xs+.5-128)*SCALE,42+(ys+.5-208)*SCALE),axis=1)
        priorsfile=ART/(key+'-anatomy-source.json');priors=json.loads(priorsfile.read_text());regions=list(priors['projectedPointsByRegion']);transform=rows[native]['floorTransform'];ratio=71/(transform['inputLastPixelY']-760+1)
        # Apply the identical inclusive support-band policy to priors, before
        # target ownership competition. Source points are not collision bounds.
        distances=[]
        for region in regions:
            points=np.asarray(priors['projectedPointsByRegion'][region],dtype=float);py=(points[:,1]-42)/(5/26)+832
            py=np.where(py>=760,760+(py-760)*ratio,py);points[:,1]=42+(py-832)*5/26
            distances.append(cKDTree(points).query(coords,workers=1)[0])
        norm=gaussian_filter(mask.astype(float),3);smooth=[]
        for values in distances:
            field=np.zeros(mask.shape);field[ys,xs]=values;smooth.append((gaussian_filter(field,3)/np.maximum(norm,1e-9))[ys,xs])
        labels=np.zeros(mask.shape,np.uint8);labels[ys,xs]=np.asarray(smooth).argmin(axis=0)+1
        votes=np.stack([convolve((labels==i+1).astype(np.uint8),np.ones((3,3),np.uint8),mode='constant') for i in range(len(regions))]);labels[mask]=votes.argmax(axis=0)[mask]+1
        labels[mask&pmask(img.size,HEAD[native])]=regions.index('head')+1
        # The retracted front fist occludes the body and part of the near foot;
        # visible foot sliver remains independent. Late recovery both fists are
        # named separately; no head/cream-skin merge.
        handpolys={10:{'handl':[(439,220),(489,202),(525,215),(566,232),(556,273),(531,309),(494,331),(456,311),(431,285),(423,250)],'handr':[(757,224),(800,214),(833,212),(870,228),(902,262),(914,307),(890,325),(860,301),(820,292),(772,298),(723,284),(709,261)]}}
        for region,points in handpolys[native].items():labels[mask&pmask(img.size,points)]=regions.index(region)+1
        colored=np.zeros_like(a);colored[:,:,3]=np.where(mask,255,0);records={};counts={}
        for i,r in enumerate(regions):
            chosen=labels==i+1;ry,rx=np.where(chosen);colored[chosen,:3]=COLORS[i];records[r]=np.stack(((rx+.5-128)*SCALE,42+(ry+.5-208)*SCALE),axis=1).round(6).tolist();counts[r]={'targetPixels':int(chosen.sum()),'sampledCloudPoints':len(rx),'pixelBounds':None if not len(rx) else [int(rx.min()),int(ry.min()),int(rx.max()),int(ry.max())]}
        labelpath=ART/(stem+'-quarter-anatomy-labels.png');Image.fromarray(labels).save(labelpath);segpath=ART/(stem+'-quarter-anatomy-segmentation.png');Image.fromarray(colored).save(segpath)
        cosmeticpath=ART/(stem+'-quarter-cosmetic-mask.png');Image.fromarray((cosmetic*255).astype(np.uint8)).save(cosmeticpath)
        overlay=Image.new('RGBA',img.size,(25,30,39,255));overlay.alpha_composite(img);tint=Image.fromarray(colored);tint.putalpha(Image.fromarray((mask*140).astype(np.uint8)));overlay.alpha_composite(tint);draw=ImageDraw.Draw(overlay)
        for i,r in enumerate(regions):
            yy,xx=np.where(labels==i+1)
            if len(xx):draw.text((float(np.median(xx)),float(np.median(yy))),r,fill='white',stroke_width=1,stroke_fill='black')
        overlay.save(ART/(stem+'-quarter-anatomy-overlay.png'))
        last=int(np.where(visible)[0].max());report={'state':'authored_quarter_target_anatomy_proposal_unreviewed','nativeSample':native,'gameplayAge':rows[native]['gameplayAge'],'artFrameIndex':0,'root':[128,208],'scaleToWorld':SCALE,'bodyCentreFromRootY':-42,'targetImage':str(target.relative_to(ROOT)),'targetImageSha256':sha(target),'sourceFullImage':str(source.relative_to(ROOT)),'sourceFullImageSha256':sha(source),'dimensions':[384,256],'floorPixelCentreWorldDelta':(last+.5-208)*SCALE,'sourceOwnershipPrior':str(priorsfile.relative_to(ROOT)),'sourceOwnershipPriorSha256':sha(priorsfile),'sourcePriorFloorWarp':{**transform,'inclusiveRatio':ratio},'coordinatePolicy':'Pixel centres x=(px+.5-128)*5/6.5; y=42+(py+.5-208)*5/6.5. Source priors receive recorded support warp; target pixels unchanged.','cosmeticReceivingExclusions':priors['cosmeticReceivingExclusions'],'targetCosmeticOnlyMask':str(cosmeticpath.relative_to(ROOT)),'targetCosmeticOnlyMaskSha256':sha(cosmeticpath),'targetCosmeticOnlyExclusionPixels':int(cosmetic.sum()),'alpha32VisibleTargetPixels':int(visible.sum()),'alpha32TargetPixels':int(mask.sum()),'authoredVisibleHeadPolygonFullArt':HEAD[native],'targetRegionCounts':counts,'projectedPointsByRegion':records,'labelImage':str(labelpath.relative_to(ROOT)),'labelImageSha256':sha(labelpath),'regionLabelIds':{r:i+1 for i,r in enumerate(regions)},'segmentationImage':str(segpath.relative_to(ROOT)),'segmentationImageSha256':sha(segpath),'reviewedForShipping':False,'actualContactVerified':False,'method':'Cached source ownership smoothed3quarterpixels then3x3 majority, authored actual head polygon. Actual target alpha boundary. All target region pixel centres retained. Source points not required enclosed.','limits':['Cached2D priors omit occlusion/depth; named region overlap requires actual inspection.','Authored target adaptation; no native hit_data or native3D parity.'],'toolSha256':sha(Path(__file__))}
        out=ART/(stem+'-quarter-anatomy-proposal.json');out.write_text(json.dumps(report,indent=2)+'\n');outputs.append({'native':native,'proposal':str(out.relative_to(ROOT)),'floor':report['floorPixelCentreWorldDelta'],'counts':counts})
    print(json.dumps(outputs,indent=2))

if __name__=='__main__':main()
