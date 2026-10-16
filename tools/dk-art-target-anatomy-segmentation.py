#!/usr/bin/env python3
"""Authored target-only segmentation proposals from cached source anatomy priors.
No native mesh evaluation, generator or shipping mutation. Source clouds name
regions only; actual alpha32 defines target silhouette. Cached 2D priors omit
occlusion/depth and must be independently reviewed before collision fitting.
"""
from pathlib import Path
import hashlib,json
import numpy as np
from scipy.spatial import cKDTree
from scipy.ndimage import convolve,gaussian_filter
from PIL import Image,ImageDraw
ART=Path('docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/art')
SCALE=5/26
PALETTE=[(217,70,70),(170,65,170),(240,190,50),(75,150,230),(40,210,200),(30,160,80),(150,100,230),(60,90,200),(245,130,40),(130,185,50),(215,110,175),(100,215,140),(150,155,245),(245,130,150),(230,220,120)]
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def segment(key):
    source=ART/f'{key}-anatomy-without-cosmetic-tie.json'
    target=ART/f'firstcontact-clean3-{key}-cutout.png'
    packet=json.loads(source.read_text());img=Image.open(target).convert('RGBA');a=np.asarray(img)
    visible_alpha=a[:,:,3]>=32
    # Actual dangling cloth has no anatomical body behind it. Torso under
    # cloth remains damage receiving; only the inspected exposed tail excluded.
    cosmetic_polygons={'jab2-native4':[(702,550),(710,550),(755,640),(733,645),(660,591),(681,570),(690,560)]}
    cosmetic=Image.new('L',img.size)
    if key in cosmetic_polygons:ImageDraw.Draw(cosmetic).polygon(cosmetic_polygons[key],fill=255)
    cosmetic_mask=visible_alpha&(np.asarray(cosmetic)>0)
    cosmetic.putdata((cosmetic_mask.reshape(-1)*255).astype(np.uint8))
    cosmetic_path=ART/f'{key}-clean3-target-cosmetic-only-mask.png';cosmetic.save(cosmetic_path)
    mask=visible_alpha&~cosmetic_mask;ys,xs=np.where(mask)
    coords=np.stack(((xs+.5-512)*SCALE,42+(ys+.5-832)*SCALE),axis=1)
    regions=list(packet['projectedPointsByRegion'])
    distances=[]
    for region in regions:
        pts=np.asarray(packet['projectedPointsByRegion'][region],dtype=float)
        distances.append(cKDTree(pts).query(coords,workers=1)[0])
    distances=np.asarray(distances)
    # Smooth distance priors before competition, avoiding sparse vertex density
    # and hidden-surface mottling. Alpha boundaries remain unchanged.
    norm=gaussian_filter(mask.astype(np.float32),12)
    smooth=[]
    for values in distances:
        field=np.zeros(mask.shape,np.float32);field[ys,xs]=values
        smooth.append((gaussian_filter(field,12)/np.maximum(norm,1e-9))[ys,xs])
    raw=np.asarray(smooth).argmin(axis=0).astype(np.uint8)+1
    labels=np.zeros(mask.shape,np.uint8);labels[ys,xs]=raw
    # Majority avoids vertex-density speckle without moving the target boundary.
    votes=np.stack([convolve((labels==i+1).astype(np.uint8),np.ones((5,5),np.uint8),mode='constant') for i in range(len(regions))])
    labels[mask]=votes.argmax(axis=0)[mask]+1
    # Visible target skull/muzzle bounds reviewed against the actual target,
    # not native RGB. This prevents hidden torso seeds labelling facial skin.
    head_polygons={'jab1-native5':[(486,338),(700,333),(714,471),(736,590),(704,646),(628,667),(541,642),(480,588),(477,464)],'jab2-native4':[(532,168),(751,165),(749,316),(814,361),(814,450),(748,487),(659,439),(547,413)],'dtilt-native6':[(580,523),(721,524),(754,586),(775,633),(845,668),(849,754),(836,819),(735,823),(643,798),(571,778),(551,676),(549,601)]}
    hmask=Image.new('L',img.size);ImageDraw.Draw(hmask).polygon(head_polygons[key],fill=255)
    labels[mask&(np.asarray(hmask)>0)]=regions.index('head')+1
    colored=np.zeros_like(a);colored[:,:,3]=np.where(mask,255,0)
    records={};counts={}
    for i,region in enumerate(regions):
        chosen=labels==i+1;ry,rx=np.where(chosen);colored[chosen,:3]=PALETTE[i%len(PALETTE)]
        # Clouds sampled every2pixels, plus regional alpha boundary, reducing
        # cached JSON volume while retaining support extents for compact fitting.
        interior=(ry%2==0)&(rx%2==0)
        neighbors=convolve(chosen.astype(np.uint8),np.ones((3,3),np.uint8),mode='constant')
        edge=neighbors[ry,rx]<9;keep=interior|edge
        records[region]=np.stack(((rx[keep]+.5-512)*SCALE,42+(ry[keep]+.5-832)*SCALE),axis=1).round(6).tolist()
        counts[region]={'targetPixels':int(chosen.sum()),'sampledCloudPoints':int(keep.sum()),'pixelBounds':None if len(rx)==0 else [int(rx.min()),int(ry.min()),int(rx.max()),int(ry.max())]}
    labelimage=ART/f'{key}-clean3-target-anatomy-labels.png';Image.fromarray(labels).save(labelimage)
    seg=Image.fromarray(colored);segpath=ART/f'{key}-clean3-target-anatomy-segmentation.png';seg.save(segpath)
    bg=Image.new('RGBA',img.size,(28,30,36,255));bg.alpha_composite(img);tint=seg.copy();tint.putalpha(Image.fromarray(np.where(mask,140,0).astype(np.uint8)));bg.alpha_composite(tint)
    draw=ImageDraw.Draw(bg)
    draw.text((20,20),'UNREVIEWED target alpha anatomy: cached 2D source seeds; authored adaptation',fill='white')
    for i,region in enumerate(regions):
        yy,xx=np.where(labels==i+1)
        if len(xx):draw.text((float(np.median(xx)),float(np.median(yy))),region,fill='white',stroke_fill='black',stroke_width=1)
    bg.save(ART/f'{key}-clean3-target-anatomy-overlay.png')
    report={'state':'authored_target_anatomy_segmentation_proposal_unreviewed','nativeSample':packet['nativeSample'],'artFrameIndex':0,'root':[512,832],'scaleToWorld':SCALE,'bodyCentreFromRootY':-42,'targetImage':str(target),'targetImageSha256':sha(target),'sourceOwnershipPrior':str(source),'sourceOwnershipPriorSha256':sha(source),'cosmeticReceivingExclusions':packet['cosmeticReceivingExclusions'],'method':'Cached per-anatomical-region vertex nearest-distance fields smoothed sigma12artpx, then5x5 majority within alpha32. Authored actual target skull/muzzle polygon excludes hidden torso priors. Source priors do not require point enclosure.','coordinatePolicy':'Pixel centres: x=(px+.5-512)*5/26; y=42+(py+.5-832)*5/26. Existing source support warp already in cached priors. No further target warp.','sourceLimits':['Cached2D source points lack per-vertex depth/occlusion; overlapping anatomical parts require inspection.','No native hit_data or exact native3D receiving parity.','Cosmetic necktie source vertices excluded as seeds; underlying visible clothed skin alpha can still be assigned anatomical torso.'],'alpha32VisibleTargetPixels':int(visible_alpha.sum()),'targetCosmeticOnlyExclusionPixels':int(cosmetic_mask.sum()),'targetCosmeticOnlyPolygon':cosmetic_polygons.get(key),'targetCosmeticOnlyMask':str(cosmetic_path),'targetCosmeticOnlyMaskSha256':sha(cosmetic_path),'alpha32TargetPixels':int(mask.sum()),'authoredVisibleHeadPolygon':head_polygons[key],'targetRegionCounts':counts,'projectedPointsByRegion':records,'labelImage':str(labelimage),'labelImageSha256':sha(labelimage),'regionLabelIds':{r:i+1 for i,r in enumerate(regions)},'segmentationImage':str(segpath),'segmentationImageSha256':sha(segpath),'reviewedForShipping':False,'actualContactVerified':False,'toolSha256':sha(Path(__file__))}
    out=ART/f'{key}-clean3-target-anatomy-proposal.json';out.write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'key':key,'output':str(out),'targetPixels':int(mask.sum()),'regions':counts}))
if __name__=='__main__':
    for key in ['jab1-native5','jab2-native4','dtilt-native6']:segment(key)
