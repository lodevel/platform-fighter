"""Own dash-grab source-guide preflight; native raster requires explicit grant.

Standard-library preflight never imports/evaluates a native model or draws an
image. Existing accepted native11 and standing artifacts cannot be rerendered.
"""
from pathlib import Path
import argparse
import hashlib
import json
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
ART = ROOT / 'docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/art'
PLAN = ART / 'full-dash-grab-next-action-source-drawing-plan-01.json'
SOURCE_REVIEW = ART / 'full-dash-grab-nine-new-source-pose-actual-review-01.json'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def pin(path):
    return {'path': str(path.relative_to(ROOT)), 'sha256': sha(path)}


def verify(ref):
    path = ROOT / ref['path']
    if sha(path) != ref['sha256']:
        raise ValueError(f'Changed pinned own dash source: {path}')
    return path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--batch', required=True)
    parser.add_argument('--source-raster-slot-released', action='store_true')
    args = parser.parse_args()
    plan = json.loads(PLAN.read_text())
    review = json.loads(SOURCE_REVIEW.read_text())
    if review['sourceDrawingPlan'] != pin(PLAN):
        raise ValueError('Actual own-source observations must bind this plan')
    clip = plan['clip']
    if clip['sheet'] != 'dash_grab':
        raise ValueError('Dedicated dash tool cannot consume another clip')
    batch = next(b for b in plan['nextSourceBatches'] if b['batch'] == args.batch)
    if not 1 <= len(batch['poses']) <= 2:
        raise ValueError('Only one/two sequential new source poses per batch')
    renderer = ROOT / 'tools/dk-native-guide.py'
    rows = []
    for selected in batch['poses']:
        pose = next(p for p in clip['poses'] if p['nativeSample'] == selected['nativeSample'])
        observed = next(r for r in review['rows'] if r['nativeSample'] == pose['nativeSample'])
        if (selected['clip'] != 'dash_grab' or pose['nativeSample'] == 11 or
                pose['targetArtStatus'] != 'requires_new_generation' or
                not observed['actualNativeResolutionSourceImageViewed'] or
                observed['sourceImage'] != pose['sourceImage'] or
                pose['nativeSample'] != pose['gameplayAge'] + 1):
            raise ValueError('Each new guide requires its own reviewed source pose')
        for ref in [clip['motionResource'], pose['sourceImage'], *clip['sourceRecords']]:
            verify(ref)
        dest = ART / pose['guidePrefix']
        if any(Path(str(dest) + suffix).exists() for suffix in
               ['.json', '-reference.png', '-palette-seed.png', '-mask.png', '-guide.png']):
            raise ValueError('Preserve existing source artifacts; no automatic reraster')
        command = [sys.executable, str(renderer), Path(clip['motionResource']['path']).stem,
                   str(pose['nativeSample']), str(dest), '--width', '1536', '--height', '1024',
                   '--root-x', '512', '--root-y', '832', '--view-side', 'negative',
                   '--root-registration', 'remove-trans-translation']
        native_pin = None
        if args.source_raster_slot_released:
            subprocess.run(command, cwd=ROOT, check=True)
            metadata = Path(str(dest) + '.json')
            native = json.loads(metadata.read_text())
            if (native['root'] != [512, 832] or native['canvas'] != [1536, 1024] or
                    native['motion'] != {k: clip['motionResource'][k] for k in ['path', 'sha256']} or
                    native['native_sample_index'] != pose['nativeSample']):
                raise ValueError('Native guide must retain exact own motion/sample/root')
            for filename, digest in native['output_files'].items():
                if sha(ART / filename) != digest:
                    raise ValueError('Native guide output integrity failure')
            native_pin = pin(metadata)
        rows.append({'clip': 'dash_grab', 'nativeSample': pose['nativeSample'],
                     'gameplayAge': pose['gameplayAge'], 'artFrameIndex': pose['artFrameIndex'],
                     'sourceImageIndex': pose['sourceImageIndex'], 'sourceImage': pose['sourceImage'],
                     'frameWindow': pose['proposedFrameWindow'], 'command': command,
                     'expectedMetadataPath': str(Path(str(dest) + '.json').relative_to(ROOT)),
                     'nativeGuide': native_pin, 'measuredSupport': None,
                     'actualNewGuideVisualReview': 'pending', 'authoredFeatureDomains': None,
                     'targetHandROIs': None, 'ownSourceOcclusionGates': observed['uncertainty']})
    result = {'state': 'OWN_DASH_SOURCE_PREFLIGHT' if not args.source_raster_slot_released else
              'OWN_DASH_NATIVE_GUIDES_WRITTEN_ACTUAL_REVIEW_PENDING',
              'batch': args.batch, 'plan': pin(PLAN), 'actualSourceReview': pin(SOURCE_REVIEW),
              'renderer': pin(renderer), 'tool': pin(Path(__file__)), 'rows': rows,
              'nativeRasterExecuted': args.source_raster_slot_released, 'GPUUsed': False,
              'targetInputAssembled': False, 'canonicalChanged': False}
    if args.source_raster_slot_released:
        receipt = ART / f'full-dash-{args.batch}-own-source-guide-preparation.json'
        if receipt.exists():
            raise ValueError('Preserve source receipt')
        receipt.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
