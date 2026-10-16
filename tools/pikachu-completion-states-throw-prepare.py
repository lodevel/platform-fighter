"""Prepare a bounded anatomy/floor pilot; no live assets or GPU writes.

Existing accepted core pixels are the identity seed. Target guides author local
underside flex and a Tail1 pivot; unchanged body/root/scale remain protected.
This is an explicit 2D beta shape adaptation, never native anatomy parity.
"""
from pathlib import Path
import json, math, hashlib, argparse
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT=Path(__file__).resolve().parent.parent
BASE=ROOT/'docs/review/2026-10-06/pikachu-character/art/completion-states-throw-floor'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
parser=argparse.ArgumentParser();parser.add_argument('--batch',type=int,required=True,choices=[0,1,2,3]);args=parser.parse_args()
key=f'full-completion-states-throw-floor-uniform-batch{args.batch}-source0'
prep=BASE/'full-pilot-preparation.json'
if prep.exists() and any(r['key']==key for r in json.loads(prep.read_text())['records']):raise ValueError('Existing prepared job immutable; use numbered new key')
frames=json.loads((ROOT/'assets/characters/pikachu/frames.json').read_text())
cases={0:[('bthrow',0),('bthrow',1),('bthrow',3),('dthrow',10)],1:[('fthrow',0),('fthrow',1),('fthrow',2),('fthrow',3)],2:[('fthrow',4),('uthrow',0),('uthrow',1),('uthrow',2)],3:[('uthrow',6),('bthrow',5),('bthrow',6)]}[args.batch]
priorDir=ROOT/'docs/review/2026-10-06/pikachu-character/art/floor-retarget-staged'
priorRecord=json.loads((priorDir/'candidate.json').read_text())
assert priorRecord['state']=='staged_cells_and12caps_actually_reviewed_ready_for_candidate_runtime'
seed=Image.new('RGB',(2048,2560),'#cc498c');mask=Image.new('L',seed.size,0)
records=[];review=Image.new('RGB',(2048,640),'#e4e3df')
for index,(sheet,frame) in enumerate(cases):
    clip=frames['animations'][sheet];source=ROOT/'assets/characters/pikachu'/clip['strip']
    atlas=Image.open(source).convert('RGBA');col,row=clip['sourceCells'][frame];w,h=clip['frameWidth'],clip['frameHeight'];baseline=None
    if sheet=='bthrow' and frame in (5,6):
        approved=next(r for r in priorRecord['installFiles'] if r['live']==str(source.relative_to(ROOT)))
        assert sha(source)==approved['priorSha256']
        candidate=ROOT/approved['candidate'];assert sha(candidate)==approved['candidateSha256']
        adapted=next(r for r in priorRecord['changes'] if r['sheet']==sheet and r['artFrameIndex']==frame)
        atlas=Image.open(candidate).convert('RGBA')
        baseline={'kind':'selective reuse of previously accepted substantive source tail/ear fold','atlas':str(candidate.relative_to(ROOT)),'atlasSha256':sha(candidate),'receipt':str((priorDir/'candidate.json').relative_to(ROOT)),'receiptSha256':sha(priorDir/'candidate.json'),'nativeSample':adapted['nativeSample'],'sourceAuthoredFold':adapted['adaptation'],'hurtboxes':adapted['hurtboxes']}

    body=atlas.crop((col*w,row*h,(col+1)*w,(row+1)*h)); padded=Image.new('RGBA',(512,640));padded.alpha_composite(body);body=padded; original=body.copy();partMask=Image.new('L',body.size,0)
    adaptation={}
    if sheet=='tumble' and frame==2:
        # The exposed tail polygon is behind the visible core. Tail1 pivot is
        # measured from the immutable captured skeleton native18 projection.
        pivot=(262.91317514411276,401.51310070351764)
        polygon=[(279,397),(385,397),(385,460),(279,460)]
        tailmask=Image.new('L',body.size,0);ImageDraw.Draw(tailmask).polygon(polygon,fill=255)
        tail=body.copy();tail.putalpha(Image.fromarray(np.minimum(np.asarray(tail.getchannel('A')),np.asarray(tailmask)).astype('uint8')))
        core=body.copy();core.putalpha(Image.fromarray(np.where(np.asarray(tailmask)>0,0,np.asarray(body.getchannel('A'))).astype('uint8')))
        angle=-70;theta=math.radians(angle);co,si=math.cos(theta),math.sin(theta)
        # PIL inverse affine for the authored screen CCW Tail1 rotation.
        a,b=co,si;d,e=-si,co;px,py=pivot;c=px-a*px-b*py;f=py-d*px-e*py
        rotated=tail.transform(body.size,Image.Transform.AFFINE,(a,b,c,d,e,f),Image.Resampling.BICUBIC)
        body=Image.new('RGBA',body.size);body.alpha_composite(rotated);body.alpha_composite(core)
        partMask=Image.fromarray(np.maximum(np.asarray(tailmask),np.asarray(rotated.getchannel('A')))).filter(ImageFilter.MaxFilter(7))
        # Core/cheek/source stripes stay protected even if tail guide crosses.
        array=np.where(np.asarray(core.getchannel('A'))>=32,0,np.asarray(partMask)).astype('uint8');array[417:]=0
        partMask=Image.fromarray(array)
        adaptation={'kind':'Tail1 localrotation','pivotArt':pivot,'screenAngleDegrees':angle,'sourceMotion':'f01damageflyn','nativeSample':18,'oldTailSelection':polygon}
    else:
        bounds=body.getchannel('A').point(lambda v:255 if v>=32 else 0).getbbox()
        first=407;last=bounds[3];destination=416
        # Only the near-floor underside bends up. Upper body and identity
        # landmarks remain exact, and original canvas/foot root never move.
        lower=body.crop((0,first,512,last)).resize((512,destination-first+1),Image.Resampling.LANCZOS)
        body.paste(Image.new('RGBA',(512,640-first)),(0,first));body.alpha_composite(lower,(0,first))
        pixels=np.asarray(original.getchannel('A'));region=(pixels>0);region[:first-4]=False
        partMask=Image.fromarray(region.astype('uint8')*255).filter(ImageFilter.MaxFilter(7))
        # Generator may refine the flexed outline above the locked foot root;
        # below it, matte is protected before generation, not cropped after.
        array=np.asarray(partMask).copy();array[417:]=0;partMask=Image.fromarray(array)
        adaptation={'kind':'local undersideflex','originalArtBand':[first,last],'targetArtBand':[first,destination+1],'maxDisplacementWorldPx':(last-1-destination)*clip['scaleToWorld']}
    offset=(index%2*1024,index//2*1280);bg=Image.new('RGBA',body.size,'#cc498c');bg.alpha_composite(body)
    seed.paste(bg.convert('RGB').resize((1024,1280),Image.Resampling.NEAREST),offset)
    mask.paste(partMask.resize((1024,1280),Image.Resampling.NEAREST),offset)
    panel=Image.new('RGBA',(512,640),'#e4e3df');panel.alpha_composite(body);ImageDraw.Draw(panel).line((0,416,512,416),fill='red',width=1);review.paste(panel.convert('RGB'),(index*512,0));ImageDraw.Draw(review).text((index*512+8,15),f'{sheet}/{frame} target+lockedroot',fill='black')
    records.append({'sheet':sheet,'artFrameIndex':frame,'nativeSample':clip['nativeSampleIndices'][frame],'source':str(source.relative_to(ROOT)),'sourceSha256':sha(source),'offset':offset,'adaptation':adaptation,'acceptedIdentityBaseline':baseline})
BASE.mkdir(exist_ok=True)
# Boundary/colour contours are an independently visible shape guide.
rgb=np.asarray(seed).astype(float);edges=np.zeros(rgb.shape[:2],dtype=bool)
for axis in (0,1):edges|=np.max(np.abs(rgb-np.roll(rgb,1,axis=axis)),axis=2)>35
guide=Image.fromarray((edges*255).astype('uint8')).filter(ImageFilter.MaxFilter(3))
for kind,im in [('seed',seed),('guide',guide),('render-mask',mask)]:im.convert('RGB').save(BASE/f'{key}-{kind}.png')
review.save(BASE/f'{key}-input-review.png')
template=ROOT/'docs/review/2026-10-06/pikachu-character/art/tiled-floor-retarget-medium-pilot-bounded-source0-attempt1.workflow.json'
graph=json.loads(template.read_text());uploads={}
for node,kind,role in [('10','guide','guide'),('13','seed','seed'),('16','render-mask','mask')]:
    remote=f'pf-{key}-{role}.png';graph[node]['inputs']['image']=remote;uploads[remote]=f'{key}-{kind}.png'
graph['4']['inputs']['text']='Distinct fixed 1024x1280 Pikachu game sprite cells on uniform magenta. Keep exact flat rough yellow mouse identity, original body orientation, black tipped ears, source occluded face and body stripes, one attached zigzag tail, short limbs and red cheek only where supplied. Modify ONLY masked small anatomy contours to follow the seed/guide precisely. Poses: '+', '.join(f'cell{i+1} {r["sheet"]} native{r["nativeSample"]} suppliedpose/localfloorflex' for i,r in enumerate(records))+'. Any unused cell stays empty magenta. All unmasked pixels, body size and root are protected. No text, shadows, dividing lines or floor lines. No added face on back, detached tail or extra limbs.'
for node,role in [('9','masked-final'),('20','raw')]:graph[node]['inputs']['filename_prefix']=f'pf-{key}-attempt1-{role}'
(BASE/f'{key}-attempt1.workflow.json').write_text(json.dumps(graph,indent=2)+'\n')
row={'key':key,'state':'prepared_actual_input_review_pending','source_index':0,'hold_game':None,'source_path':str((BASE/f'{key}-seed.png').relative_to(ROOT)),'source_sha256':sha(BASE/f'{key}-seed.png'),'workflow':f'{key}-attempt1.workflow.json','upload_mapping':uploads,'hashes':{k:sha(BASE/f'{key}-{k}.png') for k in ['seed','guide','render-mask']},'coordinate_contract':{'canvas':[2048,2560],'root':None,'world_scale':70/300},'cells':records,'input_review_sha256':sha(BASE/f'{key}-input-review.png'),'parentGraphSha256':sha(template),'limits':['Targetseedisbounedlocalauthoredanatomy, notnativeposeparity','Newregion/maskpilotrequiresactualoutputreview; runtime/pairedreceivingproofremainsseparate']}
prep=BASE/'full-pilot-preparation.json'
data=json.loads(prep.read_text()) if prep.exists() else {'records':[]}
if any(r['key']==key for r in data['records']):raise ValueError('Existing prepared job immutable; use numbered new key')
data['records'].append(row);prep.write_text(json.dumps(data,indent=2)+'\n')
if not (BASE/'full-generation-ledger.json').exists():(BASE/'full-generation-ledger.json').write_text('[]\n')
print(json.dumps({'key':key,'review':str(BASE/f'{key}-input-review.png'),'cells':records}))
