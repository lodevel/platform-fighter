"""Warp reuse prototype: drawing N ~ keyframe K deformed by a coarse mesh (piecewise-bilinear
displacement on a grid of `g` source px), fitted by gradient descent on premultiplied RGBA;
tiles the warp fails on are stored as residual tiles."""
import sys, json, math, time, argparse
import numpy as np, torch, torch.nn.functional as F
from PIL import Image
sys.path.insert(0, __import__('os').path.dirname(__file__))
from common import Package, FINALS
import patch_reuse as P

dev = __import__('os').environ.get('DEV', 'cuda')
T = 16

def warp(K, disp, H, W):
    """Backward warp: out(x) = K(x + d(x)); disp is (2, gh, gw) in pixels on the coarse grid."""
    d = F.interpolate(disp[None], size=(H, W), mode='bilinear', align_corners=True)[0]
    ys, xs = torch.meshgrid(torch.arange(H, device=dev, dtype=torch.float32), torch.arange(W, device=dev, dtype=torch.float32), indexing='ij')
    gx = (xs + d[0]) / (W - 1) * 2 - 1; gy = (ys + d[1]) / (H - 1) * 2 - 1
    return F.grid_sample(K[None], torch.stack([gx, gy], -1)[None], mode='bilinear', padding_mode='zeros', align_corners=True)[0]

def best_translation(K, N, S=24):
    """Integer translation minimising L1 at quarter resolution."""
    k = F.avg_pool2d(K[None], 4)[0]; n = F.avg_pool2d(N[None], 4)[0]
    s = S // 4; best = (1e9, 0, 0); kp = F.pad(k, (s, s, s, s)); h, w = n.shape[1:]
    for dy in range(-s, s + 1):
        for dx in range(-s, s + 1):
            e = float((kp[:, s + dy:s + dy + h, s + dx:s + dx + w] - n).abs().mean())
            if e < best[0]: best = (e, dx * 4, dy * 4)
    return best[1], best[2]

ITERS = int(__import__('os').environ.get('ITERS', '250'))
def fit(K, N, g, iters=None, smooth=0.02):
    iters = iters or ITERS
    _, H, W = N.shape
    gh, gw = math.ceil((H - 1) / g) + 1, math.ceil((W - 1) / g) + 1
    tx, ty = best_translation(K, N)
    disp = torch.zeros((2, gh, gw), device=dev); disp[0] = tx; disp[1] = ty
    disp.requires_grad_(True)
    opt = torch.optim.Adam([disp], lr=1.0)
    for blur in (8, 4, 2, 1):
        for it in range(iters):
            opt.zero_grad()
            Wp = warp(K, disp, H, W)
            if blur > 1:
                a = F.avg_pool2d(Wp[None], blur)[0]; b = F.avg_pool2d(N[None], blur)[0]
            else: a, b = Wp, N
            loss = (a - b).abs().mean() * 100
            lap = (disp[:, 1:-1, :] * 2 - disp[:, :-2, :] - disp[:, 2:, :]).pow(2).mean() + (disp[:, :, 1:-1] * 2 - disp[:, :, :-2] - disp[:, :, 2:]).pow(2).mean()
            (loss + smooth * lap).backward(); opt.step()
        for gp in opt.param_groups: gp['lr'] *= 0.5
    with torch.no_grad():
        return disp.detach(), warp(K, disp.detach(), H, W)

def tile_ok(N, R, tol):
    diff = (R - N).abs().amax(0, keepdim=True)[None]
    cov = ((R[3:4] > 0) | (N[3:4] > 0)).float()[None]
    mx = F.max_pool2d(diff, T)[0, 0]; mean = F.avg_pool2d(diff, T)[0, 0] / F.avg_pool2d(cov, T)[0, 0].clamp_min(1e-6)
    return (mx <= tol[1]) & (mean <= tol[0])

def comp(X, bg=0.5): return X[:3] + bg * (1 - X[3:4])

def to_img(X, z):
    Y = F.interpolate(comp(X)[None], scale_factor=z, mode='bilinear', antialias=True, align_corners=False)[0]
    return (Y.clamp(0, 1).permute(1, 2, 0).cpu().numpy() * 255).astype(np.uint8)

