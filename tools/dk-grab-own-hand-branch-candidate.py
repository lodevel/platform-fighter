"""Candidate-only finite own-hand segment adaptation from reviewed pixel data.

No geometry is evaluated until the coordinator grants CPU. Fixed independently
reviewed segment endpoints stay unchanged; only their safe radius is solved.
All original primitives are preserved, including the failed hand fit.
"""
from pathlib import Path
import argparse
import copy
import hashlib
import importlib.util
import json
import math

ROOT = Path(__file__).resolve().parents[1]


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def pinned(path, expected):
    if sha(path) != expected:
        raise ValueError(f'Pinned bytes changed: {path}')
    return json.loads(path.read_text())


def pin(path):
    return {'path': str(path.resolve().relative_to(ROOT)), 'sha256': sha(path)}


def main():
    parser = argparse.ArgumentParser()
    for name in ['ownership', 'base-candidate', 'branch-proposal', 'branch-review']:
        parser.add_argument('--' + name, type=Path, required=True)
        parser.add_argument('--expected-' + name + '-sha256', required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--overlay', type=Path, required=True)
    parser.add_argument('--cpu-slot-released', action='store_true')
    args = parser.parse_args()
    if not args.cpu_slot_released:
        raise ValueError('Coordinator must grant own-branch receiving CPU slot')
    if args.output.resolve() == args.overlay.resolve() or args.output.exists() or args.overlay.exists():
        raise ValueError('Preserve separate original/partial candidate artifacts')
    packet = pinned(args.ownership, args.expected_ownership_sha256)
    base = pinned(args.base_candidate, args.expected_base_candidate_sha256)
    proposal = pinned(args.branch_proposal, args.expected_branch_proposal_sha256)
    review = pinned(args.branch_review, args.expected_branch_review_sha256)
    if (review.get('state') != 'ACTUAL_OWN_HAND_BRANCH_INPUTS_ACCEPTED_FOR_CANDIDATE_FIT' or
            review.get('ownershipProposal') != pin(args.ownership) or
            review.get('branchProposal') != pin(args.branch_proposal) or
            review.get('sourceReceivingCandidate') != pin(args.base_candidate) or
            review.get('ownSourceTargetLabelReviewed') is not True or
            review.get('noOtherPoseBranchROIReused') is not True):
        raise ValueError('Actual own source/target/label/branch review required')
    if (proposal.get('sourceOwnershipProposalSha256') != args.expected_ownership_sha256 or
            proposal.get('sourceReceivingCandidate') != pin(args.base_candidate) or
            proposal.get('targetImageSha256') != packet['targetImageSha256'] or
            proposal.get('labelImageSha256') != packet['labelImageSha256'] or
            base.get('targetOwnershipProposalSha256') != args.expected_ownership_sha256 or
            base.get('targetImageSha256') != packet['targetImageSha256'] or
            base.get('clip') != packet['clip'] or
            base.get('nativeSample') != packet['nativeSample'] or
            base.get('artFrameIndex') != packet['artFrameIndex']):
        raise ValueError('Branch, base and ownership must bind this exact own pose')
    branches = proposal.get('branches')
    if not isinstance(branches, list) or not 1 <= len(branches) <= 6:
        raise ValueError('Finite one-to-six NEW handL primitives required')
    names = set()
    for branch in branches:
        if not isinstance(branch, dict) or not isinstance(branch.get('id'), str) or not branch['id'].strip() or branch['id'] in names:
            raise ValueError('Unique nonempty branch IDs required')
        names.add(branch['id'])
        if branch.get('role') not in ['digit', 'palm']:
            raise ValueError('Explicit reviewed digit/palm role required')
        for key in ['quarterStart', 'quarterEnd']:
            value = branch.get(key)
            if not isinstance(value, list) or len(value) != 2 or any(type(v) is not int for v in value):
                raise ValueError('Own endpoints must be integer quarter pixel indices')
        roi = branch.get('roiPolygonQuarter')
        if not isinstance(roi, list) or len(roi) < 3 or any(not isinstance(p, list) or len(p) != 2 or any(isinstance(v, bool) or not isinstance(v, (float, int)) or not math.isfinite(v) for v in p) for p in roi):
            raise ValueError('Finite independently reviewed branch-outline ROI required')
    # Heavy imports and existing safe-mask evaluation occur only after pin and
    # review guards. The existing authored1world margin/floor remain identical.
    import numpy as np
    from PIL import Image, ImageDraw
    spec = importlib.util.spec_from_file_location('dk_own_fit', ROOT / 'tools/dk-target-contour-receiving-fit.py')
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    target = Path(packet['targetImage']); labels_path = Path(packet['labelImage'])
    if sha(target) != packet['targetImageSha256'] or sha(labels_path) != packet['labelImageSha256']:
        raise ValueError('Own target/labels changed')
    image = Image.open(target).convert('RGBA'); alpha = np.asarray(image)[:, :, 3] >= 32
    labels = np.asarray(Image.open(labels_path)); root = np.array(packet['root'], dtype=float)
    world_scale = float(packet['scaleToWorld']); pixels_per_world = 1 / world_scale
    if labels.shape != alpha.shape or root.shape != (2,) or not np.isfinite(root).all() or not math.isfinite(world_scale) or world_scale <= 0 or packet['bodyCentreFromRootY'] != -42:
        raise ValueError('Exact finite own root/body/target registration required')
    allowed = module.dilation(labels > 0, pixels_per_world)
    hand_label = packet['regionLabelIds']['handl']; own_hand = (labels == hand_label) & alpha
    poses = base.get('hurtboxPoses')
    if not isinstance(poses, list) or len(poses) != 1 or poses[0]['nativeSample'] != packet['nativeSample'] or poses[0]['artFrameIndex'] != packet['artFrameIndex']:
        raise ValueError('Exactly one own base pose required')
    result = copy.deepcopy(base); boxes = result['hurtboxPoses'][0]['hurtboxes']; old_boxes = copy.deepcopy(boxes)
    if not isinstance(boxes, list) or not boxes:
        raise ValueError('Nonempty preserved original primitive list required')
    for box in boxes:
        capsule = box.get('capsule', {})
        values = [capsule.get('radius')] + [capsule.get(key, {}).get(axis) for key in ['start', 'end'] for axis in ['x', 'y']]
        if any(isinstance(v, bool) or not isinstance(v, (float, int)) or not math.isfinite(v) for v in values) or values[0] <= 0:
            raise ValueError('Preserved original capsules must be finite with positive radius')
    union = np.zeros_like(alpha); branch_diagnostics = []
    for box in old_boxes:
        c = box['capsule']; a = root + np.array([c['start']['x'], c['start']['y'] - 42]) * pixels_per_world; z = root + np.array([c['end']['x'], c['end']['y'] - 42]) * pixels_per_world
        xs, ys = module.capsule_grid(a, z, c['radius'] * pixels_per_world); union[ys, xs] = True
    for index, branch in enumerate(branches):
        if any(not 0 <= x < image.width or not 0 <= y < image.height for x, y in branch['roiPolygonQuarter']):
            raise ValueError('Own branch ROI must remain within its actual target cell')
        start = np.array(branch['quarterStart'], dtype=float) + .5; end = np.array(branch['quarterEnd'], dtype=float) + .5
        for point in np.linspace(start, end, max(2, math.ceil(float(np.linalg.norm(end - start))) * 4 + 1)):
            x, y = np.floor(point).astype(int)
            if not 0 <= y < labels.shape[0] or not 0 <= x < labels.shape[1] or not own_hand[y, x]:
                raise ValueError(f'Own reviewed {branch["id"]} centreline leaves handL target alpha/label')
        lo, hi = 0., 80. * pixels_per_world
        for _ in range(18):
            radius = (lo + hi) / 2
            if module.safe(start, end, radius, allowed, root[1], pixels_per_world): lo = radius
            else: hi = radius
        if lo / pixels_per_world < .15:
            raise ValueError('Reviewed branch cannot receive even a .15world core inset')
        def world(p): return {'x': round(float((p[0] - root[0]) * world_scale), 5), 'y': round(float(42 + (p[1] - root[1]) * world_scale), 5)}
        a, z, r = world(start), world(end), round(lo * world_scale, 5)
        box = {'id': f'donkeykong.target.handl.own_branch.{index}', 'region': 'handl', 'offsetX': (a['x'] + z['x']) / 2, 'offsetY': (a['y'] + z['y']) / 2, 'width': abs(a['x'] - z['x']) + 2 * r, 'height': abs(a['y'] - z['y']) + 2 * r, 'capsule': {'start': a, 'end': z, 'radius': r}}
        if any(old['id'] == box['id'] for old in boxes): raise ValueError('Own branch ID collides with preserved primitive')
        boxes.append(box); xs, ys = module.capsule_grid(start, end, lo); union[ys, xs] = True
        roi_image = Image.new('L', image.size); ImageDraw.Draw(roi_image).polygon([tuple(p) for p in branch['roiPolygonQuarter']], fill=1)
        roi = np.asarray(roi_image).astype(bool) & own_hand
        if not roi.any(): raise ValueError('Own branch ROI contains no actual handL target pixels')
        branch_diagnostics.append({'id': branch['id'], 'role': branch['role'], 'quarterStart': branch['quarterStart'], 'quarterEnd': branch['quarterEnd'], 'radiusWorld': r, 'ownLabelRoiPixels': int(roi.sum()), 'roiCoveredByAllPrimitivesPercent': float((union & roi).sum() / roi.sum() * 100)})
    # Evaluate every own ROI against the final union, including later branches.
    for branch, diagnostics in zip(branches, branch_diagnostics):
        roi_image = Image.new('L', image.size)
        ImageDraw.Draw(roi_image).polygon([tuple(p) for p in branch['roiPolygonQuarter']], fill=1)
        roi = np.asarray(roi_image).astype(bool) & own_hand
        diagnostics['roiCoveredByAllPrimitivesPercent'] = float((union & roi).sum() / roi.sum() * 100)
    if boxes[:len(old_boxes)] != old_boxes: raise AssertionError('Original geometry changed')
    result['primitiveCount'] = len(boxes)
    result['ownHandBranchAdaptation'] = {'state': 'CANDIDATE_OWN_HAND_BRANCHES_ACTUAL_REVIEW_PENDING', 'baseCandidate': pin(args.base_candidate), 'branchProposal': pin(args.branch_proposal), 'branchReview': pin(args.branch_review), 'newHandLPrimitives': len(branches), 'branchDiagnostics': branch_diagnostics, 'ownHandCoverageByAllPrimitivesPercent': float((union & own_hand).sum() / own_hand.sum() * 100), 'actualAnatomicalCoverageByAllPrimitivesPercent': float((union & (labels > 0)).sum() / (labels > 0).sum() * 100), 'originalPrimitiveGeometryChanged': False, 'allNonHandGeometryChanged': False, 'allowedMarginWorld': 1, 'groundFloorWorldMaximum': 42.55, 'nativeHitDataParityClaimed': False, 'independentProbeAcceptancePending': True}
    result['limits'] = result.get('limits', []) + ['Fixed own reviewed target branch centrelines plus largest safe radii; authored receiving adaptation, not native hit_data.', 'Original fit diagnostics describe original geometry; ownHandBranchAdaptation metrics describe this candidate.', 'All source clocks/CATCH/attack fields and original primitives remain unchanged.']
    args.output.write_text(json.dumps(result, indent=2) + '\n')
    view = Image.new('RGBA', image.size, (25, 30, 39, 255)); view.alpha_composite(image); draw = ImageDraw.Draw(view)
    for i, branch in enumerate(branches):
        a = np.array(branch['quarterStart']) + .5; z = np.array(branch['quarterEnd']) + .5; r = branch_diagnostics[i]['radiusWorld'] * pixels_per_world
        theta = math.atan2(z[1] - a[1], z[0] - a[0]); outline = []
        for centre, phase in [(z, theta - math.pi / 2), (a, theta + math.pi / 2)]:
            for k in range(17):
                angle = phase + math.pi * k / 16; outline.append((centre[0] + r * math.cos(angle), centre[1] + r * math.sin(angle)))
        draw.line(outline + [outline[0]], fill=(90, 255, 220), width=1)
        draw.line([tuple(a), tuple(z)], fill=(255, 130, 255), width=1)
    view.save(args.overlay)
    print(json.dumps({'candidate': pin(args.output), 'overlay': pin(args.overlay), 'state': 'OWN_BRANCH_CANDIDATE_NOT_ACCEPTED'}))


if __name__ == '__main__': main()
