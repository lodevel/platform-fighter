"""Prepare candidate review images from dynamic-width grab pilot output.

No target acceptance, retry submission, receiving fit or shipping writes.
"""
from pathlib import Path
import argparse, json, hashlib
import numpy as np
from PIL import Image, ImageDraw

ROOT=Path(__file__).resolve().parents[1]
ART=ROOT/'docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/art'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()

def main(batch,attempt):
    family='dk-fullgrab-standing-startup01'
    prepfile=ART/(family+'-reviewed-generation-preparation.json')
    if attempt>1:prepfile=ART/(f'{family}-attempt{attempt}-reviewed-generation-preparation.json')
    prep=json.loads(prepfile.read_text())
    if prep['state']!='actual_inputs_visually_reviewed':raise ValueError('Actual input review missing')
    job=f'{family}-attempt{attempt}';receipt=ART/(job+'-output-review.json')
    if receipt.exists():raise ValueError('Candidate review already exists; preserve versioned outputs')
    atlas=ART/(job+'-final.png');image=Image.open(atlas).convert('RGB')
    if list(image.size)!=prep['canvas']:raise ValueError('Generated atlas dimensions differ')
    cw,ch=prep['cells'];referencefile=ROOT/prep['identityReference']['path']
    if sha(referencefile)!=prep['identityReference']['sha256']:raise ValueError('Reference changed')
    reference=Image.open(referencefile).convert('RGBA')
    refworld=reference.resize((round(reference.width*5/26),round(reference.height*5/26)),Image.Resampling.LANCZOS)
    records=[]
    for prior in prep['records']:
        row={**prior,'fullCanvas':[1536,1024],'fullRoot':[512,832],'sourceScaleToWorld':5/26,'packedCell':[384,256],'packedRoot':[128,208],'packedScaleToWorld':5/6.5}
        x,y=row['cellPosition'];w,h=row['fullCanvas'];rootx,rooty=row['fullRoot']
        if [w,h]!=[cw*2,ch*2]:raise ValueError('Expected uniform half-resolution source registration')
        piece=image.crop((x,y,x+cw,y+ch));stem=job+'-'+row['prefix']
        rawpath=ART/(stem+'-original-half-rgb.png');piece.save(rawpath)
        alpha=ART/row['authoredPoseAlpha']
        if sha(alpha)!=row['authoredPoseAlphaSha256']:raise ValueError('Reviewed target alpha changed')
        body=piece.resize((w,h),Image.Resampling.LANCZOS).convert('RGBA');body.putalpha(Image.open(alpha).convert('L'))
        localguard=None
        if prep.get('correctionDomains'):
            # The corrected features are generated freely. Outside the local
            # blend envelope the existing source-approved body is byte-bound.
            basefile=ART/row['sourceBaseCandidate']
            if sha(basefile)!=row['sourceBaseCandidateSha256']:raise ValueError('Localized source candidate drift')
            base=np.asarray(Image.open(basefile).convert('RGBA'))
            candidate=np.asarray(body).copy()
            maskfile=ART/prep['inputs']['render-mask']['file']
            if sha(maskfile)!=prep['inputs']['render-mask']['sha256']:raise ValueError('Localized mask drift')
            mask=Image.open(maskfile).convert('L').crop((x,y,x+cw,y+ch)).resize((w,h),Image.Resampling.BILINEAR)
            guard=np.asarray(mask)>0
            candidate[~guard]=base[~guard]
            assert np.array_equal(candidate[:,:,3],base[:,:,3])
            assert np.array_equal(candidate[~guard],base[~guard])
            body=Image.fromarray(candidate)
            localguard={'sourceCandidate':basefile.name,'sourceCandidateSha256':sha(basefile),'maskImage':maskfile.name,'maskImageSha256':sha(maskfile),'changedRGBPixels':int(np.any(candidate[:,:,:3]!=base[:,:,:3],axis=2).sum()),'alphaBytesUnchanged':True,'RGBAOutsideLocalBlendEnvelopeUnchanged':True,'blendPolicy':'Actual generated RGB inside the upsampled reviewed local noise-mask envelope; existing candidate restored outside it. Only reviewed hand domains may regenerate; each pose restores its own parent derivative outside the local envelope.'}
        cutout=ART/(stem+'-cutout-candidate.png');body.save(cutout)
        for mode,color in [('dark',(25,30,39)),('light',(247,246,238))]:
            bg=Image.new('RGBA',(w,h),color+(255,));bg.alpha_composite(body)
            bg.convert('RGB').save(ART/(stem+'-'+mode+'.png'))
        world=Image.new('RGBA',(1000,330),(25,30,39,255))
        ImageDraw.Draw(world).line((0,230,1000,230),fill=(95,113,140))
        world.alpha_composite(refworld,(125-round(512*5/26),230-round(832*5/26)))
        preview=body.resize((round(w*5/26),round(h*5/26)),Image.Resampling.LANCZOS)
        for cx,face in [(430,1),(790,-1)]:
            v=preview if face==1 else preview.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
            rx=round(rootx*5/26) if face==1 else v.width-round(rootx*5/26)
            world.alpha_composite(v,(cx-rx,230-round(rooty*5/26)))
        world.convert('RGB').save(ART/(stem+'-reference-bothface-world.png'))
        yy,xx=np.where(np.asarray(body)[:,:,3]>=32)
        packed=body.resize(tuple(row['packedCell']),Image.Resampling.LANCZOS)
        packedpath=ART/(stem+'-quarter-candidate.png');packed.save(packedpath)
        py,px=np.where(np.asarray(packed)[:,:,3]>=32)
        fullfloor=(int(yy.max())+.5-rooty)*row['sourceScaleToWorld']
        packedfloor=(int(py.max())+.5-row['packedRoot'][1])*row['packedScaleToWorld']
        if abs(fullfloor)>.55 or abs(packedfloor)>.55:raise ValueError('Candidate floor outside declared tolerance')
        records.append({'clip':row['clip'],'nativeSample':row['nativeSample'],'gameplayAge':row['gameplayAge'],'image':cutout.name,'imageSha256':sha(cutout),'originalGeneratedHalfRGB':rawpath.name,'originalGeneratedHalfRGBSha256':sha(rawpath),'rawAtlasSha256':sha(atlas),'declaredPoseAlpha':alpha.name,'declaredPoseAlphaSha256':sha(alpha),'dimensions':[w,h],'root':row['fullRoot'],'scaleToWorld':row['sourceScaleToWorld'],'bodyCentreFromRootY':-42,'floorPixelCentreWorldDelta':fullfloor,'packedImage':packedpath.name,'packedImageSha256':sha(packedpath),'packedDimensions':row['packedCell'],'packedRoot':row['packedRoot'],'packedScaleToWorld':row['packedScaleToWorld'],'packedFloorPixelCentreWorldDelta':packedfloor,'floorToleranceWorld':.55,'alphaProcessing':'Generated RGB upsampled uniformly onto reviewed authored pose alpha, including localized support/material repair. No source RGB delivered. Actual generated contour containment and output identity still require direct review.','localizedBodyGuard':localguard,'accepted':False,'receivingAccepted':False,'victimAttachmentAccepted':False,'wholeActionClockQualified':False})
    result={'state':'generated_grab_pilot_candidates_actual_review_pending','preparation':prepfile.name,'preparationSha256':sha(prepfile),'records':records,'shippingChanged':False,'toolSha256':sha(Path(__file__))}
    receipt.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'receipt':receipt.name,'records':records},indent=2))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('batch',type=int,choices=[1]);p.add_argument('--attempt',type=int,choices=[1,2,3],default=1);a=p.parse_args();main(a.batch,a.attempt)
