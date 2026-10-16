#!/usr/bin/env python3
"""CPU-only, source-registered low-tilt late and final low-tilt recovery inputs."""
from pathlib import Path
import json, hashlib
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy.ndimage import binary_fill_holes, distance_transform_edt

ROOT = Path(__file__).resolve().parents[1]
ART = ROOT / 'docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/art'
BG = (204, 73, 140)
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()

def main():
    rows = json.loads((ART/'first-three-complete-clips-source-guide-preparation.json').read_text())['sourceRows'][18:20]
    assert [(r['clip'],r['nativeSample']) for r in rows] == [('dtilt',15),('dtilt',24)]
    reference = ART/'firstcontact-clean3-dtilt-native6-cutout.png'
    canvas = Image.new('RGB',(1536,1024),BG)
    guide = Image.new('L',canvas.size); noise = Image.new('L',canvas.size)
    refcell = Image.new('RGBA',(768,512),BG+(255,))
    refcell.alpha_composite(Image.open(reference).convert('RGBA').resize((768,512),Image.Resampling.LANCZOS))
    canvas.paste(refcell.convert('RGB'))
    recipes = {15: {'cover': [(600, 575), (641, 574), (695, 593), (730, 618), (733, 651), (716, 678), (668, 682), (623, 656), (607, 614)],
          'eyes': [(647, 621, 673, 663), (680, 625, 692, 659)],
          'brow': [(635, 614), (649, 605), (672, 613), (687, 621), (685, 630), (670, 620), (650, 616), (637, 623)],
          'ear': (555, 635, 603, 686),
          'tie': [(541, 651), (561, 626), (577, 623), (554, 684), (536, 732), (520, 763), (522, 772), (541, 770), (542, 786), (513, 787)],
          'hands': [[(814, 715), (850, 701), (891, 704)], [(811, 746), (855, 735), (889, 740)]],
          'material': [(554, 564), (595, 520), (650, 503), (684, 544), (722, 600), (710, 651), (678, 678), (608, 672), (568, 624)],
          'palm': [(513, 772), (540, 771), (554, 787), (537, 791), (515, 789)]},
     24: {'cover': [(641, 575), (682, 568), (724, 590), (745, 615), (742, 646), (705, 667), (660, 661), (646, 620)],
          'eyes': [(667, 603, 691, 641), (698, 609, 711, 633)],
          'brow': [(653, 596), (668, 586), (691, 597), (710, 606), (706, 615), (689, 605), (670, 598), (655, 605)],
          'ear': (578, 618, 626, 670),
          'tie': [(521, 688), (542, 661), (558, 651), (534, 716), (521, 763), (522, 780), (556, 779), (555, 796), (519, 798), (504, 780)],
          'hands': [[(578, 493), (619, 474), (666, 477)], [(825, 554), (867, 561), (906, 549)]],
          'material': [(598, 581), (624, 556), (664, 548), (707, 561), (739, 604), (729, 646), (706, 660), (659, 661), (611, 636)],
          'palm': [(849, 579), (873, 582), (890, 606), (869, 612), (849, 604)]}}
    records=[]
    for cell,row in enumerate(rows,1):
        n=row['nativeSample']; rec=recipes[n]; key=row['prefix']
        source=ART/(key+'-palette-seed.png'); maskfile=ART/(key+'-mask.png')
        material=Image.open(maskfile).convert('L'); opaque=np.asarray(material)>=32
        last=int(np.where(opaque)[0].max())
        col=np.asarray(Image.open(source).convert('RGB').filter(ImageFilter.MedianFilter(21))).copy()
        palette=np.asarray([[190,22,5],[233,16,1],[255,211,145],[252,250,238],[24,15,10]],dtype=np.int16)
        dist=((col.astype(np.int16)[:,:,None,:]-palette[None,None,:,:]).astype(np.float32)**2).sum(3)
        col[opaque]=palette[dist.argmin(2)][opaque];col[~opaque]=BG
        # Captured texture ink is not the selected smooth target fur material.
        col[opaque&(col[:,:,0]<60)]=[164,17,4]
        authored=Image.fromarray(col); draw=ImageDraw.Draw(authored)
        draw.polygon(rec['cover'],fill=(190,22,5))
        for x0,y0,x1,y1 in rec['eyes']:
            w=x1-x0;h=y1-y0
            draw.ellipse((x0,y0,x1,y1),fill=(253,250,238))
            draw.ellipse((x0+w*.55,y0+h*.14,x0+w*.94,y0+h*.86),fill=(20,12,7))
        draw.polygon(rec['palm'],fill=(255,211,145))
        draw.polygon(rec['brow'],fill=(253,250,238));draw.arc(rec['ear'],70,280,fill=(255,211,145),width=5)
        draw.polygon(rec['tie'],fill=(232,13,0))
        for line in rec['hands']:draw.line(line,fill=(182,117,62),width=3,joint='curve')
        def warp(im):
            out=Image.new(im.mode,(1536,1024),0 if im.mode=='L' else BG)
            out.paste(im.crop((0,0,1536,760)),(0,0))
            out.paste(im.crop((0,760,1536,last+1)).resize((1536,71),Image.Resampling.NEAREST if im.mode=='L' else Image.Resampling.BICUBIC),(0,760))
            return out
        full=warp(authored); rawalpha=np.asarray(warp(material)).copy()
        visible=rawalpha>=32;envelope=binary_fill_holes(visible);external=~envelope; distance=distance_transform_edt(envelope)
        selected=Image.new('L',(1536,1024));ImageDraw.Draw(selected).polygon(rec['material'],fill=255)
        holes=(np.asarray(selected)>0)&envelope&~visible&(distance>3)
        partial=visible&(distance>3)&(rawalpha<255)
        alpha=rawalpha.copy();alpha[holes|partial]=255
        assert np.array_equal(external,~binary_fill_holes(alpha>=32))
        arr=np.asarray(full).copy();arr[holes]=[190,22,5];full=Image.fromarray(arr)
        fullpath=ART/(key+'-batch07-generation-seed.png');full.save(fullpath)
        alphapath=ART/(key+'-batch07-authored-pose-alpha.png');Image.fromarray(alpha).save(alphapath)
        half=full.resize((768,512),Image.Resampling.LANCZOS);rgb=np.asarray(half).astype(int);edges=np.zeros((512,768),bool)
        for axis in [0,1]:edges|=np.max(np.abs(rgb-np.roll(rgb,1,axis)),axis=2)>35
        x=cell%2*768;y=cell//2*512;canvas.paste(half,(x,y));guide.paste(Image.fromarray((edges*255).astype(np.uint8)),(x,y))
        noise.paste(Image.fromarray(alpha).resize((768,512),Image.Resampling.LANCZOS).filter(ImageFilter.MaxFilter(11)),(x,y))
        records.append({**row,'cell':cell,'sourceSeedSha256':sha(source),'sourceMaskSha256':sha(maskfile),'authoredFullSeed':fullpath.name,'authoredFullSeedSha256':sha(fullpath),'authoredPoseAlpha':alphapath.name,'authoredPoseAlphaSha256':sha(alphapath),'floorTransform':{'inputBandStartPixelY':760,'inputLastPixelY':last,'targetLastPixelY':830,'rootPixelY':832,'pixelsPerNativeUnit':26},'featureAuthoring':rec,'generatedInputReview':'pending','materialAlphaRepair':{'closedMaterialHolePixels':int(holes.sum()),'partialExistingInteriorPixels':int(partial.sum()),'externalConnectedBackgroundIdentical':True},'alphaPolicy':'Reviewed opaque target-material adaptation within declared head interior and existing partial-alpha material; actual exterior-connected background and pose gaps retained. Target geometry and ocular layout authored; captured facial shader parity unverified.'})
    prefix='dk-firstclips-batch07'
    for kind,im in [('seed',canvas),('guide',guide),('render-mask',noise)]:im.save(ART/(prefix+'-'+kind+'.png'))
    graph=json.loads((ART/'dk-firstclips-batch04-attempt1.workflow.json').read_text())
    graph['4']['inputs']['text']='Two by two animation atlas of SAME red gorilla cartoon identity as top-left accepted low-palm contact reference. Attached WHITE eyes and BLACK OVAL pupils, thick WHITE curved brow following actual low head plane. Cream muzzle hands feet, naturally visible RED necktie. Top right: late DOWN TILT recovery, still LOW CROUCHED, forward handL retracts near muzzle with partly curled fingers, other handR lifts low from floor with fingers open, head remains low between arms. Bottom left: FINAL low recovery pose, BOTH open hands lift above the low head, elbows bent, source torso stays folded and legs low; head appears between raised arms and muzzle remains low. Never substitute upright idle or raise the torso. Retain exact individual finger gaps, hand/head occlusion and profile face orientation. Near and partly visible far eyes follow accepted target reference without extra eye wall or floating brow. Smooth cel-shaded red fur, opaque cream skin, no red palm wedge, hatch or source fur ink. Common scale/root/floor fixed. Bottom right cell EMPTY magenta, not another pose. Reference unchanged, no floor shadows or text.'
    graph['7']['inputs'].update(seed=2026100918,denoise=.50)
    for node,kind in [('10','guide'),('13','seed'),('16','render-mask')]:graph[node]['inputs']['image']='pf-'+prefix+'-'+kind+'.png'
    for node,kind in [('9','final'),('20','raw')]:graph[node]['inputs']['filename_prefix']='pf-'+prefix+'-attempt1-'+kind
    workflow=prefix+'-attempt1.workflow.json';(ART/workflow).write_text(json.dumps(graph,indent=2)+'\n')
    live=ART/'root-firstcontact-live-acceptance.json'
    prep={'state':'prepared_actual_input_review_pending','jobFamily':prefix,'attempt':1,'records':records,'canvas':[1536,1024],'cells':[768,512],'generationScaleFromSource':.5,'deliveryPackingFactorFromSource':.25,'sourceFullRoot':[512,832],'root':[256,416],'scaleToWorld':5/13,'bodyCentreFromRootY':-42,'workflow':workflow,'workflow_sha256':sha(ART/workflow),'pilotLiveAcceptanceReceipt':str(live.relative_to(ROOT)),'pilotLiveAcceptanceSha256':sha(live),'identityReference':{'path':str(reference.relative_to(ROOT)),'sha256':sha(reference),'cell':0,'noiseMask':'zero'},'identity_mechanism':'Same reviewed target contact VAE reference cell0 under zero noise; all new target poses freely generated from authored target-colour internal-edge guides. No native RGB or protected eye paste delivered. Target opaque material alpha is independently retained and reviewed.','inputs':{kind:{'file':prefix+'-'+kind+'.png','sha256':sha(ART/(prefix+'-'+kind+'.png')),'graphNode':node} for node,kind in [('10','guide'),('13','seed'),('16','render-mask')]},'outputNodes':{'9':'final','20':'raw'},'deliveredAssetsChanged':False}
    (ART/(prefix+'-preparation.json')).write_text(json.dumps(prep,indent=2)+'\n')
    print('Batch07 CPU inputs prepared, actual inspection pending; GPU not submitted.')

if __name__=='__main__':main()
