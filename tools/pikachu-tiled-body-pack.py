"""Pack actually accepted tiled bodies; runtime clocks come from explicit contracts."""
import argparse, hashlib, json
from pathlib import Path
from PIL import Image, ImageDraw
from pikachu_native_pose import ROOT, sha

E = ROOT / 'docs/review/2026-10-06/pikachu-character'
B = E / 'art'
OUT = ROOT / 'assets/characters/pikachu'
parser = argparse.ArgumentParser()
parser.add_argument('family')
parser.add_argument('--action')
parser.add_argument('--stage-idle-replacement', action='store_true')
parser.add_argument('--requalify-clock', action='store_true')
args = parser.parse_args()
if args.requalify_clock and (not args.action or args.stage_idle_replacement):
    raise ValueError('Clock requalification requires one explicit action and no staged replacement')
if args.stage_idle_replacement and (args.family != 'locomotion' or args.action != 'idle'):
    raise ValueError('Staged legacy replacement currently applies only to reviewed idle')
prepared = E / 'sources/full-body-native-review' / args.family / 'preparation.json'
sources = json.loads(prepared.read_text())['records']
tiles = json.loads((B / 'tiled-pilot-preparation.json').read_text())['records']
ledger = json.loads((B / 'tiled-generation-ledger.json').read_text())
clock_name = {'tilts': 'angled-tilt-runtime-clock-contract.json',
              'specials': 'special-body-runtime-clock-contract.json'}
clock = E / 'sources' / clock_name.get(args.family, 'state-runtime-clock-contract.json')
clock_bytes = clock.read_bytes()
clock_sha = hashlib.sha256(clock_bytes).hexdigest()
clock_snapshot = E / 'sources/clock-contract-snapshots' / (clock_sha + '.json')
clock_snapshot.parent.mkdir(exist_ok=True)
if clock_snapshot.exists():
    if clock_snapshot.read_bytes() != clock_bytes:
        raise ValueError('Immutable clock contract snapshot changed')
else:
    clock_snapshot.write_bytes(clock_bytes)
contract = json.loads(clock_bytes)
actions = contract['actions']
if args.family == 'tilts':
    actions = [{**r, 'action': 'forward-tilt-' + r['angle'],
                'preparedOrder': [x['key'] for x in sources if x['action'] == 'forward-tilt-' + r['angle']],
                'proposedFrameWindows': r['frameWindows'], 'loopDuration': None}
               for r in actions]
elif args.family == 'specials':
    qualified_routes = []
    for route in actions:
        ordered = [r['key'] for r in sources if r['action'] == route['action']]
        native = [r['native_sample_index'] for r in sources if r['action'] == route['action']]
        if native != route['native_source_order']:
            raise ValueError('Special clock contract differs from actual prepared source order')
        for phase in [route] + ([{**route, **route['additional_sheet']}] if 'additional_sheet' in route else []):
            windows = [{'startFrame': w['start_elapsed'], 'endFrame': w['end_elapsed'],
                        'artFrameIndex': ordered.index(w['source_key'])}
                       for w in phase['playable_sample_windows']]
            qualified_routes.append({**phase, 'preparedOrder': ordered, 'nativeSampleIndices': native,
                'proposedFrameWindows': windows,
                'loopDuration': 6 if phase.get('loop_contract') else None,
                'nativeWindows': phase['playable_sample_windows'],
                'runtimeConsumerStatus': 'qualified source-clock resolver; body runtime visual review pending'})
    actions = qualified_routes
else:
    actions = [r for r in actions if r['family'] == args.family]
if args.action:
    actions = [r for r in actions if r['action'] == args.action]
if not actions:
    raise ValueError('No explicit presentation contract')

