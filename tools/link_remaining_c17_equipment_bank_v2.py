"""Bounded1097 C drawings:514 needed gear corrections,583 exact reuse.

Persistent guide/decoded-input caches, immutable per-cell physical input guards;
no complete anatomy projection or completed receiving fit is repeated.
"""
from pathlib import Path
import sys,json,hashlib,sqlite3,os,time,tempfile,subprocess,traceback
sys.path[:0]=['tools','/tmp/pikachu-source-libs']
import numpy as np
from PIL import Image
from link_immutable_input_stage_v1 import ImmutableInputs,atomic_json,publish_cell
from link_selected_c_equipment_guide_v2 import render
from link_part_owned_equipment_v3 import apply
A=Path('docs/review/2026-10-12/link-character/rework/art');Q=A/'remaining-normal17-exclusive-equipment-context-v1'
D=A/'remaining-c17-selected-equipment-bank-v2';D.mkdir(exist_ok=True)
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
def physical_objects(m):return [r for r in m['rendered'] if not r['mesh'].startswith(('link_ken','link_tate'))]
def actual_visibility(m):
    meshes=[v['mesh']for v in m['objectIds'].values()]
    return {p:any(n.startswith(p+'_VIS')for n in meshes) for p in ['link_ken','link_kenb','link_tate','link_tateb']}
def memory():return {l.split(':')[0]:int(l.split()[1]) for l in Path('/proc/self/status').read_text().splitlines() if l.startswith(('VmRSS:','VmHWM:'))}
def make_plan():
    assert not (D/'plan.json').exists()
    demand_path=A.parent/'runtime/normal-landing17-stock-gear-demand-v2.json';assert sha(demand_path)=='76881299655d6faa00289da8d3a0c6abbaa7228958c94d265c8a0f0735137d92'
    demand=json.load(open(demand_path));qualification=Q/'seven-physical-pilots-qualification.json';qual=json.load(open(qualification));assert len(qual['rows'])==7 and all(r['all14MaskChangedPixels']==r['knownFaceChangedPixels']==0 for r in qual['rows'])
    guards=dict(json.load(open(A/'ordinary-physical-corpus-fit-v1/plan.json'))['inputHashes'])
    for p in [Path(__file__),Path('tools/link_normal_equipment_guide_v1.py'),Path('tools/link_selected_c_equipment_guide_v2.py'),Path('tools/link_selected_c_physical_qualification_v2.py'),Path('tools/qualify_link_selected_c_physical_reuse_v2.py'),Path('tools/link_part_owned_equipment_v3.py'),Path('tools/link_immutable_input_stage_v1.py'),demand_path,qualification,
              A/'ordinary-physical-corpus-review-v1/art-twelve-attacks-holds-70-panels-776-body-head-review.json',A/'ordinary-physical-corpus-review-v1/coordinator-five-landings-28-panels-320-body-head-review.json',A/'targeted-uair-native14-v1/art-actual-native14-body-head-sharp-review.json']:
        guards[str(p)]=sha(p)
    rows=[];groups=[]
    for g in demand['resources']:
        admitted=sorted(g['rows'],key=lambda r:r['nativeSample']);groups.append({'id':g['id'],'resource':g['resource'],'motion':g['motion'],'samples':[r['nativeSample']for r in admitted],'source':g['source']})
        for i,r in enumerate(admitted):
            assert len(r['variants'])==1 and sha(r['sourcePhysicalJournal'])==r['sourcePhysicalJournalSha256'];original=json.load(open(r['sourcePhysicalJournal']));m=json.load(open(original['sourceRecord']));variant=r['variants'][0];ctx=variant['equipmentContext'];visible=actual_visibility(m);selected={'link_ken':ctx['sword']=='normal','link_kenb':ctx['sword']=='back','link_tate':ctx['shield']=='normal','link_tateb':ctx['shield']=='back'}
            rows.append({'key':g['resource']+'-raw'+str(r['nativeSample']),'resource':g['resource'],'nativeSample':r['nativeSample'],'sourcePhysicalJournal':r['sourcePhysicalJournal'],'sourcePhysicalJournalSha256':r['sourcePhysicalJournalSha256'],'originalGeometry':original,'sourceRecord':original['sourceRecord'],'sourceRecordSha256':original['sourceRecordSha256'],'previousCell':original['packedCell'],'previousCellSha256':original['packedCellSha256'],'sourceSampleInterval':[r['nativeSample'],admitted[i+1]['nativeSample']if i+1<len(admitted)else r['nativeSample']+1],'equipmentContext':ctx,'gearOwner':variant['gearOwner'],'clockWitnesses':variant['clockWitnesses'],'rawActuallyRenderedVisibility':visible,'selectedVisibility':selected,'needsSelectedGearDerivative':visible!=selected})
    assert len(rows)==1097 and len({r['key']for r in rows})==1097
    assert sum(r['needsSelectedGearDerivative']for r in rows)==514
    for p,h in guards.items():assert sha(p)==h,('FROZEN_INPUT_CHANGED',p)
    plan={'state':'NEW_FROZEN1097_SOURCE_SELECTED_C_GEAR_DERIVATIVES','rows':rows,'groups':groups,'drawingCount':1097,'changedDrawings':514,'exactPixelReuses':583,'inputHashes':guards,'qualifiedSevenPilotReceipt':str(qualification),'qualifiedSevenPilotReceiptSha256':sha(qualification),'demand':str(demand_path),'demandSha256':sha(demand_path),'scope':'Stock unheld NONE/Bowhidden, actual separate SCRIPT/pose clocks. Other Lab timing, held HAND or ownBACKBow contexts remain dependencies.','packing':'Union original crop with actual selected valid gear alpha; sourceROOT retained; transparent right/bottom top-left padding only. No body recenter or geometry refit.','gameChecksRun':False}
    atomic_json(D/'plan.json',plan);db=Path('/tmp')/('link-c17-equipment-'+sha(D/'plan.json')[:16]+'.sqlite');assert not db.exists();c=sqlite3.connect(db);c.execute('CREATE TABLE jobs(key TEXT PRIMARY KEY,ordinal INTEGER,state TEXT,worker INTEGER,journal TEXT,sha TEXT)')
    for i,r in enumerate(rows):c.execute('INSERT INTO jobs VALUES(?,?,?,?,?,?)',(r['key'],i,'PENDING',None,None,None))
    c.commit();atomic_json(D/'queue.json',{'database':str(db),'planSha256':sha(D/'plan.json')});print('FROZEN1097 /514derivatives /583exactreuses',flush=True)
