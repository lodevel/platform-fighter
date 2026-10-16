"""Tiny actual contact defect only; valid hanging tail stays exact."""
from pathlib import Path
import json,hashlib
import numpy as np
from PIL import Image,ImageDraw,ImageFilter
ROOT=Path(__file__).resolve().parent.parent
E=ROOT/'docs/review/2026-10-06/pikachu-character';B=E/'art/completion-states-local-floor';B.mkdir(exist_ok=True)
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
key='full-completion-states-local-floor-ledge-start5-source5'
prep=B/'full-pilot-preparation.json'
assert not prep.exists() or all(r['key']!=key for r in json.loads(prep.read_text())['records']),'Prepared input immutable'
request=E/'integration/completion-runtime-ledge-jump-contact-qualified/per-cell-floor-correction-request.json';evidence=json.loads(request.read_text());rows=evidence['rows'];assert len(rows)==2 and {r['facing'] for r in rows}=={-1,1}
assert all(r['cell']==1 and r['nativeSample']==5 and r['sourceAge']==10 for r in rows)
f=json.loads((ROOT/'assets/characters/pikachu/frames.json').read_text())['animations']['ledge_jump_start'];source=ROOT/'assets/characters/pikachu'/f['strip']
assert sha(source)==f['sha256']==rows[0]['sourceStripSha256'];assert rows[0]['violatingLocalPixelCenters']==rows[1]['violatingLocalPixelCenters']
image=Image.open(source).convert('RGBA');w,h=f['frameWidth'],f['frameHeight'];col,row=f['sourceCells'][1];original=image.crop((col*w,row*h,(col+1)*w,(row+1)*h));body=Image.new('RGBA',(512,640));body.alpha_composite(original)
for x,y,alpha in rows[0]['violatingLocalPixelCenters']:assert body.getpixel((x,y))[3]==alpha
# Only this paw contour bends up two drawing pixels. The hanging tail and every
# other pixel remain exact even though their global bbox goes below the root.
box=(266,409,278,420);first,last,destination=410,419,417
low=body.crop((box[0],first,box[2],last)).resize((box[2]-box[0],destination-first),Image.Resampling.LANCZOS)
body.paste(Image.new('RGBA',(box[2]-box[0],last-first)),(box[0],first));body.alpha_composite(low,(box[0],first))
mask=Image.new('L',body.size);ImageDraw.Draw(mask).rectangle((box[0],box[1],box[2]-1,destination-1),fill=255)
seed=Image.new('RGB',(2048,2560),'#cc498c');bg=Image.new('RGBA',body.size,'#cc498c');bg.alpha_composite(body);seed.paste(bg.convert('RGB').resize((1024,1280),Image.Resampling.NEAREST),(0,0));renderMask=Image.new('L',seed.size);renderMask.paste(mask.resize((1024,1280),Image.Resampling.NEAREST),(0,0))
rgb=np.asarray(seed).astype(float);edges=np.zeros(rgb.shape[:2],dtype=bool)
for axis in (0,1):edges|=np.max(np.abs(rgb-np.roll(rgb,1,axis=axis)),axis=2)>35
guide=Image.fromarray((edges*255).astype('uint8')).filter(ImageFilter.MaxFilter(3))
for kind,im in [('seed',seed),('guide',guide),('render-mask',renderMask)]:im.convert('RGB').save(B/(key+'-'+kind+'.png'))
review=Image.new('RGBA',(1024,640),'#e4e3df')
for i,im in enumerate([original,body]):
 panel=Image.new('RGBA',(512,640),'#e4e3df');panel.alpha_composite(im);draw=ImageDraw.Draw(panel);draw.line((0,416,512,416),fill='red');draw.rectangle(box,outline='blue');review.alpha_composite(panel,(i*512,0));ImageDraw.Draw(review).text((i*512+8,15),['original actual-supported defect','bounded paw target'][i],fill='black')
review.save(B/(key+'-input-review.png'))
template=E/'art/tiled-floor-retarget-medium-pilot-bounded-source0-attempt1.workflow.json';graph=json.loads(template.read_text());uploads={}
for node,kind in [('10','guide'),('13','seed'),('16','render-mask')]:
 remote=f'pf-{key}-{kind}.png';graph[node]['inputs']['image']=remote;uploads[remote]=key+'-'+kind+'.png'
graph['4']['inputs']['text']='Exact original Pikachu source body on magenta. Refine ONLY masked tiny right paw underside to supplied guide. Native upward ledge-start pose, source tail hanging below ledge, face/ears/cheek/upper body/other paw must remain unchanged. No entire body lift or tail fold. Preserve rough yellow style and joined paw contour. Unmasked pixels protected; other cells empty magenta.'
for node,kind in [('9','masked-final'),('20','raw')]:graph[node]['inputs']['filename_prefix']=f'pf-{key}-attempt1-{kind}'
workflow=key+'-attempt1.workflow.json';(B/workflow).write_text(json.dumps(graph,indent=2)+'\n')
cell={'sheet':'ledge_jump_start','artFrameIndex':1,'nativeSample':5,'root':f['root'],'offset':[0,0],'source':str(source.relative_to(ROOT)),'sourceSha256':sha(source),'sourceCellRGBAsha256':hashlib.sha256(original.tobytes()).hexdigest(),'authorizedRectangle':box,'originalArtBand':[first,last],'targetArtBand':[first,destination],'preserveReceiving':True,'actualRuntimeRequest':str(request.relative_to(ROOT)),'actualRuntimeRequestSha256':sha(request),'actualBundleSha256':evidence['bundleSha256'],'preserveValidHangingTail':True}
record={'key':key,'state':'prepared_actual_input_review_pending','cells':[cell],'coordinate_contract':{'canvas':[2048,2560],'root':None,'world_scale':70/300},'source_index':5,'hold_game':None,'source_path':str((B/(key+'-seed.png')).relative_to(ROOT)),'source_sha256':sha(B/(key+'-seed.png')),'upload_mapping':uploads,'workflow':workflow,'hashes':{k:sha(B/(key+'-'+k+'.png')) for k in ['seed','guide','render-mask']},'input_review_sha256':sha(B/(key+'-input-review.png')),'parentGraphSha256':sha(template)}
data=json.loads(prep.read_text()) if prep.exists() else {'records':[]};data['records'].append(record);prep.write_text(json.dumps(data,indent=2)+'\n')
if not (B/'full-generation-ledger.json').exists():(B/'full-generation-ledger.json').write_text('[]\n')
print(json.dumps({'key':key,'targetedActualPixels':len(rows[0]['violatingLocalPixelCenters']),'authorizedRectangle':box,'receivingChanged':False,'review':str(B/(key+'-input-review.png'))}))