def run_action(fighter, aid, g, tolname, out_png=None, max_rows=6, limit=0):
    pk = Package(fighter); ids = pk.action_drawings(aid)
    if limit: ids = ids[:limit]
    frame = P.action_frame(pk, ids, T, 0); tol = P.TOLS.get(tolname)
    scale = pk.pkg['drawings'][ids[0]]['scale']
    is_final = aid in FINALS[fighter]; z = scale * (2.8 if is_final else 1.4)
    keys = []; tot = dict(nonempty=0, warp_ok=0, patch_ok=0, new=0, keyframes=0, verts=0); rows = []; errs = []
    for i, d in enumerate(ids):
        N = P.load_canvas(pk, d, frame)
        nonempty = F.max_pool2d(N[3:4][None], T)[0, 0] > 1 / 255
        ne = int(nonempty.sum())
        best = None
        for K in ([keys[0]] + keys[-2:] if len(keys) > 1 else keys)[:3]:
            disp, Wp = fit(K, N, g)
            ok = (tile_ok_match(N, Wp, z) if tolname == 'match' else tile_ok(N, Wp, tol)) & nonempty
            if best is None or int(ok.sum()) > int(best[2].sum()): best = (K, Wp, ok, disp)
        # aligned no-warp reuse from the same key for comparison (S=0 patch)
        if best is not None and int(best[2].sum()) >= 0.5 * ne:
            K, Wp, ok, disp = best
            new = nonempty & ~ok
            R = Wp.clone(); m = new.repeat_interleave(T, 0).repeat_interleave(T, 1)
            R[:, m] = N[:, m]
            # what plain aligned tile copy from that key would give
            plain = int(((tile_ok_match(N, K, z) if tolname == 'match' else tile_ok(N, K, tol)) & nonempty).sum())
            tot['warp_ok'] += int(ok.sum()); tot['patch_ok'] += plain; tot['new'] += int(new.sum()); tot['verts'] += disp[0].numel()
            kind = 'warp'
        else:
            K, Wp, ok, disp = best if best else (None, None, None, None)
            keys.append(N); R = N; tot['new'] += ne; tot['keyframes'] += 1; kind = 'key'
            new = nonempty
        tot['nonempty'] += ne
        errs.append(P.match_error(N, R, z))
        if out_png and kind == 'warp' and len(rows) < max_rows:
            Wshow = Wp
            heat = ((R - N).abs().amax(0) * 4).clamp(0, 1)
            tilemap = comp(R).clone()
            m = new.repeat_interleave(T, 0).repeat_interleave(T, 1)
            tilemap[0][m] = tilemap[0][m] * 0.4 + 0.6; tilemap[1][m] *= 0.4; tilemap[2][m] *= 0.4
            panels = [to_img(K, z), to_img(Wshow, z), to_img(R, z), to_img(N, z),
                      (F.interpolate(heat[None, None], scale_factor=z, mode='bilinear', antialias=True)[0, 0].cpu().numpy()[..., None].repeat(3, 2) * 255).astype(np.uint8),
                      (F.interpolate(tilemap[None], scale_factor=z, mode='bilinear', antialias=True)[0].clamp(0, 1).permute(1, 2, 0).cpu().numpy() * 255).astype(np.uint8)]
            rows.append((d, np.concatenate([np.pad(p, ((2, 2), (2, 2), (0, 0)), constant_values=255) for p in panels], 1)))
    if out_png and rows:
        img = np.concatenate([r for _, r in rows], 0)
        Image.fromarray(img).save(out_png)
    e = np.array(errs)
    return dict(fighter=fighter, action=aid, g=g, tol=tolname, drawings=len(ids), keyframes=tot['keyframes'],
                stored_vs_nonempty=tot['new'] / tot['nonempty'], warp_explained=tot['warp_ok'] / tot['nonempty'],
                aligned_copy_would_explain=tot['patch_ok'] / tot['nonempty'], mesh_vertices=tot['verts'],
                match_mean_abs=float(e[:, 0].mean()), match_share_gt8=float(e[:, 1].mean()), match_worst_share_gt8=float(e[:, 1].max()))

def tile_ok_match(N, R, z, mean_tol=4 / 255, max_tol=40 / 255):
    """Tolerance judged at match pixel size: both composited over grey and area-downscaled by z;
    each source tile maps to its footprint at match size."""
    _, H, W = N.shape
    a = F.interpolate(comp(N)[None], scale_factor=z, mode='bilinear', antialias=True)[0]
    b = F.interpolate(comp(R)[None], scale_factor=z, mode='bilinear', antialias=True)[0]
    d = (a - b).abs().amax(0)
    up = F.interpolate(d[None, None], size=(H, W), mode='nearest')[0]  # back to source grid
    cov = ((R[3:4] > 0) | (N[3:4] > 0)).float()
    mx = F.max_pool2d(up[None], T)[0, 0]; mean = F.avg_pool2d((up * cov)[None], T)[0, 0] / F.avg_pool2d(cov[None], T)[0, 0].clamp_min(1e-6)
    return (mx <= max_tol) & (mean <= mean_tol)

if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('fighter'); ap.add_argument('action'); ap.add_argument('--g', type=int, default=32)
    ap.add_argument('--tol', default='medium'); ap.add_argument('--png'); ap.add_argument('--limit', type=int, default=0); a = ap.parse_args()
    t = time.time(); r = run_action(a.fighter, a.action, a.g, a.tol, a.png, limit=a.limit); r['seconds'] = time.time() - t
    print(json.dumps(r))
