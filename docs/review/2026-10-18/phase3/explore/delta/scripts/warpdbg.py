import sys, numpy as np, torch, torch.nn.functional as F
from PIL import Image
sys.path.insert(0, '.')
from common import Package
import patch_reuse as P, warp as Wm
f, a, i, j, g = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5])
pk = Package(f); ids = pk.action_drawings(a); fr = P.action_frame(pk, ids, 16, 0)
K = P.load_canvas(pk, ids[i], fr); N = P.load_canvas(pk, ids[j], fr)
disp, Wp = Wm.fit(K, N, g)
def im(X): return Wm.comp(X).clamp(0, 1).permute(1, 2, 0).cpu().numpy()
def heat(A, B): return ((A - B).abs().amax(0) * 4).clamp(0, 1)[..., None].repeat(1, 1, 3).cpu().numpy()
row = np.concatenate([im(K), im(N), im(Wp), heat(K, N), heat(Wp, N)], 1)
Image.fromarray((row * 255).astype(np.uint8)).save(f'dbg-{f}-{a}-{i}-{j}-g{g}.png')
for tol in P.TOLS:
    ne = F.max_pool2d(N[3:4][None], 16)[0, 0] > 1/255
    print(tol, 'warp ok', int((Wm.tile_ok(N, Wp, P.TOLS[tol]) & ne).sum()), 'plain ok', int((Wm.tile_ok(N, K, P.TOLS[tol]) & ne).sum()), 'of', int(ne.sum()))
print('mean abs plain', float((K - N).abs().mean()), 'warp', float((Wp - N).abs().mean()), 'disp range', float(disp.min()), float(disp.max()))
for zz in (0.4667*1.4, 0.4667*2.8):
    print('match z=%.2f' % zz, 'warp ok', int((Wm.tile_ok_match(N, Wp, zz) & ne).sum()), 'plain ok', int((Wm.tile_ok_match(N, K, zz) & ne).sum()))
