"""Prepare body-only Thunder art inputs; no GPU jobs or gameplay-clock claims."""
from pathlib import Path
import copy
import hashlib
import json
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
E = ROOT / 'docs/review/2026-10-06/pikachu-character'
B = E / 'art'
review_path = E / 'sources/thunder-native-body-review-padded/preparation.json'
review = json.loads(review_path.read_text())
if review['state'] != 'native_authoring_inputs_visually_reviewed':
    raise ValueError('Padded native body review required')
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
prep_path = B / 'thunder-pilot-preparation.json'
if prep_path.exists():
    raise ValueError('Prepared Thunder inputs are immutable; inspect existing records')
template = json.loads((B / 'fair-startup-source0-attempt1.workflow.json').read_text())
rows = []
panels = {}
for sample in review['rows']:
    metadata_path = ROOT / sample['metadata']
    if sha(metadata_path) != sample['metadataSha256']:
        raise ValueError('Changed native reference metadata')
    metadata = json.loads(metadata_path.read_text())
    prefix = metadata_path.with_suffix('')
    for name, expected in metadata['output_files'].items():
        if sha(metadata_path.parent / name) != expected:
            raise ValueError('Changed inspected native input')
    action, index = sample['action'], sample['nativeSample']
    key = f'{action}-sample{index}-source{index}'
    seed = Image.open(str(prefix)+'-palette-seed.png').convert('RGB')
    guide = Image.open(str(prefix)+'-guide.png').convert('RGB')
    anatomy = Image.open(str(prefix)+'-mask.png').convert('L')
    bounds = anatomy.getbbox()
    if seed.size != (2048, 2048) or metadata['root'] != [1024, 1664]:
        raise ValueError('Wrong padded Thunder coordinate contract')
    if bounds is None or min(bounds[0], bounds[1], 2048-bounds[2], 2048-bounds[3]) < 16:
        raise ValueError('Clipped Thunder guide')
    pixels = np.array(seed)
    red = (pixels[:, :, 0] > 160) & (pixels[:, :, 1] < 90) & (pixels[:, :, 2] < 65)
    protected = Image.fromarray(red.astype(np.uint8)*255).filter(ImageFilter.MaxFilter(9))
    mask = anatomy.filter(ImageFilter.MaxFilter(21)).filter(ImageFilter.GaussianBlur(2))
    mask = Image.fromarray(np.where(np.array(protected) > 0, 0, np.array(mask)).astype(np.uint8)).convert('RGB')
    for name, im in [('seed', seed), ('guide', guide), ('anatomy-mask', anatomy), ('render-mask', mask)]:
        im.save(B / f'{key}-{name}.png')
    graph = copy.deepcopy(template)
    uploads = {}
    for node, remote, local in [('10','guide','guide'), ('13','seed','seed'), ('16','mask','render-mask')]:
        filename = f'pf-pikachu-{key}-padded-qualification1-{remote}.png'
        graph[node]['inputs']['image'] = filename
        uploads[filename] = f'{key}-{local}.png'
    graph['4']['inputs']['text'] = (
        'Canonical Pikachu in the accepted clean outlined 2D cartoon identity and exact colored seed palette. '
        'One yellow mouse, two black-tipped ears with source occlusion, one attached lightning-shaped tail with brown base, short mouse limbs. '
        f'Exact {action} body pose from native sample{index}: preserve crouch or raised forepaws, head angle, front/back visibility and complete tall tail. '
        'Keep red cheeks distinct from brown tail/back markings; never invent visible eyes or paws on the back. '
        'Preserve silhouette, fixed canvas, body scale and root. Clean black anatomy outlines and simple flat cel shading. '
        'Uniform flat magenta background. Cloud, descending lightning and self-contact electrical burst are separate effects; '
        'do not bake clouds, electricity, shadows, weapons, labels or collision circles into this body drawing.')
    for node, kind in [('9','masked-final'), ('20','raw-diagnostic')]:
        graph[node]['inputs']['filename_prefix'] = f'pf-pikachu-20261007-{key}-attempt1-{kind}'
    workflow = f'{key}-attempt1.workflow.json'
    request = f'{key}-attempt1.request.json'
    (B/workflow).write_text(json.dumps(graph, indent=2)+'\n')
    (B/request).write_text(json.dumps({'prompt':graph, 'client_id':f'pf-pikachu-{key}'}, indent=2)+'\n')
    source = Path(str(prefix)+'-reference.png')
    row = {'key':key, 'action':action, 'motion':sample['motion'], 'source_index':index,
        'native_sample_index':index, 'pose':f'native-{index}', 'hold_game':None,
        'gameplay_frame_mapping':None,
        'source_kind':'Inspected native body reference; UFD summon/burst motion reviewed separately',
        'source_path':str(source.relative_to(ROOT)), 'source_sha256':sha(source),
        'native_reference_metadata':sample['metadata'], 'native_reference_metadata_sha256':sha(metadata_path),
        'root_registration':'remove-trans-translation',
        'presentation_holds':'Body samples only; gameplay entry/branch clocks and holds remain unresolved',
        'workflow':workflow, 'request':request, 'upload_mapping':uploads,
        'hashes':{name:sha(B/f'{key}-{name}.png') for name in ['seed','guide','render-mask']},
        'state':'prepared; actual generation input inspection required'}
    rows.append(row)
    crop = (bounds[0]-25, bounds[1]-25, bounds[2]+25, bounds[3]+25)
    panel = Image.new('RGB',(1600,550),'#17253a')
    for side, im in enumerate([seed, mask]):
        im = im.crop(crop); im.thumbnail((780,490))
        panel.paste(im,(side*800+(800-im.width)//2,40+(490-im.height)//2))
    ImageDraw.Draw(panel).text((8,8),key+' / padded seed + red-protected generation mask / body only',fill='white')
    panel_file = f'{key}-input-review.png'; panel.save(B/panel_file)
    row['input_review_sha256'] = sha(B/panel_file)
    panels.setdefault(action,[]).append(panel)
galleries = {}
for action, action_panels in panels.items():
    for batch in range(2):
        gallery = Image.new('RGB',(1600,2200),'#17253a')
        for i, panel in enumerate(action_panels[batch*4:(batch+1)*4]):
            gallery.paste(panel,(0,i*550))
        file = f'{action}-generation-input-gallery-{batch+1}.png'
        gallery.save(B/file); galleries[file] = sha(B/file)
record = {'state':'generation_inputs_pending_actual_review', 'records':rows,
    'coordinate_contract':{'canvas':[2048,2048], 'root':[1024,1664], 'world_scale':70/600,
        'top_padding':512, 'scale_and_world_root_unchanged':True},
    'nativeReview':str(review_path.relative_to(E)), 'nativeReviewSha256':sha(review_path),
    'galleries':galleries, 'limits':['Body art only; exact specials numeric gate still applies',
        'Cloud/bolt/burst separate authored art and runtime consumers pending',
        'Larger canvas requires one pilot render/inspection before expanding this batch',
        'No native integer/GIF index to gameplay frame identity assumed']}
prep_path.write_text(json.dumps(record,indent=2)+'\n')
(B/'thunder-generation-ledger.json').write_text('[]\n')
print(json.dumps({'prepared':len(rows), 'GPU_submission':False, 'visual_review':'pending'}))
