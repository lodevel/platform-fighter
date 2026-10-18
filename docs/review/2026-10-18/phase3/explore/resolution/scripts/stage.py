"""Downscale every drawing to a target texel density, premultiplied Lanczos; stage on same-layout pages."""
import json, sys, os
from concurrent.futures import ProcessPoolExecutor
from PIL import Image
ROOT='/home/lombet/Workspace/platform-fighter/.tmp/character-packages'
OUT='/tmp/claude-1000/-home-lombet-Workspace-platform-fighter/a7dfccb5-31fd-4c9e-86a2-6a914ded46da/scratchpad/explore-resolution/stage'
CANDS={'A-1080-all':(1.4,1.4),'B-1080-final2.8':(1.4,2.8),'C-1440-final2.8':(1.87,2.8),'D-1440-all':(1.87,1.87)}
def isfinal(a): return 'final' in a.lower() and 'victim' not in a
def factor(scale,target): return min(1.0,target*scale)
def job(args):
    fid,page,items,cname=args
    src=Image.open(f'{ROOT}/{fid}/pages/{page}.png').convert('RGBA')
    out=Image.new('RGBA',src.size)
    res={}
    for did,rect,f in items:
        x,y,w,h=rect
        crop=src.crop((x,y,x+w,y+h))
        if f<1:
            nw,nh=max(1,round(w*f)),max(1,round(h*f))
            crop=crop.convert('RGBa').resize((nw,nh),Image.LANCZOS).convert('RGBA')
        out.paste(crop,(x,y)); res[did]=crop.size
    d=f'{OUT}/{fid}~{cname}/pages'; os.makedirs(d,exist_ok=True)
    out.save(f'{d}/{page}.png',compress_level=1)
    return res
if __name__=='__main__':
    jobs=[];meta={}
    for fid in ['donkeykong','link','pikachu']:
        pk=json.load(open(f'{ROOT}/{fid}/character.json'))
        fin=set()
        for a,v in pk['actions'].items():
            if isfinal(a):
                for w in v['drawings']['windows']: fin.add(w['drawing'])
        # a drawing used by any non-final action counts as normal
        for a,v in pk['actions'].items():
            if not isfinal(a):
                for w in v['drawings']['windows']: fin.discard(w['drawing'])
        for cname,(tn,tf) in CANDS.items():
            by={}
            fs={}
            for did,d in pk['drawings'].items():
                f=factor(d['scale'],tf if did in fin else tn); fs[did]=f
                by.setdefault(d['page'],[]).append((did,d['rect'],f))
            meta[(fid,cname)]=(pk,fs)
            for page,items in by.items(): jobs.append((fid,page,items,cname))
    with ProcessPoolExecutor(18) as ex: results=list(ex.map(job,jobs,chunksize=4))
    sizes={}
    for r in results: sizes.update({})
    # rebuild package json per candidate
    for (fid,cname),(pk,fs) in meta.items():
        new=json.loads(json.dumps(pk)); 
        sz={}
        for j,r in zip(jobs,results):
            if j[0]==fid and j[3]==cname: sz.update(r)
        for did,d in new['drawings'].items():
            w,h=d['rect'][2:]; nw,nh=sz[did]
            d['rect']=[d['rect'][0],d['rect'][1],nw,nh]
            d['anchor']=[d['anchor'][0]*nw/w,d['anchor'][1]*nh/h]
            d['scale']=d['scale']*w/nw
        json.dump(new,open(f'{OUT}/{fid}~{cname}/character.json','w'))
    print('done')
