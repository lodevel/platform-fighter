#!/usr/bin/env python3
"""Inspect immutable saved PNG alpha against actual launch roots, without editing assets."""
import argparse,json,hashlib
from pathlib import Path
from PIL import Image
p=argparse.ArgumentParser();p.add_argument('observations',type=Path);p.add_argument('metadata',type=Path);p.add_argument('staged_art',type=Path);a=p.parse_args()
d=json.loads(a.observations.read_text());f=json.loads(a.metadata.read_text());rows=[]
for r in d['rows']:
 if r['sheet']!='jump':continue
 s=r['observation'];e=r['expectedPresentation'];c=f['animations'][e['sheet']];png=a.staged_art/c['strip'];actual=hashlib.sha256(png.read_bytes()).hexdigest();assert actual==c['sha256']
 im=Image.open(png).convert('RGBA');i=e['artFrameIndex'];w,h=c['frameWidth'],c['frameHeight'];x,y=(i%c['columns'])*w,(i//c['columns'])*h
 alpha=im.crop((x,y,x+w,y+h)).getchannel('A');mask=alpha.point(lambda v:255 if v>=32 else 0);b=mask.getbbox();assert b
 foot=s['position']['y']+25;bottom=foot+(b[3]-1-c['root'][1])*c['scaleToWorld'];clear=s['floorY']-bottom
 rows.append({'facing':r['facing'],'age':s['age'],'shortHop':s['jump']['shortHop'],'sheet':e['sheet'],'frame':i,'sourceSha256':actual,'alphaThreshold':32,'alphaBounds':list(b),'actorCentreY':s['position']['y'],'footRootY':foot,'floorY':s['floorY'],'alphaBottomY':bottom,'clearanceWorldPx':clear})
assert rows and all(r['clearanceWorldPx']>=-.5 for r in rows),rows
out={'state':'actual_root_and_immutable_saved_alpha_scoped_launch_clearance_PASS','observationsSha256':hashlib.sha256(a.observations.read_bytes()).hexdigest(),'bundle':d['bundle'],'bundleSha256':d['bundleSha256'],'toleranceWorldPx':.5,'scope':'Actual launch ages only; unchanged physics/root/scale, explicit beta full2/short4 cross-sheet chronology; native common jump clock not claimed. Screenshot review remains separate.','rows':rows}
(a.observations.parent/'floor-root-observations.json').write_text(json.dumps(out,indent=2)+'\n');print(json.dumps({'rows':len(rows),'minimumClearanceWorldPx':min(r['clearanceWorldPx'] for r in rows)}))
