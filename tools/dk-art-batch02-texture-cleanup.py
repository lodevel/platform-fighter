#!/usr/bin/env python3
"""Inspected generated-texture repair candidates, RGB only; no native RGB copy."""
from pathlib import Path
import hashlib,json
import numpy as np
from scipy.ndimage import distance_transform_edt,binary_dilation,gaussian_filter
from PIL import Image,ImageDraw
ROOT=Path(__file__).resolve().parents[1];ART=ROOT/'docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/art'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def polygon(size,pts):
    m=Image.new('L',size);ImageDraw.Draw(m).polygon(pts,fill=255);return np.asarray(m)>0
def main():
    prep=json.loads((ART/'dk-firstclips-batch02-preparation.json').read_text());records=[]
    ref=Image.open(ROOT/prep['identityReference']['path']).convert('RGBA');ref=ref.crop(ref.getbbox());ref=ref.resize((round(ref.width*104/ref.height),104),Image.Resampling.LANCZOS)
    for row in prep['records']:
        n=row['nativeSample'];source=ART/f'dk-firstclips-batch02-attempt1-{row["prefix"]}-cutout-candidate.png';body=Image.open(source).convert('RGBA');original=np.asarray(body).copy();a=original.copy();rgb=a[:,:,:3].astype(float);visible=a[:,:,3]>=32
        guide=np.asarray(Image.open(ART/row['authoredFullSeed']).convert('RGB')).astype(float)
        # Guide determines broad fur/cloth ownership only, never replacement
        # RGB. Actual generated surrounding pixels supply the local colour.
        fur=(guide[:,:,0]>100)&(guide[:,:,1]<65)&(guide[:,:,2]<55)
        eye_guard={7:[(610,486),(730,486),(730,557),(610,557)],9:[(624,495),(740,495),(740,570),(624,570)],17:[(650,479),(751,479),(751,554),(650,554)]}
        mouth_guard={7:[(526,550),(694,550),(694,658),(502,671)],9:[(537,562),(713,562),(713,659),(513,680)],17:[(561,536),(730,536),(731,645),(558,645)]}
        guarded=polygon(body.size,eye_guard[n])|polygon(body.size,mouth_guard[n]);fur&=~guarded
        # Dark striations and blue/gray foreign pixels are inspected defects.
        bad=visible&fur&((rgb[:,:,0]<140)|(rgb[:,:,2]>rgb[:,:,0]*.35))
        bad=binary_dilation(bad,iterations=2)&visible&fur
        good=visible&fur&~bad&(rgb[:,:,0]>155)&(rgb[:,:,0]>rgb[:,:,1]*2)
        _,nearest=distance_transform_edt(~good,return_indices=True);field=rgb[nearest[0],nearest[1]]
        # Filter only the interpolated missing area, keeping generated cel
        # shading elsewhere. This avoids a native texture imprint or eye paste.
        field=np.stack([gaussian_filter(field[:,:,c],5) for c in range(3)],axis=2);rgb[bad]=field[bad]
        pink=(rgb[:,:,2]>rgb[:,:,1]*1.35)&(rgb[:,:,2]>rgb[:,:,0]*.32)&(rgb[:,:,2]>45);edge=visible&pink&(distance_transform_edt(visible)<=6)
        valid=visible&~pink&(distance_transform_edt(visible)>6);_,nearest=distance_transform_edt(~valid,return_indices=True);rgb[edge]=rgb[nearest[0][edge],nearest[1][edge]]
        a[:,:,:3]=np.round(np.clip(rgb,0,255)).astype(np.uint8)
        if not np.array_equal(a[:,:,3],original[:,:,3]):raise ValueError('Alpha changed')
        stem=f'dk-firstclips-batch02-clean1-{row["prefix"]}';out=ART/(stem+'-cutout-candidate.png');body=Image.fromarray(a);body.save(out);dark=Image.new('RGBA',body.size,(25,30,39,255));dark.alpha_composite(body);dark.convert('RGB').save(ART/(stem+'-dark.png'))
        world=Image.new('RGBA',(900,330),(25,30,39,255));ImageDraw.Draw(world).line((0,230,900,230),fill=(95,113,140));world.alpha_composite(ref,(105-ref.width//2,230-ref.height));view=body.resize((round(1536*5/26),round(1024*5/26)),Image.Resampling.LANCZOS)
        for cx,f in [(370,1),(730,-1)]:
            v=view if f==1 else view.transpose(Image.Transpose.FLIP_LEFT_RIGHT);rx=round(512*5/26) if f==1 else v.width-round(512*5/26);world.alpha_composite(v,(cx-rx,230-round(832*5/26)))
        world.convert('RGB').save(ART/(stem+'-reference-bothface-world.png'));packed=body.resize((384,256),Image.Resampling.LANCZOS);packedpath=ART/(stem+'-quarter-candidate.png');packed.save(packedpath);last=int(np.where(np.asarray(packed)[:,:,3]>=32)[0].max())
        records.append({'nativeSample':n,'gameplayAge':row['gameplayAge'],'windowStart':row['windowStart'],'windowEndExclusive':row['windowEndExclusive'],'sourceImage':source.name,'sourceSha256':sha(source),'image':out.name,'imageSha256':sha(out),'packedImage':packedpath.name,'packedImageSha256':sha(packedpath),'root':[512,832],'scaleToWorld':5/26,'packedRoot':[128,208],'packedScaleToWorld':5/6.5,'bodyCentreFromRootY':-42,'alphaIdenticalToSource':True,'packedFloorPixelCentreWorldDelta':(last+.5-208)*5/6.5,'floorToleranceWorld':.55,'generatedTexturePixelsRepaired':int(bad.sum()),'fringeRGBPixelsRepaired':int(edge.sum()),'eyeMouthFeatureGuardPreserved':True,'changedRGBPixels':int(np.any(a[:,:,:3]!=original[:,:,:3],axis=2).sum()),'accepted':False})
    report={'state':'bounded_rgb_texture_cleanup_actual_visual_review_pending','method':'Actual source guided material ownership is a broad prior only; no source RGB copied. Inspected generated black/blue fur striations locally interpolated from actual generated red colours, eye/mouth/skin/finger crease guards retained. Alpha unchanged.','records':records,'shippingChanged':False,'toolSha256':sha(Path(__file__))};(ART/'dk-firstclips-batch02-clean1-review.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(records,indent=2))
if __name__=='__main__':main()
