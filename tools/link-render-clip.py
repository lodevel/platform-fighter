#!/usr/bin/env python3
"""Render one Link native motion as cel drawings at DK scale, one per native frame.

Usage (CPU heavy, so under the shared lock; needs only the ComfyUI venv, no PYTHONPATH):
  flock .tmp/dk-heavy.lock ~/ComfyUI/.venv/bin/python tools/link-render-clip.py a02dash \
      --out <dir> [--frames 0,4,8] [--jobs 4] [--keep-work]

Inputs (explicit constants below): the native motion (.nuanmb) and model read by
tools/link-authored-guide.py, the atlas-v4 textures, the semantic-class PNGs and
equipment-palette-v1/ under ART, and ART/native-pilot/neutral-native0.json. The C raster
kernel (tools/link_author_raster_v2.cpp) is compiled on demand to .tmp/*.so, and the venv's
ssbh_data_py is copied on demand to .tmp/link-cel-libs/ for the system-python cel pass.

Writes <dir>/<motion>/<motion>-NNN.png (RGBA cutout) and <motion>-NNN.json
({"motion", "nativeFrame", "root": [x, y], "transRoot": [x, y], "scaleToWorld",
"pixelsPerNativeUnit", "grounded", "bodyFloorDev", "sockets"}) per native frame, plus
<dir>/<motion>/index.json listing them. `transRoot` is the posed native Trans origin (Ultimate's
fighter position) on the cutout's integer grid.

Root rule. `root` is `transRoot`, except for a drawing on the floor that sinks below it
by more than SINK_TOLERANCE_PX: Ultimate lets lying, tripped and thrown poses sink up to
~5 native units through the ground plane (the 3D stage hides it; the UFD GIFs show it),
which a 2D floor line cannot hide. Such a drawing gets its root moved down to its lowest
solid row minus SOLE_PX (the 2 px ink line under the boots in every standing motion), so
it rests on the floor exactly as the standing drawings do. Upright drawings (sink within
the tolerance, which is also the final set's floor check) and drawings above the floor (rolls, throw
leaps, trip falls) keep `transRoot`, so ordinary clips get no per-drawing jitter. "On the floor" = the motion is played in a
grounded status (not in OFF_FLOOR), it animates the whole body (has a Trans track; the
*upper overlays do not) and the posed Trans has no vertical offset (ledge hangs and the
ceiling tech move Trans off the ground plane). The lowest row is measured on the BODY only: texels owned
by gear (sword, scabbard, shield, quiver, Slate, held articles; resolved from the renderer's object and semantic ids,
the cel ink ring taking the owner of its nearest texel) are ignored, so a dangling quiver or a sword
tip never holds the body up (or sinks it). `bodyFloorDev` records the resulting body sole minus root
in packed px (+ = below the floor line) and `grounded` whether the floor rule applied.

Item sockets. `sockets` holds, per drawing and per hand (HaveR = the hand the item motions hold
items in, HaveL), the native hand bone's position as {x, y} world px from the body centre facing
right (x = 5 * native z, y = -bodyCentreFromRootY - 5 * native y, minus the floor lift) plus the bone's
+Y (blade / bat / rod) and +Z (gun barrel) axes projected on the side view as [Phaser degrees
(0 up, 90 forward), in-plane length 0..1]: the data DK's itemAttachmentPoses and item-axes.json carry
(src/characters/heldItemSocket.ts). hand_axes() is also what tools/link-build-final.py calls for the
per-native-frame axis tables.

Recipe (the same steps that produced the installed atlas-v4/cel-v3 drawings):
  1. tools/link-authored-guide.py render(): native mesh posed by the motion frame,
     orthographic side view at 34 art px per native unit, textured with the hand-painted
     atlas-v4 colour textures, quiver/Slate with the equipment-palette-v1 textures, UV
     map captured for the cel pass. The C raster kernel from link_author_raster_v2
     replaces the numpy one (same pixels, much faster).
  2. tools/link-cel-style.py: palette flattening, depth two-tone shading, garment
     boundary ink, silhouette/occlusion ink, then the authored cap volume.
  3. link_part_owned_equipment_v3.apply(): Master Sword / quiver / Slate / feather colours.
  4. fighter-pack.render_cell(): one LANCZOS resample (premultiplied) to
     5 / 0.4666667 px per native unit, root on an integer pixel.
Gear: native visibility tracks decide sword/shield; where a motion shows both the held
and the stowed copy of the same item (e.g. a02dash shield), the held one wins, which
matches the installed normals.

Held articles. A motion that has a motion of a held article (articles.article_motion(): the namesake, e.g.
motion/bow/c00/d00specialn*, motion/ancientbow/c00/d04final*, motion/parasail/c00/j00entryr, or the facing-free name
of an r/l body motion, e.g. motion/navy/c00/j01appeals for j01appealsr) also draws that article model posed by its own
motion, through tools/link-native-article-guide-v2.py render() (the article motion is actor-Trans-relative; its last
frame is held past the article's end; a billboard bone faces the camera; a mesh scaled to ~0 is hidden), in the same
depth buffer before the cel pass. The bow uses the authored bow-palette-v1 textures, the Ancient Bow, paraglider and
Navi their native colour textures. The article counts as gear for the floor rule.

Upper overlays. The *upper motions (h11itemshootupper, h12itemscope*upper, ...) animate no Trans/Rot and no leg
bone (LegL/R, KneeL/R, FootL/R, ToeL/R): the runtime draws them above the waist line over the item_shoot_legs_*
drawing (src/characters/upperBodyLayer.ts). They are drawn with the triangles dominated by those leg bones hidden,
not with bind-pose legs.

Article stills (render_articles): an article model alone in its bind pose (render_alone()), optionally turned
about the native X axis (the camera axis: the boomerang's spin plane is the side-view plane), cel pass without
the body-only steps, root = the model origin. Written as <dir>/<sheet>/<sheet>-NNN.png|json + index.json.
"""
from pathlib import Path
import argparse, contextlib, importlib.util, io, json, math, multiprocessing, os, shutil, subprocess, sys, tempfile, time

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
sys.path[:0] = [str(ROOT / 'tools')]
os.environ['LINK_AUTHOR_UV_MAP'] = '1'  # the cel pass needs the UV map

