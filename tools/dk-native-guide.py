"""Render local native reference geometry for pose-guide review only.

This is an authored orthographic CPU preview, not the game's renderer. Helper
orient constraints, material animation/shader effects and lighting are omitted.
Do not ship these reference renders as fighter art or use their pixels as proof
of native collision. Every generation guide still needs source/identity review.
"""
from pathlib import Path
import argparse
import json
import math
import numpy as np
from PIL import Image, ImageFilter
from dk_native_pose import DonkeyKongNativePose as PikachuNativePose, ROOT, sha, BASE, MOTIONS
import ssbh_data_py as ssbh

GEOMETRY = BASE
BODY = BASE / 'raw-model/fighter/donkey/model/body/c00'
SIZE = (1024, 1024)
ART_ROOT = (448, 832)
ART_PIXELS_PER_UNIT = 26.0
VIEW_SIDE = 'negative'
ROOT_REGISTRATION = 'captured'


def rasterize(vertices, indices, uvs, texture, pixels, depth, facial_pixels, facial, eye_decal=None, uv_transform=None):
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
        if eye_decal is not None:
            sx,sy,du,dv=uv_transform
            # Primary ssbh_wgpu model.wgsl UV transform, captured native material track sample.
            pupil_uv=np.stack((sx*(uv[:,:,0]-du),1-sy*(1-uv[:,:,1]-dv)),axis=2)
            px=np.floor(np.mod(pupil_uv[:,:,0],1)*eye_decal.shape[1]).astype(int)
            py=np.floor(np.mod(pupil_uv[:,:,1],1)*eye_decal.shape[0]).astype(int)
            decal=eye_decal[py,px];alpha=decal[:,:,3:4].astype(float)/255
            composed=colors.copy();composed[:,:,:3]=np.rint(colors[:,:,:3]*(1-alpha)+decal[:,:,:3]*alpha).astype(np.uint8)
            colors=composed
        section = np.s_[minimum[1]:maximum[1]+1, minimum[0]:maximum[0]+1]
        covered = (w0>=-1e-6)&(w1>=-1e-6)&(w2>=-1e-6)&(xdepth<depth[section])&(colors[:,:,3]>127)
        pixels[section][covered] = colors[covered]
        depth[section][covered] = xdepth[covered]
        facial_pixels[section][covered] = facial


