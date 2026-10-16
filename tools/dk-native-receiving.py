#!/usr/bin/env python3
"""Pose Donkey Kong receiving geometry (`hurtboxPoses`) from the NATIVE model.

DK's native hurtbox declarations (the `hit_data` list of fighter/donkey/param/vl.prc:
bone, offset1/offset2, size) are NOT available in this repository (see
docs/review/2026-09-25/donkeykong-character/README.md: "Native capsule data for DK has
not been obtained"). Until they are, this tool produces AUTHORED receiving geometry
that is nevertheless computed from the native data that IS present, at the same native
frame, with the same skeleton and the same mesh posing the art guides use
(tools/dk-material-guide.py `collect_posed_meshes`: captured tracks, helper constraints
omitted, alpha fur shells off, Trans removed on fixed-root clips). The art is generated
from that identical pose, so the capsules follow the new drawings automatically.

Method (per art frame, per major bone region Hip/Bust/Head/Shoulder/Arm/Hand/Leg/Knee/Foot):
  1. pose the visible skinned mesh at the native frame; assign each vertex to the major
     bone that owns its dominant captured skin weight (cosmetic necktie skin excluded);
  2. project to the side view (native z -> forward x, native y -> up) in world units at
     5 world units per native unit; put the origin where the art's root sits;
  3. fit 1..N capsules per region (partition along the principal axis; smallest piece
     count within 0.025 of the best coverage), radius = vertex-distance quantile + margin.
Output is exactly the `hurtboxPoses` schema consumed by getDonkeyKongBodyDrawing:
  {artFrameIndex, nativeSample, hurtboxes:[{id, region, offsetX, offsetY, width, height,
   capsule:{start:{x,y}, end:{x,y}, radius}}]}
offsets are world units relative to the body centre (= root + bodyHeight/2 up), facing
right; y grows downward. NOT native hit_data: parity with the game is not claimed.

Only hurtboxPoses are produced. attackCollisionPoses, catchCollisionPoses,
captureGripPoses and itemAttachmentPoses come from native hit/grab data and are separate.

Usage (run with ~/ComfyUI/.venv/bin/python -I):
  dk-native-receiving.py generate --cells families/.../<clip>/cells.json --out DIR [--overlay]
  dk-native-receiving.py generate --spec pack-spec.json --clip jab [--motion c00attack11] --out DIR
  dk-native-receiving.py generate --motion c00attack11 --samples 1,3,5 --out DIR   (no art)
  dk-native-receiving.py compare NEW_hurtboxPoses.json --frames-json assets/characters/donkeykong/frames.json --clip jab
"""
import argparse
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

TOOLS = Path(__file__).resolve().parent
sys.path.insert(0, str(TOOLS))
sys.path.insert(0, '/tmp/pikachu-source-libs')
import numpy as np  # noqa: E402
import ssbh_data_py as ssbh  # noqa: E402
from PIL import Image, ImageDraw  # noqa: E402
from scipy import ndimage  # noqa: E402
from dk_native_pose import DonkeyKongNativePose, MOTIONS, BASE, ROOT, sha  # noqa: E402


