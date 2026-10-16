"""Stage complete reviewed standing grab + independent ordinary pull/hold.

No production writes. All drawing/receiving review pins must exist before this
builder runs. A reviewed body-input marker never qualifies actual gameplay.
"""
from pathlib import Path
import argparse
import copy
import hashlib
import json
import math
import shutil

ROOT = Path(__file__).resolve().parents[1]
AGES = [0, 3, 6, 7, 8, 9, 10, 23, 32, 37]
SOURCE = ROOT / 'docs/review/2026-10-06/dk-all-attack-values/sources/Catch.txt'
SOURCE_SHA = '4c668ab1aee02e43ab38a96d778918a3b374f5c3900295b3545df51d24d283ee'
CATCHES = [{'id': 0, 'situation': 'ground', 'capsule': {'start': {'x': 20., 'y': 7.}, 'end': {'x': 68.5, 'y': 7.}, 'radius': 29.}},
           {'id': 1, 'situation': 'air', 'capsule': {'start': {'x': 5.5, 'y': 7.}, 'end': {'x': 83., 'y': 7.}, 'radius': 14.5}}]
APP14_RECEIVING = ROOT / 'docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/art/grabpilot-grab-native8-quarter-branchcore1-receiving-candidate.json'
APP14_RECEIVING_SHA = 'd0658da1f7db166da7420dcc77f2db28952b6abe85929e0e1a1bccda6e4aa113'
SOURCE_CATCH_PACKET = ROOT / 'docs/review/2026-09-25/donkeykong-character/completion-2026-10-08/mechanics/catch-exact-source-overlays/exact-source-pilot-catch-rows.json'
SOURCE_CATCH_PACKET_SHA = '4e06a6ae7b4ae8fa621b7c4d04f08b60cedaa1b0c04ec023b5feb9f48badf414'
APP14_META = ROOT / 'assets/characters/donkeykong/frames.json'
APP14_META_SHA = 'c257b7bbdd09029d9c0fddc850a0882d4ab2f47e97858e253f5c37d89a893169'
APP14_LEGACY_GRAB = ROOT / 'assets/characters/donkeykong/animations/grab.png'
APP14_LEGACY_GRAB_SHA = 'cf986d94a303155643e204e26a094a8ffd80ab7cba233b9240bdf1e1b1d06f2f'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def pinned(record):
    if not isinstance(record, dict) or not isinstance(record.get('path'), str) or not record['path']:
        raise ValueError('Every input requires a nonempty exact path/hash pin')
    path = ROOT / record['path']
    if sha(path) != record.get('sha256'):
        raise ValueError(f'Input pin changed: {path}')
    return path


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def validate_hurtboxes(boxes):
    if not isinstance(boxes, list) or not boxes:
        raise ValueError('Each actual drawing needs its own nonempty receiving')
    ids = set()
    for box in boxes:
        if not isinstance(box, dict) or not isinstance(box.get('id'), str) or not box['id'].strip() or box['id'] in ids:
            raise ValueError('Invalid/duplicate receiving ID')
        ids.add(box['id'])
        if any(not finite(box.get(k)) for k in ['offsetX', 'offsetY', 'width', 'height']) or box['width'] <= 0 or box['height'] <= 0:
            raise ValueError('Invalid receiving bounds')
        c = box.get('capsule')
        if c is not None:
            if not isinstance(c, dict) or not finite(c.get('radius')) or c['radius'] <= 0 or any(
                    not isinstance(c.get(p), dict) or not all(finite(c[p].get(axis)) for axis in ['x', 'y']) for p in ['start', 'end']):
                raise ValueError('Invalid receiving capsule')


def reviewed_rows(manifest, review, expected, clip):
    rows = manifest['rows']
    if len(rows) != len(expected) or len(review.get('rows', [])) != len(expected):
        raise ValueError('Complete exact row count required; no pending placeholders')
    ordered = []
    for index, native in enumerate(expected):
        found = [r for r in rows if r.get('clip') == clip and r.get('artFrameIndex') == index and r.get('nativeSample') == native]
        accepted = [r for r in review['rows'] if r.get('clip') == clip and r.get('artFrameIndex') == index and r.get('nativeSample') == native]
        if len(found) != 1 or len(accepted) != 1:
            raise ValueError('Missing, duplicate or wrong native/art row')
        row, own = found[0], accepted[0]
        for k in ['quarterTarget', 'receivingCandidate', 'staticReview', 'receivingReview']:
            pinned(row[k])
            if own.get(k) != row[k]:
                raise ValueError(f'Body-input review does not bind exact own {k}')
        if own.get('staticAccepted') is not True or own.get('receivingAccepted') is not True:
            raise ValueError('Actual static and receiving review required on every own row')
        ordered.append(row)
    return ordered


