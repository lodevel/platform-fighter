"""Candidate-only compact fit and separately pinned art-index restamp.

The unmodified fitter's frame-zero output is retained. Each invocation requires
its own reviewed ownership packet; startup fists never reuse open-palm ROIs.
"""
from pathlib import Path
import argparse
import hashlib
import importlib.util
import json

ROOT = Path(__file__).resolve().parents[1]


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_pinned(path, expected):
    if sha(path) != expected:
        raise ValueError(f'Pinned input differs: {path}')
    return json.loads(path.read_text())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--packet', type=Path, required=True)
    parser.add_argument('--expected-packet-sha256', required=True)
    parser.add_argument('--ownership-review', type=Path, required=True)
    parser.add_argument('--expected-review-sha256', required=True)
    parser.add_argument('--original-output', type=Path, required=True)
    parser.add_argument('--overlay', type=Path, required=True)
    parser.add_argument('--restamped-output', type=Path, required=True)
    parser.add_argument('--phase', choices=['fit', 'restamp'], required=True)
    parser.add_argument('--expected-original-sha256')
    parser.add_argument('--hand-piece-limit', type=int, choices=[3, 4, 5, 6],
                        help='Own reviewed hand detail; omit for compact closed poses')
    parser.add_argument('--core-probes', type=Path,
                        help='Own reviewed receiving core; no unrelated contact pose reuse')
    parser.add_argument('--expected-core-sha256')
    parser.add_argument('--cpu-slot-released', action='store_true')
    args = parser.parse_args()
    for key in ['packet', 'ownership_review', 'original_output', 'overlay', 'restamped_output']:
        setattr(args, key, getattr(args, key).resolve())
    packet = load_pinned(args.packet, args.expected_packet_sha256)
    review = load_pinned(args.ownership_review, args.expected_review_sha256)
    review_pin = {'path': str(args.ownership_review.relative_to(ROOT)), 'sha256': args.expected_review_sha256}
    # Root can invalidate an early visual acceptance without rewriting its
    # immutable receipt. Scan only this review's own directory, before imports.
    for notice_path in sorted(args.ownership_review.parent.glob('*ownership-review-superseded*.json')):
        notice = json.loads(notice_path.read_text())
        if (notice.get('state') == 'EARLY_OWNERSHIP_ACCEPTANCE_SUPERSEDED_DO_NOT_FIT' and
                notice.get('supersedes') == review_pin):
            raise ValueError(f'Ownership review explicitly superseded; do not fit: {notice_path}')
    if (review.get('state') != 'ACTUAL_TARGET_OWNERSHIP_ACCEPTED_FOR_CANDIDATE_FIT' or
            review.get('ownershipProposal') != {'path': str(args.packet.relative_to(ROOT)),
                                               'sha256': args.expected_packet_sha256} or
            not all(review.get(k) is True for k in ['pendantOnlyBoundaryReviewed',
                    'allRegionalOwnershipReviewed', 'ownPoseSourcePriorReviewed', 'noContactDigitROIReused'])):
        raise ValueError('Actual own-pose anatomical ownership and pendant boundary review required')
    index = packet.get('artFrameIndex')
    native = packet.get('nativeSample')
    if (not isinstance(index, int) or isinstance(index, bool) or index < 0 or
            not isinstance(native, int) or isinstance(native, bool) or native < 1):
        raise ValueError('Explicit art/native integer clocks required')
    if 'cosmeticReceivingExclusions' not in packet:
        raise ValueError('Required explicit source cosmetic exclusion provenance missing')
    core_pin = None
    if args.core_probes:
        args.core_probes = args.core_probes.resolve()
        if not args.expected_core_sha256:
            raise ValueError('Own core probes require an exact retained SHA')
        core = load_pinned(args.core_probes, args.expected_core_sha256)
        core_pin = {'path': str(args.core_probes.relative_to(ROOT)), 'sha256': args.expected_core_sha256}
        if core.get('sourceOwnershipProposalSha256') != args.expected_packet_sha256 or review.get('coreProbes') != core_pin:
            raise ValueError('Core must belong to and be actually reviewed with this exact own ownership packet')
    elif args.expected_core_sha256:
        raise ValueError('Core hash supplied without own core packet')
    if args.hand_piece_limit and review.get('handPieceLimit') != args.hand_piece_limit:
        raise ValueError('Explicit hand piece limit requires own target-detail review')
    if len({args.original_output.resolve(), args.overlay.resolve(), args.restamped_output.resolve()}) != 3:
        raise ValueError('Original fit, overlay and restamp must be distinct artifacts')
    execution_path = Path(str(args.original_output) + '.execution-receipt.json')
    options = {'handPieceLimit': args.hand_piece_limit, 'coreProbes': core_pin}
    if args.phase == 'fit':
        if not args.cpu_slot_released:
            raise ValueError('Coordinator must release fitter CPU slot')
        if any(p.exists() for p in [args.original_output, args.overlay, args.restamped_output, execution_path]):
            raise ValueError('Preserve original and any partial fit/overlay outputs')
        spec = importlib.util.spec_from_file_location('dk_compact_fit', ROOT / 'tools/dk-target-contour-receiving-fit.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        # Closed pose default is compact. Open/curled hand detail is opt-in only
        # from this own reviewed packet, never a borrowed native8 ROI or core.
        module.fit(args.packet, args.original_output, args.overlay,
                   core_probes=args.core_probes, hand_piece_limit=args.hand_piece_limit)
        execution = {'state': 'OWN_REVIEWED_OPTIONS_ORIGINAL_FIT_EXECUTION',
            'originalFit': {'path': str(args.original_output.relative_to(ROOT)), 'sha256': sha(args.original_output)},
            'ownershipProposal': {'path': str(args.packet.relative_to(ROOT)), 'sha256': args.expected_packet_sha256},
            'ownershipReview': review_pin, 'fitOptions': options,
            'overlay': {'path': str(args.overlay.relative_to(ROOT)), 'sha256': sha(args.overlay)}}
        execution_path.write_text(json.dumps(execution, indent=2) + '\n')
        print(json.dumps({'originalFit': {'path': str(args.original_output.relative_to(ROOT)),
                                         'sha256': sha(args.original_output)},
                          'overlay': {'path': str(args.overlay.relative_to(ROOT)), 'sha256': sha(args.overlay)},
                          'fitOptions': {'handPieceLimit': args.hand_piece_limit, 'coreProbes': core_pin},
                          'state': 'UNACCEPTED_FIT_FRAME_ZERO_PRESERVED'}))
        return
    if args.restamped_output.exists():
        raise ValueError('Preserve prior validated restamp')
    if not args.expected_original_sha256:
        raise ValueError('Restamp requires independently retained original fit SHA256')
    original = load_pinned(args.original_output, args.expected_original_sha256)
    execution = json.loads(execution_path.read_text())
    if (execution.get('state') != 'OWN_REVIEWED_OPTIONS_ORIGINAL_FIT_EXECUTION' or
            execution.get('originalFit') != {'path': str(args.original_output.relative_to(ROOT)), 'sha256': args.expected_original_sha256} or
            execution.get('ownershipReview') != review_pin or execution.get('fitOptions') != options or
            execution.get('ownershipProposal') != {'path': str(args.packet.relative_to(ROOT)), 'sha256': args.expected_packet_sha256}):
        raise ValueError('Restamp options must exactly match immutable original fit execution receipt')
    if (original.get('artFrameIndex') != 0 or original.get('nativeSample') != native or
            original.get('targetOwnershipProposalSha256') != args.expected_packet_sha256 or
            original.get('targetImageSha256') != packet.get('targetImageSha256')):
        raise ValueError('Original fitter result is not this reviewed pose')
    poses = original.get('hurtboxPoses')
    if (not isinstance(poses, list) or len(poses) != 1 or poses[0].get('artFrameIndex') != 0 or
            poses[0].get('nativeSample') != native or not poses[0].get('hurtboxes')):
        raise ValueError('Require one own nonempty frame-zero fit sample')
    original['artFrameIndex'] = index
    poses[0]['artFrameIndex'] = index
    original['clip'] = packet['clip']
    original['artIndexRestamp'] = {'policy': 'validated own input art index; original frame-zero output retained',
        'originalFit': {'path': str(args.original_output.relative_to(ROOT)), 'sha256': args.expected_original_sha256},
        'ownershipReview': {'path': str(args.ownership_review.relative_to(ROOT)), 'sha256': args.expected_review_sha256},
        'sourceArtFrameIndex': 0, 'selectedArtFrameIndex': index,
        'selectedOwnFitOptions': {'handPieceLimit': args.hand_piece_limit, 'coreProbes': core_pin},
        'executionReceipt': {'path': str(execution_path.relative_to(ROOT)), 'sha256': sha(execution_path)},
        'numericGeometryChanged': False, 'timingChanged': False}
    args.restamped_output.write_text(json.dumps(original, indent=2) + '\n')
    print(json.dumps({'path': str(args.restamped_output.relative_to(ROOT)),
                      'sha256': sha(args.restamped_output), 'state': 'UNACCEPTED_CANDIDATE_RESTAMP'}))


if __name__ == '__main__':
    main()
