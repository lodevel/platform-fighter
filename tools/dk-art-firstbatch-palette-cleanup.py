#!/usr/bin/env python3
"""Bounded authored RGB cleanup of inspected batch1 candidates; no alpha edits.

Retains all generator bytes and produces review candidates only. Selected
palette defects are not permission to alter pose, eye geometry or scale.
"""
from pathlib import Path
import hashlib,json
import numpy as np
from scipy.ndimage import distance_transform_edt,gaussian_filter,binary_dilation
from PIL import Image,ImageDraw

ROOT=Path(__file__).resolve().parents[1]
ART=ROOT/'docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/art'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def polygon(size,points):
    mask=Image.new('L',size);ImageDraw.Draw(mask).polygon(points,fill=255)
    return np.asarray(mask)>0
def display(body,stem,ref):
    dark=Image.new('RGBA',body.size,(25,30,39,255));dark.alpha_composite(body);dark.convert('RGB').save(ART/(stem+'-dark.png'))
    preview=body.resize((round(1536*5/26),round(1024*5/26)),Image.Resampling.LANCZOS)
    world=Image.new('RGBA',(900,330),(25,30,39,255));ImageDraw.Draw(world).line((0,230,900,230),fill=(95,113,140))
    reference=ref.crop(ref.getbbox());reference=reference.resize((round(reference.width*104/reference.height),104),Image.Resampling.LANCZOS)
    world.alpha_composite(reference,(105-reference.width//2,230-reference.height))
    for cx,face in [(370,1),(730,-1)]:
        viewed=preview if face==1 else preview.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
        rx=round(512*5/26) if face==1 else viewed.width-round(512*5/26)
        world.alpha_composite(viewed,(cx-rx,230-round(832*5/26)))
    world.convert('RGB').save(ART/(stem+'-reference-bothface-world.png'))

def main():
    ref=Image.open(ART/'firstcontact-clean3-jab1-native5-cutout.png').convert('RGBA')
    records=[]
    for native in [1,3,6]:
        source=ART/f'dk-firstclips-batch01-attempt3-firstclips-jab-native{native}-cutout-candidate.png'
        body=Image.open(source).convert('RGBA');original=np.asarray(body).copy();a=original.copy();rgb=a[:,:,:3].astype(float);alpha=a[:,:,3]>=32
        # RGB-only matte decontamination. Interior mouth pixels are explicitly
        # excluded; no chroma-derived transparency deletion or boundary motion.
        pink=(rgb[:,:,2]>rgb[:,:,1]*1.35)&(rgb[:,:,2]>rgb[:,:,0]*.32)&(rgb[:,:,2]>45)
        boundary=distance_transform_edt(alpha)<=6
        selected=alpha&pink&boundary
        valid=alpha&~pink&(distance_transform_edt(alpha)>6)
        _,near=distance_transform_edt(~valid,return_indices=True)
        rgb[selected]=rgb[near[0][selected],near[1][selected]]
        operations=[{'operation':'local boundary RGB decontamination','pixels':int(selected.sum()),'alphaEdited':False}]
        if native in [1,3]:
            # Inspected native source ink artifacts in lower red fur, not
            # anatomical openings. Low-frequency surrounding red field avoids
            # the flat polygon, triangular hatch and black star prior failures.
            points=([(500,650),(600,641),(602,694),(503,696)] if native==1 else [(407,683),(598,676),(650,744),(612,769),(485,743),(400,725)])
            zone=polygon(body.size,points)&alpha
            bad=zone&(rgb[:,:,0]<145)&(rgb[:,:,1]<42)&(rgb[:,:,2]<35)
            bad=binary_dilation(bad,iterations=3)&zone
            good=alpha&~bad
            weight=gaussian_filter(good.astype(float),18)
            field=np.stack([gaussian_filter(rgb[:,:,c]*good,18)/np.maximum(weight,1e-9) for c in range(3)],axis=2)
            # Nearby red body pixels determine the replacement hue; keep
            # cream/clothing from bleeding across this local fur-only mask.
            field[:,:,0]=np.clip(field[:,:,0],160,195);field[:,:,1]=np.clip(field[:,:,1],8,23);field[:,:,2]=np.clip(field[:,:,2],0,10)
            if native==3:
                # Remove the entire inspected small ink cluster, including its
                # red anti-alias fringes. Smooth local tonal interpolation avoids
                # preserving the threshold mask as conspicuous mottled islands.
                blend=gaussian_filter(zone.astype(float),2.0)
                rgb=rgb*(1-blend[:,:,None])+field*blend[:,:,None]
                operations.append({'operation':'bounded hip-cluster local tonal interpolation','pixels':int((blend>.01).sum())})
            else:
                rgb[bad]=field[bad];operations.append({'operation':'source ink artifact local red field','pixels':int(bad.sum())})
        if native==3:
            zone=polygon(body.size,[(521,558),(588,558),(591,613),(527,615)])&alpha
            bad=zone&(rgb[:,:,0]>rgb[:,:,1]*1.8)&(rgb[:,:,1]<75)
            # Actual same chest's cream palette; preserve its visible outline.
            bad=binary_dilation(bad,iterations=3)&zone
            dot=polygon(body.size,[(494,556),(508,556),(508,572),(494,572)])&alpha
            bad|=dot&(rgb[:,:,1]<125)
            rgb[bad]=[252,206,139];operations.append({'operation':'cream chest red pigment blotch including anti-aliased rim','pixels':int(bad.sum())})
        if native==6:
            zone=polygon(body.size,[(537,556),(651,594),(647,633),(594,657),(550,616)])&alpha
            bad=zone&(rgb[:,:,2]>rgb[:,:,1]*1.25)&(rgb[:,:,0]<205)
            rgb[bad,0]=np.clip(rgb[bad,0]*.8,110,150);rgb[bad,1]=15;rgb[bad,2]=8
            operations.append({'operation':'mouth interior target dark red palette','pixels':int(bad.sum())})
        a[:,:,:3]=np.round(np.clip(rgb,0,255)).astype(np.uint8)
        if native in [1,3]:
            # Actual source fist overlaps the muzzle. RGB crease marks retain
            # the generated target silhouette while distinguishing that hand
            # from a long cream jaw; source RGB is never copied into delivery.
            canvas=Image.fromarray(a[:,:,:3]);drawing=ImageDraw.Draw(canvas)
            creases=({1:[[(726,593),(747,602),(750,624),(740,646)],[(779,583),(774,607),(765,621)],[(790,610),(782,637),(766,652)]],3:[[(799,513),(807,533),(807,552),(794,564)],[(821,533),(823,557),(816,575)],[(837,553),(837,579),(829,586)]]})[native]
            for points in creases:drawing.line(points,fill=(186,121,65),width=2,joint='curve')
            drawn=np.asarray(canvas);a[alpha,:3]=drawn[alpha]
            operations.append({'operation':'authored target clenched-hand creases at reviewed source overlap','alphaEdited':False,'creases':creases})
        if not np.array_equal(a[:,:,3],original[:,:,3]):raise ValueError('Alpha drift')
        stem=f'dk-firstclips-batch01-clean4-firstclips-jab-native{native}';out=ART/(stem+'-cutout-candidate.png');final=Image.fromarray(a);final.save(out);display(final,stem,ref)
        last=int(np.where(a[:,:,3]>=32)[0].max())
        records.append({'nativeSample':native,'gameplayAge':native-1,'sourceImage':str(source.relative_to(ROOT)),'sourceSha256':sha(source),'image':str(out.relative_to(ROOT)),'imageSha256':sha(out),'changedRGBPixels':int(np.any(a[:,:,:3]!=original[:,:,:3],axis=2).sum()),'alphaIdentical':True,'root':[512,832],'scaleToWorld':5/26,'bodyCentreFromRootY':-42,'floorPixelCentreWorldDelta':(last+.5-832)*5/26,'operations':operations,'accepted':False})
    report={'state':'authored_palette_cleanup_candidates_actual_inspection_pending','generationAttemptBudgetSpent':3,'geometryChanged':False,'shippingChanged':False,'toolSha256':sha(Path(__file__)),'records':records}
    (ART/'dk-firstclips-batch01-clean4-review.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))

if __name__=='__main__':main()
