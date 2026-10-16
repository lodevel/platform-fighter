"""Author DK receiving from the captured body mesh, not native hit_data.

Nearest major bone partitions use each vertex's largest captured skin weight.
PCA enclosing capsules are an explicit 2D gameplay geometry calibration. They
do not recover native receiving size, virtual-node policies or game patch.
"""
import argparse, json
from pathlib import Path
import numpy as np
from dk_native_pose import DonkeyKongNativePose, MOTIONS, BASE, ROOT, SKEL, sha, ssbh

MAJOR = ['Hip','Bust','Head','ShoulderL','ArmL','HandL','ShoulderR','ArmR','HandR','LegL','KneeL','FootL','LegR','KneeR','FootR']
def declarations():
    pose = DonkeyKongNativePose(MOTIONS/'a00wait1.nuanmb')
    names = [b.name for b in pose.skeleton.bones]
    bind = pose.matrices(0, MAJOR, bind_pose=True)
    parents = {b.name: (names[b.parent_index] if b.parent_index is not None else None) for b in pose.skeleton.bones}
    mesh_path = BASE/'raw-model/fighter/donkey/model/body/c00/model.numshb'
    mesh = ssbh.mesh_data.read_mesh(str(mesh_path))
    body = max(mesh.objects, key=lambda obj: len(obj.positions[0].data))
    vertices = np.asarray(body.positions[0].data[:,:3], dtype=float)
    scores = np.zeros(len(vertices)); owners = [None]*len(vertices)
    for influence in body.bone_influences:
        name = influence.bone_name
        while name not in MAJOR and name is not None: name = parents[name]
        for weight in influence.vertex_weights:
            index, score = weight.vertex_index, weight.vertex_weight
            if score > scores[index]: scores[index] = score; owners[index] = name
    rows = []
    for bone in MAJOR:
        points = vertices[np.array([owner == bone for owner in owners])]
        if len(points) < 5: raise ValueError(f'Insufficient anatomical fit points: {bone}')
        points = (np.linalg.inv(bind[bone]) @ np.column_stack((points,np.ones(len(points)))).T).T[:,:3]
        centre = points.mean(axis=0)
        _,_,axes = np.linalg.svd(points-centre,full_matrices=False)
        axis = axes[0]; distances = (points-centre)@axis
        radial = np.linalg.norm(points-centre-distances[:,None]*axis,axis=1)
        # A enclosing cylinder-with-round-ends is not asserted as native shape.
        radius = float(np.quantile(radial,.98))
        low, high = float(distances.min()), float(distances.max())
        inset = min(radius,(high-low)/2)
        a,b = centre + axis*(low+inset), centre+axis*(high-inset)
        rows.append({'region':bone.lower(),'bone':bone,'endpoint1':a.tolist(),'endpoint2':b.tolist(),
          'radius':radius,'fitVertices':len(points),'radialQuantile':.98})
    return {'provenance':'authored anatomical capsule fit to captured native body skin; NOT native hit_data',
      'skeleton':{'path':str(SKEL.relative_to(ROOT)),'sha256':sha(SKEL)},
      'mesh':{'path':str(mesh_path.relative_to(ROOT)),'sha256':sha(mesh_path)},'regions':rows}

def posed(motion,sample,declared,root_y_adjustment=0):
    pose = DonkeyKongNativePose(MOTIONS/(motion+'.nuanmb'))
    matrices = pose.matrices(sample,['Trans']+MAJOR)
    trans = matrices['Trans'][:3,3]
    boxes=[]
    for row in declared['regions']:
        matrix=matrices[row['bone']]
        points=[]
        for endpoint in ['endpoint1','endpoint2']:
            p=(matrix@np.array([*row[endpoint],1]))[:3]-trans
            points.append({'x':float(p[2])*5,'y':42-float(p[1])*5+root_y_adjustment})
        radius=row['radius']*float(np.linalg.norm(matrix[:3,:3],axis=0).max())*5
        a,b=points
        boxes.append({'id':f'donkeykong.{motion}.{sample}.{row["region"]}','region':row['region'],
          'offsetX':(a['x']+b['x'])/2,'offsetY':(a['y']+b['y'])/2,
          'width':abs(a['x']-b['x'])+2*radius,'height':abs(a['y']-b['y'])+2*radius,
          'capsule':{'start':a,'end':b,'radius':radius}})
    return {'sourceMotion':pose.provenance(),'nativeSample':sample,'geometryProvenance':declared['provenance'],
      'bodyCentreFromRootY':-42,'rootYAdjustment':root_y_adjustment,'hurtboxes':boxes}

