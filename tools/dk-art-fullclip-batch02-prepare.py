#!/usr/bin/env python3
"""Distinct improved first-attempt inputs for three inspected jab recovery poses.
CPU preparation only; target features are authored, freely generated, and reviewed.
"""
from pathlib import Path
import hashlib,json
import numpy as np
from PIL import Image,ImageDraw,ImageFilter

ROOT=Path(__file__).resolve().parents[1];ART=ROOT/'docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/art'
BG=(204,73,140);W,H=1536,1024
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def main():
    rows=json.loads((ART/'first-three-complete-clips-source-guide-preparation.json').read_text())['sourceRows'][3:6]
    if [r['nativeSample']for r in rows]!=[7,9,17] or any(r['clip']!='jab'for r in rows):raise ValueError('Selected batch changed')
    ref=ART/'firstcontact-clean3-jab1-native5-cutout.png';reference=Image.open(ref).convert('RGBA')
    canvas=Image.new('RGB',(1536,1024),BG);guide=Image.new('L',canvas.size);noise=Image.new('L',canvas.size)
    reduced=reference.resize((768,512),Image.Resampling.LANCZOS);refcell=Image.new('RGBA',(768,512),BG+(255,));refcell.alpha_composite(reduced);canvas.paste(refcell.convert('RGB'))
    recipes={
        7:{'cover':[(599,430),(655,438),(705,495),(710,548),(640,557),(604,537)],'eyes':[(626,517,663,550),(666,531,691,555)],'brows':[[(617,506),(633,500),(664,514),(661,524),(638,514),(620,517)],[(666,522),(681,526),(694,520),(699,529),(684,537),(668,532)]],'face':[(490,403),(748,403),(749,641),(499,670)],'mouth':[(551,564),(624,599),(592,641)],'tie':[(452,549),(479,580),(492,641),(539,692),(526,723),(471,693),(451,640)]},
        9:{'cover':[(608,430),(664,439),(713,496),(719,557),(646,566),(608,542)],'eyes':[(642,524,678,555),(682,537,707,561)],'brows':[[(633,513),(648,506),(679,521),(676,531),(652,519),(636,523)],[(683,528),(696,532),(711,525),(715,536),(698,543),(683,538)]],'face':[(499,402),(770,402),(771,651),(510,685)],'mouth':[(559,573),(645,611),(613,656)],'tie':[(465,545),(500,588),(513,630),(541,656),(527,728),(466,710),(420,666),(436,626)]},
        17:{'cover':[(628,415),(688,429),(733,485),(735,538),(663,551),(629,527)],'eyes':[(669,506,705,538),(708,521,733,545)],'brows':[[(658,495),(675,490),(706,504),(703,515),(680,503),(662,507)],[(709,511),(724,516),(736,509),(740,521),(725,528),(709,522)]],'face':[(531,377),(773,377),(774,644),(534,684)],'mouth':None,'tie':[(503,587),(549,635),(592,681),(585,734),(557,790),(503,797),(452,756),(457,701)]}}
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
        stem={7:[(591,465),(602,462),(605,533),(595,538)],9:[(598,468),(611,465),(613,540),(602,545)],17:[(624,451),(637,446),(640,516),(627,521)]}[n]
        d.polygon(stem,fill=(190,22,5))
        # Sparse, reviewed target crease/ear marks retain source part readability
        # after native texture filtering. They remain mutable during generation.
        ears={7:(522,455,554,507),9:(536,458,568,511),17:(557,441,591,495)}
        d.arc(ears[n],70,280,fill=(255,211,145),width=5)
        hands={7:[[(532,686),(525,704),(516,720)],[(562,708),(548,735)],[(600,734),(576,767)]],9:[[(622,673),(600,691),(584,705)],[(660,710),(639,731),(622,747)],[(707,747),(678,778)]],17:[[(365,451),(333,471)],[(390,492),(356,516)],[(408,535),(374,553)],[(817,552),(846,564),(863,580)],[(817,597),(846,610),(866,626)]]}
        for line in hands[n]:d.line(line,fill=(182,117,62),width=3,joint='curve')
        if rec['mouth']:d.polygon(rec['mouth'],fill=(145,20,10))
        nostrils={7:[(654,560,662,572),(669,573,674,580)],9:[(681,578,689,590),(695,588,700,595)],17:[(681,550,690,567)]}
        for ellipse in nostrils[n]:d.ellipse(ellipse,fill=(112,56,24))
        if n==17:d.line([(575,545),(594,569),(624,591),(660,611),(697,626),(716,624)],fill=(181,111,59),width=3,joint='curve')
        # Same actual source cloth surface, target red palette without source DK
        # glyphs. This is mutable authored guide, never direct native RGB delivery.
        tie=Image.new('L',(W,H));ImageDraw.Draw(tie).polygon(rec['tie'],fill=255);t=(np.asarray(tie)>0)&opaque;arr=np.asarray(authored).copy();arr[t]=[232,13,0];authored=Image.fromarray(arr)
        d=ImageDraw.Draw(authored);folds={7:[(454,634),(476,653),(522,699)],9:[(439,651),(470,679),(522,712)],17:[(466,705),(511,744),(576,728)]}
        d.line(folds[n],fill=(158,17,5),width=3,joint='curve')
        def warp(im):
            out=Image.new(im.mode,(W,H),0 if im.mode=='L'else BG);out.paste(im.crop((0,0,W,760)),(0,0));out.paste(im.crop((0,760,W,last+1)).resize((W,71),Image.Resampling.NEAREST if im.mode=='L'else Image.Resampling.BICUBIC),(0,760));return out
        full=warp(authored);target_mask=warp(source_mask);fullpath=ART/(name+'-v2-generation-seed.png');full.save(fullpath);alphapath=ART/(name+'-v2-authored-pose-alpha.png');target_mask.save(alphapath)
        half=full.resize((768,512),Image.Resampling.LANCZOS);rgb=np.asarray(half).astype(int);edge=np.zeros((512,768),bool)
        for axis in [0,1]:edge|=np.max(np.abs(rgb-np.roll(rgb,1,axis)),axis=2)>35
        g=Image.fromarray((edge*255).astype(np.uint8));m=target_mask.resize((768,512),Image.Resampling.LANCZOS).filter(ImageFilter.MaxFilter(11));x=index%2*768;y=index//2*512;canvas.paste(half,(x,y));guide.paste(g,(x,y));noise.paste(m,(x,y))
        records.append({**row,'cell':index,'sourceSeedSha256':sha(source),'sourceMaskSha256':sha(maskpath),'authoredFullSeed':fullpath.name,'authoredFullSeedSha256':sha(fullpath),'authoredPoseAlpha':alphapath.name,'authoredPoseAlphaSha256':sha(alphapath),'floorTransform':{'inputBandStartPixelY':760,'inputLastPixelY':last,'targetLastPixelY':830,'rootPixelY':832,'pixelsPerNativeUnit':26},'featureAuthoring':rec,'generatedInputReview':'pending','alphaPolicy':'Author-reviewed captured pose silhouette guide retained as target alpha; generated RGB entirely replaces guide colour within it. Source RGB not delivered. Target contour/receiving review required.'})
    prefix='dk-firstclips-batch02'
    for kind,im in [('seed',canvas),('guide',guide),('render-mask',noise)]:im.save(ART/(prefix+'-'+kind+'.png'))
    graph=json.loads((ART/'dk-firstclips-batch01-attempt3.workflow.json').read_text())
    graph['4']['inputs']['text']='Two by two cartoon animation sprite atlas of the SAME red gorilla identity as top-left reference. Thick WHITE curved eyebrows, distinct rounded WHITE eye whites and narrow BLACK OVAL pupils, cream tan muzzle/chest/hands/feet, red fur and RED necktie with cel-shaded folds. Every other cell follows its supplied exact source recovery pose, head/body/hand placement, face looking right. Top-right: fist retracting down across front, opposite fist high by shoulder. Bottom-left: front fist drawing back at knee, opposite fist by shoulder. Bottom-right: both fists lift into ready guard, closed muzzle. Keep all hands distinct from mouth; closed fists have subtle thumb/finger crease contours. Retain exact source hand direction, root and low support; clean smooth cel shading without source ink/hair texture. WHITE brows never black. No white ribbon or triangular eye socket. Keep reference unchanged. Uniform magenta background, no floor, shadow or text.'
    graph['7']['inputs'].update(seed=2026100912,denoise=.50)
    for node,kind in [('10','guide'),('13','seed'),('16','render-mask')]:graph[node]['inputs']['image']='pf-'+prefix+'-'+kind+'.png'
    for node,kind in [('9','final'),('20','raw')]:graph[node]['inputs']['filename_prefix']='pf-'+prefix+'-attempt1-'+kind
    workflow=prefix+'-attempt1.workflow.json';(ART/workflow).write_text(json.dumps(graph,indent=2)+'\n');live=ART/'root-firstcontact-live-acceptance.json'
    prep={'state':'prepared_actual_input_review_pending','jobFamily':prefix,'attempt':1,'records':records,'canvas':[1536,1024],'cells':[768,512],'generationScaleFromSource':.5,'deliveryPackingFactorFromSource':.25,'sourceFullRoot':[512,832],'root':[256,416],'scaleToWorld':5/13,'bodyCentreFromRootY':-42,'workflow':workflow,'workflow_sha256':sha(ART/workflow),'pilotLiveAcceptanceReceipt':str(live.relative_to(ROOT)),'pilotLiveAcceptanceSha256':sha(live),'identityReference':{'path':str(ref.relative_to(ROOT)),'sha256':sha(ref),'cell':0,'noiseMask':'zero','ancestry':'Locked idle target identity; accepted native5 contact'},'identity_mechanism':'Reviewed same-identity accepted full contact image VAE starting reference cell0 zero-noise; all three pose body/face pixels freely generated from authored target-colour/oval eye/brow internal-edge guides at half source resolution. No protected eye paste; source silhouette is retained as declared target alpha after RGB generation, independently reviewed before delivery.','inputs':{kind:{'file':prefix+'-'+kind+'.png','sha256':sha(ART/(prefix+'-'+kind+'.png')),'graphNode':node}for node,kind in [('10','guide'),('13','seed'),('16','render-mask')]},'outputNodes':{'9':'final','20':'raw'},'deliveredAssetsChanged':False}
    (ART/(prefix+'-preparation.json')).write_text(json.dumps(prep,indent=2)+'\n');print('Batch2 prepared, actual review pending; no GPU or shipping writes.')
if __name__=='__main__':main()
