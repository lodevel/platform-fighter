#!/usr/bin/env python3
"""Pack a fighter's cutouts into per-clip runtime strips/atlases (any fighter).

Run: ~/ComfyUI/.venv/bin/python -I tools/fighter-pack.py --fighter <id> SPEC.json OUT_DIR [--layout grid|tight] [--jobs N] [--warn-only]
     ~/ComfyUI/.venv/bin/python -I tools/fighter-pack.py --repack-installed <id> STAGING_DIR [--only clip,clip]

SPEC.json
  {
    "ppu": 29.3272,              # art px per native unit (scale-contract.json); default per fighter
    "bodyHeight": 84,            # <ID>_TUNING.height (src/characters/<Fighter>.ts); default per fighter
    "clips": {
      "<clip>": {
        "pad": 4,                # optional extra packed-px margin around the union extent
        "loopDuration": 140,     # optional pass-through clip fields: loopDuration, actionFrameStarts,
        "actionFrameStarts": [], #   itemAttachmentPoses, sourceRootDelta (copied verbatim to the entry)
        "frames": [
          {"png": "path/to/cutout.png",     # repo-relative or absolute
           "crop": [x, y, w, h],            # optional: use only this cell of a page PNG; root is cell-relative
           "root": [x, y],                  # ground root inside that PNG (or crop), art px
           "nativeSample": 22,
           "grounded": true,                # optional: run the floor check on this frame
           "snapRootToFloor": false}        # optional: root y := lowest opaque row edge
        ]}}}

--fighter selects the ppu/bodyHeight defaults in FIGHTER_DEFAULTS; spec fields override them, and a
fighter without defaults must give both in the spec.

Scale: world-per-art-px is 5/ppu (5 world units per native unit). Packed density is
Pikachu's 0.4666667 world per packed px, so every frame is downscaled by the one
factor s = (5/ppu)/0.4666667 (~0.36534 for ppu 29.3272). Resampling is LANCZOS on
premultiplied alpha, so transparent texels never bleed dark/magenta colour.

Cell: per clip, union of all frames' alpha extents around the root (packed px) plus
pad, rounded up to a multiple of 8; the root lands on the same integer pixel (RX,RY)
of every cell. The union cell (frameWidth x frameHeight, root) is the same in both layouts.

Output: OUT_DIR/animations/<clip>.png (the `strip` path of each entry), OUT_DIR/frames-fragment.json and
OUT_DIR/pack-report.json.

--layout grid (default): cells go row-major into a grid, wrapped so no texture dimension exceeds
4096 (a clip that does not fit one 4096x4096 texture is an error, there is no paging). Entry fields:
strip, sha256, frameCount, frameWidth, frameHeight, sourceCells [, columns, rows]. This is what the
current runtime (Phaser load.spritesheet in PreloadScene) reads for DK and Pikachu; it stays the
default until the packed-atlas runtime support (art-budget plan T2b) lands.

--layout tight: see tight_pack(). Entry fields: strip, sha256, frameCount, frameWidth, frameHeight,
atlas [W, H], trims [[x, y, w, h, dx, dy], ...] (one per drawing; rect in the atlas, offset in the cell).

--repack-installed <fighter> STAGING_DIR: cut every drawing's cell out of the installed strip
(assets/characters/<fighter>/, no resampling), tight-pack it, and write a staging copy of frames.json
(only the layout fields and sha256 rewritten, every other key in place and order) plus the new atlases
and repack-report.json (per-drawing rgbaSha256 of the premultiplied cell, proven equal to the old cell).
Never writes under assets/.

bodyCentreFromRootY (runtime contract, MatchScene ~6064):
  sprite.y = body_centre_y - bodyCentreFromRootY, with the sprite origin at the root.
  The root therefore sits at body_centre_y - bodyCentreFromRootY, which must be the
  body's bottom (centre + height/2) so the feet stand on the floor:
      bodyCentreFromRootY = -(DK_TUNING.height / 2) = -84/2 = -42
  This is the same convention as Pikachu (-25 = -50/2). It is a property of the
  physics body, not of the art scale, so it is unchanged by the repack.
"""
import argparse
import hashlib
import json
import math
import multiprocessing
import shutil
import sys
from functools import lru_cache
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

