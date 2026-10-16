"""Render a fighter's native mesh BY MATERIAL CLASS for img2img conditioning (Donkey Kong by default).

The fighter is a parameter: `--fighter CONFIG.json` (default: the Donkey Kong config
docs/review/2026-09-25/donkeykong-character/rework-2026-10-10/art/fighter.json). The config names the native
pose evaluator (module/class), mesh directory, scale contract, expression layer, material classes/palette, and
which texture + classifier (or eye decal / constant class) colours each mesh material. Donkey Kong output is
byte-identical to the pre-config tool.

Sibling of tools/dk-native-guide.py (same posing evaluator, same helper-constraint
omission, same orthographic camera). That tool paints the game *texture*, whose
fur noise produces speckled edges. This tool instead:

* poses the same native skeleton/mesh for (motion, sample),
* classifies every texel of the single body texture ONCE into flat material
  classes (fur, skin, tie, tie lettering, mouth interior, ...) and mode-filters
  that class map so fur strands vanish,
* rasterises class ids (not colours) with a depth buffer,
* writes Pikachu-convention per-pose files: <key>-seed.png (flat colours on
  magenta), <key>-guide.png (clean lines only), <key>-render-mask.png and
  <key>-anatomy-mask.png, plus <key>-material.json provenance.

Guide lines come ONLY from: (a) silhouette, (b) depth/occlusion jumps,
(c) borders between material classes. Local authoring reference, not game art.
Run with:  ~/ComfyUI/.venv/bin/python -I tools/dk-material-guide.py MOTION SAMPLE OUT_PREFIX [--fighter CONFIG]
"""
from pathlib import Path
import argparse
import hashlib
import importlib
import importlib.util
import json
import sys
from types import SimpleNamespace
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from scipy import ndimage

TOOLS = Path(__file__).resolve().parent
sys.path.insert(0, str(TOOLS))
sys.path.insert(0, '/tmp/pikachu-source-libs')
import ssbh_data_py as ssbh  # noqa: E402
from dk_native_pose import ROOT, sha  # noqa: E402  (fighter-independent helpers)

# Reuse the sibling's captured-track sampler instead of copying it.
_spec = importlib.util.spec_from_file_location('dk_native_guide', TOOLS / 'dk-native-guide.py')
_guide = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_guide)
sample_captured_track = _guide.sample_captured_track

DEFAULT_FIGHTER = ROOT / 'docs/review/2026-09-25/donkeykong-character/rework-2026-10-10/art/fighter.json'
BACKGROUND = (204, 73, 140)              # keyed magenta, same as Pikachu
INK = (22, 17, 16)
OCCLUSION_DEPTH_JUMP = 0.45              # native units, same as dk-native-guide

# The active fighter (set by use_fighter; Donkey Kong on import so library callers keep DK behaviour).
F = SimpleNamespace()


def use_fighter(path):
    """Load a fighter config: pose evaluator, mesh dir, scale contract, classes (order = class id), materials."""
    path = Path(path).resolve()
    cfg = json.loads(path.read_text())
    module = importlib.import_module(cfg['pose_module'])
    classes = {name: {'id': i, 'rgb': tuple(rgb)} for i, (name, rgb) in enumerate(cfg['classes'].items())}
    if classes['background'] != {'id': 0, 'rgb': BACKGROUND}:
        raise SystemExit('class 0 must be the keyed magenta background')
    palette = np.zeros((len(classes), 3), dtype=np.uint8)
    for row in classes.values():
        palette[row['id']] = row['rgb']
    F.__dict__.update(config=path, cfg=cfg, Pose=getattr(module, cfg['pose_class']), motions=module.MOTIONS,
                      skeleton=module.SKEL, body=ROOT / cfg['body_dir'], contract=ROOT / cfg['scale_contract'],
                      expression_motion=cfg['expression_motion'], shell_material=cfg.get('shell_material'),
                      classes=classes, cid={name: row['id'] for name, row in classes.items()}, palette=palette,
                      exempt=set(cfg['small_classes_exempt']), attached=cfg.get('attached_classes', {}),
                      materials=cfg['materials'])


