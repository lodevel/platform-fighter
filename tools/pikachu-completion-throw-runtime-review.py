#!/usr/bin/env python3
"""Prepare lossless actor AND victim throw crops; never accept visuals automatically."""
import argparse
import hashlib
import json
from pathlib import Path
from PIL import Image, ImageDraw

parser = argparse.ArgumentParser()
parser.add_argument('directory', type=Path)
args = parser.parse_args()
directory = args.directory
report_path = directory / 'throw-match-observations.json'
report = json.loads(report_path.read_text())
assert report['result'] == 'PASS', 'Complete actual throw behavior acceptance before final visual preparation'
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
checkpoint = report['build']['sourceHashes'].removesuffix('-source-hashes.json')
metadata_path = Path(checkpoint + '-pikachu-frames.json')
assert sha(metadata_path) == report['build']['pikachuFramesSha256']
review = {'state': 'ACTUAL_ACTOR_AND_TARGET_CROPS_PREPARED_REVIEW_PENDING',
          'bundleSha256': report['bundleSha256'], 'observationsSha256': sha(report_path),
          'metadataSha256': sha(metadata_path), 'rows': [], 'inspectionPages': [],
          'scope': 'Actual screenshot pixels only, independently camera-centred on actor and captive/released victim. No palette segmentation, hidden-body reconstruction, pose acceptance or native Have claim.'}
tiles = []
attachment_rows = []
for row in report['rows']:
    active = [o for o in row['trace'] if o['presentation']]
    assert active
    spec = active[0]['sourceSpec'][row['direction']]
    release = spec['animationFrames']
    captured_ages = {c['observation']['presentation']['framesElapsed'] for c in row['captures']
                     if c['observation'].get('presentation')}
    required = {release - 1, release, release + 1}
    for hit in spec.get('heldTargetHits', []):
        required.update([hit['frame'] - 1, hit['frame'], hit['frame'] + 1])
    required = {age for age in required if 0 <= age < spec['animationFrames'] + spec['recoveryFrames']}
    row_review = {'direction': row['direction'], 'facing': row['facing'], 'captures': [],
                  'releaseAge': release, 'boundaryCaptureAgesRequired': sorted(required),
                  'boundaryCaptureAgesMissing': sorted(required - captured_ages),
                  'nativeAttachmentClaim': False}
    if row.get('wall'):
        row_review['wall'] = row['wall']
    for observation in active:
        age = observation['presentation']['framesElapsed']
        actor, target = observation['actorBody'], observation['targetBody']
        assert actor['position'] == observation['actorPosition']
        assert target['position'] == observation['target']['position']
        attachment_rows.append({'direction': row['direction'], 'entryFacing': row['facing'], 'age': age,
                                'actorFacing': observation['actorFacing'],
                                'captured': observation['target']['captured'],
                                'relativePosition': {axis: target['position'][axis] - actor['position'][axis]
                                                     for axis in ['x', 'y']},
                                'grabHoldHitbox': observation.get('grabHoldHitbox'),
                                'actorPosition': actor['position'], 'targetPosition': target['position'],
                                'targetCapturePresentation': target['capture'],
                                'targetVelocity': observation['target']['velocity'],
                                'targetHitlag': observation['target']['hitlag'],
                                'targetPercent': observation['target']['percent'],
                                'wallFixture': bool(row.get('wall'))})
    for capture in row['captures']:
        source_path = directory / capture['screenshot']
        source = Image.open(source_path).convert('RGB')
        view = capture['view']
        camera, canvas = view['camera'], view['canvas']
        world = camera['worldView']
        pair = Image.new('RGB', (720, 250), '#202633')
        item = {'screenshot': capture['screenshot'], 'sha256': sha(source_path), 'view': view, 'bodies': []}
        age = (capture['observation'].get('presentation') or {}).get('framesElapsed')
        for side, who in enumerate(['actorBody', 'targetBody']):
            actor = capture['observation'][who]
            x = canvas['left'] + (camera['x'] + (actor['position']['x'] - world['x']) * camera['zoom']) * canvas['width'] / canvas['internalWidth']
            y = canvas['top'] + (camera['y'] + (actor['position']['y'] - world['y']) * camera['zoom']) * canvas['height'] / canvas['internalHeight']
            box = [round(x - 180), round(y - 100), round(x + 180), round(y + 100)]
            tile = Image.new('RGB', (360, 250), '#202633')
            tile.paste(source.crop(box), (0, 50))
            draw = ImageDraw.Draw(tile)
            draw.text((4, 4), f"{row['direction']} facing{row['facing']} age{age} {who}", fill='white')
            draw.text((4, 21), f"{actor['texture'].split('.')[-1]} cell{actor['textureFrame']} captured{capture['observation']['target']['captured']}", fill='white')
            pair.paste(tile, (side * 360, 0))
            body_record = {'who': who, 'crop': box, 'position': actor['position'], 'texture': actor['texture'],
                           'cell': actor['textureFrame'], 'rotation': actor['rotation'],
                           'scale': actor['scale'], 'origin': actor['origin'],
                           'flipX': actor['flipX'], 'flipY': actor['flipY']}
            item['bodies'].append(body_record)
            tiles.append((tile, {'direction': row['direction'], 'facing': row['facing'], 'age': age,
                                 'screenshot': capture['screenshot'], 'sha256': item['sha256'], **body_record}))
        name = Path(capture['screenshot']).stem + '-actor-target-review.png'
        pair.save(directory / name)
        item['pairGallery'] = {'file': name, 'sha256': sha(directory / name)}
        row_review['captures'].append(item)
    review['rows'].append(row_review)
for start in range(0, len(tiles), 24):
    group = tiles[start:start + 24]
    page = Image.new('RGB', (1440, ((len(group) + 3) // 4) * 250), '#202633')
    for index, (tile, _) in enumerate(group):
        page.paste(tile, ((index % 4) * 360, (index // 4) * 250))
    name = f'actor-target-inspection-page-{start // 24:02}.png'
    page.save(directory / name)
    review['inspectionPages'].append({'file': name, 'sha256': sha(directory / name),
                                    'bodies': [record for _, record in group]})
(directory / 'actor-target-visual-review-preparation.json').write_text(json.dumps(review, indent=2) + '\n')
(directory / 'actual-attachment-and-release-observations.json').write_text(json.dumps({
    'state': 'DIAGNOSTIC_MEASUREMENTS_NATIVE_ATTACHMENT_UNQUALIFIED',
    'bundleSha256': report['bundleSha256'], 'observationsSha256': sha(report_path),
    'scope': 'Actual beta fixed-offset holder/victim root positions, captured body selection and release velocity/hit-stop boundaries. Native Have/item-node attachment and orientation are not inferred from these offsets.',
    'rows': attachment_rows}, indent=2) + '\n')
print(json.dumps({'cases': len(review['rows']), 'screenshots': sum(len(r['captures']) for r in review['rows']),
                  'actualBodyCrops': len(tiles), 'pages': len(review['inspectionPages']),
                  'missingBoundaryCaptures': [{key: r[key] for key in ['direction', 'facing', 'boundaryCaptureAgesMissing']}
                                               for r in review['rows'] if r['boundaryCaptureAgesMissing']],
                  'actualVisualAcceptance': 'pending'}))
