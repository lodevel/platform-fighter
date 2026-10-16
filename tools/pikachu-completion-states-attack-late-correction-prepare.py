"""One bounded correction of inspected masked palette/fringe defects; no GPU."""
from pathlib import Path
import copy, hashlib, json
import numpy as np
from PIL import Image
ROOT=Path(__file__).resolve().parent.parent
B=ROOT/'docs/review/2026-10-06/pikachu-character/art/completion-states-attack-late-floor'
key='full-completion-states-attack-late-floor-batch0-source0'
p=B/'full-pilot-preparation.json';data=json.loads(p.read_text());pose=next(r for r in data['records'] if r['key']==key)
ledger=json.loads((B/'full-generation-ledger.json').read_text())
assert any(r['pose_key']==key and r['attempt']==1 and r['state']=='rejected' for r in ledger)
assert not any(r['pose_key']==key and r['attempt']==2 for r in ledger)
assert '2' not in pose.get('attempts',{}), 'Prepared correction is immutable'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
r=copy.deepcopy({k:v for k,v in pose.items() if k!='attempts'})
mask=Image.open(B/(key+'-render-mask.png')).convert('RGB');a=np.asarray(mask).copy()
for c in pose['cells']:
 x,y=c['offset'][:2];first=c['adaptation']['originalArtBand'][0]*2
 a[y:y+first,x:x+1024]=0
mask=Image.fromarray(a);maskPath=B/(key+'-attempt2-render-mask.png');mask.save(maskPath)
graph=json.loads((B/(key+'-attempt1.workflow.json')).read_text())
graph['7']['inputs']['denoise']=0.35
graph['4']['inputs']['text']+=' Corrective local paw palette: all masked paw/body undersides are yellow with clean black contour only. No magenta, pink, red, brown or colored shadow on any paw or contour. Match source seed colors and geometry exactly. Original unmasked mouth, chin and upper band must remain unchanged.'
remote='pf-'+key+'-attempt2-render-mask.png';graph['16']['inputs']['image']=remote
for node,role in [('9','masked-final'),('20','raw')]:graph[node]['inputs']['filename_prefix']=f'pf-{key}-attempt2-{role}'
workflow=key+'-attempt2.workflow.json';(B/workflow).write_text(json.dumps(graph,indent=2)+'\n')
r.update(state='prepared_actual_input_review_pending',workflow=workflow,input_files={'seed':key+'-seed.png','guide':key+'-guide.png','render-mask':maskPath.name},
 correction={'priorAttempt':1,'reason':'Actual dark-background comparison revealed colored paw/chin fringing and a red-brown toe/shadow.',
             'changes':['Denoise0.65 to0.35 retains source paw palette.', 'Protect every original row above local underside band279.', 'Prompt explicitly excludes colored paw/shadow defects; actual output still requires review.']})
r['upload_mapping']={k:v for k,v in r['upload_mapping'].items() if v!=key+'-render-mask.png'};r['upload_mapping'][remote]=maskPath.name;r['hashes']['render-mask']=sha(maskPath)
review=Image.open(B/(key+'-input-review.png'));reviewPath=B/(key+'-attempt2-input-review.png');review.save(reviewPath);r['input_review_sha256']=sha(reviewPath)
pose.setdefault('attempts',{})['2']=r;p.write_text(json.dumps(data,indent=2)+'\n')
print(json.dumps({'key':key,'attempt':2,'GPU':False,'review':str(reviewPath),'mask':str(maskPath)}))