for route in actions:
    cells, provenance = [], []
    size = None
    for key in route['preparedOrder']:
        source = next(r for r in sources if r['key'] == key)
        if source['native_sample_index'] != route['nativeSampleIndices'][len(cells)]:
            raise ValueError('Runtime contract relabels actual source sample: ' + key)
        if sha(ROOT / source['source_path']) != source['source_sha256']:
            raise ValueError('Changed source reference ' + key)
        matches = []
        for tile in tiles:
            for entry in ledger:
                if entry['pose_key'] != tile['key'] or entry['state'] != 'accepted':
                    continue
                record = tile if entry['attempt'] == 1 else tile['attempts'][str(entry['attempt'])]
                cell = next((r for r in record['cells'] if r['sourceKey'] == key), None)
                if cell:
                    matches.append((record, entry, cell))
        if not matches:
            raise ValueError('No actually accepted generated body ' + key)
        record, entry, cell = matches[-1]
        review = B / entry['review_file']
        if sha(review) != entry['review_sha256']:
            raise ValueError('Changed actual output review')
        body = B / entry['outputs']['cutout']['file']
        if sha(body) != entry['outputs']['cutout']['sha256']:
            raise ValueError('Changed accepted output')
        coords = record['coordinate_contract']
        width, height = coords['cell_canvas']
        x, y = cell['offset']
        image = Image.open(body).convert('RGBA')
        if list(image.size) != coords['canvas']:
            raise ValueError('Wrong reviewed atlas canvas')
        image = image.crop((x, y, x + width, y + height))
        image = image.resize((512, round(height * 512 / width)), Image.Resampling.LANCZOS)
        if size is not None and image.size != size:
            raise ValueError('Mixed packed cell dimensions')
        size = image.size
        cells.append(image)
        provenance.append({'sourceKey': key, 'nativeSample': source['native_sample_index'],
                           'sourceReferenceSha256': source['source_sha256'],
                           'atlas': str(body.relative_to(ROOT)), 'atlasSha256': sha(body),
                           'atlasCell': cell['index'], 'cellOffset': cell['offset'],
                           'uniformScale': 512 / width, 'sourceUniformScale': 512 / 2048,
                           'review': str(review.relative_to(ROOT)), 'reviewSha256': sha(review)})
    width, height = size
    columns = min(len(cells), 4096 // width)
    rows = (len(cells) + columns - 1) // columns
    if rows * height > 4096:
        raise ValueError('Reviewed source pack requires atlas partitioning beyond 4096px')
    strip = Image.new('RGBA', (width * columns, height * rows))
    for i, im in enumerate(cells):
        strip.paste(im, ((i % columns) * width, (i // columns) * height))
    target = OUT / 'animations' / (route['sheet'] + '.png')
    staged = B / 'tiled-body/staged-replacements'
    if args.stage_idle_replacement:
        staged.mkdir(parents=True, exist_ok=True)
        target = staged / 'idle.png'
    prior_snapshot = None
    if target.exists():
        if not args.requalify_clock:
            raise ValueError('Existing strip requires explicit evidence migration: ' + str(target))
        prior_path = OUT / 'pose-batches' / ('full-' + route['sheet'] + '-tiled.json')
        prior_bytes = prior_path.read_bytes()
        prior = json.loads(prior_bytes)
        if (prior['state'] != 'packed_cells_visually_reviewed_runtime_pending'
                or prior['sources'] != provenance
                or prior['animations'][route['sheet']]['sha256'] != sha(target)
                or Image.open(target).convert('RGBA').tobytes() != strip.tobytes()
                or Image.open(target).size != strip.size):
            raise ValueError('Clock-only requalification must preserve the exact reviewed body/source pixels')
        snapshot_dir = E / 'tiled-body/packed-metadata-snapshots'
        snapshot_dir.mkdir(exist_ok=True)
        prior_snapshot = snapshot_dir / (hashlib.sha256(prior_bytes).hexdigest() + '.json')
        if prior_snapshot.exists() and prior_snapshot.read_bytes() != prior_bytes:
            raise ValueError('Immutable prior packed metadata changed')
        prior_snapshot.write_bytes(prior_bytes)
    elif args.requalify_clock:
        raise ValueError('Clock-only requalification requires an existing reviewed body')
    else:
        strip.save(target)
    saved = Image.open(target).convert('RGBA')
    packed_cells = []
    for i, expected in enumerate(cells):
        x, y = (i % columns) * width, (i // columns) * height
        actual = saved.crop((x, y, x + width, y + height))
        if actual.tobytes() != expected.tobytes():
            raise ValueError('Actual saved atlas cell differs from reviewed crop')
        packed_cells.append(actual)
    gallery_dir = E / 'tiled-body/packed-preparation'
    gallery_dir.mkdir(parents=True, exist_ok=True)
    galleries = {}
    for start in range(0, len(cells), 4):
        group = packed_cells[start:start + 4]
        gallery = Image.new('RGB', (width * 2, (height + 36) * len(group)), '#17253a')
        for i, im in enumerate(group):
            ImageDraw.Draw(gallery).text((8, i * (height + 36) + 8),
                f'{route["sheet"]} actual cell{start+i} native{route["nativeSampleIndices"][start+i]}', fill='white')
            for side, color in enumerate(['#f7f5ef', '#17253a']):
                bg = Image.new('RGBA', size, color)
                bg.alpha_composite(im)
                gallery.paste(bg.convert('RGB'), (side * width, i * (height + 36) + 30))
        path = gallery_dir / f'{route["sheet"]}-cells-{start//4+1}.png'
        gallery.save(path)
        galleries[str(path.relative_to(ROOT))] = sha(path)
    metadata = {'state': 'packed_output_visual_and_runtime_review_required',
        'coordinateContract': {'canonicalCanvas': [2048, height * 4], 'canonicalRoot': [1024, 1664],
            'frameWidth': width, 'frameHeight': height, 'root': [256, 416],
            'scaleToWorld': 4 * 70 / 600, 'bodyCentreFromRoot': [0, -25]},
        'clockContract': str(clock.relative_to(ROOT)), 'clockContractSha256': clock_sha,
        'clockContractSnapshot': str(clock_snapshot.relative_to(ROOT)),
        'animations': {route['sheet']: {'strip': 'animations/idle.png' if args.stage_idle_replacement else str(target.relative_to(OUT)), 'frameCount': len(cells),
            'sha256': sha(target), 'columns': columns, 'rows': rows,
            'frameWindows': route['proposedFrameWindows'],
            'loopDuration': route['loopDuration'], 'nativeSampleIndices': route['nativeSampleIndices'],
            'nativeWindows': route.get('nativeWindows'),
            'drawingFacingBinding': route.get('drawingFacingBinding'),
            'holdRule': route.get('holdRule'),
            'specialPhase': route.get('phase'), 'specialClockKind': route.get('clock_kind'),
            'dynamicCutoff': route.get('dynamic_cutoff'),
            'playableEndExclusive': route.get('playable_max_local_end_exclusive'),
            'runtimeBindingStatus': route.get('runtimeConsumerStatus', 'angled move consumer prepared')}},
        'sources': provenance, 'galleries': galleries,
        'limits': ['Actual packed-cell inspection required before aggregate registration.',
                   'Authored beta presentation windows do not establish native status rate parity.',
                   'Actual running-game qualification remains separate.']}
    path = OUT / 'pose-batches' / ('full-' + route['sheet'] + '-tiled.json')
    if prior_snapshot:
        metadata['priorPackedMetadataSnapshot'] = str(prior_snapshot.relative_to(ROOT))
        metadata['requalificationScope'] = 'Declared clock metadata only; exact body/source pixels preserved. New window/receiving/runtime qualification still required.'
    if args.stage_idle_replacement:
        metadata['stagedReplacement'] = {'candidateStrip': str(target.relative_to(ROOT)),
            'existingStrip': 'assets/characters/pikachu/animations/idle.png',
            'existingStripSha256': sha(OUT / 'animations/idle.png'),
            'reason': 'Replace prior reviewed static idle with all five actual native idle body samples after actual packed review.'}
        path = staged / 'full-idle-tiled.json'
    path.write_text(json.dumps(metadata, indent=2) + '\n')
    print(json.dumps({'sheet': route['sheet'], 'cells': len(cells), 'actualPackedReview': 'pending'}))
