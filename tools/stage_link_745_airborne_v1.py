"""Coherent745 private stage: original432 untouched plus accepted313 airborne.

No gameplay checks, installed writes, refits, recentering or floor support snap.
Runtime specialist owns complete canonical lossless encoding and installation.
"""
from pathlib import Path
import json,hashlib,copy,math,shutil
import numpy as np
from PIL import Image
A=Path('docs/review/2026-10-12/link-character/rework/art');D=A/'first745-airborne-staged-v1';D.mkdir(exist_ok=True)
F=Path('assets/characters/link/frames.json');REVIEW=A/'normal-exclusive-equipment-745-corrected-review-v2/index.json'
CLOCK=A/'locomotion-airborne-next-review-v1/coordinator-all313-body-head-review-and-clock-selection.json'
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
before=F.read_bytes();before_sha=hashlib.sha256(before).hexdigest();assert before_sha=='60749fc0e887e6f3f5eeb44655decb008fe8f627b8bd3808a59c912257d48d18'
original=json.loads(before);f=copy.deepcopy(original);f.pop('runtimeTextureSources')
review=json.load(open(REVIEW));assert review['state'].startswith('COORDINATOR_SCOPED745')
clock=json.load(open(CLOCK));clocks={r['resource']:r for r in clock['clockSelection']}
fit_path=A/'ordinary-physical-corpus-fit-v1/completion-receipt.json';fit=json.load(open(fit_path));refs={(r['resource'],r['nativeSample']):r for r in fit['rows']}
pages=[]
for sheet,c in f['animations'].items():
 src=F.parent/c['strip'];dest=D/c['strip'];dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(src,dest)
 assert sha(src)==sha(dest)
 pages.append({'sheet':sheet,'path':str(dest),'sha256':sha(dest),'copiedExisting':True,'frameCount':c['frameCount'],
               'dimensions':list(Image.open(dest).size)})
assert sum(len(p['drawings'])for p in f['runtimeBodyProfiles'].values())==432
aliases={'a03jumpaerialb':'jump_aerial_b','a03jumpaerialf':'jump_aerial_f','a03jumpb':'jump_b','a03jumpf':'jump_f',
 'a04fall':'fall','a04fallaerial':'fall_aerial','a04fallaerialb':'fall_aerial_b','a04fallaerialf':'fall_aerial_f',
 'a04fallb':'fall_b','a04fallf':'fall_f','a04fallspecial':'fall_special','a04fallspecialb':'fall_special_b','a04fallspecialf':'fall_special_f','b02escapeair':'escape_air'}
