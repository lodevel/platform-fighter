"""Stage reviewed paw bitmap only; source clock/root/all receiving stay exact."""
from pathlib import Path
import json,hashlib
import numpy as np
from PIL import Image
ROOT=Path(__file__).resolve().parent.parent;B=ROOT/'docs/review/2026-10-06/pikachu-character/art/completion-states-local-floor';D=B/'staged';A=ROOT/'assets/characters/pikachu'
for p in [D,D/'originals']:p.mkdir(exist_ok=True)
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();checks={};files=[]
def read(p):
 data=p.read_bytes();checks[p]=hashlib.sha256(data).hexdigest();return data
def save(live,candidate):
 assert sha(live)==checks[live],'Live source changed while staging'
 backup=D/'originals'/(checks[live]+'-'+live.name)
 if not backup.exists():backup.write_bytes(live.read_bytes())
 files.append({'live':str(live.relative_to(ROOT)),'priorSha256':checks[live],'priorBackup':str(backup.relative_to(ROOT)),'candidate':str(candidate.relative_to(ROOT)),'candidateSha256':sha(candidate)})
key='full-completion-states-local-floor-trip-ledge-source0';prep=next(r for r in json.loads((B/'full-pilot-preparation.json').read_text())['records'] if r['key']==key);out=next(r for r in json.loads((B/'full-generation-ledger.json').read_text()) if r['pose_key']==key and r['state']=='accepted');assert out.get('actual_visual_review')
framesPath=A/'frames.json';text=read(framesPath).decode();frames=json.loads(text);sheets={}
for cellIndex,c in enumerate(prep['cells']):
 clip=frames['animations'][c['sheet']];source=ROOT/c['source'];assert sha(source)==c['sourceSha256']
 if c['sheet'] not in sheets:
  read(source);original=Image.open(source).convert('RGBA');metaPath=ROOT/clip['packingMetadata'];sheets[c['sheet']]={'source':source,'original':original,'image':original.copy(),'metaPath':metaPath,'meta':json.loads(read(metaPath)),'indices':set()}
 data=sheets[c['sheet']];col,row=clip['sourceCells'][c['artFrameIndex']];w,h=clip['frameWidth'],clip['frameHeight'];cellPath=B/(key+f'-packed-cell{cellIndex}.png');cell=Image.open(cellPath).convert('RGBA');old=data['original'].crop((col*w,row*h,(col+1)*w,(row+1)*h));assert hashlib.sha256(old.tobytes()).hexdigest()==c['sourceCellRGBAsha256'];allowed=np.zeros((h,w),bool);left,top,right,bottom=c['authorizedRectangle'];allowed[top:bottom,left:right]=True;assert np.array_equal(np.asarray(old)[~allowed],np.asarray(cell)[~allowed]);assert not np.any(np.asarray(cell.getchannel('A'))[417:bottom,left:right]>=32)
 data['image'].paste(cell,(col*w,row*h));data['indices'].add(c['artFrameIndex']);data['meta']['sources'][c['artFrameIndex']]['authoredGeometryAdaptation']={'kind':'tiny supported underside flex','originalArtBand':c['originalArtBand'],'targetArtBand':c['targetArtBand'],'authorizedRectangle':c['authorizedRectangle'],'actualRuntimeRequest':c['actualRuntimeRequest'],'actualRuntimeRequestSha256':c['actualRuntimeRequestSha256'],'sourceReceivingUnchanged':True,'validHangingTailExact':bool(c.get('preserveValidHangingTail')),'rootClockSourcePathsExact':True,'output':out['outputs']['cutout']}
for sheet,data in sheets.items():
 clip=frames['animations'][sheet];w,h=clip['frameWidth'],clip['frameHeight']
 for i,(column,line) in enumerate(clip['sourceCells']):
  if i in data['indices']:continue
  box=(column*w,line*h,(column+1)*w,(line+1)*h);assert data['image'].crop(box).tobytes()==data['original'].crop(box).tobytes()
 png=D/(sheet+'.png');data['image'].save(png);save(data['source'],png);data['meta']['animations'][sheet]['sha256']=sha(png);p=D/data['metaPath'].name;p.write_text(json.dumps(data['meta'],indent=2)+'\n');save(data['metaPath'],p);text=text.replace(clip['sha256'],sha(png),1).replace(clip['packingMetadataSha256'],sha(p),1)
candidateFrames=json.loads(text)
for sheet,prior in frames['animations'].items():assert {k:v for k,v in prior.items() if k not in ['sha256','packingMetadataSha256']}=={k:v for k,v in candidateFrames['animations'][sheet].items() if k not in ['sha256','packingMetadataSha256']}
p=D/'frames.json';p.write_text(text);save(framesPath,p)
assert all(sha(p)==h for p,h in checks.items())
(D/'candidate.json').write_text(json.dumps({'state':'actual_saved_local_paw_bitmap_review_pending','installFiles':files,'changes':prep['cells'],'sourceReceivingChanged':False,'validHangingTailExact':True,'runtimeQualified':False,'actualReview':out['actual_visual_review']},indent=2)+'\n');print(json.dumps({'files':len(files),'cells':len(prep['cells']),'candidate':str(D/'candidate.json')}))