sys.path.insert(0, str(Path(__file__).resolve().parent))   # python -I does not add the script dir
import fighter_frames

ROOT = Path(__file__).resolve().parent.parent
PACKED_WORLD_PER_PX = 0.4666667       # Pikachu: 4 * 70 / 600
WORLD_PER_NATIVE = 5.0
MAX_DIM = 4096
GUTTER = 2                             # transparent px between tight-packed rects
ALIGN = 4                              # tight rect origins and atlas size are multiples of this (block-compression grid)
LAYOUTS = ('grid', 'tight')
ALPHA_SOLID = 128                      # "opaque" for floor checks
FAINT_ALPHA = 32                       # below this a resampled texel takes the nearest solid colour
PALETTE_MIN_TEXELS, PALETTE_TOLERANCE = 16, 8   # halo test: an edge colour the drawing uses this often is no halo
DEFAULT_BODY_HEIGHT = 84               # DK; tools/dk-native-receiving.py imports this name
FIGHTER_DEFAULTS = {                   # id -> (ppu, bodyHeight)
    'donkeykong': (29.3272, DEFAULT_BODY_HEIGHT),
    'link': (WORLD_PER_NATIVE / PACKED_WORLD_PER_PX, 72),   # tools/link-render-clip.py draws at packed scale: downscale 1
}
CLIP_PASSTHROUGH = ('loopDuration', 'actionFrameStarts', 'itemAttachmentPoses', 'sourceRootDelta')


def resolve(p: str) -> Path:
    path = Path(p)
    return path if path.is_absolute() else ROOT / path


@lru_cache(maxsize=16)
def load_page(path: Path) -> Image.Image:
    return Image.open(path).convert('RGBA')


def load_cutout(fr) -> Image.Image:
    """The frame's PNG, or only its `crop` cell [x, y, w, h] of a page PNG."""
    page = load_page(resolve(fr['png']))
    if 'crop' not in fr:
        return page
    x, y, w, h = fr['crop']
    return page.crop((x, y, x + w, y + h))


def ceil8(v: float) -> int:
    return int(math.ceil(v / 8.0) * 8)


def alpha_bbox(a: np.ndarray, threshold: int = 0):
    """Edge-based bbox (x0, x1, y0, y1) of texels with alpha > threshold."""
    ys, xs = np.nonzero(a > threshold)
    if len(xs) == 0:
        raise ValueError('frame has no opaque pixels')
    return int(xs.min()), int(xs.max()) + 1, int(ys.min()), int(ys.max()) + 1


def render_cell(img: Image.Image, root, s: float, cw: int, ch: int, rx: int, ry: int) -> Image.Image:
    """Resample the whole source so the source root maps exactly to (rx, ry)."""
    pad = int(math.ceil(max(cw, ch) / s)) + 4
    padded = Image.new('RGBA', (img.width + 2 * pad, img.height + 2 * pad), (0, 0, 0, 0))
    padded.paste(img, (pad, pad))
    px, py = root[0] + pad, root[1] + pad
    box = (px - rx / s, py - ry / s, px + (cw - rx) / s, py + (ch - ry) / s)
    src = np.array(padded).astype(np.float32)
    alpha = src[..., 3] / 255.0
    chans = [src[..., c] * alpha for c in range(3)] + [src[..., 3]]   # premultiplied RGB + alpha
    res = [np.array(Image.fromarray(ch_, 'F').resize((cw, ch), Image.Resampling.LANCZOS, box=box))
           for ch_ in chans]
    a = np.clip(res[3], 0, 255)
    live = a >= 0.5
    # Anti-ringing: LANCZOS lobes overshoot past the colours under the filter, e.g. a partly covered texel of a thin
    # dark outline comes out darker than the ink itself. Clamp each un-premultiplied channel to the range of the
    # visible source colours within the filter support around the texel centre.
    radius = int(math.ceil(3 / min(s, 1.0)))
    y0, x0 = (max(0, int(math.floor(box[i])) - radius - 1) for i in (1, 0))
    near = src[y0:int(math.ceil(box[3])) + radius + 2, x0:int(math.ceil(box[2])) + radius + 2]   # the filter's reach
    visible = near[..., 3] > 0
    sy = np.clip(np.floor(box[1] + (np.arange(ch) + 0.5) / s).astype(int) - y0, 0, near.shape[0] - 1)
    sx = np.clip(np.floor(box[0] + (np.arange(cw) + 0.5) / s).astype(int) - x0, 0, near.shape[1] - 1)
    out = np.zeros((ch, cw, 4), np.uint8)
    for c in range(3):                                                # un-premultiply, clamp
        lo = ndimage.minimum_filter(np.where(visible, near[..., c], 255.0), size=2 * radius + 1)[np.ix_(sy, sx)]
        hi = ndimage.maximum_filter(np.where(visible, near[..., c], 0.0), size=2 * radius + 1)[np.ix_(sy, sx)]
        value = np.clip(res[c] / np.maximum(a, 1e-3) * 255.0, 0, 255)
        out[..., c] = np.where(live, np.clip(value, np.minimum(lo, hi), hi), 0).round()
    out[..., 3] = np.where(live, a.round(), 0)
    # Faint texels (< FAINT_ALPHA) are mostly LANCZOS ringing; un-premultiplying them amplifies
    # noise into off colours (e.g. pink beside a dark outline). Give them the nearest solid colour.
    faint = (out[..., 3] > 0) & (out[..., 3] < FAINT_ALPHA)
    solid = out[..., 3] >= ALPHA_SOLID
    if faint.any() and solid.any():
        _, (iy, ix) = ndimage.distance_transform_edt(~solid, return_indices=True)
        out[faint, :3] = out[iy[faint], ix[faint], :3]
    return Image.fromarray(out, 'RGBA')


