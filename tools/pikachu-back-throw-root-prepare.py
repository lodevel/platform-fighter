"""Retain exact guarded native back-throw Trans trajectory, without retiming it."""
import json
from pathlib import Path
from pikachu_native_pose import ROOT, MOTIONS, PikachuNativePose, sha

E = ROOT / 'docs/review/2026-10-06/pikachu-character'
pose = PikachuNativePose(MOTIONS / 'e01throwb.nuanmb')
rows = []
for frame in range(66):
    matrices = pose.matrices(frame, ['Trans'])
    trans = matrices['Trans'][:3, 3]
    rows.append({'nativeFrame': frame, 'translationNative': trans.tolist(),
        'worldDisplacementInEntryFacingBasis': {'x': float(5 * trans[2]), 'y': float(-5 * trans[1])}})

prepared = E / 'sources/full-body-native-review/capture/preparation.json'
samples = [r for r in json.loads(prepared.read_text())['records'] if r['action'] == 'back-throw']
for sample in samples:
    meta = ROOT / sample['native_reference_metadata']
    if sha(meta) != sample['native_reference_metadata_sha256']:
        raise ValueError('Changed retained root capture')
    if rows[sample['native_sample_index']]['translationNative'] != sample['captured_trans_translation']:
        raise ValueError('Retained root capture differs from guarded evaluator')

out = {'state': 'exact native trajectory retained; native status/kinetic application unqualified',
    'provenance': pose.provenance(), 'exporter': str(Path(__file__).resolve().relative_to(ROOT)),
    'exporterSha256': sha(Path(__file__)), 'preparation': str(prepared.relative_to(ROOT)),
    'preparationSha256': sha(prepared),
    'projection': 'Native Trans world matrix column3. Entry-facing-right world displacement x=5*nativeZ, y=-5*nativeY; opposite entry facing negates x only.',
    'directionBasis': 'Latched actor entry facing. Shared backthrow release-facing flip must not retroactively reverse trajectory samples.',
    'referenceOrigin': 'Absolute sampled native displacement, not per-step velocity. Native0 small nonzero offset retained; any runtime subtraction of sample0 must be explicit.',
    'rows': rows, 'currentlyPlayableSourceRange': {'startNativeInclusive': 0, 'endNativeExclusive': 49},
    'clock': {'nativeSamples': 'integer native motion indices; all samples direct, no interpolation',
        'gameplayNativeRate': None, 'statusKineticTranslationConsumer': None,
        'currentBetaBodyPresentation': 'one native sample per eligible fixed step, selected commitment49; not proof of native status rate'},
    'limits': ['Native animation data alone does not prove how game status/kinetic motion applies Trans.',
        'Source native LR-change boundary unresolved; entry basis must be qualified in runtime.',
        'Fixedroot reviewed body/capsule art stays unchanged. Runtime actor motion must be implemented separately after qualification.',
        'All66 frames retained through65; 49..65 postcommitment source data remain excluded from current action.']}
target = E / 'sources/full-body-native-review/capture/back-throw-exact-root-trajectory.json'
target.write_text(json.dumps(out, indent=2) + '\n')
print(json.dumps({'path': str(target.relative_to(ROOT)), 'nativeSamples': len(rows), 'sha256': sha(target)}))
