"""Prepare the inspected underside recipe for unsent recovery/throw jobs."""
from pathlib import Path
import argparse, copy, hashlib, json
import numpy as np
from PIL import Image, ImageDraw
ROOT=Path(__file__).resolve().parent.parent
parser=argparse.ArgumentParser();parser.add_argument('--family',choices=['crouch-floor','throw-floor'],required=True);parser.add_argument('--keys',nargs='+',required=True);args=parser.parse_args()
B=ROOT/'docs/review/2026-10-06/pikachu-character/art'/('completion-states-'+args.family)
pilotBase=ROOT/'docs/review/2026-10-06/pikachu-character/art/completion-states-attack-late-floor'
pilot=next(r for r in json.loads((pilotBase/'full-generation-ledger.json').read_text()) if r['pose_key']=='full-completion-states-attack-late-floor-batch0-source0' and r['attempt']==2)
assert pilot['state']=='accepted' and pilot.get('actual_visual_review')
p=B/'full-pilot-preparation.json';data=json.loads(p.read_text());ledger=json.loads((B/'full-generation-ledger.json').read_text());sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
assert len(args.keys)==len(set(args.keys)) and set(args.keys)<={r['key'] for r in data['records']}
for r in data['records']:
 if r['key'] not in args.keys:continue
 key=r['key'];assert not any(x['pose_key']==key for x in ledger), 'Do not revise submitted jobs'
 assert r['state']=='inputs_visually_reviewed' and not r.get('qualifiedLocalRecipe'), 'Only a fresh inspected preparation may be revised'
 r['priorPreparation']=copy.deepcopy(r);maskFile=r.get('input_files',{}).get('render-mask',key+'-render-mask.png');mask=Image.open(B/maskFile).convert('RGB');a=np.asarray(mask).copy()
 for c in r['cells']:
  x,y=c['offset'][:2];a[y:y+c['adaptation']['originalArtBand'][0]*2,x:x+1024]=0
 name=key+'-palette-render-mask.png';Image.fromarray(a).save(B/name);graph=json.loads((B/r['workflow']).read_text());originalWorkflow=r['workflow'];graph['7']['inputs']['denoise']=0.35
 graph['4']['inputs']['text']+=' Preserve exact source underside colors, including any genuine brown stripe or tail already present in the seed. Yellow paws retain yellow fill and clean source black contour. No new red/brown paw shadow, magenta, pink contour, colored floor patch or extra toe. All source pixels above the small underside band remain exact.'
 remote='pf-'+name;graph['16']['inputs']['image']=remote
 for node,role in [('9','masked-final'),('20','raw')]:graph[node]['inputs']['filename_prefix']=f'pf-{key}-attempt1-{role}'
 workflow=key+'-palette-attempt1.workflow.json';(B/workflow).write_text(json.dumps(graph,indent=2)+'\n');r['workflow']=workflow
 r['upload_mapping']={k:v for k,v in r['upload_mapping'].items() if v!=maskFile};r['upload_mapping'][remote]=name
 seedFile=r.get('input_files',{}).get('seed',key+'-seed.png');guideFile=r.get('input_files',{}).get('guide',key+'-guide.png')
 r['input_files']={'seed':seedFile,'guide':guideFile,'render-mask':name};r['hashes']['render-mask']=sha(B/name)
 r['qualifiedLocalRecipe']={'pilotJob':pilot['job_key'],'pilotCutoutSha256':pilot['outputs']['cutout']['sha256'],
  'originalWorkflow':originalWorkflow,'originalWorkflowSha256':sha(B/originalWorkflow),
  'changes':['Denoise0.35 preserves source paw color.','Protect every source row above local underside band407.','Nearbackground matte refinement remains actual-output-review gated.'],
  'runtime':'Local saved body/caps generator pilot inspected; new recovery/throw cells still require actual output, paired receiving and production acceptance.'}
 r['state']='prepared_actual_input_review_pending';seed=Image.open(B/seedFile).convert('RGBA');green=Image.new('RGBA',seed.size,'#21d883');green.putalpha(Image.fromarray(a[:,:,0]).point(lambda z:90 if z else 0));seed.alpha_composite(green)
 review=Image.new('RGBA',(512*len(r['cells']),640),'#e4e3df')
 for j,c in enumerate(r['cells']):
  x,y=c['offset'][:2];panel=seed.crop((x,y,x+1024,y+1280)).resize((512,640));ImageDraw.Draw(panel).line((0,c['adaptation']['originalArtBand'][0],512,c['adaptation']['originalArtBand'][0]),fill='red');review.alpha_composite(panel,(j*512,0))
 review.save(B/(key+'-palette-mask-review.png'))
p.write_text(json.dumps(data,indent=2)+'\n');print(json.dumps({'family':args.family,'keys':args.keys,'GPU':False}))
