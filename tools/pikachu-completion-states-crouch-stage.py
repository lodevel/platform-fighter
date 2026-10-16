"""Stage scoped, reviewed Comfy output and paired receiving; never install."""
from pathlib import Path
import json,copy,hashlib,math,argparse
import numpy as np
from PIL import Image,ImageDraw,ImageFilter
ROOT=Path(__file__).resolve().parent.parent
B=ROOT/'docs/review/2026-10-06/pikachu-character/art/completion-states-crouch-floor'
parser=argparse.ArgumentParser();parser.add_argument('--keys',nargs='+');parser.add_argument('--stage-name',choices=['staged','staged-followup','staged-recoveries','staged-recoveries-remaining','staged-recoveries-final13','staged-hardlanding','staged-capture','staged-shield','staged-prone','staged-entry','staged-idle','staged-defense','staged-idle-remaining']);parser.add_argument('--receiving-leaf',choices=['state','auxiliary'],default='state');args=parser.parse_args()
D=B/(args.stage_name or 'staged');A=ROOT/'assets/characters/pikachu'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
sourceCheckpoints={}
def readCheckpoint(path):
 data=path.read_bytes();sourceCheckpoints[path]=hashlib.sha256(data).hexdigest();return data
D.mkdir(exist_ok=True);(D/'animations').mkdir(exist_ok=True);(D/'pose-batches').mkdir(exist_ok=True);(D/'originals').mkdir(exist_ok=True)
prep=json.loads((B/'full-pilot-preparation.json').read_text())['records'];ledger=json.loads((B/'full-generation-ledger.json').read_text())
if args.keys:
 assert len(args.keys)==len(set(args.keys)) and set(args.keys)<=set(r['key'] for r in prep)
 prep=[r for r in prep if r['key'] in args.keys]
framesPath=A/'frames.json';frameText=readCheckpoint(framesPath).decode();frames=json.loads(frameText)
leaf=ROOT/('src/characters/pikachuAuxiliaryBody.ts' if args.receiving_leaf=='auxiliary' else 'src/characters/pikachuStateHurtboxes.ts');leafText=readCheckpoint(leaf).decode()
if args.receiving_leaf=='auxiliary':
 prefix='const profiles: Readonly<Record<string, SourceProfile>> = ';start=leafText.index(prefix)+len(prefix);end=leafText.index(';',start);originalProfiles=json.loads(leafText[start:end]);profiles=copy.deepcopy(originalProfiles);originalPoses=[{'sheet':sheet,'nativeSample':d['nativeSample'],'hurtboxes':d['hurtboxes']} for sheet,p in originalProfiles.items() for d in p['drawings']];poses=[{'sheet':sheet,'nativeSample':d['nativeSample'],'hurtboxes':d['hurtboxes']} for sheet,p in profiles.items() for d in p['drawings']]
else:
 prefix='export const PIKACHU_STATE_AUTHORED_HURTBOX_POSES = ';start=leafText.index(prefix)+len(prefix);end=leafText.index(' as const;',start);originalPoses=json.loads(leafText[start:end]);poses=copy.deepcopy(originalPoses)
changes=[];sheets={};files=[]
def pair(h):
 c=h['capsule'];a,b=c['start'],c['end'];r=c['radius'];h.update(offsetX=(a['x']+b['x'])/2,offsetY=(a['y']+b['y'])/2,width=abs(a['x']-b['x'])+2*r,height=abs(a['y']-b['y'])+2*r)
def localreplace(text,old,new):
 # Existing objects are either compact receiving rows or formatted frame entries.
 oldCompact=json.dumps(old,separators=(',',':'));newCompact=json.dumps(new,separators=(',',':'))
 if oldCompact in text:return text.replace(oldCompact,newCompact,1)
 raise ValueError('Exact row byte checkpoint unavailable')