ART = ROOT / 'docs/review/2026-10-12/link-character/rework/art'
ATLAS = ART / 'uv-atlas-pilot/fresh-target-atlas-v4'
CEL = ROOT / 'tools/link-cel-style.py'  # run with system python3 (the venv Pillow 12.3 dies with SIGFPE in it)
CEL_LIBS = ROOT / '.tmp/link-cel-libs'  # the venv's ssbh_data_py alone, for the cel pass (its cap volume imports the DK guide)
SEMANTIC_CLASSES = ART  # semantic-class PNGs, equipment-palette-v1/, native-pilot/neutral-native0.json
WORLD_PER_NATIVE = 5.0
HELD_OVER_STOWED = [('link_ken', 'link_kenb'), ('link_tate', 'link_tateb')]
SOLE_PX = 2  # packed px of solid ink below transRoot in every standing motion (idle, guard, squat, win waits)
SINK_TOLERANCE_PX = 3  # body sole allowed below the floor line (foot roll, ink); deeper sinks are lifted to SOLE_PX
# Gear is not body: meshes (Master Sword, scabbard, Hylian Shield, and the back-stowed copies) and the
# semantic ids of the quiver (101) / Sheikah Slate (102) triangles of the body mesh.
GEAR_MESHES = frozenset('link_ken_VIS_O_OBJShape link_sayatuka_VIS_O_OBJShape link_kenb_VIS_O_OBJShape '
                        'link_tate_VIS_O_OBJShape link_tateb_VIS_O_OBJShape'.split())
