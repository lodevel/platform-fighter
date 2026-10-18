import json, numpy as np
from PIL import Image, ImageDraw, ImageFont
R='/home/lombet/Workspace/platform-fighter/.tmp/character-packages'
S='/tmp/claude-1000/-home-lombet-Workspace-platform-fighter/a7dfccb5-31fd-4c9e-86a2-6a914ded46da/scratchpad/explore-resolution/stage'
OUT='/home/lombet/Workspace/platform-fighter/docs/review/2026-10-18/phase3/explore/resolution'
import os; os.makedirs(OUT,exist_ok=True)
REFS=[('donkeykong','jab','DK jab'),('link','d02specialairhi','Link spin attack'),('pikachu','final2','Pikachu Final')]
def load(root,fid,did):
    pk=json.load(open(f'{root}/character.json')); d=pk['drawings'][did]
    img=Image.open(f"{root}/pages/{d['page']}.png").convert('RGBA'); x,y,w,h=d['rect']
    a=np.asarray(img.crop((x,y,x+w,y+h))).astype(np.float64)/255
    a[...,:3]*=a[...,3:4]   # premultiplied
    return a, 1/d['scale'], d['anchor']
def render(tex,D,S_,off=(0.37,0.21)):
    """bilinear (no mip) draw of tex (texel density D per design px) at S_ screen px per design px"""
    h,w,_=tex.shape; W=int(np.ceil(w/D*S_))+2; H=int(np.ceil(h/D*S_))+2
    xs=((np.arange(W)+0.5-off[0])/S_)*D-0.5; ys=((np.arange(H)+0.5-off[1])/S_)*D-0.5
    pad=np.zeros((h+2,w+2,4)); pad[1:-1,1:-1]=tex
    def axis(c,n):
        i0=np.floor(c).astype(int); f=c-i0; return np.clip(i0+1,0,n+1),np.clip(i0+2,0,n+1),f
    x0,x1,fx=axis(xs,w); y0,y1,fy=axis(ys,h)
    top=pad[y0][:,x0]*(1-fx)[None,:,None]+pad[y0][:,x1]*fx[None,:,None]
    bot=pad[y1][:,x0]*(1-fx)[None,:,None]+pad[y1][:,x1]*fx[None,:,None]
    return top*(1-fy)[:,None,None]+bot*fy[:,None,None]
def ideal(tex_src,D,S_,off=(0.37,0.21),k=6):
    """true area average of the source over each screen pixel footprint (k x k supersampling of the source)"""
    big=render(tex_src,D,S_*k,(off[0]*k,off[1]*k))
    H=big.shape[0]//k; W=big.shape[1]//k
    return big[:H*k,:W*k].reshape(H,k,W,k,4).mean(axis=(1,3))
def fit(a,H,W): 
    o=np.zeros((H,W,4)); o[:min(H,a.shape[0]),:min(W,a.shape[1])]=a[:H,:W]; return o
def over(a,bg):
    rgb=a[...,:3]+(1-a[...,3:4])*np.array(bg)/255
    return (np.clip(rgb,0,1)*255).round().astype(np.uint8)
def metrics(a,b):
    cov=(a[...,3]>0.02)|(b[...,3]>0.02)
    d=np.abs(a-b)[cov]; return d.mean(), (np.abs(a-b).max(axis=-1)[cov]>32/255).mean()*100
def label(im,t):
    im=Image.fromarray(im); c=Image.new('RGB',(im.width,im.height+16),(20,20,20)); c.paste(im,(0,16)); ImageDraw.Draw(c).text((3,2),t,fill=(255,255,255)); return c
def sheet(cols,path,bg=(120,150,120)):
    H=max(c.height for c in cols); W=sum(c.width for c in cols)+4*(len(cols)+1)
    o=Image.new('RGB',(W,H+8),(40,40,40)); x=4
    for c in cols: o.paste(c,(x,4)); x+=c.width+4
    o.save(path)
