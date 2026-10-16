"""Reuse inspected native item guides for genuine new body-art inputs only."""
from pathlib import Path
import sys,json,hashlib
import numpy as np
from PIL import Image,ImageFilter
ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT/'tools'))
from pikachu_native_pose import PikachuNativePose,MOTIONS
E=ROOT/'docs/review/2026-10-06/pikachu-character';S=E/'sources/item-native-review';B=E/'art/completion-states-items';B.mkdir(exist_ok=True)
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
source=S/'preparation.json';data=json.loads(source.read_text());assert data['state']=='native_item_cues_actually_reviewed_runtime_binding_pending'
caps=json.loads((E/'sources/native-hurtbox-capsules.json').read_text())['capsules'];rows=[];poses={}
for row in data['rows']:
 if row['sourceAction']=='wait_item':continue
 sheet={'item_light_get':'item_pickup_stand','item_light_walk_get':'item_pickup_walk'}.get(row['sourceAction'],row['sourceAction'].replace('item_light_throw_','item_throw_'));sample=row['nativeSample'];key=f'full-completion-states-{sheet.replace("_","-")}-sample{sample}-source{sample}';meta=ROOT/row['nativeGuideMetadata'];assert sha(meta)==row['nativeGuideMetadataSha256'];record=json.loads(meta.read_text())
 for f,h in record['output_files'].items():assert sha(S/f)==h
 seed=Image.open(S/(row['key']+'-palette-seed.png')).convert('RGB');guide=Image.open(S/(row['key']+'-guide.png')).convert('RGB');anatomy=Image.open(S/(row['key']+'-mask.png')).convert('L');px=np.asarray(seed);red=(px[:,:,0]>160)&(px[:,:,1]<90)&(px[:,:,2]<65);protected=Image.fromarray(red.astype('uint8')*255).filter(ImageFilter.MaxFilter(9));mask=anatomy.filter(ImageFilter.MaxFilter(21)).filter(ImageFilter.GaussianBlur(2));mask=Image.fromarray(np.where(np.asarray(protected)>0,0,np.asarray(mask)).astype('uint8'));assert seed.size==(2048,2560)
 for kind,im in [('seed',seed),('generation-guide',guide),('anatomy-mask',anatomy),('render-mask',mask)]:im.save(B/(key+'-'+kind+'.png'))
 motion=Path(row['motionDeclaration']['animations'][0]['name']).stem
 if motion not in poses:poses[motion]=PikachuNativePose(MOTIONS/(motion+'.nuanmb'))
 pose=poses[motion];matrices=pose.matrices(sample,list(dict.fromkeys(['Trans']+[c['bone']['label'] for c in caps])));trans=matrices['Trans'][:3,3];boxes=[]
 for c in caps:
  m=matrices[c['bone']['label']];points=[]
  for endpoint in ['endpoint1','endpoint2']:
   p=(m@np.array([*c[endpoint],1]))[:3]-trans;points.append({'x':float(p[2])*5,'y':25-float(p[1])*5})
  a,b=points;r=float(c['size'])*float(np.linalg.norm(m[:3,:3],axis=0).max())*5;boxes.append({'id':f'pikachu.{sheet}.{c["index"]}.{c["bone"]["label"]}','offsetX':(a['x']+b['x'])/2,'offsetY':(a['y']+b['y'])/2,'width':abs(a['x']-b['x'])+2*r,'height':abs(a['y']-b['y'])+2*r,'capsule':{'start':a,'end':b,'radius':r}})
 rows.append({'key':key,'sheet':sheet,'motion':motion,'nativeSample':sample,'sourceOnlyEndpoint':False,'source_path':str((S/(row['key']+'-reference.png')).relative_to(ROOT)),'source_sha256':sha(S/(row['key']+'-reference.png')),'nativeMetadata':row['nativeGuideMetadata'],'nativeMetadataSha256':sha(meta),'sourceMotion':pose.provenance(),'capturedTransTranslation':record['captured_trans_translation'],'hurtboxes':boxes,'sourceHaveBODYCENTRE':row['joints']['Have']['projectedBodyOffset'],'sourceDeclaration':row['motionDeclaration'],'hashes':{kind:sha(B/(key+'-'+kind+'.png')) for kind in ['seed','generation-guide','anatomy-mask','render-mask']},'state':'reused_source_guide_inputs_pending_actual_tile_review'})
(B/'source-guide-preparation.json').write_text(json.dumps({'state':'reused_inspected_native_guides_actual_tile_inputs_pending','sourcePreparationSha256':sha(source),'rows':rows,'carryChoice':'Five accepted idle source drawings may be independently matched to WaitItem plus its genuine12caps/Have only after all five floor corrections. No asset alias or unspecified fallback.','limits':['Existing source guides reused hash-exact; no native reference rerender.','Thirteen genuine new pickup/release drawings require bounded generation and actual paired12caps review.','Immediate pickup/throw beta cues add no gameplay commitment or common native status claim.','Only grounded source poses need underside contact adaptation; aerial-up tumble extension is airborne and stays intact.']},indent=2)+'\n')
print(json.dumps({'reusedNativeGuideBodies':len(rows),'sourceCapsules':len(rows)*12,'carryNewGeneration':False}))