GEAR_SEMANTIC_IDS = (101, 102, 103)   # + 103: held article texels (tools/link-native-article-guide-v2.py)
ITEM_HAND, OTHER_HAND = 'HaveR', 'HaveL'
UPPER_SUFFIX = 'upper'
LEG_BONES = ('LegL', 'KneeL', 'FootL', 'ToeL', 'LegR', 'KneeR', 'FootR', 'ToeR')   # not animated by the *upper motions
ARTICLE_TEXTURES = {'bow': ART / 'bow-palette-v1'}   # authored cel palettes; other articles use their native colour texture
# Motions Ultimate plays while Link is airborne, or held by a grabber: no floor under the root.
OFF_FLOOR = frozenset('''
    a03jumpf a03jumpb a03jumpaerialf a03jumpaerialb a04fall a04fallf a04fallb a04fallaerial
    a04fallaerialf a04fallaerialb a04fallspecial a04fallspecialf a04fallspecialb a04damagefall
    a06stepairpose a06stepfall a06stepjump b02escapeair
    c05attackairn c05attackairf c05attackairb c05attackairhi c05attackairlw
    d00specialairnstart d00specialairnloop d00specialairnend d01specialairs1 d01specialairs2
    d02specialairhi d03specialairlw d03specialairlwblast d04finalair
    e02capturepulledhi e02capturewaithi e02capturedamagehi
    e03capturepulledlw e03capturewaitlw e03capturedamagelw e03capturejump
    f01damageair1 f01damageair2 f01damageair3 f01damageflyn f01damageflyhi f01damageflylw
    f01damageflytop f01damageflyroll f01damageflyrollend f01damageflymeteor
    f05passivewall f05passivewalljump g02cliffjump1 g02cliffjump2
    h02lightthrowairf h02lightthrowairb h02lightthrowairhi h02lightthrowairlw h05itemhammerair
    h07itemscrewfall h11itemshootair h11itemshootairloop h12itemscopeairstart h12itemscopeairfire
    h12itemscopeairrapid h12itemscopeairend h12itemscopefall
    h16itemgenesisairfire h16itemgenesisairloop h16itemgenesisairend h16itemgenesisfall
'''.split())


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


os.chdir(ROOT)  # the guide and cel scripts use repo-relative paths
guide = load('link_authored_guide', ROOT / 'tools/link-authored-guide.py')
articles = load('link_native_article_guide', ROOT / 'tools/link-native-article-guide-v2.py')
pack = load('fighter_pack', ROOT / 'tools/fighter-pack.py')
from link_author_raster_v2 import install_on_guide
from link_part_owned_equipment_v3 import apply as gear_colours
install_on_guide(guide)

PPU_OUT = WORLD_PER_NATIVE / pack.PACKED_WORLD_PER_PX
BODY_CENTRE_FROM_ROOT_Y = -pack.FIGHTER_DEFAULTS['link'][1] / 2   # what the pack writes as bodyCentreFromRootY (world px)


def cel_env():
    """Environment of the system-python cel pass: PYTHONPATH = a copy of the venv's ssbh_data_py and nothing else
    from the venv (whose Pillow must stay out). Copied on first use, like the raster kernel's .so."""
    source = Path(guide.ssbh.__file__).parent
    if not (CEL_LIBS / source.name / '__init__.py').exists():
        staging = Path(tempfile.mkdtemp(prefix='link-cel-libs-', dir=CEL_LIBS.parent))
        shutil.copytree(source, staging / source.name, ignore=shutil.ignore_patterns('__pycache__'))
        try:
            staging.rename(CEL_LIBS)
        except OSError:          # another renderer installed it first
            shutil.rmtree(staging)
    return {**os.environ, 'PYTHONPATH': str(CEL_LIBS)}


CEL_ENV = cel_env()


def motion_path(motion):
    return guide.MOTIONS / (motion + '.nuanmb')


def prefer_held_gear(motion):
    """Hide the stowed copy on frames where the held copy is also visible.

    The guide reads the animation through its read cache, so editing the cached
    object here changes what render() sees for this motion."""
    animation = guide.ssbh.anim_data.read_anim(str(motion_path(motion)))
    nodes = {n.name: n for g in animation.groups if g.group_type.name == 'Visibility' for n in g.nodes}
    for held, stowed in HELD_OVER_STOWED:
        if held in nodes and stowed in nodes:
            h, s = nodes[held].tracks[0].values, nodes[stowed].tracks[0].values
            count = max(len(h), len(s))
            at = lambda v, i: v[0] if len(v) == 1 else v[i]
            nodes[stowed].tracks[0].values = [at(s, i) and not at(h, i) for i in range(count)]
    return animation


def on_floor_motion(motion, animation):
    """Grounded status and a whole-body motion (the *upper overlays carry no Trans track)."""
    return motion not in OFF_FLOOR and any(
        n.name == 'Trans' for g in animation.groups if g.group_type.name == 'Transform' for n in g.nodes)


