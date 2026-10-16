"""Actual unheld Item visibility flag equivalence; no item entity is rendered.

Controller TRUE is separate from external entity existence. Only exact unheld
gear-owner rows are admitted; captured normal FALSE callbacks stay untouched.
"""
from pathlib import Path
import sys,json,hashlib,fcntl
sys.path[:0]=['/tmp/pikachu-source-libs','tools']
import numpy as np
from PIL import Image
import link_normal_equipment_guide_v1 as normal
A=Path('docs/review/2026-10-12/link-character/rework/art');D=A/'unheld-item-visible-flag-equivalence-v1';D.mkdir(exist_ok=True)
REVIEW=A/'normal-exclusive-equipment-745-corrected-review-v2/index.json';STAGE=A/'first745-airborne-staged-v1'
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
review_before=REVIEW.read_bytes();review=json.loads(review_before);rep=next(r for r in review['rows']if r['resource']=='a03jumpaerialb'and r['nativeSample']==0)
before_prefix=rep['derivativeSourceRecord'].removesuffix('.json');prefix=D/'a03jumpaerialb-raw0-unheld-true'
normal.EQUIPMENT={**normal.EQUIPMENT,'heldItemVisible':True}
with open('/mnt/c/workspace/platform-fighter/.tmp/dk-heavy.lock','a')as lock:
 fcntl.flock(lock,fcntl.LOCK_SH);normal.render(rep['sourceRecord'],prefix);fcntl.flock(lock,fcntl.LOCK_UN)
for suffix in ['-source.png','-object-ids.png','-semantic-ids.png','-material-ids.png']:
 a=np.array(Image.open(before_prefix+suffix));b=np.array(Image.open(str(prefix)+suffix));assert np.array_equal(a,b),suffix
for suffix in ['-source-depth.npz','-uv-correspondence.npz']:
 a=np.load(before_prefix+suffix);b=np.load(str(prefix)+suffix);assert a.files==b.files
 for name in a.files:assert np.array_equal(a[name],b[name]),(suffix,name)
old=json.load(open(rep['derivativeSourceRecord']));new=json.load(open(str(prefix)+'.json'))
for key in ['sourceRigAnchors','capturedTrans','artRoot','artCanvas','artPixelsPerNativeUnit','motion','nativeFrameIndex','visiblePrefixes','objectIds']:assert old[key]==new[key],key
assert old['equipmentOverride']['equipmentContext']['heldItemVisible']is False and new['equipmentOverride']['equipmentContext']['heldItemVisible']is True
resources={'a00wait1','a01walkmiddle','b02escapen','c05attackairb'}|{r['resource']for r in review['rows']if not r['alreadyInstalled']}
affected=[r for r in review['rows']if r['resource']in resources];assert len(affected)==461
receipt={'state':'ACTUAL_UNHELD_TRUE_FLAG_SAME_SOURCE_RGBA_OBJECT_SEMANTIC_MATERIAL_DEPTH_UV_ANCHORS_ROOT_CLOCK',
 'pilotSource':rep['sourceRecord'],'pilotOldSelectedSource':rep['derivativeSourceRecord'],'pilotNewSelectedSource':str(prefix)+'.json',
 'operator':str(Path(__file__)),'operatorSha256':sha(__file__),'sameGraphicalOperatorSha256':sha('tools/link_normal_equipment_guide_v1.py'),
 'qualifiedInputDifference':{'heldItemVisible':[False,True]},'actualUnheldEntityRequired':True,
 'reason':'The body guide renders intrinsic body/Sword/Shield meshes only. Actual unheld state has no external held item entity in either flag state. The heldItemVisible boolean is serialized context; it is not consulted by this graphical pass. Flag TRUE remains the real controller baseline, while six captured normal callbacks retain FALSE. No inventory/item absence is inferred solely from this flag.',
 'scope':{'trueFlagUnheldRows':461,'capturedFalseCallbackRows':284,'total':745,'resources':sorted(resources)},
 'limits':'Only actualunheld live-owner admission. Does not qualify visibility/equipment pixels for an existing external held entity, grip overlay, temporary pickup or intrinsic article. Original false-labeled input/projection receipts remain historical; packed pixels and physicalfits unchanged.',
 'allPilotCurrentPixelAndPhysicalInputsChangedPixels':0,'gameChecksRun':False,'shippingAssetsChanged':False}
rp=D/'qualification.json';rp.write_text(json.dumps(receipt,indent=2)+'\n');proof_sha=sha(rp)
(D/'review.before.json').write_bytes(review_before)
for r in affected:
 r['effectiveEquipmentContext']['heldItemVisible']=True
 r['unheldVisibleFlagEquivalence']={'path':str(rp),'sha256':proof_sha,'actualUnheldEntityRequired':True}
review['unheldVisibilityFlagQualification']={'path':str(rp),'sha256':proof_sha};REVIEW.write_text(json.dumps(review,indent=2)+'\n')
# Transport/pixels and all432 existing profiles/outgoing/alias entries are unchanged.
frames=STAGE/'frames.json';original=frames.read_bytes();(D/'staged-frames.before.json').write_bytes(original);f=json.loads(original)
count=0
for r in f['runtimeEquipmentBindings']['rows']:
 if r['basePose']['body']['motion']in resources:
  r['basePose']['equipmentContext']['heldItemVisible']=True;r['proof']['equipmentContext']['heldItemVisible']=True;count+=1
 r['proof']['artifactSha256']=sha(REVIEW)
assert count==461
frames.write_text(json.dumps(f,indent=2)+'\n');p=STAGE/'index.json';index=json.load(open(p));(D/'staged-index.before.json').write_bytes(p.read_bytes())
index['framesSha256']=sha(frames);index['sourceAccepted745ReviewSha256']=sha(REVIEW);index['unheldVisibilityFlagQualification']={'path':str(rp),'sha256':proof_sha}
index['transportPixelBytesUnchangedByContextQualification']=True;p.write_text(json.dumps(index,indent=2)+'\n')
print('461TRUE/284FALSE',sha(frames),'qualification',proof_sha,flush=True)
