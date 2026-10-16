"""Current body pixels plus current receiving/contact overlays; no re-render."""
from pathlib import Path
import sys,json,hashlib,math,time
sys.path[:0]=['tools']
from PIL import Image,ImageDraw
from link_immutable_input_stage_v1 import atomic_json
A=Path('docs/review/2026-10-12/link-character/rework/art')
S=A/'final-dk-selective-crown-repair-v3'
D=A/'final-current-851-geometry-review-v3';D.mkdir(exist_ok=True)
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
COLORS={'head':'#64edee','torso':'#d38bff','arm':'#71e796','leg':'#ffb65e','foot':'#ffe285'}
actor=sys.argv[1];start=time.perf_counter();source=S/'completed-851-source-tuples.json';source_hash=sha(source)
refs=json.load(open(source))['rows'];groups={}
for r in refs:
    if r['actor']==actor:groups.setdefault(r['resource'],[]).append(r)
resources=[]
for resource,refs in sorted(groups.items()):
    refs.sort(key=lambda r:r['logicalArtFrameIndex']);tiles=[];proof=[]
    R=D/actor/resource;R.mkdir(parents=True,exist_ok=True)
    for ref in refs:
        assert sha(ref['journal'])==ref['sha256'] and sha(ref['cell'])==ref['cellSha256']
        j=json.load(open(ref['journal']));body=Image.open(ref['cell']).convert('RGBA')
        root=j.get('knownRootAfterExactReductionCrop')
        if root is None:root=j['sourceRoot'] # unchanged three Pika pilot journals
        scale=j['scaleToWorld'];w=max(body.width+24,300);h=max(body.height+46,300)
        tile=Image.new('RGBA',(w*2,h),'#182738');tile.alpha_composite(body,(12,40));tile.alpha_composite(body,(w+12,40));draw=ImageDraw.Draw(tile)
        def point(p):return w+12+root[0]+p['x']/scale,40+root[1]+p['y']/scale
        for cap in j['receiving']:
            a=point(cap['start']);b=point(cap['end']);radius=cap['radius']/scale;color=COLORS[cap['region']]
            # Exact capsule perimeter: endpoint circles joined by outer tangents.
            dx=b[0]-a[0];dy=b[1]-a[1];length=math.hypot(dx,dy)
            if length:
                nx=-dy/length*radius;ny=dx/length*radius
                draw.line([(a[0]+nx,a[1]+ny),(b[0]+nx,b[1]+ny)],fill=color,width=1)
                draw.line([(a[0]-nx,a[1]-ny),(b[0]-nx,b[1]-ny)],fill=color,width=1)
            for x,y in [a,b]:draw.ellipse((x-radius,y-radius,x+radius,y+radius),outline=color,width=1)
        x,y=point(j['headContact']['point']);draw.line((x-5,y,x+5,y),fill='#ff7ecc',width=2);draw.line((x,y-5,x,y+5),fill='#ff7ecc',width=2)
        draw.text((8,5),f'{actor} {resource} raw{ref["nativeSample"]} / art{ref["logicalArtFrameIndex"]}: retained body | current receiving + crown',fill='white')
        draw.text((8,21),f'{len(j["receiving"])} primitives; SOURCE ROOT, support0 pending; authored anatomy, no native capsule claim',fill='#e6cedf')
        tiles.append(tile);proof.append({**ref,'bodyRGBAUnchanged':True,'bodyRootPixel':root,'scaleToWorld':scale,'headContact':j['headContact'],'primitiveCount':len(j['receiving'])})
    panels=[]
    for begin in range(0,len(tiles),12):
        cells=tiles[begin:begin+12];tw=max(t.width for t in cells);th=max(t.height for t in cells)
        panel=Image.new('RGBA',(tw*3,th*math.ceil(len(cells)/3)),'#182738')
        for i,tile in enumerate(cells):panel.alpha_composite(tile,((i%3)*tw,(i//3)*th))
        path=R/f'{resource}-current-physical-{begin//12+1}.png';panel.save(path)
        panels.append({'path':str(path),'sha256':sha(path),'dimensions':list(panel.size),'rows':proof[begin:begin+12],'drawingCount':len(cells)})
    index=R/'index.json';atomic_json(index,{'actor':actor,'resource':resource,'panels':panels,'drawingCount':len(tiles),'gameChecksRun':False})
    resources.append({'actor':actor,'resource':resource,'index':str(index),'indexSha256':sha(index),'panels':panels,'drawingCount':len(tiles)})
    print(resource,len(tiles),len(panels),flush=True)
assert sha(source)==source_hash
atomic_json(D/(actor+'-index.json'),{'actor':actor,'state':'ACTUAL_CURRENT_BODY_GEOMETRY_REVIEW_PENDING','resources':resources,'drawingCount':sum(r['drawingCount']for r in resources),'panelCount':sum(len(r['panels'])for r in resources),'sourceIndex':str(source),'sourceIndexSha256':source_hash,'seconds':time.perf_counter()-start,'gameChecksRun':False})