def held_articles(motion):
    """[(article, article motion)] drawn with this body motion: the held articles with a motion of their own for it."""
    return [(a, m) for a in articles.HELD_ARTICLES if (m := articles.article_motion(a, motion))]


def body_bottom(rgba, owners, semantic, meta):
    """Lowest solid body row edge of the art drawing (art px): gear texels do not count."""
    gear_ids = [int(k) for k, v in meta['objectIds'].items()
                if v['mesh'] in GEAR_MESHES or v.get('role') == articles.ARTICLE_ROLE]
    gear = np.isin(owners, gear_ids) | np.isin(semantic, GEAR_SEMANTIC_IDS)
    owned = (owners > 0) | (semantic > 0)
    if not owned.all():   # the cel ink ring has no owner: it takes the class of the nearest owned texel
        nearest = ndimage.distance_transform_edt(~owned, return_indices=True)[1]
        gear = gear[nearest[0], nearest[1]]
    solid = rgba[:, :, 3] >= pack.ALPHA_SOLID
    body = solid & ~gear
    return int(np.nonzero((body if body.any() else solid).any(axis=1))[0].max()) + 1


def is_grounded(meta, on_floor):
    """The floor rule applies: grounded status, whole-body motion, posed Trans on the ground plane."""
    return bool(on_floor) and abs(meta['capturedTrans'][1]) <= 1e-3


def floor_lift(bottom, meta, s, on_floor):
    """Whole packed px the root moves below transRoot so the body does not sink through the floor."""
    if not is_grounded(meta, on_floor):
        return 0
    sink = (bottom - meta['artRoot'][1]) * s
    return math.ceil(sink - SOLE_PX) if sink > SINK_TOLERANCE_PX else 0


def hand_axes(matrix):
    """{'y': [angle, length], 'z': [...]}: the bone's +Y and +Z axes on the side view (screen x = native z,
    screen up = native y). Angle in Phaser degrees facing right (0 = up, 90 = forward); length = in-plane share."""
    out = {}
    for name, column in (('y', 1), ('z', 2)):
        v = np.asarray(matrix, float)[:3, column]
        v = v / np.linalg.norm(v)
        out[name] = [round(float(np.degrees(np.arctan2(v[2], v[1]))), 2), round(float(min(1.0, np.hypot(v[1], v[2]))), 3)]
    return out


def native_hand_axes(motion, frames, hand=ITEM_HAND):
    """hand_axes() of the item hand's native pose at each native frame (clamped to the motion's last frame)."""
    pose = guide.LinkNativePose(motion_path(motion))
    last = int(pose.animation.final_frame_index)
    return [hand_axes(pose.matrices(min(f, last), [hand])[hand]) for f in frames]


def hand_sockets(meta, lift):
    """Per hand: position from the body centre (world px, facing right) at the drawing's root and the axes."""
    anchors = {n: np.asarray(m, float) for n, m in meta['sourceRigAnchors'].items()}
    origin = anchors['Trans'][:3, 3]
    sockets = {}
    for hand in (ITEM_HAND, OTHER_HAND):
        p = anchors[hand][:3, 3] - origin
        sockets[hand] = {'position': {'x': round(float(p[2]) * WORLD_PER_NATIVE, 3),
                                      'y': round(-BODY_CENTRE_FROM_ROOT_Y - float(p[1]) * WORLD_PER_NATIVE
                                                 - lift * pack.PACKED_WORLD_PER_PX, 3)},
                         'axes': hand_axes(anchors[hand])}
    return sockets


def cel_pass(prefix):
    """tools/link-cel-style.py on a guide prefix; returns (meta, cel RGBA, object ids, semantic ids)."""
    final = Path(str(prefix) + '-final.png')
    subprocess.run(['python3', str(CEL), str(prefix), str(final)], check=True, cwd=ROOT, env=CEL_ENV,
                   stdout=subprocess.DEVNULL)
    return (json.load(open(str(prefix) + '.json')), np.array(Image.open(final).convert('RGBA')),
            np.array(Image.open(str(prefix) + '-object-ids.png')), np.array(Image.open(str(prefix) + '-semantic-ids.png')))