def native_region_points(motion, sample, exclude_cosmetic_tie=False):
    """Selected visible skins, including expression-specific facial geometry.

    This is the same explicitly approximate mesh route as the art source guide:
    helper aim constraints are omitted and listed, while native major-body bone
    matrix exports remain strict. It is not native receiving geometry.
    """
    pose = DonkeyKongNativePose(MOTIONS / (motion + '.nuanmb'))
    omitted_constraints = sorted(pose.constrained)
    pose.constrained = set()
    names = [bone.name for bone in pose.skeleton.bones]
    parents = {bone.name: names[bone.parent_index] if bone.parent_index is not None else None
        for bone in pose.skeleton.bones}
    def major(name):
        while name is not None and name not in MAJOR:
            name = parents[name]
        return name
    world = pose.matrices(sample, names)
    bind = pose.matrices(0, names, bind_pose=True)
    inverse_bind = {name: np.linalg.inv(matrix) for name, matrix in bind.items()}
    visible = {}
    for group in pose.animation.groups:
        if group.group_type.name == 'Visibility':
            for node in group.nodes:
                values = node.tracks[0].values
                visible[node.name] = values[0 if len(values) == 1 else sample]
    mesh_path = BASE / 'raw-model/fighter/donkey/model/body/c00/model.numshb'
    mesh = ssbh.mesh_data.read_mesh(str(mesh_path))
    points_by_region = {bone: [] for bone in MAJOR}
    mesh_rows = []
    excluded_bones = {}
    for obj in mesh.objects:
        visibility_name = obj.name.split('_VIS')[0].split('_O_OBJ')[0]
        if not visible.get(visibility_name, '_VIS' not in obj.name):
            continue
        points = np.asarray(obj.positions[0].data[:, :3], dtype=np.float64)
        homogeneous = np.column_stack((points, np.ones(len(points))))
        scores = np.zeros(len(points))
        owners = [None] * len(points)
        raw_owners = [None] * len(points)
        if obj.bone_influences:
            posed_points = np.zeros_like(homogeneous)
            total_weight = np.zeros(len(points))
            for influence in obj.bone_influences:
                indices = np.array([weight.vertex_index for weight in influence.vertex_weights], dtype=int)
                weights = np.array([weight.vertex_weight for weight in influence.vertex_weights])
                bone = influence.bone_name
                posed_points[indices] += (homogeneous[indices] @ (world[bone] @ inverse_bind[bone]).T) * weights[:, None]
                total_weight[indices] += weights
                owner = major(bone)
                for index, weight in zip(indices, weights):
                    if weight > scores[index]:
                        scores[index] = weight
                        owners[index] = owner
                        raw_owners[index] = bone
            if np.max(np.abs(total_weight - 1)) > .0001:
                raise ValueError('Unnormalized captured visible mesh weights')
        elif obj.parent_bone_name:
            posed_points = homogeneous @ world[obj.parent_bone_name].T
            owners = [major(obj.parent_bone_name)] * len(points)
            raw_owners = [obj.parent_bone_name] * len(points)
        else:
            raise ValueError(f'Visible mesh lacks a coordinate route: {obj.name}')
        posed_points[:, :3] -= world['Trans'][:3, 3]
        excluded = np.array([exclude_cosmetic_tie and name is not None and 'necktie' in name.lower() for name in raw_owners])
        for name, omitted in zip(raw_owners, excluded):
            if omitted: excluded_bones[name] = excluded_bones.get(name, 0) + 1
        for bone in MAJOR:
            selected = posed_points[np.array([owner == bone for owner in owners]) & ~excluded, :3]
            points_by_region[bone].extend(selected.tolist())
        mesh_rows.append({'mesh': obj.name, 'subindex': obj.subindex,
            'vertices': len(points), 'headVertices': owners.count('Head'), 'cosmeticTieVerticesExcluded': int(excluded.sum())})
    return {'provenance': pose.provenance(), 'omittedMeshHelperConstraints': omitted_constraints,
        'mesh': {'path': str(mesh_path.relative_to(ROOT)), 'sha256': sha(mesh_path)},
        'visibleMeshes': mesh_rows, 'nativeSample': sample, 'pointsByRegion': points_by_region,
        'cosmeticReceivingExclusions': {'policy': 'dominant captured skin bone contains Necktie; anatomical Neck is retained' if exclude_cosmetic_tie else 'none', 'verticesByBone': excluded_bones}}


