"""Prepare review-only 2D capsule candidates from captured native poses.

The radius rule is an explicit authored approximation under nonuniform scale;
these candidates are not native collision parity and are never auto-installed.
"""
from pathlib import Path
import hashlib
import json
import math
import re
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
EVIDENCE = ROOT / 'docs/review/2026-10-06/pikachu-character'
ART = EVIDENCE / 'art'
OUT = EVIDENCE / 'fair-motion/hurtbox-preparation'
OUT.mkdir(exist_ok=True)
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
source = EVIDENCE / 'sources/posed-resources/fair-reference-samples.json'
data = json.loads(source.read_text())
text = (ROOT / 'src/previews/pikachuForwardAirPreviewPoses.ts').read_text()
schedule = [{'pose':m[0], 'sourceIndex':int(m[1]), 'startElapsed':int(m[2]), 'endElapsed':int(m[3])}
    for m in re.findall(r"pose: '([^']+)', sourceIndex: (\d+), startElapsed: (\d+), endElapsed: (\d+)", text)]
files = json.loads((EVIDENCE / 'fair-motion/art-approval.json').read_text())['files']
colors = ['#6dd3ff','#ff80b8','#8affab','#8affab','#ffbf73','#ffbf73','#b1a0ff','#b1a0ff','#a5ffed','#a5ffed','#fff27b','#fff27b']
rows=[]
for row in schedule:
    file = next(file for file in files if f"source{row['sourceIndex']}-attempt1-cutout" in file)
    frame = data['frames'][row['sourceIndex']]
    matrix = frame['matrices']
    boxes=[]
    for h in frame['hurtbox_reference_endpoints']:
        m=matrix[h['bone']]
        axis_scales=[math.sqrt(sum(m[r][c]**2 for r in range(3))) for c in range(3)]
        radius=h['native_size']*max(axis_scales)*5
        points=[{'x':v[2]*5,'y':25-v[1]*5} for v in h['endpoints']]
        start,end=points
        minx=min(start['x'],end['x'])-radius;maxx=max(start['x'],end['x'])+radius
        miny=min(start['y'],end['y'])-radius;maxy=max(start['y'],end['y'])+radius
        boxes.append({'id':f"pikachu.fair.{h['index']}.{h['bone']}",'offsetX':(minx+maxx)/2,'offsetY':(miny+maxy)/2,
            'width':maxx-minx,'height':maxy-miny,'capsule':{'start':start,'end':end,'radius':radius}})
    rows.append({**row,'file':file,'artSha256':sha(ART/file),'hurtboxes':boxes})
    im=Image.open(ART/file).convert('RGBA')
    background=Image.new('RGBA',im.size,(23,37,58,255));background.alpha_composite(im)
    layer=Image.new('RGBA',im.size);draw=ImageDraw.Draw(layer)
    for i,box in enumerate(boxes):
        cap=box['capsule'];r=cap['radius']/(70/600)
        pts=[(768+p['x']/(70/600),880+(p['y']-25)/(70/600)) for p in [cap['start'],cap['end']]]
        color=colors[i]
        draw.line(pts,fill=color,width=3)
        for x,y in pts:draw.ellipse((x-r,y-r,x+r,y+r),outline=color,width=3)
        draw.text(pts[0],str(i),fill='white',stroke_width=1,stroke_fill='black')
    background.alpha_composite(layer);background.save(OUT/f"{row['pose']}-candidate.png")
result={'state':'review_required_not_runtime_data','source':str(source.relative_to(EVIDENCE)), 'sourceSha256':sha(source),
    'policy':'Authored orthographic 2D projection z*5,y*-5+25; radius native-size*maximum-world-column-norm*5. Nonuniform native scale/radius semantics are unresolved; no native parity claimed.',
    'poseMapping':'Sparse drawing holds use their chosen captured source index for the entire drawing interval. Animation deformation is adapted to the held drawing, not continuous native samples.',
    'rows':rows}
(OUT/'candidates.json').write_text(json.dumps(result,indent=2)+'\n')
gallery=Image.new('RGB',(4*480,4*460),'#17253a');d=ImageDraw.Draw(gallery)
for i,row in enumerate(rows):
    im=Image.open(OUT/f"{row['pose']}-candidate.png");im.thumbnail((480,420))
    x=i%4*480;y=i//4*460;gallery.paste(im,(x,y+30));d.text((x+10,y+10),f"{row['pose']} / {row['sourceIndex']}",fill='white')
gallery.save(OUT/'all-candidates.png')
print(json.dumps({'candidatePoses':len(rows),'capsules':sum(len(r['hurtboxes']) for r in rows),'gallery':str(OUT/'all-candidates.png')}))
