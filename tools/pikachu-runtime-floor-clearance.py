#!/usr/bin/env python3
"""Measure immutable body-cell alpha against recorded physical roots, with explicit solver slop."""
import argparse,json,hashlib
from pathlib import Path
from PIL import Image
p=argparse.ArgumentParser();p.add_argument('observations',type=Path);p.add_argument('metadata',type=Path);p.add_argument('staged_art',type=Path);p.add_argument('--sheets',default='bthrow,tumble');a=p.parse_args();selected=a.sheets.split(',')
d=json.loads(a.observations.read_text());f=json.loads(a.metadata.read_text());rows=[];cells={}
for case in d['rows']:
 for s in case.get('trace',[]):
  sheet=s.get('texture','').replace('char.pikachu.','')
  if sheet not in selected:continue
  i=s['textureFrame'];c=f['animations'][sheet];key=(sheet,i)
  if key not in cells:
   png=a.staged_art/c['strip'];sha=hashlib.sha256(png.read_bytes()).hexdigest();assert sha==c['sha256'];im=Image.open(png).convert('RGBA');w,h=c['frameWidth'],c['frameHeight'];x,y=(i%c['columns'])*w,(i//c['columns'])*h;alpha=im.crop((x,y,x+w,y+h)).getchannel('A');b=alpha.point(lambda v:255 if v>=32 else 0).getbbox();assert b;cells[key]=(b,sha)
  b,sha=cells[key];pos=s.get('actorPosition',s.get('position'));foot=pos['y']+25;bottom=foot+(b[3]-1-c['root'][1])*c['scaleToWorld'];floor=case['floorY'];age=s.get('presentation',s.get('reaction',{})) or {};rows.append({'facing':case['facing'],'kind':case.get('direction',case.get('kind')),'age':age.get('framesElapsed'),'sheet':sheet,'frame':i,'alpha32Bounds':list(b),'stripSha256':sha,'actorCentreY':pos['y'],'alphaBottomY':bottom,'floorY':floor,'clearanceWorldPx':floor-bottom})
assert rows
# Half a world pixel for the accepted one-packed-pixel ink edge, plus exact Matter .05 contact slop.
limit=.55;bad=[r for r in rows if r['clearanceWorldPx'] < -limit-1e-8]
out={'state':'PASS' if not bad else 'FAIL','scope':'Actual recorded physical roots and immutable saved RGBA alpha32 bounds, not native silhouette/physics parity; screenshots are reviewed separately.','observationsSha256':hashlib.sha256(a.observations.read_bytes()).hexdigest(),'bundle':d['bundle'],'bundleSha256':d['bundleSha256'],'tolerance':{'inkEdgeWorldPx':.5,'matterSolverContactSlopWorldPx':.05,'combinedWorldPx':limit},'rows':rows,'violations':bad};(a.observations.parent/'floor-alpha-observations.json').write_text(json.dumps(out,indent=2)+'\n');print(json.dumps({'result':out['state'],'rows':len(rows),'minimumClearanceWorldPx':min(r['clearanceWorldPx'] for r in rows),'violations':len(bad)}));assert not bad
