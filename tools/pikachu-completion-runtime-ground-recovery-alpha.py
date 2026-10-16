#!/usr/bin/env python3
"""Immutable alpha32 floor audit of every observed native recovery age/freeze."""
import hashlib,json,math,sys
from pathlib import Path
from PIL import Image
import numpy as np

p=Path(sys.argv[1]);report=json.loads((p/'ground-recovery-match-observations.json').read_text());build=report['build']
metadata=json.loads(Path(build['sourceHashes'].replace('-source-hashes.json','')+'-pikachu-frames.json').read_text())
cache={};rows=[]
for row in report['rows']:
 samples=[];observations=[('native',o) for o in row['trace'] if o['recovery']]
 if row.get('hitlagFreeze'):observations += [('hitlag',o) for o in row['hitlagFreeze']['frozen']]
 for phase,o in observations:
  sheet=o['texture'].split('.')[-1];clip=metadata['animations'][sheet];index=o['textureFrame'];key=(sheet,index)
  if key not in cache:
   strip=Path(build['outDir'])/'characters/pikachu'/clip['strip'];sha=hashlib.sha256(strip.read_bytes()).hexdigest();assert sha==clip['sha256']
   x=index%clip['columns']*clip['frameWidth'];y=index//clip['columns']*clip['frameHeight']
   alpha=np.asarray(Image.open(strip).convert('RGBA').crop((x,y,x+clip['frameWidth'],y+clip['frameHeight'])))[:,:,3]
   cache[key]=(alpha,sha)
  alpha,sha=cache[key];ys,xs=np.where(alpha>=32);dx=(xs+.5-o['origin'][0]*clip['frameWidth'])*o['scale'][0];dy=(ys+.5-o['origin'][1]*clip['frameHeight'])*o['scale'][1]
  if o['flipX']:dx*=-1
  if o['flipY']:dy*=-1
  world_y=o['spritePosition']['y']+dx*math.sin(o['rotation'])+dy*math.cos(o['rotation'])
  receivingBottom=max(max(h['capsule']['start']['y'],h['capsule']['end']['y'])+h['capsule']['radius'] for h in o['receiving'])+o['position']['y']
  samples.append({'phase':phase,'age':o['recovery']['framesElapsed'],'sheet':sheet,'cell':index,'floorY':o['floorY'],'position':o['position'],'spritePosition':o['spritePosition'],'scale':o['scale'],'origin':o['origin'],'rotation':o['rotation'],'flipX':o['flipX'],'minimumVisibleFloorGap':o['floorY']-float(world_y.max()),'minimumReceivingFloorGap':o['floorY']-receivingBottom,'pixelsBelowTolerance':int((world_y>o['floorY']+.55).sum()),'stripSha256':sha})
 rows.append({'sheet':row['contract']['sheet'],'facing':row['facing'],'wallProbe':row['wallProbe'],'samples':samples,'minimumVisibleFloorGap':min(s['minimumVisibleFloorGap'] for s in samples),'minimumReceivingFloorGap':min(s['minimumReceivingFloorGap'] for s in samples),'state':'PASS' if all(s['minimumVisibleFloorGap']>=-.55 for s in samples) else 'FAIL'})
result={'state':'PASS' if all(r['state']=='PASS' for r in rows) else 'FAIL','scope':'Exact immutable RGBA alpha32 pixel centres under recorded actual production sprite affine transforms, every native committed age and replay hitlag step, versus actual support floor. Source capsule extents recorded as receiving vulnerability; they do not define physical support.','alphaCutoff':32,'visibleBodyFloorTolerance':.55,'capsuleFloorExtentIsNotPhysicalFloorGate':True,'bundleSha256':report['bundleSha256'],'build':build,'rows':rows}
(p/'floor-alpha32-observations.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'state':result['state'],'rows':[{k:r[k] for k in ['sheet','facing','wallProbe','state','minimumVisibleFloorGap','minimumReceivingFloorGap']} for r in rows]}))
