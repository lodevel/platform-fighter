#!/usr/bin/env python3
"""Author DK Final sprite pages from native poses and a new CPU cel-art recipe.

Uses retained material classifiers for identity colours, then authors smooth-normal
light bands, clean ink and fixed source-root registration. These are new authored
drawings, not renamed conditioning guides or a native-shader parity claim.
PYTHONPATH=.tmp/pikachu-final-libs:tools python3 tools/render-dk-final-art.py --pilot
"""
from pathlib import Path
import argparse
import hashlib
import importlib.util
import json
import time
import numpy as np
from PIL import Image, ImageFilter
import ssbh_data_py as ssbh
from dk_native_pose import DonkeyKongNativePose, BASE, MOTIONS

ROOT = Path(__file__).resolve().parent.parent
REVIEW = ROOT / 'docs/review/2026-10-15/dk-final'
OUT = REVIEW / 'owner-art-staging'
PLAN = json.loads((REVIEW / 'owner-art-plan.json').read_text())
SIZE, ORIGIN = tuple(PLAN['frameSize']), tuple(PLAN['root'])
PPU = PLAN['pixelsPerNativeUnit']
BODY = BASE / 'raw-model/fighter/donkey/model/body/c00'
INK = np.array([31, 22, 19], dtype=np.uint8)
LIGHT = np.array([-.65, .7, .3]); LIGHT /= np.linalg.norm(LIGHT)
spec = importlib.util.spec_from_file_location('dk_material_reference', ROOT / 'tools/dk-material-guide.py')
materials = importlib.util.module_from_spec(spec); spec.loader.exec_module(materials)


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