def build_texture_class_map(texture_rgba, mode_size):
    """Donkey Kong: per-texel material class of the body texture (fur noise filtered out)."""
    CID = F.cid
    rgb = texture_rgba[:, :, :3].astype(float)
    r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
    lum = (r + g + b) / 3
    labels = np.full(r.shape, CID['fur'], dtype=np.uint8)
    # light, low-saturation warm cream = skin (face/chest/hands/feet/ears)
    labels[(lum > 150) & (g > r * .72) & (b > r * .42)] = CID['skin']
    labels[(r > 150) & (r - g > 55) & (g < 130) & (r > b * 1.7) & (lum < 175)] = CID['tie']
    # black mouth interior lives only in this texture-space rect; elsewhere dark = shaded fur
    mouth = np.zeros(r.shape, dtype=bool)
    mouth[0:120, 330:545] = True
    labels[(lum < 70) & mouth] = CID['mouth']
    image = Image.fromarray(labels)
    for _ in range(2):
        image = image.filter(ImageFilter.ModeFilter(mode_size))
    return draw_tie_badge(np.array(image))


# The tie blade's front panel sits at texture u 576-644 / v 296-464 (probed by rendering the tie from
# yaw -90 and reading back texel coordinates; 1 screen px ~ 1 texel there). The yellow "DK" lettering
# is stamped into the class map, so it shows whenever the tie front faces the camera.
BADGE_CENTER_UV = (610, 384)
BADGE_FONT_PX = 46


def draw_tie_badge(class_map):
    patch = Image.new('L', (256, 128), 0)
    font = ImageFont.load_default(size=BADGE_FONT_PX)
    ImageDraw.Draw(patch).text((128, 64), 'DK', fill=255, font=font, anchor='mm', stroke_width=2)
    letters = np.asarray(patch) > 127
    x0, y0 = BADGE_CENTER_UV[0] - 128, BADGE_CENTER_UV[1] - 64
    window = class_map[y0:y0 + 128, x0:x0 + 256]
    window[letters & (window == F.cid['tie'])] = F.cid['tie_lettering']
    return class_map


def pikachu_class_map(texture_rgba, mode_size, facial):
    """Pikachu: the palette rules of tools/pikachu-native-guide.py (authored from the accepted registered reference),
    applied once in texture space. Body texture is mode-filtered like DK's; facial decals keep their small details."""
    CID = F.cid
    rgb = texture_rgba[:, :, :3].astype(float)
    r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
    labels = np.full(r.shape, CID['fur'], dtype=np.uint8)
    labels[(r < 65) & (g < 65) & (b < 65)] = CID['ink']                 # ear tips
    labels[(r > g * 1.25) & (b < g * .8)] = CID['stripe']               # back stripes, tail base
    labels[(r > g * 1.25) & (b >= g * .8)] = CID['cheek']               # red cheeks
    labels[(r > 220) & (g > 220) & (b > 220)] = CID['eye_white']        # eye highlight
    if facial:
        labels[(r < 120) & (g < 110) & (b < 110)] = CID['ink']          # eyes, nose, mouth line
        return labels
    image = Image.fromarray(labels)
    for _ in range(2):
        image = image.filter(ImageFilter.ModeFilter(mode_size))
    return np.array(image)


CLASSIFIERS = {
    'donkeykong_body': build_texture_class_map,
    'pikachu_body': lambda texture, mode_size: pikachu_class_map(texture, mode_size, facial=False),
    'pikachu_facial': lambda texture, mode_size: pikachu_class_map(texture, mode_size, facial=True),
}


