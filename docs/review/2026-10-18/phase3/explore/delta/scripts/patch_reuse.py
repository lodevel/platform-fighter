"""Position-aware patch reuse: each drawing = tiles copied (at a small offset) from earlier
reconstructed drawings of the same action (optionally also similar drawings of earlier actions),
plus new tiles where nothing matches within tolerance. GPU via torch."""
import sys, json, time, math, argparse
import numpy as np, torch, torch.nn.functional as F
sys.path.insert(0, __import__('os').path.dirname(__file__))
from common import Package, FINALS

dev = __import__('os').environ.get('DEV', 'cuda')
TOLS = {  # (mean, max) of per-pixel max-channel |premultiplied diff|, over covered pixels of the tile
    'exact': (0.5 / 255, 1.5 / 255), 'tight': (2 / 255, 16 / 255), 'medium': (4 / 255, 48 / 255), 'loose': (8 / 255, 96 / 255)}

def action_frame(pk, ids, T, S):
    """Common canvas for an action: union of extents relative to the root, tile-aligned."""
    ext = []
    for d in ids:
        r = pk.pkg['drawings'][d]; ax, ay = (int(round(v)) for v in r['anchor']); w, h = r['rect'][2:]
        ext.append((-ax, -ay, w - ax, h - ay))
    x0 = math.floor(min(e[0] for e in ext) / T) * T; y0 = math.floor(min(e[1] for e in ext) / T) * T
    x1 = math.ceil(max(e[2] for e in ext) / T) * T; y1 = math.ceil(max(e[3] for e in ext) / T) * T
    return x0, y0, x1 - x0, y1 - y0

def load_canvas(pk, d, frame):
    x0, y0, W, H = frame
    img, (ax, ay), _ = pk.drawing(d); ax, ay = int(round(ax)), int(round(ay))
    C = np.zeros((H, W, 4), np.float32); h, w = img.shape[:2]
    C[-ay - y0:-ay - y0 + h, -ax - x0:-ax - x0 + w] = img
    return torch.from_numpy(C).permute(2, 0, 1).contiguous().to(dev)

def coarse_sig(C, cell=16):
    return F.avg_pool2d(C[None], cell, ceil_mode=True)[0]

G = 1536  # fixed root-centred grid for cross-action similarity, 16 px cells
def fixed_sig(C, frame):
    x0, y0, W, H = frame
    out = torch.zeros((4, G, G), device=dev)
    X0, Y0 = x0 + G // 2, y0 + G * 3 // 4
    out[:, max(Y0, 0):Y0 + H, max(X0, 0):X0 + W] = C[:, max(-Y0, 0):G - Y0, max(-X0, 0):G - X0]
    return F.avg_pool2d(out[None], 16)[0]

def reframe(ref, fr_old, fr):
    """Express a reconstructed drawing in another action's canvas (same root)."""
    x0, y0, W, H = fr_old; fx0, fy0, fW, fH = fr
    out = Ref(torch.zeros((4, fH, fW), device=dev), torch.full((fH, fW), -1, dtype=torch.long, device=dev),
              torch.zeros((fH, fW), dtype=torch.long, device=dev), torch.zeros((fH, fW), dtype=torch.long, device=dev))
    ox, oy = x0 - fx0, y0 - fy0
    X0, Y0 = max(ox, 0), max(oy, 0); X1, Y1 = min(ox + W, fW), min(oy + H, fH)
    if X1 <= X0 or Y1 <= Y0: return None
    sl = (slice(Y0 - oy, Y1 - oy), slice(X0 - ox, X1 - ox))
    out.recon[:, Y0:Y1, X0:X1] = ref.recon[:, sl[0], sl[1]]
    out.sid[Y0:Y1, X0:X1] = ref.sid[sl]
    out.du[Y0:Y1, X0:X1] = ref.du[sl] - ox; out.dv[Y0:Y1, X0:X1] = ref.dv[sl] - oy
    return out

class Ref:
    def __init__(self, recon, sid, du, dv): self.recon, self.sid, self.du, self.dv = recon, sid, du, dv

