#!/usr/bin/env python3
"""Restore generated crop RGB into exact original cells, preserving body alpha."""
from pathlib import Path
import argparse,hashlib,json
import numpy as np
from PIL import Image,ImageDraw

ROOT=Path(__file__).resolve().parents[1];ART=ROOT/'docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/art'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()

def main(attempt):
    prepfile='dk-firstclips-batch01-correction-preparation.json' if attempt==2 else 'dk-firstclips-batch01-third-preparation.json'
    prep=json.loads((ART/prepfile).read_text());job=f'dk-firstclips-batch01-attempt{attempt}'
    generated=np.asarray(Image.open(ART/(job+'-final.png')).convert('RGB'));noise=np.asarray(Image.open(ART/prep['inputs']['render-mask']['file']).convert('L'))
    if generated.shape[:2]!=(1024,1024):raise ValueError('Localized canvas mismatch')
    ref=np.asarray(Image.open(ROOT/prep['identityReference']['path']).convert('RGBA')).copy();rgb=ref[:,:,:3].astype(float)
    ref[(rgb[:,:,2]>rgb[:,:,0]*.7)&(rgb[:,:,2]>rgb[:,:,1]*1.25)&(rgb[:,:,2]>115),3]=0
    reference=Image.fromarray(ref);reference=reference.crop(reference.getbbox());reference=reference.resize((round(reference.width*104/reference.height),104),Image.Resampling.LANCZOS)
    records=[]
    for row in prep['records']:
        path=ART/row['bodyFile']
        if sha(path)!=row['bodySha256']:raise ValueError('Body drift after guide review')
        full=np.asarray(Image.open(path).convert('RGBA')).copy();original=full.copy();x0,y0,x1,y1=row['crop'];piece=full[y0:y1,x0:x1]
        x=row['cell']%2*512;y=row['cell']//2*512;selected=(noise[y:y+512,x:x+512]>0)&(piece[:,:,3]>=254)
        piece[selected,:3]=generated[y:y+512,x:x+512][selected]
        if not np.array_equal(full[:,:,3],original[:,:,3]):raise ValueError('Correction moved alpha')
        body=Image.fromarray(full);stem=job+'-'+row['prefix'];out=ART/(stem+'-cutout-candidate.png');body.save(out)
        for mode,color in [('dark',(25,30,39)),('light',(247,246,238))]:
            canvas=Image.new('RGB',body.size,color);canvas.paste(body,mask=body.getchannel('A'));canvas.save(ART/(stem+'-'+mode+'.png'))
        canvas=Image.new('RGBA',(900,330),(25,30,39,255));ImageDraw.Draw(canvas).line((0,230,900,230),fill=(95,113,140));canvas.alpha_composite(reference,(105-reference.width//2,230-reference.height))
        preview=body.resize((round(1536*5/26),round(1024*5/26)),Image.Resampling.LANCZOS)
        for cx,facing in [(370,1),(730,-1)]:
            viewed=preview if facing==1 else preview.transpose(Image.Transpose.FLIP_LEFT_RIGHT);rx=round(512*5/26) if facing==1 else viewed.width-round(512*5/26)
            canvas.alpha_composite(viewed,(cx-rx,230-round(832*5/26)))
        canvas.convert('RGB').save(ART/(stem+'-reference-bothface-world.png'))
        yy,xx=np.nonzero(full[:,:,3]>=32)
        changed=int(np.any(full[:,:,:3]!=original[:,:,:3],axis=2).sum())
        if row.get('generatedThisAttempt') is False and changed:raise ValueError('Frozen native1 changed')
        records.append({'clip':row['clip'],'nativeSample':row['nativeSample'],'gameplayAge':row['gameplayAge'],'image':out.name,'imageSha256':sha(out),'originalImage':path.name,'originalImageSha256':sha(path),'changedRGBPixels':changed,'alphaIdenticalToOriginal':True,'floorPixelCentreWorldDelta':(int(yy.max())+.5-832)*5/26,'root':[512,832],'scaleToWorld':5/26,'bodyCentreFromRootY':-42,'accepted':False})
    (ART/(job+'-output-review.json')).write_text(json.dumps({'state':'localized_outputs_actual_full_dark_world_identity_inspection_pending','records':records,'shippingChanged':False},indent=2)+'\n');print(json.dumps(records,indent=2))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--attempt',type=int,choices=[2,3],default=2);args=parser.parse_args();main(args.attempt)
