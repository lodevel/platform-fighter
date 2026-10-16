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
BASE=ROOT/'docs/review/2026-10-06/pikachu-character/art/completion-states-crouch-floor'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
parser=argparse.ArgumentParser();parser.add_argument('--batch',type=int,choices=[0,1,2,3,4]);parser.add_argument('--scope',choices=['turn0','turn1','turn2','capture0','capture1','shield0','baseline0','baseline1','attack0','prone0','entry0','hardlanding0','recovery0','recovery1','recovery2','recovery3','recovery4','recovery5','recovery6']);parser.add_argument('--include-tumble-fringe',action='store_true');parser.add_argument('--include-recovery-fringe',action='store_true');args=parser.parse_args()
key=f'full-completion-states-crouch-floor-uniform-batch{args.batch if args.batch is not None else 0}-source0'
if args.include_tumble_fringe:key='full-completion-states-crouch-floor-uniform-batch3-native9-source0'
if args.include_recovery_fringe:key='full-completion-states-crouch-floor-uniform-batch3-fringes-source0'
if args.batch==4:key='full-completion-states-crouch-floor-uniform-batch4-ledge-source0'
if args.scope:key=f'full-completion-states-crouch-floor-uniform-{args.scope}-source0'
prep=BASE/'full-pilot-preparation.json'
if prep.exists() and any(r['key']==key for r in json.loads(prep.read_text())['records']):raise ValueError('Existing prepared job immutable; use numbered new key')
frames=json.loads((ROOT/'assets/characters/pikachu/frames.json').read_text())
cases=[('crawl_back',0),('crouch_start',0),('crouch',1),('crouch_end',0)]+[('crouch',i) for i in [0,2,3,4]]+[('crawl',i) for i in range(4)]+[('crawl_back',2)]
cases=cases[4*(args.batch or 0):4*(args.batch or 0)+4]
if args.batch==4:cases=[('ledge_getup',3),('ledge_roll',2),('ledge_roll',3)]
scopes={
 'turn0':[('dash_turn',0),('dash_turn',2),('run_turn',1),('run_turn',2)],
 'turn1':[('run_turn',3),('run_brake',1),('run_brake',2),('run_brake_left',1)],
 'turn2':[('run_brake_left',2)],
 'capture0':[('grab_pull',1),('grab_pull',2),('grab_hold',0),('grab_hold',1)],
 'capture1':[('grab_hold',2),('grab_hold',3),('pummel',2)],
 'shield0':[('shield_break',0),('shield_break',1),('shield_break',3),('shield_break_end',0)],
 'baseline0':[('idle',0)],
 'baseline1':[('idle',i) for i in [1,2,3,4]],
 'attack0':[('dsmash',0),('dtilt',0),('jab',0)],
 'prone0':[('down_wait',0),('down_wait',1),('down_wait_face_down',0),('down_wait_face_down',1)],
 'entry0':[('entry',2),('entry',3),('entry',4),('entry',5)],
 'hardlanding0':[('landing_hard',i) for i in [0,1,2]],
}
recoveries=[('getup',i) for i in [0,1,4]]+[('getup_face_down',i) for i in [0,1]]+[('getup_roll',i) for i in [0,1,2]]+[('getup_roll_back',i) for i in [0,2,3]]+[('getup_roll_face_down',i) for i in [0,1]]+[('getup_roll_back_face_down',i) for i in [0,1,2,3]]+[('tech',i) for i in [2,3]]+[('tech_forward',i) for i in [1,2,3]]+[('tech_back',i) for i in [1,2,3]]
for i in range(7):scopes['recovery'+str(i)]=recoveries[i*4:(i+1)*4]
if args.scope:cases=scopes[args.scope]
if args.include_tumble_fringe:
    assert args.batch==3
    cases.append(('tumble',1))
if args.include_recovery_fringe:
    assert args.include_tumble_fringe
    cases.append(('getup_attack',5))
seed=Image.new('RGB',(2048,2560),'#cc498c');mask=Image.new('L',seed.size,0)
records=[];review=Image.new('RGB',(2048,640),'#e4e3df')
for index,(sheet,frame) in enumerate(cases):
    clip=frames['animations'][sheet];source=ROOT/'assets/characters/pikachu'/clip['strip']
    atlas=Image.open(source).convert('RGBA');col,row=clip['sourceCells'][frame];w,h=clip['frameWidth'],clip['frameHeight']
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
        first=clip['root'][1]-9;last=bounds[3];destination=clip['root'][1]
        # Only the near-floor underside bends up. Upper body and identity
        # landmarks remain exact, and original canvas/foot root never move.
        lower=body.crop((0,first,512,last)).resize((512,destination-first+1),Image.Resampling.LANCZOS)
        body.paste(Image.new('RGBA',(512,640-first)),(0,first));body.alpha_composite(lower,(0,first))
        pixels=np.asarray(original.getchannel('A'));region=(pixels>0);region[:first-4]=False
        partMask=Image.fromarray(region.astype('uint8')*255).filter(ImageFilter.MaxFilter(7))
        # Generator may refine the flexed outline above the locked foot root;
        # below it, matte is protected before generation, not cropped after.
        array=np.asarray(partMask).copy();array[destination+1:]=0;partMask=Image.fromarray(array)
        adaptation={'kind':'local undersideflex','originalArtBand':[first,last],'targetArtBand':[first,destination+1],'maxDisplacementWorldPx':(last-1-destination)*clip['scaleToWorld']}
    offset=(index%2*1024,index//2*1280);bg=Image.new('RGBA',body.size,'#cc498c');bg.alpha_composite(body)
    seed.paste(bg.convert('RGB').resize((1024,1280),Image.Resampling.NEAREST),offset)
    mask.paste(partMask.resize((1024,1280),Image.Resampling.NEAREST),offset)
    panel=Image.new('RGBA',(512,640),'#e4e3df');panel.alpha_composite(body);ImageDraw.Draw(panel).line((0,clip['root'][1],512,clip['root'][1]),fill='red',width=1);review.paste(panel.convert('RGB'),(index*512,0));ImageDraw.Draw(review).text((index*512+8,15),f'{sheet}/{frame} target+lockedroot',fill='black')
    records.append({'sheet':sheet,'artFrameIndex':frame,'nativeSample':clip.get('nativeSampleIndices',list(range(clip['frameCount'])))[frame],'root':clip['root'],'preserveReceiving':args.scope=='attack0','source':str(source.relative_to(ROOT)),'sourceSha256':sha(source),'sourceCellPixelSha256':hashlib.sha256(atlas.crop((col*w,row*h,(col+1)*w,(row+1)*h)).tobytes()).hexdigest(),'offset':offset,'adaptation':adaptation})
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
