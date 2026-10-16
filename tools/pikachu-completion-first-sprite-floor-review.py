#!/usr/bin/env python3
"""Prepare lossless camera-derived body crops; this does not accept visuals."""
import hashlib,json,sys
from pathlib import Path
from PIL import Image,ImageDraw
folder=Path(sys.argv[1])
report=json.loads((folder/'observations.json').read_text())
assert report['result']=='PASS'
overrides_path=folder/'visual-crop-overrides.json'
overrides=json.loads(overrides_path.read_text()) if overrides_path.exists() else {}
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
review={'state':'prepared_actual_visual_inspection_pending','bundleSha256':report['bundleSha256'],'observationsSha256':sha(folder/'observations.json'),'galleries':[]}
for row in report['rows']:
 row_id=row.get('id','hard-landing')
 for page,start in enumerate(range(0,len(row['captures']),12)):
  selected=row['captures'][start:start+12]
  cols=min(4,len(selected));gallery=Image.new('RGB',(cols*380,((len(selected)+cols-1)//cols)*320),'#202633');draw=ImageDraw.Draw(gallery);captures=[]
  for n,capture in enumerate(selected):
   o=capture['observation'];camera=o['camera'];canvas=o['canvas'];world=camera['worldView']
   screen=lambda x,y:(canvas['left']+(camera['x']+(x-world['x'])*camera['zoom'])*canvas['width']/canvas['internalWidth'],canvas['top']+(camera['y']+(y-world['y'])*camera['zoom'])*canvas['height']/canvas['internalHeight'])
   x,y=screen(o['position']['x'],o['position']['y']);box=[round(x-190),round(y-150),round(x+190),round(y+130)]
   override=overrides.get(capture['screenshot'])
   if override:box=override['crop']
   else:assert world['width']>0,'First rendered camera has no worldView; inspect full screenshot and record explicit crop override'
   source=folder/capture['screenshot'];offset=((n%cols)*380,(n//cols)*320)
   gallery.paste(Image.open(source).convert('RGB').crop(box),(offset[0],offset[1]+40))
   age=o.get('age',o.get('landing',{}).get('framesElapsed'));clearance=o.get('alphaClearance',o.get('alpha32Clearance'))
   draw.text((offset[0]+4,offset[1]+4),f"{row_id} facing{row['facing']} age{age} cell{o['textureFrame']}",fill='white')
   draw.text((offset[0]+4,offset[1]+20),f"alpha32 floor gap{clearance:.4f}px;12 source caps",fill='white')
   captures.append({'screenshot':capture['screenshot'],'sha256':sha(source),'crop':box,'sourceDrawingCell':o['textureFrame'],'age':age,'cropOverride':override})
  name=f"{row_id.replace('.','-')}-{row['facing']}-actual-review-{page}.png";gallery.save(folder/name)
  review['galleries'].append({'file':name,'sha256':sha(folder/name),'captures':captures})
(folder/'visual-review-preparation.json').write_text(json.dumps(review,indent=2)+'\n')
print(json.dumps({'state':review['state'],'galleries':len(review['galleries']),'captures':sum(len(g['captures']) for g in review['galleries'])}))