class MaterialSource:
    """How one mesh material is coloured: a classified texture (optionally alpha-tested), an eye decal, or one class."""

    def __init__(self, spec, mode_size):
        self.kind = spec['source']
        if self.kind == 'texture':
            texture = np.asarray(Image.open(ROOT / spec['png']).convert('RGBA'))
            self.class_map = CLASSIFIERS[spec['classifier']](texture, mode_size)
            self.size = (texture.shape[1], texture.shape[0])
            self.alpha = texture[:, :, 3] if spec.get('alpha_test') else None
        elif self.kind == 'eye_decal':
            self.eyes = EyeSampler(ROOT / spec['png'])
        elif self.kind == 'class':
            self.cls = F.cid[spec['class']]
        else:
            raise SystemExit(f"unknown material source {self.kind}")

    def classify(self, uv, eye_uv):
        """(class ids, opaque mask or None) for the rasterised texture coordinates."""
        if self.kind == 'eye_decal':
            return self.eyes.classify(uv, eye_uv), None
        if self.kind == 'class':
            return np.full(uv.shape[:2], self.cls, dtype=np.uint8), None
        tx = np.floor(np.mod(uv[:, :, 0], 1) * self.size[0]).astype(int)
        ty = np.floor(np.mod(uv[:, :, 1], 1) * self.size[1]).astype(int)
        return self.class_map[ty, tx], None if self.alpha is None else self.alpha[ty, tx] > 127


def material_sources(mode_size):
    """Material label -> MaterialSource for the active fighter ('*' = default)."""
    return {label: MaterialSource(spec, mode_size) for label, spec in F.materials.items()}


def mesh_is_visible(mesh_name, visible):
    node = mesh_name.split('_VIS')[0].split('_O_OBJ')[0]
    return visible.get(node, '_VIS' not in mesh_name)


def collect_posed_meshes(motion_name, frame, include_shells, expression_frame, remove_trans=False):
    """Pose every visible mesh object; returns dicts with world-native vertices."""
    pose = F.Pose(F.motions / (motion_name + '.nuanmb'))
    omitted = sorted(pose.constrained)
    pose.constrained = set()   # same approximate-guide policy as dk-native-guide.py
    names = [bone.name for bone in pose.skeleton.bones]
    world = pose.matrices(frame, names)
    bind = pose.matrices(0, names, bind_pose=True)
    inverse_bind = {name: np.linalg.inv(matrix) for name, matrix in bind.items()}
    mesh = ssbh.mesh_data.read_mesh(str(F.body / 'model.numshb'))
    material_of = {(m.mesh_object_name, m.mesh_object_subindex): m.material_label
                   for m in ssbh.modl_data.read_modl(str(F.body / 'model.numdlb')).entries}
    # expression layer first, body motion last so explicit body tracks win
    visible = {}
    for name, at in ((F.expression_motion, expression_frame), (motion_name, frame)):
        animation = ssbh.anim_data.read_anim(str(F.motions / (name + '.nuanmb')))
        for group in animation.groups:
            if group.group_type.name == 'Visibility':
                for node in group.nodes:
                    visible[node.name] = sample_captured_track(node.tracks[0].values, at)
    eye_uv = {}
    for group in pose.animation.groups:
        if group.group_type.name == 'Material':
            for node in group.nodes:
                for track in node.tracks:
                    if track.name == 'CustomVector31':
                        eye_uv[node.name] = sample_captured_track(track.values, frame, linear=True)
    posed_meshes = []
    for obj in mesh.objects:
        if not mesh_is_visible(obj.name, visible):
            continue
        material = material_of[(obj.name, obj.subindex)]
        if material == F.shell_material and not include_shells:
            continue
        points = np.asarray(obj.positions[0].data[:, :3], dtype=np.float64)
        homogeneous = np.column_stack((points, np.ones(len(points))))
        if obj.bone_influences:
            posed = np.zeros_like(homogeneous)
            for influence in obj.bone_influences:
                name = influence.bone_name
                idx = np.array([v.vertex_index for v in influence.vertex_weights], dtype=int)
                weights = np.array([v.vertex_weight for v in influence.vertex_weights])
                posed[idx] += (homogeneous[idx] @ (world[name] @ inverse_bind[name]).T) * weights[:, None]
        elif obj.parent_bone_name:
            posed = homogeneous @ world[obj.parent_bone_name].T
        else:
            raise ValueError('Visible mesh lacks a coordinate route: ' + obj.name)
        if remove_trans:   # fixed-root registration: simulation owns travel (walk/run Trans moves forward)
            posed[:, :3] -= world['Trans'][:3, 3]
        posed_meshes.append({'name': obj.name, 'subindex': obj.subindex, 'material': material,
                             'vertices': posed[:, :3], 'indices': obj.vertex_indices,
                             'uvs': obj.texture_coordinates[0].data[:, :2],
                             'eye_uv': eye_uv.get(material, [1, 1, 0, 0])})
    return posed_meshes, omitted, pose


