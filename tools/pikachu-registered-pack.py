"""Pack reviewed up-air pixels with one fixed transform; never approve output.

No alpha-bound recentering/cropping or per-pose fitting. Runtime qualification
of the packed strip remains separate from the source PNG approvals.
"""
from pathlib import Path
import hashlib,json
from PIL import Image

ROOT=Path(__file__).resolve().parent.parent
E=ROOT/'docs/review/2026-10-06/pikachu-character'
B=E/'art';OUT=ROOT/'assets/characters/pikachu'
OUT.mkdir(parents=True,exist_ok=True)
(OUT/'animations').mkdir(exist_ok=True)
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
approval=json.loads((E/'up-air/art-approval.json').read_text())
prep=json.loads((B/'normal-pilot-preparation.json').read_text())
rows=[r for r in prep['records'] if r['action']=='up-air']
if len(rows)!=11 or approval['status']!='accepted_for_candidate_build':
    raise ValueError('Complete reviewed up-air required')
files=['reference-registered.png']+[r['key']+'-attempt1-cutout.png' for r in rows]
cells=[];sources=[]
for name in files:
    p=B/name;accepted=approval['files'].get(name)
    if not accepted or accepted['status']!='accepted_for_rough_preview' or accepted['sha256']!=sha(p):
        raise ValueError('Unreviewed/changed source: '+name)
    im=Image.open(p).convert('RGBA')
    if name==files[0]:
        if im.size!=(1024,1024):raise ValueError('Wrong neutral canvas')
        # Root512,880 becomes1024,1152 by integer translation only.
        padded=Image.new('RGBA',(2048,1536));padded.paste(im,(512,272));im=padded
    elif im.size!=(2048,1536):raise ValueError('Wrong attack canvas')
    cells.append(im.resize((512,384),Image.Resampling.LANCZOS))
    sources.append({'file':str(p.relative_to(ROOT)),'sha256':sha(p),
        'translation':[512,272] if name==files[0] else [0,0],
        'scale':.25,'crop':None,'resampler':'Pillow LANCZOS'})
cells[0].save(OUT/'animations/idle.png')
strip=Image.new('RGBA',(512*len(rows),384))
for index,cell in enumerate(cells[1:]):strip.paste(cell,(index*512,0))
strip.save(OUT/'animations/uair.png')
record={'state':'packed_output_visual_and_runtime_review_required',
    'scope':'Reviewed neutral/up-air only; no roster/manifest registration or complete fighter claim',
    'coordinateContract':{'canonicalCanvas':[2048,1536],'canonicalRoot':[1024,1152],
        'frameWidth':512,'frameHeight':384,'root':[256,288],
        'scaleToWorld':4*70/600,'bodyCentreFromRoot':[0,-25]},
    'sources':sources,'animations':{
        'idle':{'strip':'animations/idle.png','frameCount':1,'sha256':sha(OUT/'animations/idle.png')},
        'uair':{'strip':'animations/uair.png','frameCount':11,'sha256':sha(OUT/'animations/uair.png'),
            'frameWindows':[{'startFrame':r['start_elapsed'],'endFrame':r['end_elapsed'],'artFrameIndex':i} for i,r in enumerate(rows)]}}}
(OUT/'registered-poses.json').write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps({'packed':str(OUT),'uairFrames':11,'uniformScale':.25,'root':[256,288],'review':'pending'}))
