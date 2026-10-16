"""Drop unused atlas padding for the one pending tech-back cell; no GPU."""
from pathlib import Path
import copy, hashlib, json
from PIL import Image
ROOT=Path(__file__).resolve().parent.parent
B=ROOT/'docs/review/2026-10-06/pikachu-character/art/completion-states-crouch-floor'
originalKey='full-completion-states-crouch-floor-uniform-recovery6-source0'
key='full-completion-states-crouch-floor-uniform-recovery6-singlecell-source0'
p=B/'full-pilot-preparation.json';data=json.loads(p.read_text());original=next(r for r in data['records'] if r['key']==originalKey)
assert len(original['cells'])==1 and original['cells'][0]['offset'][:2]==[0,0]
assert not any(r['key']==key for r in data['records']), 'Prepared crop immutable'
assert not any(r['pose_key'] in [originalKey,key] for r in json.loads((B/'full-generation-ledger.json').read_text())), 'Existing GPU job must be reconciled, never replaced'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
r=copy.deepcopy(original);r.update(key=key,state='prepared_actual_input_review_pending')
r['coordinate_contract']['canvas']=[1024,1280];r['cells'][0]['offset']=[0,0]
graph=json.loads((B/original['workflow']).read_text());uploads={}
for node,kind in [('10','guide'),('13','seed'),('16','render-mask')]:
 source=B/(originalKey+'-'+kind+'.png');im=Image.open(source);cropped=im.crop((0,0,1024,1280));assert cropped.tobytes()==im.crop((0,0,1024,1280)).tobytes()
 name=key+'-'+kind+'.png';cropped.save(B/name);remote='pf-'+name;graph[node]['inputs']['image']=remote;uploads[remote]=name
for node,role in [('9','masked-final'),('20','raw')]:graph[node]['inputs']['filename_prefix']=f'pf-{key}-attempt1-{role}'
graph['4']['inputs']['text']='One exact Pikachu source tech-back recovery drawing. Preserve fixed root, original yellow core, face, cheeks, ears, tail and native action orientation. Refine ONLY the existing tiny paw/body underside mask to follow source seed exactly. No whole-body lift or replacement, no extra limb, shadow, floor, text or other drawing.'
workflow=key+'-attempt1.workflow.json';(B/workflow).write_text(json.dumps(graph,indent=2)+'\n')
reviewPath=B/(key+'-input-review.png');Image.open(B/(originalKey+'-input-review.png')).crop((0,0,512,640)).save(reviewPath)
r.update(workflow=workflow,upload_mapping=uploads,source_path=str((B/(key+'-seed.png')).relative_to(ROOT)),source_sha256=sha(B/(key+'-seed.png')),
 hashes={kind:sha(B/(key+'-'+kind+'.png')) for kind in ['seed','guide','render-mask']},input_review_sha256=sha(reviewPath),
 cropProvenance={'originalPreparedKey':originalKey,'originalWorkflow':original['workflow'],'originalWorkflowSha256':sha(B/original['workflow']),
                 'sourceCellPixelsExact':True,'originalCanvas':original['coordinate_contract']['canvas'],'crop':[0,0,1024,1280],
                 'unchanged':'Occupied cell seed/guide/mask bytes; root, scale, receiving and all source clocks. Only unused75% padding removed. Actual output still needs pilot acceptance.'})
original.update(state='superseded_before_generation',supersededBy=key,supersededReason='One occupied cell; exact byte-preserving crop removes unused atlas padding. No prior generation exists.')
data['records'].append(r);p.write_text(json.dumps(data,indent=2)+'\n')
print(json.dumps({'key':key,'canvas':r['coordinate_contract']['canvas'],'GPU':False,'review':str(reviewPath)}))
