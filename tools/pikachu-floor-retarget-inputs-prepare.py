"""Prepare four explicit authored floor-clearance body corrections, no GPU work."""
from pathlib import Path
import json,sys
import numpy as np
from PIL import Image,ImageFilter,ImageDraw
from pikachu_native_pose import ROOT,sha
E=ROOT/'docs/review/2026-10-06/pikachu-character';B=E/'art';D=E/'sources/floor-tail-retarget-pilot/folded-ear/canonical-resolution';pilot=json.loads((D/'preparation.json').read_text());source=E/'sources/full-body-native-review/floor-retarget';source.mkdir(exist_ok=True);records=[];panels=[]
family='floor-retarget'
if '--startup-remainder' in sys.argv:
 family='floor-retarget-remainder';D=E/'sources/floor-tail-retarget-pilot/startup-remainder/canonical-resolution';pilot=json.loads((D/'preparation.json').read_text());source=E/'sources/full-body-native-review'/family;source.mkdir(exist_ok=True)
for r in pilot['cases']:
 motion,frame,action=r['motion'],r['nativeSample'],r['action'];stem=D/f'{motion}-{frame}-authored-tail';meta=stem.with_suffix('.json');data=json.loads(meta.read_text());assert data['canvas']==[2048,2560] and data['root']==[1024,1664]
 key=f'full-{family}-{action}-sample{frame}-source{frame}'
 seed=Image.open(str(stem)+'-palette-seed.png').convert('RGB');guide=Image.open(str(stem)+'-guide.png').convert('RGB');anatomy=Image.open(str(stem)+'-mask.png').convert('L');native=Image.open(str(stem)+'-reference.png').convert('RGBA');bounds=anatomy.getbbox();assert bounds and min(bounds[0],bounds[1],2048-bounds[2],2560-bounds[3])>=16
 px=np.asarray(seed);red=(px[:,:,0]>160)&(px[:,:,1]<90)&(px[:,:,2]<65);protected=Image.fromarray(red.astype('uint8')*255).filter(ImageFilter.MaxFilter(9));mask=anatomy.filter(ImageFilter.MaxFilter(21)).filter(ImageFilter.GaussianBlur(2));mask=Image.fromarray(np.where(np.asarray(protected)>0,0,np.asarray(mask)).astype('uint8')).convert('RGB')
 footProtection=None
 if family=='floor-retarget-remainder':
  # Preserve the newly reviewed source pixels including transparent matte near
  # the floor registration. This bounds only generator contour overshoot;
  # anatomy, root and alpha are not cropped or moved after generation.
  footProtection=[600,1648,1500,1720]
  array=np.asarray(mask).copy();array[1648:1720,600:1500]=0;mask=Image.fromarray(array)
 for kind,im in [('seed',seed),('guide',guide),('anatomy-mask',anatomy),('render-mask',mask)]:
  f=B/(key+'-'+kind+'.png')
  if f.exists():
   if Image.open(f).convert(im.mode).tobytes()!=im.tobytes():raise ValueError('Existing input immutable; create numbered attempt')
  else:im.save(f)
 row={'key':key,'action':action,'family':family,'motion':motion,'source_index':frame,'native_sample_index':frame,'gameplay_frame_mapping':'Existing accepted body window unchanged; this is authored local anatomy adaptation only','source_kind':'Explicit authored2D tail/ear retarget, derived from authenticated native pose; not unmodified native body geometry','source_path':str(Path(str(stem)+'-reference.png').relative_to(ROOT)),'source_sha256':sha(Path(str(stem)+'-reference.png')),'native_reference_metadata':str(meta.relative_to(ROOT)),'native_reference_metadata_sha256':sha(meta),'retargetPilotPath':str((D/'preparation.json').relative_to(ROOT)),'retargetPilotSha256':sha(D/'preparation.json'),'retargetCase':r,'root_registration':'remove-trans-translation','protectedFloorSeedRegion':footProtection,'hashes':{k:sha(B/(key+'-'+k+'.png')) for k in ['seed','guide','render-mask']},'state':'prepared; actual retarget source seed control mask inspection required'};records.append(row)
 crop=(bounds[0]-25,bounds[1]-25,bounds[2]+25,bounds[3]+25);panel=Image.new('RGB',(1800,460),'#17253a');bg=Image.new('RGBA',native.size,'#17253a');bg.alpha_composite(native)
 for i,im in enumerate([bg.convert('RGB'),seed,guide,mask]):
  im=im.crop(crop);im.thumbnail((430,400));panel.paste(im,(i*450+(450-im.width)//2,40+(400-im.height)//2))
 ImageDraw.Draw(panel).text((8,8),key+' / authored geometry | seed | actualcontrol | cheek-protected mask; fixedroot/scale/physics',fill='white');panels.append(panel)
gallery=Image.new('RGB',(1800,len(panels)*460),'#17253a')
for i,p in enumerate(panels):gallery.paste(p,(0,i*460))
review=D/'generation-inputs-review.png';gallery.save(review)
obj={'state':'authored_retarged_generation_inputs_pending_actual_review','family':family,'records':records,'coordinate_contract':{'canvas':[2048,2560],'root':[1024,1664],'world_scale':70/600},'input_galleries':{str(review.relative_to(ROOT)):sha(review)},'limits':['Essential scoped correction cells only; accepted126/801 images retained until qualified replacements','Not unmodified native pose; local tail/ear bends explicitly retained with original source matrices/hashes','Source motion/gameplay/attack contact fields and actor trajectories remain unchanged','Actual source/control/input and generated output/paired capsule/production floor review required','Remainder inputs protect original authored source seed pixels near floor-root before generation, including outside-subject matte, instead of cropping generated anatomy afterward']}
(source/'preparation.json').write_text(json.dumps(obj,indent=2)+'\n');print(json.dumps({'source':str((source/'preparation.json').relative_to(ROOT)),'records':len(records),'review':str(review.relative_to(ROOT))}))
