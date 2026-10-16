"""Export only actually reviewed special body receiving and exact packed windows."""
from pathlib import Path
import hashlib, json
ROOT = Path(__file__).resolve().parents[1]
E = ROOT / 'docs/review/2026-10-06/pikachu-character/sources/full-body-native-review/special-receiving'
data = json.loads((E / 'candidates.json').read_text())
rows = []
for packpath in sorted((ROOT / 'assets/characters/pikachu/pose-batches').glob('thunder-*.json')):
    pack = json.loads(packpath.read_text())
    if pack['state'] != 'packed_cells_visually_reviewed_runtime_pending':
        continue
    for sheet, animation in pack['animations'].items():
        for window, source in zip(animation['frameWindows'], pack['sources']):
            row = next(r for r in data['rows'] if r['key'] == source['sourceKey'])
            if not row['bodyIsAcceptedFinal'] or not row['receivingReview'].startswith('actually inspected'):
                raise ValueError('Special receiving body was not actually reviewed')
            if hashlib.sha256((ROOT / row['bodyPath']).read_bytes()).hexdigest() != row['bodySha256']:
                raise ValueError('Changed receiving body')
            rows.append({'sheet': sheet, 'nativeSample': row['nativeSample'],
                         'startElapsed': window['startFrame'], 'endElapsed': window['endFrame'],
                         'hurtboxes': row['hurtboxes']})
target = ROOT / 'src/characters/pikachuSpecialHurtboxes.ts'
target.write_text('''/** Actually body/overlay-reviewed sparse special receiving projections.
 * Exact branch-local windows match accepted packed art. Source2Dtarget adaptation;
 * vulnerability/whole-body intangibility and real runtime contacts are separate. */
export const PIKACHU_SPECIAL_AUTHORED_HURTBOX_POSES = ''' + json.dumps(rows, separators=(',', ':')) + ''' as const;
export function selectPikachuSpecialHurtboxes(sheet: string, localFrame: number) {
  if (!Number.isInteger(localFrame) || localFrame < 0) return null;
  return PIKACHU_SPECIAL_AUTHORED_HURTBOX_POSES.find(row => row.sheet === sheet
    && localFrame >= row.startElapsed && localFrame < row.endElapsed)?.hurtboxes ?? null;
}
''')
print(json.dumps({'reviewedRuntimePoses': len(rows), 'sheets': list(dict.fromkeys(r['sheet'] for r in rows))}))
