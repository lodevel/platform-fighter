"""Frozen selective V7 repairs; exact passing WORLD chains are retained.

Dynamic private SQLite claims and an exact mask/union/config local-chain cache.
Original851 ledger/journals are preserved; eight newly completed held rows are
reported through this derivative bank rather than rewriting original evidence.
"""
from pathlib import Path
import sys, json, hashlib, sqlite3, time, os, fcntl, traceback
sys.path[:0]=['tools','/tmp/pikachu-source-libs']
import numpy as np
from PIL import Image
from link_immutable_input_stage_v1 import atomic_json
from fit_anatomical_capsule_chain_v7_score_distance import fit
from final_dk_selective_crown_audit_v3 import within
from fit_anatomical_capsule_envelope_v1 import expanded_mask, capsule_coverage

A=Path('docs/review/2026-10-12/link-character/rework/art')
D=A/'final-dk-selective-crown-repair-v3'
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
arr_sha=lambda a:hashlib.sha256(np.ascontiguousarray(a).tobytes()).hexdigest()
def memory():return {l.split(':')[0]:int(l.split()[1]) for l in Path('/proc/self/status').read_text().splitlines() if l.startswith(('VmRSS:','VmHWM:'))}

def main():
    if sys.argv[1]=='plan':
        audit=json.load(open(D/'plan.json'))
        pins={str(p):sha(p) for p in [D/'plan.json',Path(__file__),Path('tools/final_dk_selective_crown_audit_v3.py'),
              Path('tools/fit_anatomical_capsule_chain_v7_score_distance.py'),Path('tools/fit_anatomical_capsule_envelope_v1.py')]}
        writer={'auditPlan':str(D/'plan.json'),'auditPlanSha256':sha(D/'plan.json'),'inputHashes':pins,
                'operatorSha256':pins['tools/fit_anatomical_capsule_chain_v7_score_distance.py'],
                'numericThreads':1,'gameChecksRun':False,'rows':521,'partFits':audit['refitParts'],
                'localChainCacheKey':'Exact boolean part bytes + wholephysicalunion bytes + dimensions + margin + pinned operator/config; WORLD/root/support never part of local cached chain.'}
        assert not (D/'writer-plan.json').exists();atomic_json(D/'writer-plan.json',writer)
        db=Path('/tmp')/('final-dk-crown-v3-'+sha(D/'writer-plan.json')[:16]+'.sqlite');assert not db.exists()
        c=sqlite3.connect(db);c.execute('CREATE TABLE jobs(key TEXT PRIMARY KEY, ordinal INTEGER, state TEXT, worker INTEGER, journal TEXT, sha TEXT)')
        for i,r in enumerate(sorted(audit['rows'],key=lambda r:(r['oldJournal'] is not None,r['key']))):c.execute('INSERT INTO jobs VALUES(?,?,?,?,?,?)',(r['key'],i,'PENDING',None,None,None))
        c.commit();atomic_json(D/'writer-queue.json',{'database':str(db),'writerPlanSha256':sha(D/'writer-plan.json')});print(db);return
    worker=int(sys.argv[1]);W=D/f'worker-{worker:02}';W.mkdir(exist_ok=True);assert not (W/'run.json').exists()
    writer=json.load(open(D/'writer-plan.json'));q=json.load(open(D/'writer-queue.json'));assert sha(D/'writer-plan.json')==q['writerPlanSha256']
    for p,h in writer['inputHashes'].items():assert sha(p)==h,(p,'FROZEN_WRITER_CHANGED')
    audit=json.load(open(writer['auditPlan']));rows={r['key']:r for r in audit['rows']};c=sqlite3.connect(q['database'],timeout=60)
    cache_dir=Path('/tmp')/('final-dk-crown-local-cache-'+q['writerPlanSha256'][:16]);cache_dir.mkdir(exist_ok=True)
    start=time.perf_counter();completed=[];failures=[];atomic_json(W/'run.json',{'pid':os.getpid(),'worker':worker,'state':'FROZEN_SELECTIVE_PART_REPAIR_RUNNING','writerPlanSha256':q['writerPlanSha256'],'memoryKiB':memory()})
    while True:
        c.execute('BEGIN IMMEDIATE');job=c.execute("SELECT key FROM jobs WHERE state='PENDING' ORDER BY ordinal LIMIT 1").fetchone()
        if not job:c.commit();break
        key=job[0];c.execute("UPDATE jobs SET state='RUNNING',worker=? WHERE key=?",(worker,key));c.commit();r=rows[key];source=r['sourceRow'];scale=source['scaleToWorld'];root=np.array(r['newRootPixel']);t=time.perf_counter();cpu=time.process_time()
        atomic_json(W/'current.json',{'key':key,'pid':os.getpid(),'completed':len(completed),'memoryKiB':memory()})
        try:
            for p,h in r['frozenProjectionInputs'].items():assert sha(p)==h,(p,'FROZEN_PROJECTION_CHANGED')
            assert sha(source['sourceRecord'])==source['sourceRecordSha256'] and sha(source['cell'])==source['cellSha256']
            if r['oldJournal']:assert sha(r['oldJournal'])==r['oldJournalSha256']
            assert sha(r['physicalUnion'])==r['physicalUnionSha256'];union=np.array(Image.open(r['physicalUnion']))>0;assert arr_sha(union)==r['physicalUnionBytesSha256']
            allowed=expanded_mask(union,1/scale);receiving=[];parts=[];fit_wall=fit_cpu=0;cache_hits=0
            for p in r['parts']:
                rr=p['regionId'];name=p['part'];region='head' if rr==15 else 'torso' if rr in (1,2,16) else 'foot' if rr in (11,14) else 'leg' if rr in (9,10,12,13) else 'arm'
                if not p['surfacePixels']:parts.append({'part':name,'surfacePixels':0,'state':'NO_PROJECTED_ACTUAL_SURFACE'});continue
                if not p['requiresFit']:
                    # Geometry itself remains exactly the original stored WORLD values.
                    receiving.extend(p['oldWORLDPrimitives']);parts.append({'part':name,'runtimeRegion':region,'proof':{'surfacePixels':p['surfacePixels'],'capsules':len(p['oldWORLDPrimitives']),'uncoveredSurfacePixels':0,'capsulesOutsideDeclaredPhysicalUnionMargin':0,'declaredEuclideanMarginPixels':1/scale,'algorithm':'Exact existing WORLD chain re-proved against unchanged part and smaller actual anatomy union.'},'reuse':'EXACT_PASSING_WORLD_CHAIN','maskBytesSha256':p['maskBytesSha256'],'unionBytesSha256':r['physicalUnionBytesSha256']});continue
                assert sha(p['mask'])==p['maskSha256'];mask=np.array(Image.open(p['mask']))>0;assert arr_sha(mask)==p['maskBytesSha256'] and mask.shape==union.shape
                cache_key=hashlib.sha256(json.dumps([p['maskBytesSha256'],r['physicalUnionBytesSha256'],r['dimensions'],1/scale,writer['operatorSha256'],32*1024*1024],separators=(',',':')).encode()).hexdigest();cp=cache_dir/(cache_key+'.json');ft=time.perf_counter();fc=time.process_time()
                with open(cache_dir/(cache_key+'.lock'),'a') as lock:
                    fcntl.flock(lock,fcntl.LOCK_EX)
                    if cp.exists():cached=json.load(open(cp));chain=[(np.array(a),np.array(b),radius) for a,b,radius in cached['chain']];proof=cached['proof'];cache_hits+=1
                    else:
                        chain,proof=fit(mask,union,1/scale);atomic_json(cp,{'key':cache_key,'chain':[(a.tolist(),b.tolist(),radius) for a,b,radius in chain],'proof':proof,'operatorSha256':writer['operatorSha256']})
                    fcntl.flock(lock,fcntl.LOCK_UN)
                fit_wall+=time.perf_counter()-ft;fit_cpu+=time.process_time()-fc
                yy,xx=np.where(mask);points=np.c_[xx,yy].astype(float);covered=np.zeros(len(points),bool)
                for i,(a,b,radius) in enumerate(chain):
                    assert within(a,b,radius,allowed),(key,name,'NEW_CHAIN_OUTSIDE_ALLOWED_UNION');covered|=capsule_coverage(points,a,b,radius)
                    receiving.append({'id':name+'-'+str(i),'region':region,'start':dict(zip(('x','y'),((a-root)*scale).tolist())),'end':dict(zip(('x','y'),((b-root)*scale).tolist())),'radius':float(radius*scale)})
                assert covered.all(),(key,name,'NEW_CHAIN_MISSING_PART_PIXELS')
                parts.append({'part':name,'runtimeRegion':region,'proof':proof,'reuse':'NEW_PINNED_V7_PART_ONLY','localFitCacheKey':cache_key,'maskBytesSha256':p['maskBytesSha256'],'unionBytesSha256':r['physicalUnionBytesSha256']})
            assert len({p['id'] for p in receiving})==len(receiving)
            row={**source,'receiving':receiving,'parts':parts,'headContact':{'point':r['headContactWorld'],'reviewKey':audit['recipeSha256']+':'+key},'cranialRecipe':audit['recipe'],'cranialRecipeSha256':audit['recipeSha256'],'actualHeadMatrix':r['actualHeadMatrix'],'capturedTrans':r['capturedTrans'],'sourceRoot':r['newRootPixel'],'supportRetargetY':0,'supportState':'SOURCE_ROOT_UNSHIFTED_SUPPORT_FIT_PENDING','sourceReferenceChangedPixels':0,'projection':r['projection'],'projectionSha256':r['projectionSha256'],'originalJournal':r['oldJournal'],'originalJournalSha256':r['oldJournalSha256'],'selectiveRepairAuditPlanSha256':writer['auditPlanSha256'],'unchangedPartWORLDGeometryCount':sum(len(p['oldWORLDPrimitives']) for p in r['parts'] if not p['requiresFit']),'refittedPartCount':sum(p['requiresFit'] for p in r['parts']),'bodyRGBAUnchanged':True,'actual16MasksUnchanged':True,'authoredCraniumSubsetOfKnownHead':True,'fitViewportQualification':{'registeredSourceRootBefore':source['knownRootAfterExactReductionCrop'],'registeredSourceRootAfter':r['newRootPixel'],'integerRegistrationOffsetPixels':[r['fitViewportPadding']]*2,'dimensions':r['dimensions'],'fittingOnlyTransparentPadding':True,'originalWORLDRegistrationUnchanged':True},'projectionTiming':{'wallSeconds':0,'cpuSeconds':0,'exactRetainedProjectionReuse':True},'fittingTiming':{'wallSeconds':fit_wall,'cpuSeconds':fit_cpu,'cacheHits':cache_hits,'memoryKiB':memory()},'gameChecksRun':False,'precision':'Approved anatomy-bound DK crown, exact discrete actual part coverage and capsule union+1WORLD margin. Selective affected-part repair only; no native collision or runtime approval.'}
            jp=W/(key+'-fit.json');atomic_json(jp,row);entry={'key':key,'journal':str(jp),'sha256':sha(jp),'refittedParts':row['refittedPartCount'],'reusedWORLDPrimitives':row['unchangedPartWORLDGeometryCount'],'fittingTiming':row['fittingTiming'],'totalWallSeconds':time.perf_counter()-t,'totalCPUSeconds':time.process_time()-cpu};c.execute("UPDATE jobs SET state='DONE',journal=?,sha=? WHERE key=? AND worker=?",(str(jp),entry['sha256'],key,worker));c.commit();completed.append(entry)
        except AssertionError:
            failure=W/(key+'-failure.json');atomic_json(failure,{'key':key,'pid':os.getpid(),'traceback':traceback.format_exc(),'allOriginalEvidencePreserved':True});failures.append({'key':key,'failure':str(failure)});c.execute("UPDATE jobs SET state='REJECTED' WHERE key=? AND worker=?",(key,worker));c.commit();raise
        atomic_json(W/'index.json',{'rows':completed,'failures':failures,'gameChecksRun':False});atomic_json(W/'progress.json',{'pid':os.getpid(),'completed':len(completed),'failures':len(failures),'seconds':time.perf_counter()-start,'memoryKiB':memory(),'last':key});print(key,row['refittedPartCount'],'partfits',round(time.perf_counter()-t,3),flush=True)
    for p,h in writer['inputHashes'].items():assert sha(p)==h,(p,'FROZEN_WRITER_CHANGED_AT_END')
    atomic_json(W/'terminal.json',{'pid':os.getpid(),'state':'ALL_PRIVATE_SELECTIVE_REPAIRS_COMMITTED_INPUTS_UNCHANGED','completed':len(completed),'failures':len(failures),'seconds':time.perf_counter()-start,'memoryKiB':memory(),'gameChecksRun':False})

if __name__=='__main__':main()
