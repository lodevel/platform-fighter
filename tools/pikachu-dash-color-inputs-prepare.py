"""Version dash conditioning masks to protect inspected red seed markings.

Changes generation inputs only. Submitted first attempts remain immutable;
their correction needs explicit output rejection and new input visual review.
"""
from pathlib import Path
import argparse
import copy, hashlib, json
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT=Path(__file__).resolve().parent.parent
B=ROOT/'docs/review/2026-10-06/pikachu-character/art'
parser=argparse.ArgumentParser()
parser.add_argument('action',nargs='?',default='dash-attack',choices=['dash-attack','forward-smash','up-smash','down-smash'])
action=parser.parse_args().action
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
prep_path=B/'normal-pilot-preparation.json'
prep=json.loads(prep_path.read_text())
ledger=json.loads((B/'normal-generation-ledger.json').read_text())
rows=[r for r in prep['records'] if r['action']==action]
if not rows:raise ValueError('Missing prepared action '+action)
if any(r['pose_key'] in {row['key'] for row in rows} and (r['state']=='accepted' or r['attempt']>1) for r in ledger):
    raise ValueError('Reviewed/previous correction inputs are immutable; do not repeat this preparation')
review=[]
for row in rows:
    key=row['key']
    submitted=any(r['pose_key']==key for r in ledger)
    version=2 if submitted else 1
    variant=f'{key}-color-protected-attempt{version}'
    original=copy.deepcopy(row.get('original_inputs',row))
    original.pop('attempts',None)
    seed_path=B/(key+'-seed.png')
    seed=np.array(Image.open(seed_path).convert('RGB'))
    red=(seed[:,:,0]>160)&(seed[:,:,1]<90)&(seed[:,:,2]<65)
    # Occluded faces can legitimately expose no red cheek pixels.
    if action=='dash-attack':assert int(red.sum())>20,key
    protected=Image.fromarray((red.astype(np.uint8)*255)).filter(ImageFilter.MaxFilter(9))
    original_mask=np.array(Image.open(B/(key+'-render-mask.png')).convert('L'))
    mask=np.where(np.array(protected)>0,0,original_mask).astype(np.uint8)
    mask_path=B/(variant+'-render-mask.png')
    Image.fromarray(mask).convert('RGB').save(mask_path)
    graph=json.loads((B/(key+'-attempt1.workflow.json')).read_text())
    graph['16']['inputs']['image']=f'pf-pikachu-{variant}-render-mask.png'
    graph['4']['inputs']['text']+=' Visible cheek markings are bright red, distinct from the brown tail base/back stripes. Protected original cheek colors must remain unchanged.'
    for node,kind in [('9','masked-final'),('20','raw-diagnostic')]:
        graph[node]['inputs']['filename_prefix']=f'pf-pikachu-20261007-{variant}-{kind}'
    workflow=variant+'.workflow.json';request=variant+'.request.json'
    (B/workflow).write_text(json.dumps(graph,indent=2)+'\n')
    (B/request).write_text(json.dumps({'prompt':graph,'client_id':f'pf-pikachu-{variant}'},indent=2)+'\n')
    candidate={**original,'workflow':workflow,'request':request,
        'input_files':{'seed':key+'-seed.png','guide':key+'-guide.png','render-mask':mask_path.name},
        'upload_mapping':{name:file for name,file in original['upload_mapping'].items() if not name.endswith('-mask.png')},
        'hashes':{**original['hashes'],'render-mask':sha(mask_path)},
        'state':'prepared; color mask visual review required',
        'correction':'Preserve original inspected red cheek pixels through a bounded black exclusion in the conditioning/composite mask; no existing output edited.',
        'protected_pixels':int((np.array(protected)>0).sum())}
    candidate['upload_mapping'][f'pf-pikachu-{variant}-render-mask.png']=mask_path.name
    if submitted:
        row.setdefault('attempts',{})[str(version)]=candidate
    else:
        row['original_inputs']=original
        row.update(candidate)
    # Tight comparison panel of seed and actual versioned mask.
    bounds=Image.open(B/(key+'-anatomy-mask.png')).getbbox()
    crop=(bounds[0]-25,bounds[1]-25,bounds[2]+25,bounds[3]+25)
    panel=Image.new('RGB',(1600,560),'#17253a');draw=ImageDraw.Draw(panel)
    for side,path in enumerate([seed_path,mask_path]):
        im=Image.open(path).convert('RGB').crop(crop);im.thumbnail((780,500))
        panel.paste(im,(side*800+(800-im.width)//2,40+(500-im.height)//2))
    draw.text((8,8),variant+' / seed red markings protected in black mask exclusions; inputs only',fill='white')
    panel_path=B/(variant+'-input-review.png');panel.save(panel_path)
    review.append({'key':key,'attempt':version,'submitted_first_attempt':submitted,
        'mask_sha256':sha(mask_path),'panel':panel_path.name,'panel_sha256':sha(panel_path),
        'protected_pixels':candidate['protected_pixels']})
prep_path.write_text(json.dumps(prep,indent=2)+'\n')
(B/f'{action}-color-protection-preparation.json').write_text(json.dumps({'state':'manual_input_review_required','rows':review},indent=2)+'\n')
for start in range(0,len(review),4):
    group=review[start:start+4];gallery=Image.new('RGB',(1600,560*len(group)))
    for i,r in enumerate(group):gallery.paste(Image.open(B/r['panel']),(0,i*560))
    gallery.save(B/f'{action}-color-protection-gallery-{start//4+1}.png')
print(json.dumps({'inputs':len(review),'submitted_corrections':sum(r['submitted_first_attempt'] for r in review),'review':'pending'}))
