"""Per-pose source/target receiving proposals; never changes shipping assets.

Execute the mesh evaluation and cached ownership competition separately in the
coordinator's serialized CPU slots. Every pose supplies its own source sample,
accepted drawing, support transform and cosmetic exclusion polygon.
"""
from pathlib import Path
import argparse
import hashlib
import importlib.util
import json
import math

ROOT = Path(__file__).resolve().parents[1]
REGIONS = ['hip', 'bust', 'head', 'shoulderl', 'arml', 'handl', 'shoulderr',
           'armr', 'handr', 'legl', 'kneel', 'footl', 'legr', 'kneer', 'footr']


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def validate_points(regions):
    if not isinstance(regions, dict) or set(regions) != set(REGIONS):
        raise ValueError('Require exactly own fifteen anatomical source regions')
    for name, points in regions.items():
        if not isinstance(points, list) or not points or any(
                not isinstance(p, list) or len(p) != 2 or not all(finite(v) for v in p) for p in points):
            raise ValueError(f'Require nonempty finite source cloud: {name}')


def validate_warp(warp):
    fields = ['inputBandStartPixelY', 'inputLastPixelY', 'targetLastPixelY',
              'inclusiveRowsRatio', 'rootPixelY', 'pixelsPerNativeUnit']
    if not isinstance(warp, dict) or any(not finite(warp.get(k)) for k in fields):
        raise ValueError('Support transform must be complete and finite')
    first, last, target = [warp[k] for k in fields[:3]]
    if any(not float(n).is_integer() for n in [first, last, target]) or not (
            0 <= first < last < 1024 and first <= target < 1024 and target <= last):
        raise ValueError('Invalid support-only inclusive pixel bounds')
    if warp['rootPixelY'] != 832 or warp['pixelsPerNativeUnit'] != 26 or target != 830:
        raise ValueError('Unexpected declared grounded source/target support contract')
    ratio = (target - first + 1) / (last - first + 1)
    if abs(ratio - warp['inclusiveRowsRatio']) > 1e-12:
        raise ValueError('Support transform inclusive ratio differs')
    return ratio


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def pinned(record):
    path = ROOT / record['path']
    if sha(path) != record['sha256']:
        raise ValueError(f'Input bytes changed: {record["path"]}')
    return path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--plan', type=Path, required=True)
    parser.add_argument('--native', type=int, required=True)
    parser.add_argument('--clip', choices=['grab', 'grab_pull', 'grab_hold'], default='grab')
    parser.add_argument('--phase', choices=['source', 'ownership'], required=True)
    parser.add_argument('--cpu-slot-released', action='store_true')
    parser.add_argument('--expected-source-sha256', help='Required pinned source anatomy hash for ownership')
    parser.add_argument('--ownership-suffix', default='', help='Versioned ownership outputs; own source packet remains immutable')
    parser.add_argument('--retain-quarter-pixel', nargs=2, type=int, action='append', default=[],
                        metavar=('X', 'Y'), help='Explicit reviewed mixed-alpha pixel retained as receiving-owned')
    args = parser.parse_args()
    args.plan = args.plan.resolve()
    if args.ownership_suffix and any(c not in 'abcdefghijklmnopqrstuvwxyz0123456789-' for c in args.ownership_suffix):
        raise ValueError('Ownership output suffix must be lowercase alphanumeric/hyphen')
    if args.retain_quarter_pixel and args.phase != 'ownership':
        raise ValueError('Retained target pixel exceptions cannot change cached source anatomy')
    if len({tuple(p) for p in args.retain_quarter_pixel}) != len(args.retain_quarter_pixel) or any(
            not (0 <= x < 384 and 0 <= y < 256) for x, y in args.retain_quarter_pixel):
        raise ValueError('Retained receiving pixels must be unique own quarter-cell coordinates')
    if not args.cpu_slot_released:
        raise ValueError('Coordinator must release the CPU slot')
    plan = json.loads(args.plan.read_text())
    rows = [r for r in plan['rows'] if r['nativeSample'] == args.native and r.get('clip', 'grab') == args.clip]
    if len(rows) != 1 or args.native < 1:
        raise ValueError('Require one own native sample row')
    row = rows[0]
    if not isinstance(row.get('artFrameIndex'), int) or isinstance(row['artFrameIndex'], bool) or row['artFrameIndex'] < 0:
        raise ValueError('Art index must be an explicit nonnegative integer')
    accepted = json.loads(pinned(row['staticReview']).read_text())
    if (accepted.get('nativeSample') == args.native and 'STATIC_DRAWING_ACCEPTED' in accepted.get('state', '')):
        accepted_targets = {key: accepted.get(key) for key in ['target', 'quarterTarget']}
    elif accepted.get('state') in ['PASS_TWO_STATIC_STANDING_TARGET_DRAWINGS_ONLY', 'PASS_ONE_STATIC_STANDING_TARGET_DRAWING_ONLY']:
        if args.clip != 'grab':
            raise ValueError('Delegated standing static review cannot authorize another clip')
        expected_rows = 2 if accepted['state'] == 'PASS_TWO_STATIC_STANDING_TARGET_DRAWINGS_ONLY' else 1
        if not isinstance(accepted.get('rows'), list) or len(accepted['rows']) != expected_rows:
            raise ValueError('Delegated static receipt scope/row count differs')
        own = [r for r in accepted.get('rows', []) if isinstance(r, dict) and
               r.get('nativeSample') == args.native and r.get('staticTargetAccepted') is True]
        if len(own) != 1:
            raise ValueError('Own native sample lacks exact delegated static acceptance')
        accepted_targets = {key: own[0].get(key) for key in ['target', 'quarterTarget']}
    elif accepted.get('state') == 'FOUR_STATIC_TARGET_PILOTS_ACCEPTED_RECEIVING_GRIP_AND_ACTION_GATES_PENDING':
        own = [r for r in accepted['rows'] if r.get('pose') == f'{args.clip}-native{args.native}' and
               r.get('staticIdentityAnatomyAlphaRootFloor') == 'ACCEPTED']
        if len(own) != 1:
            raise ValueError('Pose lacks exact own static acceptance in shared receipt')
        accepted_targets = {}
        for key, receipt_key in [('target', 'target'), ('quarterTarget', 'packedTarget')]:
            pin = own[0][receipt_key]
            accepted_targets[key] = {'path': str((pinned(row['staticReview']).parent / pin['file']).relative_to(ROOT)),
                                     'sha256': pin['sha256']}
    else:
        raise ValueError('Pose lacks its own accepted static drawing review')
    for key in ['target', 'quarterTarget']:
        pinned(row[key])
        if accepted_targets[key] != row[key]:
            raise ValueError('Drawing differs from the accepted review')
    guide = json.loads(pinned(row['sourceGuide']).read_text())
    if guide['native_sample_index'] != args.native:
        raise ValueError('Source sample differs from target pose')
    motion = pinned(guide['motion'])
    warp = row['floorTransform']
    ratio = validate_warp(warp)
    polygons = row['cosmeticPendantPolygons']
    if not isinstance(polygons, list) or any(not isinstance(poly, list) or len(poly) < 3 or any(
            not isinstance(p, list) or len(p) != 2 or not all(finite(v) for v in p) or
            not (0 <= p[0] < 1536 and 0 <= p[1] < 1024) for p in poly) for poly in polygons):
        raise ValueError('Pendant-only polygons must be explicit finite full-cell proposals')
    if guide['root'] != [512, 832] or guide['art_pixels_per_native_unit'] != 26 or guide['canvas'] != [1536, 1024] or guide.get('root_registration') != 'remove-trans-translation':
        raise ValueError('Unexpected source coordinate contract')
    stem = args.plan.parent / (f'fullgrab-standing-native{args.native}' if args.clip == 'grab' else f'fullgrab-{args.clip}-native{args.native}')
    source_path = stem.with_name(stem.name + '-source-anatomy.json')
    if args.phase == 'source':
        if source_path.exists():
            raise ValueError('Preserve prior source anatomy')
        spec = importlib.util.spec_from_file_location('dk_source_anatomy', ROOT / 'tools/dk-anatomical-capsules.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        native = module.native_region_points(motion.stem, args.native, exclude_cosmetic_tie=True)
        points = {bone.lower(): [[p[2] * 5, 42 - p[1] * 5] for p in values]
                  for bone, values in native['pointsByRegion'].items()}
        validate_points(points)
        data = {'state': 'SOURCE_OWNERSHIP_PRIORS_ONLY', 'nativeSample': args.native,
                'planSha256': sha(args.plan), 'sourceGuide': row['sourceGuide'],
                'sourceMotion': native['provenance'], 'sourceMesh': native['mesh'],
                'projectedPointsByRegion': points,
                'omittedMeshHelperConstraints': native['omittedMeshHelperConstraints'],
                'visibleMeshes': native['visibleMeshes'],
                'cosmeticReceivingExclusions': native['cosmeticReceivingExclusions'],
                'limits': ['Approximate native helper/shader projection is an ownership prior, not native hit_data or captured joint parity.'],
                'reviewedForShipping': False, 'GPUUsed': False}
        source_path.write_text(json.dumps(data, separators=(',', ':')) + '\n')
        print(json.dumps({'path': str(source_path.relative_to(ROOT)), 'sha256': sha(source_path)}))
        return

    if not args.expected_source_sha256 or sha(source_path) != args.expected_source_sha256:
        raise ValueError('Ownership requires exact independently retained source anatomy SHA256')
    output_stem = stem.with_name(stem.name + ('-' + args.ownership_suffix if args.ownership_suffix else ''))
    out = output_stem.with_name(output_stem.name + '-ownership-proposal.json')
    label = output_stem.with_name(output_stem.name + '-labels.png')
    mask = output_stem.with_name(output_stem.name + '-cosmetic-mask.png')
    overlay = output_stem.with_name(output_stem.name + '-ownership-overlay.png')
    if any(path.exists() for path in [out, label, mask, overlay]):
        raise ValueError('Preserve all prior ownership outputs, including failed partial artifacts')

    import numpy as np
    from PIL import Image, ImageDraw
    from scipy.ndimage import gaussian_filter, convolve
    from scipy.spatial import cKDTree
    source = json.loads(source_path.read_text())
    if source['planSha256'] != sha(args.plan) or source['sourceGuide'] != row['sourceGuide'] or source['nativeSample'] != args.native:
        raise ValueError('Cached source belongs to different inputs')
    validate_points(source['projectedPointsByRegion'])
    image = Image.open(pinned(row['quarterTarget'])).convert('RGBA')
    if image.size != (384, 256):
        raise ValueError('Quarter drawing dimensions changed')
    pixels = np.asarray(image)
    visible = pixels[:, :, 3] >= 32
    exclusion = Image.new('L', image.size)
    for polygon in row['cosmeticPendantPolygons']:
        ImageDraw.Draw(exclusion).polygon([(x / 4, y / 4) for x, y in polygon], fill=255)
    # Named pendant polygons are proposals, never permission to erase adjacent
    # cream fists/thumbs. Only actual strongly red material is excluded here;
    # dark ink and yellow lettering remain conservative anatomy until reviewed.
    red, green, blue = [pixels[:, :, i].astype(np.int16) for i in range(3)]
    actual_red = (red >= 60) & (red >= green + 60) & (red >= green * 1.45) & (red >= blue + 35)
    polygon_mask = np.asarray(exclusion) > 0
    cosmetic = visible & polygon_mask & actual_red
    before_exceptions = cosmetic.copy()
    for x, y in args.retain_quarter_pixel:
        if not visible[y, x] or not cosmetic[y, x]:
            raise ValueError('Own mixed-alpha retain exception must be one actual currently excluded visible pixel')
        cosmetic[y, x] = False
    anatomy = visible & ~cosmetic
    if not visible.any() or not anatomy.any():
        raise ValueError('Require actual visible anatomical target pixels')
    root = np.array([128, 208], float)
    scale = 5 / 6.5
    ys, xs = np.where(anatomy)
    coords = np.column_stack(((xs + .5 - root[0]) * scale, 42 + (ys + .5 - root[1]) * scale))
    regions = REGIONS
    norm = gaussian_filter(anatomy.astype(float), 3)
    distances = []
    for region in regions:
        points = np.array(source['projectedPointsByRegion'][region], float)
        py = 832 + (points[:, 1] - 42) * 26 / 5
        py = np.where(py >= warp['inputBandStartPixelY'], warp['inputBandStartPixelY'] + (py - warp['inputBandStartPixelY']) * ratio, py)
        points[:, 1] = 42 + (py - 832) * 5 / 26
        distance = cKDTree(points).query(coords, workers=1)[0]
        field = np.zeros(anatomy.shape)
        field[ys, xs] = distance
        distances.append((gaussian_filter(field, 3) / np.maximum(norm, 1e-9))[ys, xs])
    labels = np.zeros(anatomy.shape, np.uint8)
    labels[ys, xs] = np.asarray(distances).argmin(axis=0) + 1
    votes = np.stack([convolve((labels == i + 1).astype(np.uint8), np.ones((3, 3), np.uint8), mode='constant') for i in range(len(regions))])
    labels[anatomy] = votes.argmax(axis=0)[anatomy] + 1
    colors = [(217,70,70),(170,65,170),(240,190,50),(75,150,230),(40,210,200),(30,160,80),(150,100,230),(60,90,200),(245,130,40),(130,185,50),(215,110,175),(100,215,140),(150,155,245),(245,130,150),(230,220,120)]
    records, counts = {}, {}
    tint = np.zeros_like(pixels)
    tint[:, :, 3] = np.where(anatomy, 140, 0)
    for i, region in enumerate(regions):
        yy, xx = np.where(labels == i + 1)
        records[region] = np.column_stack(((xx + .5 - root[0]) * scale, 42 + (yy + .5 - root[1]) * scale)).round(6).tolist()
        counts[region] = {'targetPixels': len(xx)}
        tint[labels == i + 1, :3] = colors[i % len(colors)]
    floor = (int(np.where(visible)[0].max()) + .5 - root[1]) * scale
    if abs(floor) > .55:
        raise ValueError('Accepted drawing exceeds grounded support band')
    Image.fromarray(labels).save(label)
    Image.fromarray((cosmetic * 255).astype(np.uint8)).save(mask)
    composite = Image.new('RGBA', image.size, (25, 30, 39, 255))
    composite.alpha_composite(image)
    composite.alpha_composite(Image.fromarray(tint))
    draw = ImageDraw.Draw(composite)
    for i, region in enumerate(regions):
        yy, xx = np.where(labels == i + 1)
        if len(xx):
            draw.text((float(np.median(xx)), float(np.median(yy))), region, fill='white', stroke_width=1, stroke_fill='black')
    composite.save(overlay)
    data = {'state': 'TARGET_OWNERSHIP_PROPOSAL_ACTUAL_REVIEW_PENDING', 'clip': args.clip,
            'nativeSample': args.native, 'gameplayAge': args.native - 1, 'artFrameIndex': row['artFrameIndex'],
            'root': root.tolist(), 'scaleToWorld': scale, 'bodyCentreFromRootY': -42,
            'targetImage': row['quarterTarget']['path'], 'targetImageSha256': row['quarterTarget']['sha256'],
            'sourceOwnershipPrior': str(source_path.relative_to(ROOT)), 'sourceOwnershipPriorSha256': sha(source_path),
            'cosmeticReceivingExclusions': source['cosmeticReceivingExclusions'],
            'sourcePriorFloorWarp': warp, 'floorPixelCentreWorldDelta': floor,
            'targetCosmeticOnlyMask': str(mask.relative_to(ROOT)), 'targetCosmeticOnlyMaskSha256': sha(mask),
            'targetCosmeticPolygonsFullArt': row['cosmeticPendantPolygons'], 'targetCosmeticOnlyExclusionPixels': int(cosmetic.sum()),
            'targetCosmeticMaterialPolicy': {'policy': 'only visible strongly-red pixels inside own pendant proposal polygons',
                'redMinimum': 60, 'redMinusGreenMinimum': 60, 'redToGreenMinimumRatio': 1.45, 'redMinusBlueMinimum': 35,
                'creamThumbFistExclusion': 'requires actual mask/pixel review; predicate alone cannot establish material identity', 'actualBoundaryReviewRequired': True,
                'darkInkAndYellowLetters': 'conservatively retained until own actual overlay review'},
            'targetPendantPolygonVisibleNonRedPixelsRetained': int((visible & polygon_mask & ~actual_red).sum()),
            'targetReceivingRetainedPixelsQuarter': args.retain_quarter_pixel,
            'targetCosmeticExclusionPixelsBeforeRetainExceptions': int(before_exceptions.sum()),
            'targetCosmeticExclusionPixelsRemovedByRetainExceptions': int((before_exceptions & ~cosmetic).sum()),
            'retainedPixelPolicy': 'Explicit own-pose reviewed mixed warm/alpha boundary retained as receiving-owned; no material identity inference or broad predicate change.',
            'alpha32VisibleTargetPixels': int(visible.sum()), 'alpha32TargetPixels': int(anatomy.sum()),
            'projectedPointsByRegion': records, 'targetRegionCounts': counts,
            'regionLabelIds': {r: i + 1 for i, r in enumerate(regions)},
            'labelImage': str(label.relative_to(ROOT)), 'labelImageSha256': sha(label),
            'overlayImage': str(overlay.relative_to(ROOT)), 'overlayImageSha256': sha(overlay),
            'method': 'Own source sample/support transform;15-region nearest-distance competition;3quarterpixel Gaussian and3x3 majority; no alpha or palette edits.',
            'limits': ['Actual anatomical ownership/cosmetic boundary review required before fitting.', 'Source ownership is not native hit_data, target receiving or captured attachment acceptance.'],
            'reviewedForShipping': False, 'actualContactVerified': False, 'GPUUsed': False, 'fitterRun': False}
    out.write_text(json.dumps(data, indent=2) + '\n')
    print(json.dumps({'path': str(out.relative_to(ROOT)), 'sha256': sha(out)}))


if __name__ == '__main__':
    main()
