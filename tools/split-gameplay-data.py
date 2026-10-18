#!/usr/bin/env python3
"""split-gameplay-data.py [fighter ...] — move the simulation's data out of a fighter's frames.json.

assets/characters/<id>/frames.json describes the legacy sprite sheets (image layout, registration,
art provenance) and is deleted with the legacy display (Phase 6 step 5). Everything the simulation
reads goes to assets/characters/<id>/gameplay.json, keyed by the same clip (motion) names:

- per clip: the pose track (drawing count and the action-age clock that selects a drawing) and
  the shapes and points paired with each drawing (receiving, outgoing, catch, capture grip, held
  item grip, Final attachments, root motion), plus the provenance of those values;
- top level: `runtimeFinalVictimProfiles` (Final victim poses, keyed by profile and authored age).

Run it after any pipeline step that writes frames.json (tools/fighter-pack.py, link-build-final.py,
derive_item_sockets.py ...): fields found in frames.json replace the same fields in gameplay.json.
A second run changes nothing. Values are copied verbatim; the merged files are checked against the
input before anything is written. Field lists: docs/review/2026-10-19/phase6/gameplay-data.md.
"""
import json, sys

FIGHTERS = ['donkeykong', 'link', 'pikachu']
# Per-clip fields the simulation reads, or that record where those values came from.
GAMEPLAY_FIELDS = {
    # Pose track: drawing count and clock (artFrameIndex is the pose index; the legacy sheet's cell i draws pose i).
    'frameCount', 'nativeSampleIndices', 'actionFrameStarts', 'loopDuration', 'frameWindows', 'pairedActionTimeline',
    'sourceSampleBasis', 'coordinateOrigin', 'sourceDrawingCount',
    # Body geometry paired with each pose.
    'bodyCentreFromRootY', 'hurtboxPoses', 'attackCollisionPoses', 'attackCollisionPosesByRole', 'catchCollisionPoses',
    'captureGripPoses', 'itemAttachmentPoses', 'sourceAttachmentPoses', 'sourceRootDelta',
    # Provenance of the above.
    'receivingProvenance', 'collisionProvenance', 'itemAttachmentProvenance', 'sourceProvenance', 'sourceGeometryAdapters',
    'sourceCatchReceipt', 'sourceCatchReceiptSha256', 'staticReceivingAcceptanceReceipt', 'staticReceivingAcceptanceSha256',
    'captureClockCalibration', 'bodyReviewKey', 'runtimeClock',
    'nativeWindows', 'holdRule', 'specialPhase', 'specialClockKind', 'dynamicCutoff', 'playableEndExclusive',
    'runtimeBindingStatus', 'drawingFacingBinding',
}
# Per-clip fields that stay in frames.json: sheet image and registration, Final FX anchors, art provenance.
DISPLAY_FIELDS = {
    'strip', 'sha256', 'frameWidth', 'frameHeight', 'atlas', 'trims', 'columns', 'rows', 'root', 'scaleToWorld',
    'sourceEffectPointPoses', 'sourceRenderPoses', 'artProvenance', 'artStatus', 'sourceTargetImage', 'sourceTargetSha256',
    'floorRegistrationProvenance', 'postPackPoseTranslations', 'packingMetadata', 'packingMetadataSha256',
    'atlasRepack', 'coordinateAdapter',
}
GAMEPLAY_TOP = {'runtimeFinalVictimProfiles'}
DISPLAY_TOP = {'meta', 'animations', 'runtimeFinalFxProfiles', 'articles'}


def load(path, default=None):
    try:
        with open(path, encoding='utf8') as f:
            return json.load(f)
    except FileNotFoundError:
        return default


def write(path, value):
    # Same layout as the pipeline writers (indent 2, ASCII, trailing newline), so untouched values keep their text.
    with open(path, 'w', encoding='utf8') as f:
        f.write(json.dumps(value, indent=2, ensure_ascii=True) + '\n')


def merged(frames, gameplay):
    """One clip view as the simulation and the display saw it before the split."""
    clips = {}
    for name in sorted(set(frames['animations']) | set(gameplay['animations'])):
        clips[name] = {**gameplay['animations'].get(name, {}), **frames['animations'].get(name, {})}
    top = {k: v for k, v in gameplay.items() if k in GAMEPLAY_TOP}
    top.update({k: v for k, v in frames.items() if k != 'animations'})
    return {**top, 'animations': clips}


def split(fighter):
    root = f'assets/characters/{fighter}'
    frames = load(f'{root}/frames.json')
    gameplay = load(f'{root}/gameplay.json', {'schema': 'fighter-gameplay/1', 'fighter': fighter, 'animations': {}})
    before = merged(frames, gameplay)
    unknown = sorted({k for clip in frames['animations'].values() for k in clip} - GAMEPLAY_FIELDS - DISPLAY_FIELDS)
    unknown_top = sorted(set(frames) - GAMEPLAY_TOP - DISPLAY_TOP)
    if unknown or unknown_top:
        sys.exit(f'{fighter}: classify these frames.json fields first: {unknown + unknown_top}')
    display = {k: {} if k == 'animations' else v for k, v in frames.items() if k not in GAMEPLAY_TOP}
    clips = dict(gameplay['animations'])
    for name, clip in frames['animations'].items():
        kept = {k: v for k, v in clip.items() if k in GAMEPLAY_FIELDS}
        clips[name] = {**{k: v for k, v in clips.get(name, {}).items() if k not in kept}, **kept}
        display['animations'][name] = {k: v for k, v in clip.items() if k in DISPLAY_FIELDS}
    out = {'schema': 'fighter-gameplay/1', 'fighter': fighter,
           'note': 'Simulation pose tracks and body geometry, split from frames.json by tools/split-gameplay-data.py.',
           'animations': {name: clips[name] for name in display['animations']}}
    for key in GAMEPLAY_TOP:
        if key in frames:
            out[key] = frames[key]
        elif key in gameplay:
            out[key] = gameplay[key]
    extra = sorted(set(clips) - set(display['animations']))
    if extra:
        sys.exit(f'{fighter}: gameplay.json has clips that frames.json lacks: {extra}')
    if merged(display, out) != before:
        sys.exit(f'{fighter}: the split would change a value; nothing written')
    write(f'{root}/frames.json', display)
    write(f'{root}/gameplay.json', out)
    moved = sum(len([k for k in c if k in GAMEPLAY_FIELDS]) for c in frames['animations'].values())
    print(f'[split-gameplay-data] {fighter}: {len(out["animations"])} clips, {moved} clip fields moved')


if __name__ == '__main__':
    for fighter in sys.argv[1:] or FIGHTERS:
        split(fighter)