def main():
    if sys.argv[1]=='plan':make_plan();return
    worker=int(sys.argv[1]);W=D/f'worker-{worker:02}';W.mkdir(exist_ok=True);assert not(W/'run.json').exists();plan=json.load(open(D/'plan.json'));q=json.load(open(D/'queue.json'));assert sha(D/'plan.json')==q['planSha256'];memo=ImmutableInputs(plan['inputHashes'],plan['inputHashes']);memo.install();rows={r['key']:r for r in plan['rows']};c=sqlite3.connect(q['database'],timeout=60);linux=Path(tempfile.mkdtemp(prefix='link-c17-selected-'+str(worker)+'-'));done=[];start=time.perf_counter();atomic_json(W/'run.json',{'pid':os.getpid(),'worker':worker,'planSha256':q['planSha256'],'linuxDirectory':str(linux),'memoryKiB':memory(),'numericThreads':{k:os.environ.get(k)for k in ['OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS']}})
    try:
        while True:
            c.execute('BEGIN IMMEDIATE');job=c.execute("SELECT key FROM jobs WHERE state='PENDING' ORDER BY ordinal LIMIT 1").fetchone()
            if not job:c.commit();break
            key=job[0];c.execute("UPDATE jobs SET state='RUNNING',worker=? WHERE key=?",(worker,key));c.commit();r=rows[key];old=r['originalGeometry'];t=time.perf_counter();atomic_json(W/'current.json',{'pid':os.getpid(),'key':key,'completed':len(done),'memoryKiB':memory()})
            assert sha(r['sourcePhysicalJournal'])==r['sourcePhysicalJournalSha256'] and sha(r['sourceRecord'])==r['sourceRecordSha256'] and sha(r['previousCell'])==r['previousCellSha256'];m=json.load(open(r['sourceRecord']));old_prefix=old['projectionProvenance'].removesuffix('-physical-region-provenance.json');physical_hashes={}
            for rr in range(1,15):
                path=old_prefix+f'-physical-region-{rr}.png';physical_hashes[path]=sha(path)
            face=old_prefix+'-physical-face-source.png';face_hash=sha(face)
            result={**r,'qualifiedRetainedPhysical14Masks':physical_hashes,'retainedKnownFaceRGBA':face,'retainedKnownFaceRGBASha256':face_hash,'receiving':old['receiving'],'headContact':old['headContact'],'sourceRootAndGeometryUnchanged':True,'receivingFitRerun':False,'physicalProjectionRerun':False,'physicalReuseQualification':plan['qualifiedSevenPilotReceiptSha256'],'supportRetargetY':0,'gameChecksRun':False}
            if not r['needsSelectedGearDerivative']:
                result.update(cell=r['previousCell'],cellSha256=r['previousCellSha256'],actualPackingCrop=old['crop'],registeredRootPixel=[old['originX']*Image.open(r['previousCell']).width,old['originY']*Image.open(r['previousCell']).height],reuse='EXACT_ORIGINAL_SELECTED_EQUIPMENT_PIXEL_BYTES')
            else:
                prefix=linux/key;new=render(r['sourceRecord'],prefix,r['equipmentContext'])
                for field in ['nativeFrameIndex','sourceRigAnchors','capturedTrans','artRoot','artCanvas','artPixelsPerNativeUnit','scenePixelsPerNativeUnit','motion','helperPreviewTargets','authoredTextureHashes']:
                    assert m[field]==new[field],('PHYSICAL_INPUT_CHANGED',key,field)
                assert physical_objects(m)==physical_objects(new),('NONGEAR_OBJECT_INPUT_CHANGED',key)
                assert actual_visibility(new)==r['selectedVisibility'],('SELECTED_GEAR_NOT_EXCLUSIVE',key)
                final=Path(str(prefix)+'-final.png');subprocess.run(['python3',str('tools/link-cel-style.py'),str(prefix),str(final)],check=True,stdout=subprocess.DEVNULL)
                rgba=np.array(Image.open(final).convert('RGBA'));revised=apply(rgba,np.array(Image.open(str(prefix)+'-object-ids.png')),np.array(Image.open(str(prefix)+'-semantic-ids.png')),new);assert np.array_equal(rgba[:,:,3],revised[:,:,3]);Image.fromarray(revised).save(final)
                for suffix,field in [('-final-authoring.json','targetSHA'),('-final.json','outputSha256')]:
                    path=Path(str(prefix)+suffix);metadata=json.load(open(path));metadata[field]=sha(final);metadata['selectedGearOnlyRGBOperator']={'path':'tools/link_part_owned_equipment_v3.py','sha256':sha('tools/link_part_owned_equipment_v3.py')};atomic_json(path,metadata)
                sharp=Image.fromarray(revised).resize((revised.shape[1]//2,revised.shape[0]//2),Image.Resampling.LANCZOS);yy,xx=np.where(np.array(sharp)[:,:,3]>0);old_crop=old['crop'];crop=[min(old_crop[0],max(0,int(xx.min())-2)),min(old_crop[1],max(0,int(yy.min())-2)),max(old_crop[2],min(sharp.width,int(xx.max())+3)),max(old_crop[3],min(sharp.height,int(yy.max())+3))];cell=sharp.crop(crop);cp=Path(str(prefix)+'-sharp.png');cell.save(cp);root=np.array(m['artRoot'],float)/2-np.array(crop[:2]);oldroot=np.array([old['originX']*Image.open(r['previousCell']).width,old['originY']*Image.open(r['previousCell']).height]);assert np.allclose(root-oldroot,np.array(old_crop[:2])-np.array(crop[:2]),rtol=0,atol=1e-10),'SOURCE_ROOT_CROP_REGISTRATION_CHANGED'
                publication=publish_cell(prefix,W/key);result.update(cell=str(W/key)+'-sharp.png',cellSha256=sha(str(W/key)+'-sharp.png'),derivativeSourceRecord=str(W/key)+'.json',derivativeSourceRecordSha256=sha(str(W/key)+'.json'),actualPackingCrop=crop,registeredRootPixel=root.tolist(),originalPackingCrop=old_crop,sourceAll38AnchorsHeadHelperRootClockExact=True,allNonGearPhysicalInputsExact=True,publication=publication,visualReview='PENDING_ACTUAL_CURRENT_SELECTED_GEAR_PIXELS')
            for path,h in physical_hashes.items():assert sha(path)==h,('RETAINED_PHYSICAL_CHANGED',key,path)
            assert sha(face)==face_hash and sha(r['sourceRecord'])==r['sourceRecordSha256'];jp=W/(key+'-selected.json');atomic_json(jp,result);entry={'key':key,'resource':r['resource'],'nativeSample':r['nativeSample'],'journal':str(jp),'sha256':sha(jp),'changed':r['needsSelectedGearDerivative'],'seconds':time.perf_counter()-t};c.execute("UPDATE jobs SET state='DONE',journal=?,sha=? WHERE key=? AND worker=?",(str(jp),entry['sha256'],key,worker));c.commit();done.append(entry);atomic_json(W/'index.json',{'rows':done,'gameChecksRun':False});atomic_json(W/'progress.json',{'pid':os.getpid(),'completed':len(done),'seconds':time.perf_counter()-start,'last':key,'memoryKiB':memory()});print(key,'changed'if r['needsSelectedGearDerivative']else'reuse',round(entry['seconds'],3),flush=True)
        memo.verify();atomic_json(W/'terminal.json',{'pid':os.getpid(),'state':'ALL_PRIVATE_CLAIMED_EQUIPMENT_ROWS_COMMITTED_INPUTS_UNCHANGED','count':len(done),'seconds':time.perf_counter()-start,'memoryKiB':memory(),'gameChecksRun':False})
    except BaseException:
        atomic_json(W/'failure.json',{'pid':os.getpid(),'key':key if 'key'in locals()else None,'committed':len(done),'traceback':traceback.format_exc(),'retainedOriginalBanksUnchanged':True});raise
if __name__=='__main__':main()
