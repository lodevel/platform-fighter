"""Measure unchanged ordinary-held recipient art0..3 alpha support only.

This writes a review measurement, never a runtime calibration or sprite edit.
Pixel-centre and conservative pixel-edge envelopes are recorded separately.
"""
from pathlib import Path
import argparse
import hashlib
import json

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / 'assets/characters/pikachu/animations/captured.png'
META = ROOT / 'assets/characters/pikachu/frames.json'
TARGET_SHA = '28d0215925e504f105a3e754f7980c5ad9a9d99b7dccd51ba9486aec8f1b9670'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--expected-metadata-sha256', required=True)
    parser.add_argument('--cpu-slot-released', action='store_true')
    args = parser.parse_args()
    if not args.cpu_slot_released:
        raise ValueError('Coordinator must release the bounded measurement CPU slot')
    if args.output.exists():
        raise ValueError('Preserve prior measured support receipt')
    if sha(TARGET) != TARGET_SHA or sha(META) != args.expected_metadata_sha256:
        raise ValueError('Captured art or registration bytes changed')
    clip = json.loads(META.read_text())['animations']['captured']
    if (clip['frameWidth'] != 512 or clip['frameHeight'] != 512 or clip['root'] != [256, 416] or
            abs(clip['scaleToWorld'] - 7 / 15) > 1e-12 or clip['columns'] != 5 or
            clip['rows'] != 1 or clip['loopDuration'] != 60):
        raise ValueError('Unexpected ordinary-held captured registration/loop contract')
    from PIL import Image
    image = Image.open(TARGET).convert('RGBA')
    if image.size != (2560, 512):
        raise ValueError('Captured atlas cell layout changed')
    records = []
    for art in range(4):
        cell = image.crop((art * 512, 0, (art + 1) * 512, 512))
        visible = cell.getchannel('A').point(lambda a: 255 if a >= 32 else 0)
        bbox = visible.getbbox()
        if not bbox:
            raise ValueError('Held art sample has no actual alpha32 body')
        last = bbox[3] - 1
        records.append({'artFrameIndex': art, 'alpha32BBoxExclusive': list(bbox),
            'bottomPixelRow': last, 'rootRelativeBottomPixelCentreY': (last + .5 - 416) * 7 / 15,
            'actorCentreRelativeBottomPixelCentreY': 25 + (last + .5 - 416) * 7 / 15,
            'actorCentreRelativeConservativeBottomPixelEdgeY': 25 + (last + 1 - 416) * 7 / 15,
            'nativeReceivingParity': False})
    result = {'state': 'ACTUAL_ALPHA32_SUPPORT_MEASUREMENT_REVIEW_PENDING',
        'target': {'path': str(TARGET.relative_to(ROOT)), 'sha256': TARGET_SHA},
        'metadata': {'path': str(META.relative_to(ROOT)), 'sha256': args.expected_metadata_sha256},
        'root': [256, 416], 'scaleToWorld': 7 / 15, 'bodyCentreFromRootY': -25,
        'heldLoopArtIndices': [0, 1, 2, 3], 'endpointArt4': 'outside ordinary-held loop; not silently included',
        'samples': records,
        'globalMeasuredPixelCentreBottom': max(r['actorCentreRelativeBottomPixelCentreY'] for r in records),
        'globalConservativePixelEdgeBottom': max(r['actorCentreRelativeConservativeBottomPixelEdgeY'] for r in records),
        'limits': ['Actual sprite alpha support measurement only; not native receiving or joint constraints.',
                   'Global pixel-edge envelope requires explicit review before supportingFloor candidate transport.',
                   'Solver stage correction/residual and visible grip remain separate runtime gates.'],
        'pixelsChanged': False, 'runtimeCalibrationChanged': False}
    args.output.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({'path': str(args.output), 'sha256': sha(args.output)}))


if __name__ == '__main__':
    main()
