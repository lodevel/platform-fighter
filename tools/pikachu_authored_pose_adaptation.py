"""Apply only hash-bound, explicitly authored target receiving adaptations.

The native evaluator stays unchanged. A reviewed pack can opt into a local
tail-subtree transform; source body/root/clock and all other regions remain
native. This does not qualify new geometry without actual output review.
"""
import json
import numpy as np
from pikachu_native_pose import ROOT, sha


def apply_authored_receiving_adaptation(matrices, source, motion, native_sample):
    adaptation = source.get('authoredGeometryAdaptation')
    if not adaptation:
        return matrices, None
    preparation = ROOT / adaptation['sourcePreparation']
    if sha(preparation) != adaptation['sourcePreparationSha256']:
        raise ValueError('Authored pose preparation changed')
    record = next(r for r in json.loads(preparation.read_text())['records']
                  if r['key'] == adaptation['sourceKey'])
    if record['motion'] != motion or record['native_sample_index'] != native_sample:
        raise ValueError('Authored pose source clock/resource mismatch')
    if sha(ROOT / record['source_path']) != record['source_sha256']:
        raise ValueError('Reviewed authored source guide changed')
    case = record['retargetCase']
    delta = np.asarray(adaptation['tailWorldDelta'], dtype=float)
    if delta.shape != (4, 4) or not np.isfinite(delta).all():
        raise ValueError('Invalid authored tail transform')
    if not np.allclose(delta, case['deltaWorldMatrix'], atol=1e-12):
        raise ValueError('Pack differs from reviewed authored transform')
    if not np.allclose(delta[3], [0, 0, 0, 1], atol=1e-12):
        raise ValueError('Authored transform must be affine')
    if not np.allclose(delta[:3, :3].T @ delta[:3, :3], np.eye(3), atol=1e-8):
        raise ValueError('Receiving adaptation must preserve source lengths/scale')
    pivot = np.asarray(case['attachmentNative'], dtype=float)
    if not np.allclose((delta @ np.r_[pivot, 1])[:3], pivot, atol=1e-8):
        raise ValueError('Authored tail attachment/root changed')
    tail = {n.lower() for n in case['tailDescendants']}
    if tail != {'tail1', 'tail2', 'tail3', 'tail4'}:
        raise ValueError('Unexpected authored subtree')
    result = {n: delta @ m if n.lower() in tail else m.copy()
              for n, m in matrices.items()}
    if not np.array_equal(result['Trans'], matrices['Trans']):
        raise ValueError('Authored receiving cannot alter actor Trans')
    return result, adaptation