def sample_captured_track(values, frame, *, linear=False):
    if not values:
        raise ValueError('Empty captured material/visibility track')
    bounded=max(0,min(float(frame),len(values)-1))
    low=int(math.floor(bounded))
    if not linear or low==len(values)-1:
        return values[low]
    fraction=bounded-low
    return (np.asarray(values[low],dtype=float)*(1-fraction)+np.asarray(values[low+1],dtype=float)*fraction).tolist()


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
    visible = {}
    for group in pose.animation.groups:
        if group.group_type.name == 'Visibility':
            for node in group.nodes:
                values = node.tracks[0].values
                visible[node.name] = sample_captured_track(values,frame)
    materials = {m.material_label: next((t.data for t in m.textures if t.param_id.name=='Texture0'), None)
        for m in ssbh.matl_data.read_matl(str(BODY / 'model.numatb')).entries}
    material_map = {(m.mesh_object_name,m.mesh_object_subindex):m.material_label
        for m in ssbh.modl_data.read_modl(str(BODY / 'model.numdlb')).entries}
    texture_map = {'skin_donkey_001_col':BASE/'skin-reference.png', 'eye_doneky_002_col':BASE/'eye-reference.png', 'tooth_donkey_002_col':BASE/'tooth-reference.png'}
    textures = {name:np.asarray(Image.open(path).convert('RGBA')) for name,path in texture_map.items()}
    # Texture1 is a translucent pupil decal; alpha-zero must reveal opaque Texture0 sclera, never underlying red face.
    eye_base=Image.open(BASE/'eye-reference.png').convert('RGBA')
    eye_decal=Image.open(BASE/'eye-iris-reference.png').convert('RGBA')
    pupil=np.asarray(eye_decal)
    eye_uvs={}
    for group in pose.animation.groups:
        if group.group_type.name=='Material':
            for node in group.nodes:
                for track in node.tracks:
                    if track.name=='CustomVector31':
                        eye_uvs[node.name]=sample_captured_track(track.values,frame,linear=True)
    pixels = np.zeros((SIZE[1], SIZE[0], 4), dtype=np.uint8)
    depth = np.full((SIZE[1], SIZE[0]), np.inf)
    facial_pixels = np.zeros((SIZE[1],SIZE[0]),dtype=bool)
    rendered = []
    for obj in mesh.objects:
        visibility_name = obj.name.split('_VIS')[0]
        visibility_name = visibility_name.split('_O_OBJ')[0]
        if not visible.get(visibility_name, '_VIS' not in obj.name):
            continue
        material_name=material_map[(obj.name,obj.subindex)]
        texture_name = materials[material_name]
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
                  textures[texture_name], pixels, depth, facial_pixels, texture_name!='skin_donkey_001_col',
                  pupil if material_name in ['EyeL','EyeR'] else None,eye_uvs.get(material_name,[1,1,0,0]))
        rendered.append({'mesh':obj.name,'subindex':obj.subindex,'texture':texture_name,'native_bounds':[posed[:,:3].min(axis=0).tolist(),posed[:,:3].max(axis=0).tolist()]})
    native = Image.fromarray(pixels)
    native.save(str(destination)+'-reference.png')
    # Palette is authored from the accepted registered character reference.
    seed = pixels.copy()
    rgb = pixels[:,:,:3].astype(float)
    r,g,b = rgb[:,:,0],rgb[:,:,1],rgb[:,:,2]
    opaque = pixels[:,:,3]>0
    # Explicit DK target palette matches inspected existing red-cartoon identity.
    dark=(r<65)&(g<65)&(b<65)
    cream=(r>120)&(g>r*.72)&(b>r*.45)
    red=(r>g*1.9)&(r>b*1.5)
    seed[opaque,:3]=[178,24,4]
    seed[opaque & cream,:3]=[255,209,139]
    seed[opaque & red,:3]=[214,36,5]
    seed[opaque & dark,:3]=[28,13,9]
    seed[opaque & facial_pixels & (g>100),:3]=[250,249,235]
    seed[opaque & facial_pixels & (g<=100),:3]=[22,17,16]
    seed[opaque & (r>220)&(g>220)&(b>220),:3]=[252,246,223]
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
        'material_animation_and_shader_effects':'omitted; eye Texture1 pupil alpha-composited over opaque Texture0 sclera, with captured per-frame EyeL/EyeR CustomVector31 transforms at shared UV; primary ssbh_wgpu model.wgsl Texture1 Blend and UV formulas; lighting/shader interaction omitted, not exact native ocular parity',
        'diffuse_sampler':'Captured Sampler0 Repeat on u/v; decoded DirectX v downward',
        'captured_eye_material_uvs':eye_uvs,
        'fractional_track_policy':'body uses native evaluator at exact fractional clock; mesh visibility floor-sampled, UV CustomVector31 authored linear interpolation; shader interpolation parity unverified',
        'occlusion_ink':'authored depth jump threshold0.45 native units; guide only',
        'native_sample_index':frame,'canvas':SIZE,'root':ART_ROOT,
        'root_registration':ROOT_REGISTRATION,'captured_trans_translation':world['Trans'][:3,3].tolist(),
        'art_pixels_per_native_unit':ART_PIXELS_PER_UNIT,'camera':f'authored orthographic view along native x; {VIEW_SIDE} x closer',
        'rendered_meshes':rendered,'bone_matrices':{name:matrix.tolist() for name,matrix in world.items()},'world_units_per_native_unit':5,'game_body_center_y_from_native_ground':42,'renderer_sha256':sha(Path(__file__)),
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
    parser.add_argument('motion');parser.add_argument('sample',type=float);parser.add_argument('destination',type=Path)
    parser.add_argument('--width',type=int,default=1024)
    parser.add_argument('--root-x',type=int,default=448)
    parser.add_argument('--height',type=int,default=1024)
    parser.add_argument('--root-y',type=int,default=832)
    parser.add_argument('--view-side',choices=['negative','positive'],default='negative')
    parser.add_argument('--root-registration',choices=['captured','remove-trans-translation'],default='captured')
    args=parser.parse_args()
    if not 512 <= args.width <= 4096 or not 512 <= args.height <= 4096 or not 0 < args.root_x < args.width or not 0 < args.root_y < args.height:raise SystemExit('Invalid authoring canvas/root')
    SIZE=(args.width,args.height);ART_ROOT=(args.root_x,args.root_y);VIEW_SIDE=args.view_side;ROOT_REGISTRATION=args.root_registration
    if not args.motion.replace('_','').isalnum():raise SystemExit('Invalid local motion name')
    if not math.isfinite(args.sample) or args.sample<0:raise SystemExit('Invalid native sample')
    render(args.motion,int(args.sample) if args.sample.is_integer() else args.sample,args.destination)