class Renderer:
    def __init__(self):
        self.sources = materials.material_sources(9)
        self.palette = materials.F.palette
        self.animations = {}
        self.mapping = {(row.mesh_object_name, row.mesh_object_subindex): row.material_label
                        for row in ssbh.modl_data.read_modl(str(BODY / 'model.numdlb')).entries}
        self.objects = []
        for obj in ssbh.mesh_data.read_mesh(str(BODY / 'model.numshb')).objects:
            label = self.mapping[(obj.name, obj.subindex)]
            if label == materials.F.shell_material:
                continue
            points = np.asarray(obj.positions[0].data[:, :3], dtype=np.float64)
            normals = np.asarray(obj.normals[0].data[:, :3], dtype=np.float64)
            weights = [(row.bone_name, np.array([v.vertex_index for v in row.vertex_weights], dtype=int),
                        np.array([v.vertex_weight for v in row.vertex_weights])) for row in obj.bone_influences]
            self.objects.append((obj, label, np.column_stack((points, np.ones(len(points)))), normals, weights))
        self.expression = ssbh.anim_data.read_anim(str(MOTIONS / 'a00defaulteyelid.nuanmb'))

    def draw_mesh(self, vertices, normals, obj, label, eye_uv, pixels, depth):
        screen = np.column_stack((ORIGIN[0] + vertices[:, 2] * PPU, ORIGIN[1] - vertices[:, 1] * PPU))
        uvs = np.asarray(obj.texture_coordinates[0].data[:, :2])
        source = self.sources.get(label, self.sources['*'])
        intensity = (normals / np.maximum(1e-9, np.linalg.norm(normals, axis=1, keepdims=True))) @ LIGHT
        for triangle in np.asarray(obj.vertex_indices).reshape((-1, 3)):
            p = screen[triangle]
            low = np.maximum(np.floor(p.min(axis=0)).astype(int), [0, 0])
            high = np.minimum(np.ceil(p.max(axis=0)).astype(int), [SIZE[0] - 1, SIZE[1] - 1])
            if np.any(low > high):
                continue
            a, b, c = p
            den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
            if abs(den) < 1e-8:
                continue
            xx, yy = np.meshgrid(np.arange(low[0], high[0] + 1) + .5, np.arange(low[1], high[1] + 1) + .5)
            w0 = ((b[1] - c[1]) * (xx - c[0]) + (c[0] - b[0]) * (yy - c[1])) / den
            w1 = ((c[1] - a[1]) * (xx - c[0]) + (a[0] - c[0]) * (yy - c[1])) / den
            w2 = 1 - w0 - w1
            weights = np.stack((w0, w1, w2), axis=-1)
            z = weights @ vertices[triangle, 0]
            section = np.s_[low[1]:high[1] + 1, low[0]:high[0] + 1]
            covered = (w0 >= -1e-6) & (w1 >= -1e-6) & (w2 >= -1e-6) & (z < depth[section])
            if not covered.any():
                continue
            classes, opaque = source.classify(weights @ uvs[triangle], eye_uv)
            if opaque is not None:
                covered &= opaque
            shade = weights @ intensity[triangle]
            paint = self.palette[classes].astype(float)
            # Authored three-band cel light, preserving small facial/tie identity marks.
            band = np.where(shade < .05, .83, np.where(shade > .7, 1.13, 1.))
            shaded = np.isin(classes, [materials.F.cid[name] for name in ['fur', 'skin', 'tie', 'brow']])
            paint[shaded] *= band[shaded, None]
            rgba = np.empty((*classes.shape, 4), dtype=np.uint8)
            rgba[:, :, :3] = np.minimum(255, np.rint(paint)).astype(np.uint8); rgba[:, :, 3] = 255
            pixels[section][covered] = rgba[covered]; depth[section][covered] = z[covered]

    def posed_meshes(self, motion, sample):
        pose = self.animations.get(motion)
        if pose is None:
            pose = DonkeyKongNativePose(MOTIONS / (motion + '.nuanmb'))
            pose._art_omitted = sorted(pose.constrained); pose.constrained = set()
            names = [bone.name for bone in pose.skeleton.bones]
            pose._art_inverse_bind = {name: np.linalg.inv(matrix) for name, matrix in pose.matrices(0, names, bind_pose=True).items()}
            self.animations[motion] = pose
        world = pose.matrices(sample, [bone.name for bone in pose.skeleton.bones])
        visible, eyes = {}, {}
        for animation, at in [(self.expression, 0), (pose.animation, sample)]:
            for group in animation.groups:
                for node in group.nodes:
                    if group.group_type.name == 'Visibility':
                        visible[node.name] = materials.sample_captured_track(node.tracks[0].values, at)
                    elif group.group_type.name == 'Material':
                        for track in node.tracks:
                            if track.name == 'CustomVector31':
                                eyes[node.name] = materials.sample_captured_track(track.values, at, linear=True)
        meshes = []
        for obj, label, points, normals, influences in self.objects:
            if not materials.mesh_is_visible(obj.name, visible):
                continue
            if influences:
                posed = np.zeros_like(points); posed_normals = np.zeros_like(normals); total = np.zeros(len(points))
                for name, indices, weights in influences:
                    transform = world[name] @ pose._art_inverse_bind[name]
                    posed[indices] += (points[indices] @ transform.T) * weights[:, None]
                    posed_normals[indices] += (normals[indices] @ np.linalg.inv(transform[:3, :3])) * weights[:, None]
                    total[indices] += weights
                if np.max(np.abs(total - 1)) > .0001:
                    raise ValueError('Unnormalized native weights')
            elif obj.parent_bone_name:
                posed = points @ world[obj.parent_bone_name].T
                posed_normals = normals @ np.linalg.inv(world[obj.parent_bone_name][:3, :3])
            else:
                raise ValueError('Visible mesh has no reviewed coordinate route')
            posed[:, :3] -= world['Trans'][:3, 3]
            meshes.append((posed[:, :3], posed_normals, obj, label, eyes.get(label, [1, 1, 0, 0])))
        return meshes, world['Trans'][:3, 3].tolist(), pose._art_omitted

    def render(self, motion, sample):
        meshes, trans, omitted = self.posed_meshes(motion, sample)
        pixels = np.zeros((SIZE[1], SIZE[0], 4), dtype=np.uint8)
        depth = np.full((SIZE[1], SIZE[0]), np.inf)
        for vertices, normals, obj, label, eye_uv in meshes:
            self.draw_mesh(vertices, normals, obj, label, eye_uv, pixels, depth)
        mask = Image.fromarray(pixels[:, :, 3]); outline = mask.filter(ImageFilter.MaxFilter(5))
        result = Image.new('RGBA', SIZE, (*INK, 0)); result.putalpha(outline); result.alpha_composite(Image.fromarray(pixels))
        seams = materials.occlusion_pixels(depth)
        paint = np.asarray(result).copy(); paint[seams, :3] = INK
        result = Image.fromarray(paint); bounds = result.getbbox()
        if bounds is None or min(bounds[:2]) < 2 or bounds[2] > SIZE[0] - 2 or bounds[3] > SIZE[1] - 2:
            raise ValueError(f'Art clipped {motion}/{sample}/{bounds}')
        return result, {'nativeSample': sample, 'bounds': bounds, 'trans': trans,
                        'omittedHelperConstraints': omitted}