def fit_visible_pose(motion, sample, floor_input_last_pixel_y=None, margin_world=1, exclude_cosmetic_tie=False):
    """Authored receiving refit after the exact selected local art floor warp.

    Includes selected facial meshes. PCA picks the axis; radius encloses every
    selected region point plus the declared authored margin, rather than hiding
    a muzzle in a quantile. This conservative primitive is a review candidate.
    """
    source = native_region_points(motion, sample, exclude_cosmetic_tie)
    root_y, band_start, target_last, pixels_per_native, world_per_native = 832, 760, 830, 26, 5
    warp = None
    if floor_input_last_pixel_y is not None:
        if floor_input_last_pixel_y <= band_start:
            raise ValueError('Floor warp must have a positive declared support band')
        warp = {'inputBandStartPixelY': band_start, 'inputLastPixelY': floor_input_last_pixel_y,
            'targetLastPixelY': target_last, 'rootPixelY': root_y,
            'pixelsPerNativeUnit': pixels_per_native,
            'ratio': (target_last - band_start + 1) / (floor_input_last_pixel_y - band_start + 1),
            'inclusivePixelRows': True, 'continuousSupportMap': "y'=760+(y-760)*ratio; pixel raster edge/centre acceptance is separate"}
    boxes, clouds = [], {}
    for bone, native_points in source['pointsByRegion'].items():
        if len(native_points) < 5:
            raise ValueError(f'Insufficient selected visible anatomy: {bone}')
        points = np.asarray(native_points)
        pixel_y = root_y - points[:, 1] * pixels_per_native
        if warp is not None:
            support_band = pixel_y > band_start
            pixel_y[support_band] = band_start + (pixel_y[support_band] - band_start) * warp['ratio']
        projected = np.column_stack((points[:, 2] * world_per_native,
            42 + (pixel_y - root_y) * world_per_native / pixels_per_native))
        centre = projected.mean(axis=0)
        _, _, axes = np.linalg.svd(projected - centre, full_matrices=False)
        axis = axes[0]
        along = (projected - centre) @ axis
        radial = np.linalg.norm(projected - centre - along[:, None] * axis, axis=1)
        inset = min(float(radial.max()), float(np.ptp(along)) / 2)
        a, b = centre + axis * (along.min() + inset), centre + axis * (along.max() - inset)
        segment = b - a
        segment_length_squared = float(segment @ segment)
        fraction = np.zeros(len(projected)) if segment_length_squared == 0 else np.clip(((projected - a) @ segment) / segment_length_squared, 0, 1)
        closest = a + fraction[:, None] * segment
        radius = float(np.linalg.norm(projected - closest, axis=1).max()) + margin_world
        region = bone.lower()
        capsule = {'start': {'x': float(a[0]), 'y': float(a[1])},
            'end': {'x': float(b[0]), 'y': float(b[1])}, 'radius': radius}
        boxes.append({'id': f'donkeykong.{motion}.{sample}.{region}', 'region': region,
            'offsetX': float((a[0] + b[0]) / 2), 'offsetY': float((a[1] + b[1]) / 2),
            'width': float(abs(a[0] - b[0]) + 2 * radius),
            'height': float(abs(a[1] - b[1]) + 2 * radius), 'capsule': capsule})
        clouds[region] = projected.tolist()
    return {'sourceMotion': source['provenance'], 'sourceMesh': source['mesh'],
        'nativeSample': sample, 'bodyCentreFromRootY': -42,
        'geometryProvenance': 'authored projected visible-anatomy PCA capsules; NOT native hit_data',
        'fitPolicy': 'conservative all-selected-vertices enclosure plus declared authored margin; not contour/native capsule parity',
        'authoredMarginWorld': margin_world, 'floorWarp': warp,
        'omittedMeshHelperConstraints': source['omittedMeshHelperConstraints'],
        'visibleMeshes': source['visibleMeshes'], 'projectedPointsByRegion': clouds,
        'cosmeticReceivingExclusions': source['cosmeticReceivingExclusions'],
        'hurtboxes': boxes, 'reviewedForShipping': False}

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--motion');parser.add_argument('--fit-visible',action='store_true');parser.add_argument('--exclude-cosmetic-tie',action='store_true');parser.add_argument('--floor-input-last-pixel-y',type=float);parser.add_argument('--sample',type=int,default=0);parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args();data=fit_visible_pose(args.motion,args.sample,args.floor_input_last_pixel_y,exclude_cosmetic_tie=args.exclude_cosmetic_tie) if args.fit_visible else declarations();data=posed(args.motion,args.sample,data) if args.motion and not args.fit_visible else data
    args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps(data,indent=2)+'\n');print(args.output)
