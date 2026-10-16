#!/usr/bin/env python3
"""Regenerate the numeric DK table from the verified primary script captures.
Authored move timelines and projected bone anchors remain in DonkeyKong.ts.
"""
import hashlib, json, re
from pathlib import Path
root = Path(__file__).resolve().parents[1]
source = root / 'docs/review/2026-10-06/dk-all-attack-values/sources'
manifest = json.loads((source / 'verified.json').read_text())
# Manifest is a list of independently fetched files with hashes.
expected_hashes = {r['motion']: r['sha256'] for r in manifest}
records = {}
for path in sorted(source.glob('*.txt')):
    assert hashlib.sha256(path.read_bytes()).hexdigest() == expected_hashes[path.stem], f'Unverified source: {path}'
    raw = path.read_text()
    game = next((part for part in raw.split('unsafe extern "C" fn') if part.strip().startswith('game_')), '')
    frame = 0
    hits = []; seen = set()
    for line in game.splitlines():
        clock = re.search(r'(frame|wait)\(agent.lua_state_agent, ([\d.]+)\)', line)
        if clock: frame = float(clock[2]) if clock[1] == 'frame' else frame + float(clock[2])
        attack = re.search(r'macros::ATTACK\(agent, (.*)\);', line)
        if not attack: continue
        a = [v.strip() for v in attack[1].split(', ')]
        id = int(a[0]); key = (frame,id)
        if key in seen: continue # Following copy branch is Kirby, not DK.
        seen.add(key)
        option = lambda i: None if a[i] == 'None' else float(re.search(r'Some\((.*)\)',a[i])[1])
        hits.append(dict(frame=frame,id=id,bone=re.search(r'"(.*)"',a[2])[1],damage=float(a[3]),angle=int(a[4]),
          kbg=int(a[5]),fkb=int(a[6]),bkb=int(a[7]),size=float(a[8]),y=float(a[10]),z=float(a[11]),
          y2=option(13),z2=option(14),hitlag=float(a[15]),sdi=float(a[16]),lr_check=a[18].lstrip('*'),
          set_weight=a[19]=='true',shield_damage=float(a[20]),situation=a[28].lstrip('*'),category=a[29].lstrip('*')))
    if hits: records[path.stem] = hits
header = '''/** Copied from verified vanilla Ultimate scripts, revision 59004685238a3f6f93bae905d3a4e079701c40b4.
 * UFD supplies gameplay timing; these records supply per-region numeric values.
 * Reproduction and independent comparisons: docs/review/2026-10-06/dk-all-attack-values/. */
export const DK_NATIVE_ATTACKS = '''
text = header + '{\n' + ',\n'.join('  '+json.dumps(k)+': [\n'+',\n'.join('    '+json.dumps(row,separators=(',', ': ')) for row in rows)+'\n  ]' for k,rows in records.items()) + '\n} as const;\n'
(root / 'src/characters/donkeykongAttackData.ts').write_text(text)
print(f'Generated {sum(map(len, records.values()))} regions across {len(records)} attack motions.')
