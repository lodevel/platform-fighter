"""Retain native Quick warp Rot pivot/ancestry; no runtime rotation guesses."""
import json
import numpy as np
from pikachu_native_pose import ROOT, MOTIONS, PikachuNativePose, sha

E = ROOT / 'docs/review/2026-10-06/pikachu-character'
prep = E / 'sources/full-body-native-review/specials/preparation.json'
caps_path = E / 'sources/native-hurtbox-capsules.json'
caps = json.loads(caps_path.read_text())['capsules']
pose = PikachuNativePose(MOTIONS / 'd02specialairhi.nuanmb')
nodes = list(dict.fromkeys(c['bone']['label'] for c in caps))
rot_index = pose.bones['rot']

def ancestry(name):
    index = pose.bones[name.lower()]
    chain = []
    while index is not None:
        bone = pose.skeleton.bones[index]
        chain.append(bone.name)
        index = bone.parent_index
    return chain

chains = {n: ancestry(n) for n in nodes}
assert all('Rot' in chain for chain in chains.values())
samples = []
for frame in range(int(pose.animation.final_frame_index) + 1):
    matrices = pose.matrices(frame, ['Trans', 'Rot', *nodes])
    trans = matrices['Trans'][:3, 3]
    pivot = matrices['Rot'][:3, 3] - trans
    samples.append({'nativeFrame': frame,
        'transWorld': trans.tolist(), 'rotWorldMatrix': matrices['Rot'].tolist(),
        'rootRemovedNativePivot': pivot.tolist(),
        'projectedBodyRelativePivot': {'x': float(5*pivot[2]), 'y': float(25-5*pivot[1])}})
assert len(samples) == 6
assert all(np.array_equal(samples[0]['rotWorldMatrix'], s['rotWorldMatrix']) for s in samples)
assert all(np.array_equal(s['transWorld'], [0, 0, 0]) for s in samples)
assert np.array_equal(np.asarray(samples[0]['rotWorldMatrix'])[:3, :3], np.eye(3))
other_bones = [b.name for b in pose.skeleton.bones if 'Rot' not in ancestry(b.name)]
out = {'state': 'guarded native warp pivot and ancestry; runtime direction consumer pending',
    'source': pose.provenance(),
    'exporter': {'path': str(ROOT/'tools/pikachu-quick-rotation-pivot-prepare.py'),
                 'sha256': sha(ROOT/'tools/pikachu-quick-rotation-pivot-prepare.py')},
    'nativeEvaluatorSha256': sha(ROOT/'tools/pikachu_native_pose.py'),
    'preparationSha256': sha(prep), 'capsulesSourceSha256': sha(caps_path),
    'preparedNativeOrder': [r['native_sample_index'] for r in json.loads(prep.read_text())['records']
                            if r['action'] == 'quick-attack-dash'],
    'projection': 'x=5*nativeZ; y=25-5*nativeY; remove Trans; body-centre-relative world pixels',
    'capsuleNodeAncestry': chains, 'all12CapsuleNodesDescendRot': True,
    'skeletonBonesOutsideRotSubtree': other_bones,
    'samples': samples,
    'conclusion': 'Native Rot is identity basis with constant pivot. A planar rotation of projected descendants around the declared projected pivot preserves the native Y/Z projection of an X-axis rotation. This is geometry equivalence only, not proof of native status direction or rotation timing.',
    'limits': ['Sample5 is source closure outside playable local0..5.',
               'Actual sprite, capsule and contact pivot agreement requires a real match probe.',
               'Native helper constraint/status direction consumer and 3D camera behavior remain separate qualifications.']}
dest = E / 'sources/full-body-native-review/specials/quick-warp-rotation-pivot-review.json'
dest.write_text(json.dumps(out, indent=2)+'\n')
print(json.dumps({'path': str(dest.relative_to(ROOT)), 'sha256': sha(dest),
    'samples': len(samples), 'pivot': samples[0]['projectedBodyRelativePivot'],
    'outsideRotSubtree': other_bones}))
