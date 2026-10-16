"""Guard retained reaction/ledge Trans samples without granting a runtime clock."""
import json
from pathlib import Path
from pikachu_native_pose import ROOT, PikachuNativePose, sha

E = ROOT / 'docs/review/2026-10-06/pikachu-character'
rows = []
evaluators = {}
preparations = []
for family in ['reactions-misc', 'ledge-getup']:
    prep = E / 'sources/full-body-native-review' / family / 'preparation.json'
    preparations.append({'path': str(prep.relative_to(ROOT)), 'sha256': sha(prep)})
    for record in json.loads(prep.read_text())['records']:
        metadata = ROOT / record['native_reference_metadata']
        if sha(metadata) != record['native_reference_metadata_sha256']:
            raise ValueError('Changed retained source metadata')
        source_record = json.loads(metadata.read_text())['motion']
        source = ROOT / source_record['path']
        if sha(source) != source_record['sha256']:
            raise ValueError('Changed native resource')
        key = str(source)
        if key not in evaluators:
            evaluators[key] = PikachuNativePose(source)
        pose = evaluators[key]
        trans = pose.matrices(record['native_sample_index'], ['Trans'])['Trans'][:3, 3].tolist()
        if trans != record['captured_trans_translation']:
            raise ValueError('Retained source translation differs from guarded evaluator')
        rows.append({'family': family, 'action': record['action'], 'key': record['key'],
            'nativeSample': record['native_sample_index'], 'nativeFinalFrame': record['native_final_frame_index'],
            'translationNative': trans, 'displacementInSourceFacingBasis': {'x': 5 * trans[2], 'y': -5 * trans[1]},
            'source': source_record['path'], 'sourceSha256': source_record['sha256'],
            'sourceMetadata': record['native_reference_metadata'], 'sourceMetadataSha256': sha(metadata)})

out = {'state': 'guarded sparse native root samples retained; status/kinetic movement unqualified',
    'exporter': str(Path(__file__).resolve().relative_to(ROOT)), 'exporterSha256': sha(Path(__file__)),
    'preparations': preparations, 'evaluators': [pose.provenance() for pose in evaluators.values()],
    'projection': 'Direct native Trans world column3, x=5*nativeZ, y=-5*nativeY. These are absolute source offsets, not velocities or elapsed gameplay clocks.',
    'coordinateContract': 'Fixed-root art and receiving subtract Trans. Actor movement, native entry origin and facing basis require separate sourced status/kinetic consumers.',
    'rows': rows,
    'limits': ['Only retained selected native samples are exported; no interpolation or full-trajectory claim.',
        'Clip indices and source offsets do not prove gameplay rate, status transitions, kinetic application or shared attachment.',
        'Runtime stage/ledge placement and protection stay separate from image root registration.',
        'Current beta shared actor behavior may differ from source root trajectory; no sprite recentering or shrinking is authorized by this audit.']}
target = E / 'sources/full-body-native-review/remaining-root-motion-review.json'
target.write_text(json.dumps(out, indent=2) + '\n')
print(json.dumps({'path': str(target.relative_to(ROOT)), 'guardedSamples': len(rows), 'motions': len(evaluators), 'sha256': sha(target)}))