def load_contract():
    contract = json.loads(F.contract.read_text())
    return contract['art_pixels_per_native_unit'], contract


def rotate_yaw(vertices, degrees):
    """Rotate about the vertical axis (0 = the standard right-facing side view)."""
    c, sn = np.cos(np.radians(degrees)), np.sin(np.radians(degrees))
    out = vertices.copy()
    out[:, 0] = vertices[:, 0] * c + vertices[:, 2] * sn
    out[:, 2] = -vertices[:, 0] * sn + vertices[:, 2] * c
    return out


class EyeSampler:
    """Flat eye classes: white sclera mesh, dark decal split into iris/pupil."""

    def __init__(self, decal_png):
        self.decal = np.asarray(Image.open(decal_png).convert('RGBA'))

    def classify(self, uv, transform):
        sx, sy, du, dv = transform
        pupil_uv = np.stack((sx * (uv[:, :, 0] - du), 1 - sy * (1 - uv[:, :, 1] - dv)), axis=2)
        px = np.floor(np.mod(pupil_uv[:, :, 0], 1) * self.decal.shape[1]).astype(int)
        py = np.floor(np.mod(pupil_uv[:, :, 1], 1) * self.decal.shape[0]).astype(int)
        decal = self.decal[py, px]
        out = np.full(uv.shape[:2], F.cid['eye_white'], dtype=np.uint8)
        covered = decal[:, :, 3] > 127
        lum = decal[:, :, :3].astype(float).mean(axis=2)
        out[covered] = F.cid['pupil']
        out[covered & (lum > 120)] = F.cid['eye_white']   # specular dot reads as sclera white
        return out


def rasterize(meshes, scale, sources, size, root, yaw):
    width, height = size
    depth = np.full((height, width), np.inf)
    classes = np.zeros((height, width), dtype=np.uint8)
    group = np.full((height, width), -1, dtype=np.int16)
    for group_index, m in enumerate(meshes):
        v, uvs = rotate_yaw(m['vertices'], yaw), m['uvs']
        source = sources.get(m['material'], sources['*'])
        screen = np.column_stack((root[0] + v[:, 2] * scale, root[1] - v[:, 1] * scale))
        for triangle in m['indices'].reshape((-1, 3)):
            p = screen[triangle]
            lo = np.maximum(np.floor(p.min(axis=0)).astype(int), [0, 0])
            hi = np.minimum(np.ceil(p.max(axis=0)).astype(int), [width - 1, height - 1])
            if np.any(lo > hi):
                continue
            a, b, c = p
            den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
            if abs(den) < 1e-8:
                continue
            xx, yy = np.meshgrid(np.arange(lo[0], hi[0] + 1) + .5, np.arange(lo[1], hi[1] + 1) + .5)
            w0 = ((b[1] - c[1]) * (xx - c[0]) + (c[0] - b[0]) * (yy - c[1])) / den
            w1 = ((c[1] - a[1]) * (xx - c[0]) + (a[0] - c[0]) * (yy - c[1])) / den
            w2 = 1 - w0 - w1
            weights = np.stack((w0, w1, w2), axis=-1)
            xdepth = weights @ v[triangle, 0]   # native x negative = closer (right-facing view)
            section = np.s_[lo[1]:hi[1] + 1, lo[0]:hi[0] + 1]
            covered = (w0 >= -1e-6) & (w1 >= -1e-6) & (w2 >= -1e-6) & (xdepth < depth[section])
            if not covered.any():
                continue
            uv = weights @ uvs[triangle]
            cls, opaque = source.classify(uv, m['eye_uv'])
            if opaque is not None:
                covered &= opaque
            depth[section][covered] = xdepth[covered]
            classes[section][covered] = cls[covered]
            group[section][covered] = group_index
    return depth, classes, group


EYE_CLASSES = ('eye_white', 'iris', 'pupil')
IRIS_RX_FRAC, IRIS_RY_FRAC, IRIS_SHIFT_FRAC = 0.42, 0.50, 0.12   # dark iris/pupil ellipse inside the native eye
SOCKET_RADIUS_UNITS = 2.4
EYE_LINE_CLEAR_UNITS = 1.3


