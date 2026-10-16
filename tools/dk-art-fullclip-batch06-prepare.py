#!/usr/bin/env python3
"""CPU-only, source-registered low-tilt protected startup, contact and recovery inputs."""
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
    rows = json.loads((ART/'first-three-complete-clips-source-guide-preparation.json').read_text())['sourceRows'][15:18]
    assert [(r['clip'],r['nativeSample']) for r in rows] == [('dtilt',5),('dtilt',7),('dtilt',8)]
    reference = ART/'firstcontact-clean3-dtilt-native6-cutout.png'
    canvas = Image.new('RGB',(1536,1024),BG)
    guide = Image.new('L',canvas.size); noise = Image.new('L',canvas.size)
    refcell = Image.new('RGBA',(768,512),BG+(255,))
    refcell.alpha_composite(Image.open(reference).convert('RGBA').resize((768,512),Image.Resampling.LANCZOS))
    canvas.paste(refcell.convert('RGB'))
    recipes = {5: {'cover': [(666, 605), (714, 605), (762, 627), (788, 656), (791, 695), (758, 722), (714, 725), (687, 700), (669, 651)],
         'eyes': [(708, 659, 735, 702), (741, 661, 754, 696)],
         'brow': [(697, 651), (711, 643), (733, 650), (747, 657), (747, 665), (733, 659), (713, 653), (698, 660)],
         'ear': (635, 679, 677, 728),
         'tie': [(560, 718), (582, 695), (603, 680), (606, 694), (584, 742), (569, 772), (558, 770)],
         'hands': [],
         'material': [(624, 589), (667, 551), (719, 547), (758, 579), (785, 641), (772, 685), (745, 720), (700, 712), (647, 671)],
         'palm': [(1108, 696), (1145, 690), (1142, 725), (1129, 743), (1115, 736)]},
     7: {'cover': [(626, 605), (674, 605), (722, 627), (748, 656), (751, 695), (718, 722), (674, 725), (647, 700), (629, 651)],
         'eyes': [(668, 659, 695, 702), (701, 661, 714, 696)],
         'brow': [(657, 651), (671, 643), (693, 650), (707, 657), (707, 665), (693, 659), (673, 653), (658, 660)],
         'ear': (595, 679, 637, 728),
         'tie': [(560, 718), (582, 695), (603, 680), (606, 694), (584, 742), (569, 772), (558, 770)],
         'hands': [],
         'material': [(584, 589), (627, 551), (679, 547), (718, 579), (745, 641), (732, 685), (705, 720), (660, 712), (607, 671)],
         'palm': [(1038, 744), (1067, 735), (1072, 779), (1053, 786)]},
     8: {'cover': [(618, 603), (666, 603), (714, 625), (740, 654), (743, 693), (710, 720), (666, 723), (639, 698), (621, 649)],
         'eyes': [(660, 657, 687, 700), (693, 659, 706, 694)],
         'brow': [(649, 649), (663, 641), (685, 648), (699, 655), (699, 663), (685, 657), (665, 651), (650, 658)],
         'ear': (587, 677, 629, 726),
         'tie': [(560, 718), (582, 695), (603, 680), (606, 694), (584, 742), (569, 772), (558, 770)],
         'hands': [],
         'material': [(576, 587), (619, 549), (671, 545), (710, 577), (737, 639), (724, 683), (697, 718), (652, 710), (599, 669)],
         'palm': [(993, 764), (1015, 749), (1025, 790), (1007, 800)]}}
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
        fullpath=ART/(key+'-batch06-generation-seed.png');full.save(fullpath)
        alphapath=ART/(key+'-batch06-authored-pose-alpha.png');Image.fromarray(alpha).save(alphapath)
        half=full.resize((768,512),Image.Resampling.LANCZOS);rgb=np.asarray(half).astype(int);edges=np.zeros((512,768),bool)
        for axis in [0,1]:edges|=np.max(np.abs(rgb-np.roll(rgb,1,axis)),axis=2)>35
        x=cell%2*768;y=cell//2*512;canvas.paste(half,(x,y));guide.paste(Image.fromarray((edges*255).astype(np.uint8)),(x,y))
        noise.paste(Image.fromarray(alpha).resize((768,512),Image.Resampling.LANCZOS).filter(ImageFilter.MaxFilter(11)),(x,y))
        records.append({**row,'cell':cell,'sourceSeedSha256':sha(source),'sourceMaskSha256':sha(maskfile),'authoredFullSeed':fullpath.name,'authoredFullSeedSha256':sha(fullpath),'authoredPoseAlpha':alphapath.name,'authoredPoseAlphaSha256':sha(alphapath),'floorTransform':{'inputBandStartPixelY':760,'inputLastPixelY':last,'targetLastPixelY':830,'rootPixelY':832,'pixelsPerNativeUnit':26},'featureAuthoring':rec,'generatedInputReview':'pending','materialAlphaRepair':{'closedMaterialHolePixels':int(holes.sum()),'partialExistingInteriorPixels':int(partial.sum()),'externalConnectedBackgroundIdentical':True},'alphaPolicy':'Reviewed opaque target-material adaptation within declared head interior and existing partial-alpha material; actual exterior-connected background and pose gaps retained. Target geometry and ocular layout authored; captured facial shader parity unverified.'})
    prefix='dk-firstclips-batch06'
    for kind,im in [('seed',canvas),('guide',guide),('render-mask',noise)]:im.save(ART/(prefix+'-'+kind+'.png'))
    graph=json.loads((ART/'dk-firstclips-batch04-attempt1.workflow.json').read_text())
    graph['4']['inputs']['text']='Two by two animation atlas of SAME red gorilla cartoon identity as top-left accepted low-palm contact reference. Attached WHITE eye whites with BLACK OVAL pupils and thick WHITE brow following the source low-head plane; cream muzzle hands feet, RED naturally occluded necktie. All three new drawings remain EXTREMELY LOW to floor with head in front of folded torso, support handR on ground. Top right: protected startup, forward handL fully OPEN with individual outstretched fingers. Bottom left: second active follow-through, forward handL fingers PARTLY CURL while head and low torso remain steady. Bottom right: first recovery/reset, forward handL palm and fingers curl TIGHTER into a cupped hand, never stand upright. Keep source forearm and palm orientation, finger gaps and head-arm gaps. Near and partly visible far eyes follow accepted reference, never a floating ribbon or extra eye wall; open mouth follows low source jaw. Smooth cel shaded red fur, opaque cream skin without red palm wedge or triangular hatch. Source common scale/root/floor retained. Reference unchanged; magenta background, no texture ink or text.'
    graph['7']['inputs'].update(seed=2026100917,denoise=.50)
    for node,kind in [('10','guide'),('13','seed'),('16','render-mask')]:graph[node]['inputs']['image']='pf-'+prefix+'-'+kind+'.png'
    for node,kind in [('9','final'),('20','raw')]:graph[node]['inputs']['filename_prefix']='pf-'+prefix+'-attempt1-'+kind
    workflow=prefix+'-attempt1.workflow.json';(ART/workflow).write_text(json.dumps(graph,indent=2)+'\n')
    live=ART/'root-firstcontact-live-acceptance.json'
    prep={'state':'prepared_actual_input_review_pending','jobFamily':prefix,'attempt':1,'records':records,'canvas':[1536,1024],'cells':[768,512],'generationScaleFromSource':.5,'deliveryPackingFactorFromSource':.25,'sourceFullRoot':[512,832],'root':[256,416],'scaleToWorld':5/13,'bodyCentreFromRootY':-42,'workflow':workflow,'workflow_sha256':sha(ART/workflow),'pilotLiveAcceptanceReceipt':str(live.relative_to(ROOT)),'pilotLiveAcceptanceSha256':sha(live),'identityReference':{'path':str(reference.relative_to(ROOT)),'sha256':sha(reference),'cell':0,'noiseMask':'zero'},'identity_mechanism':'Same reviewed target contact VAE reference cell0 under zero noise; all new target poses freely generated from authored target-colour internal-edge guides. No native RGB or protected eye paste delivered. Target opaque material alpha is independently retained and reviewed.','inputs':{kind:{'file':prefix+'-'+kind+'.png','sha256':sha(ART/(prefix+'-'+kind+'.png')),'graphNode':node} for node,kind in [('10','guide'),('13','seed'),('16','render-mask')]},'outputNodes':{'9':'final','20':'raw'},'deliveredAssetsChanged':False}
    (ART/(prefix+'-preparation.json')).write_text(json.dumps(prep,indent=2)+'\n')
    print('Batch06 CPU inputs prepared, actual inspection pending; GPU not submitted.')

if __name__=='__main__':main()
