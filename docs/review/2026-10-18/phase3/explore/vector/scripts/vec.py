"""Vector-representation experiments: trace, measure, triangulate, render, compare."""
import io, re, gzip, math
import numpy as np
from PIL import Image
import vtracer, cairosvg
from svgelements import Path, Move, Line, CubicBezier, QuadraticBezier, Close

# Detail levels for vtracer (colour, stacked shapes, Bezier splines).
LEVELS = {
    'fine':   dict(filter_speckle=1, color_precision=8, layer_difference=6,  corner_threshold=60, length_threshold=3.5, splice_threshold=45),
    'medium': dict(filter_speckle=4, color_precision=6, layer_difference=16, corner_threshold=60, length_threshold=4.0, splice_threshold=45),
    'coarse': dict(filter_speckle=8, color_precision=5, layer_difference=32, corner_threshold=60, length_threshold=5.0, splice_threshold=45),
    'poster': dict(filter_speckle=16, color_precision=4, layer_difference=64, corner_threshold=60, length_threshold=6.0, splice_threshold=45),
}

ZOOM_MATCH, ZOOM_FINAL = 1.4, 2.8


def load(path):
    return Image.open(path).convert('RGBA')


def hard_alpha(im):
    """vtracer keys out transparent pixels; give it a clean 0/255 alpha."""
    a = np.array(im)
    a[..., 3] = np.where(a[..., 3] >= 128, 255, 0)
    a[a[..., 3] == 0, :3] = 0
    return Image.fromarray(a, 'RGBA')


def trace(im, level):
    im = hard_alpha(im)
    px = [tuple(p) for p in np.array(im).reshape(-1, 4)]
    return vtracer.convert_pixels_to_svg(px, size=im.size, colormode='color', hierarchical='stacked',
                                         mode='spline', max_iterations=10, path_precision=2, **LEVELS[level])


PATH_RE = re.compile(r'<path d="([^"]*)" fill="(#[0-9A-Fa-f]{6})" transform="translate\(([-\d.]+),([-\d.]+)\)"/>')


def parse(svg):
    """[(colour, [ring, ...])] where each ring is a list of segments in absolute drawing px."""
    shapes = []
    for d, fill, tx, ty in PATH_RE.findall(svg):
        tx, ty = float(tx), float(ty)
        rings, ring = [], []
        for seg in Path(d):
            if isinstance(seg, Move):
                if ring: rings.append(ring)
                ring = []
            elif isinstance(seg, (Line, Close)):
                if seg.start is not None and seg.end is not None and (seg.start != seg.end):
                    ring.append(('L', (seg.start.x + tx, seg.start.y + ty), (seg.end.x + tx, seg.end.y + ty)))
            elif isinstance(seg, CubicBezier):
                ring.append(('C', *[(p.x + tx, p.y + ty) for p in (seg.start, seg.control1, seg.control2, seg.end)]))
            elif isinstance(seg, QuadraticBezier):
                ring.append(('Q', *[(p.x + tx, p.y + ty) for p in (seg.start, seg.control, seg.end)]))
        if ring: rings.append(ring)
        shapes.append((fill, rings))
    return shapes


def _flat_cubic(p0, p1, p2, p3, tol, out, depth=0):
    # flatness: max distance of control points from chord
    (x0, y0), (x1, y1), (x2, y2), (x3, y3) = p0, p1, p2, p3
    ux, uy = 3 * x1 - 2 * x0 - x3, 3 * y1 - 2 * y0 - y3
    vx, vy = 3 * x2 - x0 - 2 * x3, 3 * y2 - y0 - 2 * y3
    if depth > 16 or max(ux * ux, vx * vx) + max(uy * uy, vy * vy) <= 16 * tol * tol:
        out.append(p3); return
    m = lambda a, b: ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
    p01, p12, p23 = m(p0, p1), m(p1, p2), m(p2, p3)
    p012, p123 = m(p01, p12), m(p12, p23)
    mid = m(p012, p123)
    _flat_cubic(p0, p01, p012, mid, tol, out, depth + 1)
    _flat_cubic(mid, p123, p23, p3, tol, out, depth + 1)


def flatten(rings, tol):
    polys = []
    for ring in rings:
        pts = [ring[0][1]]
        for seg in ring:
            if seg[0] == 'L': pts.append(seg[2])
            elif seg[0] == 'C': _flat_cubic(seg[1], seg[2], seg[3], seg[4], tol, pts)
            else:
                p0, c, p3 = seg[1], seg[2], seg[3]
                _flat_cubic(p0, (p0[0] + 2 / 3 * (c[0] - p0[0]), p0[1] + 2 / 3 * (c[1] - p0[1])),
                            (p3[0] + 2 / 3 * (c[0] - p3[0]), p3[1] + 2 / 3 * (c[1] - p3[1])), p3, tol, pts)
        # drop closing duplicate
        if len(pts) > 1 and abs(pts[0][0] - pts[-1][0]) < 1e-9 and abs(pts[0][1] - pts[-1][1]) < 1e-9: pts.pop()
        if len(pts) >= 3: polys.append(pts)
    return polys


