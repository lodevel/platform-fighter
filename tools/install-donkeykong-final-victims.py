"""Add the inspected authored Jungle recipient profiles without replacing art."""
from pathlib import Path
import json,hashlib,shutil,os
ROOT=Path(__file__).resolve().parents[1];E=ROOT/'docs/review/2026-10-15/donkeykong-final';STAGE=E/'victim-art-staging'
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
index=json.loads((STAGE/'index.json').read_text());receipts=[]
for actor in ['pikachu','donkeykong','link']:
 directory=STAGE/actor;proposal=json.loads((directory/'metadata-proposal.json').read_text());target=ROOT/'assets/characters'/actor;frames=target/'frames.json';original_bytes=frames.read_bytes();bank=json.loads(original_bytes);original=json.loads(original_bytes)
 registry=proposal['runtimeFinalVictimProfiles'];assert registry['targetFighter']==actor and len(registry['profiles'])==4
 for sheet,clip in proposal['animations'].items():
  profile=registry['profiles'][sheet];source=directory/clip['strip'];dest=target/clip['strip'];row=next(r for r in index['rows']if r['actor']==actor and r['sheet']==sheet)
  assert sha(ROOT/row['recipe'])==row['recipeSha256']==profile['authoredSourceIdentity']['sha256']
  assert sha(source)==clip['sha256'];assert all(d['nativeSample']is None for d in profile['drawings'])
  assert all(d['captureSupport']is None and d['receiving']and any(a['role']=='capture-anchor'for a in d['attachments'])for d in profile['drawings'])
  if sheet in bank['animations']:assert bank['animations'][sheet]==clip
  if dest.exists():assert sha(dest)==sha(source)
  else:shutil.copyfile(source,dest)
  bank['animations'][sheet]=clip
 existing=bank.get('runtimeFinalVictimProfiles',{'schema':'authored-final-victim-profiles/1','targetFighter':actor,'profiles':{}})
 assert existing['schema']==registry['schema']and existing['targetFighter']==actor
 for key,value in registry['profiles'].items():
  if key in existing['profiles']:assert existing['profiles'][key]==value
  existing['profiles'][key]=value
 bank['runtimeFinalVictimProfiles']=existing
 assert all(bank['animations'][k]==v for k,v in original['animations'].items())
 assert all(bank[k]==v for k,v in original.items()if k not in ['animations','runtimeFinalVictimProfiles'])
 assert frames.read_bytes()==original_bytes,'Concurrent frame-bank edit: retry against actual current bank'
 staged=target/'frames.json.jungle-victim-stage';staged.write_text(json.dumps(bank,indent=2)+'\n');os.replace(staged,frames)
 receipts.append({'actor':actor,'beforeFramesSha256':hashlib.sha256(original_bytes).hexdigest(),'afterFramesSha256':sha(frames),'addedProfiles':list(registry['profiles']),'allEarlierClipsPreserved':True})
(E/'victim-install.json').write_text(json.dumps({'schema':'jungle-recipient-install/1','sourceIndexSha256':sha(STAGE/'index.json'),'drawings':index['drawings'],'receipts':receipts,'runtimeVerified':False},indent=2)+'\n');print(json.dumps(receipts))
