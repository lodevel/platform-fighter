"""Isolated native StepPose/StepAirPose guides; no live source/art promotion."""
from pathlib import Path
import json,hashlib,importlib.util,sys
import numpy as np
from PIL import Image,ImageDraw,ImageFilter
ROOT=Path(__file__).resolve().parent.parent
E=ROOT/'docs/review/2026-10-06/pikachu-character'
B=E/'art/completion-states-footstool'
B.mkdir(exist_ok=True)
sys.path.insert(0,str(ROOT/'tools'))
from pikachu_native_pose import PikachuNativePose,MOTIONS
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
spec=importlib.util.spec_from_file_location('step_guides',ROOT/'tools/pikachu-native-guide.py')
g=importlib.util.module_from_spec(spec);spec.loader.exec_module(g)
g.SIZE=(2048,2560);g.ART_ROOT=(1024,1664);g.VIEW_SIDE='negative';g.ROOT_REGISTRATION='remove-trans-translation'
caps=json.loads((E/'sources/native-hurtbox-capsules.json').read_text())['capsules']
rows=[]
for sheet,motion in [('footstool_pose','a06steppose'),('footstool_air_pose','a06stepairpose')]:
 pose=PikachuNativePose(MOTIONS/(motion+'.nuanmb'))
 assert int(pose.animation.final_frame_index)==8
 gallery=Image.new('RGB',(1800,1350),'#17253a')
 for i,sample in enumerate([0,4,8]):
  key=f'full-completion-states-{sheet.replace("_","-")}-sample{sample}-source{sample}'
  prefix=B/key;meta=prefix.with_suffix('.json')
  if not meta.exists():g.render(motion,sample,prefix)
  data=json.loads(meta.read_text());assert data['canvas']==list(g.SIZE) and data['root']==list(g.ART_ROOT)
  for f,h in data['output_files'].items():assert sha(B/f)==h
  seed=Image.open(str(prefix)+'-palette-seed.png').convert('RGB');guide=Image.open(str(prefix)+'-guide.png').convert('RGB');anatomy=Image.open(str(prefix)+'-mask.png').convert('L');native=Image.open(str(prefix)+'-reference.png').convert('RGBA');bounds=anatomy.getbbox()
  assert bounds and min(bounds[0],bounds[1],2048-bounds[2],2560-bounds[3])>=16
  px=np.asarray(seed);red=(px[:,:,0]>160)&(px[:,:,1]<90)&(px[:,:,2]<65)
  protected=Image.fromarray(red.astype('uint8')*255).filter(ImageFilter.MaxFilter(9))
  mask=anatomy.filter(ImageFilter.MaxFilter(21)).filter(ImageFilter.GaussianBlur(2));mask=Image.fromarray(np.where(np.asarray(protected)>0,0,np.asarray(mask)).astype('uint8'))
  for kind,im in [('seed',seed),('generation-guide',guide),('anatomy-mask',anatomy),('render-mask',mask)]:im.save(B/f'{key}-{kind}.png')
  matrices=pose.matrices(sample,list(dict.fromkeys(['Trans']+[c['bone']['label'] for c in caps])));trans=(matrices['Trans']@np.array([0,0,0,1]))[:3];hurtboxes=[]
  for c in caps:
   matrix=matrices[c['bone']['label']];points=[]
   for endpoint in ['endpoint1','endpoint2']:
    p=(matrix@np.array([*c[endpoint],1]))[:3]-trans;points.append({'x':float(p[2])*5,'y':25-float(p[1])*5})
   radius=float(c['size'])*float(np.linalg.norm(matrix[:3,:3],axis=0).max())*5
   a,b=points;hurtboxes.append({'id':f'pikachu.{sheet}.{c["index"]}.{c["bone"]["label"]}','offsetX':(a['x']+b['x'])/2,'offsetY':(a['y']+b['y'])/2,'width':abs(a['x']-b['x'])+2*radius,'height':abs(a['y']-b['y'])+2*radius,'capsule':{'start':a,'end':b,'radius':radius}})
  assert len(hurtboxes)==12
  crop=(bounds[0]-25,bounds[1]-25,bounds[2]+25,bounds[3]+25);bg=Image.new('RGBA',native.size,'#17253a');bg.alpha_composite(native)
  for j,im in enumerate([bg.convert('RGB'),seed,mask.convert('RGB')]):
   im=im.crop(crop);im.thumbnail((580,395));gallery.paste(im,(j*600+(600-im.width)//2,i*450+35+(395-im.height)//2));ImageDraw.Draw(gallery).text((j*600+8,i*450+8),f'{sheet} native{sample} / '+['native','seed','mask'][j],fill='white')
  rows.append({'key':key,'sheet':sheet,'motion':motion,'nativeSample':sample,'sourceOnlyEndpoint':sheet=='footstool_air_pose' and sample==8,'source_path':str(Path(str(prefix)+'-reference.png').relative_to(ROOT)),'source_sha256':sha(Path(str(prefix)+'-reference.png')),'nativeMetadata':str(meta.relative_to(ROOT)),'nativeMetadataSha256':sha(meta),'sourceMotion':pose.provenance(),'capturedTransTranslation':data['captured_trans_translation'],'hurtboxes':hurtboxes,'hashes':{kind:sha(B/f'{key}-{kind}.png') for kind in ['seed','generation-guide','render-mask','anatomy-mask']},'state':'prepared_actual_input_review_pending'})
 gallery.save(B/(sheet+'-native-input-review.png'))
(B/'source-guide-preparation.json').write_text(json.dumps({'state':'prepared_actual_native_input_review_pending','coordinateContract':{'canvas':[2048,2560],'root':[1024,1664],'registration':'remove-trans-translation','bodyCentreReceiving':True},'rows':rows,'limits':['New genuine source body poses; no generic sprite aliases.','CPU source guides are not accepted distributed art; bounded generation and paired output inspection required.','StepPose ground source0..8 uses authored9-frame cue; StepAirPose native0..7 uses source cancel8; endpoint8 source-only.','Runtime conditions, victim commitment and jumper cue remain physical engine owners.']},indent=2)+'\n')
print(json.dumps({'sourceBodies':len(rows),'receivingCapsules':len(rows)*12,'output':str(B)}))
