"""Export DK Final geometry from the reviewed native poses and packet roles.

Receiving capsules and the punch pocket are explicit authored adapters. This
does not label them native hurt_data or a recovered native capture joint. The
source packet offsets are projected through their actual HandL/ArmL matrices;
TOP is the selected virtual actor SOURCE ROOT, never a guessed skeleton bone.
"""
from pathlib import Path
import hashlib
import json
import math
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / 'tools'), str(ROOT / '.tmp/pikachu-final-libs')]
import numpy as np
from dk_native_pose import DonkeyKongNativePose, MOTIONS

E = ROOT / 'docs/review/2026-10-15/dk-final'
PLAN = E / 'owner-art-plan.json'
CAPSULES = ROOT / 'docs/review/2026-09-25/donkeykong-character/sources/authored-anatomical-capsules.json'
PACKETS = ROOT / 'src/finalSmash/selectedPackets.json'
NATIVE = ROOT / 'docs/review/2026-10-12/link-character/rework'
sha = lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()


def scalar(value):
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        result = float(value)
    elif isinstance(value, str) and value.startswith('Some(') and value.endswith(')'):
        result = float(value[5:-1])
    else:
        raise ValueError(f'Unresolved native packet scalar: {value}')
    if not math.isfinite(result):
        raise ValueError('Non-finite packet geometry')
    return result


def project(value):
    return {'x': float(value[2] * 5), 'y': float(-value[1] * 5)}


def selected(packets, callback, damage):
    # Match finalPacketBinding's first lexical branch per packet id. Branches
    # are not concatenated, and the unresolved size-conditional End zero hit
    # is not silently treated as an unconditional source event.
    result = {}
    for row in packets:
        if row['actor'] != 'donkeykong' or row['function'] != callback or row['packet']['damage'] != damage:
            continue
        assert sha(NATIVE / row['sourcePath']) == row['sourceSha256']
        packet = dict(row['packet'])
        for override in row['wikiPriorityOverrides']:
            packet[override['field']] = override['selected']
        result.setdefault(packet['id'], {**row, 'packet': packet})
    if not result:
        raise ValueError(f'Missing selected packet {callback}/{damage}')
    return list(result.values())


def roles_for(sheet, packets):
    prefix = 'game_finalair' if '_air_' in sheet else 'game_final'
    if sheet.endswith('_start'):
        return {'dk-detection': selected(packets, prefix + 'start', 12)}
    if sheet.endswith('_attack'):
        return {'dk-early': selected(packets, prefix + 'attack', 1.2),
                'dk-late': selected(packets, prefix + 'attack', 1.1)}
    if sheet.endswith('_end'):
        return {'dk-finisher': selected(packets, prefix + 'end', 14)}
    raise ValueError(f'Unknown DK Final sheet {sheet}')


def packet_bone(packet):
    text = packet['bone']
    if text not in ['Hash40::new("top")', 'Hash40::new("handl")', 'Hash40::new("arml")']:
        raise ValueError(f'Unreviewed DK Final attack joint: {text}')
    return {'Hash40::new("top")': 'top', 'Hash40::new("handl")': 'HandL', 'Hash40::new("arml")': 'ArmL'}[text]


def attack(packet, matrices, trans):
    bone = packet_bone(packet)
    local = np.array([scalar(packet[k]) for k in ['x', 'y', 'z']] + [1.0])
    local2 = local if packet['z2'] is None else np.array([scalar(packet[k]) for k in ['x2', 'y2', 'z2']] + [1.0])
    matrix = np.eye(4) if bone == 'top' else matrices[bone]
    base = np.zeros(3) if bone == 'top' else trans
    start, end = [project((matrix @ value)[:3] - base) for value in [local, local2]]
    # The project's existing native-hit-positions.py adapter transforms the
    # attachment point but preserves the ATTACK radius at native*5. Visual
    # HandL squash/stretch must not silently enlarge the source packet.
    return {'id': packet['id'], 'capsule': {'start': start, 'end': end, 'radius': scalar(packet['radius']) * 5}}


def pocket_from_top(rows):
    # Reviewed authored placement, not a native capture point: the unweighted
    # centroid of each selected TOP capsule's segment midpoint. It stays in
    # the actual phase's attack pocket and uses no guessed hand trajectory.
    centres = []
    for row in rows:
        p = row['packet']
        if packet_bone(p) != 'top':
            continue
        a = np.array([scalar(p[k]) for k in ['x', 'y', 'z']])
        b = a if p['z2'] is None else np.array([scalar(p[k]) for k in ['x2', 'y2', 'z2']])
        centres.append((a + b) / 2)
    if not centres:
        raise ValueError('Authored punch-pocket adapter requires source TOP packets')
    return project(np.mean(centres, axis=0))


