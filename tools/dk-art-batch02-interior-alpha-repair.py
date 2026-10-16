#!/usr/bin/env python3
"""Authored target opacity repair within reviewed material interiors only.
No external contour, actual pose gap, registration or shipping mutation.
"""
from pathlib import Path
import hashlib,json
import numpy as np
from scipy.ndimage import binary_fill_holes,distance_transform_edt
from PIL import Image,ImageDraw
ROOT=Path(__file__).resolve().parents[1];ART=ROOT/'docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/art'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def poly(size,pts):
    m=Image.new('L',size);ImageDraw.Draw(m).polygon(pts,fill=255);return np.asarray(m)>0
REGIONS={
7:{'head_fur':[(523,422),(553,390),(610,363),(664,352),(691,373),(701,412),(694,457),(711,505),(704,527),(679,496),(604,515),(553,493),(526,479)],'front_arm_fur':[(696,482),(737,509),(751,554),(773,598),(780,647),(778,697),(752,739),(714,763),(690,741),(706,696),(688,652),(670,626),(677,574)],'back_arm_fur':[(296,420),(360,421),(428,472),(452,501),(419,523),(372,501),(319,484)],'garment':[(452,553),(480,584),(490,641),(529,689),(518,716),(475,692),(452,638)],'support_fur':[(285,712),(401,714),(425,760),(390,779),(285,773)]},
9:{'head_fur':[(537,416),(561,391),(615,373),(666,354),(703,372),(708,412),(700,457),(718,506),(712,532),(695,535),(674,487),(611,523),(562,503),(531,491)],'front_arm_fur':[(710,463),(754,495),(789,553),(816,587),(838,644),(837,679),(810,726),(785,757),(778,687),(739,654),(704,629)],'back_arm_fur':[(297,421),(363,423),(434,473),(458,502),(425,527),(375,509),(320,485)],'garment':[(465,553),(500,590),(512,632),(536,658),(525,717),(467,706),(426,665),(439,628)],'support_fur':[(285,712),(401,714),(425,760),(390,779),(285,773)]},
17:{'head_fur':[(563,401),(584,371),(638,348),(715,339),(737,357),(737,405),(718,461),(732,499),(723,517),(704,519),(681,479),(632,499),(570,489),(550,470)],'right_arm_fur':[(713,498),(750,510),(780,550),(787,581),(778,623),(751,678),(704,661),(714,602)],'back_arm_fur':[(321,440),(382,433),(450,477),(482,507),(516,536),(485,551),(421,517),(366,497)],'garment':[(504,596),(549,638),(588,683),(581,732),(552,784),(505,791),(458,754),(464,704)],'support_fur':[(285,712),(401,714),(425,760),(390,779),(285,773)]}}
def main():
    records=[];ref=Image.open(ART/'firstcontact-clean3-jab1-native5-cutout.png').convert('RGBA');ref=ref.crop(ref.getbbox());ref=ref.resize((round(ref.width*104/ref.height),104),Image.Resampling.LANCZOS)
    for n in [7,9,17]:
        source=ART/f'dk-firstclips-batch02-clean1-firstclips-jab-native{n}-cutout-candidate.png';body=Image.open(source).convert('RGBA');original=np.asarray(body).copy();a=original.copy();visible=original[:,:,3]>=32
        # Fill-holes is a diagnostic classification only. It is NEVER used as
        # a blanket matte: each new opaque pixel also needs an inspected named
        # fur/garment interior. External pose gaps remain connected background.
        envelope=binary_fill_holes(visible);external=~envelope;interior_distance=distance_transform_edt(envelope);closed_holes=envelope&~visible
        region_reports=[];new=np.zeros(visible.shape,bool);repair_union=np.zeros(visible.shape,bool)
        for region,pts in REGIONS[n].items():
            selected=poly(body.size,pts);holes=selected&closed_holes&(interior_distance>3);new|=holes;repair_union|=selected
            region_reports.append({'region':region,'polygonFullArt':pts,'closedMaterialHolePixels':int(holes.sum())})
        # Partial source texture opacity is inappropriate for opaque cartoon
        # fur/skin/cloth. Existing visible interior pixels retain exact alpha32
        # occupancy; edge anti-alias, external holes and pose gaps are preserved.
        partial=visible&(interior_distance>3)&(original[:,:,3]<255)
        a[partial,3]=255;a[new,3]=255
        # Uncovered guide material may have yielded stray gray generated RGB;
        # repair only newly visible actual material interior using nearby red.
        rgb=a[:,:,:3].astype(float);invalid=new&((rgb[:,:,0]<140)|(rgb[:,:,2]>rgb[:,:,0]*.35));good=visible&(rgb[:,:,0]>155)&(rgb[:,:,1]<65)&(rgb[:,:,2]<55)
        _,near=distance_transform_edt(~good,return_indices=True);rgb[invalid]=rgb[near[0][invalid],near[1][invalid]];a[:,:,:3]=np.round(rgb).astype(np.uint8)
        repaired_visible=a[:,:,3]>=32;repaired_external=~binary_fill_holes(repaired_visible)
        if not np.array_equal(external,repaired_external):raise ValueError('External silhouette/pose gap changed')
        yy,xx=np.where(visible);ry,rx=np.where(repaired_visible)
        if [xx.min(),yy.min(),xx.max(),yy.max()]!=[rx.min(),ry.min(),rx.max(),ry.max()]:raise ValueError('Extents changed')
        stem=f'dk-firstclips-batch02-matte1-firstclips-jab-native{n}';out=ART/(stem+'-cutout-candidate.png');final=Image.fromarray(a);final.save(out)
        for mode,color in [('dark',(25,30,39)),('light',(247,246,238))]:
            bg=Image.new('RGBA',body.size,color+(255,));bg.alpha_composite(final);bg.convert('RGB').save(ART/(stem+'-'+mode+'.png'))
        Image.fromarray(a[:,:,3]).save(ART/(stem+'-alpha.png'))
        for mode,bgcol in [('dark',(25,30,39)),('light',(247,246,238)),('alpha',(0,0,0))]:
            beforeafter=Image.new('RGB',(1536,512),bgcol)
            for col,img in enumerate([body,final]):
                if mode=='alpha':
                    disp=img.getchannel('A').resize((768,512),Image.Resampling.LANCZOS).convert('RGB');beforeafter.paste(disp,(col*768,0))
                else:
                    disp=img.resize((768,512),Image.Resampling.LANCZOS);beforeafter.paste(disp,(col*768,0),disp)
            beforeafter.save(ART/(stem+'-before-after-'+mode+'.png'))
        world=Image.new('RGBA',(900,330),(25,30,39,255));ImageDraw.Draw(world).line((0,230,900,230),fill=(95,113,140));world.alpha_composite(ref,(105-ref.width//2,230-ref.height));view=final.resize((round(1536*5/26),round(1024*5/26)),Image.Resampling.LANCZOS)
        for cx,f in [(370,1),(730,-1)]:
            v=view if f==1 else view.transpose(Image.Transpose.FLIP_LEFT_RIGHT);rootx=round(512*5/26) if f==1 else v.width-round(512*5/26);world.alpha_composite(v,(cx-rootx,230-round(832*5/26)))
        world.convert('RGB').save(ART/(stem+'-reference-bothface-world.png'));packed=final.resize((384,256),Image.Resampling.LANCZOS);packpath=ART/(stem+'-quarter-candidate.png');packed.save(packpath);last=int(np.where(np.asarray(packed)[:,:,3]>=32)[0].max())
        records.append({'nativeSample':n,'gameplayAge':n-1,'sourceImage':source.name,'sourceSha256':sha(source),'image':out.name,'imageSha256':sha(out),'packedImage':packpath.name,'packedImageSha256':sha(packpath),'newOpaqueClosedMaterialHolePixels':int(new.sum()),'partialInteriorOpacityPixels':int(partial.sum()),'newlyVisibleInvalidRGBPixelsRepaired':int(invalid.sum()),'alphaChangedPixels':int((a[:,:,3]!=original[:,:,3]).sum()),'externalConnectedBackgroundIdentical':True,'externalContourIdentity':'Exact equality of all background pixels connected to image border before/after; material closed holes inside named reviewed fur/cloth polygons only. No blanket closed-hole fill.','alpha32BoundsIdentical':True,'alpha32Bounds':[int(rx.min()),int(ry.min()),int(rx.max()),int(ry.max())],'root':[512,832],'scaleToWorld':5/26,'packedRoot':[128,208],'packedScaleToWorld':5/6.5,'bodyCentreFromRootY':-42,'packedFloorPixelCentreWorldDelta':(last+.5-208)*5/6.5,'namedRepairRegions':region_reports,'receivingFitRequiresNewTarget':True,'accepted':False})
    report={'state':'bounded_authored_opaque_target_interiors_candidate_actual_review_pending','authorization':'Parent explicitly supersedes no-alpha-change for discovered source-material-mask defect; opaque anatomy interiors only, actual pose gaps/external contour/root/floor preserved.','defect':'Source guide mask carried native material opacity holes/partial alpha. Dark composite striations were predominantly background leaking through source material alpha, not generated black RGB. Previous RGB-only attempt retained as unsuccessful candidate.','records':records,'shippingChanged':False,'nativeShaderParityClaimed':False,'toolSha256':sha(Path(__file__))};(ART/'dk-firstclips-batch02-matte1-review.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(records,indent=2))
if __name__=='__main__':main()
