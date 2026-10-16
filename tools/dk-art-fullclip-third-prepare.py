#!/usr/bin/env python3
"""Final bounded correction for the two rejected faces only; no submission."""
from pathlib import Path
import hashlib,json
import numpy as np
from PIL import Image,ImageDraw,ImageFilter

ROOT=Path(__file__).resolve().parents[1];ART=ROOT/'docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/art'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()

def main():
    second=json.loads((ART/'dk-firstclips-batch01-correction-preparation.json').read_text())
    canvas=Image.new('RGB',(1024,1024),(204,73,140));noise=Image.new('L',canvas.size);guide=Image.new('L',canvas.size)
    accepted=ART/'firstcontact-clean3-jab1-native5-cutout.png'
    crop=(490,330,730,655);head=Image.open(accepted).crop(crop);head=head.resize((round(head.width*380/head.height),380),Image.Resampling.LANCZOS)
    reference=Image.new('RGBA',(512,512),(204,73,140,255));reference.alpha_composite(head,((512-head.width)//2,66));canvas.paste(reference.convert('RGB'))
    original_noise=Image.open(ART/second['inputs']['render-mask']['file']).convert('L')
    records=[]
    for row in second['records']:
        cell=row['cell'];sample=row['nativeSample'];prefix=row['prefix'];crop_rect=row['crop'];x=cell%2*512;y=cell//2*512
        bodypath=ART/f'dk-firstclips-batch01-attempt2-{prefix}-cutout-candidate.png';body=Image.open(bodypath).convert('RGBA');arr=np.asarray(body).copy()
        m=np.zeros((512,512),dtype=np.uint8)
        if sample in [3,6]:
            face_mask=np.asarray(original_noise.crop((x,y,x+512,y+512))).copy()
            garment=Image.open(ART/row['sourceGarmentMask']).filter(ImageFilter.MaxFilter(13)).crop(crop_rect)
            face_mask[np.asarray(garment)>0]=0;m=face_mask
            authored=np.asarray(Image.open(ART/row['localSeed']).convert('RGBA'))
            x0,y0,x1,y1=crop_rect;piece=arr[y0:y1,x0:x1];selected=(m>0)&(piece[:,:,3]>=254)
            piece[selected,:3]=authored[y0:y1,x0:x1,:3][selected]
        seeded=Image.fromarray(arr);seedpath=ART/(prefix+'-attempt3-local-seed.png');seeded.save(seedpath)
        rgb=Image.new('RGB',body.size,(204,73,140));rgb.paste(seeded,mask=body.getchannel('A'));patch=rgb.crop(crop_rect);canvas.paste(patch,(x,y));noise.paste(Image.fromarray(m),(x,y))
        # In contrast to attempt2, encode the actually authored oval sclera,
        # pupil and brow boundaries, while keeping every pixel generatable.
        a=np.asarray(patch).astype(int);edges=np.zeros((512,512),bool)
        for axis in [0,1]:edges|=np.max(np.abs(a-np.roll(a,1,axis)),axis=2)>45
        guide.paste(Image.fromarray((edges*255).astype('uint8')),(x,y))
        records.append({**row,'bodyFile':bodypath.name,'bodySha256':sha(bodypath),'thirdSeed':seedpath.name,'thirdSeedSha256':sha(seedpath),'generatedThisAttempt':sample in [3,6],'generatedInputReview':'pending'})
    prefix='dk-firstclips-batch01-third'
    for kind,image in [('seed',canvas),('guide',guide),('render-mask',noise)]:image.save(ART/(prefix+'-'+kind+'.png'))
    graph=json.loads((ART/'dk-firstclips-batch01-attempt2.workflow.json').read_text())
    graph['4']['inputs']['text']='Exactly the same red cartoon gorilla identity as the top-left accepted reference head: thick WHITE curved eyebrows, white eye whites and narrow BLACK OVAL pupils, cream tan muzzle and small nostrils. Bottom-left and bottom-right faces are correcting their eye appearance only. Keep their exact supplied head angle looking right, mouth shape, eye centres and source face plane. White eyebrows follow the forehead directly above each white eye. Eyebrows are WHITE, never black. Eye whites stay distinct rounded shapes, never a continuous white ribbon. No triangular eye socket. Match the clear red/cream cartoon palette and source-facing expression. Top-right pose remains unchanged. Preserve all unmasked body, cloth, limbs, silhouette, foot supports and registration. Uniform magenta background.'
    graph['5']['inputs']['text']+=' , black eyebrows, frontal camera head turn, triangular eye sockets, continuous white U ribbon, huge pupils, duplicate eyebrows, extra face'
    graph['7']['inputs'].update(seed=2026100909,denoise=.50)
    for node,kind in [('10','guide'),('13','seed'),('16','render-mask')]:graph[node]['inputs']['image']='pf-'+prefix+'-'+kind+'.png'
    for node,kind in [('9','final'),('20','raw')]:graph[node]['inputs']['filename_prefix']='pf-dk-firstclips-batch01-attempt3-'+kind
    workflow='dk-firstclips-batch01-attempt3.workflow.json';(ART/workflow).write_text(json.dumps(graph,indent=2)+'\n')
    prep={**second,'state':'prepared_actual_input_review_pending','attempt':3,'workflow':workflow,'workflow_sha256':sha(ART/workflow),'records':records,'inputs':{kind:{'file':prefix+'-'+kind+'.png','sha256':sha(ART/(prefix+'-'+kind+'.png')),'graphNode':node} for node,kind in [('10','guide'),('13','seed'),('16','render-mask')]},'identityReference':{'path':str(accepted.relative_to(ROOT)),'sha256':sha(accepted),'cell':0,'crop':[490,330,730,655],'noiseMask':'zero','ancestry':second['identityReference'],'qualification':'Same locked target identity, accepted exact contact sample; root static/live receipt pinned separately'},'identity_mechanism':'Actually reviewed same-identity accepted head pixels VAE starting latent referencecell0 underzero noise mask; TWO actual pose faces freelygenerated with internal authoredtarget-featureedgeguide and lowerdenoise. Native1 frozen, no protected eye paste, fullbodyalpha/root unchanged onrestoration.'}
    (ART/'dk-firstclips-batch01-third-preparation.json').write_text(json.dumps(prep,indent=2)+'\n');print('Two-face final attempt3 inputs prepared; GPU untouched.')

if __name__=='__main__':main()