results=[]
CANDS={'today':None,'A 1080p/1.4':'A-1080-all','B 1080p+Final 2.8':'B-1080-final2.8','C 1440p/1.87':'C-1440-final2.8'}
SCEN=[('1080p zoom 1.4',1.4),('1080p zoom 1.0',1.0),('1440p zoom 1.4',1.87),('4K zoom 1.4',2.8),('1080p zoom 0.7',0.7)]
for fid,act,name in REFS:
    pk=json.load(open(f'{R}/{fid}/character.json')); ws=pk['actions'][act]['drawings']['windows']
    # pick the drawing with the largest rect among the windows
    did=max((w['drawing'] for w in ws),key=lambda d:pk['drawings'][d]['rect'][2]*pk['drawings'][d]['rect'][3])
    src,D0,_=load(f'{R}/{fid}',fid,did)
    texs={}
    for cn,c in CANDS.items():
        texs[cn]=load(f'{R}/{fid}',fid,did)[:2] if c is None else load(f'{S}/{fid}~{c}',fid,did)[:2]
    for sn,Sx in SCEN:
        offs=[(0.0,0.0),(0.25,0.5),(0.5,0.25),(0.75,0.75),(0.37,0.21),(0.9,0.1)]
        row={'ref':name,'drawing':did,'scenario':sn,'screenPxPerDesign':Sx,'results':{}}
        for cn,(t,D) in texs.items():
            es=[];fs=[]
            for off in offs:
                ref=ideal(src,D0,Sx,off); r=render(t,D,Sx,off)
                H=max(ref.shape[0],r.shape[0]);W=max(ref.shape[1],r.shape[1])
                # align sub-pixel: ideal has no offset; compare after small tolerance -> use shift-free ideal rendered with same offset via bilinear of high-res ideal? keep simple
                e,f=metrics(fit(r,H,W),fit(ref,H,W)); es.append(e);fs.append(f)
            row['results'][cn]={'texelsPerDesign':round(D,3),'minification':round(D/Sx,3),'meanAbsErrVsIdeal':round(float(np.mean(es)),5),'pctPixelsOver32':round(float(np.mean(fs)),3)}
        results.append(row)
    # picture at 1080p zoom 1.4 : match size + 5x crop + diff
    Sx=1.4; ref=ideal(src,D0,Sx); cols=[];crops=[];diffs=[]
    imgs={cn:fit(render(t,D,Sx),*ref.shape[:2]) for cn,(t,D) in texs.items()}
    imgs['ideal (Lanczos)']=ref
    # crop box: densest area (highest alpha gradient): choose region around centroid of alpha
    al=ref[...,3]; ys,xs=np.nonzero(al>0.5); cy,cx=int(ys.mean()),int(xs.mean()); cw=28
    y0=max(0,cy-cw);x0=max(0,cx-cw)
    for cn,a in imgs.items():
        m=Image.fromarray(over(a,(110,140,110)))
        cols.append(label(np.asarray(m),cn))
        cr=Image.fromarray(over(a,(110,140,110))[y0:y0+2*cw,x0:x0+2*cw]).resize((2*cw*5,2*cw*5),Image.NEAREST)
        crops.append(label(np.asarray(cr),cn))
        if cn!='ideal (Lanczos)':
            e=np.abs(a-ref).max(axis=-1); dm=(np.clip(e*8,0,1)*255).astype(np.uint8)
            diffs.append(label(np.stack([dm]*3,-1),f'|{cn}-ideal| x8'))
    sheet(cols,f'{OUT}/{fid}-{act}-match-size.png'); sheet(crops,f'{OUT}/{fid}-{act}-crop5x.png'); sheet(diffs,f'{OUT}/{fid}-{act}-diff.png')
    # scenario: 1440p display, 1080p-stored vs 1440p-stored vs today vs ideal
    Sx=1.87; ref=ideal(src,D0,Sx); cols=[]
    for cn,(t,D) in texs.items():
        cols.append(label(over(fit(render(t,D,Sx),*ref.shape[:2]),(110,140,110)),f'{cn} on 1440p'))
    cols.append(label(over(ref,(110,140,110)),'ideal'))
    sheet(cols,f'{OUT}/{fid}-{act}-on-1440p.png')
    # zoomed-out
    Sx=0.7; ref=ideal(src,D0,Sx); cols=[]
    for cn,(t,D) in texs.items():
        a=fit(render(t,D,Sx),*ref.shape[:2]); cols.append(label(np.asarray(Image.fromarray(over(a,(110,140,110))).resize((a.shape[1]*3,a.shape[0]*3),Image.NEAREST)),f'{cn} z0.7 x3'))
    cols.append(label(np.asarray(Image.fromarray(over(ref,(110,140,110))).resize((ref.shape[1]*3,ref.shape[0]*3),Image.NEAREST)),'ideal z0.7 x3'))
    sheet(cols,f'{OUT}/{fid}-{act}-zoomed-out.png')
json.dump(results,open(f'{OUT}/quality.json','w'),indent=1)
for r in results: print(r['ref'],r['scenario'],{k:(v['minification'],v['meanAbsErrVsIdeal'],v['pctPixelsOver32']) for k,v in r['results'].items()})
