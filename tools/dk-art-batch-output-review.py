#!/usr/bin/env python3
"""Extract inspectable candidate cells from a durable full-clip batch; no acceptance."""
from pathlib import Path
import argparse, hashlib, json
import numpy as np
from PIL import Image, ImageDraw

ROOT=Path(__file__).resolve().parents[1]
ART=ROOT/'docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/art'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()

def prepare(batch,attempt):
    prep=json.loads((ART/f'dk-firstclips-batch{batch:02d}-preparation.json').read_text())
    job=f'dk-firstclips-batch{batch:02d}-attempt{attempt}'
    atlas=ART/(job+'-final.png');image=Image.open(atlas).convert('RGBA')
    if list(image.size)!=prep['canvas']:raise ValueError('Canvas mismatch')
    reference=Image.open(ROOT/prep['identityReference']['path']).convert('RGBA')
    a=np.asarray(reference).copy();rgb=a[:,:,:3].astype(float)
    bg=(rgb[:,:,2]>rgb[:,:,0]*.7)&(rgb[:,:,2]>rgb[:,:,1]*1.25)&(rgb[:,:,2]>115);a[bg,3]=0
    reference=Image.fromarray(a);reference=reference.crop(reference.getbbox());reference=reference.resize((round(reference.width*104/reference.height),104),Image.Resampling.LANCZOS)
    records=[]
    for row in prep['records']:
        cell=row['cell'];x=cell%2*1536;y=cell//2*1024
        body=image.crop((x,y,x+1536,y+1024));stem=job+'-'+row['prefix']
        body.convert('RGB').save(ART/(stem+'-original-rgb.png'))
        a=np.asarray(body).copy();background=np.all(np.abs(a[:,:,:3].astype(int)-[204,73,140])<=28,axis=2);a[background,3]=0;body=Image.fromarray(a)
        cutout=ART/(stem+'-cutout-candidate.png');body.save(cutout)
        for mode,color in [('dark',(25,30,39)),('light',(247,246,238))]:
            composite=Image.new('RGB',body.size,color);composite.paste(body,mask=body.getchannel('A'));composite.save(ART/(stem+'-'+mode+'.png'))
        world=Image.new('RGBA',(900,330),(25,30,39,255));draw=ImageDraw.Draw(world);draw.line((0,230,900,230),fill=(95,113,140));world.alpha_composite(reference,(105-reference.width//2,230-reference.height))
        preview=body.resize((round(1536*5/26),round(1024*5/26)),Image.Resampling.LANCZOS)
        for cx,facing in [(370,1),(730,-1)]:
            viewed=preview if facing==1 else preview.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
            rx=round(512*5/26) if facing==1 else viewed.width-round(512*5/26)
            world.alpha_composite(viewed,(cx-rx,230-round(832*5/26)))
        world.convert('RGB').save(ART/(stem+'-reference-bothface-world.png'))
        yy,xx=np.nonzero(a[:,:,3]>=32)
        records.append({'clip':row['clip'],'nativeSample':row['nativeSample'],'gameplayAge':row['gameplayAge'],'stem':stem,'image':cutout.name,'imageSha256':sha(cutout),'rawAtlasSha256':sha(atlas),'alpha32Bounds':[int(xx.min()),int(yy.min()),int(xx.max()),int(yy.max())],'floorPixelCentreWorldDelta':(int(yy.max())+.5-832)*5/26,'floorToleranceWorld':.55,'root':[512,832],'scaleToWorld':5/26,'bodyCentreFromRootY':-42,'alphaProcessing':'Initial magenta RGB tolerance28 candidate only, no resize/recenter; boundary/fringe and target anatomy actual inspection pending. Original generated RGB retained.','accepted':False})
    receipt={'state':'three_new_pose_candidates_actual_visual_alpha_collision_review_pending','records':records,'shippingChanged':False}
    (ART/(job+'-output-review.json')).write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(records,indent=2))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('batch',type=int);parser.add_argument('--attempt',type=int,default=1);args=parser.parse_args();prepare(args.batch,args.attempt)