def fringe_report(cell: np.ndarray):
    """(edge texels, magenta/pink edge texels, edge texels off the nearest solid colour)."""
    a = cell[..., 3]
    rgb = cell[..., :3].astype(int)
    edge = (a > 0) & (a < 250)
    n_edge = int(edge.sum())
    if n_edge == 0:
        return 0, 0, 0
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    magenta = edge & (a >= 16) & (r > g + 50) & (b > g + 50) & (r > 120) & (b > 120)
    # Halo test: an edge texel's colour must lie inside the per-channel range of the
    # well-covered (alpha >= 128) texels within 3 px, +-24. Dark/magenta fringe falls outside.
    solid = a >= 128
    if not solid.any():
        return n_edge, int(magenta.sum()), 0
    out_of_range = np.zeros(a.shape, bool)
    for c in range(3):
        ch_ = rgb[..., c].astype(np.float32)
        lo = ndimage.minimum_filter(np.where(solid, ch_, 1e9), size=7)
        hi = ndimage.maximum_filter(np.where(solid, ch_, -1e9), size=7)
        out_of_range |= (ch_ < lo - 24) | (ch_ > hi + 24)
    off = edge & (a >= 64) & out_of_range & (ndimage.maximum_filter(solid, size=7))
    # An outline thinner than a texel (the ink of a sword blade) has no fully covered texel of its own: its edge texels
    # are the drawing's ink at partial alpha beside lighter ink/blade mixes. A colour that the drawing itself uses
    # (PALETTE_MIN_TEXELS opaque texels within +-PALETTE_TOLERANCE) is no halo; an off-palette colour still is.
    if off.any():
        colours, counts = np.unique(rgb[a >= 250], axis=0, return_counts=True)
        palette = colours[counts >= PALETTE_MIN_TEXELS]
        if len(palette):
            ys, xs = np.nonzero(off)
            known = (np.abs(rgb[ys, xs][:, None, :] - palette[None, :, :]) <= PALETTE_TOLERANCE).all(axis=2).any(axis=1)
            off[ys[known], xs[known]] = False
    return n_edge, int(magenta.sum()), int(off.sum())


