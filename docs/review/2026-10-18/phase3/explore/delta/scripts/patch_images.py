"""Side-by-side images of patch reuse at match size: original | reconstruction | error x4 | tile map
(grey = copied at same place, blue = copied at an offset, red = new tile)."""
import sys, json, numpy as np, torch, torch.nn.functional as F
from PIL import Image
sys.path.insert(0, '.')
import patch_reuse as P
from common import FINALS
OUT = '/home/lombet/Workspace/platform-fighter/docs/review/2026-10-18/phase3/explore/delta'
fighter, action, T, S, tol = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), sys.argv[5]
rows = int(sys.argv[6]) if len(sys.argv) > 6 else 4
samples = {}
with torch.no_grad():
    res = P.run(fighter, T, S, tol, False, sample_out=samples, sample_actions=(action,), only={action})
z = (2.8 if action in FINALS[fighter] else 1.4)
recs = samples[action]
from common import Package
scale = Package(fighter).pkg['drawings'][recs[0][0]]['scale']; z *= scale
def comp(X): return X[:3] + 0.5 * (1 - X[3:4])
def down(X): return F.interpolate(X[None], scale_factor=z, mode='bilinear', antialias=True)[0].clamp(0, 1)
def u8(X): return (X.permute(1, 2, 0).numpy() * 255).astype(np.uint8)
# pick drawings with the most reuse, spread over the action
idx = np.linspace(1, len(recs) - 1, min(rows, len(recs) - 1)).round().astype(int) if len(recs) > 1 else [0]
out = []
for i in idx:
    d, N, R, sid, st = recs[i]
    tm = comp(R).clone(); H, W = N.shape[1:]
    # tile classes: new tiles have sid in own range -> detect by equality N==R and tile id ordering is hard; recompute
    newmask = torch.zeros((H // T, W // T), dtype=torch.bool)
    diff = (N - R).abs().amax(0)
    ne = F.max_pool2d(N[3:4][None], T)[0, 0] > 1 / 255
    # a tile is "new" when its pixels come from storage tiles created for this drawing: sid >= first new id
    first_new = int(sid[sid >= 0].max()) - st['new'] + 1 if st['new'] else 1 << 60
    tsid = F.max_pool2d(sid[None, None].float(), T)[0, 0]
    newmask = ne & (tsid >= first_new)
    m = newmask.repeat_interleave(T, 0).repeat_interleave(T, 1)
    reused = (ne & ~newmask).repeat_interleave(T, 0).repeat_interleave(T, 1)
    tm[0][m] = tm[0][m] * 0.35 + 0.65; tm[1][m] *= 0.35; tm[2][m] *= 0.35
    tm[2][reused] = tm[2][reused] * 0.6 + 0.4
    heat = (diff * 4).clamp(0, 1)[None].repeat(3, 1, 1)
    panels = [down(comp(N)), down(comp(R)), down(heat), down(tm)]
    out.append(np.concatenate([np.pad(u8(p), ((2, 2), (2, 2), (0, 0)), constant_values=255) for p in panels], 1))
Image.fromarray(np.concatenate(out, 0)).save(f'{OUT}/patch-{fighter}-{action}-T{T}-S{S}-{tol}.png')
a = res['per_action'][action]
print(json.dumps(dict(action=action, drawings=a['drawings'], stored_vs_nonempty=a['stored_vs_nonempty'], err_final=res['err_final'], err_other=res['err_other'])))
