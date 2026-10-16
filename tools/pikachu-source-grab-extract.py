#!/usr/bin/env python3
"""Read root CATCH regions and preserve throw records from verified captures."""
import hashlib, json, re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/review/2026-10-06/pikachu-character/sources'
native = json.loads((OUT / 'native-attacks.json').read_text())
keys = ['id', 'bone', 'size', 'x', 'y', 'z', 'x2', 'y2', 'z2', 'status', 'situation']

def atom(value):
    value = value.strip()
    if value == 'None': return None
    if value.startswith('Some('): return float(value[5:-1])
    if value.startswith('Hash40::new('): return value.split('"')[1]
    if value.startswith('*'): return value[1:]
    return float(value) if '.' in value else int(value)

captures = {}
for motion in ['Catch', 'CatchDash', 'CatchTurn', 'CatchAttack', 'ThrowF', 'ThrowB', 'ThrowHi', 'ThrowLw']:
    record = native['motions']['pikachu/' + motion]
    path = ROOT / record['path']
    assert hashlib.sha256(path.read_bytes()).hexdigest() == record['sha256']
    game = record['functions'][0]
    catches = []
    frame = 0
    for line_number, line in enumerate(path.read_text().splitlines(), 1):
        if line.startswith('unsafe extern') and 'game_' not in line: break
        clock = re.search(r'(frame|wait)\(agent.lua_state_agent, ([\d.]+)\)', line)
        if clock:
            frame = float(clock[2]) if clock[1] == 'frame' else frame + float(clock[2])
        call = re.search(r'macros::CATCH\(agent, (.*)\);', line)
        if call:
            args = call[1].split(',')
            assert len(args) == len(keys)
            catches.append({**dict(zip(keys, map(atom, args))), 'frame': frame,
                'source_line': line_number, 'raw': line.strip(), 'raw_args': [arg.strip() for arg in args],
                'end_frame': None})
        if 'MA_MSC_CMD_GRAB_CLEAR_ALL' in line:
            for catch in catches:
                if catch['end_frame'] is None: catch['end_frame'] = frame
    captures[motion] = {'path': record['path'], 'sha256': record['sha256'],
        'catches': catches, 'attacks': game['attacks'], 'absolutes': game['absolutes'], 'events': game['events']}

payload = {'script_revision': native['script_revision'], 'clock': native['clock'],
    'catches': captures,
    'down_throw_conflict': {'native_release_motion_frame': 21, 'ufd_release_game_frame': 29,
        'selected_elapsed_release': 28, 'native_same_execute_contact_and_clear_at14': True,
        'held_target_damage3_at14': 'not selected; zero-duration native region cannot establish successful damage; UFD displays only5'}}
(OUT / 'native-grab-records.json').write_text(json.dumps(payload, indent=2) + '\n')
print('Verified/extracted six CATCH regions, pummel and four throw traces.')
