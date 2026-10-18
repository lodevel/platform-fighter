"""Rig poses from native Donkey Kong motion frames: each part's 2D rotation is the best rotation between its bone's
projected axes at rest (c00attack11 18) and at the target frame; the root moves with the projected hip.

usage: ~/ComfyUI/.venv/bin/python pose_native.py OUT.json name=motion:frame[:swap=slot/part,...] ...
"""
import json, math, sys
import numpy as np
sys.path.insert(0, '/tmp/claude-1000/-home-lombet-Workspace-platform-fighter/a7dfccb5-31fd-4c9e-86a2-6a914ded46da/scratchpad/dk-parts')
from native_parts import Rig, REST
from shape_parts import RIG
from post_parts import ART_TO_SOURCE


def screen_axes(M):
    # screen x = native z, screen y = -native y (orthographic, right-facing)
    return [np.array([M[2, i], -M[1, i]]) for i in range(3)]


def angle_between(rest, target):
    num = sum(a[0] * b[1] - a[1] * b[0] for a, b in zip(rest, target))
    den = sum(a @ b for a, b in zip(rest, target))
    return math.degrees(math.atan2(num, den))


def vec_angle(rig, W, a, b):
    p, q = rig.project(W, a), rig.project(W, b)
    return math.degrees(math.atan2(q[1] - p[1], q[0] - p[0]))


DIRECTION = {'upper': lambda b, c: c['elbow'], 'forearm': lambda b, c: c['wrist'], 'thigh': lambda b, c: c['knee'],
             'shin': lambda b, c: c['ankle'], 'torso': lambda b, c: 'Neck', 'tie': lambda b, c: 'S_Necktie3'}


def main():
    rig = Rig()
    rest, _ = rig.world(*REST)
    out = {}
    for arg in sys.argv[2:]:
        name, spec = arg.split('=', 1)
        bits = spec.split(':')
        motion, frame = bits[0], float(bits[1])
        frame = int(frame) if frame.is_integer() else frame
        swap = dict(s.split('/') for s in bits[2].split(',')) if len(bits) > 2 else {}
        w, _ = rig.world(motion, frame)
        absolute = {}
        for part, (_, parent, bone, children) in RIG.items():
            tip = DIRECTION.get(part.split('_')[0], (lambda b, c: None))(bone, children)
            if tip:   # limb segments: the pivot -> next joint vector decides placement
                absolute[part] = vec_angle(rig, w, bone, tip) - vec_angle(rig, rest, bone, tip)
            else:     # end parts: best rotation of the bone's projected axes
                absolute[part] = angle_between(screen_axes(rest[bone]), screen_axes(w[bone]))
        angles = {}
        for part, (_, parent, bone, _) in RIG.items():
            rel = absolute[part] - (absolute[parent] if parent else 0)
            angles[part] = round((rel + 180) % 360 - 180, 2)
        hip0, hip1 = rig.project(rest, 'Hip'), rig.project(w, 'Hip')
        trans = w['Trans'][:3, 3] if 'Trans' in w else np.zeros(3)
        root = [round((hip1[0] - hip0[0] - trans[2] * rig.scale) * ART_TO_SOURCE, 2), round((hip1[1] - hip0[1]) * ART_TO_SOURCE, 2)]
        out[name] = {'source': f'{motion}:{frame}', 'root': root, 'angles': angles, 'swap': swap}
        print(name, root, {k: v for k, v in angles.items() if abs(v) > 1})
    open(sys.argv[1], 'w').write(json.dumps(out, indent=1))


if __name__ == '__main__':
    main()
