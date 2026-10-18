"""Render Donkey Kong's native mesh PER BODY PART (each part alone, so hidden areas exist).

Reuses tools/dk-material-guide.py (material classes, rasteriser, guide/seed builders).
Every triangle is given to the part whose bones carry most of its skin weight ("core");
a part's "cap" set also takes triangles where any vertex has >= CAP_W weight on the part,
which adds the neighbouring mesh around each joint (overlap material).

usage: ~/ComfyUI/.venv/bin/python native_parts.py OUTDIR [--cap 0.08]
Writes OUTDIR/<part>-{seed,guide,mask}.png (full canvas), OUTDIR/visible-parts.png (z-buffered
part ids of the whole body), OUTDIR/full-{seed,guide,mask}.png and OUTDIR/parts-native.json.
"""
import argparse, importlib.util, json, sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

TOOLS = Path('/home/lombet/Workspace/platform-fighter/tools')
sys.path.insert(0, str(TOOLS))
spec = importlib.util.spec_from_file_location('mg', TOOLS / 'dk-material-guide.py')
mg = importlib.util.module_from_spec(spec); spec.loader.exec_module(mg)
import ssbh_data_py as ssbh  # noqa: E402

SIZE = (2048, 1536)
ROOT = (1024, 1152)

# Rest pose: today's jab guard drawing (jab/4) comes from c00attack11 sample 18.
REST = ('c00attack11', 18)
# Head expressions: face bones (everything under Face/Mouth) taken relative to Head from another frame.
EXPRESSIONS = {'neutral': None, 'shout': ['HeavyAttack', 'FaceUP6'], 'grit': ['Attack2', 'FaceUP6']}
# Facial meshes are visibility swaps: lower face (mouth) + upper face (brows/eyes).
FACE_MESHES = {'FaceN', 'FaceUP1', 'FaceUP2', 'FaceUP3', 'FaceUP4', 'FaceUP5', 'FaceUP6', 'FaceUP7', 'FaceUP8', 'Attack', 'Attack2',
               'Attack3', 'HeavyAttack', 'HeavyOuch', 'Ouch', 'Talk', 'Blink', 'Halfblink1', 'Halfblink2', 'Halfblink3', 'Catch',
               'Capture', 'Cliff', 'Down', 'Escape', 'Fall', 'Furafura', 'Ottotto', 'PatternA', 'Stuckouteye1', 'Stuckouteye2'}
# Hand shapes: finger bones taken relative to Hand from another frame.
HANDS = {'fist': None, 'open': ('g01cliffcatch', 5)}


def part_of(b):
    for prefix, part in (('Finger', 'hand'), ('Hand', 'hand'), ('Have', 'hand'), ('Arm', 'forearm'), ('Shoulder', 'upper_arm'),
                         ('Leg', 'thigh'), ('Knee', 'shin'), ('Foot', 'foot'), ('Toe', 'foot')):
        if b.startswith(prefix):
            return f'{part}_{b[len(prefix)]}'
    if b.startswith('S_Necktie') or b == 'Necktie':
        return 'tie'
    if b in ('Trans', 'Rot', 'Hip', 'Waist', 'Bust', 'Throw') or 'Clavicle' in b:
        return 'torso'
    return 'head'   # Neck, Head, Face, Mouth, brows, lips, jaw, hair ...


def descendants(skel_names, parents, root):
    out, stack = [], [root]
    while stack:
        n = stack.pop()
        for c in skel_names:
            if parents[c] == n:
                out.append(c); stack.append(c)
    return out


