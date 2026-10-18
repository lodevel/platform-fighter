"""Structured tracer for this art: a silhouette, K flat colour layers stacked largest-first,
and an ink (outline) layer on top. Each layer is a set of polygons with holes, simplified to a
chord tolerance in source pixels. Also builds the hybrids (shading residual, SDF, indexed)."""
import math, gzip
import numpy as np
import cv2
from PIL import Image
import vec

LEVELS = {  # colour tolerance (RGB distance 0..1 that 95% of fill pixels stay within), mode filter, smoothing
    'fine':   dict(tol=0.05, mode=3, sigma=0.5),
    'medium': dict(tol=0.09, mode=3, sigma=0.6),
    'coarse': dict(tol=0.15, mode=5, sigma=0.8),
}
K_STEPS = (2, 3, 4, 6, 8, 12, 16, 24, 32)
INK_COLOURS = 3   # line art is split into at most this many colours
UP = 4            # contours are found on a 4x upsampled soft mask


def lum(rgb):
    return rgb @ np.array([0.299, 0.587, 0.114], np.float32)


def nearest_fill(rgb, keep):
    """Every pixel takes the colour of the nearest pixel in `keep`."""
    if not keep.any(): return rgb.copy()
    _, lab = cv2.distanceTransformWithLabels((~keep).astype(np.uint8), cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
    zy, zx = np.nonzero(keep)
    order = np.zeros(lab.max() + 1, np.int64)
    order[lab[zy, zx]] = np.arange(len(zy))
    idx = order[lab]
    return rgb[zy[idx], zx[idx]]


def kmeans(samples, k):
    crit = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 30, 1e-3)
    sub = samples[np.random.default_rng(0).choice(len(samples), min(len(samples), 20000), replace=False)]
    k = min(k, len(np.unique(sub.round(3), axis=0)))
    _, _, centres = cv2.kmeans(sub, k, None, crit, 2, cv2.KMEANS_PP_CENTERS)
    return centres


def nearest(rgb, centres):
    d = ((rgb[..., None, :] - centres[None, None]) ** 2).sum(-1)
    return d.argmin(-1).astype(np.int32), np.sqrt(d.min(-1))


def mode_filter(labels, k, size):
    if size <= 1: return labels
    votes = np.stack([cv2.boxFilter((labels == i).astype(np.float32), -1, (size, size), normalize=False)
                      for i in range(k)], -1)
    return votes.argmax(-1).astype(np.int32)


