"""Bounded source-guided footstool body inputs, no live assets or GPU calls."""
from pathlib import Path
import copy,json,hashlib
import numpy as np
from PIL import Image,ImageDraw,ImageFilter
ROOT=Path(__file__).resolve().parent.parent
B=ROOT/'docs/review/2026-10-06/pikachu-character/art/completion-states-footstool'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
source=B/'source-guide-preparation.json';data=json.loads(source.read_text())
assert data['state']=='native_inputs_actually_visually_reviewed'
prep={'records':[]};template=ROOT/'docs/review/2026-10-06/pikachu-character/art/tiled-floor-retarget-medium-pilot-bounded-source0-attempt1.workflow.json'
for start in [0,4]:
 selected=data['rows'][start:start+4];key=f'full-completion-states-footstool-batch{start//4}-source0'
 assert not (B/(key+'-attempt1.workflow.json')).exists(),'Existing prepared attempt is immutable'
 images={'seed':Image.new('RGB',(2048,2560),'#cc498c'),'guide':Image.new('RGB',(2048,2560),'black'),'render-mask':Image.new('L',(2048,2560),0)};cells=[]
 for i,row in enumerate(selected):
  assert row['state']=='inputs_visually_reviewed'
  for kind,h in row['hashes'].items():assert sha(B/(row['key']+'-'+kind+'.png'))==h
  seed=Image.open(B/(row['key']+'-seed.png')).convert('RGB');anatomy=Image.open(B/(row['key']+'-anatomy-mask.png')).convert('L');guide=Image.open(B/(row['key']+'-generation-guide.png')).convert('RGB');mask=Image.open(B/(row['key']+'-render-mask.png')).convert('L');adaptation=None;hurtboxes=copy.deepcopy(row['hurtboxes'])
  if row['sheet']=='footstool_pose':
   first=1628;last=anatomy.getbbox()[3];end=1668
   rgba=seed.convert('RGBA');rgba.putalpha(anatomy);low=rgba.crop((0,first,2048,last)).resize((2048,end-first),Image.Resampling.LANCZOS);rgba.paste(Image.new('RGBA',(2048,2560-first)),(0,first));rgba.alpha_composite(low,(0,first));bg=Image.new('RGBA',rgba.size,'#cc498c');bg.alpha_composite(rgba);seed=bg.convert('RGB');anatomy=rgba.getchannel('A')
   rgb=np.asarray(seed).astype(float);edges=np.zeros(rgb.shape[:2],dtype=bool)
   for axis in [0,1]:edges|=np.max(np.abs(rgb-np.roll(rgb,1,axis=axis)),axis=2)>35
   guide=Image.fromarray((edges*255).astype('uint8')).filter(ImageFilter.MaxFilter(3)).convert('RGB');mask=anatomy.filter(ImageFilter.MaxFilter(21)).filter(ImageFilter.GaussianBlur(2))
   for box in hurtboxes:
    c=box['capsule']
    for endpoint in ['start','end']:
     point=c[endpoint];y=1664+(point['y']-25)/(70/600)
     if y>=first:point['y']=25+(first+(y-first)*(end-first)/(last-first)-1664)*(70/600)
    a,b=c['start'],c['end'];r=c['radius'];box.update(offsetX=(a['x']+b['x'])/2,offsetY=(a['y']+b['y'])/2,width=abs(a['x']-b['x'])+2*r,height=abs(a['y']-b['y'])+2*r)
   adaptation={'kind':'bounded ground underside flex','originalArtBand':[first,last],'targetArtBand':[first,end],'root':[1024,1664],'radiusChanges':0,'betaAnatomy':True}
  offset=[i%2*1024,i//2*1280];small=seed.resize((1024,1280),Image.Resampling.LANCZOS);smallMask=mask.resize((1024,1280),Image.Resampling.NEAREST);interior=anatomy.filter(ImageFilter.MinFilter(21)).resize((1024,1280),Image.Resampling.NEAREST)
  pixels=np.asarray(small);features=((pixels[:,:,0]>110)&(pixels[:,:,1]<125)&(pixels[:,:,2]<80))|(np.max(pixels,axis=2)<70);identity=Image.fromarray(features.astype('uint8')*255).filter(ImageFilter.MaxFilter(3));protect=(np.asarray(interior)>0)|(np.asarray(identity)>0);smallMask=Image.fromarray(np.where(protect,0,np.asarray(smallMask)).astype('uint8'))
  if adaptation:
   a=np.asarray(smallMask).copy();a[834:]=0;smallMask=Image.fromarray(a)
  images['seed'].paste(small,tuple(offset));images['guide'].paste(guide.resize((1024,1280),Image.Resampling.NEAREST),tuple(offset));images['render-mask'].paste(smallMask,tuple(offset));cells.append({**row,'offset':offset,'sourceHurtboxes':row['hurtboxes'],'hurtboxes':hurtboxes,'authoredGeometryAdaptation':adaptation})
 for kind,im in images.items():im.convert('RGB').save(B/(key+'-'+kind+'.png'))
 graph=json.loads(template.read_text());uploads={}
 for node,kind,role in [('10','guide','guide'),('13','seed','seed'),('16','render-mask','mask')]:
  remote=f'pf-{key}-{role}.png';graph[node]['inputs']['image']=remote;uploads[remote]=key+'-'+kind+'.png'
 graph['4']['inputs']['text']='Precise separate 1024x1280 Pikachu source body cells on magenta. Refine only masked thin anatomy contours, follow colored seed and guide exactly. Keep native compressed footstool ground reaction and separate sideways airborne step reaction distinct. Preserve short mouse paws, original closed eyes/mouth, red cheek, attached zigzag tail, occluded back markings and black ear tips. Never add face on back, limb, opponent, lightning, shadow, labels or dividing lines. All unmasked identity pixels and source root are protected. Poses: '+', '.join(f'cell{i+1} {r["sheet"]} native{r["nativeSample"]}' for i,r in enumerate(selected))+'. Unused cells remain empty magenta.'
 for node,kind in [('9','masked-final'),('20','raw')]:graph[node]['inputs']['filename_prefix']=f'pf-{key}-attempt1-{kind}'
 workflow=key+'-attempt1.workflow.json';(B/workflow).write_text(json.dumps(graph,indent=2)+'\n')
 gallery=Image.new('RGB',(1800,640),'#17253a')
 for j,kind in enumerate(['seed','guide','render-mask']):
  im=images[kind].convert('RGB').resize((480,600),Image.Resampling.NEAREST);gallery.paste(im,(j*600,30));ImageDraw.Draw(gallery).text((j*600+8,8),key+' '+kind,fill='white')
 gallery.save(B/(key+'-input-review.png'));prep['records'].append({'key':key,'state':'prepared_actual_input_review_pending','cells':cells,'coordinate_contract':{'canvas':[2048,2560],'root':None,'cellRoot':[512,832],'world_scale':70/300},'source_index':0,'hold_game':None,'source_path':str((B/(key+'-seed.png')).relative_to(ROOT)),'source_sha256':sha(B/(key+'-seed.png')),'upload_mapping':uploads,'workflow':workflow,'hashes':{kind:sha(B/(key+'-'+kind+'.png')) for kind in images},'input_review_sha256':sha(B/(key+'-input-review.png')),'sourcePreparationSha256':sha(source),'parentGraphSha256':sha(template)})
(B/'full-pilot-preparation.json').write_text(json.dumps(prep,indent=2)+'\n')
if not (B/'full-generation-ledger.json').exists():(B/'full-generation-ledger.json').write_text('[]\n')
print(json.dumps({'tiles':len(prep['records']),'bodyCells':6,'actualTiledInputReview':'pending'}))