def receiving(row):
    packet = json.loads(pinned(row['receivingCandidate']).read_text())
    if packet.get('targetImageSha256') != row['quarterTarget']['sha256'] or packet.get('nativeSample') != row['nativeSample']:
        raise ValueError('Receiving belongs to a different target/source pose')
    if packet.get('root') != [128, 208] or abs(packet.get('scaleToWorld', 0) - 5 / 6.5) > 1e-12 or packet.get('bodyCentreFromRootY') != -42:
        raise ValueError('Receiving registration differs from accepted quarter target')
    poses = packet['hurtboxPoses']
    if len(poses) != 1 or poses[0].get('nativeSample') != row['nativeSample']:
        raise ValueError('Require one own selected receiving sample')
    # Existing APP14 native8 sample is retained byte-for-byte except atlas index.
    expected_old_index = 0 if row['nativeSample'] == 8 else row['artFrameIndex']
    if poses[0].get('artFrameIndex') != expected_old_index:
        raise ValueError('Receiving art index requires its own validated restamp')
    boxes = copy.deepcopy(poses[0]['hurtboxes'])
    validate_hurtboxes(boxes)
    if row['nativeSample'] == 8:
        retained = json.loads(APP14_RECEIVING.read_text())
        if packet.get('targetImageSha256') != retained['targetImageSha256'] or boxes != retained['hurtboxPoses'][0]['hurtboxes']:
            raise ValueError('Native8 must reuse exact APP14 accepted target/receiving geometry')
    return {'artFrameIndex': row['artFrameIndex'], 'nativeSample': row['nativeSample'], 'hurtboxes': boxes}


def pack(rows, output):
    from PIL import Image
    atlas = Image.new('RGBA', (384 * len(rows), 256))
    for i, row in enumerate(rows):
        image = Image.open(pinned(row['quarterTarget'])).convert('RGBA')
        if image.size != (384, 256):
            raise ValueError('All accepted strip cells must be exactly384x256')
        atlas.paste(image, (384 * i, 0))  # Exact RGBA copy; no alpha composition/resampling.
    atlas.save(output)
    return sha(output)


