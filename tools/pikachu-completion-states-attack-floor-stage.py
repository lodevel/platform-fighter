"""Guarded three first-drawing fringes; receiving/clocks/root remain exact."""
from pathlib import Path
import copy,json,hashlib
import numpy as np
from PIL import Image,ImageDraw,ImageFilter
ROOT=Path(__file__).resolve().parent.parent
B=ROOT/'docs/review/2026-10-06/pikachu-character/art/completion-states-crouch-floor'
D=B/'staged-attacks';D.mkdir(exist_ok=True);(D/'originals').mkdir(exist_ok=True)
A=ROOT/'assets/characters/pikachu';sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
key='full-completion-states-crouch-floor-uniform-attack0-source0'
job=next(r for r in json.loads((B/'full-pilot-preparation.json').read_text())['records'] if r['key']==key)
out=next(r for r in json.loads((B/'full-generation-ledger.json').read_text()) if r['pose_key']==key and r['state']=='accepted')
atlas=B/out['outputs']['cutout']['file'];assert sha(atlas)==out['outputs']['cutout']['sha256'];generated=Image.open(atlas).convert('RGBA')
framesPath=A/'frames.json';text=framesPath.read_text();frames=json.loads(text);changes=[];files=[];metas={}
def save(live,candidate):
 backup=D/'originals'/(sha(live)+'-'+live.name)
 if not backup.exists():backup.write_bytes(live.read_bytes())
 files.append({'live':str(live.relative_to(ROOT)),'priorSha256':sha(live),'priorBackup':str(backup.relative_to(ROOT)),'candidate':str(candidate.relative_to(ROOT)),'candidateSha256':sha(candidate)})
for entry in job['cells']:
 sheet=entry['sheet'];index=entry['artFrameIndex'];clip=frames['animations'][sheet];source=ROOT/entry['source'];assert sha(source)==entry['sourceSha256'];original=Image.open(source).convert('RGBA');image=original.copy();w,h=clip['frameWidth'],clip['frameHeight'];col,row=clip['sourceCells'][index];pos=(col*w,row*h);old=original.crop((*pos,pos[0]+w,pos[1]+h));x,y=entry['offset'];new=generated.crop((x,y,x+1024,y+1280)).resize((512,640),Image.Resampling.LANCZOS);assert not new.crop((0,h,512,640)).getchannel('A').point(lambda a:255 if a>=32 else 0).getbbox();new=new.crop((0,0,w,h))
 first=entry['adaptation']['originalArtBand'][0];region=np.asarray(old.getchannel('A'))>0;region[:first-4]=False;allowed=np.asarray(Image.fromarray(region.astype('uint8')*255).filter(ImageFilter.MaxFilter(7)))>0;packed=Image.fromarray(np.where(allowed[:,:,None],np.asarray(new),np.asarray(old)).astype('uint8'));assert np.array_equal(np.asarray(packed)[~allowed],np.asarray(old)[~allowed]);bounds=packed.getchannel('A').point(lambda a:255 if a>=32 else 0).getbbox();assert bounds[3]-1<=clip['root'][1];image.paste(packed,pos)
 for i,(c,r) in enumerate(clip['sourceCells']):
  if i==index:continue
  box=(c*w,r*h,(c+1)*w,(r+1)*h);assert image.crop(box).tobytes()==original.crop(box).tobytes()
 png=D/(sheet+'.png');image.save(png);save(source,png);oldhash=clip['sha256'];text=text.replace(oldhash,sha(png),1)
 metaPath=ROOT/clip['packingMetadata']
 if metaPath not in metas:metas[metaPath]=json.loads(metaPath.read_text())
 meta=metas[metaPath];meta['animations'][sheet]['sha256']=sha(png)
 action={'dsmash':'down-smash','dtilt':'down-tilt','jab':'jab'}[sheet];sourceRow=next(r for r in meta['sources'] if r['action']==action);sourceRow['authoredGeometryAdaptation']={'kind':entry['adaptation'],'job':key,'output':str(atlas.relative_to(ROOT)),'outputSha256':sha(atlas),'affectedArtFrame':index,'root':clip['root'],'sourceReceivingUnchanged':True,'unaffectedPixelsExact':True,'betaArtOnly':True}
 record={'sheet':sheet,'artFrameIndex':index,'root':clip['root'],'alpha32Bounds':bounds,'alpha32BelowFootWorldPx':(bounds[3]-.5-clip['root'][1])*clip['scaleToWorld'],'originalCellSha256':hashlib.sha256(old.tobytes()).hexdigest(),'candidateCellSha256':hashlib.sha256(packed.tobytes()).hexdigest(),'changedPixels':int(np.count_nonzero(np.any(np.asarray(old)!=np.asarray(packed),axis=2))),'protectedPixelChanges':0,'receivingChanged':False,'adaptation':entry['adaptation']};changes.append(record)
 review=Image.new('RGBA',(1024,420),'#e4e3df')
 for j,body in enumerate([old,packed]):
  panel=Image.new('RGBA',body.size,'#e4e3df');panel.alpha_composite(body);draw=ImageDraw.Draw(panel);draw.line((0,clip['root'][1],w,clip['root'][1]),fill='red');review.alpha_composite(panel,(j*512,30));ImageDraw.Draw(review).text((j*512+8,8),sheet+' first source drawing '+['previous','corrected'][j],fill='black')
 review.save(D/(sheet+'-registered-body-review.png'))
for live,meta in metas.items():
 candidate=D/live.name;candidate.write_text(json.dumps(meta,indent=2)+'\n');save(live,candidate);text=text.replace(sha(live),sha(candidate))
newFrames=json.loads(text)
for sheet,clip in frames['animations'].items():
 new=newFrames['animations'][sheet];assert {k:v for k,v in new.items() if k not in ['sha256','packingMetadataSha256']}=={k:v for k,v in clip.items() if k not in ['sha256','packingMetadataSha256']}
p=D/'frames.json';p.write_text(text);save(framesPath,p)
(D/'candidate.json').write_text(json.dumps({'state':'saved_actual_body_review_pending','changes':changes,'installFiles':files,'limits':['Receiving source regions and all gameplay/root/clocks preserved exactly.','Shared packing metadata hash references change together; other sheet body pixels remain exact.','Historical atlas repack receipt is retained as previous evidence; current sheet hash identifies corrected bitmap.','Actual match qualification remains pending.']},indent=2)+'\n')
print(json.dumps({'files':len(files),'cells':len(changes),'directory':str(D)}))