for job in prep:
 if job.get('state','').startswith('superseded'):continue
 out=next((r for r in reversed(ledger) if r['pose_key']==job['key'] and r['state']=='accepted'),None)
 if not out or out['state']!='accepted':raise ValueError('Actual generated output review required: '+job['key'])
 atlas=B/out['outputs']['cutout']['file'];assert sha(atlas)==out['outputs']['cutout']['sha256'];generated=Image.open(atlas).convert('RGBA')
 for entry in job['cells']:
  sheet=entry['sheet'];i=entry['artFrameIndex'];clip=frames['animations'][sheet];source=ROOT/entry['source'];sourceAtlasHashMatched=sha(source)==entry['sourceSha256'];assert sourceAtlasHashMatched or entry.get('sourceCellPixelSha256'), 'Source atlas changed without retained cell identity'
  if sheet not in sheets:
   meta=A/'pose-batches'/('full-'+sheet+'-tiled.json');readCheckpoint(source);sheets[sheet]={'source':source,'image':Image.open(source).convert('RGBA'),'original':Image.open(source).convert('RGBA'),'metaPath':meta,'meta':json.loads(readCheckpoint(meta))}
  data=sheets[sheet];col,row=clip['sourceCells'][i];w,h=clip['frameWidth'],clip['frameHeight'];pos=(col*w,row*h);old=data['original'].crop((*pos,pos[0]+w,pos[1]+h));assert sourceAtlasHashMatched or (hashlib.sha256(old.tobytes()).hexdigest()==entry['sourceCellPixelSha256'] and clip['root']==entry['root']), 'Affected source cell changed';x,y=entry['offset'];panel=generated.crop((x,y,x+1024,y+1280)).resize((512,640),Image.Resampling.LANCZOS)
  if h<640:assert not panel.crop((0,h,512,640)).getchannel('A').point(lambda a:255 if a>=32 else 0).getbbox(), 'Lower canvas padding contains visible generated anatomy'
  new=panel.crop((0,0,w,h))
  adaptation=entry['adaptation'];allowed=Image.new('L',old.size,0)
  if adaptation['kind']=='Tail1 localrotation':
   ImageDraw.Draw(allowed).polygon(adaptation['oldTailSelection'],fill=255)
   tail=old.copy();tail.putalpha(Image.fromarray(np.minimum(np.asarray(old.getchannel('A')),np.asarray(allowed)).astype('uint8')))
   core=old.copy();core.putalpha(Image.fromarray(np.where(np.asarray(allowed)>0,0,np.asarray(old.getchannel('A'))).astype('uint8')))
   px,py=adaptation['pivotArt'];t=math.radians(adaptation['screenAngleDegrees']);co,si=math.cos(t),math.sin(t);rotated=tail.transform(old.size,Image.Transform.AFFINE,(co,si,px-co*px-si*py,-si,co,py+si*px-co*py),Image.Resampling.BICUBIC)
   allowed=Image.fromarray(np.maximum(np.asarray(allowed),np.asarray(rotated.getchannel('A')))).filter(ImageFilter.MaxFilter(7));allowed=Image.fromarray(np.where(np.asarray(core.getchannel('A'))>=32,0,np.asarray(allowed)).astype('uint8'))
  else:
   first=adaptation['originalArtBand'][0];region=np.asarray(old.getchannel('A'))>0;region[:first]=False;allowed=Image.fromarray(region.astype('uint8')*255).filter(ImageFilter.MaxFilter(7));allowed=Image.fromarray(np.where(np.indices((h,w))[0]<first,0,np.asarray(allowed)).astype('uint8'))
  allowedArray=np.asarray(allowed)>0
  if entry.get('protectedIdentityMask'):
   shield=entry['protectedIdentityMask'];shieldPath=B/shield['file'];assert sha(shieldPath)==shield['sha256']
   identity=np.asarray(Image.open(shieldPath).convert('L'));assert identity.shape==allowedArray.shape
   allowedArray&=identity==0
  packed=Image.fromarray(np.where(allowedArray[:,:,None],np.asarray(new),np.asarray(old)).astype('uint8'));assert not np.any(np.asarray(packed)[~allowedArray]!=np.asarray(old)[~allowedArray]);data['image'].paste(packed,pos)
  target=next(r for r in poses if r['sheet']==sheet and r['nativeSample']==entry['nativeSample']);prior=copy.deepcopy(target);changed=[]
  for j,region in enumerate(target['hurtboxes']):
   if adaptation['kind']=='Tail1 localrotation' and j not in (10,11):continue
   original=copy.deepcopy(region)
   for k in ('start','end'):
    p=region['capsule'][k]
    if adaptation['kind']=='Tail1 localrotation':
     px=(adaptation['pivotArt'][0]-256)*clip['scaleToWorld'];py=25+(adaptation['pivotArt'][1]-416)*clip['scaleToWorld'];dx,dy=p['x']-px,p['y']-py;p.update(x=px+co*dx-si*dy,y=py+si*dx+co*dy)
    else:
     artY=416+(p['y']-25)/clip['scaleToWorld'];first,last=adaptation['originalArtBand'];targetFirst,targetLast=adaptation['targetArtBand']
     if artY>=first:p['y']=25+(targetFirst+(artY-first)*(targetLast-targetFirst)/(last-first)-416)*clip['scaleToWorld']
   if region!=original:pair(region);changed.append(j)
   assert region['capsule']['radius']==original['capsule']['radius']
  bounds=packed.getchannel('A').point(lambda a:255 if a>=32 else 0).getbbox();assert bounds[3]-1<=416
  record={'sheet':sheet,'artFrameIndex':i,'nativeSample':entry['nativeSample'],'originalInputAtlasHashMatched':sourceAtlasHashMatched,'guardedAffectedSourceCellMatch':True,'oldCellPixelSha256':hashlib.sha256(old.tobytes()).hexdigest(),'newCellPixelSha256':hashlib.sha256(packed.tobytes()).hexdigest(),'authorizedPixelChanges':int(np.count_nonzero(np.any(np.asarray(old)!=np.asarray(packed),axis=2))),'protectedPixelChanges':0,'alpha32Bounds':bounds,'alpha32BelowRootWorldPx':(bounds[3]-.5-416)*clip['scaleToWorld'],'changedCapsuleIndices':changed,'adaptation':adaptation,'job':job['key'],'output':str(atlas.relative_to(ROOT)),'outputSha256':sha(atlas),'priorPose':prior,'candidatePose':target};changes.append(record)
  src=data['meta']['sources'][i];src['authoredGeometryAdaptation']={'kind':adaptation,'receiving':{'changedIndices':changed,'radiusChanges':0,'allOtherRegionsExact':True},'evidence':str((D/'candidate.json').relative_to(ROOT)),'sourceParity':'Explicit authored beta floor clearance; does not claim native anatomy parity'};src.update(atlas=str(atlas.relative_to(ROOT)),atlasSha256=sha(atlas),atlasCell=job['cells'].index(entry),cellOffset=entry['offset'],uniformScale=.5)
  if entry.get('protectedIdentityMask'):
   record['protectedIdentityMask']=entry['protectedIdentityMask'];src['authoredGeometryAdaptation']['protectedIdentityMask']=entry['protectedIdentityMask']
  gallery=Image.new('RGBA',(2048,680),'#17253a')
  for j,(body,bg,label) in enumerate([(old,'#f7f5ef','previous'),(packed,'#f7f5ef','candidate receiving'),(old,'#17253a','previous'),(packed,'#17253a','candidate receiving')]):
   panel=Image.new('RGBA',old.size,bg);panel.alpha_composite(body);draw=ImageDraw.Draw(panel);draw.line((0,416,512,416),fill='red')
   if j in (1,3):
    for region in target['hurtboxes']:
     c=region['capsule'];pts=[(256+p['x']/clip['scaleToWorld'],416+(p['y']-25)/clip['scaleToWorld']) for p in [c['start'],c['end']]];r=c['radius']/clip['scaleToWorld'];draw.line(pts,fill='#b1a7ff')
     for px,py in pts:draw.ellipse((px-r,py-r,px+r,py+r),outline='#b1a7ff')
   gallery.alpha_composite(panel,(j*512,40));ImageDraw.Draw(gallery).text((j*512+8,8),f'{sheet} native{entry["nativeSample"]} {label}',fill='white')
  gallery.save(D/(sheet+'-'+str(i)+'-body-caps-review.png'))
