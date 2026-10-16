#!/usr/bin/env python3
"""Key-pose plan: which native samples of a clip deserve a drawing.

Implements rule a.1-a.6 of docs/review/2026-10-14/art-budget/PLAN.md as a pure,
deterministic function (`plan_clip`). Samples are 1-based native frames.

  a.2 mandatory: sample 1, every strike sample K and event sample, start and end
      of every window, end E (= cancel C if C > 0 else N; loops N-1).
  a.3 fill: every gap (a, b) longer than G is split into k = ceil((b-a)/G) equal
      parts; offset rounding as in split_point (reproduces clip-plan.json).
  a.4 cap 12: re-fill with the smallest G' that fits; if the mandatory set alone
      exceeds the cap, drop window ends, latest first (never sample 1, a strike,
      an event, or E).
  a.5 loop seam: a loop sample held for < 2 frames (next sample, or N for the
      last, minus itself) is dropped unless it is a strike/event sample.
  a.6 thinning: with `existing` drawings, snap each planned sample to the nearest
      existing drawing (ties to the earlier); a mandatory sample must exist
      exactly, otherwise it is reported in `missing` (CLI exits 1).

Adapters:  dk    docs/review/2026-09-25/.../rework-2026-10-10/clip-plan.json
           link  src/characters/linkAttackGeometry.json + linkAttackData.json +
                 linkNormalRules.ts (first-actionable frames) + nuanmb headers
Usage:
  key-pose-plan.py dk-selftest
  key-pose-plan.py link --frames <frames.json> --out <plan.json> [--allow-missing]
  key-pose-plan.py link-missing --inventory <names.txt> --out <plan.json>
Run with ~/ComfyUI/.venv/bin/python -I.
"""
import argparse
import json
import math
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CAP = 12
DK_PLAN = ROOT / 'docs/review/2026-09-25/donkeykong-character/rework-2026-10-10/clip-plan.json'
LINK_GEOMETRY = ROOT / 'src/characters/linkAttackGeometry.json'
LINK_DATA = ROOT / 'src/characters/linkAttackData.json'
LINK_RULES = ROOT / 'src/characters/linkNormalRules.ts'
LINK_CAPTURE = ROOT / 'src/characters/linkFreshCaptureSource.json'


def split_point(a, b, j, k):
    """j-th of k equal split points of (a, b). PLAN.md a.3 says "ties to the lower frame";
    clip-plan.json was made with Python round() on the offset (half to even), which is what
    reproduces it (e.g. 1..16 -> 9 but 1..30 -> 15), so that is what is done here."""
    return a + round(j * (b - a) / k)


def fill(base, g):
    out = set(base)
    pts = sorted(base)
    for a, b in zip(pts, pts[1:]):
        if b - a > g:
            k = math.ceil((b - a) / g)
            out.update(split_point(a, b, j, k) for j in range(1, k))
    return sorted(out)


def plan_clip(n, loop, cancel, windows, strikes, events, gap, cap=CAP):
    """Return {'samples': [...], 'reasons': {sample: [...]}, 'mandatory': [...],
    'beforeSeam': [...], 'capped': bool, 'gap': G_used, 'maxGap': int}.

    windows: [(start, end)], strikes/events: [sample]. All 1-based, clamped to 1..N."""
    clamp = lambda s: max(1, min(int(s), n))
    reasons = {}

    def add(sample, why):
        reasons.setdefault(clamp(sample), [])
        if why not in reasons[clamp(sample)]:
            reasons[clamp(sample)].append(why)

    add(1, 'first')
    for s in strikes:
        add(s, 'strike')
    for s in events:
        add(s, 'event')
    for a, b in windows:
        add(a, 'window-start')
        add(b, 'window-end')
    end = n - 1 if loop else (min(cancel, n) if cancel and cancel > 0 else n)
    end = max(end, 1)
    add(end, 'end' if loop or not (cancel and cancel > 0) else 'actionable')
    protected = {s for s, r in reasons.items()
                 if any(x in ('first', 'strike', 'event', 'end', 'actionable') for x in r)}
    mandatory = set(reasons)

    def build(base):
        g = gap
        while True:
            s = fill(base, g)
            if len(s) <= cap or g >= n:
                return s, g
            g += 1

    base = set(mandatory)
    samples, used = build(base)
    if len(samples) > cap:  # mandatory set alone is too big: drop window ends, latest first
        for s in sorted((x for x in base if x not in protected), reverse=True):
            if len(samples) <= cap:
                break
            if 'window-end' in reasons[s]:
                base.discard(s)
                reasons[s] = [r for r in reasons[s] if r != 'window-end']
                if not reasons[s]:
                    del reasons[s]
                samples, used = build(base)
    mandatory = set(base)
    for s in samples:
        if s not in reasons:
            reasons[s] = ['fill']
    before_seam = list(samples)
    if loop:  # a.5
        keep = []
        for i, s in enumerate(samples):
            held = (samples[i + 1] if i + 1 < len(samples) else n) - s
            if held < 2 and not (set(reasons[s]) & {'strike', 'event'}) and len(samples) > 1:
                continue
            keep.append(s)
        samples = keep
    reasons = {s: reasons[s] for s in samples}
    gaps = [b - a for a, b in zip(samples, samples[1:])]
    return {'samples': samples, 'reasons': reasons, 'mandatory': sorted(mandatory & set(samples)),
            'beforeSeam': before_seam, 'capped': used > gap or len(fill(mandatory, gap)) > cap,
            'gap': used, 'maxGap': max(gaps) if gaps else 0}


