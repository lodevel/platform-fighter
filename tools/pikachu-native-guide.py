"""Render local native reference geometry for pose-guide review only.

This is an authored orthographic CPU preview, not the game's renderer. Helper
orient constraints, material animation/shader effects and lighting are omitted.
Do not ship these reference renders as fighter art or use their pixels as proof
of native collision. Every generation guide still needs source/identity review.
"""
from pathlib import Path
import argparse
import json
import numpy as np
from PIL import Image, ImageFilter
from pikachu_native_pose import PikachuNativePose, MOTIONS, BASE, ROOT, sha
import ssbh_data_py as ssbh

GEOMETRY = BASE / 'geometry-reference'
BODY = GEOMETRY / 'fighter/pikachu/model/body/c00'
SIZE = (1536, 1280)
ART_ROOT = (768, 880)
ART_PIXELS_PER_UNIT = 5 / (70 / 600)
VIEW_SIDE = 'negative'
ROOT_REGISTRATION = 'captured'


def rasterize(vertices, indices, uvs, texture, pixels, depth, facial_pixels, facial):
    width, height = pixels.shape[1], pixels.shape[0]
    screen = np.column_stack((ART_ROOT[0] + vertices[:, 2]*ART_PIXELS_PER_UNIT,
                              ART_ROOT[1] - vertices[:, 1]*ART_PIXELS_PER_UNIT))
    for triangle in indices.reshape((-1, 3)):
        p = screen[triangle]
        minimum = np.maximum(np.floor(p.min(axis=0)).astype(int), [0, 0])
        maximum = np.minimum(np.ceil(p.max(axis=0)).astype(int), [width-1, height-1])
        if np.any(minimum > maximum):
            continue
        a, b, c = p
        den = (b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
        if abs(den) < 1e-8:
            continue
        xx, yy = np.meshgrid(np.arange(minimum[0], maximum[0]+1)+.5,
                             np.arange(minimum[1], maximum[1]+1)+.5)
        w0 = ((b[1]-c[1])*(xx-c[0])+(c[0]-b[0])*(yy-c[1])) / den
        w1 = ((c[1]-a[1])*(xx-c[0])+(a[0]-c[0])*(yy-c[1])) / den
        w2 = 1-w0-w1
        weights = np.stack((w0, w1, w2), axis=-1)
        xdepth = (weights @ vertices[triangle, 0]) * (1 if VIEW_SIDE == 'negative' else -1)
        uv = weights @ uvs[triangle, :2]
        # Captured diffuse Sampler0 uses Repeat on both axes. Native UVs include
        # negative u on mirrored anatomy; clamping silently destroys markings.
        # DirectX-style v and decoded PNG rows both grow downward.
        tx = np.floor(np.mod(uv[:,:,0],1)*texture.shape[1]).astype(int)
        ty = np.floor(np.mod(uv[:,:,1],1)*texture.shape[0]).astype(int)
        colors = texture[ty,tx]
        section = np.s_[minimum[1]:maximum[1]+1, minimum[0]:maximum[0]+1]
        covered = (w0>=-1e-6)&(w1>=-1e-6)&(w2>=-1e-6)&(xdepth<depth[section])&(colors[:,:,3]>127)
        pixels[section][covered] = colors[covered]
        depth[section][covered] = xdepth[covered]
        facial_pixels[section][covered] = facial


def render(motion_name, frame, destination):
    pose = PikachuNativePose(MOTIONS / (motion_name + '.nuanmb'))
    # Deliberate approximation confined to the mesh preview. Guarded collision
    # exports in pikachu_native_pose.py retain their constraint rejection.
    omitted_constraints = sorted(pose.constrained)
    pose.constrained = set()
    names = [b.name for b in pose.skeleton.bones]
    world = pose.matrices(frame, names)
    bind = pose.matrices(0, names, bind_pose=True)
    inverse_bind = {name: np.linalg.inv(matrix) for name,matrix in bind.items()}
    mesh = ssbh.mesh_data.read_mesh(str(BODY / 'model.numshb'))
    visible = {'Body': True, 'Pikachu_LEye': True, 'Pikachu_REye': True, 'Pikachu_Mouth': True}
    for group in pose.animation.groups:
        if group.group_type.name == 'Visibility':
            for node in group.nodes:
                values = node.tracks[0].values
                visible[node.name] = values[0 if len(values)==1 else frame]
    materials = {m.material_label: next((t.data for t in m.textures if t.param_id.name=='Texture0'), None)
        for m in ssbh.matl_data.read_matl(str(BODY / 'model.numatb')).entries}
    material_map = {(m.mesh_object_name,m.mesh_object_subindex):m.material_label
        for m in ssbh.modl_data.read_modl(str(BODY / 'model.numdlb')).entries}
    texture_map = {'skin_pikachu_001_col': GEOMETRY/'skin-reference.png',
                   'pikachu_facial_01_col': GEOMETRY/'face-reference.png'}
    texture_map.update({f'pikachu_facial_{i:02}_col':GEOMETRY/f'face{i}-reference.png' for i in [2,3,4]})
    textures = {name:np.asarray(Image.open(path).convert('RGBA')) for name,path in texture_map.items()}
    pixels = np.zeros((SIZE[1], SIZE[0], 4), dtype=np.uint8)
    depth = np.full((SIZE[1], SIZE[0]), np.inf)
    facial_pixels = np.zeros((SIZE[1],SIZE[0]),dtype=bool)
    rendered = []
    for obj in mesh.objects:
        visibility_name = obj.name.split('_VIS')[0]
        if not visible.get(visibility_name, False):
            continue
        texture_name = materials[material_map[(obj.name,obj.subindex)]]
        if texture_name not in textures:
            raise ValueError(f'Visible reference texture not captured: {obj.name}/{texture_name}')
        points = np.asarray(obj.positions[0].data[:,:3], dtype=np.float64)
        homogeneous = np.column_stack((points, np.ones(len(points))))
        if obj.bone_influences:
            posed = np.zeros_like(homogeneous)
            total_weight = np.zeros(len(points))
            for influence in obj.bone_influences:
                name = influence.bone_name
                indices = np.array([v.vertex_index for v in influence.vertex_weights], dtype=int)
                weights = np.array([v.vertex_weight for v in influence.vertex_weights])
                posed[indices] += (homogeneous[indices] @ (world[name] @ inverse_bind[name]).T) * weights[:,None]
                total_weight[indices] += weights
            if np.max(np.abs(total_weight-1))>.0001:
                raise ValueError('Unnormalized native mesh weights')
        elif obj.parent_bone_name:
            posed = homogeneous @ world[obj.parent_bone_name].T
        else:
            raise ValueError('Visible mesh lacks a reviewed coordinate route')
        if ROOT_REGISTRATION == 'remove-trans-translation':
            posed[:,:3] -= world['Trans'][:3,3]
        rasterize(posed[:,:3], obj.vertex_indices, obj.texture_coordinates[0].data,
                  textures[texture_name], pixels, depth, facial_pixels, texture_name!='skin_pikachu_001_col')
        rendered.append({'mesh':obj.name,'subindex':obj.subindex,'texture':texture_name})
    native = Image.fromarray(pixels)
    native.save(str(destination)+'-reference.png')
    # Palette is authored from the accepted registered character reference.
    seed = pixels.copy()
    rgb = pixels[:,:,:3].astype(float)
    r,g,b = rgb[:,:,0],rgb[:,:,1],rgb[:,:,2]
    opaque = pixels[:,:,3]>0
    seed[opaque,:3] = [240,207,45]
    seed[opaque & (r<65)&(g<65)&(b<65),:3] = [22,17,16]
    seed[opaque & (r>g*1.25)&(b<g*.8),:3] = [148,62,18]
    seed[opaque & (r>g*1.25)&(b>=g*.8),:3] = [200,52,32]
    seed[opaque & (r>220)&(g>220)&(b>220),:3] = [251,250,241]
    seed[opaque & facial_pixels & (r<120)&(g<110)&(b<110),:3] = [22,17,16]
    silhouette = Image.fromarray(pixels[:,:,3])
    edge = silhouette.filter(ImageFilter.MaxFilter(5))
    outlined = Image.new('RGBA',SIZE,(22,17,16,0))
    outlined.putalpha(edge)
    outlined.alpha_composite(Image.fromarray(seed))
    # Author visible occlusion seams from discontinuous depth. Smooth shading
    # and hidden triangles never qualify joints/collision; these are guide ink.
    occlusion = np.zeros(opaque.shape,dtype=bool)
    for axis in [0,1]:
        shifted = np.roll(depth,1,axis=axis)
        both = np.isfinite(depth)&np.isfinite(shifted)
        difference = np.zeros_like(depth)
        np.subtract(depth,shifted,out=difference,where=both)
        occlusion |= both&(np.abs(difference)>.45)
    occlusion[0,:]=False;occlusion[:,0]=False
    ink = np.asarray(outlined).copy()
    ink[occlusion,:3]=[22,17,16]
    outlined = Image.fromarray(ink)
    background = Image.new('RGBA',SIZE,(204,73,140,255))
    background.alpha_composite(outlined)
    background.convert('RGB').save(str(destination)+'-palette-seed.png')
    silhouette.save(str(destination)+'-mask.png')
    # The anatomy guide combines palette boundaries and authored depth seams.
    rgb_seed=np.asarray(background.convert('RGB')).astype(float)
    guide_edges=occlusion.copy()
    for axis in [0,1]:
        diff=np.max(np.abs(rgb_seed-np.roll(rgb_seed,1,axis=axis)),axis=2)
        guide_edges |= (diff>35)&np.asarray(edge).astype(bool)
    guide=Image.fromarray((guide_edges*255).astype(np.uint8)).filter(ImageFilter.MaxFilter(3))
    guide.save(str(destination)+'-guide.png')
    metadata = {**pose.provenance(), 'state':'unreviewed local authoring reference; not generated fighter art',
        'omitted_helper_orient_constraints':omitted_constraints,
        'material_animation_and_shader_effects':'omitted; static decoded diffuse sampled',
        'diffuse_sampler':'Captured Sampler0 Repeat on u/v; decoded DirectX v downward',
        'occlusion_ink':'authored depth jump threshold0.45 native units; guide only',
        'native_sample_index':frame,'canvas':SIZE,'root':ART_ROOT,
        'root_registration':ROOT_REGISTRATION,'captured_trans_translation':world['Trans'][:3,3].tolist(),
        'art_pixels_per_native_unit':ART_PIXELS_PER_UNIT,'camera':f'authored orthographic view along native x; {VIEW_SIDE} x closer',
        'rendered_meshes':rendered,'renderer_sha256':sha(Path(__file__)),
        'reference_mesh_sha256':sha(BODY/'model.numshb'),
        'output_files':{Path(str(destination)+suffix).name:sha(Path(str(destination)+suffix))
            for suffix in ['-reference.png','-palette-seed.png','-mask.png','-guide.png']}}
    # The general guarded evaluator provenance describes rejection; this mesh
    # renderer expressly disables that guard for the marked approximate guide.
    metadata['helper_constraints']='Omitted only for this approximate local mesh guide; not a qualified bone-collision sample'
    Path(str(destination)+'.json').write_text(json.dumps(metadata,indent=2)+'\n')
    print(json.dumps({'motion':motion_name,'sample':frame,'meshes':len(rendered),'destination':str(destination)}))


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('motion');parser.add_argument('sample',type=int);parser.add_argument('destination',type=Path)
    parser.add_argument('--width',type=int,default=1536)
    parser.add_argument('--root-x',type=int,default=768)
    parser.add_argument('--height',type=int,default=1280)
    parser.add_argument('--root-y',type=int,default=880)
    parser.add_argument('--view-side',choices=['negative','positive'],default='negative')
    parser.add_argument('--root-registration',choices=['captured','remove-trans-translation'],default='captured')
    args=parser.parse_args()
    if not 512 <= args.width <= 4096 or not 512 <= args.height <= 4096 or not 0 < args.root_x < args.width or not 0 < args.root_y < args.height:raise SystemExit('Invalid authoring canvas/root')
    SIZE=(args.width,args.height);ART_ROOT=(args.root_x,args.root_y);VIEW_SIDE=args.view_side;ROOT_REGISTRATION=args.root_registration
    if not args.motion.replace('_','').isalnum():raise SystemExit('Invalid local motion name')
    render(args.motion,args.sample,args.destination)
