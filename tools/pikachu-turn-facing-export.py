"""Preserve native turn drawing orientation; never infer gameplay LR transition."""
import json
from pikachu_native_pose import ROOT, MOTIONS, PikachuNativePose, sha

base = ROOT / 'docs/review/2026-10-06/pikachu-character/sources/full-body-native-review/locomotion'
prepared = json.loads((base / 'preparation.json').read_text())
if prepared['state'] != 'native_authoring_inputs_visually_reviewed':
    raise ValueError('Actual source input inspection is required')
observed = {
    'dash-turn': {0: 'right', 8: 'left', 16: 'left', 24: 'left', 32: 'left'},
    'run-turn': {0: 'right', 5: 'front-left-transition', 10: 'left', 15: 'left', 19: 'left'},
}
motions = []
for action, orientations in observed.items():
    selected = [r for r in prepared['records'] if r['action'] == action]
    evaluator = PikachuNativePose(MOTIONS / (selected[0]['motion'] + '.nuanmb'))
    samples = []
    for frame in range(int(evaluator.animation.final_frame_index) + 1):
        matrices = evaluator.matrices(frame, ['Trans', 'Rot', 'Neck', 'Head'])
        samples.append({'nativeSample': frame,
                        'matrices': {n: m.tolist() for n, m in matrices.items()},
                        'projectedHeadLocalForwardZ': {
                            'x': float(matrices['Head'][2, 2]),
                            'y': float(-matrices['Head'][1, 2])}})
    windows = []
    for index, row in enumerate(selected):
        frame = row['native_sample_index']
        windows.append({'sourceKey': row['key'], 'sourceSample': frame,
                        'startNativeSample': frame,
                        'endNativeSampleExclusive': selected[index + 1]['native_sample_index']
                        if index + 1 < len(selected) else int(evaluator.animation.final_frame_index) + 1,
                        'drawingFacing': orientations[frame], 'nativeFacing': orientations[frame],
                        'nativeFacingDefinition': 'Actual screen orientation at negative-x capture camera; not engine posture LR',
                        'gameplayStart': None, 'gameplayEnd': None,
                        'sourceReferenceSha256': row['source_sha256'],
                        'sourceMetadataSha256': row['native_reference_metadata_sha256']})
    motions.append({'action': action, 'provenance': evaluator.provenance(),
                    'sourceFacingChangeEvidence': {
                        'firstObservedOppositeOrTransitionNativeSample': 8 if action == 'dash-turn' else 5,
                        'lastObservedOriginalNativeSample': 0,
                        'exactEngineLRChangeNativeFrame': None,
                        'state': 'Native drawing reviewed; status LR transition requires independent binding'},
                    'loopDuration': None,
                    'loopPolicy': 'Nonloop turn; source final frame is not a loop duration',
                    'sourceDrawingWindows': windows, 'allNativeOrientationSamples': samples})
target = base / 'turn-facing-source-contract.json'
target.write_text(json.dumps({
    'state': 'native turn drawing evidence reviewed; runtime facing binding pending',
    'preparationSha256': sha(base / 'preparation.json'),
    'visualReviewSha256': sha(base / 'visual-review.json'),
    'camera': 'negative native x; screen x=native z, screen y=-native y',
    'rootRegistration': 'remove Trans translation', 'motions': motions,
    'limits': ['Native drawing holds are not gameplay-clock windows',
               'Head localZ vector is diagnostic data, not an automatic flip rule',
               'Compare action-facing transition and cell orientation before runtime dispatch'],
}, indent=2) + '\n')
print(target.relative_to(ROOT))
