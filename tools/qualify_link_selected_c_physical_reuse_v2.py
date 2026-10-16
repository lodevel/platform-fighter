"""Seven actual C contexts: exact retained masks/face, no receiving refit."""
from pathlib import Path
import sys,json,hashlib,time,subprocess,os
sys.path[:0]=['tools','/tmp/pikachu-source-libs']
import numpy as np
from PIL import Image
from link_selected_c_equipment_guide_v2 import render
from link_selected_c_physical_qualification_v2 import project
from link_part_owned_equipment_v3 import apply
from link_immutable_input_stage_v1 import atomic_json,ImmutableInputs
A=Path('docs/review/2026-10-12/link-character/rework/art');D=A/'remaining-normal17-exclusive-equipment-context-v1';D.mkdir(exist_ok=True)
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
demand_path=A.parent/'runtime/normal-landing17-stock-gear-demand-v1.json';demand=json.load(open(demand_path));by={(g['resource'],r['nativeSample']):r for g in demand['resources']for r in g['rows']}
pilots=[('c04attackhi4',24),('c04attacklw4charge',18),('c05landingairb',8),('c05landingairn',0),('c05attackairhi',2),('c03attacks4s',38),('c05attackairlw',75)]
guards=dict(json.load(open(A/'ordinary-physical-corpus-fit-v1/plan.json'))['inputHashes'])
for p in [Path(__file__),Path('tools/link_selected_c_equipment_guide_v2.py'),Path('tools/link_selected_c_physical_qualification_v2.py'),Path('tools/link_normal_equipment_guide_v1.py'),Path('tools/link_part_owned_equipment_v3.py'),demand_path]:guards[str(p)]=sha(p)
memo=ImmutableInputs(guards,guards);memo.install();rows=[]
for resource,native in pilots:
    item=by[(resource,native)];assert len(item['variants'])==1;variant=item['variants'][0];assert sha(item['sourcePhysicalJournal'])==item['sourcePhysicalJournalSha256'];old=json.load(open(item['sourcePhysicalJournal']));m=json.load(open(old['sourceRecord']));prefix=D/(resource+'-raw'+str(native)+'-pilot');t=time.perf_counter();new=render(old['sourceRecord'],prefix,variant['equipmentContext']);new_record=str(prefix)+'.json'
    for k in ['nativeFrameIndex','sourceRigAnchors','capturedTrans','artRoot','artCanvas','artPixelsPerNativeUnit','scenePixelsPerNativeUnit','motion','helperPreviewTargets','authoredTextureHashes']:
        assert m[k]==new[k],(resource,native,k)
    def physical_objects(record):return [r for r in record['rendered'] if not r['mesh'].startswith(('link_ken','link_tate'))]
    assert physical_objects(m)==physical_objects(new)
    final=Path(str(prefix)+'-final.png');subprocess.run(['python3',str('tools/link-cel-style.py'),str(prefix),str(final)],check=True,stdout=subprocess.DEVNULL)
    rgba=np.array(Image.open(final).convert('RGBA'));corrected=apply(rgba,np.array(Image.open(str(prefix)+'-object-ids.png')),np.array(Image.open(str(prefix)+'-semantic-ids.png')),new);assert np.array_equal(rgba[:,:,3],corrected[:,:,3]);Image.fromarray(corrected).save(str(prefix)+'-selected-rgb.png')
    pp=Path(str(prefix)+'-physical');project(new_record,pp);old_pp=old['projectionProvenance'].removesuffix('-physical-region-provenance.json');mask_guards={}
    for rr in range(1,15):
        before=old_pp+f'-physical-region-{rr}.png';after=str(pp)+f'-physical-region-{rr}.png';assert np.array_equal(np.array(Image.open(before)),np.array(Image.open(after))),(resource,native,rr)
        mask_guards[before]=sha(before)
    face_before=old_pp+'-physical-face-source.png';face_after=str(pp)+'-physical-face-source.png';assert np.array_equal(np.array(Image.open(face_before).convert('RGBA')),np.array(Image.open(face_after).convert('RGBA'))),(resource,native,'KNOWN_FACE_RGBA_CHANGED')
    rows.append({'resource':resource,'nativeSample':native,'equipmentContext':variant['equipmentContext'],'gearOwner':variant['gearOwner'],'sourcePhysicalJournal':item['sourcePhysicalJournal'],'sourcePhysicalJournalSha256':item['sourcePhysicalJournalSha256'],'sourceRecord':old['sourceRecord'],'sourceRecordSha256':old['sourceRecordSha256'],'selectedSourceRecord':new_record,'selectedSourceRecordSha256':sha(new_record),'all14MaskChangedPixels':0,'retainedPhysicalMaskHashes':mask_guards,'knownFaceChangedPixels':0,'retainedKnownFaceRGBA':face_before,'retainedKnownFaceRGBASha256':sha(face_before),'sameAll38AnchorsHeadRootCanvasClockHelperAndTextureInputs':True,'sameAllNonGearRenderedObjects':True,'physicalPartVisibilityProof':'Changed Sword/Shield meshes are metal equipment excluded from all physical14/knownface selection; independently self-depth physical inputs unchanged. HAND/sourcepose/composition inputs are outside this proof.','seconds':time.perf_counter()-t})
    print(resource,native,'all14+knownFace exact',flush=True)
memo.verify();atomic_json(D/'seven-physical-pilots-qualification.json',{'state':'ALL7_ACTUAL_SELECTED_C_CONTEXT_PHYSICAL_INPUTS_EXACT','rows':rows,'inputHashes':guards,'receivingAndHeadFitRerun':False,'perCellReuseRequires':'Exact source record SHA/native tuple/38anchors/Head/root/canvas/helper/equipment-excluded nongear objects + all retained14masks/face hashes and identical physical projection operators. New HAND or composition cannot use this proof.','gameChecksRun':False})
