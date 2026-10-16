"""Pack independently accepted new footstool art and native contracts in staging."""
from pathlib import Path
import sys,json,hashlib,re,copy
import numpy as np
from PIL import Image,ImageDraw
import yaml
ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT/'tools'))
from pikachu_native_pose import PikachuNativePose,MOTIONS
E=ROOT/'docs/review/2026-10-06/pikachu-character';B=E/'art/completion-states-footstool';D=B/'staged';A=ROOT/'assets/characters/pikachu'
for p in [D,D/'animations',D/'pose-batches',D/'originals']:p.mkdir(exist_ok=True)
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();prep=json.loads((B/'full-pilot-preparation.json').read_text());ledger=json.loads((B/'full-generation-ledger.json').read_text());declarations=yaml.safe_load((E/'sources/motion-list.yml').read_text())['list'];drawings=[];files=[];rows=[]
def installfile(live,candidate):
 backup=None;before=sha(live) if live.exists() else None
 if before:
  backup=D/'originals'/(before+'-'+live.name)
  if not backup.exists():backup.write_bytes(live.read_bytes())
 files.append({'live':str(live.relative_to(ROOT)),'priorSha256':before,'priorBackup':str(backup.relative_to(ROOT)) if backup else None,'candidate':str(candidate.relative_to(ROOT)),'candidateSha256':sha(candidate),'newFile':before is None})
for job in prep['records']:
 out=next(r for r in ledger if r['pose_key']==job['key'] and r['state']=='accepted');atlas=B/out['outputs']['cutout']['file'];assert sha(atlas)==out['outputs']['cutout']['sha256'];image=Image.open(atlas).convert('RGBA')
 for c in job['cells']:
  x,y=c['offset'];body=image.crop((x,y,x+1024,y+1280)).resize((512,640),Image.Resampling.LANCZOS);bounds=body.getchannel('A').point(lambda a:255 if a>=32 else 0).getbbox();assert bounds
  if c['sheet']=='footstool_pose':assert bounds[3]-1<=416
  drawings.append({**c,'body':body,'bounds':bounds,'atlas':str(atlas.relative_to(ROOT)),'atlasSha256':sha(atlas),'job':out['job_key']})
