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
    rows=json.loads((ART/'first-three-complete-clips-source-guide-preparation.json').read_text())['sourceRows'][9:12]
    if [(r['clip'],r['nativeSample'])for r in rows]!=[('jab2',6),('jab2',7),('jab2',10)]:raise ValueError('Selected batch changed')
    ref=ART/'firstcontact-clean3-jab1-native5-cutout.png';reference=Image.open(ref).convert('RGBA')
    canvas=Image.new('RGB',(1536,1024),BG);guide=Image.new('L',canvas.size);noise=Image.new('L',canvas.size)
    reduced=reference.resize((768,512),Image.Resampling.LANCZOS);refcell=Image.new('RGBA',(768,512),BG+(255,));refcell.alpha_composite(reduced);canvas.paste(refcell.convert('RGB'))
    recipes={
      6:{'cover':[(636,240),(681,248),(697,276),(690,301),(658,299),(627,282)],'eyes':[(670,273,691,295)],'brows':[[(659,263),(670,259),(688,271),(692,280),(682,278),(671,269),(659,275)]],'face':[(586,204),(729,232),(766,321),(741,418),(663,425),(621,371)],'mouth':[(699,311),(713,324),(711,349),(702,363),(695,347)],'tie':None},
      7:{'cover':[(622,236),(668,253),(686,278),(679,306),(651,308),(617,278)],'eyes':[(657,281,678,304)],'brows':[[(646,271),(657,267),(674,279),(681,289),(670,286),(658,277),(647,281)]],'face':[(594,213),(724,254),(755,335),(723,420),(648,423),(608,374)],'mouth':[(687,321),(702,336),(700,356),(689,370),(683,351)],'tie':None},
      10:{'cover':[(597,243),(644,230),(680,245),(701,273),(688,306),(651,308),(617,291)],'eyes':[(648,285,678,310)],'brows':[[(633,273),(651,266),(674,280),(682,293),(670,289),(650,279),(636,285)]],'face':[(522,213),(695,199),(758,296),(761,390),(674,425),(562,395)],'mouth':[(671,341),(712,361),(726,368),(705,389),(687,385)],'tie':[(647,560),(688,591),(735,630),(746,650),(723,655),(689,634),(661,602)]}}
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
        stem={6:[(626,262),(633,259),(645,292),(638,300)],7:[(617,271),(625,267),(640,301),(633,308)],10:[(608,282),(616,276),(633,313),(626,319)]}[n]
        d.polygon(stem,fill=(190,22,5))
        # Sparse, reviewed target crease/ear marks retain source part readability
        # after native texture filtering. They remain mutable during generation.
        ears={6:(650,343,693,391),7:(647,343,689,393),10:(580,357,630,402)}
        d.arc(ears[n],70,280,fill=(255,211,145),width=5)
        if n in [6,7]:
            # Two tiny isolated baked cream marks on rear fur have no anatomical
            # target feature; remove them from freely mutable guide colour only.
            spots={6:[(466,465,494,492),(573,507,594,530)],7:[(442,468,469,496)]}
            for box in spots[n]:d.ellipse(box,fill=(190,22,5))
        hands={6:[[(662,134),(704,149),(744,153)],[(669,171),(713,179),(744,176)],[(399,244),(434,251),(481,274)],[(396,283),(439,299),(480,303)]],7:[[(641,170),(678,184),(724,190)],[(651,209),(685,219),(714,215)],[(393,238),(435,252),(467,274)],[(400,279),(435,295),(468,301)]],10:[[(733,239),(781,241),(825,237)],[(734,267),(781,272),(818,264)],[(449,247),(474,268),(511,280)],[(447,282),(481,299),(518,310)]]}
        for line in hands[n]:d.line(line,fill=(182,117,62),width=3,joint='curve')
        if rec['mouth']:d.polygon(rec['mouth'],fill=(145,20,10))
        nostrils={6:[(731,340,739,351)],7:[(727,345,735,355)],10:[(728,376,737,387)]}
        for ellipse in nostrils[n]:d.ellipse(ellipse,fill=(112,56,24))
        
        # Same actual source cloth surface, target red palette without source DK
        # glyphs. This is mutable authored guide, never direct native RGB delivery.
        if rec['tie']:
            tie=Image.new('L',(W,H));ImageDraw.Draw(tie).polygon(rec['tie'],fill=255);t=(np.asarray(tie)>0)&opaque;arr=np.asarray(authored).copy();arr[t]=[232,13,0];authored=Image.fromarray(arr)
            d=ImageDraw.Draw(authored);folds={10:[(665,577),(694,606),(730,641)]};d.line(folds[n],fill=(158,17,5),width=3,joint='curve')
        def warp(im):
            out=Image.new(im.mode,(W,H),0 if im.mode=='L'else BG);out.paste(im.crop((0,0,W,760)),(0,0));out.paste(im.crop((0,760,W,last+1)).resize((W,71),Image.Resampling.NEAREST if im.mode=='L'else Image.Resampling.BICUBIC),(0,760));return out
        full=warp(authored);target_mask=warp(source_mask);rawalpha=np.asarray(target_mask).copy();visible=rawalpha>=32;envelope=binary_fill_holes(visible);external=~envelope;dist=distance_transform_edt(envelope)
        # Exact same reviewed target material-opacity policy as qualified static
        # batch2, with new pose-specific head/garment interiors. Pose gaps never
        # receive blanket fill; the external-connected background stays exact.
        regions={6:[[(535,236),(585,203),(626,201),(667,223),(683,250),(671,296),(639,326),(584,314),(531,273)],[(642,330),(686,331),(687,389),(651,390)]],7:[[(537,240),(581,206),(626,209),(673,244),(672,284),(635,325),(580,315),(535,278)],[(641,337),(684,337),(686,392),(642,399)]],10:[[(529,302),(516,258),(560,221),(618,206),(669,223),(678,276),(654,311),(607,340),(558,321)],[(584,352),(628,352),(632,401),(580,410)],[(630,300),(664,305),(682,340),(662,371),(626,363),(626,332)],[(623,359),(651,357),(652,395),(622,398)],[(650,580),(698,602),(728,635),(722,647),(685,628),(654,604)]]}
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
    prefix='dk-firstclips-batch04'
    for kind,im in [('seed',canvas),('guide',guide),('render-mask',noise)]:im.save(ART/(prefix+'-'+kind+'.png'))
    graph=json.loads((ART/'dk-firstclips-batch01-attempt3.workflow.json').read_text())
    graph['4']['inputs']['text']='Two by two cartoon animation sprite atlas of SAME red gorilla identity as top-left reference. Thick WHITE curved eyebrows, distinct small WHITE eye whites and BLACK OVAL pupils, cream tan muzzle/hands/feet, red fur and naturally occluded RED necktie. Top-right and bottom-left: exact two successive UPPERCUT late follow-through poses, mostly BACK-facing head partly hidden behind raised arms, both fists distinct, one partly visible profile eye, narrow open-mouth profile following source head plane; never invent a frontal face or a second visible eye. Bottom-right: early uppercut recovery, head looking right over shoulder, arms bent at guard, open mouth, source torso rotation and low bent legs retained; small source red cloth tail visible. Smooth cartoon cel-shaded red body and cream skin, sparse hand creases, attached WHITE brows never black. Exact source head/arm/body orientation, common support root and scale; preserve pose gaps between arms/head/torso. No textured fur, floating eyes, ribbons, triangular eye sockets or pasted face rectangle. Reference unchanged. Uniform magenta background, no floor/shadow/text.'
    graph['7']['inputs'].update(seed=2026100914,denoise=.50)
    for node,kind in [('10','guide'),('13','seed'),('16','render-mask')]:graph[node]['inputs']['image']='pf-'+prefix+'-'+kind+'.png'
    for node,kind in [('9','final'),('20','raw')]:graph[node]['inputs']['filename_prefix']='pf-'+prefix+'-attempt1-'+kind
    workflow=prefix+'-attempt1.workflow.json';(ART/workflow).write_text(json.dumps(graph,indent=2)+'\n');live=ART/'root-firstcontact-live-acceptance.json'
    prep={'state':'prepared_actual_input_review_pending','jobFamily':prefix,'attempt':1,'records':records,'canvas':[1536,1024],'cells':[768,512],'generationScaleFromSource':.5,'deliveryPackingFactorFromSource':.25,'sourceFullRoot':[512,832],'root':[256,416],'scaleToWorld':5/13,'bodyCentreFromRootY':-42,'workflow':workflow,'workflow_sha256':sha(ART/workflow),'pilotLiveAcceptanceReceipt':str(live.relative_to(ROOT)),'pilotLiveAcceptanceSha256':sha(live),'identityReference':{'path':str(ref.relative_to(ROOT)),'sha256':sha(ref),'cell':0,'noiseMask':'zero','ancestry':'Locked idle target identity; accepted native5 contact'},'identity_mechanism':'Reviewed same-identity accepted full contact image VAE starting reference cell0 zero-noise; all three pose body/face pixels freely generated from authored target-colour/oval eye/brow internal-edge guides at half source resolution. No protected eye paste; captured material alpha is repaired within reviewed opaque target interiors, retaining external pose gaps, and used as declared target alpha after RGB generation, independently reviewed before delivery.','inputs':{kind:{'file':prefix+'-'+kind+'.png','sha256':sha(ART/(prefix+'-'+kind+'.png')),'graphNode':node}for node,kind in [('10','guide'),('13','seed'),('16','render-mask')]},'outputNodes':{'9':'final','20':'raw'},'deliveredAssetsChanged':False}
    (ART/(prefix+'-preparation.json')).write_text(json.dumps(prep,indent=2)+'\n');print('Batch4 prepared, actual review pending; no GPU or shipping writes.')
if __name__=='__main__':main()
