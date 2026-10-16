#!/usr/bin/env python3
"""Restore half-resolution generated RGB to declared authored pose alpha.
Preserves original atlas/RGB and never writes delivered assets or acceptance.
"""
from pathlib import Path
import argparse,hashlib,json
import numpy as np
from PIL import Image,ImageDraw
ROOT=Path(__file__).resolve().parents[1];ART=ROOT/'docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/art'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def main(batch,attempt):
    prep=json.loads((ART/f'dk-firstclips-batch{batch:02d}-preparation.json').read_text());job=f'dk-firstclips-batch{batch:02d}-attempt{attempt}';atlas=ART/(job+'-final.png');image=Image.open(atlas).convert('RGB')
    if list(image.size)!=prep['canvas'] or prep['cells']!=[768,512]:raise ValueError('Half-resolution contract mismatch')
    reference=Image.open(ROOT/prep['identityReference']['path']).convert('RGBA');reference=reference.crop(reference.getbbox());reference=reference.resize((round(reference.width*104/reference.height),104),Image.Resampling.LANCZOS);records=[]
    for row in prep['records']:
        cell=row['cell'];x=cell%2*768;y=cell//2*512;piece=image.crop((x,y,x+768,y+512));stem=job+'-'+row['prefix'];rawpath=ART/(stem+'-original-half-rgb.png');piece.save(rawpath)
        alpha=ART/row['authoredPoseAlpha']
        if sha(alpha)!=row['authoredPoseAlphaSha256']:raise ValueError('Reviewed target alpha drift')
        body=piece.resize((1536,1024),Image.Resampling.LANCZOS).convert('RGBA');body.putalpha(Image.open(alpha).convert('L'));cutout=ART/(stem+'-cutout-candidate.png');body.save(cutout)
        for mode,col in [('dark',(25,30,39)),('light',(247,246,238))]:
            bg=Image.new('RGBA',body.size,col+(255,));bg.alpha_composite(body);bg.convert('RGB').save(ART/(stem+'-'+mode+'.png'))
        world=Image.new('RGBA',(900,330),(25,30,39,255));ImageDraw.Draw(world).line((0,230,900,230),fill=(95,113,140));world.alpha_composite(reference,(105-reference.width//2,230-reference.height));preview=body.resize((round(1536*5/26),round(1024*5/26)),Image.Resampling.LANCZOS)
        for cx,face in [(370,1),(730,-1)]:
            v=preview if face==1 else preview.transpose(Image.Transpose.FLIP_LEFT_RIGHT);rx=round(512*5/26) if face==1 else v.width-round(512*5/26);world.alpha_composite(v,(cx-rx,230-round(832*5/26)))
        world.convert('RGB').save(ART/(stem+'-reference-bothface-world.png'));a=np.asarray(body);yy,xx=np.where(a[:,:,3]>=32);packed=body.resize((384,256),Image.Resampling.LANCZOS);packedpath=ART/(stem+'-quarter-candidate.png');packed.save(packedpath);last=int(np.where(np.asarray(packed)[:,:,3]>=32)[0].max())
        records.append({'clip':row['clip'],'nativeSample':row['nativeSample'],'gameplayAge':row['gameplayAge'],'windowStart':row['windowStart'],'windowEndExclusive':row['windowEndExclusive'],'image':cutout.name,'imageSha256':sha(cutout),'originalGeneratedHalfRGB':rawpath.name,'originalGeneratedHalfRGBSha256':sha(rawpath),'rawAtlasSha256':sha(atlas),'declaredPoseAlpha':alpha.name,'declaredPoseAlphaSha256':sha(alpha),'root':[512,832],'scaleToWorld':5/26,'bodyCentreFromRootY':-42,'floorPixelCentreWorldDelta':(int(yy.max())+.5-832)*5/26,'packedImage':packedpath.name,'packedImageSha256':sha(packedpath),'packedDimensions':[384,256],'packedRoot':[128,208],'packedScaleToWorld':5/6.5,'packedFloorPixelCentreWorldDelta':(last+.5-208)*5/6.5,'floorToleranceWorld':.55,'alphaProcessing':'Generated half-resolution RGB upsampled LANCZOS to declared author-reviewed source-guided target pose alpha. No source RGB delivered. Actual generated body containment/identity/contour review pending. Whole-cell quarter packing unchanged registration.','accepted':False})
    receipt={'state':'three_new_half_generated_rgb_pose_candidates_actual_review_pending','records':records,'shippingChanged':False,'toolSha256':sha(Path(__file__))};(ART/(job+'-output-review.json')).write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(records,indent=2))
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('batch',type=int);p.add_argument('--attempt',type=int,default=1);a=p.parse_args();main(a.batch,a.attempt)
