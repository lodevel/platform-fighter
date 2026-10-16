#!/usr/bin/env python3
"""First-attempt inputs for final jab recovery and two inspected jab2 poses.
CPU preparation only; target features are authored, freely generated, and reviewed.
"""
from pathlib import Path
import hashlib,json
import numpy as np
from scipy.ndimage import binary_fill_holes,distance_transform_edt
from PIL import Image,ImageDraw,ImageFilter

ROOT=Path(__file__).resolve().parents[1];ART=ROOT/'docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/art'
BG=(204,73,140);W,H=1536,1024
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def main():
    rows=json.loads((ART/'first-three-complete-clips-source-guide-preparation.json').read_text())['sourceRows'][6:9]
    if [(r['clip'],r['nativeSample'])for r in rows]!=[('jab',24),('jab2',1),('jab2',5)]:raise ValueError('Selected batch changed')
    ref=ART/'firstcontact-clean3-jab1-native5-cutout.png';reference=Image.open(ref).convert('RGBA')
    canvas=Image.new('RGB',(1536,1024),BG);guide=Image.new('L',canvas.size);noise=Image.new('L',canvas.size)
    reduced=reference.resize((768,512),Image.Resampling.LANCZOS);refcell=Image.new('RGBA',(768,512),BG+(255,));refcell.alpha_composite(reduced);canvas.paste(refcell.convert('RGB'))
    recipes={
        24:{'cover':[(632,406),(691,421),(741,482),(748,535),(675,549),(632,526)],'eyes':[(675,501,710,532),(713,515,737,539)],'brows':[[(664,490),(680,485),(711,499),(708,510),(685,498),(668,502)],[(714,506),(728,511),(741,504),(745,515),(730,522),(714,517)]],'face':[(539,367),(784,367),(785,649),(540,671)],'mouth':None,'tie':[(555,630),(606,650),(641,691),(663,743),(638,797),(608,809),(574,788),(558,737)]},
        1:{'cover':[(557,344),(608,358),(668,397),(680,446),(619,454),(575,428)],'eyes':[(602,416,638,447),(641,430,665,452)],'brows':[[(594,405),(611,399),(639,414),(636,424),(614,412),(597,416)],[(642,420),(657,425),(670,419),(674,429),(658,438),(643,432)]],'face':[(475,300),(723,300),(739,575),(479,627)],'mouth':[(554,481),(682,485),(698,522),(667,573),(603,550)],'tie':[(462,532),(493,568),(534,604),(493,638),(421,679),(344,705),(294,681),(282,644),(363,622),(426,611)]},
        5:{'cover':[(695,271),(716,271),(739,298),(738,326),(709,331),(692,312)],'eyes':[(707,292,725,315)],'brows':[[(699,280),(707,276),(725,294),(729,306),(721,303),(710,290)]],'face':[(638,231),(785,231),(793,394),(642,404)],'mouth':None,'tie':None}}
    records=[]
    for index,row in enumerate(rows,1):
        n=row['nativeSample'];name=row['prefix'];rec=recipes[n];source=ART/(name+'-palette-seed.png');maskpath=ART/(name+'-mask.png');source_mask=Image.open(maskpath).convert('L');opaque=np.asarray(source_mask)>=32;last=int(np.where(opaque)[0].max())
        col=np.asarray(Image.open(source).convert('RGB').filter(ImageFilter.MedianFilter(21))).copy();palette=np.asarray([[190,22,5],[233,16,1],[255,211,145],[252,250,238],[24,15,10]],dtype=np.int16)
        distances=((col.astype(np.int16)[:,:,None,:]-palette[None,None,:,:]).astype(np.float32)**2).sum(3);col[opaque]=palette[distances.argmin(2)][opaque];col[~opaque]=BG
        face=Image.new('L',(W,H));ImageDraw.Draw(face).polygon(rec['face'],fill=255);col[opaque&(np.asarray(face)==0)&(col[:,:,0]<60)]=[164,17,4]
        # Head source baked fur marks above the actual eye surface are removed
        # from guide colour; target cel art does not carry native textured ink.
        yy,xx=np.indices((H,W));col[opaque&(np.asarray(face)>0)&(yy<455)&(col[:,:,0]<60)]=[190,22,5]
        authored=Image.fromarray(col);d=ImageDraw.Draw(authored);d.polygon(rec['cover'],fill=(190,22,5))
        for x0,y0,x1,y1 in rec['eyes']:
            d.ellipse((x0,y0,x1,y1),fill=(253,250,238));w=x1-x0;h=y1-y0;d.ellipse((x0+w*.54,y0+h*.17,x0+w*.91,y0+h*.89),fill=(21,12,7))
        for brow in rec['brows']:d.polygon(brow,fill=(253,250,238))
        # Remove the captured tall cream brow stem at the left eye. It is a
        # native facial surface, not the locked cartoon's brow anatomy.
        stem={24:[(634,443),(646,438),(649,511),(636,516)],1:[(557,370),(569,365),(582,434),(568,442)],5:[(693,272),(701,269),(710,303),(702,310)]}[n]
        d.polygon(stem,fill=(190,22,5))
        # Sparse, reviewed target crease/ear marks retain source part readability
        # after native texture filtering. They remain mutable during generation.
        ears={24:(563,432,599,487),1:(491,405,531,454),5:(657,320,695,365)}
        d.arc(ears[n],70,280,fill=(255,211,145),width=5)
        if n==5:
            # Two tiny isolated baked cream marks on rear fur have no anatomical
            # target feature; remove them from freely mutable guide colour only.
            d.ellipse((460,451,484,477),fill=(190,22,5));d.ellipse((559,490,584,516),fill=(190,22,5))
        hands={24:[[(498,562),(529,573),(542,593)],[(485,598),(520,615)],[(474,635),(511,651)],[(768,551),(793,552),(818,566)],[(759,581),(794,590),(821,603)],[(750,618),(788,631),(817,639)]],1:[[(124,575),(118,593),(102,610)],[(103,621),(142,637),(168,631)],[(155,652),(178,672),(207,659)],[(859,537),(880,544),(914,543)],[(858,576),(887,586),(923,585)],[(861,614),(889,624),(924,623)]],5:[[(729,126),(775,134),(820,150)],[(739,167),(779,178),(820,180)],[(410,225),(444,238),(473,257)],[(416,260),(446,277),(473,285)]]}
        for line in hands[n]:d.line(line,fill=(182,117,62),width=3,joint='curve')
        if rec['mouth']:d.polygon(rec['mouth'],fill=(145,20,10))
        nostrils={24:[(697,536,706,550)],1:[(650,459,659,472),(672,470,678,479)],5:[]}
        for ellipse in nostrils[n]:d.ellipse(ellipse,fill=(112,56,24))
        if n==24:d.line([(590,543),(614,568),(649,594),(693,614),(724,614)],fill=(181,111,59),width=3,joint='curve')
        # Same actual source cloth surface, target red palette without source DK
        # glyphs. This is mutable authored guide, never direct native RGB delivery.
        if rec['tie']:
            tie=Image.new('L',(W,H));ImageDraw.Draw(tie).polygon(rec['tie'],fill=255);t=(np.asarray(tie)>0)&opaque;arr=np.asarray(authored).copy();arr[t]=[232,13,0];authored=Image.fromarray(arr)
            d=ImageDraw.Draw(authored);folds={24:[(561,722),(606,743),(644,741)],1:[(308,651),(349,676),(412,647),(486,622)]};d.line(folds[n],fill=(158,17,5),width=3,joint='curve')
        def warp(im):
            out=Image.new(im.mode,(W,H),0 if im.mode=='L'else BG);out.paste(im.crop((0,0,W,760)),(0,0));out.paste(im.crop((0,760,W,last+1)).resize((W,71),Image.Resampling.NEAREST if im.mode=='L'else Image.Resampling.BICUBIC),(0,760));return out
        full=warp(authored);target_mask=warp(source_mask);rawalpha=np.asarray(target_mask).copy();visible=rawalpha>=32;envelope=binary_fill_holes(visible);external=~envelope;dist=distance_transform_edt(envelope)
        # Exact same reviewed target material-opacity policy as qualified static
        # batch2, with new pose-specific head/garment interiors. Pose gaps never
        # receive blanket fill; the external-connected background stays exact.
        regions={24:[[(562,400),(582,354),(661,328),(730,336),(745,383),(735,451),(696,480),(627,468),(562,461)],[(560,685),(610,667),(648,712),(650,751),(621,799),(564,799),(558,776)],[(440,708),(469,707),(461,737),(432,742)]],1:[[(469,383),(487,342),(556,314),(616,312),(659,365),(653,400),(606,409),(546,393),(501,409)],[(297,648),(345,653),(405,627),(468,607),(497,609),(467,640),(416,672),(346,688),(306,679)]],5:[[(537,222),(579,195),(626,192),(676,225),(696,260),(683,301),(620,322),(558,282)],[(640,306),(673,307),(675,336),(639,338)]]}
        selected=np.zeros(visible.shape,bool)
        for points in regions[n]:
            m=Image.new('L',(W,H));ImageDraw.Draw(m).polygon(points,fill=255);selected|=np.asarray(m)>0
        holes=selected&envelope&~visible&(dist>3);partial=visible&(dist>3)&(rawalpha<255);repaired=rawalpha.copy();repaired[holes|partial]=255
        if not np.array_equal(external,~binary_fill_holes(repaired>=32)):raise ValueError('Authored exterior/pose gap drift')
        target_mask=Image.fromarray(repaired);fullpath=ART/(name+'-v2-generation-seed.png');rgbfull=np.asarray(full).copy();rgbfull[holes]=[190,22,5];full=Image.fromarray(rgbfull);full.save(fullpath);alphapath=ART/(name+'-v2-authored-pose-alpha.png');target_mask.save(alphapath)
        Image.fromarray(rawalpha).save(ART/(name+'-v2-original-material-alpha.png'))
        half=full.resize((768,512),Image.Resampling.LANCZOS);rgb=np.asarray(half).astype(int);edge=np.zeros((512,768),bool)
        for axis in [0,1]:edge|=np.max(np.abs(rgb-np.roll(rgb,1,axis)),axis=2)>35
        g=Image.fromarray((edge*255).astype(np.uint8));m=target_mask.resize((768,512),Image.Resampling.LANCZOS).filter(ImageFilter.MaxFilter(11));x=index%2*768;y=index//2*512;canvas.paste(half,(x,y));guide.paste(g,(x,y));noise.paste(m,(x,y))
        records.append({**row,'cell':index,'sourceSeedSha256':sha(source),'sourceMaskSha256':sha(maskpath),'authoredFullSeed':fullpath.name,'authoredFullSeedSha256':sha(fullpath),'authoredPoseAlpha':alphapath.name,'authoredPoseAlphaSha256':sha(alphapath),'floorTransform':{'inputBandStartPixelY':760,'inputLastPixelY':last,'targetLastPixelY':830,'rootPixelY':832,'pixelsPerNativeUnit':26},'featureAuthoring':rec,'generatedInputReview':'pending','materialAlphaRepair':{'closedMaterialHolePixels':int(holes.sum()),'partialExistingInteriorPixels':int(partial.sum()),'externalConnectedBackgroundIdentical':True,'reviewedMaterialInteriorPolygons':regions[n]},'alphaPolicy':'Authored opaque target silhouette adapted from captured material alpha within reviewed fur/cloth interiors. Exact external-connected background/root/floor preserved. Generated RGB entirely replaces guide colour; source RGB not delivered. Target contour/receiving review required.'})
    prefix='dk-firstclips-batch03'
    for kind,im in [('seed',canvas),('guide',guide),('render-mask',noise)]:im.save(ART/(prefix+'-'+kind+'.png'))
    graph=json.loads((ART/'dk-firstclips-batch01-attempt3.workflow.json').read_text())
    graph['4']['inputs']['text']='Two by two cartoon animation sprite atlas of the SAME red gorilla identity as top-left reference. Thick WHITE curved eyebrows, distinct rounded WHITE eye whites and narrow BLACK OVAL pupils, cream tan muzzle/chest/hands/feet, red fur and RED necktie with cel-shaded folds. Top-right: final jab recovery, both fists at muzzle height, CLOSED mouth, source face looking right/down. Bottom-left: second-jab wind-up, wide arms bent at sides, open mouth and lowered shoulders, exact source pose. Bottom-right: UPPERCUT ascending phase, mostly BACK-facing bent body and head behind raised arms, one partly visible eye following its small source profile, never an invented frontal head or second visible eye. Neckcloth is naturally occluded in back view. Keep all hands distinct from face, exact source head/body/arm directions and proportions. Hands have subtle thumb/finger creases. Low support/root unchanged. WHITE brows never black; attached eyes never a white ribbon or triangular socket. Smooth red cartoon cel shading, no fur texture. Reference remains unchanged. Uniform magenta background, no floor, shadow or text.'
    graph['7']['inputs'].update(seed=2026100913,denoise=.50)
    for node,kind in [('10','guide'),('13','seed'),('16','render-mask')]:graph[node]['inputs']['image']='pf-'+prefix+'-'+kind+'.png'
    for node,kind in [('9','final'),('20','raw')]:graph[node]['inputs']['filename_prefix']='pf-'+prefix+'-attempt1-'+kind
    workflow=prefix+'-attempt1.workflow.json';(ART/workflow).write_text(json.dumps(graph,indent=2)+'\n');live=ART/'root-firstcontact-live-acceptance.json'
    prep={'state':'prepared_actual_input_review_pending','jobFamily':prefix,'attempt':1,'records':records,'canvas':[1536,1024],'cells':[768,512],'generationScaleFromSource':.5,'deliveryPackingFactorFromSource':.25,'sourceFullRoot':[512,832],'root':[256,416],'scaleToWorld':5/13,'bodyCentreFromRootY':-42,'workflow':workflow,'workflow_sha256':sha(ART/workflow),'pilotLiveAcceptanceReceipt':str(live.relative_to(ROOT)),'pilotLiveAcceptanceSha256':sha(live),'identityReference':{'path':str(ref.relative_to(ROOT)),'sha256':sha(ref),'cell':0,'noiseMask':'zero','ancestry':'Locked idle target identity; accepted native5 contact'},'identity_mechanism':'Reviewed same-identity accepted full contact image VAE starting reference cell0 zero-noise; all three pose body/face pixels freely generated from authored target-colour/oval eye/brow internal-edge guides at half source resolution. No protected eye paste; captured material alpha is repaired within reviewed opaque target interiors, retaining external pose gaps, and used as declared target alpha after RGB generation, independently reviewed before delivery.','inputs':{kind:{'file':prefix+'-'+kind+'.png','sha256':sha(ART/(prefix+'-'+kind+'.png')),'graphNode':node}for node,kind in [('10','guide'),('13','seed'),('16','render-mask')]},'outputNodes':{'9':'final','20':'raw'},'deliveredAssetsChanged':False}
    (ART/(prefix+'-preparation.json')).write_text(json.dumps(prep,indent=2)+'\n');print('Batch3 prepared, actual review pending; no GPU or shipping writes.')
if __name__=='__main__':main()