def thin(plan, existing):
    """a.6: snap planned samples to existing drawings; list unmet mandatory samples."""
    existing = sorted(set(existing))
    missing = [s for s in plan['mandatory'] if s not in existing]
    snapped, why = [], {}
    for s in plan['samples']:
        if s in plan['mandatory'] or s in existing:
            pick = s if s in existing else None
        else:
            pick = min(existing, key=lambda e: (abs(e - s), e))
        if pick is None:
            continue
        if pick not in why:
            snapped.append(pick)
            why[pick] = []
        for r in plan['reasons'][s]:
            if r not in why[pick]:
                why[pick].append(r if pick == s else f'{r}@{s}')
    snapped.sort()
    return dict(plan, samples=snapped, reasons={s: why[s] for s in snapped}, missing=missing,
                mandatory=[s for s in plan['mandatory'] if s in existing])


def out_entry(plan, **extra):
    return {'nativeSamples': plan['samples'], 'mandatory': plan['mandatory'],
            'reason': {str(s): plan['reasons'][s] for s in plan['samples']}, **extra}


# ---------------------------------------------------------------- DK adapter
HAND_EXCEPTIONS = {
    'parry': 'hand-set spacing 4 (G=8 would give 5 samples)',
    'dsmash_charge': 'charge loop that keeps both contact samples 11 and 13 (rule a.2 says loops take none)',
    'cargo_recipient_fthrow': 'extras2: drawn to the release frame 15 only; frames 16-65 never show',
    'cargo_recipient_bthrow': 'extras2: drawn to the release frame 16 only',
    'cargo_recipient_uthrow': 'extras2: drawn to the release frame 15 only',
    'cargo_recipient_dthrow': 'extras2: drawn to the release frame 17 only',
}


def dk_inputs(row):
    wins = [(w['start'], w['end']) for w in row['active_windows']]
    strikes = [] if row['loop'] else list(row['contact_frames'])  # hold loops take no contacts
    cancel = row['native_cancel_frame'] or 0
    if row['key'].startswith('taunt'):  # clip-plan.json ambiguity 9: taunts use every native frame
        cancel = 0
    return dict(n=row['native_total_frames'], loop=row['loop'], cancel=cancel,
                windows=wins, strikes=strikes, events=[], gap=row['gap_limit'])


def dk_selftest(path=DK_PLAN):
    """Compare rules a.1-a.4 with clip-plan.json. Returns (exact, capped, exceptions, unexplained, seam, total).

    capped: the plan's cap-12 samples were thinned by hand-run drop-fill, a.4 re-fills instead; these
    must still agree on every first/strike/end sample and respect the cap."""
    rows = json.loads(Path(path).read_text())['clips']
    exact, capped, exceptions, unexplained, seam = [], [], [], [], []
    for row in rows:
        if not row['nativeSamples']:
            continue
        got = plan_clip(**dk_inputs(row))
        want = row['nativeSamples']
        keep = {s for s, r in got['reasons'].items() if set(r) & {'first', 'strike', 'event', 'end', 'actionable'}}
        if got['samples'] != got['beforeSeam']:
            seam.append({'key': row['key'], 'dropped': sorted(set(got['beforeSeam']) - set(got['samples']))})
        entry = {'key': row['key'], 'plan': want, 'tool': got['beforeSeam'],
                 'onlyPlan': sorted(set(want) - set(got['beforeSeam'])),
                 'onlyTool': sorted(set(got['beforeSeam']) - set(want))}
        if got['beforeSeam'] == want:
            exact.append(row['key'])
        elif row['key'] in HAND_EXCEPTIONS:
            exceptions.append(dict(entry, why=HAND_EXCEPTIONS[row['key']]))
        elif row['capped'] and len(want) <= CAP and keep <= set(want) and len(got['beforeSeam']) <= CAP:
            capped.append(dict(entry, maxGapPlan=max(b - a for a, b in zip(want, want[1:])), maxGapTool=got['maxGap']))
        else:
            unexplained.append(entry)
    return exact, capped, exceptions, unexplained, seam, len(rows)


