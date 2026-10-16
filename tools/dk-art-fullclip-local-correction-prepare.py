#!/usr/bin/env python3
"""Bounded batch1 localized identity/garment correction; keeps original body alpha."""
from pathlib import Path
import json,hashlib
import numpy as np
from PIL import Image,ImageDraw,ImageFilter
from scipy.ndimage import distance_transform_edt

ROOT=Path(__file__).resolve().parents[1];ART=ROOT/'docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/art'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()

def main():
    first=json.loads((ART/'dk-firstclips-batch01-preparation.json').read_text())
    canvas=Image.new('RGB',(1024,1024),(204,73,140));noise=Image.new('L',canvas.size);guide=Image.new('L',canvas.size)
    ref=ROOT/first['identityReference']['path'];a=np.asarray(Image.open(ref).convert('RGBA')).copy();rgb=a[:,:,:3].astype(float)
    a[(rgb[:,:,2]>rgb[:,:,0]*.7)&(rgb[:,:,2]>rgb[:,:,1]*1.25)&(rgb[:,:,2]>115),3]=0
    reference=Image.fromarray(a).crop((534,225,790,488)).resize((380,390),Image.Resampling.LANCZOS)
    cell=Image.new('RGBA',(512,512),(204,73,140,255));cell.alpha_composite(reference,(66,61));canvas.paste(cell.convert('RGB'))
    recipes=[
        (1,(420,255,932,767),[(695,373),(765,373),(790,411),(790,445),(775,480),(704,480),(689,423)],[(719,427,742,460),(742,432,758,462)], [[(710,414),(723,407),(746,423),(745,433),(727,424),(714,424)],[(743,423),(755,423),(770,418),(773,426),(759,436),(745,432)]],[(691,368),(791,368),(812,419),(816,498),(815,578),(702,578),(683,466)]),
        (3,(440,252,952,764),[(661,357),(730,365),(790,404),(804,460),(763,486),(674,465)],[(693,426,734,457),(739,439,766,465)], [[(686,416),(701,410),(735,428),(732,437),(707,425),(689,426)],[(737,430),(753,433),(774,425),(779,434),(755,442),(738,438)]],[(590,345),(803,345),(859,455),(864,606),(615,653),(585,447)]),
        (6,(320,270,832,782),[(583,431),(638,438),(688,481),(713,516),(702,564),(615,563),(579,535)],[(606,516,645,548),(649,529,675,553)], [[(597,505),(614,498),(648,515),(646,524),(621,513),(601,515)],[(649,518),(665,522),(681,517),(683,526),(667,532),(650,528)]],[(509,421),(717,421),(748,534),(728,677),(509,671)])]
    records=[]
    for cellindex,(sample,crop,cover,eyes,brows,face_mask) in enumerate(recipes,1):
        prefix=f'firstclips-jab-native{sample}';original=ART/f'dk-firstclips-batch01-attempt1-{prefix}-cutout-candidate.png'
        body=Image.open(original).convert('RGBA');alpha=np.asarray(body.getchannel('A'));arr=np.asarray(body).copy()
        decoration=Image.new('RGBA',body.size);draw=ImageDraw.Draw(decoration)
        draw.polygon(cover,fill=(188,20,5,255))
        for x0,y0,x1,y1 in eyes:
            draw.ellipse((x0,y0,x1,y1),fill=(253,250,238,255))
            w=x1-x0;h=y1-y0;draw.ellipse((x0+w*.52,y0+h*.18,x0+w*.9,y0+h*.88),fill=(21,12,7,255))
        for brow in brows:draw.polygon(brow,fill=(253,250,238,255))
        arr=np.asarray(Image.alpha_composite(Image.fromarray(arr),decoration)).copy();arr[:,:,3]=alpha
        # Captured source garment visibility is an authored cloth prior only.
        garmentpath=ART/(prefix+'-garment-mask.png');garment=np.asarray(Image.open(garmentpath))>0
        garment&=alpha>=254;dist=distance_transform_edt(garment);yy,xx=np.indices(garment.shape)
        shade=np.clip((yy-550)/220,0,1);garment_rgb=np.stack((232-20*shade,13-3*shade,np.zeros_like(shade)),2).astype(np.uint8)
        garment_rgb[dist<2]=[141,17,5];arr[garment,:3]=garment_rgb[garment];arr[alpha==0]=np.asarray(body)[alpha==0]
        authored=Image.fromarray(arr);local=ART/(prefix+'-local-correction-seed.png');authored.save(local)
        m=Image.new('L',body.size);ImageDraw.Draw(m).polygon(face_mask,fill=255)
        m=Image.fromarray(np.maximum(np.asarray(m),garment.astype(np.uint8)*255)).filter(ImageFilter.GaussianBlur(4))
        patch=Image.new('RGB',body.size,(204,73,140));patch.paste(authored,mask=body.getchannel('A'));patch=patch.crop(crop)
        x=cellindex%2*512;y=cellindex//2*512;canvas.paste(patch,(x,y));noise.paste(m.crop(crop),(x,y))
        silhouette=np.asarray(body.getchannel('A').crop(crop))>0;edge=silhouette^np.asarray(Image.fromarray((silhouette*255).astype('uint8')).filter(ImageFilter.MinFilter(5))).astype(bool);guide.paste(Image.fromarray((edge*255).astype('uint8')),(x,y))
        records.append({'cell':cellindex,'clip':'jab','nativeSample':sample,'gameplayAge':sample-1,'prefix':prefix,'crop':list(crop),'bodyFile':original.name,'bodySha256':sha(original),'localSeed':local.name,'localSeedSha256':sha(local),'generatedInputReview':'pending','sourceGarmentMask':garmentpath.name,'sourceGarmentMaskSha256':sha(garmentpath),'featureProtection':'No protected face pixels; authored target color geometry is freely generated, reference head only in cell0','alphaUnchangedByAuthoring':bool(np.array_equal(alpha,arr[:,:,3]))})
    prefix='dk-firstclips-batch01-local-correction'
    for kind,image in [('seed',canvas),('guide',guide),('render-mask',noise)]:image.save(ART/(prefix+'-'+kind+'.png'))
    graph=json.loads((ART/'dk-firstcontact-pilot-attempt2.workflow.json').read_text())
    graph['4']['inputs']['text']='Four cells in a two by two atlas. Top left is the EXACT red cartoon Donkey Kong head identity reference. Correct the other three visible faces to that same identity: thick white curved eyebrows, small white eye whites with BLACK OVAL pupils looking right, cream tan muzzle and two small nostrils. Top right is side/back turned startup with a partly occluded eye pair; bottom left is frontal winding pose; bottom right is the final active fist-punch face. Keep every head attached to its existing body and oriented exactly as supplied. One eye pair and brow pair per head where visible, no continuous white ribbons or triangular black sockets. Retain existing mouth shape, use natural dark red mouth interior and target cream muzzle. Vivid RED necktie with clear cel shaded folds within its supplied visible cloth outline. Smooth red cartoon fur shading; no eye rectangles, no pasted seams, no white fragments, no hatching. Preserve all unmasked anatomy, hand shapes, silhouette and foot positions. Uniform magenta background.'
    graph['7']['inputs'].update(seed=2026100908,denoise=.78)
    for node,kind in [('10','guide'),('13','seed'),('16','render-mask')]:graph[node]['inputs']['image']='pf-'+prefix+'-'+kind+'.png'
    for node,kind in [('9','final'),('20','raw')]:graph[node]['inputs']['filename_prefix']='pf-dk-firstclips-batch01-attempt2-'+kind
    workflow='dk-firstclips-batch01-attempt2.workflow.json';(ART/workflow).write_text(json.dumps(graph,indent=2)+'\n')
    prep={**first,'state':'prepared_actual_input_review_pending','attempt':2,'canvas':[1024,1024],'cells':[512,512],'workflow':workflow,'workflow_sha256':sha(ART/workflow),'records':records,'inputs':{kind:{'file':prefix+'-'+kind+'.png','sha256':sha(ART/(prefix+'-'+kind+'.png')),'graphNode':node} for node,kind in [('10','guide'),('13','seed'),('16','render-mask')]},'identity_mechanism':'Actual reviewed target head reference crop in VAE starting latent cell0 under zero mask; authored pose face geometry and target red garment are fully regenerated locally. Original body alpha/root unchanged on restoration, no reference eye image paste.'}
    (ART/'dk-firstclips-batch01-correction-preparation.json').write_text(json.dumps(prep,indent=2)+'\n');print('Localized batch1 attempt2 inputs prepared, actual inspection pending.')

if __name__=='__main__':main()