def sibling(filename):
    spec = importlib.util.spec_from_file_location(filename.replace('-', '_').split('.')[0], TOOLS / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


guide = sibling('dk-material-guide.py')        # collect_posed_meshes, load_contract
pack = sibling('fighter-pack.py')              # resolve, alpha_bbox, ALPHA_SOLID, DEFAULT_BODY_HEIGHT
anatomy = sibling('dk-anatomical-capsules.py')  # MAJOR bone list
MAJOR = anatomy.MAJOR
WORLD_PER_NATIVE = pack.WORLD_PER_NATIVE
TRANS_TRAVEL_FIXED_ROOT = 0.05   # same threshold as dk-family-batch.py `remove_trans`
PIECE_LIMIT = {'head': 4, 'bust': 3, 'hip': 3, 'handl': 3, 'handr': 3, 'footl': 3, 'footr': 3}
DEFAULT_PIECE_LIMIT = 2
COVERAGE_TOLERANCE = 0.025
DEFAULT_QUANTILE = 0.92
DEFAULT_MARGIN = 1.0             # world units added to every radius (old target-contour convention)
MIN_RADIUS = 2.0
MESH_PATH = BASE / 'raw-model/fighter/donkey/model/body/c00/model.numshb'
REGION_COLOURS = {  # overlay only
    'hip': (230, 120, 0), 'bust': (200, 0, 0), 'head': (200, 0, 200), 'shoulderl': (0, 160, 0), 'arml': (0, 110, 255),
    'handl': (0, 200, 200), 'shoulderr': (130, 160, 0), 'armr': (0, 60, 200), 'handr': (0, 130, 130),
    'legl': (120, 70, 0), 'kneel': (240, 190, 0), 'footl': (255, 60, 150), 'legr': (90, 40, 0),
    'kneer': (190, 150, 0), 'footr': (200, 30, 100)}


# ----------------------------------------------------------------- native posing

def vertex_owners(obj, parents):
    """(major-bone owner, raw dominant bone) per vertex from the dominant captured skin weight."""
    def major(name):
        while name is not None and name not in MAJOR:
            name = parents[name]
        return name
    count = len(obj.positions[0].data)
    best, owner, raw = np.zeros(count), [None] * count, [None] * count
    if obj.bone_influences:
        for influence in obj.bone_influences:
            for weight in influence.vertex_weights:
                if weight.vertex_weight > best[weight.vertex_index]:
                    best[weight.vertex_index] = weight.vertex_weight
                    owner[weight.vertex_index] = major(influence.bone_name)
                    raw[weight.vertex_index] = influence.bone_name
    elif obj.parent_bone_name:
        owner, raw = [major(obj.parent_bone_name)] * count, [obj.parent_bone_name] * count
    return owner, raw


def trans_travel(motion):
    """Largest captured Trans excursion (native units); decides fixed-root registration."""
    pose = DonkeyKongNativePose(MOTIONS / (motion + '.nuanmb'))
    pose.constrained = set()
    last = int(pose.animation.final_frame_index)
    trans = np.array([pose.matrices(i, ['Trans'])['Trans'][:3, 3] for i in range(last + 1)])
    return last, float(np.abs(trans - trans[0]).max())


def posed_region_points(motion, frame, remove_trans, include_tie, mesh, parents):
    """{region: (N,3) native-space vertices} posed exactly as the art guide poses them."""
    meshes, omitted, _ = guide.collect_posed_meshes(motion, frame, False, 0, remove_trans)
    objects = {(o.name, o.subindex): o for o in mesh.objects}
    regions = {bone.lower(): [] for bone in MAJOR}
    tie_excluded = 0
    for posed in meshes:
        owner, raw = vertex_owners(objects[(posed['name'], posed['subindex'])], parents)
        vertices = posed['vertices']
        if len(owner) != len(vertices):
            raise ValueError(f'Owner/vertex mismatch: {posed["name"]}')
        for bone, tie_name, point in zip(owner, raw, vertices):
            if bone is None:
                continue
            if not include_tie and tie_name is not None and 'necktie' in tie_name.lower():
                tie_excluded += 1
                continue
            regions[bone.lower()].append(point)
    return {k: np.asarray(v, dtype=float) for k, v in regions.items() if v}, omitted, tie_excluded


# ------------------------------------------------------------------ capsule fitting

def distance_to_segment(points, a, z):
    v = z - a
    length2 = float(v @ v)
    t = np.zeros(len(points)) if length2 == 0 else np.clip(((points - a) @ v) / length2, 0, 1)
    return np.linalg.norm(points - (a + t[:, None] * v), axis=1)


def fit_piece(points, axis, quantile, margin):
    centre = points.mean(axis=0)
    along = (points - centre) @ axis
    across = np.abs((points - centre) @ np.array([-axis[1], axis[0]]))
    r0 = float(np.quantile(across, quantile))
    low, high = np.percentile(along, [2, 98])
    mid = (low + high) / 2
    a = centre + axis * min(low + r0, mid)
    z = centre + axis * max(high - r0, mid)
    radius = max(float(np.quantile(distance_to_segment(points, a, z), quantile)) + margin, MIN_RADIUS)
    return a, z, radius


def principal_axis(points):
    centre = points.mean(axis=0)
    _, vectors = np.linalg.eigh(np.cov((points - centre).T))
    axis = vectors[:, -1]
    return axis if axis[0] >= 0 else -axis   # deterministic sign


def fit_region(region, points, quantile, margin):
    """Smallest piece count whose point coverage is within tolerance of the best count."""
    axis = principal_axis(points)
    centre = points.mean(axis=0)
    t = (points - centre) @ axis
    options = []
    for count in range(1, PIECE_LIMIT.get(region, DEFAULT_PIECE_LIMIT) + 1):
        edges = np.linspace(t.min() - 1e-6, t.max() + 1e-6, count + 1)
        pieces = []
        for i in range(count):
            group = points[(t >= edges[i]) & (t < edges[i + 1])]
            if len(group) < 3:
                continue
            local = principal_axis(group) if len(group) >= 6 else axis
            pieces.append(fit_piece(group, local, quantile, margin))
        if not pieces:
            continue
        covered = np.zeros(len(points), dtype=bool)
        for a, z, r in pieces:
            covered |= distance_to_segment(points, a, z) <= r
        options.append((float(covered.mean()), pieces))
    best = max(c for c, _ in options)
    coverage, pieces = next(o for o in options if o[0] >= best - COVERAGE_TOLERANCE)
    return coverage, pieces


def hurtbox_rows(region_pieces, quantile, margin):
    """{region: (coverage, [(a,z,r)])} -> schema rows (world coords, 5 dp)."""
    rows, stats = [], {}
    for region, points in region_pieces.items():
        coverage, pieces = fit_region(region, points, quantile, margin)
        stats[region] = {'vertices': len(points), 'pieces': len(pieces), 'vertexCoverage': round(coverage, 4)}
        for i, (a, z, r) in enumerate(pieces):
            ax, ay, zx, zy, rr = (round(float(v), 5) for v in (a[0], a[1], z[0], z[1], r))
            rows.append({'id': f'donkeykong.native.{region}.{i}', 'region': region,
                         'offsetX': round((ax + zx) / 2, 5), 'offsetY': round((ay + zy) / 2, 5),
                         'width': round(abs(ax - zx) + 2 * rr, 5), 'height': round(abs(ay - zy) + 2 * rr, 5),
                         'capsule': {'start': {'x': ax, 'y': ay}, 'end': {'x': zx, 'y': zy}, 'radius': rr}})
    return rows, stats


def validate_rows(rows):
    ids = set()
    for h in rows:
        c = h['capsule']
        values = [c['start']['x'], c['start']['y'], c['end']['x'], c['end']['y'], c['radius'],
                  h['offsetX'], h['offsetY'], h['width'], h['height']]
        if h['id'] in ids or not all(np.isfinite(values)) or c['radius'] <= 0:
            raise ValueError(f'Invalid receiving capsule: {h["id"]}')
        ids.add(h['id'])


# ------------------------------------------------------------------------- frames

def load_frames(args):
    """Normalised frame list: motion, nativeSample, nativeFrame, removeTrans, png, root, snap."""
    if args.cells:
        cells_path = Path(args.cells).resolve()
        data = json.loads(cells_path.read_text())
        plan_path = cells_path.parent.parent / 'cells-plan.json'
        plan = {c['key']: c for c in json.loads(plan_path.read_text())['cells']} if plan_path.exists() else {}
        frames = []
        for cell in data['cells']:
            planned = plan.get(cell['png'].replace('-cutout.png', ''), {})
            frames.append({'motion': planned.get('motion', args.motion), 'nativeSample': cell['nativeSample'],
                           'nativeFrame': cell.get('nativeFrame', cell['nativeSample']),
                           'removeTrans': planned.get('remove_trans'), 'png': cells_path.parent / cell['png'],
                           'root': cell['root'], 'snap': args.snap == 'grounded' and bool(cell.get('grounded'))})
        return data['clip'], frames
    if args.spec:
        clip = json.loads(Path(args.spec).read_text())['clips'][args.clip]
        return args.clip, [{'motion': clip.get('motion', args.motion), 'nativeSample': f['nativeSample'],
                            'nativeFrame': f.get('nativeFrame', f['nativeSample']), 'removeTrans': None,
                            'png': pack.resolve(f['png']), 'root': f['root'], 'snap': bool(f.get('snapRootToFloor'))}
                           for f in clip['frames']]
    samples = [int(s) for s in args.samples.split(',')]
    return args.motion, [{'motion': args.motion, 'nativeSample': s, 'nativeFrame': s, 'removeTrans': None,
                          'png': None, 'root': None, 'snap': False} for s in samples]


def resolve_frame(frame, travel_cache):
    motion = frame['motion']
    if not motion or not motion.replace('_', '').isalnum():
        raise SystemExit('Each frame needs a valid native motion name (--motion, clip "motion" or cells-plan)')
    if motion not in travel_cache:
        travel_cache[motion] = trans_travel(motion)
    last, travel = travel_cache[motion]
    remove = frame['removeTrans'] if frame['removeTrans'] is not None else travel > TRANS_TRAVEL_FIXED_ROOT
    return min(frame['nativeFrame'], last), bool(remove), travel


# ------------------------------------------------------------------- raster/overlay

def capsule_mask(shape, a, z, r):
    """Boolean mask of a capsule given in image pixels."""
    h, w = shape
    x0, x1 = int(max(0, np.floor(min(a[0], z[0]) - r - 1))), int(min(w, np.ceil(max(a[0], z[0]) + r + 2)))
    y0, y1 = int(max(0, np.floor(min(a[1], z[1]) - r - 1))), int(min(h, np.ceil(max(a[1], z[1]) + r + 2)))
    mask = np.zeros(shape, bool)
    if x1 <= x0 or y1 <= y0:
        return mask
    yy, xx = np.mgrid[y0:y1, x0:x1]
    points = np.column_stack((xx.ravel() + .5, yy.ravel() + .5))
    mask[y0:y1, x0:x1] = (distance_to_segment(points, np.asarray(a, float), np.asarray(z, float)) <= r).reshape(y1 - y0, x1 - x0)
    return mask


def rows_in_art_px(rows, root, w, body_half):
    """World rows -> (region, a, z, r) in the cutout's pixel space."""
    def to_px(p):
        return np.array([root[0] + p['x'] / w, root[1] + (p['y'] - body_half) / w])
    return [(h['region'], to_px(h['capsule']['start']), to_px(h['capsule']['end']), h['capsule']['radius'] / w) for h in rows]


def silhouette_stats(alpha, capsules):
    union = np.zeros(alpha.shape, bool)
    for _, a, z, r in capsules:
        union |= capsule_mask(alpha.shape, a, z, r)
    solid = alpha >= 32
    inside = int((union & solid).sum())
    return {'alphaPixels': int(solid.sum()), 'capsuleUnionPixels': int(union.sum()),
            'unionInsideArtFraction': round(inside / max(1, int(union.sum())), 4),
            'artCoveredByUnionFraction': round(inside / max(1, int(solid.sum())), 4)}


def draw_overlay(png, capsules, root, body_half_px, path):
    art = Image.open(png).convert('RGBA')
    background = Image.new('RGBA', art.size, (214, 214, 214, 255))
    background.alpha_composite(art)
    canvas = np.array(background)
    by_region = {}
    for region, a, z, r in capsules:
        by_region[region] = by_region.get(region, np.zeros(art.size[::-1], bool)) | capsule_mask(art.size[::-1], a, z, r)
    for region, mask in by_region.items():
        colour = np.array(REGION_COLOURS.get(region, (255, 0, 0)), float)
        canvas[mask, :3] = (canvas[mask, :3] * 0.72 + colour * 0.28).astype(np.uint8)
        edge = mask & ~ndimage.binary_erosion(mask, iterations=2)
        canvas[edge, :3] = colour.astype(np.uint8)
    out = Image.fromarray(canvas)
    draw = ImageDraw.Draw(out)
    rx, ry = root
    draw.line([(rx - 14, ry), (rx + 14, ry)], fill=(0, 0, 0, 255), width=2)
    draw.line([(rx, ry - 14), (rx, ry + 14)], fill=(0, 0, 0, 255), width=2)
    draw.ellipse([rx - 6, ry - body_half_px - 6, rx + 6, ry - body_half_px + 6], outline=(0, 0, 0, 255), width=2)
    out.save(path)


# ------------------------------------------------------------------------ generate

def generate(args):
    clip, frames = load_frames(args)
    contract_ppu = guide.load_contract()[0]
    ppu = args.ppu or contract_ppu
    w = WORLD_PER_NATIVE / ppu
    body_half = args.body_height / 2
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    mesh = ssbh.mesh_data.read_mesh(str(MESH_PATH))
    skeleton = DonkeyKongNativePose(MOTIONS / (frames[0]['motion'] + '.nuanmb')).skeleton
    names = [b.name for b in skeleton.bones]
    parents = {b.name: (names[b.parent_index] if b.parent_index is not None else None) for b in skeleton.bones}
    travel_cache, poses, report_frames = {}, [], []
    for index, frame in enumerate(frames):
        pose_frame, remove, travel = resolve_frame(frame, travel_cache)
        points, omitted, tie_excluded = posed_region_points(frame['motion'], pose_frame, remove, args.include_tie, mesh, parents)
        origin = frame['root']                          # native origin inside the cutout (art px)
        root = origin
        if frame['png'] is not None and frame['snap']:  # packer rule: grounded frame root := lowest solid row edge
            alpha = np.array(Image.open(frame['png']).convert('RGBA'))[..., 3]
            root = [origin[0], pack.alpha_bbox(alpha, pack.ALPHA_SOLID)[3]]
        shift = (0.0, 0.0) if origin is None else ((origin[0] - root[0]) * w, (origin[1] - root[1]) * w)
        region_world = {r: np.column_stack((p[:, 2] * WORLD_PER_NATIVE + shift[0], body_half + shift[1] - p[:, 1] * WORLD_PER_NATIVE))
                        for r, p in points.items()}
        rows, stats = hurtbox_rows(region_world, args.quantile, args.margin)
        validate_rows(rows)
        poses.append({'artFrameIndex': index, 'nativeSample': frame['nativeSample'], 'hurtboxes': rows})
        entry = {'artFrameIndex': index, 'motion': frame['motion'], 'nativeSample': frame['nativeSample'], 'poseFrame': pose_frame,
                 'removeTrans': remove, 'transTravelNative': round(travel, 4), 'omittedHelperConstraints': omitted,
                 'cosmeticTieVerticesExcluded': tie_excluded, 'regions': stats, 'capsules': len(rows),
                 'lowestPointBelowBodyCentreWorld': round(max(float(p[:, 1].max()) for p in region_world.values()), 3)}
        if frame['png'] is not None:
            entry.update(png=str(frame['png']), pngSha256=sha(Path(frame['png'])), originInPng=origin, packedRootInPng=list(map(float, root)),
                         rootShiftWorld=[round(shift[0], 4), round(shift[1], 4)], snappedToFloor=bool(frame['snap']))
            capsules = rows_in_art_px(rows, root, w, body_half)
            alpha = np.array(Image.open(frame['png']).convert('RGBA'))[..., 3]
            entry['silhouette'] = silhouette_stats(alpha, capsules)
            if args.overlay:
                (out / 'overlays').mkdir(exist_ok=True)
                target = out / 'overlays' / f'{clip}-{index:02d}-native{frame["nativeSample"]}-receiving.png'
                draw_overlay(frame['png'], capsules, root, body_half / w, target)
                entry['overlay'] = str(target)
        report_frames.append(entry)
    (out / 'hurtboxPoses.json').write_text(json.dumps(poses, indent=2) + '\n')
    report = {'tool': 'tools/dk-native-receiving.py', 'toolSha256': sha(Path(__file__)), 'clip': clip,
              'geometryProvenance': 'authored capsules fitted to the natively posed visible DK mesh (same pose/skeleton/skinning as the art guide); '
                                    'NOT native hit_data. DK vl.prc hurtbox declarations are not available locally.',
              'params': {'artPixelsPerNativeUnit': ppu, 'worldPerNative': WORLD_PER_NATIVE, 'worldPerArtPixel': w, 'bodyHeight': args.body_height,
                         'bodyCentreFromRootY': -body_half, 'radiusQuantile': args.quantile, 'marginWorld': args.margin,
                         'minRadiusWorld': MIN_RADIUS, 'pieceLimit': PIECE_LIMIT, 'defaultPieceLimit': DEFAULT_PIECE_LIMIT,
                         'coverageTolerance': COVERAGE_TOLERANCE, 'includeNecktie': args.include_tie},
              'coordinateFrame': 'world units, relative to the body centre (root + bodyHeight/2 up), facing right, y down',
              'sources': {'skeletonSha256': sha(BASE / 'raw-model/fighter/donkey/model/body/c00/model.nusktb'), 'meshSha256': sha(MESH_PATH),
                          'helperSha256': sha(BASE / 'raw-model/fighter/donkey/model/body/c00/model.nuhlpb'),
                          'motions': {m: sha(MOTIONS / (m + '.nuanmb')) for m in sorted({f['motion'] for f in frames})},
                          'repo': str(ROOT)},
              'frames': report_frames, 'hurtboxPosesSha256': hashlib.sha256((out / 'hurtboxPoses.json').read_bytes()).hexdigest()}
    (out / 'receiving-report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'clip': clip, 'frames': len(poses), 'capsulesPerFrame': [e['capsules'] for e in report_frames], 'out': str(out)}))


# ------------------------------------------------------------------------- compare

def world_mask(rows, size=(480, 400), scale=2.0):
    """Rasterise world-space capsules (0.5 world unit pixels) around the body centre."""
    mask = np.zeros(size, bool)
    cx, cy = size[1] / 2, size[0] / 2
    for h in rows:
        c = h['capsule']
        a = (cx + c['start']['x'] * scale, cy + c['start']['y'] * scale)
        z = (cx + c['end']['x'] * scale, cy + c['end']['y'] * scale)
        mask |= capsule_mask(size, a, z, c['radius'] * scale)
    return mask


def region_summary(rows):
    out = {}
    for region in sorted({h['region'] for h in rows}):
        mask = world_mask([h for h in rows if h['region'] == region])
        ys, xs = np.nonzero(mask)
        out[region] = {'mask': mask, 'centroid': (xs.mean() / 2, ys.mean() / 2), 'bbox': (xs.min() / 2, xs.max() / 2, ys.min() / 2, ys.max() / 2)}
    return out


def compare(args):
    new = {p['nativeSample']: p for p in json.loads(Path(args.new).read_text())}
    old_clip = json.loads(Path(args.frames_json).read_text())['animations'][args.clip]
    report = []
    for old in old_clip['hurtboxPoses']:
        sample = old['nativeSample']
        if sample not in new:
            report.append({'nativeSample': sample, 'missing': True})
            continue
        ow, nw = old['hurtboxes'], new[sample]['hurtboxes']
        old_mask, new_mask = world_mask(ow), world_mask(nw)
        regions = {}
        o_reg, n_reg = region_summary(ow), region_summary(nw)
        for region in sorted(set(o_reg) | set(n_reg)):
            if region not in o_reg or region not in n_reg:
                regions[region] = {'onlyIn': 'old' if region in o_reg else 'new'}
                continue
            o, n = o_reg[region], n_reg[region]
            union = (o['mask'] | n['mask']).sum()
            regions[region] = {'oldCapsules': sum(h['region'] == region for h in ow), 'newCapsules': sum(h['region'] == region for h in nw),
                               'centroidDeltaWorld': [round(n['centroid'][0] - o['centroid'][0], 2), round(n['centroid'][1] - o['centroid'][1], 2)],
                               'bboxDeltaWorld[x0,x1,y0,y1]': [round(n['bbox'][i] - o['bbox'][i], 2) for i in range(4)],
                               'iou': round(float((o['mask'] & n['mask']).sum() / max(1, union)), 3)}
        # greedy same-region capsule matching by midpoint distance
        matches, used = [], set()
        for h in nw:
            candidates = [(np.hypot(h['offsetX'] - o['offsetX'], h['offsetY'] - o['offsetY']), j, o) for j, o in enumerate(ow)
                          if o['region'] == h['region'] and j not in used]
            if not candidates:
                matches.append({'new': h['id'], 'old': None})
                continue
            distance, j, o = min(candidates, key=lambda c: c[0])
            used.add(j)
            matches.append({'new': h['id'], 'old': o['id'], 'midpointDeltaWorld': [round(h['offsetX'] - o['offsetX'], 2), round(h['offsetY'] - o['offsetY'], 2)],
                            'radiusDeltaWorld': round(h['capsule']['radius'] - o['capsule']['radius'], 2)})
        report.append({'nativeSample': sample, 'oldCapsules': len(ow), 'newCapsules': len(nw),
                       'overallIou': round(float((old_mask & new_mask).sum() / max(1, (old_mask | new_mask).sum())), 3),
                       'oldAreaWorld2': round(float(old_mask.sum() / 4), 1), 'newAreaWorld2': round(float(new_mask.sum() / 4), 1),
                       'regions': regions, 'capsuleMatches': matches})
    text = json.dumps({'clip': args.clip, 'oldSource': args.frames_json, 'new': args.new, 'frames': report}, indent=2) + '\n'
    if args.output:
        Path(args.output).write_text(text)
    print(text if not args.output else json.dumps({'output': args.output, 'overallIou': [r.get('overallIou') for r in report]}))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest='command', required=True)
    g = sub.add_parser('generate')
    g.add_argument('--cells', help='families/<family>/<clip>/cells.json (png, root, nativeSample per cell)')
    g.add_argument('--spec', help='fighter-pack.py spec JSON')
    g.add_argument('--clip', help='clip name inside --spec')
    g.add_argument('--motion', help='native motion (no-art mode, or fallback when the clip/plan lacks one)')
    g.add_argument('--samples', help='comma list of native pose frames (no-art mode)')
    g.add_argument('--snap', choices=('grounded', 'none'), default='grounded', help='cells mode: snap grounded roots to the sole like the installer')
    g.add_argument('--out', required=True)
    g.add_argument('--overlay', action='store_true')
    g.add_argument('--ppu', type=float, help='art px per native unit (default: scale-contract.json)')
    g.add_argument('--body-height', type=float, default=pack.DEFAULT_BODY_HEIGHT)
    g.add_argument('--quantile', type=float, default=DEFAULT_QUANTILE)
    g.add_argument('--margin', type=float, default=DEFAULT_MARGIN)
    g.add_argument('--include-tie', action='store_true', help='keep the cosmetic necktie skin in the Bust/Head fit')
    c = sub.add_parser('compare')
    c.add_argument('new')
    c.add_argument('--frames-json', required=True)
    c.add_argument('--clip', required=True)
    c.add_argument('--output')
    args = parser.parse_args()
    if args.command == 'compare':
        return compare(args)
    if not (args.cells or (args.spec and args.clip) or (args.motion and args.samples)):
        parser.error('generate needs --cells, or --spec with --clip, or --motion with --samples')
    return generate(args)


if __name__ == '__main__':
    main()
