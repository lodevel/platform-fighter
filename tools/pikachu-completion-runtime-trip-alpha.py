#!/usr/bin/env python3
"""Exact immutable alpha32 floor audit for the observed beta trip owner."""
import hashlib,json,math,sys
from pathlib import Path
from PIL import Image
import numpy as np

p=Path(sys.argv[1]);report=json.loads((p/'trip-match-observations.json').read_text());build=report['build']
metadata=json.loads(Path(build['sourceHashes'].replace('-source-hashes.json','')+'-pikachu-frames.json').read_text())
cache={};rows=[]
for row in report['rows']:
 observations=[('actual-trip',o) for o in row['trace'] if o['tripped']]
 if row.get('replayFreeze'):observations += [('replay-freeze',o) for o in row['replayFreeze']['steps']]
 samples=[]
 for phase,o in observations:
  assert o['texture']=='char.pikachu.trip'
  clip=metadata['animations']['trip'];index=o['textureFrame'];key=index
  if key not in cache:
   strip=Path(build['outDir'])/'characters/pikachu'/clip['strip'];sha=hashlib.sha256(strip.read_bytes()).hexdigest();assert sha==clip['sha256']
   x=index%clip['columns']*clip['frameWidth'];y=index//clip['columns']*clip['frameHeight']
   alpha=np.asarray(Image.open(strip).convert('RGBA').crop((x,y,x+clip['frameWidth'],y+clip['frameHeight'])))[:,:,3]
   cache[key]=(alpha,sha)
  alpha,sha=cache[key];ys,xs=np.where(alpha>=32)
  dx=(xs+.5-o['origin'][0]*clip['frameWidth'])*o['scale'][0];dy=(ys+.5-o['origin'][1]*clip['frameHeight'])*o['scale'][1]
  if o['flipX']:dx*=-1
  if o['flipY']:dy*=-1
  world_y=o['spritePosition']['y']+dx*math.sin(o['rotation'])+dy*math.cos(o['rotation'])
  receiving_bottom=max(max(h['capsule']['start']['y'],h['capsule']['end']['y'])+h['capsule']['radius'] for h in o['receiving'])+o['position']['y']
  samples.append({'phase':phase,'age':o['reaction']['framesElapsed'],'cell':index,'nativeSample':clip['nativeSampleIndices'][index],
   'floorY':o['floorY'],'position':o['position'],'spritePosition':o['spritePosition'],'scale':o['scale'],'origin':o['origin'],
   'rotation':o['rotation'],'flipX':o['flipX'],'minimumVisibleFloorGap':o['floorY']-float(world_y.max()),
   'minimumReceivingFloorGap':o['floorY']-receiving_bottom,'pixelsBelowTolerance':int((world_y>o['floorY']+.55).sum()),'stripSha256':sha})
 rows.append({'facing':row['facing'],'route':row['route'],'samples':samples,'minimumVisibleFloorGap':min(s['minimumVisibleFloorGap'] for s in samples),
  'minimumReceivingFloorGap':min(s['minimumReceivingFloorGap'] for s in samples),'state':'PASS' if all(s['minimumVisibleFloorGap']>=-.55 for s in samples) else 'FAIL'})
result={'state':'PASS' if rows and all(r['state']=='PASS' for r in rows) else 'FAIL','scope':'Exact immutable RGBA alpha32 pixel centres under the recorded actual production sprite affine, every committed authored trip age and replay-freeze step, versus actual supported floor. Capsule extents describe receiving vulnerability and do not define physical support. Only native drawings actually consumed by the beta26 owner qualify; later source-only drawings and native common duration/selector remain separate.',
 'alphaCutoff':32,'visibleBodyFloorTolerance':.55,'capsuleFloorExtentIsNotPhysicalFloorGate':True,'bundleSha256':report['bundleSha256'],'build':build,'rows':rows}
(p/'floor-alpha32-observations.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'state':result['state'],'rows':[{k:r[k] for k in ['facing','route','state','minimumVisibleFloorGap','minimumReceivingFloorGap']} for r in rows]}))
