"""Native hit geometry from the posed native skeleton, for DK and Link.

One placement routine (`native_point`) turns a bone-local offset at a native
motion sample into fighter-local px: forward x = z * 5, y = centre_y - y * 5
(5 px per native unit, y down, relative to the body centre).

  --fighter dk   Prints the ATTACK rows of the pinned vanilla DK script
                 (docs/review/2026-09-25/.../dk-scripts.json), each placed at
                 bone world matrix @ (x, y, z, 1) at native sample = age + 1.
                 `top` rows are root offsets. Cross-check: AttackLw3 samples
                 6/7 reproduce the sourced dtilt attackCollisionPoses.
    ~/ComfyUI/.venv/bin/python -I tools/native-hit-positions.py --fighter dk \
        MOTION_FILE SCRIPT FIRST_AGE LAST_AGE        e.g. c02attackhi3 AttackHi3 4 10

  --fighter link Writes src/characters/linkAttackGeometry.json: capsules per
                 gameplay age and packet id for the 16 normals, the recovery
                 attacks, ground/air Spin Attack and the catch boxes, plus the
                 release points of the arrow, boomerang, bomb and Ancient
                 Arrow. Bone positions are relative to the Trans bone of the
                 same sample (the actor source root), as the old paired
                 `runtimeOutgoingPoses` were.
    ~/ComfyUI/.venv/bin/python -I tools/native-hit-positions.py --fighter link [--out PATH]
"""
import argparse
import hashlib
import importlib.util
import json
import re
import sys
from collections import namedtuple
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
TOOLS = ROOT / 'tools'
sys.path.insert(0, str(TOOLS))

Fighter = namedtuple('Fighter', 'pose_module pose_class centre_y subtract_trans digits')
FIGHTERS = {
    'dk': Fighter('dk_native_pose.py', 'DonkeyKongNativePose', 42, False, 1),
    'link': Fighter('link_native_pose.py', 'LinkNativePose', 36, True, 3),
}
PX_PER_UNIT = 5


