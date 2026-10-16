"""Prepare body/contact comparisons for the three sourced smash candidates.

Root regions retain the ordinary source adapter basis. Non-root tail regions
use fixed-root native pose matrices. Output requires manual visual review.
"""
from pathlib import Path
import argparse, hashlib, json
from PIL import Image, ImageDraw

ROOT=Path(__file__).resolve().parent.parent
E=ROOT/'docs/review/2026-10-06/pikachu-character';B=E/'art';OUT=E/'sources/posed-resources'
parser=argparse.ArgumentParser();parser.add_argument('action',choices=['forward-smash','up-smash','down-smash'])
action=parser.parse_args().action
profile={'forward-smash':('AttackS4','game_attacks4',15,29),
         'up-smash':('AttackHi4','game_attackhi4',10,17),
         'down-smash':('AttackLw4','game_attacklw4',8,23)}[action]
motion,function,first,last=profile
native_path=E/'sources/native-attacks.json';ref_path=OUT/f'{action}-reference-samples.json'
native=json.loads(native_path.read_text())['motions']['pikachu/'+motion]
attacks=next(f['attacks'] for f in native['functions'] if f['name']==function)
samples=json.loads(ref_path.read_text())['frames']
rows=[r for r in json.loads((B/'normal-pilot-preparation.json').read_text())['records'] if r['action']==action]
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
projections=[];panels=[]
for game in range(first,last+1):
    active=[a for a in attacks if a['frame']<=game<a['end_frame']]
    matrices={k.lower():v for k,v in samples[game-1]['matrices'].items()}
    trans=[matrices['trans'][i][3] for i in range(3)]
    regions=[]
    for attack in active:
        local=[attack[k] for k in ['x','y','z']]
        end=[attack[k+'2'] if attack[k+'2'] is not None else attack[k] for k in ['x','y','z']]
        def point(coords):
            if attack['bone']=='top':return {'x':coords[2]*5,'y':25-coords[1]*5}
            matrix=matrices[attack['bone']]
            world=[sum(matrix[i][j]*coords[j] for j in range(3))+matrix[i][3]-trans[i] for i in range(3)]
            return {'x':world[2]*5,'y':25-world[1]*5}
        regions.append({'id':attack['id'],'bone':attack['bone'],'sourceLocal':local,'sourceEnd':end,
            'start':point(local),'end':point(end),'damage':attack['damage'],
            'authoredWorldRadius':attack['size']*5,'sourceSize':attack['size']})
    projections.append({'gameFrame':game,'sourceIndex':game-1,'regions':regions})
    row=next(r for r in rows if r['start_elapsed']<=game-1<r['end_elapsed'])
    file=B/(row['key']+f"-attempt{row.get('chosen_art_attempt',1)}-cutout.png")
    im=Image.open(file if file.exists() else B/(row['key']+'-seed.png')).convert('RGBA')
    # Contact can extend beyond the body sprite's fixed canvas (electric burst).
    # Pad only this review viewport; keep authored body pixels/root unchanged.
    review_margin=768
    viewport=Image.new('RGBA',(im.width+2*review_margin,im.height),'#17253a')
    viewport.alpha_composite(im,(review_margin,0))
    overlay=Image.new('RGBA',viewport.size);draw=ImageDraw.Draw(overlay)
    for region in regions:
        cap=region['start'];x,y=review_margin+1024+cap['x']/(70/600),1152+(cap['y']-25)/(70/600)
        radius=region['authoredWorldRadius']/(70/600)
        draw.ellipse((x-radius,y-radius,x+radius,y+radius),outline='#ff809c',width=5)
    viewport.alpha_composite(overlay);viewport.thumbnail((590,460))
    panel=Image.new('RGB',(600,500),'#17253a');panel.paste(viewport.convert('RGB'),((600-viewport.width)//2,35))
    ImageDraw.Draw(panel).text((8,8),f'{action} game{game} / '+('actual final' if file.exists() else 'GUIDE ONLY')+f' / {len(regions)} regions',fill='white')
    panels.append(panel)
for start in range(0,len(panels),8):
    group=panels[start:start+8];gallery=Image.new('RGB',(2400,500*((len(group)+3)//4)),'#17253a')
    for i,panel in enumerate(group):gallery.paste(panel,(i%4*600,i//4*500))
    gallery.save(B/f'normal-{action}-contact-overlay-review-{start//8+1}.png')
record={'state':'manual_review_required_not_runtime_data','nativeAttacksSha256':sha(native_path),
    'referenceSha256':sha(ref_path),'sourceScriptSha256':native['sha256'],
    'coordinates':'Root regions use unchanged source top basis x=5*z,y=25-5*y. Posed tail regions remove Trans translation consistently with body art. Size*5 is an authored radius; native size/status/clock/patch parity unqualified.',
    'effect_limit':'Forward-smash disjoint electric attack needs a separate effect consumer; root contact circle is not body anatomy. Down-smash linker gaps remain empty. Charge-loop and kinetics are separate pending requirements.',
    'galleries':{f'normal-{action}-contact-overlay-review-{n}.png':sha(B/f'normal-{action}-contact-overlay-review-{n}.png') for n in range(1,(len(panels)+7)//8+1)},
    'rows':projections}
(OUT/f'{action}-contact-candidates.json').write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps({'action':action,'steps':len(projections),'regions':sum(len(r['regions']) for r in projections),'review':'pending'}))
