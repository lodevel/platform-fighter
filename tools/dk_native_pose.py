"""Inspect captured DonkeyKong skeleton/motion resources without modifying them.

Column-vector world matrices are exported as ordinary row-major JSON arrays.
Integer samples preserve captured transforms exactly; fractional samples use
explicit authored linear translation/scale and shortest-path quaternion SLERP.
Native shader/status interpolation parity remains unverified. This evaluator
does not claim a game-patch identity, gameplay-frame mapping, retargeted body
geometry, or runtime collision parity. Helper constraints are deliberately
excluded: callers may request only bones whose entire ancestry is unaffected.
"""
from pathlib import Path
import hashlib
import json
import sys
import math

sys.path.insert(0, '/tmp/pikachu-source-libs')
import numpy as np
import ssbh_data_py as ssbh

ROOT = Path(__file__).resolve().parent.parent
BASE = ROOT / 'assets/gen/dk-native-reference'
SKEL = BASE / 'raw-model/fighter/donkey/model/body/c00/model.nusktb'
HLPB = BASE / 'raw-model/fighter/donkey/model/body/c00/model.nuhlpb'
MOTIONS = BASE / 'raw-motion/fighter/donkey/motion/body/c00'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def rotation_matrix(quaternion):
    x, y, z, w = map(float, quaternion)
    if not np.isfinite([x, y, z, w]).all() or abs(x*x+y*y+z*z+w*w-1) > 0.0001:
        raise ValueError('Invalid/non-unit captured rotation')
    return np.array([
        [1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)],
        [2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w)],
        [2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y)],
    ], dtype=np.float64)


def interpolate_rotation(first, second, amount):
    """Authored shortest-arc interpolation of captured unit quaternions."""
    if not math.isfinite(amount) or not 0 <= amount <= 1:
        raise ValueError('Rotation interpolation amount must be in [0,1]')
    a, b = np.asarray(first, dtype=np.float64), np.asarray(second, dtype=np.float64)
    # Retain the same captured-value validity guard as integer evaluation.
    rotation_matrix(a)
    rotation_matrix(b)
    a = a / np.linalg.norm(a)
    b = b / np.linalg.norm(b)
    dot = float(np.dot(a, b))
    if dot < 0:
        b = -b
        dot = -dot
    dot = min(1.0, max(-1.0, dot))
    if dot > .9995:
        value = a + amount * (b - a)
        return value / np.linalg.norm(value)
    angle = math.acos(dot)
    return (math.sin((1-amount)*angle)*a + math.sin(amount*angle)*b) / math.sin(angle)


