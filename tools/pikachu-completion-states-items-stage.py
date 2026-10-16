"""Pack accepted genuine pickup/release drawings; root installs reviewed candidates.

The selector uses native ages for one sampled cue. Clip windows describe the
authored beta visual event, independently of native motion cancel declarations.
The separately inspected WaitItem carry reuse can be appended later.
"""
from pathlib import Path
import copy,hashlib,json,sys
import numpy as np
from PIL import Image,ImageDraw

ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT/'tools'))
from pikachu_native_pose import PikachuNativePose,MOTIONS
E=ROOT/'docs/review/2026-10-06/pikachu-character'
B=E/'art/completion-states-items';D=B/'staged-events'
A=ROOT/'assets/characters/pikachu'
for p in [D,D/'animations',D/'pose-batches',D/'originals']:p.mkdir(exist_ok=True)
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
checkpoints={};files=[];rows=[]
def checkpoint(p):
 data=p.read_bytes();checkpoints[p]=hashlib.sha256(data).hexdigest();return data
def installfile(live,candidate):
 before=checkpoints.get(live)
 if live.exists():
  assert before is not None and sha(live)==before,'Live source changed during staging'
  backup=D/'originals'/(before+'-'+live.name)
  if not backup.exists():backup.write_bytes(live.read_bytes())
 else:backup=None
 files.append({'live':str(live.relative_to(ROOT)),'priorSha256':before,
  'priorBackup':str(backup.relative_to(ROOT)) if backup else None,
  'candidate':str(candidate.relative_to(ROOT)),'candidateSha256':sha(candidate),'newFile':before is None})
framesPath=A/'frames.json';framesText=checkpoint(framesPath).decode();frames=json.loads(framesText)
leaf=ROOT/'src/characters/pikachuAuxiliaryBody.ts';leafText=checkpoint(leaf).decode()
prefix='const profiles: Readonly<Record<string, SourceProfile>> = '
start=leafText.index(prefix)+len(prefix);end=leafText.index(';',start)
original=json.loads(leafText[start:end]);profiles=copy.deepcopy(original)
prep=json.loads((B/'full-pilot-preparation.json').read_text())['records']
ledger=json.loads((B/'full-generation-ledger.json').read_text());drawings=[]
for pose in prep:
 out=next(r for r in ledger if r['pose_key']==pose['key'] and r['state']=='accepted')
 job=pose.get('attempts',{}).get(str(out['attempt']),pose)
 assert out.get('actual_visual_review'),'Actual output inspection required'
 atlas=B/out['outputs']['cutout']['file'];assert sha(atlas)==out['outputs']['cutout']['sha256']
 image=Image.open(atlas).convert('RGBA')
 for c in job['cells']:
  x,y=c['offset'];body=image.crop((x,y,x+1024,y+1280)).resize((512,640),Image.Resampling.LANCZOS)
  bounds=body.getchannel('A').point(lambda a:255 if a>=32 else 0).getbbox();assert bounds
  if '_air_' not in c['sheet']:assert bounds[3]-1<=416
  assert len(c['hurtboxes'])==12
  assert all(a['capsule']['radius']==b['capsule']['radius'] for a,b in zip(c['sourceHurtboxes'],c['hurtboxes']))
  drawings.append({**c,'body':body,'bounds':bounds,'atlas':str(atlas.relative_to(ROOT)),'atlasSha256':sha(atlas),'job':out['job_key']})
