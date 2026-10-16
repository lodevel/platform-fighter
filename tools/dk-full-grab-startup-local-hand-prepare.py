"""Bounded hand-only startup retry; no native evaluation, GPU or shipping writes."""
from pathlib import Path
import argparse, hashlib, json, copy
import numpy as np
from scipy.ndimage import distance_transform_edt, binary_erosion
from PIL import Image, ImageDraw, ImageFilter

ROOT=Path(__file__).resolve().parents[1]
ART=ROOT/'docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/art'
FAMILY='dk-fullgrab-standing-startup01'
OUT=FAMILY+'-attempt2-localhand'
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def pin(p): return {'path':str(p.relative_to(ROOT)), 'sha256':sha(p)}
def save(im,name):
    p=ART/(OUT+'-'+name+'.png'); im.save(p); return p
def poly(points):
    m=Image.new('L',(1536,1024));ImageDraw.Draw(m).polygon(points,fill=255);return np.asarray(m)>0
def composite(im,color):
    bg=Image.new('RGBA',im.size,color+(255,));bg.alpha_composite(im);return bg.convert('RGB')

FEATURES={
 1:{'handPolygons':[[[541,619],[606,612],[668,638],[670,722],[641,762],[561,760],[524,735],[527,676]]],
    'creases':[[[598,654],[622,652],[650,639]],[[620,686],[637,677],[654,667]],[[627,714],[640,703],[652,692]]],
    'thumb':[[590,644],[603,635],[637,625],[651,635],[641,644],[622,652],[598,654],[590,644]],
    'gapBoxes':[[591,565,625,605]],'eyeBox':[642,374,754,486],
    'opacityPolygons':[[[294,400],[392,315],[544,281],[622,317],[606,457],[489,511],[340,509]],[[331,535],[481,496],[551,562],[528,620],[506,737],[365,735]],[[350,681],[476,657],[549,733],[549,789],[351,806]],[[579,308],[650,300],[711,332],[741,372],[644,411],[621,460],[594,401]]]},
 4:{'handPolygons':[[[536,588],[598,584],[641,619],[648,668],[639,712],[614,742],[534,744],[498,709],[503,644]],[[330,219],[353,185],[378,158],[409,146],[432,106],[452,103],[471,173],[494,163],[520,164],[544,187],[505,234],[462,254],[401,265],[348,251]]],
    'creases':[[[558,619],[574,625],[608,604]],[[585,657],[601,647],[617,636]],[[601,684],[613,672],[624,657]],[[399,171],[409,162],[419,157]],[[374,199],[392,188],[404,173]],[[351,226],[367,219],[374,208]],[[433,215],[450,225],[479,217]]],
    'thumb':[[551,610],[562,601],[589,593],[609,600],[600,610],[576,624],[558,619],[551,610]],
    'gapBoxes':[[605,558,653,615]],'eyeBox':[649,368,778,483],
    'opacityPolygons':[[[311,310],[399,270],[538,290],[625,338],[608,473],[489,514],[330,481]],[[318,528],[479,487],[531,559],[506,642],[493,733],[352,735]],[[357,680],[473,656],[537,732],[539,786],[352,809]],[[589,307],[660,299],[715,333],[746,371],[651,409],[622,459],[598,400]]]},
}

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--input-preparation-slot-released',action='store_true');args=ap.parse_args()
    if not args.input_preparation_slot_released:raise ValueError('Explicit input preparation resource handoff required')
    receipt=ART/(OUT+'-preparation.json')
    if receipt.exists():raise ValueError('Preserve existing attempt2 inputs; no overwrite')
    oldfile=ART/(FAMILY+'-reviewed-generation-preparation.json');old=json.loads(oldfile.read_text())
    recipefile=ART/'full-grab-startup-reviewed-features-02.json'
    reference=ROOT/old['identityReference']['path']
    detail=ART/'dk-grabpilot-batch03-attempt1-grab_pull-native1-clean4-cutout.png'
    recipe={'attempt':2,'scope':'HAND_ONLY_SOURCE_CUED_FOLDS_AND_THUMB','features':FEATURES,'inputPins':[pin(oldfile),pin(recipefile),pin(reference),pin(detail)],'materialPolicy':'Only partial alpha32+ pixels inside named actual anatomical polygons, eroded3px; alpha0 and alpha32 silhouette remain unchanged, eyes and genuine gaps excluded. Generated RGB retained.','rgbPolicy':'Nearest opaque non-magenta generated RGB for actual magenta fringe. No eye repaint or body recolor.','localMaskPolicy':'Named hand polygons, dilated11x11 kernel radius5 full pixels and GaussianBlur2 full pixels, limited to current alpha32 body. All generated pixels outside its final upsampled envelope restored from each derivative.','detailReference':'Accepted pull fist crop is a zero-noise detail reference only; no change to anatomical/world scale of delivered pose cells.'}
    recipepath=ART/(OUT+'-recipe.json');recipepath.write_text(json.dumps(recipe,indent=2)+'\n')
    atlas=Image.new('RGB',(1536,1024),(255,0,255));guide=Image.new('RGB',atlas.size,(0,0,0));mask=Image.new('L',atlas.size,0)
    refbg=composite(Image.open(reference).convert('RGBA'),(255,0,255)).resize((768,512),Image.Resampling.LANCZOS);atlas.paste(refbg,(0,0))
    detailim=Image.open(detail).convert('RGBA').crop((906,452,1048,664)).resize((284,424),Image.Resampling.LANCZOS)
    atlas.paste(composite(detailim,(255,0,255)),(768+210,512+40))
    rows=[]
    for n,pos in [(1,(768,0)),(4,(0,512))]:
        f=FEATURES[n];source=ART/(FAMILY+f'-attempt1-fullgrab01-grab-native{n}-cutout-candidate.png');orig=np.asarray(Image.open(source).convert('RGBA'));a=orig.copy();rgb=a[:,:,:3];alpha=a[:,:,3]
        domain=np.zeros(alpha.shape,bool)
        for p in f['opacityPolygons']:domain|=poly(p)
        x0,y0,x1,y1=f['eyeBox'];domain[y0:y1,x0:x1]=False
        for x0,y0,x1,y1 in f['gapBoxes']:domain[y0:y1,x0:x1]=False
        opacity=domain&(alpha>=32)&(alpha<255)&binary_erosion(alpha>=32,iterations=3)
        alpha[opacity]=255
        r,g,b=[rgb[:,:,k].astype(float) for k in range(3)]
        fringe=(alpha>0)&(r>90)&(b>45)&(b>g*1.03)&(g<r*.72)
        valid=(alpha>=192)&~fringe;_,near=distance_transform_edt(~valid,return_indices=True);rgb[fringe]=rgb[near[0],near[1]][fringe]
        assert np.array_equal(orig[:,:,3]>=32,alpha>=32)
        assert np.array_equal(orig[:,:,3]==0,alpha==0)
        x0,y0,x1,y1=f['eyeBox'];assert np.array_equal(orig[y0:y1,x0:x1,3],a[y0:y1,x0:x1,3])
        base=Image.fromarray(a);basepath=save(base,f'native{n}-base-derivative');alphapath=save(Image.fromarray(alpha),f'native{n}-alpha')
        save(Image.fromarray(opacity.astype('uint8')*255),f'native{n}-opacity-change-domain');save(Image.fromarray(fringe.astype('uint8')*255),f'native{n}-rgb-fringe-change-domain')
        seeded=base.copy();draw=ImageDraw.Draw(seeded)
        draw.line(f['thumb'],fill=(156,100,64,255),width=4,joint='curve')
        for line in f['creases']:draw.line(line,fill=(156,100,64,255),width=4,joint='curve')
        s=np.asarray(seeded).copy();hand=np.zeros(alpha.shape,bool)
        for p in f['handPolygons']:hand|=poly(p)
        s[~hand]=a[~hand];s[:,:,3]=alpha;seeded=Image.fromarray(s)
        local=Image.fromarray(hand.astype('uint8')*255).filter(ImageFilter.MaxFilter(11)).filter(ImageFilter.GaussianBlur(2));lm=np.asarray(local).copy();lm[alpha<32]=0;local=Image.fromarray(lm)
        seedpath=save(seeded,f'native{n}-hand-seed');localpath=save(local,f'native{n}-local-mask')
        edges=composite(seeded,(255,0,255)).convert('L').filter(ImageFilter.FIND_EDGES).convert('RGB')
        e=np.asarray(edges).copy();e[lm==0]=0;edges=Image.fromarray(e)
        atlas.paste(composite(seeded,(255,0,255)).resize((768,512),Image.Resampling.LANCZOS),pos)
        guide.paste(edges.resize((768,512),Image.Resampling.LANCZOS),pos);mask.paste(local.resize((768,512),Image.Resampling.LANCZOS),pos)
        save(composite(seeded,(25,30,39)),f'native{n}-seed-dark');save(composite(seeded,(247,246,238)),f'native{n}-seed-light')
        world=Image.new('RGB',(1000,330),(25,30,39));worldd=ImageDraw.Draw(world);worldd.line((0,230,1000,230),fill=(90,110,140))
        for cx,im in [(130,Image.open(reference).convert('RGBA')),(440,seeded),(780,seeded.transpose(Image.Transpose.FLIP_LEFT_RIGHT))]:
            v=im.resize((round(1536*5/26),round(1024*5/26)),Image.Resampling.LANCZOS);rx=round((512 if cx!=780 else 1024)*5/26);world.paste(v,(cx-rx,230-round(832*5/26)),v)
        worldpath=save(world,f'native{n}-bothface-world')
        comparison=Image.new('RGB',(1000,460),(238,238,233));box=([508,608,676,769] if n==1 else [485,574,649,749])
        native=Image.open(ART/f'fullgrab01-grab-native{n}-reference.png').convert('RGB')
        for j,im in enumerate([native,composite(base,(25,30,39)),composite(seeded,(25,30,39))]):comparison.paste(im.crop(box).resize((320,322)),(j*335,70))
        ImageDraw.Draw(comparison).text((10,15),'Native source / rejected generated hand / source-cued local input',fill=(0,0,0));save(comparison,f'native{n}-hand-cues-source-before-after')
        prior=next(p for p in old['records'] if p['nativeSample']==n)
        row={k:v for k,v in prior.items() if k in ['clip','nativeSample','gameplayAge','sourceImageIndex','guidePrefix','cell','cellPosition','sourceGuide','prefix']}
        row.update({'prefix':f'fullgrab01-grab-native{n}','authoredPoseAlpha':alphapath.name,'authoredPoseAlphaSha256':sha(alphapath),'sourceBaseCandidate':basepath.name,'sourceBaseCandidateSha256':sha(basepath),'localMask':pin(localpath),'handSeed':pin(seedpath),'originalRejectedCandidate':pin(source),'opacityChangedPixels':int(opacity.sum()),'fringeChangedPixels':int(fringe.sum()),'alpha32SilhouetteUnchanged':True,'alphaZeroSpacesUnchanged':True,'ocularAlphaUnchanged':True,'worldReview':pin(worldpath),'root':[512,832],'scaleToWorld':5/26})
        rows.append(row)
    inputs={}
    for label,im,node in [('seed',atlas,'13'),('guide',guide,'10'),('render-mask',mask,'16')]:
        p=save(im,label);inputs[label]={'file':p.name,'sha256':sha(p),'graphNode':node,'serverFilename':'pf-'+OUT+'-'+label+'.png'}
    assert not np.asarray(mask)[:512,:768].any() and not np.asarray(mask)[512:,768:].any()
    graph=copy.deepcopy(json.loads((ART/(FAMILY+'-attempt1.workflow.json')).read_text()))
    for label,v in inputs.items():graph[v['graphNode']]['inputs']['image']=v['serverFilename']
    graph['7']['inputs'].update({'seed':2026100922,'denoise':.6})
    graph['4']['inputs']['text']='Localized HAND DETAIL repair ONLY. Red cartoon Donkey Kong with source-derived hand pose. Top-right lower forward CLOSED FIST: visible separate folded fingers, three warm brown finger crease lines, distinct curled thumb resting over fingers. Bottom-left forward CLOSED FIST same anatomy from different source angle; high raised rear hand has separated long fingers and natural palm joint creases. Bottom-right closeup is accepted fist DETAIL REFERENCE, unchanged. Maintain cream skin with restrained cel shading, thin brown finger folds and dark hand outline. EXACT supplied hand silhouette, thumb position, folded-finger orientation and source edge cues; avoid flat cream belly shape. All eyes, face, fur, torso, red necktie, feet and body outside localized hand mask UNCHANGED. No extra digits, holes, speckles, floating fingers, second fighter, held item, shadow, text.'
    for node,kind in [('9','final'),('20','raw')]:graph[node]['inputs']['filename_prefix']='pf-'+FAMILY+'-attempt2-'+kind
    graphfile=ART/(FAMILY+'-attempt2.workflow.json');graphfile.write_text(json.dumps(graph,indent=2)+'\n')
    result={'state':'actual_localized_inputs_root_review_pending','jobFamily':FAMILY,'attempt':2,'canvas':[1536,1024],'cells':[768,512],'root':[256,416],'scaleToWorld':5/13,'bodyCentreFromRootY':-42,'recipe':pin(recipepath),'tool':pin(Path(__file__)),'workflow':graphfile.name,'workflow_sha256':sha(graphfile),'identityReference':old['identityReference'],'detailReference':pin(detail),'inputs':inputs,'records':rows,'correctionDomains':True,'generatedOutputQualified':False,'shippingChanged':False,'notes':'Two local hand corrections only. Alpha derivative is separately logged; GPU output must use these exact alpha bytes and restore each base outside local envelope.'}
    receipt.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'receipt':pin(receipt),'rows':[{k:r[k] for k in ['nativeSample','opacityChangedPixels','fringeChangedPixels','worldReview']} for r in rows]},indent=2))

if __name__=='__main__':main()
