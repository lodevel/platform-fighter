#!/usr/bin/env python3
"""ufd-pose-canny.py — build pose edge maps for gen-frames-cn.ts from extracted
Ultimate Frame Data animation frames instead of text-to-image drafts.

For every pose in a pose-schedule JSON that names a source directory/index,
the script:
  1. picks the requested frame, or the nearest overlay-free frame within
     ±MAX_SHIFT when the requested one carries attack overlays and a clean
     neighbour exists (a 1–3 frame shift at 60 Hz is a smaller pose change
     than the overlay damage);
  2. segments the fighter: not-background pixels minus overlay fill drawn over
     the flat background, closed morphologically, unioned with the immediate
     clean neighbours' masks, and — where attack overlays remain — a limb
     reconstructed from each overlay centre (the white "+" marker) toward the
     nearest body pixel, plus a hand-sized disc at the centre;
  3. normalises scale and registration: ONE scale for the whole schedule
     (reference standing height = TARGET_HEIGHT, 600 px — the size the model
     reliably obeys), and per pose the smallest canvas from CANVASES on which
     the pose, reach included, fits with MARGIN px to spare (1024² for most
     poses; 1536×1024 or taller for a wide swing or a rising move). Every
     canvas shares the same registration — bbox bottom BOTTOM_MARGIN px above
     the canvas bottom, silhouette CENTROID at the horizontal centre (a thin
     extended arm barely moves the centroid, so the body stays put across a
     swing) — and pack-clips.cjs aligns mixed canvas sizes on those two
     anchors. The outline is written as a Canny-style edge map into
     assets/gen/canny-library/<fighter>__<poseHash>.png, updating the library
     manifest exactly like tools/build-canny-library.ts does;
  4. writes a review montage (source | mask | edge) per clip under
     assets/gen/<fighter>-ufd/pose-guides/ for inspection.

Usage:
  python3 tools/ufd-pose-canny.py <pose-schedule.json> <clip-spec.json> \
      --extracted assets/gen/dk-ufd/extracted --reference DonkeyKongJab1:0 [--clips utilt,smash]

The clip spec supplies the exact pose prompt strings (the library is keyed by
their hash). KNOWN BUG (2026-09-25): pose_hash truncates to 60 characters, so
two different prompts with the same first 60 characters share one guide file
and the last write wins (DK: usmash 0 / dsmash 0, fair 4 / uair 0, run 0 /
run 6). Fix by keying guides per clip:index (here and in gen-frames-cn.ts)
before regenerating those clips.
KNOWN LIMITATION: one scale for every GIF assumes Ultimate Frame Data drew all
GIFs at the same zoom; it did not (DK's Jab2 GIF is ~1.6-1.7x closer than
Jab1, so the jab 2 strip is oversize). Normalise per GIF before trusting it.

Poses WITHOUT a UFD source (locomotion clips UFD does not show: run cycle,
jump phases, hurt, shield) take their silhouette from `--fallback-frames
<dir>/<clip>-<i>.png` — magenta-keyed renders of the pose (e.g. a previous
text-guided batch) — resized so the pose is `heightRatio` × the reference
standing height (schedule entry field, default 1.0), then go through the same
batch scale and registration as the UFD poses. Never mix guides built at
different scales in one batch: the packed strips share one cell scale, so a
full-canvas text draft next to a 600 px UFD guide makes the fighter grow by a
third between clips.
"""
import argparse, json, os, re, sys
from collections import Counter
import numpy as np
from PIL import Image, ImageFilter, ImageChops, ImageDraw
try:
    from scipy import ndimage
    HAVE_SCIPY = True
except ImportError:      # component filtering is skipped without scipy (ComfyUI's venv has it)
    HAVE_SCIPY = False

CANVAS = 1024            # base canvas (square); wide/tall poses get a larger one
CANVASES = [(w, h) for h in (1024, 1280, 1536) for w in (1024, 1280, 1536, 1792)]
TARGET_HEIGHT = 600      # reference standing height in canvas px — the ONE scale of the
                         # batch. Do not shrink it to make reach fit: at 325 px the model
                         # ignored the outline in ~80 % of frames (DK batch 2, 2026-09-25)
                         # and drew a canvas-filling fighter; at 600 px it obeyed every frame.
