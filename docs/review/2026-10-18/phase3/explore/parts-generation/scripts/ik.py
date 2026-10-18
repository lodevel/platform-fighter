"""Feet-planted helper: choose thigh/shin angles so each ankle stays where it is at rest (grid search)."""
import numpy as np
import rig


def ankle(spec, pose, side):
    A, t = rig.world_transforms(spec, pose)[f'shin_{side}']
    return A @ np.array(spec['parts'][f'shin_{side}']['joints']['ankle']) + t


def plant(spec, pose):
    pose = {**pose, 'angles': dict(pose.get('angles', {}))}
    for side in ('near', 'far'):
        target = ankle(spec, {}, side)
        best = None
        for a in range(-120, 121, 3):
            for b in range(-120, 121, 3):
                pose['angles'][f'thigh_{side}'], pose['angles'][f'shin_{side}'] = a, b
                e = np.linalg.norm(ankle(spec, pose, side) - target) + 0.02 * (abs(a) + abs(b))
                if best is None or e < best[0]:
                    best = (e, a, b)
        _, a, b = best
        pose['angles'][f'thigh_{side}'], pose['angles'][f'shin_{side}'] = a, b
        pose['angles'][f'foot_{side}'] = -(pose['angles'].get('torso', 0) + a + b)   # keep the foot flat
    return pose
