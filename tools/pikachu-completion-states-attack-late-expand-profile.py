"""Apply inspected local correction recipe to seven never-submitted jobs."""
from pathlib import Path
import copy, hashlib, json
import numpy as np
from PIL import Image,ImageDraw
ROOT=Path(__file__).resolve().parent.parent
B=ROOT/'docs/review/2026-10-06/pikachu-character/art/completion-states-attack-late-floor'
p=B/'full-pilot-preparation.json';data=json.loads(p.read_text());ledger=json.loads((B/'full-generation-ledger.json').read_text())
pilot=next(r for r in ledger if r['pose_key']=='full-completion-states-attack-late-floor-batch0-source0' and r['attempt']==2)
assert pilot['state']=='accepted' and pilot.get('actual_visual_review')
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();changed=[]
for r in data['records'][1:]:
 key=r['key'];assert not any(x['pose_key']==key for x in ledger), 'Do not revise submitted graphs'
 assert not r.get('qualifiedLocalRecipe'), 'Prepared revision immutable'
 r['priorPreparation']=copy.deepcopy(r)
 mask=Image.open(B/(key+'-render-mask.png')).convert('RGB');a=np.asarray(mask).copy()
 for c in r['cells']:
  x,y=c['offset'][:2];first=c['adaptation']['originalArtBand'][0]*2;a[y:y+first,x:x+1024]=0
 name=key+'-palette-render-mask.png';Image.fromarray(a).save(B/name)
 graph=json.loads((B/r['workflow']).read_text());originalWorkflow=r['workflow'];graph['7']['inputs']['denoise']=0.35
 graph['4']['inputs']['text']+=' Preserve the exact supplied source underside colors, including any genuine brown stripe or tail visible in the seed. Yellow paws retain yellow fill and clean source black contour. No new red/brown paw shadow, magenta, pink edge, colored floor patch or extra toe. All pixels above the small underside band remain exact source.'
 remote='pf-'+name;graph['16']['inputs']['image']=remote
 for node,role in [('9','masked-final'),('20','raw')]:graph[node]['inputs']['filename_prefix']=f'pf-{key}-attempt1-{role}'
 workflow=key+'-palette-attempt1.workflow.json';(B/workflow).write_text(json.dumps(graph,indent=2)+'\n');r['workflow']=workflow
 r['upload_mapping']={k:v for k,v in r['upload_mapping'].items() if v!=key+'-render-mask.png'};r['upload_mapping'][remote]=name
 r['input_files']={'seed':key+'-seed.png','guide':key+'-guide.png','render-mask':name};r['hashes']['render-mask']=sha(B/name)
 r['qualifiedLocalRecipe']={'pilotJob':pilot['job_key'],'pilotCutoutSha256':pilot['outputs']['cutout']['sha256'],
  'originalWorkflow':originalWorkflow,'originalWorkflowSha256':sha(B/originalWorkflow),
  'changes':['Denoise0.35; source colored underside detail preserved.','Protect every original row above the band.','Recorded nearbackground matte refinement available only after actual output review.'],
  'runtime':'New local art-only profile has saved source/body/caps inspection; whole-action production acceptance remains pending.'}
 r['state']='prepared_actual_input_review_pending'
 seed=Image.open(B/(key+'-seed.png')).convert('RGBA');green=Image.new('RGBA',seed.size,'#21d883');green.putalpha(Image.fromarray(a[:,:,0]).point(lambda z:90 if z else 0));seed.alpha_composite(green)
 review=Image.new('RGBA',(2048,640),'#e4e3df')
 for j,c in enumerate(r['cells']):
  x,y=c['offset'][:2];panel=seed.crop((x,y,x+1024,y+1280)).resize((512,640));ImageDraw.Draw(panel).line((0,c['adaptation']['originalArtBand'][0],512,c['adaptation']['originalArtBand'][0]),fill='red');review.alpha_composite(panel,(j*512,0))
 review.save(B/(key+'-palette-mask-review.png'));changed.append(key)
p.write_text(json.dumps(data,indent=2)+'\n');print(json.dumps({'keys':changed,'GPU':False}))