# --------------------------------------------------------------- Link adapter
# Clip keys are either the staged names (idle, fall_b, smash_charge) or raw motion names.
LOOP_CLIPS = re.compile(r'(^(idle|walk|run|dash|air_drift|fall\w*)$|wait\w*$|loop$|hold$|charge$|'
                        r'a01walk(middle|fast|slow)$|a02run$|a04fall\w*$|heavywalk$|legswalk[fb]$|furafura$)')
ATTACK_FAMILY = re.compile(r'(jab|tilt|smash|dash_attack|^[nfbud]air$|special|spin|throw|catch|grab|pummel|swing|'
                           r'shoot|attack|final|c0\d)')


def link_gap(clip):
    return 6 if ATTACK_FAMILY.search(clip) else 8


def link_loop(clip):
    return bool(LOOP_CLIPS.match(clip))


def link_first_actionable():
    """Public first-actionable frames of the 16 normals plus the recovery attacks."""
    fa = {}
    text = LINK_RULES.read_text()
    for m in re.finditer(r"'(link\.\w+)':rule\('(\w+)',(\d+),(\d+)", text):
        fa[m.group(1)] = int(m.group(3))
    for k, v in json.loads(LINK_DATA.read_text())['recovery'].items():
        fa[k] = v['firstActionable']
    return fa


def link_native_frames(motion):
    """N = final_frame_index + 1 from the nuanmb, through the existing Link pose reader."""
    sys.path.insert(0, str(ROOT / 'tools'))
    import link_native_pose as lnp
    path = lnp.MOTIONS / f'{motion}.nuanmb'
    return int(lnp.ssbh.anim_data.read_anim(str(path)).final_frame_index) + 1


def runs(samples):
    out, start, prev = [], None, None
    for s in sorted(set(samples)):
        if start is None or s != prev + 1:
            if start is not None:
                out.append((start, prev))
            start = s
        prev = s
    if start is not None:
        out.append((start, prev))
    return out


def link_move_tables():
    """motion -> {'windows': [(a,b)], 'events': [...], 'cancel': C, 'move': id}"""
    geo = json.loads(LINK_GEOMETRY.read_text())
    fa = link_first_actionable()
    table = {}
    for mid, mv in geo['moves'].items():
        by_role = {}
        for r in mv['rows']:
            by_role.setdefault(r['role'], []).append(r['sample'])
        wins = [w for role in by_role for w in runs(by_role[role])]
        table.setdefault(mv['motion'], {'move': mid, 'windows': [], 'events': [], 'cancel': 0,
                                        'nativeFrames': mv['nativeFrames']})
        table[mv['motion']]['windows'] = sorted(set(table[mv['motion']]['windows'] + wins))
        table[mv['motion']]['cancel'] = fa.get(mid, 0)
    capture = json.loads(LINK_CAPTURE.read_text())['captureContracts']
    for row in capture['grabs'] + capture['throws']:  # native cancel frames, throw release and hitbox range
        motion = row['nativeMotion']['animations'][0].replace('.nuanmb', '')
        t = table.setdefault(motion, {'move': row['inventoryActionId'], 'windows': [], 'events': [], 'cancel': 0})
        t['cancel'] = int(row['nativeMotion']['cancelFrame'])
        timing = row.get('wiki', {}).get('timingSource', '')
        release = re.search(r'!Throw Release\s*\n\|(\d+)', timing)
        hitbox = re.search(r'!Hitbox\s*\n\|(\d+)(?:-(\d+))?', timing)
        if release:
            t['events'] = sorted(set(t['events'] + [int(release.group(1))]))
        if hitbox and not t['windows']:
            t['windows'] = [(int(hitbox.group(1)), int(hitbox.group(2) or hitbox.group(1)))]
    for rp in geo['releasePoints']:
        row = table.setdefault(rp['motion'], {'move': rp['move'], 'windows': [], 'events': [], 'cancel': 0})
        row['events'] = sorted(set(row['events'] + [max(1, rp['sample'])]))
    return table


def link_clip_plan(clip, motion, table, existing=None, n=None):
    t = table.get(motion, {})
    n = n or t.get('nativeFrames') or link_native_frames(motion)
    wins = t.get('windows', [])
    plan = plan_clip(n=n, loop=link_loop(clip), cancel=t.get('cancel', 0), windows=wins,
                     strikes=[a for a, _ in wins], events=t.get('events', []), gap=link_gap(clip))
    extra = {'motion': motion, 'nativeFrames': n, 'move': t.get('move')}
    if existing is not None:
        before = len(existing)
        plan = thin(plan, existing)
        extra.update(drawingsBefore=before, drawingsAfter=len(plan['samples']), missing=plan['missing'])
    return out_entry(plan, **extra)