def code_drawing(N, refs, T, S, tol, next_sid):
    """Returns recon, source maps (sid, du, dv), stats."""
    _, H, W = N.shape
    th, tw = H // T, W // T
    aN = N[3]
    nonempty = F.max_pool2d(aN[None, None], T)[0, 0] > 1 / 255
    best_mean = torch.full((th, tw), 1e9, device=dev)
    best = torch.full((th, tw, 3), -1, dtype=torch.long, device=dev)  # ref index, dy, dx
    offs = [(dy, dx) for dy in range(-S, S + 1) for dx in range(-S, S + 1)]
    offs.sort(key=lambda o: abs(o[0]) + abs(o[1]))
    tm, tx = tol
    for ri, r in enumerate(refs):
        P = F.pad(r.recon, (S, S, S, S))
        for b in range(0, len(offs), 16):
            chunk = offs[b:b + 16]
            stack = torch.stack([P[:, S + dy:S + dy + H, S + dx:S + dx + W] for dy, dx in chunk])
            diff = (stack - N[None]).abs().amax(1, keepdim=True)
            cov = ((stack[:, 3:4] > 0) | (N[None, 3:4] > 0)).float()
            mx = F.max_pool2d(diff, T)[:, 0]
            mean = F.avg_pool2d(diff, T)[:, 0] / F.avg_pool2d(cov, T)[:, 0].clamp_min(1e-6)
            ok = (mx <= tx) & (mean <= tm)
            # prefer offset zero strongly, then smaller mean
            score = torch.where(ok, mean + torch.tensor([0 if o == (0, 0) else 1e-3 for o in chunk], device=dev)[:, None, None], torch.full_like(mean, 1e9))
            sbest, sidx = score.min(0)
            better = sbest < best_mean
            best_mean = torch.where(better, sbest, best_mean)
            o = torch.tensor(chunk, device=dev)[sidx]
            best[..., 0] = torch.where(better, ri, best[..., 0])
            best[..., 1] = torch.where(better, o[..., 0], best[..., 1])
            best[..., 2] = torch.where(better, o[..., 1], best[..., 2])
    reused = nonempty & (best_mean < 1e8)
    new = nonempty & ~reused
    up = lambda t: t.repeat_interleave(T, 0).repeat_interleave(T, 1)
    newp, reup = up(new), up(reused)
    ys = torch.arange(H, device=dev)[:, None].expand(H, W); xs = torch.arange(W, device=dev)[None].expand(H, W)
    recon = torch.zeros_like(N); sid = torch.full((H, W), -1, dtype=torch.long, device=dev)
    du = torch.zeros((H, W), dtype=torch.long, device=dev); dv = torch.zeros_like(du)
    # new tiles: own storage, numbered in raster order
    order = torch.cumsum(new.flatten().long(), 0).view(th, tw) - 1 + next_sid
    recon[:, newp] = N[:, newp]; sid[newp] = up(order)[newp]
    du[newp] = -(xs // T * T)[newp]; dv[newp] = -(ys // T * T)[newp]
    if refs and reused.any():
        bri, bdy, bdx = up(best[..., 0].clamp_min(0)), up(best[..., 1]), up(best[..., 2])
        sy, sx = ys + bdy, xs + bdx
        inb = reup & (sy >= 0) & (sy < H) & (sx >= 0) & (sx < W)
        R = torch.stack([r.recon for r in refs]); RS = torch.stack([r.sid for r in refs])
        RU = torch.stack([r.du for r in refs]); RV = torch.stack([r.dv for r in refs])
        i_, y_, x_ = bri[inb], sy[inb], sx[inb]
        recon[:, inb] = R[i_, :, y_, x_].T
        sid[inb] = RS[i_, y_, x_]; du[inb] = RU[i_, y_, x_] + bdx[inb]; dv[inb] = RV[i_, y_, x_] + bdy[inb]
    nt = [0] * int(new.sum())
    # quads per drawing: distinct (sid, du, dv) per output tile, sid>=0
    quads = 0
    if nonempty.any():
        tid = (torch.arange(th, device=dev)[:, None].expand(th, tw) * tw + torch.arange(tw, device=dev)[None]).repeat_interleave(T, 0).repeat_interleave(T, 1)
        m = sid >= 0
        key = torch.stack([tid[m], sid[m], du[m], dv[m]], 1)
        quads = torch.unique(key, dim=0).shape[0]
    # storage incl. gutters: horizontal runs of new tiles, 2px gutter each side, 4-aligned
    newc = new.cpu().numpy(); gut = 0
    for row in newc:
        run = 0
        for v in list(row) + [False]:
            if v: run += 1
            elif run:
                gut += (math.ceil((run * T + 4) / 4) * 4) * (math.ceil((T + 4) / 4) * 4); run = 0
    st = dict(nonempty=int(nonempty.sum()), new=len(nt), reused=int(reused.sum()), quads=quads, gutter_area=gut,
              offset_reuse=int((reused & ((best[..., 1] != 0) | (best[..., 2] != 0))).sum()))
    return Ref(recon, sid, du, dv), st, next_sid + len(nt)

def match_error(N, R, z):
    """Composite over grey, area-downscale by z, compare. Returns mean abs (0..255), share of covered px > 8/255, max."""
    def show(A):
        bg = 0.5
        rgb = A[:3] + bg * (1 - A[3:4])
        return F.interpolate(rgb[None], scale_factor=z, mode='bilinear', antialias=True, align_corners=False)[0]
    a, b = show(N), show(R)
    cov = F.interpolate(N[3:4][None], scale_factor=z, mode='bilinear', antialias=True)[0, 0] > 0.02
    d = (a - b).abs().amax(0) * 255
    if not cov.any(): return 0.0, 0.0, 0.0
    return float(d[cov].mean()), float((d[cov] > 8).float().mean()), float(d.max())

def run(fighter, T, S, tolname, cross, sample_out=None, sample_actions=(), only=None):
    pk = Package(fighter); tol = TOLS[tolname]
    tot = dict(rect=0, nonempty=0, new=0, quads=0, gutter=0, drawings=0, offset_reuse=0, reused=0)
    err_final, err_other = [], []
    per_action = {}
    next_sid = 0
    library = []  # (scale, sig-on-root, Ref, frame) of earlier actions for cross reuse
    for aid in pk.pkg['actions']:
        if only and aid not in only: continue
        ids = pk.action_drawings(aid)
        if not ids: continue
        scale = pk.pkg['drawings'][ids[0]]['scale']
        frame = action_frame(pk, ids, T, S)
        done = []  # (canvas sig, Ref)
        a_st = dict(nonempty=0, new=0, quads=0, rect=0, drawings=len(ids))
        is_final = aid in FINALS[fighter] or 'final' in aid and 'victim' not in aid
        zoom = 2.8 if is_final else 1.4
        recons = []
        for d in ids:
            N = load_canvas(pk, d, frame)
            sig = coarse_sig(N)
            cands = []
            if done:
                last = [r for _, r in done[-3:]]
                sims = sorted(done[:-3], key=lambda t: float((t[0] - sig).abs().mean()))[:3]
                cands = last + [r for _, r in sims]
            if cross and library:
                fs = fixed_sig(N, frame)
                lib = [l for l in library if abs(l[0] - scale) < 1e-3]
                if lib:
                    d_ = (torch.stack([l[1] for l in lib]) - fs[None]).abs().mean((1, 2, 3))
                    lib = [lib[i] for i in d_.argsort()[:3].tolist()]
                for l in lib:
                    R = reframe(l[2], l[3], frame)
                    if R is not None: cands.append(R)
            ref, st, next_sid = code_drawing(N, cands, T, S, tol, next_sid)
            done.append((sig, ref))
            r = pk.pkg['drawings'][d]['rect']
            a_st['nonempty'] += st['nonempty']; a_st['new'] += st['new']; a_st['quads'] += st['quads']; a_st['rect'] += r[2] * r[3]
            tot['rect'] += r[2] * r[3]; tot['nonempty'] += st['nonempty']; tot['new'] += st['new']; tot['quads'] += st['quads']
            tot['gutter'] += st['gutter_area']; tot['drawings'] += 1; tot['offset_reuse'] += st['offset_reuse']; tot['reused'] += st['reused']
            e = match_error(N, ref.recon, scale * zoom)
            (err_final if is_final else err_other).append(e)
            if aid in sample_actions: recons.append((d, N.cpu(), ref.recon.cpu(), ref.sid.cpu(), st))
        if cross:
            for (sig, ref) in done[::max(1, len(done) // 4)][:4]:
                library.append((scale, fixed_sig(ref.recon, frame), ref, frame))
        per_action[aid] = dict(a_st, final=is_final)
        print(aid, len(per_action), flush=True, file=sys.stderr)
        if sample_out is not None and recons: sample_out[aid] = recons
    def agg(es):
        if not es: return None
        a = np.array(es); return dict(mean_abs=float(a[:, 0].mean()), share_gt8=float(a[:, 1].mean()), worst_share_gt8=float(a[:, 1].max()), max=float(a[:, 2].max()))
    T2 = T * T
    res = dict(fighter=fighter, T=T, S=S, tol=tolname, cross=cross, drawings=tot['drawings'],
               rect_px=tot['rect'], nonempty_px=tot['nonempty'] * T2, stored_px=tot['new'] * T2, stored_with_gutters_px=tot['gutter'],
               stored_vs_rect=tot['new'] * T2 / tot['rect'], stored_vs_nonempty=tot['new'] / tot['nonempty'],
               gutter_vs_rect=tot['gutter'] / tot['rect'], quads_per_drawing=tot['quads'] / tot['drawings'],
               offset_share_of_reused=tot['offset_reuse'] / max(1, tot['reused']),
               err_final=agg(err_final), err_other=agg(err_other),
               per_action={k: dict(v, stored_vs_nonempty=v['new'] / max(1, v['nonempty'])) for k, v in per_action.items()})
    return res

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('fighter'); ap.add_argument('--T', type=int, default=16); ap.add_argument('--S', type=int, default=0)
    ap.add_argument('--tol', default='tight'); ap.add_argument('--cross', action='store_true'); ap.add_argument('--out')
    a = ap.parse_args()
    t = time.time()
    with torch.no_grad():
        res = run(a.fighter, a.T, a.S, a.tol, a.cross)
    res['seconds'] = time.time() - t
    s = {k: v for k, v in res.items() if k != 'per_action'}
    print(json.dumps(s))
    if a.out: json.dump(res, open(a.out, 'w'), indent=1)