keys=sorted(set(c['sheet'] for c in drawings));assert len(keys)==11 and len(drawings)==13
for sheet in keys:
 assert sheet not in frames['animations'] and sheet not in profiles,'New genuine body must not overwrite existing key'
 cells=sorted([c for c in drawings if c['sheet']==sheet],key=lambda c:c['nativeSample'])
 samples=[c['nativeSample'] for c in cells]
 if sheet=='item_pickup_stand':
  assert samples==[0,2,7]
  nativeWindows=[{'startFrame':0,'endFrame':2,'artFrameIndex':0},{'startFrame':2,'endFrame':7,'artFrameIndex':1},{'startFrame':7,'endFrame':8,'artFrameIndex':2}]
  windows=copy.deepcopy(nativeWindows);endAge=8;cueDuration=8
 else:
  assert len(cells)==1
  age=samples[0];endAge=age+1;cueDuration=1 if sheet=='item_pickup_walk' else 6
  nativeWindows=[{'startFrame':age,'endFrame':endAge,'artFrameIndex':0}]
  windows=[{'startFrame':0,'endFrame':cueDuration,'artFrameIndex':0}]
 strip=Image.new('RGBA',(512*len(cells),640));gallery=Image.new('RGBA',(512*len(cells),680),'#e4e3df')
 for i,c in enumerate(cells):
  strip.alpha_composite(c['body'],(i*512,0));panel=Image.new('RGBA',(512,640),'#e4e3df');panel.alpha_composite(c['body']);draw=ImageDraw.Draw(panel)
  draw.line((0,416,512,416),fill='red')
  for box in c['hurtboxes']:
   cap=box['capsule'];pts=[(256+p['x']/(70/150),416+(p['y']-25)/(70/150)) for p in [cap['start'],cap['end']]];r=cap['radius']/(70/150);draw.line(pts,fill='#13798b',width=2)
   for x,y in pts:draw.ellipse((x-r,y-r,x+r,y+r),outline='#13798b',width=2)
  socket=c['sourceHaveBODYCENTRE'];x=256+socket['x']/(70/150);y=416+(socket['y']-25)/(70/150)
  draw.ellipse((x-3,y-3,x+3,y+3),fill='#de098b')
  gallery.alpha_composite(panel,(i*512,40));ImageDraw.Draw(gallery).text((i*512+8,8),sheet+' native'+str(c['nativeSample'])+' 12caps + sourceHave',fill='black')
 png=D/'animations'/(sheet+'.png');strip.save(png);installfile(A/'animations'/png.name,png)
 galleryPath=D/(sheet+'-paired-body-review.png');gallery.save(galleryPath)
 pose=PikachuNativePose(MOTIONS/(cells[0]['motion']+'.nuanmb'));path=[]
 for age in range(endAge):
  p=pose.matrices(age,['Trans'])['Trans']@np.array([0,0,0,1]);path.append({'x':float(p[2])*5,'y':-float(p[1])*5})
 origin=path[0];deltas=[{'x':p['x']-origin['x'],'y':p['y']-origin['y']} for p in path]
 decl=cells[0]['sourceDeclaration'];extra=decl['extra']
 status={'cancelFrame':extra['cancel_frame'] or None,'intangibilityStartFrame':extra['xlu_start'] or None,'intangibilityEndExclusive':extra['xlu_end'] or None}
 profiles[sheet]={'endExclusive':endAge,'drawings':[{'start':w['startFrame'],'end':w['endFrame'],'artFrameIndex':w['artFrameIndex'],'nativeSample':cells[w['artFrameIndex']]['nativeSample'],'hurtboxes':cells[w['artFrameIndex']]['hurtboxes']} for w in nativeWindows],
  'sourceRootDelta':deltas,'sourceStatus':status,'sourceLoop':False,'loopFrames':None}
 clip={'strip':'animations/'+png.name,'frameCount':len(cells),'sha256':sha(png),'frameWindows':windows,
  'frameWidth':512,'frameHeight':640,'root':[256,416],'scaleToWorld':70/150,
  'sourceCells':[[i,0] for i in range(len(cells))],'nativeSampleIndices':samples,
  'nativeWindows':[{'nativeStart':w['startFrame'],'nativeEnd':w['endFrame'],'artFrameIndex':w['artFrameIndex'],'nativeSample':cells[w['artFrameIndex']]['nativeSample']} for w in nativeWindows],
  'runtimeClock':f'Authored unlocked beta item visual event: {cueDuration} cue steps; source native drawing/Have/12caps paired. Native motion cancel declaration retained separately; common item commitment unknown. Fresh other actions interrupt. Aerial cues end on grounded contact.',
  'packingMetadata':f'assets/characters/pikachu/pose-batches/full-{sheet}-tiled.json'}
 meta={'state':'saved_body_receiving_socket_visual_review_pending','coordinateContract':{'frameWidth':512,'frameHeight':640,'root':[256,416],'scaleToWorld':70/150},'animations':{sheet:copy.deepcopy(clip)},
  'sources':[{k:v for k,v in c.items() if k!='body'} for c in cells],'sourceMotion':pose.provenance(),'sourceDeclaration':decl,
  'betaEvent':{'duration':cueDuration,'lockedInputs':False,'fixedNativeAge':None if sheet=='item_pickup_stand' else samples[0]},
  'limits':['Genuine bounded generated native item body; no attack or generic body alias.','Source Have is explicitly authored beta mouth socket; native item node/orientation unresolved.','Source numeric cancel differs from beta event and does not claim common native commitment.','Ground underside adaptations and paired lower endpoints preserve roots, source core and all capsule radii.','Actual match qualification pending.']}
 metaPath=D/'pose-batches'/f'full-{sheet}-tiled.json';metaPath.write_text(json.dumps(meta,indent=2)+'\n');installfile(A/'pose-batches'/metaPath.name,metaPath)
 clip['packingMetadataSha256']=sha(metaPath);frames['animations'][sheet]=clip
 rows.append({'sheet':sheet,'nativeSamples':samples,'sourceStatus':status,'sourceRootDelta':deltas,'betaCueDuration':cueDuration,'sha256':sha(png),'pairedReview':str(galleryPath.relative_to(ROOT))})
for key,value in original.items():assert profiles[key]==value
newLeaf=leafText[:start]+json.dumps(profiles,separators=(',',':'))+leafText[end:]
newLeaf=newLeaf.replace('export type PikachuAuxiliaryBodySheet = ','export type PikachuAuxiliaryBodySheet = '+' | '.join(repr(k) for k in keys)+' | ',1)
p=D/'pikachuAuxiliaryBody.ts';p.write_text(newLeaf);installfile(leaf,p)
needle='"animations": {';position=framesText.index(needle)+len(needle)
addition='\n'+',\n'.join('    '+json.dumps(k)+': '+json.dumps(frames['animations'][k],indent=2).replace('\n','\n    ') for k in keys)+','
newFrames=framesText[:position]+addition+framesText[position:]
assert json.loads(newFrames)['animations']==frames['animations']
p=D/'frames.json';p.write_text(newFrames);installfile(framesPath,p)
assert all(sha(p)==h for p,h in checkpoints.items()),'Source changed before candidate receipt'
(D/'candidate.json').write_text(json.dumps({'state':'saved_new_item_body_receiving_socket_review_pending','installFiles':files,'profiles':rows,'allExistingProfilesExact':True,'allExistingFramesEntriesExact':True,'reservedTextureKeys':['char.pikachu.'+k for k in keys],'runtimeQualified':False},indent=2)+'\n')
print(json.dumps({'newBodyFamilies':len(keys),'newDrawingCells':len(drawings),'files':len(files),'review':str(D)}))
