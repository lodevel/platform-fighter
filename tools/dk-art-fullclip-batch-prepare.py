#!/usr/bin/env python3
"""Prepare a reviewed-pose batch graph without contacting Comfy or shipping assets."""
from pathlib import Path
import argparse, hashlib, json
from PIL import Image, ImageFilter, ImageDraw
import numpy as np

ROOT=Path(__file__).resolve().parents[1]
ART=ROOT/'docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/art'
W,H=1536,1024
BG=(204,73,140)
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()

def prepare(batch):
    proposals=json.loads((ART/'first-three-complete-clips-source-guide-preparation.json').read_text())['sourceRows']
    rows=proposals[(batch-1)*3:batch*3]
    if not rows:raise ValueError('No poses in batch')
    prefix=f'dk-firstclips-batch{batch:02d}'
    seed=Image.new('RGB',(W*2,H*2),BG);guide=Image.new('L',seed.size);mask=Image.new('L',seed.size)
    ref=ROOT/'docs/review/2026-09-25/donkeykong-character/art/idle-keyframe.png'
    a=np.asarray(Image.open(ref).convert('RGBA')).copy();rgb=a[:,:,:3].astype(float)
    bg=(rgb[:,:,2]>rgb[:,:,0]*.7)&(rgb[:,:,2]>rgb[:,:,1]*1.25)&(rgb[:,:,2]>115);a[bg,3]=0
    im=Image.fromarray(a);im=im.crop(im.getbbox());im=im.resize((round(im.width*540/im.height),540),Image.Resampling.LANCZOS)
    cell=Image.new('RGBA',(W,H),BG+(255,));cell.alpha_composite(im,(512-im.width//2,832-im.height));seed.paste(cell.convert('RGB'))
    records=[]
    # Reviewed visible cream brow surfaces only; this is guide palette authoring,
    # never an eye paste or protected generated region.
    brow_polygons={
        'firstclips-jab-native1':[(704,387),(746,383),(777,415),(776,437),(751,445),(714,419)],
        'firstclips-jab-native3':[(672,366),(711,367),(751,403),(780,417),(785,433),(763,450),(720,424),(674,399)],
        'firstclips-jab-native6':[(591,445),(623,437),(655,465),(680,494),(698,514),(690,537),(662,534),(635,508),(608,481)]}
    visible_face_polygons={
        'firstclips-jab-native1':[(694,380),(781,380),(805,475),(809,561),(705,566)],
        'firstclips-jab-native3':[(590,354),(787,354),(855,468),(852,610),(616,651),(588,447)],
        'firstclips-jab-native6':[(509,431),(705,431),(742,534),(725,670),(513,659)]}
    for index,row in enumerate(rows,1):
        name=row['prefix'];source=ART/(name+'-palette-seed.png');source_mask=Image.open(ART/(name+'-mask.png')).convert('L')
        opaque=np.asarray(source_mask)>=32;last=int(np.nonzero(opaque)[0].max());start=760;target=830
        if last<start:raise ValueError('Unsupported support-band placement; review pose')
        def warp(image):
            out=Image.new(image.mode,(W,H),0 if image.mode=='L' else BG);out.paste(image.crop((0,0,W,start)),(0,0))
            out.paste(image.crop((0,start,W,last+1)).resize((W,target-start+1),Image.Resampling.NEAREST if image.mode=='L' else Image.Resampling.BICUBIC),(0,start));return out
        col=np.asarray(Image.open(source).convert('RGB').filter(ImageFilter.MedianFilter(11))).copy()
        palette=np.asarray([[190,22,3],[234,42,9],[255,211,145],[250,249,235],[24,15,10]],dtype=np.int16)
        distance=((col.astype(np.int16)[:,:,None,:]-palette[None,None,:,:]).astype(np.float32)**2).sum(3)
        col[opaque]=palette[distance.argmin(2)][opaque];col[~opaque]=BG
        if name in visible_face_polygons:
            face=Image.new('L',(W,H));ImageDraw.Draw(face).polygon(visible_face_polygons[name],fill=255)
            body_dark=(np.max(col,axis=2)<60)&opaque&(np.asarray(face)==0)
            # Native baked body occlusion is not the selected cartoon palette;
            # retain its pose while replacing opaque black hip stars by red shade.
            col[body_dark]=[132,19,4]
        if name in brow_polygons:
            brow=Image.new('L',(W,H));ImageDraw.Draw(brow).polygon(brow_polygons[name],fill=255)
            cream=(col[:,:,0]>240)&(col[:,:,1]>170)&(col[:,:,1]<235)&(col[:,:,2]<200)
            col[(np.asarray(brow)>0)&cream&opaque]=[250,249,235]
        sm=warp(source_mask);colored=warp(Image.fromarray(col));c=np.asarray(colored).astype(int);support=np.asarray(sm)>0;edges=np.zeros((H,W),bool)
        for axis in [0,1]:edges|=(np.max(np.abs(c-np.roll(c,1,axis)),2)>45)&support
        g=Image.fromarray((edges*255).astype('uint8')).filter(ImageFilter.MaxFilter(3))
        x=index%2*W;y=index//2*H;seed.paste(colored,(x,y));guide.paste(g,(x,y));mask.paste(sm.filter(ImageFilter.MaxFilter(19)),(x,y))
        for kind,image in [('seed',colored),('guide',g),('mask',sm)]:image.save(ART/(name+'-generation-'+kind+'.png'))
        records.append({**row,'cell':index,'sourceSeedSha256':sha(source),'floorTransform':{'inputBandStartPixelY':760,'inputLastPixelY':last,'targetLastPixelY':830,'rootPixelY':832,'pixelsPerNativeUnit':26},'browGuidePaletteAuthoring':brow_polygons.get(name),'bodyDarkPaletteAdaptation':'Native opaque black body occlusion outside reviewed face polygon becomes deep cartoon red; eye/mouth source dark marks retained, all generated interiors mutable.','generatedInputReview':'pending'})
    for kind,image in [('seed',seed),('guide',guide),('render-mask',mask)]:image.save(ART/(prefix+'-'+kind+'.png'))
    graph=json.loads((ART/'dk-firstcontact-pilot-attempt1.workflow.json').read_text())
    roles='Top right: back-turned winding startup, fists low in front and behind. Bottom left: front-facing winding pose, rear fist pulled back and nearer fist by muzzle. Bottom right: final active straight-punch pose with large nearer rightward and downward fist, opposite fist by shoulder.' if batch==1 else 'Follow all three supplied distinct source-motion anatomy guides and their exact hand/head/root positions.'
    graph['4']['inputs']['text']='Two by two animation sprite atlas of exactly the same red cartoon Donkey Kong as the top-left identity reference. Thick WHITE eyebrows, WHITE sclera with small BLACK oval pupils attached to the face; cream tan muzzle, chest, hands and feet; red fur, red necktie with clear folds when visible, naturally occluded by body and arms. Clean cel cartoon shading and thin dark contours, smooth colors, no fur grain. '+roles+' Every cell preserves its guide body proportions, pose, hand directions, head location and foot supports. One head, one eye pair when visible, one brow pair following that head. Keep top-left identity reference unchanged. Uniform magenta background, no floor, shadow or text.'
    graph['7']['inputs'].update(seed=2026100900+batch,denoise=.72)
    for node,kind in [('10','guide'),('13','seed'),('16','render-mask')]:graph[node]['inputs']['image']='pf-'+prefix+'-'+kind+'.png'
    for node,kind in [('9','final'),('20','raw')]:graph[node]['inputs']['filename_prefix']='pf-'+prefix+'-attempt1-'+kind
    workflow=prefix+'-attempt1.workflow.json';(ART/workflow).write_text(json.dumps(graph,indent=2)+'\n')
    live=ART/'root-firstcontact-live-acceptance.json'
    result={'state':'prepared_actual_input_review_pending','jobFamily':prefix,'attempt':1,'records':records,'canvas':[W*2,H*2],'cells':[W,H],'root':[512,832],'scaleToWorld':5/26,'bodyCentreFromRootY':-42,'workflow':workflow,'workflow_sha256':sha(ART/workflow),'pilotLiveAcceptanceReceipt':str(live.relative_to(ROOT)),'pilotLiveAcceptanceSha256':sha(live),'identityReference':{'path':str(ref.relative_to(ROOT)),'sha256':sha(ref),'cell':0,'noiseMask':'zero'},'identity_mechanism':'Reviewed identity image VAE starting latent reference cell0, zero noise mask; pose interiors fully generated from authored target-palette captured anatomical guides. No unsupported image conditioning or protected eye paste. Actual output identity/pose per-cell acceptance required.','inputs':{kind:{'file':prefix+'-'+kind+'.png','sha256':sha(ART/(prefix+'-'+kind+'.png')),'graphNode':node} for node,kind in [('10','guide'),('13','seed'),('16','render-mask')]},'outputNodes':{'9':'final','20':'raw'},'deliveredAssetsChanged':False}
    (ART/(prefix+'-preparation.json')).write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'batch':batch,'cells':len(rows),'preparation':prefix+'-preparation.json'}))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('batch',type=int);args=parser.parse_args();prepare(args.batch)
