"""Minimal 2D cutout rig: place parts from parts.json by forward kinematics and composite them.

pose = {'root': [dx, dy] (source px, added to torso pivot), 'angles': {part: degrees, screen clockwise, relative to rest},
        'swap': {slot: part}}   # e.g. {'head': 'head_shout'}
Rest pose (all angles 0) reproduces the layout the parts were drawn in.
"""
import json, math
from pathlib import Path
import numpy as np
from PIL import Image


def load(d):
    d = Path(d)
    spec = json.loads((d / 'parts.json').read_text())
    imgs = {n: Image.open(d / p['file']).convert('RGBA') for n, p in spec['parts'].items()}
    return spec, imgs


def active_parts(spec, pose):
    swap = pose.get('swap', {})
    hidden = set()
    for slot, members in spec['slots'].items():
        chosen = swap.get(slot, members[0])
        hidden |= {m for m in members if m != chosen}
    return [n for n in sorted(spec['parts'], key=lambda n: spec['parts'][n]['drawOrder']) if n not in hidden]


def world_transforms(spec, pose):
    """part -> (A 2x2, t) mapping part pixel coords to root-relative source px."""
    P, ang = spec['parts'], pose.get('angles', {})
    cache = {}

    def T(n):
        if n in cache:
            return cache[n]
        p = P[n]
        a = math.radians(ang.get(n, 0.0))
        R = np.array([[math.cos(a), -math.sin(a)], [math.sin(a), math.cos(a)]])
        piv = np.array(p['pivot'], float)
        if p['parent'] is None:
            pw = np.array(p['restPivot'], float) + np.array(pose.get('root', [0, 0]), float)
            A = R
        else:
            Ap, tp = T(p['parent'])
            joint = np.array(P[p['parent']]['joints'][p['parentJoint']], float)
            pw = Ap @ joint + tp
            A = Ap @ R
        t = pw - A @ piv
        cache[n] = (A, t)
        return cache[n]
    return {n: T(n) for n in P}


def render(spec, imgs, pose, scale=1.0, canvas=(420, 340), root=(170, 300), tint_far=None):
    """Composite at `scale` screen px per source px. root = where the ground root lands on the canvas."""
    out = Image.new('RGBA', canvas, (0, 0, 0, 0))
    Ts = world_transforms(spec, pose)
    for n in active_parts(spec, pose):
        A, t = Ts[n]
        M = scale * A
        off = scale * t + np.array(root, float)
        Minv = np.linalg.inv(M)
        c = Minv @ (-off)
        im = imgs[n]
        if tint_far and n.endswith('_far'):
            arr = np.asarray(im).astype(float); arr[..., :3] *= tint_far; im = Image.fromarray(arr.astype(np.uint8), 'RGBA')
        # premultiply so bicubic edges do not darken
        pre = np.asarray(im).astype(np.float32); pre[..., :3] *= pre[..., 3:] / 255
        layer = Image.merge('RGBA', [Image.fromarray(pre[..., i]).transform(canvas, Image.Transform.AFFINE,
                                     (Minv[0, 0], Minv[0, 1], c[0], Minv[1, 0], Minv[1, 1], c[1]), Image.Resampling.BICUBIC).convert('L')
                                     for i in range(4)])
        la = np.asarray(layer).astype(np.float32)
        base = np.asarray(out).astype(np.float32)
        a = la[..., 3:] / 255
        rgb = la[..., :3] + base[..., :3] * (base[..., 3:] / 255) * (1 - a)
        A_ = la[..., 3:] + base[..., 3:] * (1 - a)
        rgb = rgb / np.maximum(A_ / 255, 1e-4)
        out = Image.fromarray(np.dstack((np.clip(rgb, 0, 255), np.clip(A_, 0, 255))).astype(np.uint8), 'RGBA')
    return out