BOTTOM_MARGIN = 144      # ground line this far above the canvas bottom, on every canvas
BASELINE_Y = CANVAS - BOTTOM_MARGIN
MARGIN = 12              # min gap between any pose and the canvas edge
MAX_LIMB_REACH = 1.1     # reconstructed limb centres farther than this × standing height
                         # from the body centroid are pulled in (a spurious overlay centre
                         # would otherwise bind the fit-all scale for the whole batch)
MAX_SHIFT = 3
LIB_DIR = 'assets/gen/canny-library'
BG = np.array([58, 58, 58])


def pose_hash(pose: str) -> str:
    return re.sub(r'^-+|-+$', '', re.sub(r'[^a-z0-9]+', '-', pose.lower()))[:60]


def load(path):
    return Image.open(path).convert('RGB')


def overlay_pixels(a):
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    return (r > 95) & (g < 100) & (r - g > 45)


def has_overlay(a) -> bool:
    return int(overlay_pixels(a).sum()) > 150


def base_mask(a):
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    # The UFD background is a flat palette grey, so any deviation is fighter
    # (including the near-black super-armour tint and dark-blue intangibility).
    notbg = np.abs(a - BG).sum(-1) > 30
    # Overlay fill drawn over the background, INCLUDING its anti-aliased rim:
    # the channels the overlay colour leaves alone stay at the background level
    # and equal to each other while the tinted channel(s) rise. The old test
    # (g < 85 and r > 105) missed the faint rim of a hit-region disc; the rim
    # survived as a ring, fill_holes filled it, and a Spinning Kong guide came
    # out three body-heights wide.
    srt = np.sort(a, -1); lo, mid, hi = srt[..., 0], srt[..., 1], srt[..., 2]
    tinted_bg = (lo <= BG[0] + 2) & (hi - lo > 8) & ((mid - lo <= 6) | (hi - mid <= 6))
    overlay_on_bg = ((g < 85) & (r > 105)) | tinted_bg
    return notbg & ~overlay_on_bg


def keep_major_components(mask, min_frac=0.03):
    """Drop connected blobs smaller than min_frac of the largest one (marker
    remnants, disc rims, stray pixels) so they cannot widen the guide."""
    if not HAVE_SCIPY:
        return mask
    lab, n = ndimage.label(mask)
    if n <= 1:
        return mask
    sizes = ndimage.sum(mask, lab, range(1, n + 1))
    keep = np.zeros(n + 1, bool); keep[1:] = sizes >= min_frac * sizes.max()
    return keep[lab]


def cross_centres(a, body):
    """Centroids of the white '+' markers UFD draws at each attack-region centre."""
    white = (a[..., 0] > 235) & (a[..., 1] > 235) & (a[..., 2] > 235)
    # The '+' markers are drawn over the overlay fill: keep white pixels that
    # have overlay fill within a few pixels, wherever the body mask says.
    near_overlay = np.asarray(Image.fromarray((overlay_pixels(a) * 255).astype('uint8')).filter(ImageFilter.MaxFilter(9))) > 0
    white &= near_overlay
    del body
    m = Image.fromarray((white * 255).astype('uint8')).filter(ImageFilter.MaxFilter(5))
    arr = np.asarray(m) > 0
    # connected components via flood fill on a small grid
    h, w = arr.shape
    seen = np.zeros_like(arr, bool)
    centres = []
    ys, xs = np.nonzero(arr)
    for y0, x0 in zip(ys, xs):
        if seen[y0, x0]:
            continue
        stack = [(y0, x0)]; pts = []
        seen[y0, x0] = True
        while stack:
            y, x = stack.pop(); pts.append((y, x))
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                ny, nx = y + dy, x + dx
                if 0 <= ny < h and 0 <= nx < w and arr[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True; stack.append((ny, nx))
        if 60 <= len(pts) <= 2500:
            py = sum(p[0] for p in pts) / len(pts); px = sum(p[1] for p in pts) / len(pts)
            centres.append((px, py))
    return centres


def fill_holes(m):
    """Fill enclosed black regions (fur pixels that match the flat background)."""
    inv = m.point(lambda v: 255 - v)
    w, h = inv.size
    outside = inv.copy()
    for corner in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)):
        if outside.getpixel(corner) == 255:
            ImageDraw.floodfill(outside, corner, 128)
    holes = outside.point(lambda v: 255 if v == 255 else 0)
    return ImageChops.lighter(m, holes)


