"""Three actual tiny floor defects; valid ledge tail is fully protected."""
from pathlib import Path
import copy, hashlib, json
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
ROOT=Path(__file__).resolve().parent.parent
E=ROOT/'docs/review/2026-10-06/pikachu-character';B=E/'art/completion-states-local-floor'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
key='full-completion-states-local-floor-trip-ledge-source0'
prep_path=B/'full-pilot-preparation.json';prep=json.loads(prep_path.read_text())
assert all(r['key']!=key for r in prep['records']), 'Prepared input immutable'
ledge=next(r for r in prep['records'] if r['key']=='full-completion-states-local-floor-ledge-start5-source5')
assert not any(r['pose_key']==ledge['key'] for r in json.loads((B/'full-generation-ledger.json').read_text())), 'Do not duplicate an existing generation'
request=E/'integration/completion-runtime-trip-qualified/per-cell-floor-correction-request.json'
trip=json.loads(request.read_text());assert {r['cell'] for r in trip['rows']}=={0,1}
frames=json.loads((ROOT/'assets/characters/pikachu/frames.json').read_text())
seed=Image.new('RGB',(2048,2560),'#cc498c');mask=Image.new('L',seed.size)
review=Image.new('RGBA',(2048,640),'#e4e3df');cells=[]
for i in range(3):
    if i<2:
        r=next(r for r in trip['rows'] if r['cell']==i)
        f=frames['animations']['trip'];source=ROOT/'assets/characters/pikachu'/f['strip']
        assert sha(source)==f['sha256']==r['sourceStripSha256']
        w,h=f['frameWidth'],f['frameHeight'];col,row=f['sourceCells'][i]
        original=Image.open(source).convert('RGBA').crop((col*w,row*h,(col+1)*w,(row+1)*h))
        assert f['nativeSampleIndices'][i]==r['nativeSample']
        for x,y,alpha in r['violatingLocalPixelCenters']:assert original.getpixel((x,y))[3]==alpha
        body=Image.new('RGBA',(512,640));body.alpha_composite(original)
        box=(244,403,285,420);first,last,end=407,(419 if i==0 else 418),417
        low=body.crop((box[0],first,box[2],last)).resize((box[2]-box[0],end-first),Image.Resampling.LANCZOS)
        body.paste(Image.new('RGBA',(box[2]-box[0],last-first)),(box[0],first));body.alpha_composite(low,(box[0],first))
        part=Image.new('L',body.size);ImageDraw.Draw(part).rectangle((box[0],box[1],box[2]-1,end-1),fill=255)
        c={'sheet':'trip','artFrameIndex':i,'nativeSample':r['nativeSample'],'root':f['root'],
           'source':str(source.relative_to(ROOT)),'sourceSha256':sha(source),
           'sourceCellRGBAsha256':hashlib.sha256(original.tobytes()).hexdigest(),
           'authorizedRectangle':box,'originalArtBand':[first,last],'targetArtBand':[first,end],
           'preserveReceiving':True,'actualRuntimeRequest':str(request.relative_to(ROOT)),
           'actualRuntimeRequestSha256':sha(request),'actualBundleSha256':trip['bundleSha256'],
           'preserveValidHangingTail':False,'localFloorGate':{'firstForbiddenRow':417,'rectangle':box}}
        matte=Image.new('RGBA',body.size,'#cc498c');matte.alpha_composite(body)
        rgb=matte.convert('RGB').resize((1024,1280),Image.Resampling.NEAREST)
        part=part.resize((1024,1280),Image.Resampling.NEAREST)
    else:
        c=copy.deepcopy(ledge['cells'][0]);ox,oy=c['offset']
        rgb=Image.open(B/(ledge['key']+'-seed.png')).convert('RGB').crop((ox,oy,ox+1024,oy+1280))
        part=Image.open(B/(ledge['key']+'-render-mask.png')).convert('L').crop((ox,oy,ox+1024,oy+1280))
        c['localFloorGate']={'firstForbiddenRow':417,'rectangle':c['authorizedRectangle']}
    offset=[i%2*1024,i//2*1280];c['offset']=offset;cells.append(c)
    seed.paste(rgb,offset);mask.paste(part,offset)
    panel=rgb.resize((512,640),Image.Resampling.NEAREST).convert('RGBA')
    ImageDraw.Draw(panel).text((8,15),c['sheet']+' native'+str(c['nativeSample'])+' tiny underside target',fill='black')
    review.alpha_composite(panel,(i*512,0))
rgb=np.asarray(seed).astype(float);edges=np.zeros(rgb.shape[:2],dtype=bool)
for axis in (0,1):edges|=np.max(np.abs(rgb-np.roll(rgb,1,axis=axis)),axis=2)>35
guide=Image.fromarray((edges*255).astype('uint8')).filter(ImageFilter.MaxFilter(3))
for kind,picture in [('seed',seed),('guide',guide),('render-mask',mask)]:picture.convert('RGB').save(B/(key+'-'+kind+'.png'))
review.save(B/(key+'-input-review.png'))
template=E/'art/tiled-floor-retarget-medium-pilot-bounded-source0-attempt1.workflow.json'
graph=json.loads(template.read_text());uploads={}
for node,kind in [('10','guide'),('13','seed'),('16','render-mask')]:
    remote=f'pf-{key}-{kind}.png';graph[node]['inputs']['image']=remote;uploads[remote]=key+'-'+kind+'.png'
graph['4']['inputs']['text']='Three distinct exact source Pikachu bodies, fourth cell empty magenta. Refine ONLY small masked paw/body underside contours to follow supplied seed precisely. Cells1/2 are genuine source trip poses native0 and23; cell3 is upward ledge native5. Preserve identity, yellow core, ears, face, native motion/root/size, all unmasked pixels. Ledge cell3 hanging tail and other paw below ledge remain EXACT; only tiny right paw changes. No whole body lift, tail fold, extra limb, shadow, text or floor.'
for node,role in [('9','masked-final'),('20','raw')]:graph[node]['inputs']['filename_prefix']=f'pf-{key}-attempt1-{role}'
workflow=key+'-attempt1.workflow.json';(B/workflow).write_text(json.dumps(graph,indent=2)+'\n')
prep['records'].append({'key':key,'state':'prepared_actual_input_review_pending','cells':cells,
 'coordinate_contract':{'canvas':[2048,2560],'root':None,'world_scale':70/300},'source_index':0,'hold_game':None,
 'source_path':str((B/(key+'-seed.png')).relative_to(ROOT)),'source_sha256':sha(B/(key+'-seed.png')),
 'upload_mapping':uploads,'workflow':workflow,'hashes':{k:sha(B/(key+'-'+k+'.png')) for k in ['seed','guide','render-mask']},
 'input_review_sha256':sha(B/(key+'-input-review.png')),'parentGraphSha256':sha(template),
 'limits':['Receiving source capsules remain exact; vulnerability is not a support floor gate.', 'Every pixel outside the three small authorized rectangles remains exact.', 'Actual output inspection and production runtime floors remain pending.']})
ledge['state']='superseded_before_generation'
ledge['supersededBy']=key
ledge['supersededReason']='Combine exact reviewed eleven-pixel paw target with two independently measured trip fringes in one bounded generation; no prior prompt exists.'
prep_path.write_text(json.dumps(prep,indent=2)+'\n')
print(json.dumps({'key':key,'cells':3,'review':str(B/(key+'-input-review.png')),'GPU':False}))