def to_cell(rgba, root, s):
    """One LANCZOS resample of the art drawing to packed scale with `root` (art px) on an integer pixel."""
    x0, x1, y0, y1 = pack.alpha_bbox(rgba[:, :, 3])
    rx, ry = math.ceil((root[0] - x0) * s) + 2, math.ceil((root[1] - y0) * s) + 2
    width = rx + max(0, math.ceil((x1 - root[0]) * s)) + 2
    height = ry + max(0, math.ceil((y1 - root[1]) * s)) + 2
    return pack.render_cell(Image.fromarray(rgba), root, s, width, height, rx, ry), rx, ry


def work_dir(out_dir, keep_work):
    if keep_work:
        (out_dir / 'work').mkdir(exist_ok=True)
        return contextlib.nullcontext(out_dir / 'work')
    return tempfile.TemporaryDirectory(prefix='link-render-clip-')


def render_frame(job):
    motion, frame, out_dir, keep_work, on_floor = job
    started = time.perf_counter()
    held = held_articles(motion)
    with work_dir(out_dir, keep_work) as work:
        prefix = Path(work) / f'{motion}-{frame}'
        with contextlib.redirect_stdout(io.StringIO()):
            guide.render(motion, frame, prefix, ATLAS, hide_bones=LEG_BONES if motion.endswith(UPPER_SUFFIX) else ())
            for article, article_motion in held:
                last = int(articles.article_pose(article, article_motion).animation.final_frame_index)
                combined = Path(f'{prefix}-{article}')
                articles.render(article, article_motion, min(frame, last), prefix, combined, ARTICLE_TEXTURES.get(article))
                prefix = combined
        meta, cel, owners, semantic = cel_pass(prefix)
        rgba = gear_colours(cel, owners, semantic, meta)
    s = PPU_OUT / meta['artPixelsPerNativeUnit']
    bottom = body_bottom(rgba, owners, semantic, meta)
    lift = floor_lift(bottom, meta, s, on_floor)
    root = [float(meta['artRoot'][0]), float(meta['artRoot'][1]) + lift / s]
    cell, rx, ry = to_cell(rgba, root, s)
    name = f'{motion}-{frame:03d}'
    cell.save(out_dir / (name + '.png'))
    record = {'motion': motion, 'nativeFrame': frame, 'root': [rx, ry], 'transRoot': [rx, ry - lift],
              'scaleToWorld': pack.PACKED_WORLD_PER_PX, 'pixelsPerNativeUnit': PPU_OUT,
              'grounded': is_grounded(meta, on_floor), 'bodyFloorDev': round((bottom - root[1]) * s, 2),
              'sockets': hand_sockets(meta, lift), 'png': name + '.png', 'seconds': round(time.perf_counter() - started, 3)}
    if held:
        record['heldArticles'] = [article for article, _ in held]
    if motion.endswith(UPPER_SUFFIX):
        record['hiddenBones'] = list(LEG_BONES)
    (out_dir / (name + '.json')).write_text(json.dumps(record, indent=1) + '\n')
    return record


def render_article_drawing(job):
    """One article still: render_alone() -> cel pass -> packed cell, root = the model origin."""
    sheet, article, index, spin, out_dir, keep_work = job
    started = time.perf_counter()
    with work_dir(out_dir, keep_work) as work:
        prefix = Path(work) / f'{sheet}-{index}'
        articles.render_alone(article, prefix, ARTICLE_TEXTURES.get(article), spin)
        meta, rgba, _, _ = cel_pass(prefix)
    s = PPU_OUT / meta['artPixelsPerNativeUnit']
    cell, rx, ry = to_cell(rgba, [float(v) for v in meta['artRoot']], s)
    name = f'{sheet}-{index:03d}'
    cell.save(out_dir / (name + '.png'))
    record = {'sheet': sheet, 'article': article, 'drawing': index, 'spinDegreesAboutNativeX': spin, 'root': [rx, ry],
              'rootMeaning': 'native model origin', 'scaleToWorld': pack.PACKED_WORLD_PER_PX,
              'pixelsPerNativeUnit': PPU_OUT, 'png': name + '.png', 'seconds': round(time.perf_counter() - started, 3)}
    (out_dir / (name + '.json')).write_text(json.dumps(record, indent=1) + '\n')
    return record