def close(mask_bool, k=13):
    m = Image.fromarray((mask_bool * 255).astype('uint8'))
    m = m.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MaxFilter(3))
    m = m.filter(ImageFilter.MaxFilter(k)).filter(ImageFilter.MinFilter(k))
    m = fill_holes(m)
    return np.asarray(m) > 0


def segment(frames, idx, standing_h, exact=False):
    """frames: dict index -> np array. Returns (mask bool array, used index, note)."""
    a = frames[idx]
    note = []
    use = idx
    if exact:
        # the schedule pinned this frame: never shift to a neighbour (a shift can
        # land two poses on the same source frame — DK bair poses 1 and 2 both
        # ended on frame 5 and the kick's active drawing was the wind-up)
        pass
    elif has_overlay(a):
        for d in range(1, MAX_SHIFT + 1):
            for cand in (idx + d, idx - d):
                if cand in frames and not has_overlay(frames[cand]):
                    use = cand; break
            if use != idx:
                break
        if use != idx:
            note.append(f'shifted {idx}->{use} (overlay-free neighbour)')
            a = frames[use]
    body = keep_major_components(close(base_mask(a)))
    if has_overlay(a):
        # union with clean immediate neighbours — only when the neighbour's body
        # sits where this one does (a travelling or rising move displaces the
        # fighter between frames, and a union would then draw two bodies)
        for nb in (use - 1, use + 1):
            if nb in frames and not has_overlay(frames[nb]):
                nbm = keep_major_components(close(base_mask(frames[nb])))
                if abs(centroid_x(nbm) - centroid_x(body)) <= 0.15 * standing_h and abs(int(nbm.sum()) - int(body.sum())) <= 0.6 * int(body.sum()):
                    body |= nbm
                    note.append(f'union with clean frame {nb}')
                else:
                    note.append(f'neighbour {nb} skipped (displaced)')
        centres = cross_centres(a, body)
        if centres:
            # Clamp each centre to MAX_LIMB_REACH × standing height from the body
            # centroid: an arm cannot be longer than that, and one far-flung
            # marker must not shrink every other pose's guide.
            bys, bxs = np.nonzero(body)
            if len(bxs):
                bc = (float(bxs.mean()), float(bys.mean())); lim = MAX_LIMB_REACH * standing_h
                clamped = []
                for cx, cy in centres:
                    dx, dy = cx - bc[0], cy - bc[1]; d = (dx * dx + dy * dy) ** 0.5
                    if d > lim:
                        cx, cy = bc[0] + dx * lim / d, bc[1] + dy * lim / d
                        note.append(f'limb centre pulled in from {d / standing_h:.2f}x to {MAX_LIMB_REACH}x standing')
                    clamped.append((cx, cy))
                centres = clamped
            # Drop the marker remnants themselves so they cannot act as the
            # limb's attachment point, then attach each limb to the nearest
            # body pixel outside the hand radius (the torso/shoulder side).
            white = (a[..., 0] > 235) & (a[..., 1] > 235) & (a[..., 2] > 235)
            near_overlay = np.asarray(Image.fromarray((overlay_pixels(a) * 255).astype('uint8')).filter(ImageFilter.MaxFilter(9))) > 0
            marker = np.asarray(Image.fromarray(((white & near_overlay) * 255).astype('uint8')).filter(ImageFilter.MaxFilter(7))) > 0
            body = close(body & ~marker, 9)
            img = Image.fromarray((body * 255).astype('uint8'))
            dr = ImageDraw.Draw(img)
            ys, xs = np.nonzero(body)
            pts = np.stack([xs, ys], 1) if len(xs) else None
            limb_w = max(14, int(standing_h * 0.26)); hand_r = max(10, int(standing_h * 0.11))
            # Chain the limb through the overlay centres: the centre nearest the
            # body attaches to the body (outside the hand radius), and every
            # following centre attaches to the previous one, so a swing arc
            # becomes one continuous limb rather than a fan of spokes.
            def dist_to_body(c):
                return float(np.min((pts[:, 0] - c[0]) ** 2 + (pts[:, 1] - c[1]) ** 2)) if pts is not None else 0.0
            remaining = sorted(centres, key=dist_to_body)
            chain = [remaining.pop(0)]
            while remaining:
                last = chain[-1]
                remaining.sort(key=lambda c: (c[0] - last[0]) ** 2 + (c[1] - last[1]) ** 2)
                chain.append(remaining.pop(0))
            prev = None
            for cx, cy in chain:
                if prev is None and pts is not None:
                    d = ((pts[:, 0] - cx) ** 2 + (pts[:, 1] - cy) ** 2)
                    far = d > (hand_r * 1.6) ** 2
                    if far.any():
                        j = int(np.argmin(np.where(far, d, np.inf))); prev = (float(pts[j, 0]), float(pts[j, 1]))
                if prev is not None:
                    dr.line([prev, (cx, cy)], fill=255, width=limb_w)
                dr.ellipse([cx - hand_r, cy - hand_r, cx + hand_r, cy + hand_r], fill=255)
                prev = (cx, cy)
            body = np.asarray(img) > 0
            note.append(f'{len(centres)} limb(s) reconstructed from overlay centres')
    return body, use, '; '.join(note)