def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--pilot', action='store_true'); parser.add_argument('--bounds', action='store_true'); args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True); (OUT / 'animations').mkdir(exist_ok=True)
    renderer = Renderer(); start = time.monotonic()
    if args.bounds:
        records = []
        for clip in PLAN['clips']:
            bounds = []
            for sample in clip['samples']:
                meshes, _, _ = renderer.posed_meshes(clip['motion'], sample)
                points = np.concatenate([row[0][:, [2, 1]] for row in meshes])
                bounds.append([sample, *points.min(axis=0).tolist(), *points.max(axis=0).tolist()])
            records.append({'sheet': clip['sheet'], 'samples': bounds})
        (OUT / 'mesh-preflight.json').write_text(json.dumps(records, indent=2) + '\n')
        print(json.dumps({'preflight': str(OUT / 'mesh-preflight.json'), 'seconds': time.monotonic() - start})); return
    if args.pilot:
        jobs = [('d04finalstart', 0), ('d04finalstart', 30), ('d04finalattack', 5), ('d04finalend', 7)]
        gallery = Image.new('RGBA', (SIZE[0] * len(jobs), SIZE[1]), (39, 49, 66, 255))
        for index, (motion, sample) in enumerate(jobs):
            drawing, _ = renderer.render(motion, sample); gallery.alpha_composite(drawing, (index * SIZE[0], 0))
        gallery.convert('RGB').save(OUT / 'pilot.jpg')
        print(json.dumps({'pilot': str(OUT / 'pilot.jpg'), 'seconds': time.monotonic() - start})); return
    metadata = {}
    for clip in PLAN['clips']:
        receipts, trims = [], []; x, y, row_height = 2, 2, 0
        atlas = Image.new('RGBA', (4096, 8192))
        for sample in clip['samples']:
            drawing, receipt = renderer.render(clip['motion'], sample)
            bounds = drawing.getbbox(); crop = drawing.crop(bounds)
            if x + crop.width + 2 > atlas.width:
                x = 2; y += row_height + 4; row_height = 0
            if y + crop.height + 2 > atlas.height:
                raise ValueError(f"Atlas budget exceeded {clip['sheet']}")
            atlas.alpha_composite(crop, (x, y)); trims.append([x, y, crop.width, crop.height, bounds[0], bounds[1]])
            x += crop.width + 4; row_height = max(row_height, crop.height); receipts.append(receipt)
        atlas = atlas.crop((0, 0, atlas.width, y + row_height + 2))
        destination = OUT / 'animations' / f"{clip['sheet']}.png"; atlas.save(destination, optimize=True)
        metadata[clip['sheet']] = {'strip': f"animations/{clip['sheet']}.png", 'frameCount': len(receipts),
            'frameWidth': SIZE[0], 'frameHeight': SIZE[1], 'atlas': list(atlas.size), 'trims': trims, 'root': list(ORIGIN),
            'scaleToWorld': PLAN['scaleToWorld'], 'bodyCentreFromRootY': -42, 'coordinateOrigin': 'actorSourceRoot',
            'sourceSampleBasis': 'zero-based-native-index', 'nativeSampleIndices': clip['samples'], 'loopDuration': None,
            'sha256': sha(destination), 'artProvenance': {'recipe': 'authored CPU material palette/smooth-normal cel bands/outline/depth ink',
                'rendererSha256': sha(__file__), 'materialClassifierSha256': sha(ROOT / 'tools/dk-material-guide.py'),
                'meshSha256': sha(BODY / 'model.numshb'), 'motionSha256': clip['motionSha256'],
                'fixedOutputResolutionFactor': PLAN['fixedOutputResolutionFactor'], 'scaleContract': PLAN['scaleContract'],
                'noPerPoseFloorSnap': True, 'rootRegistration': 'remove-trans-translation',
                'limitations': ['helper-orient constraints omitted for visual skinning', 'authored light/camera/palette, not native shader parity']},
            'drawingReceipts': receipts}
        print(json.dumps({'sheet': clip['sheet'], 'drawings': len(receipts), 'seconds': time.monotonic() - start}), flush=True)
    (OUT / 'art-clips.json').write_text(json.dumps(metadata, indent=2) + '\n')
    print(json.dumps({'complete': True, 'drawings': sum(row['frameCount'] for row in metadata.values()), 'seconds': time.monotonic() - start}), flush=True)


if __name__ == '__main__':
    main()
