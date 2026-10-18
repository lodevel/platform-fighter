"""Joint safety: share of a disc around each child pivot that the child covers (alpha>0.5), for discs of the
parent's limb half-width at that joint. 1.0 = rotating the child can never open a gap there (a disc is rotation
invariant). usage: python joints.py PARTS_DIR"""
import json, sys
import numpy as np
import rig
spec, imgs = rig.load(sys.argv[1])
P = spec['parts']; out = {}
for n, p in P.items():
    if not p['parent'] or n == 'tie' or n.startswith('head'):
        continue
    par = P[p['parent']]
    r = par['capRadius'].get(p['parentJoint']) or p['capRadius'].get('pivot')
    a = np.asarray(imgs[n])[..., 3] > 127
    yy, xx = np.mgrid[:a.shape[0], :a.shape[1]]
    res = {}
    for f in (0.6, 0.8):
        d = (xx - p['pivot'][0]) ** 2 + (yy - p['pivot'][1]) ** 2 <= (f * r) ** 2
        res[f'r{int(f*100)}'] = round(float(a[d].mean()), 3)
    res['radius_px'] = round(r, 1)
    out[n] = res
print(json.dumps(out, indent=0))
json.dump(out, open(sys.argv[1] + '/joint-coverage.json', 'w'), indent=1)