def bbox(mask):
    ys, xs = np.nonzero(mask)
    return (xs.min(), ys.min(), xs.max(), ys.max()) if len(xs) else None


def centroid_x(mask):
    ys, xs = np.nonzero(mask)
    return float(xs.mean()) if len(xs) else CANVAS / 2


def extents(mask):
    """(left reach, right reach, height) of a mask around its centroid, in source px."""
    b = bbox(mask)
    if b is None:
        return 0.0, 0.0, 0.0
    cx = centroid_x(mask)
    return cx - b[0], b[2] - cx, float(b[3] - b[1] + 1)


def fit_all_scale(masks, standing_h):
    """Largest uniform scale keeping the standing reference ≤ TARGET_HEIGHT and
    every pose (reach included) inside the canvas margins. Returns (scale, why)."""
    cands = [(TARGET_HEIGHT / standing_h, 'reference standing height')]
    for label, m in masks:
        l, r, h = extents(m)
        if l > 0:
            cands.append(((CANVAS / 2 - MARGIN) / l, f'{label} left reach'))
        if r > 0:
            cands.append(((CANVAS / 2 - MARGIN) / r, f'{label} right reach'))
        if h > 0:
            cands.append(((BASELINE_Y - MARGIN) / h, f'{label} height'))
    return min(cands, key=lambda c: c[0])


def choose_canvas(mask, scale):
    """Smallest canvas (by area) on which the pose fits with MARGIN at the batch
    scale; the largest one with a warning flag when nothing fits."""
    l, r, h = extents(mask)
    need_w = 2 * max(l, r) * scale + 2 * MARGIN
    need_h = h * scale + BOTTOM_MARGIN + MARGIN
    for w, hh in sorted(CANVASES, key=lambda c: c[0] * c[1]):
        if w >= need_w and hh >= need_h:
            return (w, hh), True
    return max(CANVASES, key=lambda c: c[0] * c[1]), False


def normalise(mask, scale, canvas=(CANVAS, CANVAS)):
    W, H = canvas
    b = bbox(mask)
    if b is None:
        return Image.new('L', (W, H), 0)
    x0, y0, x1, y1 = b
    crop = Image.fromarray((mask * 255).astype('uint8')).crop((x0, y0, x1 + 1, y1 + 1))
    w, h = crop.size
    nw, nh = max(1, int(w * scale)), max(1, int(h * scale))
    crop = crop.resize((nw, nh), Image.BILINEAR)
    out = Image.new('L', (W, H), 0)
    left = int(round(W / 2 - (centroid_x(mask) - x0) * scale)); top = (H - BOTTOM_MARGIN) - nh
    out.paste(crop, (left, top))
    return out


def fallback_mask(path, target_h):
    """Silhouette of a magenta-background render, resized so its height is
    target_h (source px). Keys on hue (R and B well above G) so the darker
    ground-shadow the renderer sometimes adds is dropped with the background."""
    a = np.asarray(load(path)).astype(int)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    fg = ~((r - g > 60) & (b - g > 60))
    m = keep_major_components(close(fg, 9))
    bb = bbox(m)
    if bb is None:
        return m
    x0, y0, x1, y1 = bb
    crop = Image.fromarray((m * 255).astype('uint8')).crop((x0, y0, x1 + 1, y1 + 1))
    s = target_h / crop.height
    crop = crop.resize((max(1, int(crop.width * s)), max(1, int(target_h))), Image.BILINEAR)
    return np.asarray(crop) > 127


