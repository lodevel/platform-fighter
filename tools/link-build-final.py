#!/usr/bin/env python3
"""Build Link's final art set from ONE pipeline: native renders (tools/link-render-clip.py) packed by tools/fighter-pack.py.

Three steps over a clip plan (docs/review/2026-10-14/link-takeover/final-staging/clip-plan.json: engine sheet,
native motion, kept 1-based native samples, optional loopDuration / clock / sourceRootDeltaFrames):

  flock .tmp/dk-heavy.lock ~/ComfyUI/.venv/bin/python tools/link-build-final.py render --raw RAW [--jobs 7] [--only a,b] [--resume]
  ~/ComfyUI/.venv/bin/python tools/link-build-final.py pack  --raw RAW --out OUT [--jobs 8]
  ~/ComfyUI/.venv/bin/python tools/link-build-final.py check --raw RAW --out OUT

render  every kept sample (native frame = sample - 1) of every clip into RAW/<motion>/ (CPU heavy: one flock per batch).
pack    spec from the drawing JSONs -> fighter-pack (--fighter link --layout tight) -> OUT/frames.json {meta, animations},
        OUT/animations/<sheet>.png, OUT/item-axes.json, OUT/pack-report.json, OUT/sha256.txt. Per clip:
          loopDuration                      from the plan
          actionFrameStarts (16 normals)    the first 1-based gameplay frame whose native pose frame reaches the
                                            drawing's native frame (sample - 1). The age -> pose frame table (--clock) is
                                            A3-evidence/link-normal-clock.json: linkNormalBodyClock's output, frozen and
                                            verified identical to a fresh dump when its dump tool was deleted.
          itemAttachmentPoses (every clip)  one row per drawing: the item hand's socket from the render (DK's format:
                                            position from the body centre facing right, angle = the bone's +Y axis);
                                            the item hand is item_hand(motion)
          sourceRootDelta                   zero rows for the two clips the installed set carried them for
        item-axes.json is DK's format: per clip `drawings[artFrameIndex]` = {y, z} -> [angle, in-plane length] of the
        item hand's +Y / +Z axes, plus `frames[native frame]` (and `loop`) for the native-timed item clips (motions h*).
check   schema (nativeSampleIndices == frameCount == trims == itemAttachmentPoses), per-clip floor table of the grounded
        drawings (body-only sole minus root, packed px) and socket/axis consistency -> OUT/checks.json.

Articles. The plan's `articles` (sheet fx__link_<article>, native article model, spinDegrees: one drawing per angle about
the native X axis) are rendered by the renderer's render_articles() into RAW/<sheet>/ and packed by the same fighter-pack
call as DK's article/effect sheets are named: `fx__<fighter>_<name>` entries in frames.json `animations` (root = the
native model origin). frames.json `articles` describes them (model, root, spin, source data); they have no
itemAttachmentPoses / item-axes rows.
"""
import argparse
import hashlib
import importlib.util
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REVIEW = ROOT / 'docs/review/2026-10-14/link-takeover'
DEFAULT_PLAN = REVIEW / 'final-staging/clip-plan.json'
DEFAULT_CLOCK = REVIEW / 'A3-evidence/link-normal-clock.json'
PACKED_FILES = ('frames.json', 'item-axes.json', 'pack-report.json')   # + animations/: what sha256.txt covers
ITEM_MOTION_PREFIX = 'h'              # native-timed item motions (lift, throw, swing, shoot) get a per-native-frame axis table
# Link's native shooting motions aim the item with the extended HaveL hand while HaveR keeps the Master Sword
# (link_ken visible, Sword1 on HaveR): at the shot drawing (h11itemshoot n7) HaveL is in front with +Y up / +Z forward,
# DK's HaveR gun frame, and HaveR is at the hip. Every other item motion (carry, swings, throws, Hammer) holds the item
# in HaveR. Evidence: docs/review/2026-10-15/b4-diagnosis.md §2 and b4/hand-evidence.txt.
SHOOTING_MOTION_PREFIXES = ('h11itemshoot', 'h12itemscope')


