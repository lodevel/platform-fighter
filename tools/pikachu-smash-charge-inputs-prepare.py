"""Prepare reviewed native charge guides for the established local art recipe.

No GPU submission or acceptance. Charge clips are distinct source resources;
native-reference images here must never be described as UFD charge captures.
"""
from pathlib import Path
import copy, hashlib, json
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
B = ROOT / 'docs/review/2026-10-06/pikachu-character/art'
G = ROOT / 'assets/gen/pikachu-native-reference/geometry-reference'
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
prep_path = B / 'normal-pilot-preparation.json'
prep = json.loads(prep_path.read_text())
review = json.loads((B / 'smash-charge-native-guide-review.json').read_text())
if review['state'] != 'native_authoring_inputs_visually_reviewed':
    raise ValueError('Native charge guide review required')
template = json.loads((B / 'fair-startup-source0-attempt1.workflow.json').read_text())
rows = []
for action, motion in [('forward-smash', 'c03attacks4charge'),
                      ('up-smash', 'c04attackhi4charge'),
                      ('down-smash', 'c04attacklw4charge')]:
    for index, sample in enumerate([0, 15, 30, 45, 60]):
        key = f'normal-{action}-charge-sample-{sample}-source{sample}'
        if any(r['key'] == key for r in prep['records']):
            raise ValueError('Existing charge input is immutable: ' + key)
        prefix = G / f'{action}-charge-sample{sample}-canvas1536-negative-remove-trans-translation'
        metadata = json.loads(prefix.with_suffix('.json').read_text())
        reviewed = next(r for r in review['samples'] if r['action'] == action and r['sample'] == sample)
        if reviewed['metadataSha256'] != sha(prefix.with_suffix('.json')):
            raise ValueError('Changed native charge guide')
        if metadata['canvas'] != [2048, 1536] or metadata['root'] != [1024, 1152]:
            raise ValueError('Wrong charge guide canvas/root')
        seed = Image.open(str(prefix) + '-palette-seed.png').convert('RGB')
        guide = Image.open(str(prefix) + '-guide.png').convert('RGB')
        anatomy = Image.open(str(prefix) + '-mask.png').convert('L')
        bounds = anatomy.getbbox()
        if bounds is None or min(bounds[0], bounds[1], 2048-bounds[2], 1536-bounds[3]) < 16:
            raise ValueError('Clipped charge guide')
        pixels = np.array(seed)
        red = (pixels[:, :, 0] > 160) & (pixels[:, :, 1] < 90) & (pixels[:, :, 2] < 65)
        protected = Image.fromarray(red.astype(np.uint8)*255).filter(ImageFilter.MaxFilter(9))
        mask = anatomy.filter(ImageFilter.MaxFilter(21)).filter(ImageFilter.GaussianBlur(2))
        mask = Image.fromarray(np.where(np.array(protected) > 0, 0, np.array(mask)).astype(np.uint8)).convert('RGB')
        for name, im in [('seed', seed), ('guide', guide), ('anatomy-mask', anatomy), ('render-mask', mask)]:
            im.save(B / f'{key}-{name}.png')
        graph = copy.deepcopy(template)
        uploads = {}
        for node, remote, local in [('10', 'guide', 'guide'), ('13', 'seed', 'seed'), ('16', 'mask', 'render-mask')]:
            filename = f'pf-pikachu-{key}-qualification1-{remote}.png'
            graph[node]['inputs']['image'] = filename
            uploads[filename] = f'{key}-{local}.png'
        graph['4']['inputs']['text'] = ('Canonical Pikachu in the accepted clean outlined 2D cartoon identity and exact colored seed palette. '
            'One yellow mouse, two black-tipped ears with source occlusion, one attached lightning tail with brown base, short mouse limbs. '
            f'Exact {action} charge preparation pose from the native charge clip: preserve body lean, compressed paws, head angle, face/back visibility and tail position. '
            'Original red cheeks stay red, distinct from brown tail/back markings. Preserve silhouette, fixed canvas and root; no extra or detached parts, no eyes through the back. '
            'Clean black anatomy outlines and simple flat cel shading. Uniform flat magenta background. Charge/electric effects are separate; no lightning, shadows, weapons, labels or collision circles.')
        for node, kind in [('9', 'masked-final'), ('20', 'raw-diagnostic')]:
            graph[node]['inputs']['filename_prefix'] = f'pf-pikachu-20261007-{key}-attempt1-{kind}'
        workflow = f'{key}-attempt1.workflow.json'
        request = f'{key}-attempt1.request.json'
        (B/workflow).write_text(json.dumps(graph, indent=2)+'\n')
        (B/request).write_text(json.dumps({'prompt': graph, 'client_id': f'pf-pikachu-{key}'}, indent=2)+'\n')
        source = Path(str(prefix)+'-reference.png')
        row = {'key': key, 'action': action+'-charge', 'motion': motion, 'source_index': sample,
            'pose': f'charge-{sample}', 'start_elapsed': sample, 'end_elapsed': sample+15 if sample < 60 else 61,
            'hold_game': [sample+1, sample+15 if sample < 60 else 61],
            'source_kind': 'native charge guide; no UFD charge sample implied',
            'source_path': str(source.relative_to(ROOT)), 'source_sha256': sha(source),
            'native_reference_metadata': str(prefix.with_suffix('.json').relative_to(ROOT)),
            'native_reference_metadata_sha256': sha(prefix.with_suffix('.json')),
            'native_guide_limits': 'Authored orthographic camera; helper/material effects omitted; native status/hold/keep clock unqualified',
            'root_registration': 'remove-trans-translation',
            'presentation_holds': 'Five authored native charge samples; full power pose60 can hold. Exact paused-frame/keep120 consumer pending.',
            'workflow': workflow, 'request': request, 'upload_mapping': uploads,
            'hashes': {name: sha(B/f'{key}-{name}.png') for name in ['seed', 'guide', 'render-mask']},
            'state': 'prepared; charge input visual review required'}
        prep['records'].append(row)
        crop = (bounds[0]-25, bounds[1]-25, bounds[2]+25, bounds[3]+25)
        panel = Image.new('RGB', (1600, 550), '#17253a')
        for side, im in enumerate([seed, mask]):
            im = im.crop(crop); im.thumbnail((780, 490))
            panel.paste(im, (side*800+(800-im.width)//2, 40+(490-im.height)//2))
        ImageDraw.Draw(panel).text((8, 8), key+' / native charge seed and red-protected generation mask / inputs only', fill='white')
        filename = key+'-input-review.png'; panel.save(B/filename)
        rows.append({'key': key, 'action': action+'-charge', 'panel': filename, 'panelSha256': sha(B/filename),
                     'maskSha256': row['hashes']['render-mask']})
    group = [r for r in rows if r['action'] == action+'-charge']
    for start in range(0, len(group), 4):
        selected = group[start:start+4]; gallery = Image.new('RGB', (1600, 550*len(selected)))
        for i, row in enumerate(selected): gallery.paste(Image.open(B/row['panel']), (0, i*550))
        gallery.save(B/f'{action}-charge-generation-input-gallery-{start//4+1}.png')
prep_path.write_text(json.dumps(prep, indent=2)+'\n')
(B/'smash-charge-generation-input-preparation.json').write_text(json.dumps({'state': 'manual_review_required', 'rows': rows}, indent=2)+'\n')
print(json.dumps({'prepared': len(rows), 'renderer_submission': False, 'visual_acceptance': 'pending'}))