summary=[];registrations={};maximum_residual=0.
for resource,selection in clocks.items():
 assert resource not in f['runtimeBodyProfiles']
 chosen=[r for r in review['rows']if r['resource']==resource];rows=[]
 for r in chosen:
  ref=refs[(resource,r['nativeSample'])];assert sha(ref['journal'])==ref['sha256'];b=json.load(open(ref['journal']))
  assert sha(r['cell'])==r['cellSha256'];assert sha(b['sourceRecord'])==b['sourceRecordSha256']==r['sourceRecordSha256']
  assert b['uniformSupportRetargetY']==0 and b['receiving']==r['unchangedGeometry']['receiving'] and b['headContact']==r['unchangedGeometry']['headContact']
  im=Image.open(r['cell']).convert('RGBA');assert list(im.size)==r['cellDimensions'];old=Image.open(b['packedCell'])
  root=[b['originX']*old.width,b['originY']*old.height];m=json.load(open(b['sourceRecord']));trans=np.array(m['capturedTrans'])
  assert np.max(np.abs(np.asarray(root)-np.asarray([m['artRoot'][0]/2-b['crop'][0],m['artRoot'][1]/2-b['crop'][1]])))<1e-10
  def joint(name):
   v=np.asarray(m['sourceRigAnchors'][name])[:3,3]-trans;return {'x':float(5*v[2]),'y':float(-5*v[1])}
  p,q=joint('Sword1'),joint('Sword2');angle=math.degrees(math.atan2(q['y']-p['y'],q['x']-p['x']))
  attachments=[{'role':'sword','point':joint('HaveR'),'angleDegrees':angle},{'role':'waist','point':joint('Waist')}]
  rows.append({'nativeSample':r['nativeSample'],'frameIndex':b['logicalArtFrameIndex'],'receiving':b['receiving'],'headContact':b['headContact'],
    'attachments':attachments,'passiveShield':[],'bakedArticles':[],'sourcePixel':r['cell'],'sourcePixelSha256':r['cellSha256'],
    'rootPixel':root,'scaleToWorld':b['scaleToWorld'],'sourceIdentity':b['sourceIdentity'],'sourceRecord':b['sourceRecord'],
    'sourceRecordSha256':b['sourceRecordSha256'],'capturedTrans':m['capturedTrans'],'uniformSupportRetargetY':0.,
    'receivingAuthoringReviewKey':ref['sha256'],'width':im.width,'height':im.height,'gearOwner':r['gearOwner'],
    'equipmentContext':r['effectiveEquipmentContext'],'gearReviewArtifactSha256':sha(REVIEW)})
 rows.sort(key=lambda r:r['frameIndex']);assert [r['frameIndex']for r in rows]==list(range(len(rows)))
 assert rows[0]['nativeSample']==0 and rows[-1]['nativeSample']==selection['capturedFinalIndex']
 width=max(r['width']for r in rows);height=max(r['height']for r in rows);columns=max(1,1024//width);capacity=columns*max(1,1024//height)
 drawings=[];resource_pages=[]
 for start in range(0,len(rows),capacity):
  group=rows[start:start+capacity];cols=min(columns,len(group));dimensions=[cols*width,math.ceil(len(group)/cols)*height]
  assert max(dimensions)<=1024 and dimensions[0]*dimensions[1]*4<=8*1024**2
  atlas=Image.new('RGBA',tuple(dimensions));sheet=resource if start==0 else resource+'__airborne745_p'+str(start//capacity)
  for i,r in enumerate(group):
   image=Image.open(r['sourcePixel']).convert('RGBA');xy=((i%cols)*width,(i//cols)*height);atlas.paste(image,xy)
   copied=atlas.crop((xy[0],xy[1],xy[0]+image.width,xy[1]+image.height));assert np.array_equal(np.array(image),np.array(copied))
   r['render']={'sheet':sheet,'frameIndex':i};fi=r['frameIndex'];next_age=rows[fi+1]['nativeSample']if fi+1<len(rows)else r['nativeSample']+1
   origin=[r['rootPixel'][0]/width,r['rootPixel'][1]/height]
   residual=max(abs(origin[0]*width-r['rootPixel'][0]),abs(origin[1]*height-r['rootPixel'][1]));assert residual<1e-10;maximum_residual=max(maximum_residual,residual)
   drawings.append({k:r[k]for k in ['frameIndex','nativeSample','receiving','headContact','attachments','passiveShield','bakedArticles','render','receivingAuthoringReviewKey']}|
                   {'startAge':r['nativeSample'],'endAgeExclusive':next_age,'originX':origin[0],'originY':origin[1]})
  strip=f'animations/airborne313-v1/{sheet}.png';path=D/strip;path.parent.mkdir(parents=True,exist_ok=True);atlas.save(path)
  f['animations'][sheet]={'strip':strip,'frameWidth':width,'frameHeight':height,'frameCount':len(group),'sourceDrawingCount':len(rows)if start==0 else len(group),'fps':60,'loop':False}
  entry={'sheet':sheet,'path':str(path),'sha256':sha(path),'dimensions':dimensions,'rgba8Bytes':dimensions[0]*dimensions[1]*4,'frameCount':len(group)}
  pages.append(entry);resource_pages.append(entry)
 f['runtimeBodyProfiles'][resource]={'sheet':resource,'coordinateOrigin':'actorSourceRoot','sourceSampleBasis':'zero-based-native-index',
  'sourceIdentity':{'resource':resource,'sha256':rows[0]['sourceIdentity']['sha256']},'frameWidth':width,'frameHeight':height,'scaleToWorld':rows[0]['scaleToWorld'],
  'bodyCentreFromRootY':-36,'endAgeExclusive':drawings[-1]['endAgeExclusive'],'loopFrames':selection['loopFrames'],'drawings':drawings,
  'rootDelta':[{'x':0.,'y':0.}],'rootPolicy':'in-place','nativeDeclaredLoop':selection['sourceDeclaredLoop']}
 for alias in [aliases[resource],'link.'+aliases[resource]]:assert alias not in f['runtimeBodyProfileAliases'];f['runtimeBodyProfileAliases'][alias]=resource
 registrations[resource]=rows;folder=D/resource;folder.mkdir(exist_ok=True);rp=folder/'registration.json'
 rp.write_text(json.dumps({'rows':rows,'pages':resource_pages,'sourceClockSelection':selection,'loopPrecision':'Explicitcoordinatorchosen nativefinalindex span; enddrawingretained. Directionalaerialseam andnativecommonfirsttick/rate remainunrecovered authoredloopadapter.',
  'rootPolicy':'In-place/rootDelta0, actualactorphysics owns movement. NativecapturedTrans strippedonce and retainedas sourceevidence; no floorsnap/supportfit.'},indent=2)+'\n')
 summary.append({'resource':resource,'drawingCount':len(rows),'pageCount':len(resource_pages),'registration':str(rp),'registrationSha256':sha(rp)})
 print(resource,len(rows),len(resource_pages),flush=True)
# Bind all745 genuinely reviewed unheld contexts to the same actual source drawing.
bindings=[]
for r in review['rows']:
 profile=f['runtimeBodyProfiles'][r['resource']];drawing=next(x for x in profile['drawings']if x['nativeSample']==r['nativeSample'])
 base={'kind':'whole-body','body':{'motion':r['resource'],'rawNativeSample':r['nativeSample'],'sourceResourceSha256':profile['sourceIdentity']['sha256']},'equipmentContext':r['effectiveEquipmentContext']}
 bindings.append({'overlayMotion':None,'basePose':base,'gearOwner':r['gearOwner'],'bindingProofKey':r['cellSha256']+':'+review['coordinatorChanged184Review']['sha256'],
  'kind':'baked-equivalent','proof':{'artifactSha256':sha(REVIEW),'type':'actual-baked-equipment-context','equipmentContext':r['effectiveEquipmentContext']}})
assert len(bindings)==745
f['runtimeEquipmentBindings']={'schema':'link-equipment-bindings/1','rows':bindings}
for resource,p in original['runtimeBodyProfiles'].items():assert f['runtimeBodyProfiles'][resource]==p
assert f['runtimeOutgoingPoses']==original['runtimeOutgoingPoses']
for k,v in original['animations'].items():assert f['animations'][k]==v
for k,v in original['runtimeBodyProfileAliases'].items():assert f['runtimeBodyProfileAliases'][k]==v
assert sum(len(p['drawings'])for p in f['runtimeBodyProfiles'].values())==745
f['installedBodyResourceCount']=24;f['completionState']='PARTIAL745_CURRENT_BODY_HEAD_UNHELD_EQUIPMENT_CONTEXT_ACCEPTED_RUNTIME_UNVERIFIED'
(D/'frames.before.json').write_bytes(before);(D/'frames.json').write_text(json.dumps(f,indent=2)+'\n')
assert F.read_bytes()==before
index={'state':'STAGED745_24_RESOURCES_COMPLETE_MATCHING_ENCODED_MANIFEST_REQUIRED','beforeSha256':before_sha,'frames':str(D/'frames.json'),'framesSha256':sha(D/'frames.json'),
 'sourceAccepted745Review':str(REVIEW),'sourceAccepted745ReviewSha256':sha(REVIEW),'sourceAirborneClock':str(CLOCK),'sourceAirborneClockSha256':sha(CLOCK),
 'resources':summary,'pages':pages,'pageCount':len(pages),'newDrawingCount':313,'preservedDrawingCount':432,'gearBindings':745,
 'original432ProfileOutgoingAnimationMetadataExactlyPreserved':True,'allOriginal145PNGPageBytesExactlyPreserved':True,'maximumNewRootPixelResidual':maximum_residual,
 'externalBow':'Onlyhidden bodyBow contextbound; validexisting externalBowarticle ownership requires separatelyreviewed ownmodel art/socket/profile, no fakebodyBowspawning or backlease inferred',
 'gameChecksRun':False,'shippingAssetsChanged':False,'operatorSha256':sha(__file__)}
(D/'index.json').write_text(json.dumps(index,indent=2)+'\n');print('STAGED745',len(pages),sha(D/'frames.json'),flush=True)
