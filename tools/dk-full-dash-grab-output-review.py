"""Prepare isolated dash candidates with exact own-row source/alpha lineage.

No target acceptance, retry submission, receiving fit or shipping writes.
"""
from pathlib import Path
import argparse, json, hashlib
import numpy as np
from PIL import Image, ImageDraw

ROOT=Path(__file__).resolve().parents[1]
ART=ROOT/'docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/art'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()

def main(args):
    if not args.output_review_slot_released:
        raise ValueError('Output QA requires coordinator CPU grant after queue-empty/model unload')
    prepfile=args.preparation.resolve()
    if sha(prepfile)!=args.expected_preparation_sha256:
        raise ValueError('Reviewed own dash preparation changed')
    prep=json.loads(prepfile.read_text())
    family=prep['jobFamily'];attempt=prep['attempt']
    if not family.startswith('dk-fullgrab-dash-') or attempt not in [1,2,3]:
        raise ValueError('Isolated dash job/attempt required')
    if 'sourceBaseCandidate' in prep or 'sourceBaseCandidateSha256' in prep:
        raise ValueError('A global correction parent is forbidden; each row owns its parent')
    if not 1<=len(prep['records'])<=2 or any(r['clip']!='dash_grab' or r['nativeSample']==11 or r['nativeSample']!=r['gameplayAge']+1 for r in prep['records']):
        raise ValueError('Only exact new dash poses, never regenerate accepted native11')
    if prep['state']!='actual_inputs_visually_reviewed':raise ValueError('Actual input review missing')
    job=f'{family}-attempt{attempt}';receipt=ART/(job+'-output-review.json')
    if receipt.exists():raise ValueError('Candidate review already exists; preserve versioned outputs')
    atlas=args.atlas.resolve()
    if sha(atlas)!=args.expected_atlas_sha256:raise ValueError('Observed generated atlas pin changed')
    image=Image.open(atlas).convert('RGB')
    if list(image.size)!=prep['canvas']:raise ValueError('Generated atlas dimensions differ')
    cw,ch=prep['cells'];referencefile=ROOT/prep['identityReference']['path']
    if sha(referencefile)!=prep['identityReference']['sha256']:raise ValueError('Reference changed')
    reference=Image.open(referencefile).convert('RGBA')
    refworld=reference.resize((round(reference.width*5/26),round(reference.height*5/26)),Image.Resampling.LANCZOS)
    records=[]
    for prior in prep['records']:
        row={**prior,'fullCanvas':[1536,1024],'fullRoot':[512,832],'sourceScaleToWorld':5/26,'packedCell':[384,256],'packedRoot':[128,208],'packedScaleToWorld':5/6.5}
        if row['sourceGuide']['sha256']!=sha(ROOT/row['sourceGuide']['path']):raise ValueError('Own source guide changed')
        own=json.loads((ROOT/row['sourceGuide']['path']).read_text())
        if own['native_sample_index']!=row['nativeSample'] or Path(own['motion']['path']).stem!='e00catchdash':raise ValueError('Output row source pose binding mismatch')
        x,y=row['cellPosition'];w,h=row['fullCanvas'];rootx,rooty=row['fullRoot']
        if [w,h]!=[cw*2,ch*2]:raise ValueError('Expected uniform half-resolution source registration')
        piece=image.crop((x,y,x+cw,y+ch));stem=job+'-'+row['prefix']
        if any(ART.glob(stem+'-*')):raise ValueError('Preserve previous/partial pose output; use versioned derivative')
        rawpath=ART/(stem+'-original-half-rgb.png');piece.save(rawpath)
        alpha=ART/row['authoredPoseAlpha']
        if sha(alpha)!=row['authoredPoseAlphaSha256']:raise ValueError('Reviewed target alpha changed')
        body=piece.resize((w,h),Image.Resampling.LANCZOS).convert('RGBA');body.putalpha(Image.open(alpha).convert('L'))
        localguard=None
        if prep.get('correctionDomains'):
            # The corrected features are generated freely. Outside the local
            # blend envelope the existing source-approved body is byte-bound.
            parent=row.get('sourceBaseCandidate')
            if not isinstance(parent,dict) or parent.get('clip')!=row['clip'] or parent.get('nativeSample')!=row['nativeSample'] or parent.get('gameplayAge')!=row['gameplayAge']:
                raise ValueError('Every corrected row requires its own same-pose source parent')
            basefile=ROOT/parent['path']
            if sha(basefile)!=parent['sha256']:raise ValueError('Own row correction parent changed')
            base=np.asarray(Image.open(basefile).convert('RGBA'))
            if list(base.shape[:2])!=[h,w]:raise ValueError('Own parent dimensions changed')
            if not np.array_equal(np.asarray(body)[:,:,3],base[:,:,3]):raise ValueError('Hand RGB correction must preserve own parent alpha exactly; material repair is separate')
            candidate=np.asarray(body).copy()
            maskfile=ART/prep['inputs']['render-mask']['file']
            if sha(maskfile)!=prep['inputs']['render-mask']['sha256']:raise ValueError('Localized mask drift')
            mask=Image.open(maskfile).convert('L').crop((x,y,x+cw,y+ch)).resize((w,h),Image.Resampling.BILINEAR)
            guard=np.asarray(mask)>0
            candidate[~guard]=base[~guard]
            assert np.array_equal(candidate[:,:,3],base[:,:,3])
            assert np.array_equal(candidate[~guard],base[~guard])
            body=Image.fromarray(candidate)
            localguard={'sourceParentClip':row['clip'],'sourceParentNativeSample':row['nativeSample'],'sourceParentGameplayAge':row['gameplayAge'],'sourceCandidate':basefile.name,'sourceCandidateSha256':sha(basefile),'maskImage':maskfile.name,'maskImageSha256':sha(maskfile),'changedRGBPixels':int(np.any(candidate[:,:,:3]!=base[:,:,:3],axis=2).sum()),'alphaBytesUnchanged':True,'RGBAOutsideLocalBlendEnvelopeUnchanged':True,'blendPolicy':'Actual generated RGB inside the upsampled reviewed local noise-mask envelope; existing candidate restored outside it. Eyes/brow/garment remain generated within the envelope.'}
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
        records.append({'clip':row['clip'],'nativeSample':row['nativeSample'],'gameplayAge':row['gameplayAge'],'image':cutout.name,'imageSha256':sha(cutout),'originalGeneratedHalfRGB':rawpath.name,'originalGeneratedHalfRGBSha256':sha(rawpath),'rawAtlasSha256':sha(atlas),'sourceGuide':row['sourceGuide'],'declaredPoseAlpha':alpha.name,'declaredPoseAlphaSha256':sha(alpha),'dimensions':[w,h],'root':row['fullRoot'],'scaleToWorld':row['sourceScaleToWorld'],'bodyCentreFromRootY':-42,'floorPixelCentreWorldDelta':fullfloor,'packedImage':packedpath.name,'packedImageSha256':sha(packedpath),'packedDimensions':row['packedCell'],'packedRoot':row['packedRoot'],'packedScaleToWorld':row['packedScaleToWorld'],'packedFloorPixelCentreWorldDelta':packedfloor,'floorToleranceWorld':.55,'alphaProcessing':'Generated RGB upsampled uniformly onto reviewed authored pose alpha, including localized support/material repair. No source RGB delivered. Actual generated contour containment and output identity still require direct review.','localizedBodyGuard':localguard,'accepted':False,'receivingAccepted':False,'victimAttachmentAccepted':False,'wholeActionClockQualified':False})
    result={'state':'generated_dash_grab_candidates_actual_review_pending','preparation':prepfile.name,'preparationSha256':sha(prepfile),'records':records,'shippingChanged':False,'toolSha256':sha(Path(__file__))}
    receipt.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'receipt':receipt.name,'records':records},indent=2))

if __name__=='__main__':
    p=argparse.ArgumentParser()
    p.add_argument('--preparation',type=Path,required=True)
    p.add_argument('--expected-preparation-sha256',required=True)
    p.add_argument('--atlas',type=Path,required=True)
    p.add_argument('--expected-atlas-sha256',required=True)
    p.add_argument('--output-review-slot-released',action='store_true')
    main(p.parse_args())