framesPath=A/'frames.json';framesText=framesPath.read_text();frames=json.loads(framesText);leaf=ROOT/'src/characters/pikachuAuxiliaryBody.ts';leafText=leaf.read_text();prefix='const profiles: Readonly<Record<string, SourceProfile>> = ';start=leafText.index(prefix)+len(prefix);end=leafText.index(';',start);original=json.loads(leafText[start:end]);profiles=copy.deepcopy(original)
for sheet in ['footstool_pose','footstool_air_pose']:
 assert sheet not in frames['animations'] and sheet not in profiles,'New genuine body keys must not overwrite another profile'
 cells=sorted([r for r in drawings if r['sheet']==sheet],key=lambda r:r['nativeSample']);assert [r['nativeSample'] for r in cells]==[0,4,8]
 strip=Image.new('RGBA',(1536,640));receivingGallery=Image.new('RGBA',(1536,680),'#e4e3df')
 for i,c in enumerate(cells):
  strip.alpha_composite(c['body'],(i*512,0));panel=Image.new('RGBA',(512,640),'#e4e3df');panel.alpha_composite(c['body']);draw=ImageDraw.Draw(panel);draw.line((0,416,512,416),fill='red')
  for box in c['hurtboxes']:
   cap=box['capsule'];points=[(256+p['x']/(70/150),416+(p['y']-25)/(70/150)) for p in [cap['start'],cap['end']]];r=cap['radius']/(70/150);draw.line(points,fill='#13798b',width=2)
   for x,y in points:draw.ellipse((x-r,y-r,x+r,y+r),outline='#13798b',width=2)
  receivingGallery.alpha_composite(panel,(i*512,40));ImageDraw.Draw(receivingGallery).text((i*512+8,8),sheet+' native'+str(c['nativeSample'])+' body+12caps'+(' source-only endpoint' if c['sourceOnlyEndpoint'] else ''),fill='black')
  assert all(a['capsule']['radius']==b['capsule']['radius'] for a,b in zip(c['sourceHurtboxes'],c['hurtboxes']))
 png=D/'animations'/(sheet+'.png');strip.save(png);installfile(A/'animations'/png.name,png);receivingGallery.save(D/(sheet+'-paired-body-review.png'))
 motion=cells[0]['motion'];pose=PikachuNativePose(MOTIONS/(motion+'.nuanmb'));path=[]
 for frame in range(9):
  p=pose.matrices(frame,['Trans'])['Trans']@np.array([0,0,0,1]);path.append({'x':float(p[2])*5,'y':-float(p[1])*5})
 origin=path[0];deltas=[{'x':p['x']-origin['x'],'y':p['y']-origin['y']} for p in path];decl=next(d for d in declarations.values() if any(a['name']==motion+'.nuanmb' for a in d['animations']));extra=decl['extra'];endAge=9 if sheet=='footstool_pose' else 8
 windows=[{'startFrame':0,'endFrame':4,'artFrameIndex':0},{'startFrame':4,'endFrame':8,'artFrameIndex':1}]
 if endAge==9:windows.append({'startFrame':8,'endFrame':9,'artFrameIndex':2})
 profile={'endExclusive':endAge,'drawings':[{'start':w['startFrame'],'end':w['endFrame'],'artFrameIndex':w['artFrameIndex'],'nativeSample':cells[w['artFrameIndex']]['nativeSample'],'hurtboxes':cells[w['artFrameIndex']]['hurtboxes']} for w in windows],'sourceRootDelta':deltas,'sourceStatus':{'cancelFrame':extra['cancel_frame'] or None,'intangibilityStartFrame':extra['xlu_start'] or None,'intangibilityEndExclusive':extra['xlu_end'] or None},'sourceLoop':False,'loopFrames':None};profiles[sheet]=profile
 clip={'strip':'animations/'+png.name,'frameCount':3,'sha256':sha(png),'frameWindows':windows,'frameWidth':512,'frameHeight':640,'root':[256,416],'scaleToWorld':70/150,'sourceCells':[[0,0],[1,0],[2,0]],'nativeSampleIndices':[0,4,8],'nativeWindows':[{'nativeStart':w['startFrame'],'nativeEnd':w['endFrame'],'artFrameIndex':w['artFrameIndex'],'nativeSample':cells[w['artFrameIndex']]['nativeSample']} for w in windows],'runtimeClock':'Explicit authored beta footstool victim cue: ground native0..8; air native0..7 then source StepFall loop16. Physical owner controls state/input/gravity; no added victim impulse.','packingMetadata':f'assets/characters/pikachu/pose-batches/full-{sheet}-tiled.json'}
 meta={'state':'staged_actual_saved_body_receiving_review_pending','coordinateContract':{'frameWidth':512,'frameHeight':640,'root':[256,416],'scaleToWorld':70/150},'animations':{sheet:copy.deepcopy(clip)},'sources':[{k:v for k,v in c.items() if k!='body'} for c in cells],'sourceMotion':pose.provenance(),'sourceDeclaration':decl,'sourceOnlyEndpointIndices':[2] if endAge==8 else [],'limits':['New bounded generated source pose; no generic body alias.','Common status conditions are explicit beta physical owners, not native common selector parity.','Ground underside has scoped anatomy adaptation and paired lower endpoints; radii exact.','Actual running-match qualification pending.']};metaPath=D/'pose-batches'/f'full-{sheet}-tiled.json';metaPath.write_text(json.dumps(meta,indent=2)+'\n');installfile(A/'pose-batches'/metaPath.name,metaPath);clip['packingMetadataSha256']=sha(metaPath);frames['animations'][sheet]=clip;rows.append({'sheet':sheet,'sourceMotion':pose.provenance(),'sourceStatus':profile['sourceStatus'],'sourceEndAge':endAge,'samples':[0,4,8],'sourceOnlyEndpoint':8 if endAge==8 else None,'sourceRootDelta':deltas,'sha256':sha(png),'pairedReview':str((D/(sheet+'-paired-body-review.png')).relative_to(ROOT))})
for k,v in original.items():assert profiles[k]==v
newLeaf=leafText[:start]+json.dumps(profiles,separators=(',',':'))+leafText[end:];newLeaf=newLeaf.replace("export type PikachuAuxiliaryBodySheet = ","export type PikachuAuxiliaryBodySheet = 'footstool_pose' | 'footstool_air_pose' | ",1);p=D/'pikachuAuxiliaryBody.ts';p.write_text(newLeaf);installfile(leaf,p)
# Keep every existing frame entry byte-exact; append only two new entries.
needle='"animations": {';position=framesText.index(needle)+len(needle);addition='\n'+',\n'.join('    '+json.dumps(sheet)+': '+json.dumps(frames['animations'][sheet],indent=2).replace('\n','\n    ') for sheet in ['footstool_pose','footstool_air_pose'])+',';newFrames=framesText[:position]+addition+framesText[position:];assert json.loads(newFrames)['animations']==frames['animations'];p=D/'frames.json';p.write_text(newFrames);installfile(framesPath,p)
(D/'candidate.json').write_text(json.dumps({'state':'saved_actual_new_footstool_body_and_receiving_review_pending','installFiles':files,'profiles':rows,'allExistingProfilesExact':True,'allExistingFramesEntriesExact':True,'sourceReferences':'art/completion-states-footstool/source-guide-preparation.json'},indent=2)+'\n');print(json.dumps({'newBodyFamilies':2,'newDrawingCells':6,'files':len(files),'review':str(D)}))
