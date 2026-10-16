"""Repair only rejected walk-pickup fringe; retain three accepted cells exact."""
from pathlib import Path
import copy,json,hashlib
import numpy as np
from PIL import Image,ImageDraw,ImageFilter
ROOT=Path(__file__).resolve().parent.parent
B=ROOT/'docs/review/2026-10-06/pikachu-character/art/completion-states-items'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
key='full-completion-states-items-batch0-source0';prepPath=B/'full-pilot-preparation.json';prep=json.loads(prepPath.read_text());pose=next(r for r in prep['records'] if r['key']==key)
assert '2' not in pose.get('attempts',{}),'Correction input immutable'
out=next(r for r in json.loads((B/'full-generation-ledger.json').read_text()) if r['pose_key']==key and r['attempt']==1)
assert out['state']=='rejected' and out['actual_visual_review']['acceptedCellIndices']==[0,1,2]
priorFinal=B/out['outputs']['9']['file'];assert sha(priorFinal)==out['outputs']['9']['sha256']
priorCutout=B/out['outputs']['cutout']['file'];assert sha(priorCutout)==out['outputs']['cutout']['sha256']
seed=Image.open(priorFinal).convert('RGB');cutout=Image.open(priorCutout).convert('RGBA');mask=Image.new('L',seed.size)
c=copy.deepcopy(pose['cells'][3]);assert c['sheet']=='item_pickup_walk' and c['nativeSample']==2
x,y=c['offset'];body=cutout.crop((x,y,x+1024,y+1280)).resize((512,640),Image.Resampling.LANCZOS);original=body.copy()
bounds=body.getchannel('A').point(lambda a:255 if a>=32 else 0).getbbox();assert bounds[3]==418
first,last,end=407,418,417
low=body.crop((0,first,512,last)).resize((512,end-first),Image.Resampling.LANCZOS);body.paste(Image.new('RGBA',(512,640-first)),(0,first));body.alpha_composite(low,(0,first))
bg=Image.new('RGBA',body.size,'#cc498c');bg.alpha_composite(body);small=bg.convert('RGB').resize((1024,1280),Image.Resampling.NEAREST)
# Only replace the small lower band in the prior saved RGB output. Every core
# pixel and all three good complete cells retain the exact previous RGB bytes.
seed.paste(small.crop((0,first*2,1024,1280)),(x,y+first*2))
region=np.asarray(original.getchannel('A'))>0;region[:first-4]=False;part=Image.fromarray(region.astype('uint8')*255).filter(ImageFilter.MaxFilter(7));a=np.asarray(part).copy();a[end:]=0;part=Image.fromarray(a);mask.paste(part.resize((1024,1280),Image.Resampling.NEAREST),(x,y))
rgb=np.asarray(seed).astype(float);edges=np.zeros(rgb.shape[:2],dtype=bool)
for axis in (0,1):edges|=np.max(np.abs(rgb-np.roll(rgb,1,axis=axis)),axis=2)>35
guide=Image.fromarray((edges*255).astype('uint8')).filter(ImageFilter.MaxFilter(3))
for i in range(3):
 ox,oy=pose['cells'][i]['offset'];box=(ox,oy,ox+1024,oy+1280)
 assert seed.crop(box).tobytes()==Image.open(priorFinal).convert('RGB').crop(box).tobytes()
 assert not mask.crop(box).getbbox()
files={}
for kind,im in [('seed',seed),('guide',guide),('render-mask',mask)]:
 name=key+'-attempt2-'+kind+'.png';im.convert('RGB').save(B/name);files[kind]=name
cells=copy.deepcopy(pose['cells']);cells[3]=c
for box in c['hurtboxes']:
 cap=box['capsule']
 for endpoint in ['start','end']:
  p=cap[endpoint];artY=416+(p['y']-25)/(70/150)
  if artY>=first:p['y']=25+(first+(artY-first)*(end-first)/(last-first)-416)*(70/150)
 a,b=cap['start'],cap['end'];r=cap['radius'];box.update(offsetX=(a['x']+b['x'])/2,offsetY=(a['y']+b['y'])/2,width=abs(a['x']-b['x'])+2*r,height=abs(a['y']-b['y'])+2*r)
c['authoredGeometryAdaptation']={'kind':'bounded generated-output underside flex','originalArtBand':[first,last],'targetArtBand':[first,end],'root':[256,416],'radiusChanges':0,'sourceAttempt':out['job_key'],'sourceCutoutSha256':sha(priorCutout),'betaAnatomy':True}
graph=json.loads((B/pose['workflow']).read_text());uploads={}
for node,kind in [('10','guide'),('13','seed'),('16','render-mask')]:
 remote='pf-'+key+'-attempt2-'+kind+'.png';graph[node]['inputs']['image']=remote;uploads[remote]=files[kind]
graph['4']['inputs']['text']='Keep every source Pikachu pose and ALL unmasked pixels exact. First THREE accepted native standing pickup cells are entirely protected and must remain unchanged. ONLY masked final fourth walking pickup native2 paw underside is refined to guide, one pixel above previous floor fringe. Preserve original face/ears/cheek/core/tail and root; no whole body lift, shadow or extra limb. Uniform magenta background, no labels.'
for node,role in [('9','masked-final'),('20','raw')]:graph[node]['inputs']['filename_prefix']='pf-'+key+'-attempt2-'+role
workflow=key+'-attempt2.workflow.json';(B/workflow).write_text(json.dumps(graph,indent=2)+'\n')
review=Image.new('RGBA',(2048,640),'#e4e3df')
for i,cell in enumerate(cells):
 ox,oy=cell['offset'];panel=seed.crop((ox,oy,ox+1024,oy+1280)).resize((512,640),Image.Resampling.NEAREST).convert('RGBA');review.alpha_composite(panel,(i*512,0));ImageDraw.Draw(review).text((i*512+8,15),'protected accepted native'+str(cell['nativeSample']) if i<3 else 'only walk2 underside correction',fill='black')
reviewPath=B/(key+'-attempt2-input-review.png');review.save(reviewPath)
record={k:copy.deepcopy(v) for k,v in pose.items() if k!='attempts'};record.update(state='prepared_actual_input_review_pending',workflow=workflow,upload_mapping=uploads,input_files=files,hashes={k:sha(B/v) for k,v in files.items()},source_path=str((B/files['seed']).relative_to(ROOT)),source_sha256=sha(B/files['seed']),cells=cells,input_review_sha256=sha(reviewPath),inputReviewFile=reviewPath.name,acceptedSourceCellIndicesExact=[0,1,2],sourceRejectedAttempt=out['job_key'])
pose.setdefault('attempts',{})['2']=record;prepPath.write_text(json.dumps(prep,indent=2)+'\n');print(json.dumps({'affectedCells':1,'retainedAcceptedCells':3,'review':str(reviewPath),'noGPU':True}))
