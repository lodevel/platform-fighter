"""Prepare one bounded pivot correction input; never submits GPU."""
from pathlib import Path
import json,hashlib
import numpy as np
from PIL import Image,ImageDraw,ImageFilter

ROOT=Path(__file__).resolve().parents[1]
ART=ROOT/'docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/art'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def bounds(mask):
    y,x=np.where(mask);return [int(x.min()),int(y.min()),int(x.max()),int(y.max())]

def main():
    family='dk-grabpilot-batch02';job=family+'-attempt2'
    outfile=ART/(job+'-preparation.json')
    if outfile.exists():raise ValueError('Preserve previous localized preparation')
    prior=json.loads((ART/(family+'-preparation.json')).read_text());row=prior['records'][0]
    basefile=ART/(family+'-attempt1-pivot_grab-native12-cutout-candidate.png')
    base=Image.open(basefile).convert('RGBA');before=np.asarray(base).copy()
    work=base.convert('RGB');draw=ImageDraw.Draw(work)
    # Attached facial plane from reviewed source eye/brow guide, adjusted only
    # within the rejected actual output's eye plane. All features are mutable.
    faceCover=[(703,459),(724,451),(758,460),(778,475),(775,522),(751,527),(716,523),(705,502)]
    eyes=[(717,480,744,520),(749,486,765,516)]
    brow=[(702,477),(719,463),(740,463),(770,479),(766,489),(739,474),(721,474),(709,487)]
    draw.polygon(faceCover,fill=(185,22,5))
    for x0,y0,x1,y1 in eyes:
        draw.ellipse((x0,y0,x1,y1),fill=(253,250,238))
        draw.ellipse((x0+3,y0+6,x0+12,y1-4),fill=(20,12,7))
    draw.polygon(brow,fill=(253,250,238))
    # Source-derived visible necktie guide: distinguish cloth from red fur
    # using target red, local fold shade and a thin contour inside existing alpha.
    tie=[(862,691),(902,677),(938,684),(955,708),(942,748),(911,777),(873,782),(843,758),(820,738),(834,711)]
    strap=[(891,423),(904,432),(951,707),(940,735),(920,704)]
    draw.polygon(strap,fill=(228,19,4));draw.polygon(tie,fill=(228,19,4))
    draw.polygon([(903,684),(938,688),(948,709),(928,730),(913,768),(899,749)],fill=(183,17,4))
    draw.line([(861,694),(875,715),(911,730),(937,710)],fill=(143,17,6),width=4,joint='curve')
    fullmask=Image.new('L',base.size);md=ImageDraw.Draw(fullmask)
    for poly in (faceCover,brow,tie,strap):md.polygon(poly,fill=255)
    changed=np.any(np.asarray(work)!=before[:,:,:3],axis=2)
    assert not np.any(changed&~(np.asarray(fullmask)>0))
    arr=np.asarray(work).copy();arr[before[:,:,3]==0]=before[:,:,:3][before[:,:,3]==0]
    work=Image.fromarray(arr);changed=np.any(arr!=before[:,:,:3],axis=2)
    fullseed=ART/(job+'-pivot_grab-native12-localized-authored-seed.png');work.save(fullseed)
    actual=work.convert('RGBA');actual.putalpha(base.getchannel('A'))
    for k,col in [('dark',(25,30,39)),('light',(247,246,238))]:
        bg=Image.new('RGBA',base.size,col+(255,));bg.alpha_composite(actual);bg.convert('RGB').save(ART/(job+'-pivot_grab-native12-localized-'+k+'.png'))
    # Keep original half RGB exactly outside the declared local correction.
    halfbase=Image.open(ART/(family+'-attempt1-pivot_grab-native12-original-half-rgb.png')).convert('RGB')
    half=work.resize((1024,512),Image.Resampling.LANCZOS)
    local=fullmask.resize((1024,512),Image.Resampling.NEAREST).filter(ImageFilter.MaxFilter(13))
    ha=np.asarray(halfbase).copy();hm=np.asarray(local)>0
    ha[hm]=np.asarray(half)[hm]
    canvas=Image.open(ART/(family+'-attempt1-final.png')).convert('RGB');ca=np.asarray(canvas).copy()
    ca[:,1024:2048]=ha;Image.fromarray(ca).save(ART/(job+'-seed.png'))
    noise=Image.new('L',(2048,512));noise.paste(local.filter(ImageFilter.GaussianBlur(2)),(1024,0));noise.save(ART/(job+'-render-mask.png'))
    guide=Image.new('L',(2048,512));a=ha.astype(int);edges=np.zeros((512,1024),bool)
    for axis in (0,1):edges|=np.max(np.abs(a-np.roll(a,1,axis)),axis=2)>35
    guide.paste(Image.fromarray((edges*255).astype(np.uint8)),(1024,0));guide.save(ART/(job+'-guide.png'))
    graph=json.loads((ART/prior['workflow']).read_text())
    graph['4']['inputs']['text']='Same accepted reference red cartoon Donkey Kong. LEFT reference unchanged. RIGHT existing backwards reaching pivot grab: preserve all body, hand, five separated fingers, feet, stance, face direction and root. Correct only the supplied attached eye plane to clean WHITE sclera with small BLACK oval pupils looking LEFT, thick WHITE eyebrow attached to head. Correct only visible necktie cloth to folded bright target RED with thin cel shaded contour, distinct from fur. Keep cream muzzle and existing source anatomy; no extra eyes, pink brows, continuous white eye ribbons, painted rectangle or body changes. No victim/object, shadow, text. Smooth target cel shading.'
    graph['7']['inputs'].update(seed=2026100952,denoise=.32)
    for n,k in [('10','guide'),('13','seed'),('16','render-mask')]:graph[n]['inputs']['image']='pf-'+job+'-'+k+'.png'
    for n,k in [('9','final'),('20','raw')]:graph[n]['inputs']['filename_prefix']='pf-'+job+'-'+k
    workflow=ART/(job+'.workflow.json');workflow.write_text(json.dumps(graph,indent=2)+'\n')
    modified={**row,'authoredFullSeed':fullseed.name,'authoredFullSeedSha256':sha(fullseed),'actualInputReview':'pending localized corrective input review; attempt2 not submitted'}
    prep={**prior,'state':'prepared_actual_input_review_pending','attempt':2,'records':[modified],'workflow':workflow.name,'workflow_sha256':sha(workflow),'inputs':{k:{'file':job+'-'+k+'.png','sha256':sha(ART/(job+'-'+k+'.png')),'graphNode':n} for n,k in [('10','guide'),('13','seed'),('16','render-mask')]},'actualInputInspection':'pending; no GPU submission','previousAttempt':'rejected actual face/brow/garment identity, body/source/root retained','correctionDomains':{'faceCover':faceCover,'eyes':eyes,'brow':brow,'tie':tie,'strap':strap},'inputRGBChangedPixelCount':int(changed.sum()),'inputRGBChangedBoundsInclusive':bounds(changed),'fullInputRGBUnchangedOutsideCorrectionPolygons':True,'halfInputRGBUnchangedOutsideDilatedCorrectionDomain':True,'alphaBytesUnchanged':True,'sourceBaseCandidate':basefile.name,'sourceBaseCandidateSha256':sha(basefile),'localNoiseMaskRightCellOnly':True,'outputPolicy':'Keep actual source alpha/root and restore original candidate RGB outside the declared local blend domain before final review; no accepted body reauthoring.'}
    outfile.write_text(json.dumps(prep,indent=2)+'\n');print(outfile.name,sha(outfile))

if __name__=='__main__':main()
