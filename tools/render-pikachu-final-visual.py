#!/usr/bin/env python3
"""Display-only integer native poses. Retains the accepted renderer and all old pixels.

Run under .tmp/dk-heavy.lock with PYTHONPATH=.tmp/pikachu-final-libs:tools.
Outputs private intermediates and a staged lossless page bank under --out.
No simulation metadata or installed assets are written by this tool.
"""
import os
for name in ('OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS','NUMEXPR_NUM_THREADS'):
    os.environ[name]='1'
from pathlib import Path
import argparse, concurrent.futures, hashlib, importlib.util, json, math, resource, time
from PIL import Image
ROOT=Path(__file__).resolve().parent.parent
PLAN=ROOT/'docs/review/2026-10-15/pikachu-final/owner-art-plan.json'
OLD=ROOT/'assets/characters/pikachu'
PAGE_LIMIT=2048
BUDGET=176*1024*1024
renderer=None

def sha(path): return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def effective_cpus():
    count=len(os.sched_getaffinity(0))
    quota=Path('/sys/fs/cgroup/cpu.max')
    if quota.exists():
        value,period=quota.read_text().split()
        if value!='max': count=min(count,max(1,math.ceil(int(value)/int(period))))
    return count

def init_worker():
    global renderer
    # Stagger independent native model/texture loads; each worker then persists.
    time.sleep((os.getpid()%20)*.04)
    spec=importlib.util.spec_from_file_location('accepted_final_renderer',ROOT/'tools/render-pikachu-final-art.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    renderer=module.ToonRenderer()

def render_job(job):
    motion,sample,dest=job;start=time.monotonic();cpu=time.process_time()
    drawing,receipt=renderer.render(motion,sample)
    bounds=drawing.getbbox();drawing.crop(bounds).save(dest,optimize=True)
    receipt.update({'file':str(dest),'bounds':list(bounds),'pngSha256':sha(dest),'seconds':time.monotonic()-start,
        'cpuSeconds':time.process_time()-cpu,'maxRssKiB':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,'worker':os.getpid()})
    Path(str(dest)+'.json').write_text(json.dumps(receipt,indent=2)+'\n')
    return receipt

def pack(rectangles):
    """Deterministic MaxRects, best short-side fit; no rotations/resampling."""
    pending=sorted(rectangles,key=lambda r:(-max(r['w'],r['h']),-r['w']*r['h'],r['id']))
    pages=[]
    while pending:
        free=[(0,0,PAGE_LIMIT,PAGE_LIMIT)];placed=[];remaining=[]
        for r in pending:
            w,h=r['w']+4,r['h']+4
            fits=[(min(fw-w,fh-h),max(fw-w,fh-h),y,x,i) for i,(x,y,fw,fh) in enumerate(free) if fw>=w and fh>=h]
            if not fits: remaining.append(r);continue
            _,_,y,x,_=min(fits);used=(x,y,w,h);next_free=[]
            for fx,fy,fw,fh in free:
                if x>=fx+fw or x+w<=fx or y>=fy+fh or y+h<=fy:next_free.append((fx,fy,fw,fh));continue
                if x>fx: next_free.append((fx,fy,x-fx,fh))
                if x+w<fx+fw: next_free.append((x+w,fy,fx+fw-x-w,fh))
                if y>fy: next_free.append((fx,fy,fw,y-fy))
                if y+h<fy+fh: next_free.append((fx,y+h,fw,fy+fh-y-h))
            free=[]
            for i,f in enumerate(next_free):
                if not any(j!=i and g[0]<=f[0] and g[1]<=f[1] and g[0]+g[2]>=f[0]+f[2] and g[1]+g[3]>=f[1]+f[3] and (g!=f or j<i) for j,g in enumerate(next_free)):free.append(f)
            placed.append({**r,'x':x+2,'y':y+2})
        if not placed:raise ValueError('A native drawing exceeds the page limit')
        pages.append(placed);pending=remaining
    return pages

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--out',default='.tmp/pikachu-final-visual');parser.add_argument('--pilot',action='store_true');parser.add_argument('--workers',type=int,default=effective_cpus());args=parser.parse_args()
    out=ROOT/args.out;raw=out/'drawings';raw.mkdir(parents=True,exist_ok=True);(out/'animations').mkdir(exist_ok=True)
    plan=json.loads(PLAN.read_text());old=json.loads((OLD/'frames.json').read_text())['animations'];start=time.monotonic()
    environment={'logicalCpus':os.cpu_count(),'affinityCpus':len(os.sched_getaffinity(0)),'effectiveCpus':effective_cpus(),'workers':args.workers,'cpuMax':Path('/sys/fs/cgroup/cpu.max').read_text().strip(),'memoryMax':Path('/sys/fs/cgroup/memory.max').read_text().strip(),'blasThreads':1}
    jobs=[]
    for clip in plan['clips']:
        if sha(ROOT/clip['motionPath'])!=clip['motionSha256']:raise ValueError('Native input hash changed')
        for sample in range(clip['nativeEnd']+1):
            if sample in clip['samples']:continue
            dest=raw/f"{clip['sheet']}-{sample:03}.png"
            if not dest.exists() or not Path(str(dest)+'.json').exists():jobs.append((clip['motion'],sample,dest))
    if args.pilot:jobs=jobs[:min(args.workers,4)]
    receipts=[]
    print(json.dumps({'environment':environment,'jobs':len(jobs),'pilot':args.pilot}),flush=True)
    with concurrent.futures.ProcessPoolExecutor(max_workers=args.workers,initializer=init_worker) as pool:
        for receipt in pool.map(render_job,jobs,chunksize=1):
            receipts.append(receipt)
            if len(receipts)%10==0 or args.pilot:print(json.dumps({'done':len(receipts),'total':len(jobs),'seconds':round(time.monotonic()-start,2),'workerPeakRssKiB':receipt['maxRssKiB']}),flush=True)
    run={'environment':environment,'rendered':len(receipts),'wallSeconds':time.monotonic()-start,'workerCpuSeconds':sum(r['cpuSeconds'] for r in receipts),'peakWorkerRssKiB':max((r['maxRssKiB'] for r in receipts),default=0),'rendererSha256':sha(ROOT/'tools/render-pikachu-final-art.py'),'generatorSha256':sha(__file__),'receipts':receipts}
    (out/('pilot.json' if args.pilot else 'batch.json')).write_text(json.dumps(run,indent=2)+'\n')
    if args.pilot:return
    # Reuse exact accepted crops. Distinct logical placements can share texture pixels.
    unique={};clips={};all_pages={};preserved=[]
    for clip in plan['clips']:
        sheet=clip['sheet'];entry=old[sheet];atlas=Image.open(OLD/entry['strip']).convert('RGBA');frames=[];new=[]
        for sample in range(clip['nativeEnd']+1):
            accepted=sample in clip['samples']
            if accepted:
                idx=clip['samples'].index(sample);x,y,w,h,dx,dy=entry['trims'][idx];crop=atlas.crop((x,y,x+w,y+h))
            else:
                dest=raw/f'{sheet}-{sample:03}.png';receipt=json.loads(Path(str(dest)+'.json').read_text());dx,dy,right,bottom=receipt['bounds'];crop=Image.open(dest).convert('RGBA');w,h=crop.size
            digest=hashlib.sha256(crop.tobytes()).hexdigest();identity=f'{w}x{h}:{digest}:{dx}:{dy}'
            if identity not in unique:
                record={'id':identity,'crop':crop,'w':w,'h':h,'dx':dx,'dy':dy,'rgbaSha256':digest};unique[identity]=record;new.append(record)
            frames.append({'nativeSample':sample,'identity':identity,'acceptedOriginal':accepted})
            if accepted:preserved.append({'sheet':sheet,'nativeSample':sample,'oldFrame':idx,'rgbaSha256':digest,'oldAtlasSha256':entry['sha256']})
        for packed in pack(new):
            name=f'visual_final_{len(all_pages):02}';width=max(r['x']+r['w']+2 for r in packed);height=max(r['y']+r['h']+2 for r in packed)
            image=Image.new('RGBA',(width,height));trims=[]
            for r in packed:
                image.paste(r['crop'],(r['x'],r['y']));idx=len(trims);trims.append([r['x'],r['y'],r['w'],r['h'],r['dx'],r['dy']]);unique[r['id']]['reference']={'page':name,'frame':idx}
            dest=out/'animations'/f'{name}.png';image.save(dest,optimize=True)
            all_pages[name]={'strip':f'animations/{name}.png','frameCount':len(trims),'frameWidth':entry['frameWidth'],'frameHeight':entry['frameHeight'],'atlas':[width,height],'trims':trims,'sha256':sha(dest)}
        clips[sheet]={'motion':clip['motion'],'motionSha256':clip['motionSha256'],'nativeEnd':clip['nativeEnd'],'loopDuration':clip['loopDuration'],'root':entry['root'],'scaleToWorld':entry['scaleToWorld'],'bodyCentreFromRootY':entry['bodyCentreFromRootY'],'frames':[{**{k:v for k,v in f.items() if k!='identity'},**unique[f['identity']]['reference']} for f in frames]}
    decoded=sum(p['atlas'][0]*p['atlas'][1]*4 for p in all_pages.values())
    if decoded>BUDGET:raise ValueError(f'Decoded budget exceeded: {decoded}/{BUDGET}')
    metadata={'schema':'pikachu-final-display/1','purpose':'display-only integer native poses; never authoritative body/receiving/attack/attachment samples','sampling':'floor semantic motion age; loop only declared native loop; clamp nonloop endpoints','pageLimit':PAGE_LIMIT,'decodedBudgetBytes':BUDGET,'decodedBytes':decoded,'rootRegistration':'remove-trans-translation','authoritativeFramesSha256':sha(OLD/'frames.json'),'authoritativeClipsSha256':hashlib.sha256(json.dumps({c['sheet']:old[c['sheet']] for c in plan['clips']},sort_keys=True,separators=(',',':')).encode()).hexdigest(),'pages':all_pages,'clips':clips}
    (out/'final-visual-frames.json').write_text(json.dumps(metadata,indent=2)+'\n');(out/'preserved-drawings.json').write_text(json.dumps(preserved,indent=2)+'\n')
    print(json.dumps({'complete':True,'semanticSamples':sum(len(c['frames']) for c in clips.values()),'uniqueDrawings':len(unique),'pages':len(all_pages),'decodedMiB':decoded/2**20,'wallSeconds':time.monotonic()-start}),flush=True)

if __name__=='__main__':main()
