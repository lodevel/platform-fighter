"""Pack approved normal drawings with the reviewed fixed-root transform.

Writes independent batch manifests, preserving the existing up-air manifest.
Packing never accepts output and never fits/crops/recentres individual poses.
"""
from pathlib import Path
import argparse, hashlib, json
from PIL import Image, ImageDraw

ROOT=Path(__file__).resolve().parent.parent
E=ROOT/'docs/review/2026-10-06/pikachu-character'
B=E/'art'; OUT=ROOT/'assets/characters/pikachu'
parser=argparse.ArgumentParser()
parser.add_argument('action',choices=['neutral-air','down-air','vertical-tilts','back-air','jab','dash-attack','smashes','smash-charges'])
args=parser.parse_args()
routes={
    'smashes':{'forward-smash':'smash','up-smash':'usmash','down-smash':'dsmash'},
    'smash-charges':{'forward-smash-charge':'smash_charge','up-smash-charge':'usmash_charge','down-smash-charge':'dsmash_charge'},
    'dash-attack':{'dash-attack':'dash_attack'},
    'jab':{'jab':'jab'},
    'neutral-air':{'neutral-air':'nair'},
    'down-air':{'down-air':'dair','down-air-landing':'dair_landing'},
    'vertical-tilts':{'up-tilt':'utilt','down-tilt':'dtilt'},
    'back-air':{'back-air':'bair','back-air-landing':'bair_landing'},
}[args.action]
approval=json.loads((E/args.action/'art-approval.json').read_text())
if approval['status']!='accepted_for_candidate_build':raise ValueError('Incomplete art review')
prep=json.loads((B/'normal-pilot-preparation.json').read_text())['records']
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
review=E/args.action/'packed-preparation';review.mkdir(parents=True,exist_ok=True)
(OUT/'animations').mkdir(parents=True,exist_ok=True)
(OUT/'pose-batches').mkdir(exist_ok=True)
record={'state':'packed_output_visual_and_runtime_review_required','scope':'Partial registered normal batch; no roster/manifest/full-fighter acceptance',
    'coordinateContract':{'canonicalCanvas':[2048,1536],'canonicalRoot':[1024,1152],
        'frameWidth':512,'frameHeight':384,'root':[256,288],'scaleToWorld':4*70/600,'bodyCentreFromRoot':[0,-25]},
    'approvalSha256':sha(E/args.action/'art-approval.json'),'animations':{},'sources':[],'galleries':{}}
for action,sheet in routes.items():
    rows=[r for r in prep if r['action']==action]
    if not rows:raise ValueError('Missing prepared action '+action)
    cells=[]
    for r in rows:
        name=r['key']+f"-attempt{r.get('chosen_art_attempt',1)}-cutout.png";p=B/name
        accepted=approval['files'].get(name)
        if not accepted or accepted['status']!='accepted_for_rough_preview' or accepted['sha256']!=sha(p):
            raise ValueError('Missing/stale approval '+name)
        im=Image.open(p).convert('RGBA')
        if im.size!=(2048,1536):raise ValueError('Wrong canonical canvas '+name)
        cells.append(im.resize((512,384),Image.Resampling.LANCZOS))
        record['sources'].append({'action':action,'file':str(p.relative_to(ROOT)),'sha256':sha(p),'translation':[0,0],
            'scale':.25,'crop':None,'resampler':'Pillow LANCZOS'})
    strip=Image.new('RGBA',(512*len(cells),384))
    for i,cell in enumerate(cells):strip.paste(cell,(i*512,0))
    dest=OUT/'animations'/f'{sheet}.png';strip.save(dest)
    record['animations'][sheet]={'strip':str(dest.relative_to(OUT)),'frameCount':len(cells),'sha256':sha(dest),
        'frameWindows':[{'startFrame':r['start_elapsed'],'endFrame':r['end_elapsed'],'artFrameIndex':i} for i,r in enumerate(rows)]}
    for start in range(0,len(cells),4):
        group=cells[start:start+4];gallery=Image.new('RGB',(1024,420*len(group)),'#17253a');draw=ImageDraw.Draw(gallery)
        for i,cell in enumerate(group):
            draw.text((8,i*420+7),f'{action} packed frame {start+i} / source {rows[start+i]["source_index"]} / actual pixels',fill='white')
            for side,color in enumerate(['#f7f5ef','#17253a']):
                bg=Image.new('RGBA',(512,384),color);bg.alpha_composite(cell)
                gallery.paste(bg.convert('RGB'),(side*512,i*420+30))
        dest=review/f'{sheet}-cells-{start//4+1}.png';gallery.save(dest)
        record['galleries'][dest.name]=sha(dest)
dest=OUT/'pose-batches'/f'{args.action}.json';dest.write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps({'action':args.action,'frames':{k:v['frameCount'] for k,v in record['animations'].items()},'manifest':str(dest),'review':'pending actual packed-cell and runtime inspection'}))
