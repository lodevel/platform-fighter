"""Export target capsule candidates for accepted ftilt and inspected angled guides.

Every capsule needs actual body/overlay review before runtime acceptance.
"""
from pathlib import Path
import json,math,sys
import numpy as np
from PIL import Image,ImageDraw
sys.path.insert(0,str(Path(__file__).resolve().parent));from pikachu_native_pose import ROOT,MOTIONS,PikachuNativePose,sha
E=ROOT/'docs/review/2026-10-06/pikachu-character';B=E/'art';O=E/'sources/full-body-native-review/receiving';O.mkdir(parents=True,exist_ok=True)
cap=json.loads((E/'sources/native-hurtbox-capsules.json').read_text())['capsules'];records=[];sources=[]
ftilt=json.loads((ROOT/'assets/characters/pikachu/pose-batches/ftilt.json').read_text());rows=[]
for r,file in zip(ftilt['animations']['ftilt']['frameWindows'],ftilt['sources']):rows.append({'key':f'ftilt-{r["pose"]}','action':'forward-tilt','motion':'c01attacks3s','nativeSample':r['sourceIndex'],'startElapsed':r['startFrame'],'endElapsed':r['endFrame'],'bodyPath':file['file'],'bodySha256':file['sha256'],'canvasRoot':[768,880],'bodyIsFinal':True})
angles=json.loads((E/'sources/full-body-native-review/tilts/preparation.json').read_text())['records']
for r in angles:rows.append({'key':r['key'],'action':r['action'],'motion':r['motion'],'nativeSample':r['native_sample_index'],'startElapsed':None,'endElapsed':None,'bodyPath':str((B/f'{r["key"]}-seed.png').relative_to(ROOT)),'bodySha256':r['hashes']['seed'],'canvasRoot':[1024,1664],'bodyIsFinal':False})
chargeprep=json.loads((B/'normal-pilot-preparation.json').read_text())['records']
for action,motion in [('forward-smash-charge','c03attacks4charge'),('up-smash-charge','c04attackhi4charge'),('down-smash-charge','c04attacklw4charge')]:
 for r in chargeprep:
  if r['action']!=action:continue
  file=r['key']+'-attempt1-cutout.png';rows.append({'key':r['key'],'action':action,'motion':motion,'nativeSample':r['source_index'],'startElapsed':r['start_elapsed'],'endElapsed':r['end_elapsed'],'bodyPath':str((B/file).relative_to(ROOT)),'bodySha256':sha(B/file),'canvasRoot':[1024,1152],'bodyIsFinal':True})
for r in rows:
 pose=PikachuNativePose(MOTIONS/(r['motion']+'.nuanmb'));names=list(dict.fromkeys(['Trans']+[h['bone']['label'] for h in cap]));mats=pose.matrices(r['nativeSample'],names);trans=mats['Trans'][:3,3];boxes=[]
 for h in cap:
  m=mats[h['bone']['label']];rad=h['size'] if 'size' in h else h.get('native_size')
  if rad is None:
   print(h);raise ValueError('Missing native radius')
  radius=float(rad*max(np.linalg.norm(m[:3,j]) for j in range(3))*5);points=[]
  for end in ['endpoint1','endpoint2']:
   v=(m@np.array([*h[end],1]))[:3]-trans;points.append({'x':float(v[2]*5),'y':float(25-v[1]*5)})
  a,z=points;minx=min(a['x'],z['x'])-radius;maxx=max(a['x'],z['x'])+radius;miny=min(a['y'],z['y'])-radius;maxy=max(a['y'],z['y'])+radius
  boxes.append({'id':f'pikachu.{r["action"]}.{h["index"]}.{h["bone"]["label"]}','offsetX':(minx+maxx)/2,'offsetY':(miny+maxy)/2,'width':maxx-minx,'height':maxy-miny,'capsule':{'start':a,'end':z,'radius':radius}})
 im=Image.open(ROOT/r['bodyPath']).convert('RGBA');bg=Image.new('RGBA',im.size,'#17253a');bg.alpha_composite(im);layer=Image.new('RGBA',im.size);d=ImageDraw.Draw(layer);root=r['canvasRoot']
 for h in boxes:
  c=h['capsule'];rad=c['radius']/(70/600);pts=[(root[0]+p['x']/(70/600),root[1]+(p['y']-25)/(70/600)) for p in [c['start'],c['end']]];d.line(pts,fill='#b5a6ff',width=3)
  for x,y in pts:d.ellipse((x-rad,y-rad,x+rad,y+rad),outline='#b5a6ff',width=3)
 bg.alpha_composite(layer);b=im.getbbox() if r['bodyIsFinal'] else Image.open(B/(r['key']+'-anatomy-mask.png')).getbbox();crop=(b[0]-100,b[1]-100,b[2]+100,b[3]+100);bg=bg.crop(crop);bg.thumbnail((780,530));panel=Image.new('RGB',(800,580),'#17253a');panel.paste(bg.convert('RGB'),((800-bg.width)//2,40));ImageDraw.Draw(panel).text((8,8),r['key']+' / '+('actual accepted final' if r['bodyIsFinal'] else 'GUIDE ONLY')+' /12capsules',fill='white');p=O/(r['key']+'-candidate.png');panel.save(p)
 records.append({**r,'hurtboxes':boxes,'reviewPanel':str(p.relative_to(ROOT)),'reviewPanelSha256':sha(p),'provenance':pose.provenance()})
for group in ['forward-tilt','forward-tilt-up','forward-tilt-down','forward-smash-charge','up-smash-charge','down-smash-charge']:
 selected=[r for r in records if r['action']==group]
 for start in range(0,len(selected),4):
  gal=Image.new('RGB',(1600,1160),'#17253a')
  for i,r in enumerate(selected[start:start+4]):gal.paste(Image.open(ROOT/r['reviewPanel']),(i%2*800,i//2*580))
  gal.save(O/(group+f'-receiving-gallery-{start//4+1}.png'))
(O/'candidates.json').write_text(json.dumps({'state':'manual_receiving_fit_review_required','projection':{'nativeUnitsToWorld':5,'rootBelowBodyCentre':25,'removeTrans':True},'capsulesSourceSha256':sha(E/'sources/native-hurtbox-capsules.json'),'rows':records,'limits':['Target2Dprojection with maximumworldcolumn radius calibration; source3Dcollision/status/patch parity not qualified','Angled source guide review cannot accept receiving fit of future generated art']},indent=2)+'\n');print(json.dumps({'poses':len(records),'capsules':sum(len(r['hurtboxes']) for r in records)}))
