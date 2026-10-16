"""Add reviewed DK Final owner clips without altering any earlier bank entry.

First run --stage-only and inspect the staged art. Installation requires the
exact reviewed art-clips.json SHA via --reviewed-art-sha256. Native source,
registration, atlas bounds, drawing/geometry pairs, and earlier content are
checked again immediately before the additive atomic metadata replacement.
"""
from pathlib import Path
import argparse
import hashlib
import json
import math
import os
import shutil

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
E = ROOT / 'docs/review/2026-10-15/dk-final'
STAGE = E / 'owner-art-staging'
TARGET = ROOT / 'assets/characters/donkeykong'
MOTIONS = ROOT / 'assets/gen/dk-native-reference/raw-motion/fighter/donkey/motion/body/c00'
sha = lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def checked_path(base, relative):
    require(isinstance(relative, str) and relative, 'Missing strip path')
    path = (base / relative).resolve()
    require(path.is_relative_to(base.resolve()), 'Strip escapes the asset directory')
    return path


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def valid_capsule(value):
    return (isinstance(value, dict) and all(finite(value.get(k, {}).get(axis)) for k in ['start', 'end'] for axis in ['x', 'y'])
            and finite(value.get('radius')) and value['radius'] >= 0)


def validate_clip(clip, drawing, shapes, plan):
    sheet = clip['sheet']
    require(drawing['nativeSampleIndices'] == shapes['nativeSampleIndices'] == clip['samples'], sheet + ': sample pairing')
    require(drawing['frameCount'] == len(clip['samples']) == len(shapes['hurtboxPoses']), sheet + ': drawing coverage')
    require(drawing['coordinateOrigin'] == shapes['coordinateOrigin'] == 'actorSourceRoot', sheet + ': source root')
    require(drawing['sourceSampleBasis'] == shapes['sourceSampleBasis'] == 'zero-based-native-index', sheet + ': clock basis')
    for key, value in [('root', plan['root']), ('frameWidth', plan['frameSize'][0]), ('frameHeight', plan['frameSize'][1]),
                       ('scaleToWorld', plan['scaleToWorld']), ('bodyCentreFromRootY', plan['bodyCentreFromRootY'])]:
        require(drawing[key] == value, sheet + ': altered registration ' + key)
    require(drawing['bodyCentreFromRootY'] == shapes['bodyCentreFromRootY'], sheet + ': body origin pairing')
    provenance = drawing['artProvenance']
    require(provenance['motionSha256'] == clip['motionSha256'] == sha(MOTIONS / (clip['motion'] + '.nuanmb')), sheet + ': motion changed')
    require(provenance['noPerPoseFloorSnap'] is True and provenance['rootRegistration'] == 'remove-trans-translation', sheet + ': root policy')
    require(provenance['fixedOutputResolutionFactor'] == plan['fixedOutputResolutionFactor'] == .5, sheet + ': fixed resolution')
    require(provenance['scaleContract'] == plan['scaleContract'], sheet + ': scale contract')
    require(math.isclose(plan['scaleToWorld'] * plan['pixelsPerNativeUnit'], 5, rel_tol=0, abs_tol=1e-12), sheet + ': native/world calibration')
    require(shapes['sourceProvenance']['motion']['sha256'] == clip['motionSha256'], sheet + ': geometry motion changed')
    require(len(drawing['trims']) == drawing['frameCount'], sheet + ': trim coverage')
    source = checked_path(STAGE, drawing['strip'])
    require(sha(source) == drawing['sha256'], sheet + ': strip changed')
    with Image.open(source) as image:
        require(list(image.size) == drawing['atlas'], sheet + ': actual atlas dimensions')
        require(image.mode == 'RGBA', sheet + ': RGBA art required')
    atlas_width, atlas_height = drawing['atlas']
    for trim in drawing['trims']:
        require(len(trim) == 6 and all(isinstance(v, int) and not isinstance(v, bool) for v in trim), sheet + ': trim fields')
        x, y, width, height, left, top = trim
        require(width > 0 and height > 0 and min(x, y, left, top) >= 0 and
                x + width <= atlas_width and y + height <= atlas_height and
                left + width <= drawing['frameWidth'] and top + height <= drawing['frameHeight'], sheet + ': trim bounds')
    expected_roles = {'dk-detection'} if sheet.endswith('_start') else {'dk-early', 'dk-late'} if sheet.endswith('_attack') else {'dk-finisher'}
    require(set(shapes['attackCollisionPosesByRole']) == expected_roles, sheet + ': source packet roles')
    for rows in [shapes['hurtboxPoses'], shapes['sourceAttachmentPoses'], shapes['sourceEffectPointPoses'],
                 *shapes['attackCollisionPosesByRole'].values()]:
        require([(r['artFrameIndex'], r['nativeSample']) for r in rows] == list(enumerate(clip['samples'])), sheet + ': unpaired geometry')
    require(len(shapes['sourceRootDelta']) == clip['nativeFinalFrameIndex'] + 1, sheet + ': root motion coverage')
    require(shapes['sourceRootDelta'][0] == {'x': 0, 'y': 0} and
            all(finite(p['x']) and finite(p['y']) for p in shapes['sourceRootDelta']), sheet + ': malformed root displacement')
    for row in shapes['hurtboxPoses']:
        boxes = row['hurtboxes']
        require(len(boxes) == 15 and len({box['id'] for box in boxes}) == 15, sheet + ': anatomical receiving inventory')
        require(all(valid_capsule(box.get('capsule')) and all(finite(box[k]) for k in ['offsetX', 'offsetY', 'width', 'height'])
                    and box['width'] >= 0 and box['height'] >= 0 for box in boxes), sheet + ': malformed receiving')
    for role, rows in shapes['attackCollisionPosesByRole'].items():
        expected_ids = list(range(1 if role == 'dk-detection' else 4 if role == 'dk-finisher' else 5))
        require(all([h['id'] for h in row['collisionHits']] == expected_ids and
                    all(valid_capsule(h.get('capsule')) for h in row['collisionHits']) for row in rows), sheet + ': malformed source packets')
    for row in shapes['sourceAttachmentPoses']:
        require([a['role'] for a in row['attachments']] == ['capture-anchor', 'waist'], sheet + ': missing anchor')
        require(all(finite(a['point']['x']) and finite(a['point']['y']) for a in row['attachments']), sheet + ': malformed anchor')
    for row in shapes['sourceEffectPointPoses']:
        require([p['bone'] for p in row['points']] == ['top', 'hip'] and
                all(finite(p['point']['x']) and finite(p['point']['y']) for p in row['points']), sheet + ': malformed FX registration')
    merged = {**{key: value for key, value in drawing.items() if key != 'drawingReceipts'}, **shapes}
    for key in ['frameWidth', 'frameHeight', 'root', 'scaleToWorld', 'bodyCentreFromRootY', 'trims', 'atlas']:
        require(merged[key] == drawing[key], sheet + ': geometry changed art registration')
    return merged, source, checked_path(TARGET, drawing['strip'])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--stage-only', action='store_true')
    parser.add_argument('--reviewed-art-sha256')
    args = parser.parse_args()
    plan = json.loads((E / 'owner-art-plan.json').read_text())
    geometry = json.loads((E / 'owner-geometry.json').read_text())
    art_path = STAGE / 'art-clips.json'
    art = json.loads(art_path.read_text())
    require(geometry['planSha256'] == sha(E / 'owner-art-plan.json'), 'Geometry plan changed; re-export')
    require(geometry['exporterSha256'] == sha(ROOT / 'tools/dk-final-geometry.py'), 'Geometry exporter changed; re-export')
    require(geometry['selectedPacketsSha256'] == sha(ROOT / 'src/finalSmash/selectedPackets.json'), 'Selected packets changed; re-export')
    require(geometry['authoredReceivingSha256'] == sha(ROOT / 'docs/review/2026-09-25/donkeykong-character/sources/authored-anatomical-capsules.json'), 'Authored receiving recipe changed')
    require(set(art) == set(geometry['clips']) == {c['sheet'] for c in plan['clips']}, 'Clip inventory mismatch')
    frames = TARGET / 'frames.json'
    before = frames.read_bytes()
    bank = json.loads(before)
    original = json.loads(before)
    additions, files = {}, []
    for clip in plan['clips']:
        sheet = clip['sheet']
        merged, source, dest = validate_clip(clip, art[sheet], geometry['clips'][sheet], plan)
        if sheet in bank['animations']:
            require(bank['animations'][sheet] == merged, sheet + ': refusing to replace an existing different clip')
            require(dest.exists() and sha(dest) == art[sheet]['sha256'], sheet + ': installed strip differs')
        else:
            if dest.exists():
                require(sha(dest) == art[sheet]['sha256'], sheet + ': refusing to replace different unregistered art')
            additions[sheet] = merged
            if not dest.exists():
                files.append((source, dest))
    bank['animations'].update(additions)
    require(all(bank[k] == v for k, v in original.items() if k != 'animations'), 'Earlier bank properties changed')
    require(all(bank['animations'][k] == v for k, v in original['animations'].items()), 'Earlier clip changed')
    if args.stage_only:
        candidate = STAGE / 'frames-candidate.json'
        candidate.write_text(json.dumps(bank, indent=2) + '\n')
        print(json.dumps({'candidate': str(candidate.relative_to(ROOT)), 'sha256': sha(candidate),
            'drawings': sum(art[k]['frameCount'] for k in art), 'reviewArtSha256': sha(art_path), 'installedAssetsChanged': False}))
        return
    require(args.reviewed_art_sha256 == sha(art_path), 'Pin the reviewed art-clips.json SHA with --reviewed-art-sha256')
    for source, dest in files:
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, dest)
        require(sha(source) == sha(dest), 'Asset copy changed')
    require(frames.read_bytes() == before, 'Concurrent metadata edit: retry additive merge against current bank')
    temporary = TARGET / 'frames.json.dk-final-stage'
    temporary.write_text(json.dumps(bank, indent=2) + '\n')
    os.replace(temporary, frames)
    receipt = {'schema': 'donkeykong-final-owner-install/1', 'beforeFramesSha256': hashlib.sha256(before).hexdigest(),
        'afterFramesSha256': sha(frames), 'artStageSha256': sha(art_path), 'geometrySha256': sha(E / 'owner-geometry.json'),
        'planSha256': sha(E / 'owner-art-plan.json'), 'addedClips': list(additions),
        'drawings': sum(art[k]['frameCount'] for k in art), 'preservedEveryPreviousClipAndTopLevelProperty': True,
        'sourceFidelity': geometry['precision'], 'gameChecksRun': False}
    (E / 'owner-install.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps(receipt))


if __name__ == '__main__':
    main()