def run_pool(function, work, jobs):
    if jobs > 1:
        with multiprocessing.get_context('fork').Pool(jobs) as pool:
            return pool.map(function, work, chunksize=1)
    return [function(j) for j in work]


def render_articles(requests, out_root, jobs=1, keep_work=False):
    """Render [(sheet, article, spins)] (one drawing per spin angle, degrees about native X) under <out_root>/<sheet>/;
    returns {sheet: index.json's dict}."""
    out_root = out_root if out_root.is_absolute() else Path.cwd() / out_root
    work, spans = [], {}
    for sheet, article, spins in requests:
        out_dir = out_root / sheet
        out_dir.mkdir(parents=True, exist_ok=True)
        spans[sheet] = (len(work), len(work) + len(spins), out_dir, article)
        work += [(sheet, article, i, float(spin), out_dir, keep_work) for i, spin in enumerate(spins)]
    started = time.perf_counter()
    records = run_pool(render_article_drawing, work, jobs)
    wall = round(time.perf_counter() - started, 2)
    indexes = {}
    for sheet, (lo, hi, out_dir, article) in spans.items():
        indexes[sheet] = {'sheet': sheet, 'article': article, 'frames': records[lo:hi], 'scaleToWorld': pack.PACKED_WORLD_PER_PX,
                          'pixelsPerNativeUnit': PPU_OUT, 'jobs': jobs, 'wallSeconds': wall}
        (out_dir / 'index.json').write_text(json.dumps(indexes[sheet], indent=1) + '\n')
    return indexes


def render_clips(requests, out_root, jobs=1, keep_work=False):
    """Render [(motion, frames)] (frames None = every native frame) under <out_root>/<motion>/ in ONE worker pool
    across all clips (so a short clip does not leave workers idle); returns {motion: index.json's dict}."""
    out_root = out_root if out_root.is_absolute() else Path.cwd() / out_root
    work, spans, lasts = [], {}, {}
    for motion, frames in requests:
        animation = prefer_held_gear(motion)   # in the parent: forked workers inherit the edited read cache
        lasts[motion] = last = int(animation.final_frame_index)
        frames = list(range(last + 1)) if frames is None else frames
        out_dir = out_root / motion
        out_dir.mkdir(parents=True, exist_ok=True)
        on_floor = on_floor_motion(motion, animation)
        spans[motion] = (len(work), len(work) + len(frames), out_dir)
        work += [(motion, f, out_dir, keep_work, on_floor) for f in frames]
    started = time.perf_counter()
    records = run_pool(render_frame, work, jobs)
    wall = round(time.perf_counter() - started, 2)
    indexes = {}
    for motion, (lo, hi, out_dir) in spans.items():
        indexes[motion] = {'motion': motion, 'nativeFinalFrameIndex': lasts[motion], 'frames': records[lo:hi],
                           'scaleToWorld': pack.PACKED_WORLD_PER_PX, 'pixelsPerNativeUnit': PPU_OUT,
                           'jobs': jobs, 'wallSeconds': wall}
        (out_dir / 'index.json').write_text(json.dumps(indexes[motion], indent=1) + '\n')
    return indexes


def render_clip(motion, frames, out_root, jobs=1, keep_work=False):
    """Render `frames` (None = every native frame) of one motion; returns its index.json's dict."""
    return render_clips([(motion, frames)], out_root, jobs, keep_work)[motion]


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('motion', help='native motion name, e.g. a02dash')
    parser.add_argument('--out', required=True, type=Path)
    parser.add_argument('--frames', help='comma-separated native frames (default: all)')
    parser.add_argument('--jobs', type=int, default=1)
    parser.add_argument('--keep-work', action='store_true',
                        help='keep the 34 px/unit guide and cel intermediates in <out>/<motion>/work')
    args = parser.parse_args()
    index = render_clip(args.motion, [int(f) for f in args.frames.split(',')] if args.frames else None,
                        args.out, args.jobs, args.keep_work)
    records = index['frames']
    print(json.dumps({'motion': args.motion, 'frames': len(records), 'wallSeconds': index['wallSeconds'],
                      'secondsPerDrawingCpu': round(sum(r['seconds'] for r in records) / len(records), 2)}))


if __name__ == '__main__':
    main()