def metadata(rows, output, review_key):
    poses = [receiving(r) for r in rows]
    windows = [{'startFrame': age, 'endFrame': AGES[i + 1] if i + 1 < 10 else 38,
                'artFrameIndex': i} for i, age in enumerate(AGES)]
    catches = [{'artFrameIndex': i, 'nativeSample': age + 1,
                'regions': [{k: copy.deepcopy(hit[k]) for k in ['id', 'capsule']} for hit in CATCHES] if 7 <= age < 10 else []}
               for i, age in enumerate(AGES)]
    return {'strip': 'animations/grab.png', 'sha256': sha(output), 'frameWidth': 384, 'frameHeight': 256,
        'frameCount': 10, 'columns': 10, 'rows': 1, 'sourceCells': [[i, 0] for i in range(10)],
        'root': [128, 208], 'scaleToWorld': 5 / 6.5, 'bodyCentreFromRootY': -42,
        'frameWindows': windows, 'loopDuration': None, 'nativeSampleIndices': [a + 1 for a in AGES],
        'hurtboxPoses': poses, 'catchCollisionPoses': catches,
        'pairedGrabTimeline': {'variant': 'standing', 'startupFrames': 7, 'activeFrames': 3,
            'recoveryFrames': 28, 'reviewedInputs': True, 'bodyReviewKey': review_key},
        'sourceCatchContract': {'script': {'path': str(SOURCE.relative_to(ROOT)), 'sha256': SOURCE_SHA},
            'activeHalfOpen': [7, 10], 'nativeCreateFrame': 8, 'nativeClearFrame': 11,
            'sourceIdSituationRows': CATCHES, 'runtimeScalarOwner': 'active actual GrabSpec collisionHits',
            'metadataOwnership': 'geometry only; native IDs/situation masks/status/timing retained by source producer'},
        'reviewedBodyInputs': rows, 'wholeActionRuntimeQualified': False}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--standing-manifest', type=Path, required=True)
    parser.add_argument('--body-review', type=Path, required=True)
    parser.add_argument('--expected-body-review-sha256', required=True)
    parser.add_argument('--ordinary-manifest', type=Path, required=True)
    parser.add_argument('--ordinary-review', type=Path, required=True)
    parser.add_argument('--expected-ordinary-review-sha256', required=True)
    parser.add_argument('--grip-calibration', type=Path, required=True)
    parser.add_argument('--expected-grip-calibration-sha256', required=True)
    parser.add_argument('--output-dir', type=Path, required=True)
    parser.add_argument('--cpu-slot-released', action='store_true')
    args = parser.parse_args()
    if not args.cpu_slot_released:
        raise ValueError('Coordinator must release packing CPU slot after all inputs are reviewed')
    destination = args.output_dir.resolve()
    if destination == ROOT / 'assets/characters/donkeykong' or ROOT / 'assets' in destination.parents or ROOT / 'src' in destination.parents:
        raise ValueError('Candidate builder cannot write production/assets tree')
    if destination.exists():
        raise ValueError('Preserve any prior candidate/partial output directory')
    if sha(SOURCE) != SOURCE_SHA or sha(SOURCE_CATCH_PACKET) != SOURCE_CATCH_PACKET_SHA or sha(APP14_RECEIVING) != APP14_RECEIVING_SHA:
        raise ValueError('Pinned native CATCH script changed')
    if sha(APP14_META) != APP14_META_SHA or sha(APP14_LEGACY_GRAB) != APP14_LEGACY_GRAB_SHA:
        raise ValueError('Historical APP14 generic grab fallback bytes changed')
    historical_grab = copy.deepcopy(json.loads(APP14_META.read_text())['animations']['grab'])
    source_pose = [p for p in json.loads(SOURCE_CATCH_PACKET.read_text())['poses'] if p['clip'] == 'grab']
    if len(source_pose) != 1 or source_pose[0]['collisionHits'] != CATCHES or source_pose[0]['sourceActiveHalfOpen'] != [7, 10]:
        raise ValueError('Independent source-normalized IDs/situations/geometry/window differ')
    review_pin = {'path': str(args.body_review.resolve().relative_to(ROOT)), 'sha256': args.expected_body_review_sha256}
    review = json.loads(pinned(review_pin).read_text())
    if review.get('state') != 'COMPLETE_STANDING_GRAB_BODY_INPUTS_ACCEPTED':
        raise ValueError('Whole ten-sample body input review has not been completed')
    rows = reviewed_rows(json.loads(args.standing_manifest.read_text()), review, [age + 1 for age in AGES], 'grab')
    ordinary_pin = {'path': str(args.ordinary_review.resolve().relative_to(ROOT)), 'sha256': args.expected_ordinary_review_sha256}
    ordinary_review = json.loads(pinned(ordinary_pin).read_text())
    if ordinary_review.get('state') != 'ORDINARY_PULL_HOLD_BODY_INPUTS_ACCEPTED':
        raise ValueError('Independent pull/hold body input review required')
    ordinary_manifest = json.loads(args.ordinary_manifest.read_text())
    if len(ordinary_manifest['rows']) != 2 or len(ordinary_review['rows']) != 2:
        raise ValueError('Exactly independent pull/hold samples required')
    ordinary = []
    for clip in ['grab_pull', 'grab_hold']:
        m = {'rows': [r for r in ordinary_manifest['rows'] if r.get('clip') == clip]}
        v = {'rows': [r for r in ordinary_review['rows'] if r.get('clip') == clip]}
        ordinary.append(reviewed_rows(m, v, [1], clip)[0])
    calibration_pin = {'path': str(args.grip_calibration.resolve().relative_to(ROOT)), 'sha256': args.expected_grip_calibration_sha256}
    calibration = json.loads(pinned(calibration_pin).read_text())
    if any(not isinstance(calibration.get(k), str) or not calibration[k].strip() for k in ['profileKey', 'revision']):
        raise ValueError('Reviewed grip calibration requires exact nonempty profile identity/revision')
    # Clip rows own grips. Installing full calibration.grips as well would
    # deliberately trip Character's duplicate-match fallback.
    captor_identity = {k: calibration[k] for k in ['profileKey', 'revision']}
    grips = []
    for clip in ['grab_pull', 'grab_hold']:
        match = [g for g in calibration['grips'] if g.get('poseKey') == clip and g.get('context') == 'ordinary-held']
        if len(match) != 1 or match[0].get('artFrameIndex') != 0 or match[0].get('nativeSample') != 1 or match[0].get('dimensions') != {'width': 60, 'height': 84} or match[0].get('provenance') != 'authored-reviewed-target' or match[0].get('profileKey') != calibration.get('profileKey') or match[0].get('occlusion') != 'recipient-back' or match[0].get('facingPolicy') != 'preserve-recipient' or not isinstance(match[0].get('point'), dict) or not all(finite(match[0]['point'].get(k)) for k in ['x', 'y']):
            raise ValueError('Exact reviewed own native1 pull/hold grip required')
        grips.append(copy.deepcopy(match[0]))
    # Prevalidate all receiving before any image imports or candidate output.
    for row in rows + ordinary:
        receiving(row)
    destination.mkdir(parents=True)
    pack(rows, destination / 'grab.png')
    animations = {'grab': metadata(rows, destination / 'grab.png', args.expected_body_review_sha256)}
    # Shared DK generic fallbacks must not leak complete standing drawing into
    # missing dash/pivot ages. Preserve exact old pixels and descriptor fields.
    shutil.copyfile(APP14_LEGACY_GRAB, destination / 'review_legacy_grab.png')
    historical_grab['strip'] = 'animations/review_legacy_grab.png'
    animations['review_legacy_grab'] = historical_grab
    for i, row in enumerate(ordinary):
        clip = row['clip']; target = destination / f'{clip}.png'; pack([row], target)
        animations[clip] = {'strip': f'animations/{clip}.png', 'sha256': sha(target),
            'frameWidth': 384, 'frameHeight': 256, 'frameCount': 1, 'root': [128, 208],
            'scaleToWorld': 5 / 6.5, 'bodyCentreFromRootY': -42, 'sourceCells': [[0, 0]],
            'frameWindows': [{'startFrame': 0, 'endFrame': None, 'artFrameIndex': 0}], 'loopDuration': None,
            'hurtboxPoses': [receiving(row)], 'captureGripPoses': [grips[i]],
            'bodyReviewKey': args.expected_ordinary_review_sha256,
            'captureClockCalibration': {'policy': 'selected native1 static body holds under existing ordinary capture route',
                'pullToHoldThreshold': 20, 'provenance': 'existing authored beta display threshold; native common status transition unresolved',
                'nativeHoldLoopPeriodParity': False, 'nativeCaptureJointParity': False}}
    result = {'state': 'STAGED_REVIEWED_BODY_INPUTS_NOT_RUNTIME_QUALIFIED', 'animations': animations,
        'bodyReview': review_pin, 'ordinaryReview': ordinary_pin, 'gripCalibration': calibration_pin,
        'captorCalibrationIdentity': captor_identity,
        'legacyFallbackContract': {'key': 'review_legacy_grab',
            'metadata': {'path': str(APP14_META.relative_to(ROOT)), 'sha256': APP14_META_SHA},
            'pixels': {'path': str(APP14_LEGACY_GRAB.relative_to(ROOT)), 'sha256': APP14_LEGACY_GRAB_SHA},
            'descriptorChanges': ['strip path only'], 'pixelBytesCopiedExactly': True,
            'status': 'historical unaccepted generic baseline, never reviewed standing body inputs',
            'consumerRequirement': 'DK generic missing dash/pivot routes exclude full standing grab and prefer review_legacy_grab; existing APP14 contact pilots untouched'},
        'attachmentInstallationContract': {'captor': 'Install only captorCalibrationIdentity as DK captureAttachmentCalibration; grips are owned exclusively by grab_pull/grab_hold clip.captureGripPoses.',
            'reviewedFullGripInput': 'gripCalibration pin is retained source/review evidence, never installed with clip grips.',
            'recipient': 'PK owns its own anchors/supportingFloor calibration; no DK recipient data inferred.',
            'policy': 'Actual DK pose-anchors-beta-v1 opt-in remains a separate reviewed installation step.'},
        'canonicalWrites': False, 'runtimeOptInEnabled': False,
        'limits': ['Actual Match/Editor/Lab/source-clock/receiving/CATCH/grip/depth/stage gates remain pending.',
                   'No recipient chooser or source grip inferred. PK supportingFloor data remains recipient-owned.']}
    (destination / 'metadata-fragment.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({'path': str(destination / 'metadata-fragment.json'),
                      'sha256': sha(destination / 'metadata-fragment.json')}))


if __name__ == '__main__':
    main()