def measure(svg, scale):
    """Stored and GPU sizes of one traced drawing. `scale` = design px per source px."""
    shapes = parse(svg)
    n_paths = len(shapes)
    n_lines = sum(1 for _, rs in shapes for r in rs for s in r if s[0] == 'L')
    n_curves = sum(1 for _, rs in shapes for r in rs for s in r if s[0] != 'L')
    n_rings = sum(len(rs) for _, rs in shapes)
    # Compact binary: int16 coords (1/8 px), per path colour+count 5 B, per ring 2 B, per segment 2 bits type.
    binary = n_paths * 5 + n_rings * 2 + n_lines * 4 + n_curves * 12 + math.ceil((n_lines + n_curves) / 4)
    out = {'paths': n_paths, 'rings': n_rings, 'lines': n_lines, 'curves': n_curves,
           'svgBytes': len(svg.encode()), 'svgGzip': len(gzip.compress(svg.encode(), 9)), 'binaryBytes': binary}
    for zoom, key in ((ZOOM_MATCH, 'match'), (ZOOM_FINAL, 'final')):
        tol = 0.25 / (scale * zoom)  # 0.25 screen px chord error
        verts = tris = 0
        for _, rings in shapes:
            polys = flatten(rings, tol)
            if not polys: continue
            n = sum(len(p) for p in polys)
            verts += n
            tris += n - 2 + 2 * (len(polys) - 1)  # exact for a polygon with holes
        # vertex: float32 x,y + RGBA8 colour = 12 B; index uint16/uint32
        idx = 2 if verts < 65536 else 4
        out[f'verts_{key}'] = verts
        out[f'tris_{key}'] = tris
        out[f'gpuBytes_{key}'] = verts * 12 + tris * 3 * idx
    return out


def rasterize_svg(svg, w, h):
    png = cairosvg.svg2png(bytestring=svg.encode(), output_width=w, output_height=h)
    im = Image.open(io.BytesIO(png)).convert('RGBA')
    if im.size != (w, h): im = im.resize((w, h), Image.BILINEAR)
    return premul(im)


def premul(im):
    """float32 premultiplied RGBA 0..1"""
    a = np.asarray(im.convert('RGBA'), dtype=np.float32) / 255
    a[..., :3] *= a[..., 3:4]
    return a


def from_premul(a):
    a = np.clip(a, 0, 1)
    rgb = np.where(a[..., 3:4] > 1e-6, a[..., :3] / np.maximum(a[..., 3:4], 1e-6), 0)
    return Image.fromarray((np.concatenate([rgb, a[..., 3:4]], -1) * 255 + 0.5).astype(np.uint8), 'RGBA')


def resize_premul(arr, w, h, method):
    """Resample a premultiplied float image like a GPU sampler would (premultiplied filtering)."""
    chans = [np.asarray(Image.fromarray(arr[..., c].astype(np.float32), 'F').resize((w, h), method)) for c in range(4)]
    return np.stack(chans, -1)


def shown_size(size, scale, zoom):
    return max(1, round(size[0] * scale * zoom)), max(1, round(size[1] * scale * zoom))


def reference(im, scale, zoom):
    """The original drawing as the game shows it: area-filtered down, bilinear up."""
    w, h = shown_size(im.size, scale, zoom)
    method = Image.BOX if w < im.size[0] else Image.BILINEAR
    return resize_premul(premul(im), w, h, method)


def error(ref, cand):
    """Mean abs premultiplied-RGBA difference over pixels either covers (0..1, like signatureDiff),
    plus 95th percentile and PSNR over the box, and silhouette IoU at alpha 0.5."""
    cov = (ref[..., 3] > 0.02) | (cand[..., 3] > 0.02)
    d = np.abs(ref - cand).mean(-1)
    mse = ((ref - cand) ** 2).mean()
    a, b = ref[..., 3] > 0.5, cand[..., 3] > 0.5
    return {'mae': float(d[cov].mean()) if cov.any() else 0.0,
            'p95': float(np.percentile(d[cov], 95)) if cov.any() else 0.0,
            'psnr': float(10 * np.log10(1 / max(mse, 1e-10))),
            'iou': float((a & b).sum() / max((a | b).sum(), 1))}


def over(arr, bg):
    """Composite premultiplied onto a solid RGB background -> uint8 image."""
    out = arr[..., :3] + np.array(bg, np.float32) / 255 * (1 - arr[..., 3:4])
    return Image.fromarray((np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8), 'RGB')


def bc7_bytes(w, h):
    return math.ceil(w / 4) * math.ceil(h / 4) * 16