def load_module(filename):
    spec = importlib.util.spec_from_file_location(Path(filename).stem.replace('-', '_'), TOOLS / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def native_point(pose, fighter, bone, local, sample):
    """Fighter-local px (x forward, y down) of `local` (native x, y, z) on `bone` at `sample`."""
    offset = np.array([local[0], local[1], local[2], 1.0])
    if bone.lower() != 'top':
        names = ['Trans', bone] if fighter.subtract_trans else [bone]
        matrices = pose.matrices(sample, names)
        offset = matrices[bone] @ offset
        if fighter.subtract_trans:
            offset[:3] -= matrices['Trans'][:3, 3]
    return float(offset[2]) * PX_PER_UNIT, fighter.centre_y - float(offset[1]) * PX_PER_UNIT


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def rel(path):
    return str(Path(path).relative_to(ROOT))


# ----------------------------------------------------------------------- DK

DK_SCRIPTS = ROOT / 'docs/review/2026-09-25/donkeykong-character/sources/dk-scripts.json'


def dk_hit_positions(motion_file, script, first_age, last_age):
    fighter, native = FIGHTERS['dk'], load_module(FIGHTERS['dk'].pose_module)
    pose = native.DonkeyKongNativePose(native.MOTIONS / (motion_file + '.nuanmb'))
    functions = json.loads(DK_SCRIPTS.read_text())['files'][script]['functions']
    rows = [r for name, rs in functions.items() if name.startswith('game_') for r in rs if r.get('cmd') == 'ATTACK']
    bone_names = {b.name.lower(): b.name for b in pose.skeleton.bones}
    result = []
    for age in range(first_age, last_age + 1):
        sample = age + 1
        declared = [r['frame'] for r in rows if r['frame'] <= sample]
        if not declared:
            continue
        hits = []
        for row in (r for r in rows if r['frame'] == max(declared)):
            bone = row['bone'] if row['bone'] == 'top' else bone_names[row['bone']]
            x, y = native_point(pose, fighter, bone, (row['x'], row['y'], row['z']), sample)
            hits.append({'id': row['id'], 'bone': row['bone'], 'x': round(x, fighter.digits),
                         'y': round(y, fighter.digits), 'radius': round(row['size'] * PX_PER_UNIT, 2)})
        result.append({'age': age, 'nativeSample': sample, 'hits': hits})
    return result


# --------------------------------------------------------------------- Link

LINK_REWORK = ROOT / 'docs/review/2026-10-12/link-character/rework'
LINK_NORMALS = ROOT / 'src/characters/linkSelectedNormalPackets.json'
LINK_SPECIALS = ROOT / 'src/characters/linkSelectedSpecialPackets.json'
LINK_RECOVERY = ROOT / 'src/characters/linkSourceRecoveryAttacks.json'
LINK_CLOCKS = LINK_REWORK / 'source-contracts/special-packet-index/normal-clock-caveats.json'
LINK_OUT = ROOT / 'src/characters/linkAttackGeometry.json'
# Every normal's evaluated pose sits one native sample before its script
# creation frame (reviewed pose/contact correspondences, linkNormalBodyClock).
NORMAL_POSE_OFFSET = -1

# Release points: (move id, article, body motion, native sample, bones). The
# sample is the script frame that shoots or generates the article; the arrow
# fires when the End motion starts. Boomerang and bomb hand attachment is not
# in the committed scripts, so both hand bones are emitted.
HANDS = ('HaveL', 'HaveR')
RELEASES = [
    ('link.neutral_special', 'arrow', 'd00specialnend', 0, ('bow:Pull',) + HANDS),
    ('link.neutral_special_air', 'arrow', 'd00specialairnend', 0, ('bow:Pull',) + HANDS),
    ('link.side_special', 'boomerang', 'd01specials1', 27, HANDS),
    ('link.side_special_air', 'boomerang', 'd01specialairs1', 27, HANDS),
    ('link.down_special', 'bomb', 'd03speciallw', 17, HANDS),
    ('link.down_special_air', 'bomb', 'd03specialairlw', 17, HANDS),
    ('link.final', 'ancientArrow', 'd04final', 60, HANDS),
    ('link.final_air', 'ancientArrow', 'd04finalair', 60, HANDS),
]
BOW_ARTICLE_MOTIONS = {'d00specialnend', 'd00specialairnend'}


def parse_endpoint(value):
    """Native endpoints are numbers, 'Some(x)' or absent ('None')."""
    if value is None or value == 'None':
        return None
    if isinstance(value, str):
        match = re.fullmatch(r'Some\((-?[\d.]+(?:e[+-]?\d+)?)\)', value, re.I)
        if not match:
            raise ValueError(f'Unresolved native endpoint {value!r}')
        return float(match[1])
    return float(value)


def packet_from_native(native, radius, extra=None):
    """A strike packet from a native ATTACK/CATCH packet dict (x, y, z, x2, y2, z2, bone, id)."""
    end = [parse_endpoint(native.get(k)) for k in ('x2', 'y2', 'z2')]
    if any(v is None for v in end) and not all(v is None for v in end):
        raise ValueError(f'Partial capsule endpoint on packet {native["id"]}')
    bone = re.fullmatch(r'Hash40::new\("(\w+)"\)', native['bone'])[1]
    return {'id': int(native['id']), 'bone': bone, 'start': [native['x'], native['y'], native['z']],
            'end': None if end[0] is None else end, 'radius': radius, **(extra or {})}


def motion_stem(motion_dir, source_motion):
    """c00attack11 for attack_11: one category-prefixed file per native motion name."""
    wanted = source_motion.replace('_', '')
    found = [p.stem for p in motion_dir.glob('*.nuanmb') if re.fullmatch(r'[a-z]\d\d' + wanted, p.stem)]
    if len(found) != 1:
        raise ValueError(f'Motion {source_motion}: expected one resource, found {found}')
    return found[0]


def selected_radius(binding):
    return binding['selected']['explicitWikiNumeric']['radius']


def link_strikes(motion_dir):
    """Every active strike as a dict: move, kind, motion, role, first_age, last_age, sample0, packets."""
    normals, specials = json.loads(LINK_NORMALS.read_text()), json.loads(LINK_SPECIALS.read_text())
    clocks = {a['runtimeMoveId']: {g['group']: g for g in a['groups']} for a in
              json.loads(LINK_CLOCKS.read_text())['actions']}
    recovery = json.loads(LINK_RECOVERY.read_text())

    for move in normals['normalPackets']:
        motion = motion_stem(motion_dir, move['sourceMotion'])
        for group in move['groups']:
            clock = clocks[move['runtimeMoveId']].get(group['group'])
            if clock is None or clock['publicActiveInclusive'] is None:
                continue  # Dair "After bouncing off": clock comes from the rebound, no native sample
            first, last = clock['publicActiveInclusive']
            if clock['nativeStart'] != group['lexicalNativePhaseStart']:
                raise ValueError(f'{move["runtimeMoveId"]}/{group["group"]}: clock disagrees with packet index')
            yield {'move': move['runtimeMoveId'], 'kind': 'normal', 'motion': motion, 'role': group['group'] or 'primary',
                   'first_age': first - 1, 'last_age': last - 1,
                   'sample0': int(group['lexicalNativePhaseStart']) + NORMAL_POSE_OFFSET,
                   'packets': [packet_from_native(b['nativePacket'], selected_radius(b)) for b in group['packetBindings']]}

    for row in recovery['rows']:
        for phase in row['phases']:  # contact N samples native frame N
            yield {'move': row['id'], 'kind': 'recovery', 'motion': row['resource'].removesuffix('.nuanmb'),
                   'role': phase['role'], 'first_age': phase['first'] - 1, 'last_age': phase['last'] - 1,
                   'sample0': phase['first'], 'packets': [packet_from_native(phase['packet'], phase['packet']['radius'])]}

    for action in specials['spinActions']:
        ground = action['variant'] == 'grounded'
        motion = motion_stem(motion_dir, action['sourceMotion'])
        for group in action['groups']:  # ground ages are release-local
            first, last = group['publicReleaseLocalActiveInclusive' if ground else 'publicActiveInclusive']
            yield {'move': 'link.spin.ground' if ground else 'link.spin.air', 'kind': 'spin', 'motion': motion,
                   'role': group['group'], 'first_age': first - 1, 'last_age': last - 1,
                   'sample0': int(group['lexicalNativePhaseStart']),
                   'packets': [packet_from_native(b['nativePacket'], selected_radius(b)) for b in group['packetBindings']]}

    for grab in normals['captureContracts']['grabs']:
        yield from catch_strikes(grab, motion_stem(motion_dir, grab['sourceMotion']))


def catch_strikes(grab, motion):
    """CATCH rows between their `frame` and the following GRAB_CLEAR_ALL; ages = native frame - 1."""
    clock, packets, start = 0.0, [], None
    for event in grab['nativeFunction']['events']:
        raw = event['raw']
        if m := re.fullmatch(r'frame\(agent\.lua_state_agent, ([\d.]+)\)', raw):
            clock = float(m[1])
        elif m := re.fullmatch(r'wait\(agent\.lua_state_agent, ([\d.]+)\)', raw):
            clock += float(m[1])
        elif m := re.fullmatch(r'macros::CATCH\(agent, (\d+), Hash40::new\("(\w+)"\), ([\d.]+), (-?[\d.]+), (-?[\d.]+), '
                               r'(-?[\d.]+), (Some\([^)]*\)), (Some\([^)]*\)), (Some\([^)]*\)), [^,]+, '
                               r'\*COLLISION_SITUATION_MASK_([GA])\)', raw):
            start = clock if start is None else start
            native = dict(id=m[1], bone=f'Hash40::new("{m[2]}")', x=float(m[4]), y=float(m[5]), z=float(m[6]),
                          x2=m[7], y2=m[8], z2=m[9])
            packets.append(packet_from_native(native, float(m[3]), {'situation': m[10]}))
        elif 'GRAB_CLEAR_ALL' in raw:
            yield {'move': 'link.' + grab['sourceMotion'], 'kind': 'catch', 'motion': motion, 'role': 'grab',
                   'first_age': int(start) - 1, 'last_age': int(clock) - 2, 'sample0': int(start), 'packets': packets}
            return
    raise ValueError(f'{grab["sourceMotion"]}: CATCH rows are never cleared')


def link_pose_cache(native):
    cache = {}

    def pose(motion):
        if motion not in cache:
            cache[motion] = native.LinkNativePose(native.MOTIONS / (motion + '.nuanmb'))
        return cache[motion]
    return pose


def px(value):
    return round(value, FIGHTERS['link'].digits) + 0.0


def strike_rows(fighter, pose, strike):
    rows = []
    for age in range(strike['first_age'], strike['last_age'] + 1):
        sample = strike['sample0'] + age - strike['first_age']
        for packet in strike['packets']:
            start = native_point(pose, fighter, packet['bone'], packet['start'], sample)
            end = start if packet['end'] is None else native_point(pose, fighter, packet['bone'], packet['end'], sample)
            rows.append({'age': age, 'bone': packet['bone'].lower(), 'end': [px(end[0]), px(end[1])], 'id': packet['id'],
                         'radius': px(packet['radius'] * PX_PER_UNIT), 'role': strike['role'], 'sample': sample,
                         'start': [px(start[0]), px(start[1])],
                         **({'situation': packet['situation']} if 'situation' in packet else {})})
    rows.sort(key=lambda r: (r['age'], r['role'], r['id']))
    return rows


def release_rows(fighter, pose_for):
    article_pose = load_module('link-native-article-guide-v2.py').article_pose
    rows = []
    for move, article, motion, sample, bones in RELEASES:
        for bone in bones:
            if bone.startswith('bow:'):
                # The Bow rig already holds actor-space (Trans-relative) placement; no second parenting.
                x, y = native_point(article_pose('bow', motion), fighter._replace(subtract_trans=False), bone[4:], (0, 0, 0), sample)
            else:
                x, y = native_point(pose_for(motion), fighter, bone, (0, 0, 0), sample)
            rows.append({'age': max(sample - 1, 0), 'article': article, 'bone': bone.lower(), 'move': move,
                         'motion': motion, 'point': [px(x), px(y)], 'sample': sample})
    rows.sort(key=lambda r: (r['article'], r['move'], r['bone']))
    return rows


def link_document():
    fighter, native = FIGHTERS['link'], load_module(FIGHTERS['link'].pose_module)
    pose_for = link_pose_cache(native)
    moves = {}
    for strike in link_strikes(native.MOTIONS):
        move = moves.setdefault(strike['move'], {'kind': strike['kind'], 'motion': strike['motion'], 'rows': []})
        move['rows'] += strike_rows(fighter, pose_for(strike['motion']), strike)
    for move in moves.values():
        move['nativeFrames'] = int(pose_for(move['motion']).animation.final_frame_index) + 1
        move['rows'].sort(key=lambda r: (r['age'], r['role'], r['id']))
    inputs = [LINK_NORMALS, LINK_SPECIALS, LINK_RECOVERY, LINK_CLOCKS, TOOLS / 'link_native_pose.py', Path(__file__)]
    return {'schema': 'link-attack-geometry/1',
            'units': 'fighter-local px, 5 px per native unit, x forward, y down from the body centre; ages are zero-based '
                     '(sample = age + 1 for scripts); ground spin ages are release-local',
            'bodyCentreFromRootY': -fighter.centre_y,
            'inputs': {rel(p): sha256(p) for p in inputs},
            'moves': {k: moves[k] for k in sorted(moves)},
            'releasePoints': release_rows(fighter, pose_for)}


def render(document):
    """Sorted keys, one row per line, so diffs stay reviewable."""
    def line(value):
        return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False)
    moves = []
    for key, move in document['moves'].items():
        head = line({k: v for k, v in move.items() if k != 'rows'})[:-1]
        moves.append(f'  {line(key)}:{head},"rows":[\n' + ',\n'.join('   ' + line(r) for r in move['rows']) + '\n  ]}')
    rest = ',\n'.join(f' {line(k)}:{line(document[k])}' for k in ('bodyCentreFromRootY', 'inputs', 'schema', 'units'))
    releases = ',\n'.join('  ' + line(r) for r in document['releasePoints'])
    return '{\n' + rest + ',\n "moves":{\n' + ',\n'.join(moves) + '\n },\n "releasePoints":[\n' + releases + '\n ]\n}\n'


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--fighter', choices=sorted(FIGHTERS), required=True)
    parser.add_argument('--out', default=str(LINK_OUT), help='link only: output path')
    parser.add_argument('dk_args', nargs='*', help='dk only: MOTION_FILE SCRIPT FIRST_AGE LAST_AGE')
    args = parser.parse_args()
    if args.fighter == 'dk':
        if len(args.dk_args) != 4:
            parser.error('dk needs MOTION_FILE SCRIPT FIRST_AGE LAST_AGE')
        motion, script, first, last = args.dk_args
        print(json.dumps(dk_hit_positions(motion, script, int(first), int(last)), indent=1))
    else:
        Path(args.out).write_text(render(link_document()))


if __name__ == '__main__':
    main()