def refine_eyes(classes, inside, scale, yaw):
    """Small determined eyes under the heavy brow: keep the NATIVE open-eye geometry, make the dark
    iris/pupil fill most of it, drop the lid/lash guide lines around it and outline only the eye itself.

    The dark eye-socket texels next to the eye become fur (brow shadow). Returns
    (classes, ring_mask, suppress_mask, eyes): ring = eye outline, suppress = where native guide lines drop.
    """
    CID = F.cid
    eye = np.isin(classes, [CID[n] for n in EYE_CLASSES])
    labels, count = ndimage.label(ndimage.binary_dilation(eye, iterations=4))
    yy, xx = np.mgrid[0:classes.shape[0], 0:classes.shape[1]]
    ring = np.zeros(classes.shape, dtype=bool)
    suppress = np.zeros(classes.shape, dtype=bool)
    facing = 1.0 if abs(yaw) < 45 else 0.0
    out = classes.copy()
    eyes = []
    for index in range(1, count + 1):
        mask = (labels == index) & eye
        if mask.sum() < 60:
            continue
        ys, xs = np.nonzero(mask)
        w, h = xs.max() - xs.min() + 1, ys.max() - ys.min() + 1
        cx, cy = (xs.min() + xs.max()) / 2, (ys.min() + ys.max()) / 2
        socket = ((xx - cx) ** 2 + (yy - cy) ** 2 < (SOCKET_RADIUS_UNITS * scale) ** 2) & (out == CID['mouth'])
        out[socket] = CID['fur']
        iris = ((xx - cx - facing * IRIS_SHIFT_FRAC * w) / (IRIS_RX_FRAC * w)) ** 2 + ((yy - cy) / (IRIS_RY_FRAC * h)) ** 2 <= 1
        out[iris & mask] = CID['pupil']
        ring |= ndimage.binary_dilation(mask) & ~mask
        suppress |= (xx - cx) ** 2 + (yy - cy) ** 2 <= (EYE_LINE_CLEAR_UNITS * scale) ** 2
        eyes.append({'centre_px': [float(cx), float(cy)], 'w_px': int(w), 'h_px': int(h), 'white_px': int(mask.sum())})
    return out, ring & inside, suppress, eyes


def clean_classes(classes, inside, mode_size, min_island_px):
    """Mode-filter, then absorb tiny islands into the nearest large region."""
    filtered = np.asarray(Image.fromarray(classes).filter(ImageFilter.ModeFilter(mode_size)))
    cleaned = np.where(inside, filtered, 0).astype(np.uint8)
    keep = np.zeros(cleaned.shape, dtype=bool)
    for name, spec in F.classes.items():
        if not spec['id']:
            continue
        region = cleaned == spec['id']
        keep |= region if name in F.exempt else prune_small(region, min_island_px)
    # attached classes only survive next to their parent (DK: tie lettering; texture bleed elsewhere is not lettering)
    for child, parent in F.attached.items():
        near_parent = ndimage.binary_dilation(cleaned == F.cid[parent], iterations=6)
        keep &= (cleaned != F.cid[child]) | near_parent
    keep &= inside
    nearest = ndimage.distance_transform_edt(~keep, return_distances=False, return_indices=True)
    return cleaned[nearest[0], nearest[1]] * inside


def build_guide(depth, classes, inside, line_width, min_line_px, suppress, extra):
    """Clean line art from silhouette, occlusion jumps and material borders only."""
    edge = np.asarray(Image.fromarray((inside * 255).astype(np.uint8)).filter(ImageFilter.FIND_EDGES)) > 0
    occlusion = occlusion_pixels(depth)
    border = np.zeros(inside.shape, dtype=bool)
    for axis in (0, 1):
        shifted_depth = np.roll(depth, 1, axis=axis)
        both = np.isfinite(depth) & np.isfinite(shifted_depth)
        border |= both & (classes != np.roll(classes, 1, axis=axis))
    border[0, :] = False
    border[:, 0] = False
    lines = prune_small(edge | occlusion | border, min_line_px)
    lines = (lines & ~suppress) | extra
    guide = Image.fromarray((lines * 255).astype(np.uint8))
    if line_width > 1:
        guide = guide.filter(ImageFilter.MaxFilter(line_width))
    return guide, {'silhouette_px': int(edge.sum()), 'occlusion_px': int(occlusion.sum()),
                   'material_border_px': int(border.sum()), 'line_px_after_pruning': int(lines.sum())}