def ceil_to(v: int, m: int) -> int:
    return -(-v // m) * m


def grid_pack(cells, cw: int, ch: int, name: str):
    """Row-major grid of full cells, at most MAX_DIM wide/high. Returns (atlas array, layout fields)."""
    n = len(cells)
    columns = min(n, MAX_DIM // cw)
    if columns < 1:
        raise ValueError(f'{name}: cell {cw}x{ch} exceeds {MAX_DIM}')
    rows = math.ceil(n / columns)
    if rows * ch > MAX_DIM:
        raise ValueError(f'{name}: {n} cells of {cw}x{ch} exceed one {MAX_DIM}x{MAX_DIM} texture (use --layout tight)')
    atlas = np.zeros((rows * ch, columns * cw, 4), np.uint8)
    source_cells = [[k % columns, k // columns] for k in range(n)]
    for (cx, cy), cell in zip(source_cells, cells):
        atlas[cy * ch:(cy + 1) * ch, cx * cw:(cx + 1) * cw] = cell
    layout = {'sourceCells': source_cells}
    if rows > 1:
        layout.update(columns=columns, rows=rows)
    return atlas, layout


def shelf_layout(sizes, order, width):
    """Shelf-pack rects (w, h) left to right in `order` into at most `width` columns.
    Returns (positions by index, used width, used height) or None when a rect is wider than `width`."""
    pos, x, y, shelf_h, used_w = {}, 0, 0, 0, 0
    for i in order:
        w, h = sizes[i]
        if w > width:
            return None
        if x and x + w > width:
            y, x, shelf_h = ceil_to(y + shelf_h + GUTTER, ALIGN), 0, 0
        pos[i] = (x, y)
        shelf_h = max(shelf_h, h)
        used_w = max(used_w, x + w)
        x = ceil_to(x + w + GUTTER, ALIGN)
    return pos, ceil_to(used_w, ALIGN), ceil_to(y + shelf_h, ALIGN)


def tight_pack(cells):
    """Tight-pack equally sized RGBA cells. Returns (atlas array, atlas [W, H], trims).

    trims[i] = [x, y, w, h, dx, dy]: the rect (x, y, w, h) of the atlas holds cell i's alpha bounding box grown by
    1 px and clamped to the cell; (dx, dy) is where that rect sits in the cell. Shelf packing in the order
    (-h, -w, index), 2 px gutter, rect origins and atlas size multiples of 4, atlas at most 4096 x 4096. The atlas
    width is the one (a multiple of 4) giving the smallest area, then the smallest width. Raises ValueError when
    nothing fits in 4096 x 4096. Deterministic."""
    ch, cw = cells[0].shape[:2]
    rects = []                                   # (dx, dy, w, h) per cell
    for cell in cells:
        a = cell[..., 3]
        if not a.any():
            rects.append((0, 0, 1, 1))           # empty drawing: one transparent texel keeps the frame addressable
            continue
        x0, x1, y0, y1 = alpha_bbox(a)
        x0, y0, x1, y1 = max(x0 - 1, 0), max(y0 - 1, 0), min(x1 + 1, cw), min(y1 + 1, ch)
        rects.append((x0, y0, x1 - x0, y1 - y0))
    sizes = [(w, h) for _, _, w, h in rects]
    order = sorted(range(len(cells)), key=lambda i: (-sizes[i][1], -sizes[i][0], i))
    best = None
    for width in range(ceil_to(max(w for w, _ in sizes), ALIGN), MAX_DIM + 1, ALIGN):
        placed = shelf_layout(sizes, order, width)
        if placed is None or placed[2] > MAX_DIM:
            continue
        key = (placed[1] * placed[2], placed[1])
        if best is None or key < best[0]:
            best = (key, placed)
    if best is None:
        raise ValueError(f'{len(cells)} drawings do not fit one {MAX_DIM}x{MAX_DIM} atlas')
    pos, aw, ah = best[1]
    atlas = np.zeros((ah, aw, 4), np.uint8)
    trims = []
    for i, (dx, dy, w, h) in enumerate(rects):
        x, y = pos[i]
        atlas[y:y + h, x:x + w] = cells[i][dy:dy + h, dx:dx + w]
        trims.append([x, y, w, h, dx, dy])
    return atlas, [aw, ah], trims


def tight_pack_layout(cells, cw: int, ch: int, name: str):
    atlas, size, trims = tight_pack(cells)
    return atlas, {'atlas': size, 'trims': trims}


def pack_clip(name, clip, s, body_centre, out_dir, fails, layout_name='grid'):
    loaded = []
    for fr in clip['frames']:
        path = resolve(fr['png'])
        img = load_cutout(fr)
        a = np.array(img)[..., 3]
        rx, ry = float(fr['root'][0]), float(fr['root'][1])
        if fr.get('snapRootToFloor'):
            ry = float(alpha_bbox(a, ALPHA_SOLID)[3])
        loaded.append(dict(img=img, root=(rx, ry), bbox=alpha_bbox(a), path=path, fr=fr,
                           src_floor=alpha_bbox(a, ALPHA_SOLID)[3] - ry))

    pad = int(clip.get('pad', 4))
    left = max((l['root'][0] - l['bbox'][0]) * s for l in loaded)
    right = max((l['bbox'][1] - l['root'][0]) * s for l in loaded)
    up = max((l['root'][1] - l['bbox'][2]) * s for l in loaded)
    down = max((l['bbox'][3] - l['root'][1]) * s for l in loaded)
    rx = int(math.ceil(left)) + pad
    ry = int(math.ceil(up)) + pad
    cw = ceil8(rx + math.ceil(right) + pad)
    ch = ceil8(ry + max(math.ceil(down), 0) + pad)

    n = len(loaded)
    rendered, checks = [], []
    for i, l in enumerate(loaded):
        cell = render_cell(l['img'], l['root'], s, cw, ch, rx, ry)
        arr = np.array(cell)
        rendered.append(arr)
        bx0, bx1, by0, by1 = alpha_bbox(arr[..., 3])
        margin = min(bx0, cw - bx1, by0, ch - by1)
        floor = alpha_bbox(arr[..., 3], ALPHA_SOLID)[3] - ry
        n_edge, magenta, dark = fringe_report(arr)
        checks.append(dict(frame=i, png=l['path'].name, cellMarginPx=margin,
                           floorMinusRootPackedPx=round(float(floor), 2),
                           sourceFloorMinusRootArtPx=round(float(l['src_floor']), 2),
                           edgeTexels=n_edge, magentaEdgeTexels=magenta, offColourEdgeTexels=dark))
        if margin < 1:
            fails.append(f'{name}[{i}] alpha bbox touches cell border')
        if l['fr'].get('grounded') and abs(floor) > 1.0:
            fails.append(f'{name}[{i}] ({l["path"].name}) floor {floor:+.2f} packed px from root (>1); '
                         f'source floor {l["src_floor"]:+.1f} art px (use snapRootToFloor or fix the root)')
        if magenta:
            fails.append(f'{name}[{i}] {magenta} magenta/pink edge texels')
        if n_edge and dark > max(3, 0.02 * n_edge):
            fails.append(f'{name}[{i}] {dark}/{n_edge} edge texels differ from nearest solid colour')

    atlas, layout = (grid_pack if layout_name == 'grid' else tight_pack_layout)(rendered, cw, ch, name)
    strip = f'animations/{name}.png'
    png = out_dir / strip
    png.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(atlas, 'RGBA').save(png)
    entry = {'strip': strip, 'sha256': hashlib.sha256(png.read_bytes()).hexdigest(),
             'frameCount': n, 'frameWidth': cw, 'frameHeight': ch, **layout}
    saved = np.array(Image.open(png).convert('RGBA'))
    for i, cell in enumerate(fighter_frames.read_cells(entry, saved)):   # root registration: saved cell == rendered cell
        if not np.array_equal(cell, rendered[i]):
            fails.append(f'{name}[{i}] saved cell differs from rendered cell')
    entry.update(root=[rx, ry], scaleToWorld=PACKED_WORLD_PER_PX, bodyCentreFromRootY=body_centre,
                 nativeSampleIndices=[l['fr'].get('nativeSample') for l in loaded])
    entry.update({key: clip[key] for key in CLIP_PASSTHROUGH if key in clip})
    return entry, checks, dict(format=layout_name, atlas=[atlas.shape[1], atlas.shape[0]], cell=[cw, ch],
                               root=[rx, ry], frames=n)


def pack_clip_job(job):
    """pack_clip() for a worker process: returns (name, entry, checks, info, failures)."""
    name, clip, s, body_centre, out_dir, layout = job
    fails = []
    entry, checks, info = pack_clip(name, clip, s, body_centre, out_dir, fails, layout)
    return name, entry, checks, info, fails


def pack_spec(spec, out_dir: Path, fighter: str, layout: str = 'grid', jobs: int = 1):
    """Pack every clip of a spec into out_dir (each PNG at its entry's `strip` path, out_dir/animations/<clip>.png),
    clips spread over `jobs` processes (the output does not depend on it); returns (frames fragment, report, failures)."""
    out_dir.mkdir(parents=True, exist_ok=True)
    default_ppu, default_height = FIGHTER_DEFAULTS.get(fighter, (None, None))
    ppu = spec.get('ppu', default_ppu)
    height = spec.get('bodyHeight', default_height)
    if ppu is None or height is None:
        raise SystemExit(f'fighter {fighter!r} has no defaults: give "ppu" and "bodyHeight" in the spec')
    ppu = float(ppu)
    s = (WORLD_PER_NATIVE / ppu) / PACKED_WORLD_PER_PX
    body_centre = -float(height) / 2
    body_centre = int(body_centre) if body_centre == int(body_centre) else body_centre
    work = [(name, clip, s, body_centre, out_dir, layout) for name, clip in spec['clips'].items()]
    if jobs > 1:
        with multiprocessing.get_context('fork').Pool(jobs) as pool:
            results = pool.map(pack_clip_job, work, chunksize=1)
    else:
        results = [pack_clip_job(j) for j in work]
    fails, fragment, report = [], {}, {}
    for name, entry, checks, info, clip_fails in results:
        fragment[name], report[name] = entry, dict(layout=info, frames=checks)
        fails += clip_fails
    summary = dict(fighter=fighter, downscale=s, ppu=ppu, bodyCentreFromRootY=body_centre,
                   clips=report, failures=fails)
    return fragment, summary, fails


LAYOUT_KEYS = ('sourceCells', 'columns', 'rows', 'atlas', 'trims', 'pages')


def retile_entry(entry, sha256, layout):
    """The entry with its layout fields replaced by `layout` (at the position of the first layout key) and
    `sha256` updated; every other key stays in place and in order."""
    out = {}
    for key, value in entry.items():
        if key not in LAYOUT_KEYS:
            out[key] = sha256 if key == 'sha256' else value
        elif not any(k in out for k in layout):
            out.update(layout)
    if not any(k in out for k in layout):
        out.update(layout)
    return out


def repack_installed(fighter: str, out_dir: Path, only=None, all_grid=False):
    """Tight-pack every installed cell clip of assets/characters/<fighter> into out_dir without resampling.
    Returns the repack report; raises SystemExit when a rebuilt cell differs from the installed one."""
    fighter_dir = ROOT / 'assets/characters' / fighter
    resolved = out_dir.resolve()
    if resolved == (ROOT / 'assets').resolve() or (ROOT / 'assets').resolve() in resolved.parents:
        raise SystemExit(f'refusing to write inside assets/: {out_dir}')
    frames = json.loads((fighter_dir / 'frames.json').read_text())
    (out_dir / 'animations').mkdir(parents=True, exist_ok=True)
    animations, clips, mib_before, mib_after = {}, {}, 0.0, 0.0
    for name, entry in frames['animations'].items():
        old_atlas = fighter_frames.load_atlas(fighter_dir, entry)
        mib_before += old_atlas.nbytes / 2**20
        eligible = not entry.get('trims') if all_grid else 'sourceCells' in entry
        if not eligible or (only and name not in only):
            shutil.copyfile(fighter_dir / entry['strip'], out_dir / entry['strip'])
            animations[name] = entry
            mib_after += old_atlas.nbytes / 2**20
            continue
        old_cells = fighter_frames.read_cells(entry, old_atlas)
        atlas, size, trims = tight_pack(old_cells)
        png = out_dir / entry['strip']
        Image.fromarray(atlas, 'RGBA').save(png)
        new_entry = retile_entry(entry, hashlib.sha256(png.read_bytes()).hexdigest(), {'atlas': size, 'trims': trims})
        semantic_keys = set(entry) - set(LAYOUT_KEYS) - {'sha256'}
        if any(new_entry.get(key) != entry[key] for key in semantic_keys):
            raise SystemExit(f'{fighter}/{name}: non-layout metadata changed')
        rebuilt = fighter_frames.read_cells(new_entry, np.array(Image.open(png).convert('RGBA')))
        drawings = []
        for i, (old, new) in enumerate(zip(old_cells, rebuilt)):
            same = np.array_equal(fighter_frames.premultiply(old), fighter_frames.premultiply(new))
            solid = old[..., 3] > 0
            if not same or not np.array_equal(old[solid], new[solid]):
                raise SystemExit(f'{fighter}/{name}[{i}]: rebuilt cell differs from the installed cell')
            drawings.append(dict(index=i, beforePremultipliedRgbaSha256=fighter_frames.rgba_sha256(old), rgbaSha256=fighter_frames.rgba_sha256(new),
                                 rawBytesIdentical=bool(np.array_equal(old, new)), trim=trims[i]))
        animations[name] = new_entry
        mib_after += atlas.nbytes / 2**20
        clips[name] = dict(before=[old_atlas.shape[1], old_atlas.shape[0]], after=size,
                           cell=[entry['frameWidth'], entry['frameHeight']], drawings=drawings)
    (out_dir / 'frames.json').write_text(json.dumps({**frames, 'animations': animations}, indent=2) + '\n')
    return dict(fighter=fighter, clips=len(clips), drawings=sum(len(c['drawings']) for c in clips.values()),
                decodedMiBBefore=round(mib_before, 2), decodedMiBAfter=round(mib_after, 2),
                allCellsPremultipliedRgbaIdentical=True, clipReports=clips)


def sha256_lines(out_dir: Path) -> str:
    files = sorted(p for p in out_dir.rglob('*') if p.is_file() and p.name != 'sha256.txt')
    return ''.join(f'{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.relative_to(out_dir).as_posix()}\n' for p in files)


def main_repack(args):
    out_dir = Path(args.paths[0])
    report = repack_installed(args.repack_installed, out_dir, set(args.only.split(',')) if args.only else None, args.all_grid)
    (out_dir / 'repack-report.json').write_text(json.dumps(report, indent=1) + '\n')
    (out_dir / 'sha256.txt').write_text(sha256_lines(out_dir))
    print(f"{report['fighter']}: {report['clips']} clips, {report['drawings']} drawings re-packed, premultiplied RGBA "
          f"identical; decoded {report['decodedMiBBefore']} -> {report['decodedMiBAfter']} MiB")
    return 0


def main(argv):
    ap = argparse.ArgumentParser(description='Pack fighter cutouts into per-clip strips/atlases (see module doc).')
    ap.add_argument('--fighter', help='fighter id (selects ppu/bodyHeight defaults)')
    ap.add_argument('--layout', choices=LAYOUTS, default='grid')
    ap.add_argument('--repack-installed', metavar='FIGHTER', help='tight-pack the installed strips into STAGING_DIR')
    ap.add_argument('--all-grid', action='store_true', help='with --repack-installed: include every grid body/FX clip, retaining already-tight atlases')
    ap.add_argument('--only', help='with --repack-installed: comma separated clips (the rest are copied unchanged)')
    ap.add_argument('paths', nargs='+', metavar='SPEC OUT_DIR | STAGING_DIR')
    ap.add_argument('--warn-only', action='store_true')
    ap.add_argument('--jobs', type=int, default=1, help='packing: processes to spread the clips over')
    args = ap.parse_args(argv[1:])
    if args.repack_installed:
        if len(args.paths) != 1:
            ap.error('--repack-installed takes exactly one STAGING_DIR')
        return main_repack(args)
    if not args.fighter or len(args.paths) != 2:
        ap.error('packing needs --fighter and SPEC OUT_DIR')
    spec_path, out_dir = args.paths[0], Path(args.paths[1])
    fragment, summary, fails = pack_spec(json.loads(Path(spec_path).read_text()), out_dir, args.fighter, args.layout, args.jobs)
    (out_dir / 'frames-fragment.json').write_text(json.dumps(fragment, indent=2) + '\n')
    (out_dir / 'pack-report.json').write_text(json.dumps(summary, indent=2) + '\n')
    print(f"fighter={args.fighter} downscale={summary['downscale']:.6f} ppu={summary['ppu']} "
          f"bodyCentreFromRootY={summary['bodyCentreFromRootY']}")
    for name, r in summary['clips'].items():
        print(name, r['layout'])
        for c in r['frames']:
            print('  ', c)
    if fails:
        print('SELF-CHECK FAILURES:')
        for f in fails:
            print('  -', f)
        return 0 if args.warn_only else 2
    print('self-checks: all passed')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
