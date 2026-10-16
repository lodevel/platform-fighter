"""Inspect captured Link skeleton/motion resources without modifying them.

Column-vector world matrices are exported as ordinary row-major JSON arrays.
Only integer native animation samples are supported. This reference evaluator
does not claim a game-patch identity, gameplay-frame mapping, retargeted body
geometry, or runtime collision parity. Helper constraints are deliberately
excluded: callers may request only bones whose entire ancestry is unaffected.
"""
from pathlib import Path
import hashlib
import json
import sys

import numpy as np
import ssbh_data_py as ssbh

ROOT = Path(__file__).resolve().parent.parent
BASE = ROOT / 'assets/gen/link-native-reference'
SKEL = BASE / 'extracted/fighter/link/model/body/c00/model.nusktb'
HLPB = BASE / 'extracted/fighter/link/model/body/c00/model.nuhlpb'
MOTIONS = BASE / 'extracted/fighter/link/motion/body/c00'


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


class LinkNativePose:
    def __init__(self, motion_path, track_binding_policy=None):
        self.motion_path = Path(motion_path)
        self.skeleton = ssbh.skel_data.read_skel(str(SKEL))
        self.animation = ssbh.anim_data.read_anim(str(self.motion_path))
        helper = ssbh.hlpb_data.read_hlpb(str(HLPB))
        self.constrained = {c.target_bone_name.lower() for c in helper.orient_constraints}
        self.constrained.update(c.target_bone_name1.lower() for c in helper.aim_constraints)
        self.bones = {b.name.lower(): i for i, b in enumerate(self.skeleton.bones)}
        if len(self.bones) != len(self.skeleton.bones):
            raise ValueError('Ambiguous bone names')
        self.track_binding_policy = None
        self.ignored_unbound_channels = []
        self.resource_role = 'BODY_MOTION'
        allowed_unbound = set()
        if track_binding_policy is not None:
            policy_path = Path(track_binding_policy)
            policy = json.loads(policy_path.read_text())
            row = policy.get('resources', {}).get(self.motion_path.name)
            if row is None or self.motion_path.resolve() != (ROOT / row['inputPath']).resolve():
                raise ValueError('No exact audited resource binding policy')
            identities = [
                (self.motion_path, row['inputSha256']), (SKEL, row['skeletonSha256']),
                (HLPB, row['helperSha256']),
                (BASE / 'extracted/fighter/link/model/body/c00/model.numshb', row['meshSha256']),
            ]
            if any(sha(path) != expected for path, expected in identities):
                raise ValueError('Audited resource/model binding identity changed')
            exact_bones = {b.name for b in self.skeleton.bones}
            missing = sorted(node.name for group in self.animation.groups
                if group.group_type.name == 'Transform' for node in group.nodes
                if node.name not in exact_bones)
            allowed_unbound = set(row['allowedUnboundChannelNames'])
            if missing != sorted(allowed_unbound) or not row['allowlistExactlyMatchesCapturedMissingNames']:
                raise ValueError('Audited unbound channel set changed')
            self.track_binding_policy = {'path': str(policy_path), 'sha256': sha(policy_path),
                'resource': self.motion_path.name, 'role': row['role']}
            self.resource_role = row['role']
        self.tracks = {}
        for group in self.animation.groups:
            if group.group_type.name != 'Transform':
                continue
            for node in group.nodes:
                if node.name in allowed_unbound:
                    self.ignored_unbound_channels.append(node.name)
                    continue
                name = node.name.lower()
                if name not in self.bones or len(node.tracks) != 1 or name in self.tracks:
                    raise ValueError(f'Unresolved transform track: {node.name}')
                self.tracks[name] = node.tracks[0]

    def matrices(self, frame, names, bind_pose=False):
        if type(frame) is not int or frame < 0 or frame > self.animation.final_frame_index:
            raise ValueError('Native sample must be an integer inside the captured animation')
        if self.resource_role == 'HAND_OVERLAY':
            raise ValueError('Hand-only overlay requires an independently supplied source body/compositor; standalone bind-body world matrices are not permitted')
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
                if len(track.values) != 1 and frame >= len(track.values):
                    raise ValueError(f'Missing captured transform sample: {bone.name}/{frame}')
                value = track.values[0 if len(track.values) == 1 else frame]
                scale = np.asarray(value.scale, dtype=np.float64)
                rotation = rotation_matrix(value.rotation)
                translation = np.asarray(value.translation, dtype=np.float64)
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
            'game_patch': None, 'unmodified_vanilla_verified': False,
            'gameplay_frame_mapping': None, 'runtime_consumer': None,
            'resource_role': self.resource_role,
            'track_binding_policy': self.track_binding_policy,
            'ignored_unbound_channels': self.ignored_unbound_channels,
            'hand_overlay_limit': 'No standalone world/body matrices; raw matched channels only until actual paired body/compositor is supplied' if self.resource_role == 'HAND_OVERLAY' else None,
        }


# Source-only matrix evaluator. Link posed equipment/receiving/body guide uses this same sample; helper mesh reconstruction remains separately reviewed.