def main():
    plan = json.loads(PLAN.read_text())
    authored = json.loads(CAPSULES.read_text())
    assert authored['provenance'] == 'authored anatomical capsule fit to captured native body skin; NOT native hit_data'
    for key in ['skeleton', 'mesh']:
        assert sha(ROOT / authored[key]['path']) == authored[key]['sha256']
    assert plan['worldUnitsPerNativeUnit'] == 5 and plan['bodyCentreFromRootY'] == -42
    packets = json.loads(PACKETS.read_text())['packets']
    result = {}
    for clip in plan['clips']:
        pose = DonkeyKongNativePose(MOTIONS / (clip['motion'] + '.nuanmb'))
        assert sha(pose.motion_path) == clip['motionSha256']
        assert pose.animation.final_frame_index == clip['nativeFinalFrameIndex']
        samples = clip['samples']
        assert samples == sorted(set(samples)) and samples[0] == 0 and samples[-1] == clip['nativeFinalFrameIndex']
        roles = roles_for(clip['sheet'], packets)
        pocket = pocket_from_top(next(iter(roles.values())))
        names = list(dict.fromkeys(['Trans', 'Hip'] + [r['bone'] for r in authored['regions']] +
            [packet_bone(row['packet']) for rows in roles.values() for row in rows if packet_bone(row['packet']) != 'top']))
        receiving, attachments, points = [], [], []
        outgoing = {role: [] for role in roles}
        for index, sample in enumerate(samples):
            matrices = pose.matrices(sample, names)
            trans = matrices['Trans'][:3, 3]
            boxes = []
            for cap in authored['regions']:
                matrix = matrices[cap['bone']]
                radius = float(cap['radius'] * max(np.linalg.norm(matrix[:3, j]) for j in range(3)) * 5)
                a, b = [project((matrix @ np.array([*cap[key], 1]))[:3] - trans) for key in ['endpoint1', 'endpoint2']]
                minx, maxx = min(a['x'], b['x']) - radius, max(a['x'], b['x']) + radius
                miny, maxy = min(a['y'], b['y']) - radius, max(a['y'], b['y']) + radius
                boxes.append({'id': 'donkeykong.final.authored.' + cap['region'], 'region': cap['region'],
                    'offsetX': (minx + maxx) / 2, 'offsetY': (miny + maxy) / 2,
                    'width': maxx - minx, 'height': maxy - miny,
                    'capsule': {'start': a, 'end': b, 'radius': radius}})
            receiving.append({'artFrameIndex': index, 'nativeSample': sample, 'hurtboxes': boxes})
            hip = project(matrices['Hip'][:3, 3] - trans)
            attachments.append({'artFrameIndex': index, 'nativeSample': sample, 'attachments': [
                {'role': 'capture-anchor', 'point': pocket}, {'role': 'waist', 'point': hip}]})
            points.append({'artFrameIndex': index, 'nativeSample': sample, 'points': [
                {'bone': 'top', 'point': {'x': 0, 'y': 0}, 'reviewKey': sha(__file__) + ':virtual-top', 'precision': 'authored-virtual-top'},
                {'bone': 'hip', 'point': hip, 'reviewKey': clip['motionSha256'] + ':Hip:' + str(sample), 'precision': 'captured-bone'}]})
            for role, rows in roles.items():
                outgoing[role].append({'artFrameIndex': index, 'nativeSample': sample,
                    'collisionHits': [attack(row['packet'], matrices, trans) for row in rows]})
        origin = pose.matrices(0, ['Trans'])['Trans'][:3, 3]
        delta = [project(pose.matrices(age, ['Trans'])['Trans'][:3, 3] - origin)
                 for age in range(clip['nativeFinalFrameIndex'] + 1)]
        result[clip['sheet']] = {'coordinateOrigin': 'actorSourceRoot', 'sourceSampleBasis': 'zero-based-native-index',
            'bodyCentreFromRootY': -42, 'nativeSampleIndices': samples, 'loopDuration': clip['loopDuration'],
            'hurtboxPoses': receiving, 'sourceAttachmentPoses': attachments, 'sourceEffectPointPoses': points,
            'sourceRootDelta': delta, 'attackCollisionPosesByRole': outgoing, 'sourceProvenance': pose.provenance(),
            'sourceGeometryAdapters': {'receiving': {'recipe': str(CAPSULES.relative_to(ROOT)), 'sha256': sha(CAPSULES),
                'precision': 'authored anatomical capsules posed through captured native bones; NOT native hit_data'},
                'top': 'authored virtual actor SOURCE ROOT; native TOP consumer and 3D collision parity unproven',
                'receivingRadius': 'authored capsule radius times maximum native matrix column norm, then world scale 5',
                'attackRadius': 'selected native ATTACK radius times world scale 5, independent of visual bone squash/stretch; same adapter as tools/native-hit-positions.py',
                'captureAnchor': {'recipe': 'authored source TOP attack capsule midpoint centroid', 'point': pocket,
                    'sourceRole': next(iter(roles)), 'nativeJointClaim': False},
                'packetBindings': {role: [{'function': row['function'], 'line': row['line'], 'id': row['packet']['id'],
                    'bone': row['packet']['bone'], 'sourcePath': row['sourcePath'], 'sourceSha256': row['sourceSha256']}
                    for row in rows] for role, rows in roles.items()}}}
    output = {'schema': 'donkeykong-final-owner-geometry/1', 'planSha256': sha(PLAN),
        'authoredReceivingSha256': sha(CAPSULES), 'selectedPacketsSha256': sha(PACKETS), 'exporterSha256': sha(__file__),
        'precision': 'Integer native FK, authored receiving/punch pocket/TOP adapter, explicit 2D(Z,-Y)*5 projection. No native hit_data, capture-joint or camera parity claim.',
        'clips': result}
    (E / 'owner-geometry.json').write_text(json.dumps(output, indent=2) + '\n')
    print(json.dumps({'clips': len(result), 'drawings': sum(len(c['hurtboxPoses']) for c in result.values()),
        'receiving': authored['provenance'], 'captureAnchors': {s: c['sourceGeometryAdapters']['captureAnchor']['point'] for s, c in result.items()},
        'nonzeroRootDeltaClips': [s for s, c in result.items() if any(p['x'] != 0 or p['y'] != 0 for p in c['sourceRootDelta'])]}))


if __name__ == '__main__':
    main()
