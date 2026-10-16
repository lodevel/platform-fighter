"""Export inspected tiled body/capsule fits with their explicit playable windows."""
import argparse, json
from pathlib import Path
from pikachu_native_pose import ROOT, sha

E = ROOT / 'docs/review/2026-10-06/pikachu-character'
CANDIDATES = E / 'sources/full-body-native-review/tiled-receiving'
p = argparse.ArgumentParser()
p.add_argument('family', choices=['tilts', 'states', 'specials'])
args = p.parse_args()
rows = []
for path in sorted(CANDIDATES.glob('*-candidates.json')):
    family = path.name.removesuffix('-candidates.json')
    if (args.family == 'states' and family in ['tilts', 'specials']) or (args.family != 'states' and family != args.family):
        continue
    data = json.loads(path.read_text())
    if sha(E / 'sources/native-hurtbox-capsules.json') != data['capsulesSourceSha256']:
        raise ValueError('Changed capsule source')
    for row in data['rows']:
        window = row['frameWindow']
        if window is None:
            continue  # Source-order postaction cells remain evidence, not playable receiving.
        if not row['receivingReview'].startswith('actually inspected'):
            raise ValueError('Unreviewed actual receiving fit: ' + row['key'])
        meta = ROOT / 'assets/characters/pikachu/pose-batches' / ('full-' + row['sheet'] + '-tiled.json')
        pack = json.loads(meta.read_text())
        if pack['state'] != 'packed_cells_visually_reviewed_runtime_pending':
            raise ValueError('Actual packed body review required')
        animation = pack['animations'][row['sheet']]
        body = ROOT / 'assets/characters/pikachu' / animation['strip']
        if sha(body) != row['packedBodySha256'] or sha(body) != animation['sha256']:
            raise ValueError('Changed actual reviewed strip')
        if sha(ROOT / row['reviewPanel']) != row['reviewPanelSha256']:
            raise ValueError('Changed inspected overlay')
        if window not in animation['frameWindows'] or len(row['hurtboxes']) != 12:
            raise ValueError('Clock/capsule mismatch')
        rows.append({'action': row['action'], 'sheet': row['sheet'],
            'nativeSample': row['nativeSample'], 'artFrameIndex': row['artFrameIndex'],
            'startElapsed': window['startFrame'], 'endElapsed': window['endFrame'],
            'hurtboxes': row['hurtboxes']})
if not rows:
    raise ValueError('No actually reviewed playable body fits')

if args.family == 'tilts':
    contract = json.loads((E / 'sources/angled-tilt-runtime-clock-contract.json').read_text())
    for route in contract['actions']:
        selected = [r for r in rows if r['sheet'] == route['sheet']]
        actual = [{'startFrame': r['startElapsed'], 'endFrame': r['endElapsed'],
                   'artFrameIndex': r['artFrameIndex']} for r in selected]
        if actual != route['frameWindows']:
            raise ValueError('Incomplete/changed angled receiving windows')
    target = ROOT / 'src/characters/pikachuAngledTiltHurtboxes.ts'
    text = '''/** Actual accepted body/overlay-reviewed angled tilt receiving.
 * Sparse native 2D projection, not native3D collision parity. Postaction cells
 * are retained in art evidence and deliberately excluded from playable windows. */
import type { AttackMoveWithAnimation, MoveHurtboxModifier } from './moveSchema';
import { buildPikachuNormalMove } from './pikachuNormalMoves';
import { pikachuAngledTiltPose } from './pikachuAngledTiltPose';
export const PIKACHU_ANGLED_TILT_AUTHORED_HURTBOX_POSES = ''' + json.dumps(rows, separators=(',', ':')) + ''' as const;
export function buildPikachuAngledTiltWithAuthoredHurtboxes(angle: 'up' | 'down'): AttackMoveWithAnimation {
  const poses = PIKACHU_ANGLED_TILT_AUTHORED_HURTBOX_POSES.filter(row => row.sheet === `tilt_${angle}`);
  const hurtboxModifiers: MoveHurtboxModifier[] = poses.flatMap(row => row.hurtboxes.map(hurtbox => ({
    frameWindow: {startFrame: row.startElapsed, endFrame: row.endElapsed}, replaceBody: true, hurtbox})));
  return {...buildPikachuNormalMove(angle === 'up' ? 'forward-tilt-up' : 'forward-tilt-down', pikachuAngledTiltPose),
    hurtboxModifiers, animation: {startupFrames: 2, activeFrames: 3, recoveryFrames: 5,
      frameWindows: poses.map(row => ({startFrame: row.startElapsed, endFrame: row.endElapsed,
        artFrameIndex: row.artFrameIndex}))}};
}
'''
else:
    is_special = args.family == 'specials'
    if is_special:
        contract_path = E / 'sources/special-body-runtime-clock-contract.json'
        contract = json.loads(contract_path.read_text())
        routes = [phase for route in contract['actions'] for phase in [route] +
                  ([{**route, **route['additional_sheet']}] if 'additional_sheet' in route else [])]
        for sheet in dict.fromkeys(r['sheet'] for r in rows):
            phase = next(r for r in routes if r['sheet'] == sheet)
            expected = [(w['start_elapsed'], w['end_elapsed'], w['native_sample_index'])
                        for w in phase['playable_sample_windows']]
            actual = [(r['startElapsed'], r['endElapsed'], r['nativeSample'])
                      for r in rows if r['sheet'] == sheet]
            if actual != expected:
                raise ValueError('Incomplete/changed exact special phase receiving: ' + sheet)
    label = 'SpecialPhase' if is_special else 'State'
    target = ROOT / ('src/characters/pikachu' + label + 'Hurtboxes.ts')
    text = '''/** Actual accepted state body/overlay-reviewed sparse receiving.
 * Presentation-clock adaptation is explicit in each packed contract; source
 * protection windows and actual match contacts are qualified separately. */
import type { Hurtbox } from './moveSchema';
export const PIKACHU_STATE_AUTHORED_HURTBOX_POSES = ''' + json.dumps(rows, separators=(',', ':')) + ''' as const;
export function selectPikachuStateHurtboxes(sheet: string, localFrame: number): readonly (Hurtbox & { readonly capsule: NonNullable<Hurtbox['capsule']> })[] | null {
  if (!Number.isFinite(localFrame) || localFrame < 0) return null;
  return PIKACHU_STATE_AUTHORED_HURTBOX_POSES.find(row => row.sheet === sheet
    && localFrame >= row.startElapsed && (row.endElapsed === null || localFrame < row.endElapsed))?.hurtboxes ?? null;
}
'''
    if is_special:
        text = text.replace('PIKACHU_STATE_AUTHORED_HURTBOX_POSES', 'PIKACHU_SPECIAL_PHASE_AUTHORED_HURTBOX_POSES')
        text = text.replace('selectPikachuStateHurtboxes', 'selectPikachuSpecialPhaseHurtboxes')
        text = text.replace('Presentation-clock adaptation is explicit in each packed contract;',
                            'Exact phase clocks are bound in special-body-runtime-clock-contract.json;')
target.write_text(text)
print(json.dumps({'module': str(target.relative_to(ROOT)), 'reviewedPlayablePoses': len(rows)}))
