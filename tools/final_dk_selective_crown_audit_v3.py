"""Re-prove existing DK chains under the approved anatomy-bounded crown.

No source projection, body render or successful original journal is changed.
Only failing part chains receive new frozen fit inputs; passing WORLD primitives
remain byte-equivalent JSON values. Eight previously held poses have no chain.
"""
from pathlib import Path
import sys, json, hashlib, sqlite3, time, os
sys.path[:0] = ['tools', '/tmp/pikachu-source-libs']
import numpy as np
from PIL import Image, ImageDraw
from fit_anatomical_capsule_envelope_v1 import expanded_mask, capsule_coverage
from link_immutable_input_stage_v1 import atomic_json

A = Path('docs/review/2026-10-12/link-character/rework/art')
O = A/'final-actor-851-physical-fit-v1'
V = A/'final-dk-anatomy-bounded-crown-fourteen-v3'
D = A/'final-dk-selective-crown-repair-v3'
sha = lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()
array_sha = lambda a: hashlib.sha256(np.ascontiguousarray(a).tobytes()).hexdigest()

def hull(points):
    points = sorted(set(map(tuple, points)))
    def half(seq):
        out = []
        for p in seq:
            while len(out) >= 2:
                a, b = out[-2:]
                if (b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]) > 0: break
                out.pop()
            out.append(p)
        return out
    return half(points)[:-1]+half(points[::-1])[:-1]

def within(a, b, radius, allowed):
    h, w = allowed.shape
    lo = np.floor(np.minimum(a,b)-radius).astype(int)
    hi = np.ceil(np.maximum(a,b)+radius).astype(int)
    if (lo < 0).any() or hi[0] >= w or hi[1] >= h: return False
    yy,xx = np.mgrid[lo[1]:hi[1]+1,lo[0]:hi[0]+1]
    points = np.c_[xx.ravel(),yy.ravel()]
    inside = capsule_coverage(points,a,b,radius)
    return not np.any(inside & ~allowed[points[:,1],points[:,0]])