def line_art(rgb, alpha):
    """Soft coverage (0..1) of thin dark lines: a morphological black-hat of luminance,
    with transparency counted as light so the silhouette outline is found too."""
    L = np.where(alpha > 0.5, lum(rgb), 1.0).astype(np.float32)
    bh = cv2.morphologyEx(L, cv2.MORPH_BLACKHAT, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
    return (np.clip((bh - 0.02) / 0.08, 0, 1) * np.clip(alpha * 2, 0, 1)).astype(np.float32)


def decompose(im, level):
    """Fills: label map (-1 = transparent) and palette; ink: [(colour, coverage)]; alpha."""
    p = LEVELS[level]
    a = np.asarray(im, np.float32) / 255
    alpha, rgb = a[..., 3], a[..., :3]
    solid = alpha >= 0.5
    exact = np.unique(rgb[solid], axis=0)
    flat = len(exact) <= K_STEPS[-1]  # already posterised art: its outline is just another colour
    ink = np.zeros_like(alpha) if flat else line_art(rgb, alpha)
    core = ink > 0.5
    # fills: denoise (edge-preserving), take the colour under the lines from the nearest fill pixel
    if flat:  # keep the exact colours
        filled = nearest_fill(rgb, solid & ~core)
        centres = exact.astype(np.float32)
        labels, _ = nearest(filled, centres)
    else:
        smooth = cv2.pyrMeanShiftFiltering((rgb * 255).astype(np.uint8), 3, 14).astype(np.float32) / 255
        filled = nearest_fill(smooth, solid & ~core)
        samples = filled[solid].astype(np.float32)
        for k in K_STEPS:  # fewest colours that keep 95% of fill pixels within tolerance
            centres = kmeans(samples, k)
            labels, dist = nearest(filled, centres)
            if np.percentile(dist[solid], 95) <= p['tol']: break
    labels = mode_filter(labels, len(centres), p['mode'])
    labels[~solid] = -1
    inks = []
    if core.sum() >= 4:
        darkest = cv2.erode(np.where(solid[..., None], rgb, 1).astype(np.float32), np.ones((3, 3), np.uint8))
        ink_centres = kmeans(darkest[core].astype(np.float32), INK_COLOURS)
        ink_labels, _ = nearest(darkest, ink_centres)
        for i, c in enumerate(ink_centres):
            cov = ink * (ink_labels == i)
            if (cov > 0.5).sum() >= 2: inks.append((c, cov.astype(np.float32)))
    return labels, centres, inks, alpha


def contours(mask_soft, tol, sigma, level=0.5):
    """Polygons (outer rings with holes) for soft mask > level, in source px, simplified to tol."""
    h, w = mask_soft.shape
    big = cv2.resize(mask_soft, (w * UP, h * UP), interpolation=cv2.INTER_LINEAR)
    if sigma > 0: big = cv2.GaussianBlur(big, (0, 0), sigma * UP)
    binm = (big > level).astype(np.uint8)
    cs, hier = cv2.findContours(binm, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    polys = []  # list of [outer, hole, hole...]
    if hier is None: return polys
    hier = hier[0]
    simp = [cv2.approxPolyDP(c, tol * UP, True).reshape(-1, 2) / UP + (0.5 / UP - 0.5) for c in cs]
    for i, hh in enumerate(hier):
        if hh[3] != -1 or len(simp[i]) < 3: continue
        rings = [simp[i]]
        j = hh[2]
        while j != -1:
            if len(simp[j]) >= 3: rings.append(simp[j])
            j = hier[j][0]
        polys.append(rings)
    return polys


def trace(im, level, scale, zoom=vec.ZOOM_FINAL):
    """Layers [(rgb, polys)] bottom to top."""
    tol = 0.25 / (scale * zoom)
    p = LEVELS[level]
    labels, centres, inks, alpha = decompose(im, level)
    areas = [(labels == i).sum() for i in range(len(centres))]
    order = [i for i in np.argsort(areas)[::-1] if areas[i] > 0]
    layers = []
    remaining = labels >= 0
    for n, i in enumerate(order):
        soft = alpha.copy() if n == 0 else remaining.astype(np.float32)
        layers.append((centres[i], contours(soft, tol, p['sigma'])))
        remaining = remaining & (labels != i)
    for colour, cov in inks:
        layers.append((colour, contours(cov, tol, 0.0, 0.35)))
    return layers


def measure(layers):
    verts = rings = tris = npoly = 0
    for _, polys in layers:
        for poly in polys:
            n = sum(len(r) for r in poly)
            verts += n; rings += len(poly); npoly += 1
            tris += n - 2 + 2 * (len(poly) - 1)
    idx = 2 if verts < 65536 else 4
    stored = len(layers) * 4 + rings * 2 + verts * 4  # colour + ring counts + int16 x,y
    return {'layers': len(layers), 'polygons': npoly, 'rings': rings, 'verts': verts, 'tris': tris,
            'storedBytes': stored, 'gpuBytes': verts * 12 + tris * 3 * idx}


def to_svg(layers, w, h):
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">']
    for rgb, polys in layers:
        col = '#%02x%02x%02x' % tuple(int(round(c * 255)) for c in np.clip(rgb, 0, 1))
        d = ''.join('M' + 'L'.join(f'{x + 0.5:.2f} {y + 0.5:.2f}' for x, y in ring) + 'Z'
                    for poly in polys for ring in poly)
        if d: out.append(f'<path fill="{col}" fill-rule="evenodd" d="{d}"/>')
    out.append('</svg>')
    return ''.join(out)


def render(layers, size, scale, zoom):
    w, h = vec.shown_size(size, scale, zoom)
    return vec.rasterize_svg(to_svg(layers, *size), w, h)


# ---------------------------------------------------------------- hybrids

def down(arr, f):
    h, w = arr.shape[:2]
    return vec.resize_premul(arr, max(1, math.ceil(w / f)), max(1, math.ceil(h / f)), Image.BOX)


def up_to(arr, w, h):
    return vec.resize_premul(arr, w, h, Image.BILINEAR)


def stored_texture(bytes_per_px, w, h, f):
    return math.ceil(w / f / 4) * 4 * math.ceil(h / f / 4) * 4 * bytes_per_px


def raster_at(im, f, scale, zoom):
    """Raster stored at 1/f linear resolution, shown at zoom."""
    src = vec.premul(im)
    small = down(src, f) if f > 1 else src
    w, h = vec.shown_size(im.size, scale, zoom)
    method = Image.BOX if w < small.shape[1] else Image.BILINEAR
    return vec.resize_premul(small, w, h, method), stored_texture(1, im.width, im.height, f)


def vector_plus_residual(im, layers, f, scale, zoom):
    """Vector layers plus a low-res RGB correction (signed, premultiplied) restoring soft shading."""
    src = vec.premul(im)
    full = vec.rasterize_svg(to_svg(layers, *im.size), im.width, im.height)
    res = down(src - full, f)
    w, h = vec.shown_size(im.size, scale, zoom)
    vec_d = render(layers, im.size, scale, zoom)
    corr = up_to(res, w, h)
    out = vec_d.copy()
    out[..., :3] = np.clip(vec_d[..., :3] + corr[..., :3] * vec_d[..., 3:4], 0, 1)  # colour only, inside the shape
    return out, stored_texture(1, im.width, im.height, f)  # BC7 (BC1 would halve it)


def sdf(mask, spread):
    """Signed distance (px, + inside) clipped to +-spread, mapped to 0..1."""
    m = (mask > 0.5).astype(np.uint8)
    inside = cv2.distanceTransform(m, cv2.DIST_L2, 5)
    outside = cv2.distanceTransform(1 - m, cv2.DIST_L2, 5)
    d = np.where(m > 0, inside - 0.5, -(outside - 0.5))
    return np.clip(d / spread * 0.5 + 0.5, 0, 1).astype(np.float32)


def sdf_shape(field, f, w, h, px_per_src, spread):
    """Reconstruct coverage from a downsampled SDF shown at w x h."""
    small = cv2.resize(field, (max(1, math.ceil(field.shape[1] / f)), max(1, math.ceil(field.shape[0] / f))),
                       interpolation=cv2.INTER_AREA)
    small = np.round(small * 255) / 255  # 8-bit channel
    bigf = cv2.resize(small, (w, h), interpolation=cv2.INTER_LINEAR)
    dist_src = (bigf - 0.5) / 0.5 * spread  # source px
    return np.clip(dist_src * px_per_src + 0.5, 0, 1)  # 1 screen-px antialiasing ramp


def color_plus_sdf(im, f, scale, zoom):
    """Low-res colour (BC7) + silhouette and line-art distance fields (BC5, two channels), all at 1/f."""
    a = np.asarray(im, np.float32) / 255
    alpha, rgb = a[..., 3], a[..., :3]
    ink = line_art(rgb, alpha)
    core = ink > 0.35
    darkest = cv2.erode(np.where((alpha >= 0.5)[..., None], rgb, 1).astype(np.float32), np.ones((3, 3), np.uint8))
    ink_color = np.median(darkest[core], 0) if core.any() else np.zeros(3, np.float32)
    keep = (alpha >= 0.5) & ~core
    filled = nearest_fill(rgb, keep)  # colour without lines, extended outward so filtering keeps edges clean
    w, h = vec.shown_size(im.size, scale, zoom)
    sw, sh = max(1, math.ceil(im.width / f)), max(1, math.ceil(im.height / f))
    col = cv2.resize(cv2.resize(filled, (sw, sh), interpolation=cv2.INTER_AREA), (w, h), interpolation=cv2.INTER_LINEAR)
    pxs, spread = scale * zoom, 2.0 * f
    sil = sdf_shape(sdf(alpha, spread), f, w, h, pxs, spread)
    inkc = sdf_shape(sdf(core.astype(np.float32), spread), f, w, h, pxs, spread) * sil
    rgb_out = col * (1 - inkc[..., None]) + ink_color * inkc[..., None]
    out = np.concatenate([rgb_out * sil[..., None], sil[..., None]], -1)
    return out.astype(np.float32), stored_texture(1, im.width, im.height, f) * 2  # BC7 colour + BC5 fields


def indexed(im, k, scale, zoom, shading_f=None):
    """Palette-indexed drawing: k colours (incl. ink), nibble-packed when k <= 16. Optional low-res
    luminance shading channel (BC4, 0.5 B/px) at 1/shading_f."""
    a = np.asarray(im, np.float32) / 255
    alpha = a[..., 3]
    solid = alpha > 0.02
    rgb = a[..., :3]
    samples = rgb[solid].astype(np.float32)
    crit = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 30, 1e-3)
    sub = samples[np.random.default_rng(0).choice(len(samples), min(len(samples), 20000), replace=False)]
    kk = min(k - 1, len(np.unique(sub.round(3), axis=0)))  # index 0 = transparent
    _, _, centres = cv2.kmeans(sub, kk, None, crit, 2, cv2.KMEANS_PP_CENTERS)
    lab = ((rgb[..., None, :] - centres[None, None]) ** 2).sum(-1).argmin(-1)
    q = centres[lab]
    # alpha: index 0 below 0.5; edge softness comes from filtering the decoded colour (shader does 4 taps)
    qa = (alpha >= 0.5).astype(np.float32)
    bpp = 0.5 if k <= 16 else 1.0
    if shading_f:
        ratio = np.where(solid, (lum(rgb) + 0.02) / (lum(q) + 0.02), 1.0).astype(np.float32)
        small = cv2.resize(ratio, (math.ceil(im.width / shading_f), math.ceil(im.height / shading_f)), interpolation=cv2.INTER_AREA)
        ratio = cv2.resize(small, im.size, interpolation=cv2.INTER_LINEAR)
        q = np.clip(q * ratio[..., None], 0, 1)
    pre = np.concatenate([q * qa[..., None], qa[..., None]], -1).astype(np.float32)
    w, h = vec.shown_size(im.size, scale, zoom)
    method = Image.BOX if w < im.width else Image.BILINEAR
    out = vec.resize_premul(pre, w, h, method)
    bytes_ = math.ceil(im.width * im.height * bpp) + k * 4
    if shading_f: bytes_ += stored_texture(0.5, im.width, im.height, shading_f)
    return out, bytes_