def item_hand(render, motion):
    """The native bone that holds the item in this motion."""
    return render.OTHER_HAND if motion.startswith(SHOOTING_MOTION_PREFIXES) else render.ITEM_HAND


def load_module(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'tools' / filename)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module      # the renderer's worker pool pickles its functions by module name
    spec.loader.exec_module(module)
    return module


def load_plan(path, only=None, key='clips'):
    """The plan's body clips (key='clips') or article sheets (key='articles'), optionally only the named sheets."""
    entries = json.loads(Path(path).read_text()).get(key, [])
    return [c for c in entries if not only or c['sheet'] in only]


def article_records(raw, article):
    """The renderer's JSON record of every drawing of an article sheet, in drawing order."""
    return [json.loads((raw / article['sheet'] / f"{article['sheet']}-{i:03d}.json").read_text())
            for i in range(len(article['spinDegrees']))]


def sha256_file(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def drawing_records(raw, clip):
    """The renderer's JSON record of every kept drawing of the clip, in sample order."""
    return [json.loads((raw / clip['motion'] / f"{clip['motion']}-{sample - 1:03d}.json").read_text())
            for sample in clip['samples']]


def action_frame_starts(clip, clock):
    """1-based gameplay frame at which each drawing starts: the first age whose evaluated native pose frame reaches the
    drawing's native frame (sample - 1). The renderer shows the drawing from that age on."""
    raw_ages = clock[clip['clock']]['rawAgeByAge']
    starts = []
    for sample in clip['samples']:
        age = next((a for a, frame in enumerate(raw_ages) if frame >= sample - 1), None)
        if age is None:
            raise SystemExit(f"{clip['sheet']}: the clock never reaches native frame {sample - 1}")
        starts.append(age + 1)
    return starts


def clip_spec(raw, clip, clock, render):
    records = drawing_records(raw, clip)
    spec = {'frames': [{'png': str(raw / clip['motion'] / r['png']), 'root': r['root'], 'nativeSample': sample}
                       for r, sample in zip(records, clip['samples'])]}
    if clip.get('loopDuration'):
        spec['loopDuration'] = clip['loopDuration']
    if clip.get('clock'):
        spec['actionFrameStarts'] = action_frame_starts(clip, clock)
    hand = item_hand(render, clip['motion'])
    spec['itemAttachmentPoses'] = [{'artFrameIndex': i, 'nativeSample': sample,
                                    'position': r['sockets'][hand]['position'], 'angle': r['sockets'][hand]['axes']['y'][0]}
                                   for i, (r, sample) in enumerate(zip(records, clip['samples']))]
    if clip.get('sourceRootDeltaFrames'):
        spec['sourceRootDelta'] = [{'x': 0, 'y': 0}] * clip['sourceRootDeltaFrames']
    return spec


def item_axes(raw, clip, render):
    records = drawing_records(raw, clip)
    hand = item_hand(render, clip['motion'])
    entry = {'motion': clip['motion'], 'drawings': [r['sockets'][hand]['axes'] for r in records]}
    if clip['motion'].startswith(ITEM_MOTION_PREFIX) and not clip.get('clock'):
        count = clip.get('loopDuration') or clip['samples'][-1]
        entry['frames'] = render.native_hand_axes(clip['motion'], range(count), hand)
        if clip.get('loopDuration'):
            entry['loop'] = clip['loopDuration']
    return entry


def dump_axes(data):
    """item-axes.json: one line per drawing / native frame."""
    def clip_lines(entry):
        rows = [f'   "{key}": [\n' + ',\n'.join('    ' + json.dumps(r, separators=(', ', ': ')) for r in entry[key]) + '\n   ]'
                for key in ('drawings', 'frames') if key in entry]
        rows = [f'   "motion": {json.dumps(entry["motion"])}'] + rows + ([f'   "loop": {entry["loop"]}'] if 'loop' in entry else [])
        return '  {\n' + ',\n'.join(rows) + '\n  }'
    head = {k: v for k, v in data.items() if k != 'clips'}
    body = ',\n'.join(f' {json.dumps(name)}:\n' + clip_lines(entry) for name, entry in data['clips'].items())
    return json.dumps(head, indent=1)[:-2] + ',\n "clips": {\n' + body + '\n }\n}\n'


def cmd_render(args):
    render = load_module('link_render_clip', 'link-render-clip.py')
    raw = Path(args.raw)
    clips = load_plan(args.plan, set(args.only.split(',')) if args.only else None)
    todo = []
    for clip in clips:
        out = raw / clip['motion']
        wanted = [f'{clip["motion"]}-{s - 1:03d}.json' for s in clip['samples']]
        if args.resume and (out / 'index.json').exists() and all((out / w).exists() for w in wanted):
            continue
        todo.append((clip['motion'], [s - 1 for s in clip['samples']]))
    started = time.perf_counter()
    indexes = render.render_clips(todo, raw, args.jobs)   # one worker pool across all clips
    print(f'{len(todo)} clips ({len(clips) - len(todo)} kept), {sum(len(i["frames"]) for i in indexes.values())} drawings, '
          f'jobs={args.jobs}, wall {time.perf_counter() - started:.1f} s', flush=True)
    sheets = load_plan(args.plan, set(args.only.split(',')) if args.only else None, 'articles')
    todo = [a for a in sheets if not (args.resume and (raw / a['sheet'] / 'index.json').exists()
                                      and all((raw / a['sheet'] / f"{a['sheet']}-{i:03d}.json").exists()
                                              for i in range(len(a['spinDegrees']))))]
    indexes = render.render_articles([(a['sheet'], a['article'], a['spinDegrees']) for a in todo], raw, args.jobs)
    print(f'{len(todo)} article sheets ({len(sheets) - len(todo)} kept), '
          f'{sum(len(i["frames"]) for i in indexes.values())} drawings', flush=True)
    return 0


def cmd_pack(args):
    raw, out = Path(args.raw).resolve(), Path(args.out)
    packer = load_module('fighter_pack', 'fighter-pack.py')
    render = load_module('link_render_clip', 'link-render-clip.py')
    clips = load_plan(args.plan)
    clock = json.loads(Path(args.clock).read_text())
    sheets = load_plan(args.plan, key='articles')
    spec = {'clips': {c['sheet']: clip_spec(raw, c, clock, render) for c in sorted(clips, key=lambda c: c['sheet'])}}
    for article in sorted(sheets, key=lambda a: a['sheet']):
        spec['clips'][article['sheet']] = {'frames': [{'png': str(raw / article['sheet'] / r['png']), 'root': r['root']}
                                                      for r in article_records(raw, article)]}
    fragment, summary, fails = packer.pack_spec(spec, out, 'link', 'tight', args.jobs)
    axes = {}
    for clip in sorted(clips, key=lambda c: c['sheet']):
        axes[clip['sheet']] = item_axes(raw, clip, render)
    drawings = sum(len(c['frames']) for c in spec['clips'].values())
    meta = {'source': 'tools/link-render-clip.py native renders (root = native Trans + body-only floor lift), packed by '
                      'tools/fighter-pack.py --fighter link --layout tight, assembled by tools/link-build-final.py',
            'ppu': summary['ppu'], 'bodyHeight': 72, 'scaleToWorld': packer.PACKED_WORLD_PER_PX, 'layout': 'tight',
            'clips': len(clips), 'articleSheets': len(sheets), 'drawings': drawings, 'downscale': summary['downscale'],
            'floorRule': {'soleInkPx': render.SOLE_PX, 'sinkTolerancePx': render.SINK_TOLERANCE_PX,
                          'measuredOn': 'body only (gear excluded by renderer object/semantic ids)'},
            'planSha256': sha256_file(args.plan),
            'toolSha256': {name: sha256_file(ROOT / 'tools' / name) for name in
                           ('link-render-clip.py', 'link-native-article-guide-v2.py', 'link-authored-guide.py', 'link-cel-style.py', 'fighter-pack.py',
                            'link-build-final.py')}}
    described = {a['sheet']: {k: v for k, v in a.items() if k != 'sheet'} | {
        'root': 'native model origin (side view facing right: screen x = native z, screen up = native y)',
        'drawings': len(a['spinDegrees'])} for a in sorted(sheets, key=lambda a: a['sheet'])}
    frames = {'meta': meta, 'animations': fragment}
    if described:
        frames['articles'] = described
    (out / 'frames.json').write_text(json.dumps(frames, indent=2) + '\n')
    (out / 'pack-report.json').write_text(json.dumps(summary, indent=2) + '\n')
    (out / 'item-axes.json').write_text(dump_axes({
        'source': 'tools/link-build-final.py from the native item-hand bone (tools/link-render-clip.py)',
        'bone': f'{render.ITEM_HAND}; {render.OTHER_HAND} for the shooting motions {", ".join(p + "*" for p in SHOOTING_MOTION_PREFIXES)}', 'axes': {'y': 'bone +Y: blade / bat / rod axis', 'z': 'bone +Z: gun barrel axis'},
        'format': '[Phaser degrees facing right (0 up, 90 forward), in-plane length 0..1]; drawings[artFrameIndex], '
                  'frames[native frame = action age]',
        'clips': axes}))
    (out / 'sha256.txt').write_text(''.join(line for line in packer.sha256_lines(out).splitlines(keepends=True)
                                            if line.split('  ', 1)[1].rstrip('\n') in PACKED_FILES
                                            or line.split('  ', 1)[1].startswith('animations/')))
    print(f'{len(spec["clips"])} clips, {drawings} drawings, downscale={summary["downscale"]:.6f}, failures={len(fails)}')
    for failure in fails[:40]:
        print('  -', failure)
    return 0 if not fails else 2


def cmd_check(args):
    limit = load_module('link_render_clip', 'link-render-clip.py').SINK_TOLERANCE_PX   # body sole below the floor, packed px
    raw, out = Path(args.raw), Path(args.out)
    frames = json.loads((out / 'frames.json').read_text())['animations']
    axes = json.loads((out / 'item-axes.json').read_text())['clips']
    plan = {c['sheet']: c for c in load_plan(args.plan)}
    sheets = {a['sheet']: a for a in load_plan(args.plan, key='articles')}
    problems, floor_rows, worst = [], {}, []
    if set(frames) != set(plan) | set(sheets):
        problems.append(f'clips differ from the plan: {sorted(set(frames) ^ (set(plan) | set(sheets)))}')
    for sheet, article in sheets.items():
        entry = frames.get(sheet, {})
        n = len(article['spinDegrees'])
        if entry.get('frameCount') != n or len(entry.get('trims', [])) != n:
            problems.append(f'{sheet}: frameCount / trims != {n} drawings')
        if [r['spinDegreesAboutNativeX'] for r in article_records(raw, article)] != [float(d) for d in article['spinDegrees']]:
            problems.append(f'{sheet}: drawings differ from the plan spins')
    for sheet, entry in ((s, e) for s, e in frames.items() if s in plan):
        n = entry['frameCount']
        lengths = {'nativeSampleIndices': len(entry['nativeSampleIndices']), 'trims': len(entry['trims']),
                   'itemAttachmentPoses': len(entry['itemAttachmentPoses']), 'axes.drawings': len(axes[sheet]['drawings'])}
        for key, length in lengths.items():
            if length != n:
                problems.append(f'{sheet}: len({key}) {length} != frameCount {n}')
        if entry['nativeSampleIndices'] != plan[sheet]['samples']:
            problems.append(f'{sheet}: nativeSampleIndices differ from the plan')
        if [r['artFrameIndex'] for r in entry['itemAttachmentPoses']] != list(range(n)):
            problems.append(f'{sheet}: itemAttachmentPoses artFrameIndex is not 0..n-1')
        if [r['angle'] for r in entry['itemAttachmentPoses']] != [d['y'][0] for d in axes[sheet]['drawings']]:
            problems.append(f'{sheet}: itemAttachmentPoses angles differ from the item-axes drawings (+Y)')
        if 'actionFrameStarts' in entry and len(entry['actionFrameStarts']) != n:
            problems.append(f'{sheet}: len(actionFrameStarts) != frameCount')
        records = drawing_records(raw, plan[sheet])
        grounded = [(i, r['bodyFloorDev']) for i, r in enumerate(records) if r['grounded']]
        if grounded:
            devs = [d for _, d in grounded]
            floor_rows[sheet] = {'motion': plan[sheet]['motion'], 'groundedDrawings': len(grounded), 'drawings': n,
                                 'maxSink': max(devs), 'minFloat': min(devs), 'devs': devs,
                                 'lift': [r['root'][1] - r['transRoot'][1] for r in records]}
            worst += [(d, sheet, i) for i, d in grounded if d > limit]
    sinking = sorted(worst, reverse=True)
    report = {'clips': len(plan), 'articleSheets': len(sheets), 'drawings': sum(e['frameCount'] for e in frames.values()),
              'schemaProblems': problems,
              'grounded': {'clips': len(floor_rows), 'drawings': sum(r['groundedDrawings'] for r in floor_rows.values()),
                           'limitPx': limit,
                           'overLimit': [{'clip': s, 'drawing': i, 'bodyFloorDev': d} for d, s, i in sinking],
                           'maxSink': max((r['maxSink'] for r in floor_rows.values()), default=None),
                           'floating': sorted((r['minFloat'], s) for s, r in floor_rows.items() if r['minFloat'] < -limit)},
              'floorTable': floor_rows}
    (out / 'checks.json').write_text(json.dumps(report, indent=1) + '\n')
    print(f"{report['clips']} clips, {report['drawings']} drawings; schema problems {len(problems)}; grounded drawings "
          f"{report['grounded']['drawings']} in {report['grounded']['clips']} clips, over {limit} px: "
          f"{len(sinking)}, max body sink {report['grounded']['maxSink']}")
    for problem in problems[:20]:
        print('  -', problem)
    return 1 if problems else 0


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('command', choices=('render', 'pack', 'check'))
    ap.add_argument('--plan', default=str(DEFAULT_PLAN))
    ap.add_argument('--raw', required=True, help='directory of the renderer output (<raw>/<motion>/<motion>-NNN.png|json)')
    ap.add_argument('--out', help='pack / check: the staging directory')
    ap.add_argument('--clock', default=str(DEFAULT_CLOCK))
    ap.add_argument('--jobs', type=int, default=8)
    ap.add_argument('--only', help='render: comma separated engine sheet names (clips or article sheets)')
    ap.add_argument('--resume', action='store_true', help='render: keep clips whose drawings already exist')
    args = ap.parse_args(argv[1:])
    for key in ('plan', 'raw', 'out', 'clock'):      # the renderer chdirs to the repo root on import
        if getattr(args, key):
            setattr(args, key, str(Path(getattr(args, key)).resolve()))
    if args.command != 'render' and not args.out:
        ap.error(f'{args.command} needs --out')
    return {'render': cmd_render, 'pack': cmd_pack, 'check': cmd_check}[args.command](args)


if __name__ == '__main__':
    sys.exit(main(sys.argv))