def main():
    D.mkdir(exist_ok=True)
    assert not (D/'plan.json').exists(), 'Existing frozen audit must not be replaced'
    start = time.perf_counter(); cpu = time.process_time()
    plan = json.load(open(O/'plan.json')); q = json.load(open(O/'queue.json'))
    con = sqlite3.connect(q['database'])
    jobs = {key:{'state':state,'journal':journal,'sha256':digest} for key,state,journal,digest
            in con.execute('SELECT key,state,journal,sha FROM jobs')}
    review = V/'coordinator-fourteen-bounded-scalp-review.json'
    assert sha(review) == '20107b95c50ceba989cb765133925a3ba1d85ee76c1f8b08e97c366d2f37f7f4'
    recipe_path = V/'donkeykong-known-scalp-bounded-recipe.json'
    recipe = json.load(open(recipe_path)); gate_recipe = recipe['braincaseSelectionGate']
    guards = {str(p):sha(p) for p in [Path(__file__),O/'plan.json',O/'queue.json',review,recipe_path,
              Path('tools/fit_anatomical_capsule_chain_v7_score_distance.py'),
              A.parent/'performance/compact-physical-operator-audit-v1/scores-v7/qualification.json']}
    assert guards['tools/fit_anatomical_capsule_chain_v7_score_distance.py'] == '53aa6a7f80ae748ca1a879a9ed27983478381f6223e33ffe402e27f41e19165b'
    refs = json.load(open(A/'final-target-part-six-hair-v2/index.json'))['rows']
    prefixes = {r['actor']+'-'+r['motion']+'-raw'+str(r['nativeSample']):Path(r['prefix']) for r in refs}
    for base in [O,A/'final-actor-851-physical-fit-recovery-v2',V]:
        for p in base.rglob('*-part-projection.json'):
            key=p.name.removesuffix('-part-projection.json')
            prefixes.setdefault(key,Path(str(p).removesuffix('-part-projection.json')))
    tt,pp=np.meshgrid(np.linspace(0,2*np.pi,161),np.linspace(0,np.pi,81))
    unit=np.stack([np.cos(pp),np.sin(pp)*np.cos(tt),np.sin(pp)*np.sin(tt)],-1).reshape(-1,3)
    local=unit*np.array(gate_recipe['radii'])+np.array(gate_recipe['centre'])
    rows=[]
    for r in plan['rows']:
        if r['actor'] != 'donkeykong': continue
        key=r['key']; job=jobs[key]; old=None
        if job['state']=='DONE':
            assert sha(job['journal'])==job['sha256']; old=json.load(open(job['journal']))
            guards[job['journal']]=job['sha256']
        else: assert job['state'] in ['PENDING','FAILED_GUARDED'], job
        assert sha(r['sourceRecord'])==r['sourceRecordSha256'] and sha(r['cell'])==r['cellSha256']
        prefix=prefixes[key]; projection_path=Path(str(prefix)+'-part-projection.json')
        projection=json.load(open(projection_path))
        assert projection['physicalBackend']=='exact-original-python-raster-hair-exclusion'
        input_hashes={str(projection_path):sha(projection_path)}
        crop=r['crop2x']; cell=Image.open(r['cell']); scale=r['scaleToWorld']
        pad=int(np.ceil(1/scale))+2; offset=np.array([pad,pad])
        root=np.array(r['knownRootAfterExactReductionCrop'])+offset
        rect=(crop[0]-pad,crop[1]-pad,crop[0]+cell.width+pad,crop[1]+cell.height+pad)
        masks={}
        for rr in range(1,17):
            p=Path(str(prefix)+f'-physical-region-{rr}.png'); input_hashes[str(p)]=sha(p)
            raw=Image.open(p); reduced=raw.resize((raw.width//2,raw.height//2),Image.Resampling.NEAREST)
            masks[rr]=np.array(reduced.crop(rect))>0
            yy,xx=np.where(np.array(reduced)>0)
            if len(xx):
                assert xx.min()>=rect[0] and xx.max()<rect[2] and yy.min()>=rect[1] and yy.max()<rect[3], ('KNOWN_MASK_CLIP',key,rr)
        m=json.load(open(r['sourceRecord'])); head=np.array(m['bone_matrices']['Head'])
        trans=np.array(m['captured_trans_translation'])
        if old and 'actualHeadMatrix' in old:
            assert np.array_equal(head,np.array(old['actualHeadMatrix'])) and np.array_equal(trans,np.array(old['capturedTrans']))
        world=(np.c_[local,np.ones(len(local))]@head.T)[:,:3]-trans
        pixels=root+np.c_[world[:,2]*5,-world[:,1]*5]/scale
        gate=Image.new('L',(masks[15].shape[1],masks[15].shape[0]));ImageDraw.Draw(gate).polygon(hull(pixels),fill=255)
        bounded=masks[15] & (np.array(gate)>0); yy,xx=np.where(bounded); assert len(xx), ('EMPTY_BRAINCASE',key)
        top=int(yy.min()); top_x=xx[yy==top]; x=float(top_x[np.argmin(np.abs(top_x-top_x.mean()))])
        contact=(np.array([x,float(top)])-root)*scale
        union=np.logical_or.reduce(list(masks.values())); allowed=expanded_mask(union,1/scale)
        folder=D/key; folder.mkdir(exist_ok=True)
        union_path=folder/'physical-union.png'; Image.fromarray(union.astype('uint8')*255).save(union_path)
        part_rows=[]
        for rr,mask in masks.items():
            name=projection['regions'].get(str(rr),projection['regions'].get(rr))
            caps=[c for c in old['receiving'] if c['id'].startswith(name+'-')] if old else []
            yy,xx=np.where(mask); points=np.c_[xx,yy].astype(float); covered=np.zeros(len(points),bool); failures=[]
            for i,c in enumerate(caps):
                a=np.array([c['start']['x'],c['start']['y']])/scale+root
                b=np.array([c['end']['x'],c['end']['y']])/scale+root; radius=c['radius']/scale
                if not within(a,b,radius,allowed): failures.append(i)
                covered |= capsule_coverage(points,a,b,radius)
            missing=int((~covered).sum()); needs=bool(len(points) and (not old or failures or missing))
            part={'regionId':rr,'part':name,'surfacePixels':len(points),'maskBytesSha256':array_sha(mask),
                  'oldWORLDPrimitives':caps,'oldPrimitiveCount':len(caps),'outsidePrimitiveIndices':failures,
                  'uncoveredKnownPixels':missing,'requiresFit':needs,
                  'reuse':'EXACT_PASSING_OLD_WORLD_CHAIN_REPROVED' if old and not needs else 'NEW_REQUIRED_PART_CHAIN'}
            if needs:
                path=folder/f'part-{rr}.png';Image.fromarray(mask.astype('uint8')*255).save(path)
                part.update(mask=str(path),maskSha256=sha(path))
            part_rows.append(part)
        rows.append({'sourceRow':r,'key':key,'oldJournal':job['journal'],'oldJournalSha256':job['sha256'],
             'originalState':job['state'],'projection':str(projection_path),'projectionSha256':sha(projection_path),
             'frozenProjectionInputs':input_hashes,'newRootPixel':root.tolist(),'fitViewportPadding':pad,
             'physicalUnion':str(union_path),'physicalUnionSha256':sha(union_path),'physicalUnionBytesSha256':array_sha(union),
             'dimensions':[union.shape[1],union.shape[0]],'parts':part_rows,'headContactWorld':dict(zip(('x','y'),contact.tolist())),
             'actualHeadMatrix':head.tolist(),'capturedTrans':trans.tolist(),'actual16MasksUnchanged':True,
             'newCraniumSubsetOfKnownHead':True,'bodyRGBAUnchanged':True,'supportRetargetY':0})
        atomic_json(D/'progress.json',{'pid':os.getpid(),'rows':len(rows),'refitParts':sum(p['requiresFit'] for row in rows for p in row['parts']),
                   'wallSeconds':time.perf_counter()-start,'cpuSeconds':time.process_time()-cpu,'last':key})
        if len(rows)%25==0:print('AUDIT',len(rows),'refitparts',sum(p['requiresFit'] for row in rows for p in row['parts']),flush=True)
    assert len(rows)==521 and len([r for r in rows if r['oldJournal'] is None])==8
    for p,h in guards.items():assert sha(p)==h,('FROZEN_CHANGED',p)
    out={'state':'NEW_FROZEN_SELECTIVE_DK_CROWN_REPAIR_V3','rows':rows,'inputHashes':guards,
         'recipe':str(recipe_path),'recipeSha256':sha(recipe_path),'review':str(review),'reviewSha256':sha(review),
         'allDKConsumersAudited':521,'existingCompletedRows':513,'eightHeldRows':8,
         'refitParts':sum(p['requiresFit'] for r in rows for p in r['parts']),
         'passingPartsReused':sum(bool(p['oldWORLDPrimitives']) and not p['requiresFit'] for r in rows for p in r['parts']),
         'projectionSeconds':0,'auditWallSeconds':time.perf_counter()-start,'auditCPUSeconds':time.process_time()-cpu,
         'gameChecksRun':False,'oldJournalsUntouched':True,'pikachuUnchanged':True}
    atomic_json(D/'plan.json',out);print('FROZEN',out['refitParts'],'refitparts',out['passingPartsReused'],'reused',flush=True)

if __name__=='__main__':main()