class DonkeyKongNativePose:
    def __init__(self, motion_path):
        self.motion_path = Path(motion_path)
        self.skeleton = ssbh.skel_data.read_skel(str(SKEL))
        self.animation = ssbh.anim_data.read_anim(str(self.motion_path))
        helper = ssbh.hlpb_data.read_hlpb(str(HLPB))
        self.constrained = {c.target_bone_name.lower() for c in helper.orient_constraints}
        self.constrained.update(c.target_bone_name1.lower() for c in helper.aim_constraints)
        self.bones = {b.name.lower(): i for i, b in enumerate(self.skeleton.bones)}
        if len(self.bones) != len(self.skeleton.bones):
            raise ValueError('Ambiguous bone names')
        self.tracks = {}
        # Shared recipient motions (e01thrown*: thrown/carried by DK) also key the generic thrown-skeleton
        # bones ClavicleC/LegC, which DK's skeleton lacks; no DK vertex is weighted to an absent bone, so
        # those tracks are recorded and skipped. Every other unresolved track still fails.
        self.ignored_tracks = []
        for group in self.animation.groups:
            if group.group_type.name != 'Transform':
                continue
            for node in group.nodes:
                name = node.name.lower()
                if name not in self.bones and len(node.tracks) == 1:
                    self.ignored_tracks.append(node.name)
                    continue
                if len(node.tracks) != 1 or name in self.tracks:
                    raise ValueError(f'Unresolved transform track: {node.name}')
                self.tracks[name] = node.tracks[0]

    def matrices(self, frame, names, bind_pose=False):
        if isinstance(frame, bool) or not isinstance(frame, (int, float)) or not math.isfinite(frame) or frame < 0 or frame > self.animation.final_frame_index:
            raise ValueError('Native sample must be finite and inside the captured animation')
        cache = {}
        visiting = set()

        def evaluate(index):
            if index in cache:
                return cache[index]
            if index in visiting:
                raise ValueError('Cyclic skeleton ancestry')
            visiting.add(index)
            bone = self.skeleton.bones[index]
            name = bone.name.lower()
            if name in self.constrained:
                raise ValueError(f'Helper constraint requires a separate reviewed evaluator: {bone.name}')
            # SSBH exposes columns as the outer ndarray dimension.
            local = np.asarray(bone.transform, dtype=np.float64).T.copy()
            track = None if bind_pose else self.tracks.get(name)
            if track is not None:
                flags = track.transform_flags
                if track.compensate_scale or flags.override_compensate_scale:
                    raise ValueError(f'Unreviewed scale compensation: {bone.name}')
                if not track.values:
                    raise ValueError(f'Empty transform track: {bone.name}')
                lower, upper = math.floor(frame), math.ceil(frame)
                if len(track.values) != 1 and upper >= len(track.values):
                    raise ValueError(f'Missing captured transform sample: {bone.name}/{frame}')
                value = track.values[0 if len(track.values) == 1 else lower]
                scale = np.asarray(value.scale, dtype=np.float64)
                rotation = rotation_matrix(value.rotation)
                translation = np.asarray(value.translation, dtype=np.float64)
                if len(track.values) != 1 and lower != upper:
                    next_value = track.values[upper]
                    amount = frame - lower
                    scale = scale + amount * (np.asarray(next_value.scale, dtype=np.float64) - scale)
                    translation = translation + amount * (np.asarray(next_value.translation, dtype=np.float64) - translation)
                    rotation = rotation_matrix(interpolate_rotation(value.rotation, next_value.rotation, amount))
                rest_scale = np.linalg.norm(local[:3, :3], axis=0)
                if np.any(rest_scale == 0) or np.linalg.det(local[:3, :3]) <= 0:
                    raise ValueError(f'Unsupported rest scale: {bone.name}')
                if flags.override_translation:
                    translation = local[:3, 3]
                if flags.override_rotation:
                    rotation = local[:3, :3] / rest_scale
                if flags.override_scale:
                    scale = rest_scale
                local = np.eye(4)
                local[:3, :3] = rotation @ np.diag(scale)
                local[:3, 3] = translation
            if not np.isfinite(local).all():
                raise ValueError('Non-finite local transform')
            parent = np.eye(4) if bone.parent_index is None else evaluate(bone.parent_index)
            cache[index] = parent @ local
            visiting.remove(index)
            return cache[index]

        return {name: evaluate(self.bones[name.lower()]) for name in names}

    def provenance(self):
        return {
            'skeleton': {'path': str(SKEL.relative_to(ROOT)), 'sha256': sha(SKEL)},
            'helper': {'path': str(HLPB.relative_to(ROOT)), 'sha256': sha(HLPB)},
            'motion': {'path': str(self.motion_path.relative_to(ROOT)), 'sha256': sha(self.motion_path)},
            'native_final_frame_index': self.animation.final_frame_index,
            'matrix_convention': 'row-major arrays; column vectors; native x/y/z, no game or camera transform',
            'helper_constraints': 'Excluded; requested bones and ancestors reject any constraint target',
            'fractional_transform_policy': 'Authored linear translation/scale and shortest-path unit-quaternion SLERP before hierarchy composition; captured integer path unchanged; native shader/status interpolation parity unverified',
            'game_patch': None, 'unmodified_vanilla_verified': False,
            'gameplay_frame_mapping': None, 'runtime_consumer': None,
        }


def export(motion_name, destination):
    """Export DK major-body matrices only; no unavailable native hurt-data claim."""
    if not motion_name.replace('_', '').isalnum():
        raise ValueError('Invalid local motion name')
    pose = DonkeyKongNativePose(MOTIONS / (motion_name + '.nuanmb'))
    names = ['Trans', 'Rot', 'Hip', 'Bust', 'Head', 'ShoulderL', 'ArmL', 'HandL',
        'ShoulderR', 'ArmR', 'HandR', 'LegL', 'KneeL', 'FootL', 'LegR', 'KneeR', 'FootR']
    result = {**pose.provenance(), 'state': 'captured native major-body samples; authored receiving and gameplay mapping are separate', 'frames': []}
    for frame in range(int(pose.animation.final_frame_index) + 1):
        matrices = pose.matrices(frame, names)
        result['frames'].append({'native_sample_index': frame,
            'matrices': {name: matrix.tolist() for name, matrix in matrices.items()}})
    Path(destination).write_text(json.dumps(result, separators=(',', ':')) + '\n')
    return {'motion': motion_name, 'samples': len(result['frames']), 'bones_per_sample': len(names), 'destination': str(destination)}


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit('Usage: python3 tools/dk_native_pose.py MOTION_NAME OUTPUT_JSON')
    print(json.dumps(export(sys.argv[1], sys.argv[2])))
