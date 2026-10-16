"""Guarded approved FX-only merge; no851 body points or geometry installed."""
from pathlib import Path
import json,hashlib,shutil,os,copy
A=Path('docs/review/2026-10-12/link-character/rework/art');S=A/'final-fx-exact-cells-staged-v1';D=S/'guarded-install-v1';D.mkdir(exist_ok=True)
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
index=json.load(open(S/'index.json'));facts=Path('src/finalSmash/finalFxCueFacts.json');assert sha(facts)==index['sourceCueFactsSha256'];cues=json.load(open(facts))['cues'];receipts=[]
for actor in ['donkeykong','pikachu']:
 target=Path('assets/characters')/actor;frames=target/'frames.json';before_hash=sha(frames);before=json.load(open(frames));old=copy.deepcopy(before);proposal=json.load(open(S/actor/'metadata-merge-proposal.json'));profiles=proposal['finalFxProfiles']['profiles'];expected={r['key']for r in cues if r['fighter']==actor};assert set(profiles)==expected
 assert 'runtimeFinalFxProfiles'not in before or not before['runtimeFinalFxProfiles']['profiles'];assert not(set(proposal['animations'])&set(before['animations']))
 for cue in (r for r in cues if r['fighter']==actor):
  p=profiles[cue['key']];assert p['cueKey']==cue['key']and p['authoredSourceIdentity']['recipeId']==cue['source']['effectName'];assert p['originX']==p['originY']==.5
  recipe=index['pages'];page=next(r for r in recipe if r['sheet']==p['sheet']);assert sha(page['recipe'])==page['recipeSha256']==p['authoredSourceIdentity']['sha256'];assert p['frameWidth']==p['frameHeight']==256
  assert [d['frameIndex']for d in p['drawings']]==list(range(page['drawingCount']));assert p['endAgeExclusive']==page['drawingCount']
  for i,d in enumerate(p['drawings']):assert d['startAge']==i and d['endAgeExclusive']==i+1
  assert p['loopFrames']==(page['drawingCount']if cue['clockDomain']=='run-flight'or cue['selection']['lifetimeFrames']>page['drawingCount']else None)
 backup=D/(actor+'-original-frames.json');assert not backup.exists();shutil.copyfile(frames,backup)
 for page in (p for p in index['pages']if p['actor']==actor):
  assert sha(page['path'])==page['sha256'];destination=target/'animations'/Path(page['path']).name;assert not destination.exists();shutil.copyfile(page['path'],destination);assert sha(destination)==page['sha256']
  animation=proposal['animations'][page['sheet']];animation['sha256']=page['sha256'];before['animations'][page['sheet']]=animation
 before['runtimeFinalFxProfiles']=proposal['finalFxProfiles']
 # Complete old root keys and every old animation remain exactly equal.
 assert all(before[k]==v for k,v in old.items()if k!='animations')
 assert all(before['animations'][k]==v for k,v in old['animations'].items())
 assert sha(frames)==before_hash;temporary=D/(actor+'-new-frames.json');temporary.write_text(json.dumps(before,indent=2)+'\n');shutil.copyfile(temporary,target/'frames.json.fx-stage');os.replace(target/'frames.json.fx-stage',frames)
 receipts.append({'actor':actor,'originalFramesSha256':before_hash,'installedFramesSha256':sha(frames),'oldFramesBackup':str(backup),'sourceCueProfiles':len(profiles),'newPages':len(proposal['animations']),'oldCompleteRootPropertiesAndAnimationsExactlyPreserved':True,'851SourceEffectPointPosesInstalled':False})
(D/'installation-receipt.json').write_text(json.dumps({'state':'SCOPED_APPROVED_FX_ONLY_GUARDED_INSTALL_COMPLETE_FINAL_BODY_SUPPORT_POINTS_RUNTIME_PENDING','sourceCueFactsSha256':sha(facts),'sourceStageIndex':str(S/'index.json'),'sourceStageIndexSha256':sha(S/'index.json'),'receipts':receipts,'addedDecodedRgbaBytes':sum(p['decodedRgbaBytes']for p in index['pages']),'gameChecksRun':False},indent=2)+'\n')
print(json.dumps(receipts,indent=2))