class Rig:
    def __init__(self):
        mg.use_fighter(mg.DEFAULT_FIGHTER)
        self.scale, _ = mg.load_contract()
        self.skel = ssbh.skel_data.read_skel(str(mg.F.skeleton))
        self.names = [b.name for b in self.skel.bones]
        self.parents = {b.name: (self.names[b.parent_index] if b.parent_index is not None else None) for b in self.skel.bones}
        self.mesh = ssbh.mesh_data.read_mesh(str(mg.F.body / 'model.numshb'))
        self.material_of = {(m.mesh_object_name, m.mesh_object_subindex): m.material_label
                            for m in ssbh.modl_data.read_modl(str(mg.F.body / 'model.numdlb')).entries}
        self.sources = mg.material_sources(9)

    def world(self, motion, frame):
        pose = mg.F.Pose(mg.F.motions / (motion + '.nuanmb'))
        pose.constrained = set()
        return pose.matrices(frame, self.names), pose

    def graft(self, world, src, anchor, bones):
        """Replace `bones` in `world` by their pose in `src`, carried rigidly by `anchor`."""
        R = world[anchor] @ np.linalg.inv(src[anchor])
        out = dict(world)
        for b in bones:
            out[b] = R @ src[b]
        return out

    def posed(self, world, motion, frame, vis=None):
        """Posed mesh objects with per-vertex part weights (copy of mg.collect_posed_meshes + weights)."""
        bp = mg.F.Pose(mg.F.motions / (motion + '.nuanmb')); bp.constrained = set()
        bind = bp.matrices(0, self.names, bind_pose=True)
        inv_bind = {n: np.linalg.inv(m) for n, m in bind.items()}
        visible = {}
        for name, at in ((mg.F.expression_motion, 0), (motion, frame)):
            anim = ssbh.anim_data.read_anim(str(mg.F.motions / (name + '.nuanmb')))
            for group in anim.groups:
                if group.group_type.name == 'Visibility':
                    for node in group.nodes:
                        visible[node.name] = mg.sample_captured_track(node.tracks[0].values, at)
        if vis:
            for k in [k for k in visible if k.startswith('donkey_') and k[7:].split('_')[0] in FACE_MESHES]:
                visible[k] = False
            visible.update(vis)
        out = []
        for obj in self.mesh.objects:
            if not mg.mesh_is_visible(obj.name, visible):
                continue
            material = self.material_of[(obj.name, obj.subindex)]
            if material == mg.F.shell_material:
                continue
            pts = np.asarray(obj.positions[0].data[:, :3], dtype=np.float64)
            hom = np.column_stack((pts, np.ones(len(pts))))
            weights = {}
            if obj.bone_influences:
                posed = np.zeros_like(hom)
                for inf in obj.bone_influences:
                    idx = np.array([v.vertex_index for v in inf.vertex_weights], dtype=int)
                    w = np.array([v.vertex_weight for v in inf.vertex_weights])
                    posed[idx] += (hom[idx] @ (world[inf.bone_name] @ inv_bind[inf.bone_name]).T) * w[:, None]
                    p = part_of(inf.bone_name)
                    weights.setdefault(p, np.zeros(len(pts)))[idx] += w
            else:
                posed = hom @ world[obj.parent_bone_name].T
                weights[part_of(obj.parent_bone_name)] = np.ones(len(pts))
            out.append({'name': obj.name, 'subindex': obj.subindex, 'material': material, 'vertices': posed[:, :3],
                        'indices': np.asarray(obj.vertex_indices), 'uvs': obj.texture_coordinates[0].data[:, :2],
                        'eye_uv': [1, 1, 0, 0], 'weights': weights})
        return out

    def project(self, world, bone):
        t = world[bone][:3, 3]
        return [ROOT[0] + t[2] * self.scale, ROOT[1] - t[1] * self.scale, float(t[0])]


def subset(meshes, part, cap):
    """Meshes reduced to the triangles of one part. cap=None: core (argmax part); else any vertex >= cap."""
    out = []
    for m in meshes:
        tri = m['indices'].reshape(-1, 3)
        parts = sorted(m['weights'])
        W = np.stack([m['weights'][p] for p in parts], 1)          # verts x parts
        if part not in parts:
            continue
        k = parts.index(part)
        if cap is None:
            keep = W[tri].sum(1).argmax(1) == k
        else:
            keep = (W[tri][:, :, k] >= cap).any(1)
        if keep.any():
            out.append({**m, 'indices': tri[keep].reshape(-1)})
    return out


