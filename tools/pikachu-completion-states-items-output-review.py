"""Prepare saved actual output galleries and mechanical checks; no acceptance."""
from pathlib import Path
import json,sys,hashlib
import numpy as np
from PIL import Image,ImageDraw
ROOT=Path(__file__).resolve().parent.parent;B=ROOT/'docs/review/2026-10-06/pikachu-character/art/completion-states-items';key=sys.argv[1]
pose=next(r for r in json.loads((B/'full-pilot-preparation.json').read_text())['records'] if r['key']==key);r=next(r for r in reversed(json.loads((B/'full-generation-ledger.json').read_text())) if r['pose_key']==key and r['state'] in ('succeeded','accepted'));p=pose.get('attempts',{}).get(str(r['attempt']),pose)
assert r['state'] in ('succeeded','accepted');sha=lambda x:hashlib.sha256(x.read_bytes()).hexdigest();atlas=B/r['outputs']['cutout']['file'];assert sha(atlas)==r['outputs']['cutout']['sha256'];cutout=Image.open(atlas).convert('RGBA');final=Image.open(B/r['outputs']['9']['file']).convert('RGB');seed=Image.open(B/p.get('input_files',{}).get('seed',key+'-seed.png')).convert('RGB');mask=Image.open(B/p.get('input_files',{}).get('render-mask',key+'-render-mask.png')).convert('RGB');a=np.asarray(mask)[:,:,0];outside=a==0;changes=int(np.count_nonzero(np.any(np.asarray(seed)[outside]!=np.asarray(final)[outside],axis=1)));assert changes==0
checks={'key':key,'unmaskedChanges':changes,'cells':[]};gallery=Image.new('RGBA',(512*len(p['cells']),640),'#e4e3df')
for j,c in enumerate(p['cells']):
 x,y=c['offset'];im=cutout.crop((x,y,x+1024,y+1280)).resize((512,640),Image.Resampling.LANCZOS);im.save(B/(r['job_key']+f'-cell{j}.png'));bounds=im.getchannel('A').point(lambda a:255 if a>=32 else 0).getbbox();checks['cells'].append({'sheet':c['sheet'],'nativeSample':c['nativeSample'],'bounds':bounds,'floorWorldPx':(bounds[3]-.5-c.get('root',[256,416])[1])*70/150,'floorPass':'_air_' in c['sheet'] or bounds[3]-1<=416});panel=Image.new('RGBA',im.size,'#e4e3df');panel.alpha_composite(im);ImageDraw.Draw(panel).line((0,c.get('root',[256,416])[1],512,c.get('root',[256,416])[1]),fill='red');ImageDraw.Draw(panel).text((8,15),c['sheet']+' native'+str(c['nativeSample']),fill='black');gallery.alpha_composite(panel,(j*512,0))
checks['allGroundFloorsPass']=all(c['floorPass'] for c in checks['cells']);gallery.save(B/(r['job_key']+'-actual-output-review.png'));(B/(r['job_key']+'-mechanical-checks.json')).write_text(json.dumps(checks,indent=2)+'\n');print(json.dumps(checks))
