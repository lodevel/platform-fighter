"""Retain inspected native roll/backward/crouch orientation without inferring LR."""
import json
from pikachu_native_pose import ROOT, MOTIONS, PikachuNativePose, sha

base = ROOT / 'docs/review/2026-10-06/pikachu-character/sources/full-body-native-review'
observed = {
    'roll-forward': ['right', 'right-down/front', 'front-inverted', 'left', 'left', 'left'],
    'roll-back': ['right', 'left-up/inverted', 'front-down/inverted', 'right', 'right', 'right'],
    'jump-backward': ['right-up', 'right-up', 'left-down/inverted', 'right-down', 'right'],
    'air-jump-backward': ['right-down', 'left-up/inverted', 'right-down/inverted', 'left-down/inverted', 'right-down'],
    'crouch-start': ['right', 'right', 'right'],
    'crouch-hold': ['right', 'right', 'right', 'right', 'right'],
    'crouch-end': ['right', 'right', 'right'],
    'crawl-backward': ['right', 'right', 'right', 'right', 'right'],
}
rows, inputs = [], []
for family in ['defense', 'locomotion']:
    path = base / family / 'preparation.json'
    prepared = json.loads(path.read_text())
    if prepared['state'] not in ['native_authoring_inputs_visually_reviewed', 'generation_inputs_visually_reviewed']:
        raise ValueError('Source inputs require actual visual inspection')
    inputs.append({'path': str(path.relative_to(ROOT)), 'sha256': sha(path)})
    for action, directions in observed.items():
        selected = [r for r in prepared['records'] if r['action'] == action]
        if not selected:
            continue
        if len(selected) != len(directions):
            raise ValueError('Changed inspected sample order')
        pose = PikachuNativePose(MOTIONS / (selected[0]['motion'] + '.nuanmb'))
        samples = []
        for frame in range(int(pose.animation.final_frame_index) + 1):
            matrices = pose.matrices(frame, ['Trans', 'Rot', 'Head'])
            samples.append({'nativeSample': frame,
                'matrices': {n: m.tolist() for n, m in matrices.items()},
                'headForwardProjection': {'x': float(matrices['Head'][2, 2]),
                                          'y': float(-matrices['Head'][1, 2])}})
        rows.append({'action': action, 'provenance': pose.provenance(),
            'observedDrawings': [{'sourceKey': r['key'], 'nativeSample': r['native_sample_index'],
                'drawingFacing': direction, 'nativeFacing': direction,
                'sourceReferenceSha256': r['source_sha256']} for r, direction in zip(selected, directions)],
            'allNativeOrientationSamples': samples,
            'engineLRChangeNativeFrame': None,
            'interpretation': 'Forward roll settles opposite the entry facing; backward roll/jumps rotate transiently but settle in the original facing. Crouch/backward crawl drawings retain original facing.'})
galleries = [base / 'locomotion' / f'body-facing-source-review-{n}.png' for n in [1, 2]]
target = base / 'locomotion/body-facing-source-contract.json'
target.write_text(json.dumps({'state': 'actual source drawing orientation reviewed; engine LR boundary remains independently unresolved',
    'inputs': inputs, 'camera': 'negative native x; screen x=native z, y=-native y; Trans removed',
    'actualGalleries': [{'path': str(p.relative_to(ROOT)), 'sha256': sha(p)} for p in galleries],
    'motions': rows, 'limits': ['Inverted head direction is anatomy motion, not an instruction to flip a sheet.',
        'A latched entry-facing basis can preserve baked forward-roll turn under an explicit shared-runtime adaptation.',
        'Matrix diagnostics and sparse drawings do not prove engine posture LR timing.']}, indent=2) + '\n')
print(target.relative_to(ROOT))