def render(meshes, rig, eyes):
    depth, classes, _ = mg.rasterize(meshes, rig.scale, rig.sources, SIZE, ROOT, 0)
    inside = np.isfinite(depth)
    holes = ndimage.binary_fill_holes(inside) & ~inside
    lab, n = ndimage.label(holes)
    sizes = ndimage.sum(holes, lab, range(1, n + 1))
    inside |= np.isin(lab, [i + 1 for i, v in enumerate(sizes) if v <= 4000])
    classes = mg.clean_classes(np.where(inside, classes, 0).astype(np.uint8), inside, 5, 150)
    if eyes:
        classes, ring, suppress, _ = mg.refine_eyes(classes, inside, rig.scale, 0)
    else:
        ring = suppress = np.zeros_like(inside)
    guide, _ = mg.build_guide(depth, classes, inside, 3, 40, suppress, ring)
    seed = mg.build_seed(classes, inside, mg.occlusion_pixels(depth) | ring)
    return depth, classes, inside, guide, seed


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('out', type=Path)
    ap.add_argument('--cap', type=float, default=0.08)
    ap.add_argument('--only', default='')
    a = ap.parse_args()
    a.out.mkdir(parents=True, exist_ok=True)
    rig = Rig()
    world, _ = rig.world(*REST)
    meshes = rig.posed(world, *REST)
    face_bones = [b for b in descendants(rig.names, rig.parents, 'Head')]
    parts_all = sorted({p for m in meshes for p in m['weights']})
    # near side = the side whose shoulder is closer to the camera (native x negative = closer)
    near = 'L' if rig.project(world, 'ShoulderL')[2] < rig.project(world, 'ShoulderR')[2] else 'R'
    joints = {n: rig.project(world, n) for n in ('Hip', 'Neck', 'Head', 'Necktie', 'S_Necktie1', 'ClavicleL', 'ClavicleR',
                                                  'ShoulderL', 'ShoulderR', 'ArmL', 'ArmR', 'HandL', 'HandR', 'HaveL', 'HaveR',
                                                  'LegL', 'LegR', 'KneeL', 'KneeR', 'FootL', 'FootR', 'ToeL', 'ToeR',
                                                  'S_Necktie2', 'S_Necktie3', 'S_Necktie4', 'S_Necktie5_null')}
    meta = {'rest': REST, 'size': SIZE, 'root': ROOT, 'art_px_per_native_unit': rig.scale, 'near_side': near,
            'joints_art_px': joints, 'parts': {}}
    # whole body + per-pixel visible part (z-buffer over core parts)
    depth, classes, inside, guide, seed = render(meshes, rig, True)
    Image.fromarray(seed).save(a.out / 'full-seed.png'); guide.save(a.out / 'full-guide.png')
    Image.fromarray((inside * 255).astype(np.uint8)).save(a.out / 'full-mask.png')
    zbuf = np.full(inside.shape, np.inf); vis = np.zeros(inside.shape, np.uint8)
    for i, p in enumerate(parts_all, 1):
        d, *_ = mg.rasterize(subset(meshes, p, None), rig.scale, rig.sources, SIZE, ROOT, 0)
        closer = d < zbuf; zbuf[closer] = d[closer]; vis[closer] = i
    Image.fromarray(vis).save(a.out / 'visible-parts.png')
    meta['visible_part_ids'] = {p: i for i, p in enumerate(parts_all, 1)}
    variants = [(p, None, None) for p in parts_all]
    variants += [('head', 'expr', e) for e in EXPRESSIONS if EXPRESSIONS[e]]
    variants += [(f'hand_{s}', 'hand', h) for s in 'LR' for h in HANDS if HANDS[h]]
    only = set(filter(None, a.only.split(',')))
    for part, kind, key in variants:
        name = part if kind is None else f'{part}-{key}'
        if only and name not in only:
            continue
        w, vis = world, None
        if kind == 'expr':
            vis = {f'donkey_{x}': True for x in EXPRESSIONS[key] + ['Eye']}
        if kind == 'hand':
            s = part[-1]; src, _ = rig.world(*HANDS[key])
            w = rig.graft(world, src, 'Hand' + s, descendants(rig.names, rig.parents, 'Hand' + s))
        m = meshes if (w is world and vis is None) else rig.posed(w, *REST, vis=vis)
        for mode, cap in (('core', None), ('cap', a.cap)):
            d, c, ins, g, sd = render(subset(m, part, cap), rig, part == 'head')
            Image.fromarray(sd).save(a.out / f'{name}-{mode}-seed.png'); g.save(a.out / f'{name}-{mode}-guide.png')
            Image.fromarray((ins * 255).astype(np.uint8)).save(a.out / f'{name}-{mode}-mask.png')
            np.save(a.out / f'{name}-{mode}-depth.npy', np.where(ins, d, np.inf).astype(np.float32))
            ys, xs = np.nonzero(ins)
            meta['parts'].setdefault(name, {})[mode] = {'bbox': [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1],
                                                        'pixels': int(ins.sum())}
        print(name, meta['parts'][name])
    (a.out / 'parts-native.json').write_text(json.dumps(meta, indent=1))


if __name__ == '__main__':
    main()
