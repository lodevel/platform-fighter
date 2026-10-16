"""Prepare pose-window capsules for explicit review; never auto-approve them."""
from pathlib import Path
import hashlib,json,math,sys
from PIL import Image,ImageDraw
ROOT=Path(__file__).resolve().parent.parent
E=ROOT/'docs/review/2026-10-06/pikachu-character';B=E/'art'
mode=sys.argv[1:]
profiles={('--smashes',):(['forward-smash','up-smash','down-smash'],'smashes/hurtbox-preparation'),('--dash-attack',):(['dash-attack'],'dash-attack/hurtbox-preparation'),('--jab',):(['jab'],'jab/hurtbox-preparation'),('--up-air',):(['up-air'],'up-air/hurtbox-preparation'),('--down-air',):(['down-air','down-air-landing'],'down-air/hurtbox-preparation'),('--neutral-air',):(['neutral-air'],'neutral-air/hurtbox-preparation'),('--back-air',):(['back-air','back-air-landing'],'back-air/hurtbox-preparation'),(): (['up-tilt','down-tilt'],'vertical-tilts/hurtbox-preparation')}
if tuple(mode) not in profiles:raise ValueError('Unknown prepared normal action')
actions,folder=profiles[tuple(mode)];OUT=E/folder;OUT.mkdir(parents=True,exist_ok=True)
prep=json.loads((B/'normal-pilot-preparation.json').read_text());rows=[];sources={}
for name in actions:
 p=E/f'sources/posed-resources/{name}-reference-samples.json';sources[name]={'path':str(p.relative_to(E)),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()};samples=json.loads(p.read_text())['frames']
 for r in prep['records']:
  if r['action']!=name:continue
  sample=samples[r['source_index']];matrices={k.lower():v for k,v in sample['matrices'].items()};trans=[0,0,0] if r.get('root_registration','captured')=='captured' else [matrices['trans'][i][3] for i in range(3)];boxes=[]
  for h in sample['hurtbox_reference_endpoints']:
   m=matrices[h['bone']];radius=h['native_size']*max(math.sqrt(sum(m[i][j]**2 for i in range(3))) for j in range(3))*5
   pts=[{'x':(v[2]-trans[2])*5,'y':25-(v[1]-trans[1])*5} for v in h['endpoints']];a,z=pts;minx=min(a['x'],z['x'])-radius;maxx=max(a['x'],z['x'])+radius;miny=min(a['y'],z['y'])-radius;maxy=max(a['y'],z['y'])+radius
   boxes.append({'id':f"pikachu.{name}.{h['index']}.{h['bone']}",'offsetX':(minx+maxx)/2,'offsetY':(miny+maxy)/2,'width':maxx-minx,'height':maxy-miny,'capsule':{'start':a,'end':z,'radius':radius}})
  file=r['key']+f"-attempt{r.get('chosen_art_attempt',1)}-cutout.png";rows.append({'action':name,'pose':r['pose'],'sourceIndex':r['source_index'],'startElapsed':r['start_elapsed'],'endElapsed':r['end_elapsed'],'file':file,'rootRegistration':r.get('root_registration','captured'),'hurtboxes':boxes})
  # Use generated art when available, otherwise clearly identified guide seed.
  final=B/file;im=Image.open(final if final.exists() else B/(r['key']+'-seed.png')).convert('RGBA');bg=Image.new('RGBA',im.size,'#17253a');bg.alpha_composite(im);layer=Image.new('RGBA',im.size);d=ImageDraw.Draw(layer)
  for h in boxes:
   c=h['capsule'];rad=c['radius']/(70/600);pts=[(1024+p['x']/(70/600),1152+(p['y']-25)/(70/600)) for p in [c['start'],c['end']]];d.line(pts,fill='#b5a6ff',width=3)
   for x,y in pts:d.ellipse((x-rad,y-rad,x+rad,y+rad),outline='#b5a6ff',width=3)
  bg.alpha_composite(layer);bg.save(OUT/(r['key']+'-candidate.png'))
record={'state':'review_required_not_runtime_data','sources':sources,'policy':'Authored2Dorthographic projection and maximum-world-column radius calibration; sparse drawing holds; down-tilt removes captured Trans translation to match chosen target root. Native scale/radius/root-motion/patch/status semantics unqualified.','rows':rows}
(OUT/'candidates.json').write_text(json.dumps(record,indent=2)+'\n')
for action in actions:
 ar=[r for r in prep['records'] if r['action']==action];g=Image.new('RGB',(2400,600*((len(ar)+3)//4)),'#17253a');d=ImageDraw.Draw(g)
 for i,r in enumerate(ar):
  im=Image.open(OUT/(r['key']+'-candidate.png'));mask=Image.open(B/(r['key']+'-anatomy-mask.png'));bounds=mask.getbbox();im=im.crop((bounds[0]-100,bounds[1]-100,bounds[2]+100,bounds[3]+100));im.thumbnail((590,540));x=i%4*600;y=i//4*600;g.paste(im.convert('RGB'),(x+(600-im.width)//2,y+35));d.text((x+8,y+8),r['key']+(' / actual final' if (B/(r['key']+f"-attempt{r.get('chosen_art_attempt',1)}-cutout.png")).exists() else ' / GUIDE ONLY'),fill='white')
 g.save(OUT/(action+'-all-candidates.png'))
print(json.dumps({'poses':len(rows),'capsules':sum(len(r['hurtboxes']) for r in rows)}))