def edge_map(m):
    e = ImageChops.difference(m.filter(ImageFilter.MaxFilter(5)), m.filter(ImageFilter.MinFilter(3)))
    return e.point(lambda v: 255 if v > 64 else 0)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('schedule'); ap.add_argument('spec')
    ap.add_argument('--extracted', required=True)
    ap.add_argument('--reference', required=True, help='<sourceDir>:<index> of a standing frame for scale')
    ap.add_argument('--clips', default='')
    ap.add_argument('--fighter', default=None)
    ap.add_argument('--fallback-frames', default=None,
                    help='dir of magenta-keyed <clip>-<i>.png renders used as silhouettes for poses without a UFD source')
    ap.add_argument('--scale', type=float, default=None,
                    help='override the batch scale (report.json "scale"); the default TARGET_HEIGHT / reference standing height is already the same for any subset')
    args = ap.parse_args()
    schedule = json.load(open(args.schedule)); spec = json.load(open(args.spec))
    fighter = args.fighter or spec['fighter']
    only = set(filter(None, args.clips.split(',')))
    os.makedirs(LIB_DIR, exist_ok=True)
    manifest_path = f'{LIB_DIR}/manifest.json'
    manifest = json.load(open(manifest_path)) if os.path.exists(manifest_path) else {}
    guides_dir = f'assets/gen/{fighter}-ufd/pose-guides'; os.makedirs(guides_dir, exist_ok=True)

    ref_dir, ref_idx = args.reference.split(':')
    ref = np.asarray(load(f'{args.extracted}/{ref_dir}/source-{int(ref_idx):05d}.png')).astype(int)
    ref_mask = close(base_mask(ref)); rb = bbox(ref_mask); standing_h = rb[3] - rb[1] + 1
    scale = TARGET_HEIGHT / standing_h
    print(f'[ufd-canny] reference {ref_dir}:{ref_idx} standing height {standing_h}px -> scale {scale:.3f}')

    class LazyFrames:
        """Loads source frames on demand (a bounded cache) so a 100-frame
        animation never sits in memory as a whole."""
        def __init__(self, directory):
            self.dir = directory
            self.indices = {int(m.group(1)) for f in os.listdir(directory)
                            for m in [re.match(r'source-(\d+)\.png$', f)] if m}
            self.cache = {}
        def __contains__(self, i):
            return i in self.indices
        def __getitem__(self, i):
            if i not in self.cache:
                if len(self.cache) >= 10:
                    self.cache.pop(next(iter(self.cache)))
                self.cache[i] = np.asarray(load(f'{self.dir}/source-{i:05d}.png')).astype(np.int16)
            return self.cache[i]
    frame_cache = {}
    def frames_for(dirname):
        if dirname not in frame_cache:
            frame_cache[dirname] = LazyFrames(f'{args.extracted}/{dirname}')
        return frame_cache[dirname]

    # ---- pass 1: every pose's silhouette in source px (UFD or fallback) ----
    items = []      # (anim, i, pose, mask, src thumb, label, report entry)
    th = 220
    def thumb(im):
        return im.resize((max(1, int(im.width * th / im.height)), th))
    for anim, entries in schedule.items():
        if only and anim not in only: continue
        if anim not in spec['clips']:
            print(f'[ufd-canny] {anim}: not in the clip spec — skipped (would only distort the fit-all scale)'); continue
        prompts = spec['clips'][anim]
        for i, entry in enumerate(entries):
            if i >= len(prompts):
                print(f'[ufd-canny] {anim}[{i}]: schedule has more poses than the spec — skipped'); continue
            pose = prompts[i] if i < len(prompts) else entry['prompt']
            if entry.get('sourceIndex') is not None and entry.get('sourceDir'):
                dirname = os.path.basename(entry['sourceDir']).replace('.md', '')
                frames = frames_for(dirname)
                idx = int(entry['sourceIndex'])
                if idx not in frames:
                    print(f'[ufd-canny] {anim}[{i}] missing frame {dirname}:{idx}'); continue
                mask, used, note = segment(frames, idx, standing_h, exact=bool(entry.get('exact')))
                src = thumb(Image.fromarray(frames[used].astype('uint8')))
                label = f'{anim}-{i} {dirname}:{used}'
                rep = {'pose': i, 'source': f'{dirname}:{idx}', 'used': used, 'note': note}
            elif args.fallback_frames:
                fb = f'{args.fallback_frames}/{anim}-{i}.png'
                if not os.path.exists(fb):
                    print(f'[ufd-canny] {anim}[{i}] no UFD source and no fallback render {fb} — skipped'); continue
                ratio = float(entry.get('heightRatio', 1.0))
                mask = fallback_mask(fb, ratio * standing_h)
                src = thumb(load(fb))
                label = f'{anim}-{i} fallback x{ratio:.2f}'
                rep = {'pose': i, 'source': f'fallback:{os.path.basename(fb)}', 'heightRatio': ratio, 'note': 'silhouette from render'}
            else:
                continue
            if i < len(prompts) or 'prompt' in entry:
                items.append((anim, i, pose, mask, src, label, rep))
    scale = args.scale if args.scale is not None else TARGET_HEIGHT / standing_h
    print(f'[ufd-canny] batch scale {scale:.3f} (reference standing height -> {standing_h * scale:.0f}px)')
    canvases = {}
    for it in items:
        anim, i, pose, mask, src, label, rep = it
        canvas, fits = choose_canvas(mask, scale)
        rep['canvas'] = f'{canvas[0]}x{canvas[1]}'
        if not fits:
            rep['note'] = (rep.get('note', '') + '; ' if rep.get('note') else '') + 'EXCEEDS the largest canvas — clipped'
            print(f'[ufd-canny] WARNING: {label} exceeds the largest canvas even at scale {scale:.3f}')
        canvases[(anim, i)] = canvas
    hist = Counter(canvases.values())
    print('[ufd-canny] canvases: ' + ', '.join(f'{w}x{h}: {n}' for (w, h), n in sorted(hist.items())))
    for (anim, i), c in sorted(canvases.items()):
        if c != (CANVAS, CANVAS):
            print(f'[ufd-canny]   {anim}[{i}] -> {c[0]}x{c[1]}')

    # ---- pass 2: normalise, edge, write ----
    made = 0; report = {'scale': scale, 'standingPx': standing_h * scale, 'canvases': {f'{w}x{h}': n for (w, h), n in hist.items()}, 'clips': {}}
    rows_by_anim = {}
    for anim, i, pose, mask, src, label, rep in items:
        norm = normalise(mask, scale, canvases[(anim, i)]); edge = edge_map(norm)
        key = f'{fighter}__{pose_hash(pose)}'; file = f'{key}.png'
        edge.save(f'{LIB_DIR}/{file}')
        model = f"ufd-silhouette:{rep['source']}" if not rep['source'].startswith('fallback') else f"ufd-scale-fallback:{rep['source']}"
        manifest[key] = {'pose': pose, 'file': file, 'model': model, 'draftSeed': 0}
        made += 1
        rep['file'] = file
        report['clips'].setdefault(anim, []).append(rep)
        rows_by_anim.setdefault(anim, []).append((label, src, thumb(Image.fromarray((mask * 255).astype('uint8')).convert('RGB')), thumb(edge.convert('RGB'))))
    for anim, rows in rows_by_anim.items():
        tiles = [list(r[1:]) for r in rows]
        W = max(sum(t.width for t in row) + 8 for row in tiles); H = len(rows) * (th + 24)
        sheet = Image.new('RGB', (W, H), (30, 30, 30)); dr = ImageDraw.Draw(sheet)
        for r, (label, *_) in enumerate(rows):
            x = 4
            for tile in tiles[r]:
                sheet.paste(tile, (x, r * (th + 24) + 4)); x += tile.width + 4
            dr.text((6, r * (th + 24) + th + 6), label, fill=(255, 255, 255))
        sheet.save(f'{guides_dir}/{anim}.png')
    json.dump(manifest, open(manifest_path, 'w'), indent=2)
    rp = f'{guides_dir}/report.json'
    if only and os.path.exists(rp):
        prev = json.load(open(rp))
        if isinstance(prev.get('clips'), dict):
            prev['clips'].update(report['clips']); prev['scale'] = scale; report = prev
    json.dump(report, open(rp, 'w'), indent=1)
    print(f'[ufd-canny] wrote {made} edge maps; review sheets in {guides_dir}')


if __name__ == '__main__':
    main()
