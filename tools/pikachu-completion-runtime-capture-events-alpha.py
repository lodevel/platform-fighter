#!/usr/bin/env python3
"""Read-only immutable whole-drawing/receiving floor audit for real capture-event frames."""
import hashlib,json,math,sys
from pathlib import Path
from PIL import Image
import numpy as np
p=Path(sys.argv[1]);cutoff=int(sys.argv[2]) if len(sys.argv)>2 else 128
report=json.loads((p/'capture-event-match-observations.json').read_text());build=report['build']
checkpoint=build['sourceHashes'].replace('-source-hashes.json','');metadata=json.loads(Path(checkpoint+'-pikachu-frames.json').read_text());cache={};rows=[]
for row in report['rows']:
 samples=[]
 for observation in row['pull']+row['trace']:
  if observation.get('aRelease'):age=observation['aRelease']['framesElapsed']
  elif row['mode']=='damage' and observation.get('capture',{}).get('event',{}).get('kind')=='damage':age=observation['capture']['event']['framesElapsed']
  else:age=(observation.get('grab',{}).get('active') or {}).get('framesElapsed',-1)
  for who in ['actorBody','targetBody']:
   o=observation[who];sheet=o['texture'].split('.')[-1]
   if sheet not in metadata['animations']:continue
   clip=metadata['animations'][sheet];index=o['textureFrame'];key=(sheet,index)
   if key not in cache:
    strip=Path(build['outDir'])/'characters/pikachu'/clip['strip'];sha=hashlib.sha256(strip.read_bytes()).hexdigest();assert sha==clip['sha256']
    image=Image.open(strip).convert('RGBA');x=index%clip['columns']*clip['frameWidth'];y=index//clip['columns']*clip['frameHeight'];alpha=np.asarray(image.crop((x,y,x+clip['frameWidth'],y+clip['frameHeight'])))[:,:,3]
    cache[key]=(alpha,sha)
   alpha,sha=cache[key];ys,xs=np.where(alpha>=cutoff);dx=(xs+.5-o['origin'][0]*clip['frameWidth'])*o['scale'][0];dy=(ys+.5-o['origin'][1]*clip['frameHeight'])*o['scale'][1]
   if o['flipX']:dx*=-1
   if o['flipY']:dy*=-1
   world_y=o['spritePosition']['y']+dx*math.sin(o['rotation'])+dy*math.cos(o['rotation'])
   cap_bottom=max(max(b['capsule']['start']['y'],b['capsule']['end']['y'])+b['capsule']['radius'] for b in o['receiving'] if b.get('capsule'))
   samples.append({'who':who,'age':age,'sheet':sheet,'cell':index,'facing':o['facing'],'captured':observation['captured'],'grounded':o['grounded'],'position':o['position'],'spritePosition':o['spritePosition'],'origin':o['origin'],'rotation':o['rotation'],'mirror':math.copysign(1,o['scale'][0])*(-1 if o['flipX'] else 1),'floor':o['floorY'],'maxVisibleAlphaWorldY':float(world_y.max()),'floorGap':o['floorY']-float(world_y.max()),'pixelsBelowFloorHalfPixel':int((world_y>o['floorY']+.5).sum()),'receivingFloorGap':o['floorY']-o['position']['y']-cap_bottom,'stripSha256':sha})
 relevant=[s for s in samples if s['who']=='actorBody' and s['grounded'] or s['who']=='targetBody' and (s['captured'] or s['grounded'])]
 rows.append({'mode':row['mode'],'facing':row['facing'],'samples':samples,'worstVisibleFloorGap':min(s['floorGap'] for s in relevant),'worstReceivingFloorGap':min(s['receivingFloorGap'] for s in relevant),'failedVisible':sum(s['floorGap']<-.55 for s in relevant),'receivingSamplesBelowFloorHalfPixel':sum(s['receivingFloorGap']<-.5 for s in relevant)})
sheet_review=[]
for who,sheet in sorted(set((s['who'],s['sheet']) for row in rows for s in row['samples'])):
 samples=[s for row in rows for s in row['samples'] if s['who']==who and s['sheet']==sheet]
 gap=min(s['floorGap'] for s in samples)
 sheet_review.append({'who':who,'sheet':sheet,'samples':len(samples),'state':'PASS' if gap>=-.55 else 'FAIL','minimumVisibleFloorGap':gap,'minimumReceivingFloorGap':min(s['receivingFloorGap'] for s in samples)})
result={'state':'PASS' if all(r['failedVisible']==0 for r in rows) else 'FAIL','alphaCutoff':cutoff,'visibleBodyFloorTolerance':.55,'capsuleFloorExtentIsNotPhysicalFloorGate':True,'scope':f'Immutable visible alpha>={cutoff} pixel centres under exact actual sprite transforms against real floor, consistent.55px body contact tolerance. Grounded actor/target and still-captive target frames checked independently. Native/sourceguided receiving radii may overlap floor (ordinary idle baseline1.754px); preserve all12 source regions and report extents as vulnerability/fidelity, not physical support. No source retarget or position correction.','build':build,'bundleSha256':report['bundleSha256'],'sheetFloorReview':sheet_review,'rows':rows}
name='floor-alpha-observations.json' if cutoff==128 else f'floor-alpha{cutoff}-observations.json'
(p/name).write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'state':result['state'],'sheetFloorReview':sheet_review}))
