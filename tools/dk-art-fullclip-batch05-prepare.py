#!/usr/bin/env python3
"""CPU-only, source-registered jab2 recovery and low-tilt startup inputs."""
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
    rows = json.loads((ART/'first-three-complete-clips-source-guide-preparation.json').read_text())['sourceRows'][12:15]
    assert [(r['clip'],r['nativeSample']) for r in rows] == [('jab2',19),('jab2',31),('dtilt',1)]
    reference = ART/'firstcontact-clean3-jab1-native5-cutout.png'
    canvas = Image.new('RGB',(1536,1024),BG)
    guide = Image.new('L',canvas.size); noise = Image.new('L',canvas.size)
    refcell = Image.new('RGBA',(768,512),BG+(255,))
    refcell.alpha_composite(Image.open(reference).convert('RGBA').resize((768,512),Image.Resampling.LANCZOS))
    canvas.paste(refcell.convert('RGB'))
    recipes = {
      19: {'cover':[(628,322),(671,327),(718,353),(728,387),(713,433),(672,443),(650,421),(635,379)], 'eye':(681,359,704,386), 'brow':[(670,350),(683,343),(705,357),(711,370),(701,366),(684,354),(672,360)], 'ear':(585,402,634,456), 'tie':[(554,648),(582,652),(614,679),(610,722),(574,734),(551,708)], 'hands':[[(781,453),(809,450),(840,478)],[(780,485),(811,491),(839,510)]], 'material':[(530,280),(575,259),(668,270),(717,318),(719,374),(673,433),(617,422),(573,371)]},
      31: {'cover':[(699,326),(741,329),(785,356),(802,386),(786,432),(751,441),(717,418),(702,376)], 'eye':(747,362,772,390), 'brow':[(734,351),(748,345),(773,360),(780,372),(770,368),(750,356),(736,362)], 'ear':(659,392,710,445), 'tie':[(580,653),(615,655),(641,684),(633,729),(605,735),(581,708)], 'hands':[[(779,543),(815,557),(846,573)],[(783,581),(817,596),(848,604)]], 'material':[(614,268),(655,247),(743,259),(787,307),(792,376),(748,435),(690,426),(650,372)]},
      1: {'cover':[(690,379),(714,389),(745,401),(761,427),(751,460),(724,468),(704,444),(691,412)], 'eye':(716,414,737,437), 'brow':[(705,404),(717,400),(737,412),(742,422),(733,419),(719,410),(707,414)], 'ear':(674,459,703,494), 'tie':[(464,785),(490,780),(530,808),(528,833),(494,833),(468,819)], 'hands':[[(604,795),(630,812),(690,821)]], 'material':[(632,332),(684,311),(745,337),(759,387),(747,452),(716,466),(681,443),(658,395)]}}
    # The low source head lies 200 rows below the upright source profiles.
    # Registration is checked on full-size source crops, never display scaling.
    for k in ['cover','brow','material']:
        recipes[1][k]=[(x,y+200) for x,y in recipes[1][k]]
    for k in ['eye','ear']:
        x0,y0,x1,y1=recipes[1][k];recipes[1][k]=(x0,y0+200,x1,y1+200)
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
        x0,y0,x1,y1=rec['eye']; w=x1-x0;h=y1-y0
        draw.ellipse(rec['eye'],fill=(253,250,238))
        draw.ellipse((x0+w*.55,y0+h*.14,x0+w*.94,y0+h*.86),fill=(20,12,7))
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
        fullpath=ART/(key+'-batch05-generation-seed.png');full.save(fullpath)
        alphapath=ART/(key+'-batch05-authored-pose-alpha.png');Image.fromarray(alpha).save(alphapath)
        half=full.resize((768,512),Image.Resampling.LANCZOS);rgb=np.asarray(half).astype(int);edges=np.zeros((512,768),bool)
        for axis in [0,1]:edges|=np.max(np.abs(rgb-np.roll(rgb,1,axis)),axis=2)>35
        x=cell%2*768;y=cell//2*512;canvas.paste(half,(x,y));guide.paste(Image.fromarray((edges*255).astype(np.uint8)),(x,y))
        noise.paste(Image.fromarray(alpha).resize((768,512),Image.Resampling.LANCZOS).filter(ImageFilter.MaxFilter(11)),(x,y))
        records.append({**row,'cell':cell,'sourceSeedSha256':sha(source),'sourceMaskSha256':sha(maskfile),'authoredFullSeed':fullpath.name,'authoredFullSeedSha256':sha(fullpath),'authoredPoseAlpha':alphapath.name,'authoredPoseAlphaSha256':sha(alphapath),'floorTransform':{'inputBandStartPixelY':760,'inputLastPixelY':last,'targetLastPixelY':830,'rootPixelY':832,'pixelsPerNativeUnit':26},'featureAuthoring':rec,'generatedInputReview':'pending','materialAlphaRepair':{'closedMaterialHolePixels':int(holes.sum()),'partialExistingInteriorPixels':int(partial.sum()),'externalConnectedBackgroundIdentical':True},'alphaPolicy':'Reviewed opaque target-material adaptation within declared head interior and existing partial-alpha material; actual exterior-connected background and pose gaps retained. Target geometry and ocular layout authored; captured facial shader parity unverified.'})
    prefix='dk-firstclips-batch05'
    for kind,im in [('seed',canvas),('guide',guide),('render-mask',noise)]:im.save(ART/(prefix+'-'+kind+'.png'))
    graph=json.loads((ART/'dk-firstclips-batch04-attempt1.workflow.json').read_text())
    graph['4']['inputs']['text']='Two by two animation atlas of SAME red gorilla cartoon identity as top-left reference. Small attached WHITE eye oval with BLACK OVAL pupil, thick WHITE curved brow, cream muzzle hands feet, naturally visible RED necktie. Top right: late uppercut guard recovery, bent front arm and fist near chest, other fist raised behind head, head looking right. Bottom left: final uppercut guard recovery, source rotated torso, front fist under muzzle, raised rear fist, low bent legs. Bottom right: extremely LOW down-tilt startup, torso folded over legs, open trailing hand extended behind to left, forward low palm resting near floor to right, profile head close to that palm. Exact source pose and orientation; never stand down-tilt upright. One profile eye only, no second white eye wall or ribbon, no floating brows. Smooth cartoon cel-shaded red fur, sparse hand crease lines. Preserve arm/head/torso gaps and common scale/floor/root. No baked native texture ink, text or shadows. Top-left reference unchanged.'
    graph['7']['inputs'].update(seed=2026100916,denoise=.50)
    for node,kind in [('10','guide'),('13','seed'),('16','render-mask')]:graph[node]['inputs']['image']='pf-'+prefix+'-'+kind+'.png'
    for node,kind in [('9','final'),('20','raw')]:graph[node]['inputs']['filename_prefix']='pf-'+prefix+'-attempt1-'+kind
    workflow=prefix+'-attempt1.workflow.json';(ART/workflow).write_text(json.dumps(graph,indent=2)+'\n')
    live=ART/'root-firstcontact-live-acceptance.json'
    prep={'state':'prepared_actual_input_review_pending','jobFamily':prefix,'attempt':1,'records':records,'canvas':[1536,1024],'cells':[768,512],'generationScaleFromSource':.5,'deliveryPackingFactorFromSource':.25,'sourceFullRoot':[512,832],'root':[256,416],'scaleToWorld':5/13,'bodyCentreFromRootY':-42,'workflow':workflow,'workflow_sha256':sha(ART/workflow),'pilotLiveAcceptanceReceipt':str(live.relative_to(ROOT)),'pilotLiveAcceptanceSha256':sha(live),'identityReference':{'path':str(reference.relative_to(ROOT)),'sha256':sha(reference),'cell':0,'noiseMask':'zero'},'identity_mechanism':'Same reviewed target contact VAE reference cell0 under zero noise; all new target poses freely generated from authored target-colour internal-edge guides. No native RGB or protected eye paste delivered. Target opaque material alpha is independently retained and reviewed.','inputs':{kind:{'file':prefix+'-'+kind+'.png','sha256':sha(ART/(prefix+'-'+kind+'.png')),'graphNode':node} for node,kind in [('10','guide'),('13','seed'),('16','render-mask')]},'outputNodes':{'9':'final','20':'raw'},'deliveredAssetsChanged':False}
    (ART/(prefix+'-preparation.json')).write_text(json.dumps(prep,indent=2)+'\n')
    print('Batch05 CPU inputs prepared, actual inspection pending; GPU not submitted.')

if __name__=='__main__':main()