def prune_small(mask, min_pixels):
    """Drop 8-connected components smaller than min_pixels."""
    labels, count = ndimage.label(mask, structure=np.ones((3, 3)))
    sizes = ndimage.sum(mask, labels, index=np.arange(1, count + 1))
    keep = np.concatenate(([False], sizes >= min_pixels))
    return keep[labels]


def build_seed(classes, inside, occlusion_ink):
    seed = F.palette[classes].copy()
    seed[~inside] = BACKGROUND
    silhouette = Image.fromarray((inside * 255).astype(np.uint8))
    outer = np.asarray(silhouette.filter(ImageFilter.MaxFilter(5))) > 0
    outline = outer & ~inside
    seed[outline] = INK
    seed[occlusion_ink] = INK
    return seed


def occlusion_pixels(depth):
    out = np.zeros(depth.shape, dtype=bool)
    for axis in (0, 1):
        shifted = np.roll(depth, 1, axis=axis)
        both = np.isfinite(depth) & np.isfinite(shifted)
        diff = np.zeros_like(depth)
        np.subtract(depth, shifted, out=diff, where=both)
        out |= both & (np.abs(diff) > OCCLUSION_DEPTH_JUMP)
    out[0, :] = False
    out[:, 0] = False
    return out


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('motion')
    parser.add_argument('sample', type=float)
    parser.add_argument('destination', type=Path, help='output prefix, e.g. R/idle-source0')
    parser.add_argument('--shells', action='store_true', help='include alpha fur-shell meshes (default off)')
    parser.add_argument('--texture-mode', type=int, default=9, help='texture class-map mode filter size')
    parser.add_argument('--screen-mode', type=int, default=5, help='screen class mode filter size')
    parser.add_argument('--min-island', type=int, default=900, help='absorb class islands smaller than this (px)')
    parser.add_argument('--min-line', type=int, default=100, help='drop guide line fragments smaller than this (px)')
    parser.add_argument('--line-width', type=int, default=3)
    parser.add_argument('--expression-frame', type=float, default=0)
    parser.add_argument('--mask-dilate', type=int, default=21)
    parser.add_argument('--remove-trans', action='store_true', help='subtract captured Trans translation (fixed-root travel clips)')
    parser.add_argument('--fill-holes', type=int, default=4000, help='fill enclosed background holes up to this many px')
    parser.add_argument('--eyes', action='store_true', help='small dark eyes from the native open-eye geometry, lid/lash lines dropped')
    parser.add_argument('--width', type=int, default=1024)
    parser.add_argument('--height', type=int, default=1024)
    parser.add_argument('--root-x', type=int, default=512)
    parser.add_argument('--root-y', type=int, default=880)
    parser.add_argument('--yaw', type=float, default=0, help='view yaw about vertical axis in degrees (0 = side view)')
    parser.add_argument('--fighter', type=Path, default=DEFAULT_FIGHTER, help='fighter config json (default: Donkey Kong)')
    args = parser.parse_args()
    use_fighter(args.fighter)
    if not args.motion.replace('_', '').isalnum() or args.sample < 0:
        raise SystemExit('Invalid motion/sample')
    frame = int(args.sample) if args.sample.is_integer() else args.sample
    scale, contract = load_contract()
    size, root = (args.width, args.height), (args.root_x, args.root_y)
    sources = material_sources(args.texture_mode)
    meshes, omitted, pose = collect_posed_meshes(args.motion, frame, args.shells, args.expression_frame, args.remove_trans)
    depth, classes, group = rasterize(meshes, scale, sources, size, root, args.yaw)
    inside = np.isfinite(depth)
    holes = ndimage.binary_fill_holes(inside) & ~inside
    labels, count = ndimage.label(holes)
    small = np.isin(labels, [i + 1 for i, n in enumerate(ndimage.sum(holes, labels, range(1, count + 1))) if n <= args.fill_holes])
    inside |= small   # enclosed mesh gaps stay solid so the model cannot repaint magenta into them
    classes = clean_classes(np.where(inside, classes, 0).astype(np.uint8), inside, args.screen_mode, args.min_island)
    classes, ring, suppress, eyes = refine_eyes(classes, inside, scale, args.yaw) if args.eyes else (classes, np.zeros_like(inside), np.zeros_like(inside), [])
    guide, line_stats = build_guide(depth, classes, inside, args.line_width, args.min_line, suppress, ring)
    seed = build_seed(classes, inside, occlusion_pixels(depth) | ring)
    anatomy = Image.fromarray((inside * 255).astype(np.uint8))
    render_mask = anatomy.filter(ImageFilter.MaxFilter(args.mask_dilate)).filter(ImageFilter.GaussianBlur(2)).convert('RGB')
    prefix = str(args.destination)
    Path(prefix).parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(seed).save(prefix + '-seed.png')
    guide.save(prefix + '-guide.png')
    render_mask.save(prefix + '-render-mask.png')
    anatomy.save(prefix + '-anatomy-mask.png')
    Image.fromarray(sources['*'].class_map).point(lambda i: i * 20).save(prefix + '-texture-classes.png')
    ys, xs = np.nonzero(inside)
    present = {name: int((classes == spec['id']).sum()) for name, spec in F.classes.items() if spec['id']}
    metadata = {
        'state': 'unreviewed local authoring reference; not generated fighter art',
        'motion': args.motion, 'native_sample_index': frame, 'expression_layer': F.expression_motion,
        'expression_frame': args.expression_frame, 'canvas': size, 'root': root, 'view_yaw_deg': args.yaw, 'root_registration': 'remove-trans-translation' if args.remove_trans else 'captured',
        'view': 'orthographic along native x; negative x closer (right-facing)',
        'art_pixels_per_native_unit': scale, 'world_units_per_native_unit': contract['world_units_per_native_unit'],
        'world_pixels_per_art_pixel': contract['world_units_per_native_unit'] / scale,
        'scale_contract': str(F.contract.relative_to(ROOT)), 'scale_contract_sha256': sha(F.contract),
        'include_alpha_fur_shells': args.shells, 'texture_mode_filter': args.texture_mode,
        'screen_mode_filter': args.screen_mode, 'line_width': args.line_width,
        'omitted_helper_orient_constraints': omitted, 'line_sources': ['silhouette', 'depth jump > 0.45 native units', 'material class border'],
        'line_stats': line_stats, 'refined_eyes': eyes, 'filled_hole_px': int(small.sum()), 'class_pixels': present,
        **({'tie_badge': {'method': 'yellow DK stamped into the texture-space class map on the tie front panel', 'center_uv': BADGE_CENTER_UV,
                          'font_px': BADGE_FONT_PX}} if F.cfg['materials']['*'].get('classifier') == 'donkeykong_body' else {}),
        'silhouette_bounds_xyxy': [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())] if len(xs) else None,
        'palette': {name: spec['rgb'] for name, spec in F.classes.items()},
        'rendered_meshes': [{'mesh': m['name'], 'subindex': m['subindex'], 'material': m['material']} for m in meshes],
        'tool_sha256': sha(Path(__file__)), 'skeleton_sha256': sha(F.skeleton),
        'mesh_sha256': sha(F.body / 'model.numshb'), 'motion_sha256': sha(F.motions / (args.motion + '.nuanmb')),
        'fighter_config': str(F.config.relative_to(ROOT)), 'fighter_config_sha256': sha(F.config),
        'output_files': {Path(prefix + s).name: sha(Path(prefix + s))
                         for s in ('-seed.png', '-guide.png', '-render-mask.png', '-anatomy-mask.png')},
    }
    Path(prefix + '-material.json').write_text(json.dumps(metadata, indent=2) + '\n')
    print(json.dumps({'motion': args.motion, 'sample': frame, 'scale': scale, 'bounds': metadata['silhouette_bounds_xyxy'],
                      'classes': present}))


use_fighter(DEFAULT_FIGHTER)

if __name__ == '__main__':
    main()