def savefile(live,candidate):
 assert sha(live)==sourceCheckpoints[live], 'Source changed while staging; discard candidate and stage again'
 backup=D/'originals'/(sha(live)+'-'+live.name)
 if not backup.exists():backup.write_bytes(live.read_bytes())
 files.append({'live':str(live.relative_to(ROOT)),'priorSha256':sha(live),'priorBackup':str(backup.relative_to(ROOT)),'candidate':str(candidate.relative_to(ROOT)),'candidateSha256':sha(candidate)})
for sheet,data in sheets.items():
 clip=frames['animations'][sheet];png=D/'animations'/(sheet+'.png');data['image'].save(png);changed={r['artFrameIndex'] for r in changes if r['sheet']==sheet}
 for i,(col,row) in enumerate(clip['sourceCells']):
  if i in changed:continue
  w,h=clip['frameWidth'],clip['frameHeight'];box=(col*w,row*h,(col+1)*w,(row+1)*h);assert data['original'].crop(box).tobytes()==data['image'].crop(box).tobytes()
 data['meta']['animations'][sheet]['sha256']=sha(png);meta=D/'pose-batches'/data['metaPath'].name;meta.write_text(json.dumps(data['meta'],indent=2)+'\n');savefile(data['source'],png);savefile(data['metaPath'],meta)
 # Replace only the two existing hash tokens in this animation object.
 oldhash=clip['sha256'];oldmeta=clip['packingMetadataSha256'];frameText=frameText.replace(oldhash,sha(png),1).replace(oldmeta,sha(meta),1)
newLeaf=leafText
if args.receiving_leaf=='auxiliary':newLeaf=localreplace(newLeaf,originalProfiles,profiles)
else:
 for before,after in zip(originalPoses,poses):
  if before!=after:newLeaf=localreplace(newLeaf,before,after)
p=D/'frames.json';p.write_text(frameText);savefile(framesPath,p);p=D/leaf.name;p.write_text(newLeaf);savefile(leaf,p)
assert all(sha(p)==h for p,h in sourceCheckpoints.items()), 'Source changed before final candidate receipt'
(D/'candidate.json').write_text(json.dumps({'state':'actual-saved-body-and-receiving-review-pending','changes':changes,'installFiles':files,'unchanged':'Original sprite pixels outside authorized local mask, all other cells and receiving rows, roots, scales, clocks, source windows, source radii, damage and input conditions'},indent=2)+'\n')
print(json.dumps({'files':len(files),'cells':len(changes),'reviewDirectory':str(D)}))