def link_staged(frames_path, out_path, allow_missing):
    frames = json.loads(Path(frames_path).read_text())
    inv = {v: k for k, v in frames['meta']['clipRenames'].items()}
    table = link_move_tables()
    clips = {}
    for clip, anim in frames['animations'].items():
        clips[clip] = link_clip_plan(clip, inv[clip], table, existing=anim['nativeSampleIndices'])
    Path(out_path).write_text(json.dumps({'source': str(frames_path), 'rule': 'PLAN.md a.1-a.6', 'clips': clips}, indent=1) + '\n')
    return clips


def table_text(clips):
    lines = [f"{'clip':<16}{'motion':<20}{'N':>4}{'before':>8}{'after':>7}{'mand':>6}  missing"]
    tb = ta = 0
    for k, c in clips.items():
        tb += c['drawingsBefore']; ta += c['drawingsAfter']
        lines.append(f"{k:<16}{c['motion']:<20}{c['nativeFrames']:>4}{c['drawingsBefore']:>8}{c['drawingsAfter']:>7}"
                     f"{len(c['mandatory']):>6}  {c['missing'] or ''}")
    lines.append(f"{'TOTAL':<40}{tb:>8}{ta:>7}")
    return '\n'.join(lines)


def link_missing(inventory, out_path):
    """Plan for Link clips with no staged art. inventory: one native motion name per line
    (optionally 'clipkey=motion'); names not found among the nuanmb files are listed unresolved."""
    sys.path.insert(0, str(ROOT / 'tools'))
    import link_native_pose as lnp
    available = {p.stem for p in lnp.MOTIONS.glob('*.nuanmb')}
    table = link_move_tables()
    clips, unresolved = {}, []
    for line in Path(inventory).read_text().splitlines():
        line = line.split('#')[0].strip()
        if not line:
            continue
        clip, _, motion = line.partition('=')
        motion = (motion or clip).strip()
        clip = clip.strip()
        if motion not in available:
            unresolved.append(line)
            continue
        clips[clip] = link_clip_plan(clip, motion, table)
    Path(out_path).write_text(json.dumps({'rule': 'PLAN.md a.1-a.6', 'render': 'link-render-clip.py --frames <sample-1>',
                                          'clips': clips, 'unresolved': unresolved}, indent=1) + '\n')
    return clips, unresolved


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    sub = ap.add_subparsers(dest='cmd', required=True)
    sub.add_parser('dk-selftest').add_argument('--plan', default=str(DK_PLAN))
    p = sub.add_parser('link')
    p.add_argument('--frames', required=True); p.add_argument('--out', required=True)
    p.add_argument('--allow-missing', action='store_true')
    p = sub.add_parser('link-missing')
    p.add_argument('--inventory', required=True); p.add_argument('--out', required=True)
    args = ap.parse_args()
    if args.cmd == 'dk-selftest':
        exact, capped, exceptions, unexplained, seam, total = dk_selftest(args.plan)
        print(f'{len(exact)}/{total} clips reproduce clip-plan.json nativeSamples exactly (rules a.1-a.4)')
        print(f'{len(capped)} cap-12 clips differ only in which fill samples survive (a.4 re-fill vs hand drop-fill):')
        for d in capped:
            print('  CAPPED', d['key'], 'maxGap plan', d['maxGapPlan'], 'tool', d['maxGapTool'])
        print(f'{len(exceptions)} hand-edited exceptions:')
        for d in exceptions:
            print('  HAND', d['key'], '-', d['why'], '| plan', d['plan'], '| tool', d['tool'])
        print(f'{len(unexplained)} unexplained')
        for d in unexplained:
            print('  DIFF', json.dumps(d))
        print(f'seam (a.5) drops on {len(seam)} loop clips (all would be the loop-end sample unless listed):',
              json.dumps([x for x in seam if len(x["dropped"]) > 1]))
        return 0 if not unexplained else 1
    if args.cmd == 'link':
        clips = link_staged(args.frames, args.out, args.allow_missing)
        print(table_text(clips))
        bad = {k: c['missing'] for k, c in clips.items() if c['missing']}
        if bad and not args.allow_missing:
            print('FAIL mandatory samples without a drawing:', json.dumps(bad))
            return 1
        return 0
    clips, unresolved = link_missing(args.inventory, args.out)
    print(f'{len(clips)} planned, {len(unresolved)} unresolved:', unresolved)
    return 0


if __name__ == '__main__':
    sys.exit(main())
