"""Cross-check the reference matrix evaluator against the independent parser."""
import datetime
import json
import numpy as np
from pikachu_native_pose import PikachuNativePose, MOTIONS, ROOT, rotation_matrix, sha

pose = PikachuNativePose(MOTIONS / 'c05attackairf.nuanmb')
names = [b.name for b in pose.skeleton.bones if not b.name.startswith('H_')]
matrices = pose.matrices(0, names, bind_pose=True)
differences = []
for name, matrix in matrices.items():
    bone = pose.skeleton.bones[pose.bones[name.lower()]]
    independent = np.asarray(pose.skeleton.calculate_world_transform(bone)).T
    differences.append(float(np.max(np.abs(independent - matrix))))
assert max(differences) < 2e-6, 'World transform disagrees with ssbh_data_py'
quarter_turn = rotation_matrix([0, 0, np.sqrt(.5), np.sqrt(.5)]) @ np.array([1, 0, 0])
assert np.allclose(quarter_turn, [0, 1, 0], atol=1e-12)
for sample in [-1, 54, .5, True]:
    try:
        pose.matrices(sample, ['Hip'])
    except ValueError:
        pass
    else:
        raise AssertionError('Invalid native sample was accepted')
try:
    pose.matrices(0, ['H_Neck'])
except ValueError:
    pass
else:
    raise AssertionError('Unreviewed helper constraint was accepted')
result = {
    'checked_at_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'command': 'python3 tools/pikachu-native-pose-verify.py',
    'evaluator_sha256': sha(ROOT / 'tools/pikachu_native_pose.py'),
    'provenance': pose.provenance(),
    'bind_pose_bones_cross_checked': len(differences),
    'maximum_absolute_matrix_difference': max(differences),
    'tolerance': 2e-6,
    'quarter_turn_rotation': 'passed', 'invalid_sample_guards': 'passed',
    'helper_constraint_guard': 'passed',
    'limits': 'Independent bind-pose and algebra checks; not gameplay/posed source parity or runtime acceptance',
}
destination = ROOT / 'docs/review/2026-10-06/pikachu-character/sources/posed-resources/evaluator-checks.json'
destination.write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({k: v for k, v in result.items() if k != 'provenance'}))
