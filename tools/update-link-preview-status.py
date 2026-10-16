#!/usr/bin/env python3
"""Publish a read-only artwork progress snapshot; never run gameplay checks."""
from pathlib import Path
from datetime import datetime, timezone
import json
import os
import argparse
import time
import hashlib
import fcntl
import re

ROOT = Path(__file__).resolve().parents[1]
REVIEW = ROOT / 'docs/review/2026-10-12/link-character/rework'
DEST = ROOT / '.tmp/link-preview-status.json'
EXPORT_SNAPSHOTS = REVIEW / 'art/base-export-progress-snapshots'
BODY_PLAN = REVIEW / 'art/production-plan-v2/index.json'
COMPOSED_PLAN = REVIEW / 'art/composed-resource-bank-v1/plan.json'
CONDITIONAL_PLAN = REVIEW / 'art/conditional-native-receiving-bank-v1/plan.json'
CONDITIONAL_LEDGER = REVIEW / 'art/conditional-native-receiving-bank-v1/job-ledger.json'
HAND_PLAN = REVIEW / 'art/hand-known-held-host-bank-v1/plan.json'
HAND_LEDGER = REVIEW / 'art/hand-known-held-host-bank-v1/job-ledger.json'
JOINED_HAND_DIR = REVIEW / 'art/joined-hand-shieldback-bank-v1'
JOINED_HAND_PLAN = JOINED_HAND_DIR / 'plan.json'
JOINED_HAND_BANKS = [('joined-hand-shieldback-bank-v1', 'render-joined-hand-shieldback-v1.py'),
    ('joined-hand-shieldback-bank-v2-read-recovery', 'render-joined-hand-shieldback-v2-read-recovery.py'),
    ('joined-hand-shieldback-bank-v3-linux-io-recovery', 'render-joined-hand-shieldback-v3-linux-io-recovery.py')]

def export_receipt_path():
    return sorted(EXPORT_SNAPSHOTS.glob('*/index.json'))[-1]
INPUTS = [ROOT / 'assets/characters/link/frames.json', REVIEW / 'inventory.json',
          REVIEW / 'verification/action-runtime-scenario-map.json', ROOT / '.tmp/link-preview-status-owner-updates.json', BODY_PLAN, COMPOSED_PLAN, CONDITIONAL_PLAN, CONDITIONAL_LEDGER, HAND_PLAN, HAND_LEDGER]

def export_progress():
    receipt = json.loads(export_receipt_path().read_text())
    body_plan = json.loads(BODY_PLAN.read_text())
    cleared = set(body_plan['bulkClearedResources'])
    expected_body = {(Path(row['resource']).stem, sample) for row in body_plan['resources']
                     if Path(row['resource']).stem in cleared for sample in row['candidateNativeSamples']}
    tuple_fields = ('lowerResource', 'lowerFrameIndex', 'lowerNativeSample', 'upperResource', 'upperFrameIndex', 'upperNativeSample')
    composition_plan = json.loads(COMPOSED_PLAN.read_text())
    expected_composed = {tuple(t[field] for field in tuple_fields) for family in composition_plan['families'] for t in family['tuples']}
    body, composed, live_workers = {}, {}, []
    completed = lambda c: isinstance(c.get('targetSHA'), str) and re.fullmatch('[a-f0-9]{64}', c['targetSHA']) and c.get('sourceRecord') and c.get('artistRecord')
    owner_updates = ROOT / '.tmp/link-preview-status-owner-updates.json'
    extra = json.loads(owner_updates.read_text()) if owner_updates.exists() else {}
    ledger_paths = [row['path'] for row in receipt['ledgers']] + extra.get('additionalQualifiedLedgers', [])
    for ledger_path in dict.fromkeys(ledger_paths):
        if not ledger_path.startswith('docs/review/2026-10-12/link-character/rework/art/') or '..' in Path(ledger_path).parts:
            raise ValueError('Invalid qualified export ledger path')
        data = json.loads((ROOT / ledger_path).read_text())
        pid = data.get('pid')
        process_path = Path('/proc') / str(pid) / 'cmdline'
        if isinstance(pid, int) and pid > 0 and process_path.exists() and data.get('state', '').startswith('RENDERING_'):
            arguments = process_path.read_bytes().decode().split('\0')
            kind = 'ordinary' if 'resources' in data else 'composed' if 'families' in data else None
            expected = REVIEW / 'art/resume-cached-bank-after-gpu-v1.py'
            script_matches = any((ROOT / argument).resolve() == expected.resolve() for argument in arguments if argument.endswith('.py'))
            if script_matches and kind in arguments:
                live_workers.append({'pid': pid, 'kind': kind, 'ledger': ledger_path})
        for resource, record in data.get('resources', {}).items():
            for cell in record.get('cells', {}).values():
                if not completed(cell):
                    continue
                sample = cell['nativeSample']
                if not isinstance(sample, int) or isinstance(sample, bool) or sample < 0:
                    raise ValueError('Invalid completed export sample')
                key = (resource, sample)
                if key not in expected_body:
                    continue
                if key in body and body[key] != cell['targetSHA']:
                    raise ValueError('Conflicting deduplicated body export hashes')
                body[key] = cell['targetSHA']
        for record in data.get('families', {}).values():
            for cell in record.get('cells', {}).values():
                if not completed(cell):
                    continue
                t = cell['sourceTuple']
                key = tuple(t[field] for field in tuple_fields)
                if key not in expected_composed:
                    continue
                if key in composed and composed[key] != cell['targetSHA']:
                    raise ValueError('Conflicting deduplicated composed export hashes')
                composed[key] = cell['targetSHA']
    if len(expected_body) != receipt['bodyMainCleared']['planned'] or len(expected_composed) != receipt['composedBase']['planned']:
        raise ValueError('Approved export plan/receipt denominator mismatch')
    return receipt, len(body), len(composed), live_workers



def conditional_progress():
    plan = json.loads(CONDITIONAL_PLAN.read_text())
    expected = {(Path(row['resource']).stem, raw) for row in plan['resources'] for raw in row['candidateNativeSamples']}
    if len(expected) != 730:
        raise ValueError('Conditional receiving denominator differs from approved native730 plan')
    ledger = json.loads(CONDITIONAL_LEDGER.read_text())
    if ledger.get('planSHA') != hashlib.sha256(CONDITIONAL_PLAN.read_bytes()).hexdigest():
        raise ValueError('Conditional receiving ledger has a different source plan')
    actual = {}
    for resource, data in ledger.get('resources', {}).items():
        for cell in data.get('cells', {}).values():
            raw = cell.get('nativeSample')
            if not isinstance(raw, int) or isinstance(raw, bool) or raw < 0:
                raise ValueError('Invalid conditional native sample')
            key = (resource, raw)
            if key not in expected:
                raise ValueError('Conditional cell lies outside approved exact source samples')
            if not all(isinstance(cell.get(field), str) and re.fullmatch('[a-f0-9]{64}', cell[field])
                       for field in ('targetSHA', 'sourceRecordSHA', 'artistRecordSHA')):
                continue
            if key in actual and actual[key] != cell['targetSHA']:
                raise ValueError('Conflicting conditional cell hashes')
            actual[key] = cell['targetSHA']
    pid = ledger.get('pid')
    process = Path('/proc') / str(pid) / 'cmdline'
    live = False
    if isinstance(pid, int) and process.exists() and ledger.get('state', '').startswith('RENDERING_'):
        expected_script = REVIEW / 'art/render-cached-conditional-native-receiving-bank-v1.py'
        live = any((ROOT / arg).resolve() == expected_script.resolve()
                   for arg in process.read_bytes().decode().split('\0') if arg.endswith('.py'))
    return len(actual), len(expected), {'pid': pid, 'running': live}


def hand_progress():
    plan = json.loads(HAND_PLAN.read_text())
    expected = {(row['bankKey'], sample): (row['resource'], row['overlayResource'], row['matchedChannelCount'])
                for row in plan['resources'] for sample in row['candidateNativeSamples']}
    if len(expected) != plan['candidateDrawingCount'] or len(expected) != 596:
        raise ValueError('Known held-host hand plan denominator changed')
    ledger = json.loads(HAND_LEDGER.read_text())
    if ledger.get('planSHA') != hashlib.sha256(HAND_PLAN.read_bytes()).hexdigest():
        raise ValueError('Hand ledger differs from the approved exact plan')
    actual = {}
    for bank, data in ledger.get('resources', {}).items():
        for cell in data.get('cells', {}).values():
            raw = cell.get('nativeSample')
            if not isinstance(raw, int) or isinstance(raw, bool) or raw < 0:
                raise ValueError('Invalid hand native sample')
            key = (bank, raw)
            if expected.get(key) != (cell.get('sourceResource'), cell.get('overlayResource'), cell.get('matchedChannelCount')):
                raise ValueError('Hand cell source/channels differ from exact plan')
            if not all(isinstance(cell.get(field), str) and re.fullmatch('[a-f0-9]{64}', cell[field])
                       for field in ('targetSHA', 'sourceRecordSHA', 'artistRecordSHA')):
                continue
            if key in actual and actual[key] != cell['targetSHA']:
                raise ValueError('Conflicting hand target hashes')
            actual[key] = cell['targetSHA']
    pid = ledger.get('pid')
    process = Path('/proc') / str(pid) / 'cmdline'
    live = False
    if isinstance(pid, int) and process.exists() and ledger.get('state', '').startswith('RENDERING_'):
        script = REVIEW / 'art/render-known-held-host-hand-bank-v1.py'
        live = any((ROOT / arg).resolve() == script.resolve()
                   for arg in process.read_bytes().decode().split('\0') if arg.endswith('.py'))
    return len(actual), len(expected), {'pid': pid, 'running': live}


def joined_hand_progress():
    if not JOINED_HAND_PLAN.exists():
        return None
    plan = json.loads(JOINED_HAND_PLAN.read_text())
    fields = ('lowerResource', 'lowerFrameIndex', 'lowerNativeSample', 'upperResource', 'upperFrameIndex', 'upperNativeSample')
    expected = {(row['bankKey'], tuple(t[field] for field in fields)):
                (row['resource'], row['overlayResource'], row['matchedChannelCount'])
                for row in plan['resources'] for t in row['tuples']}
    if len(expected) != plan['candidateDrawingCount'] or len(expected) != 9638:
        raise ValueError('Joined hand candidate denominator changed')
    qualified = []
    for bank, script in JOINED_HAND_BANKS:
        directory = REVIEW / 'art' / bank
        bank_plan_path = directory / 'plan.json'
        if not bank_plan_path.exists():
            continue
        bank_plan = json.loads(bank_plan_path.read_text())
        if any(bank_plan.get(key) != plan.get(key) for key in
               ('bodyPixelEquipmentContext', 'handPolicy', 'selectedSourcePolicy', 'externalBowOwnershipEquality')):
            raise ValueError('Joined hand continuation changed frozen source/gear policy')
        for row in bank_plan['resources']:
            for t in row['tuples']:
                key = (row['bankKey'], tuple(t[field] for field in fields))
                if expected.get(key) != (row['resource'], row['overlayResource'], row['matchedChannelCount']):
                    raise ValueError('Joined hand continuation contains an unqualified tuple')
        plan_sha = hashlib.sha256(bank_plan_path.read_bytes()).hexdigest()
        qualified.extend((p, plan_sha, script) for p in sorted(directory.glob('worker-*/job-ledger.json')))
    actual, workers = {}, []
    for ledger_path, plan_sha, renderer_script in qualified:
        ledger = json.loads(ledger_path.read_text())
        if ledger.get('planSHA') != plan_sha:
            raise ValueError('Joined hand worker has a different frozen continuation plan')
        for bank, data in ledger.get('resources', {}).items():
            for cell in data.get('cells', {}).values():
                t = cell.get('sourceTuple', {})
                key = (bank, tuple(t.get(field) for field in fields))
                if expected.get(key) != (cell.get('sourceResource'), cell.get('overlayResource'), cell.get('matchedChannelCount')):
                    raise ValueError('Joined hand tuple/channels differ from the exact plan')
                if not all(isinstance(cell.get(field), str) and re.fullmatch('[a-f0-9]{64}', cell[field])
                           for field in ('targetSHA', 'sourceRecordSHA', 'artistRecordSHA')):
                    continue
                if key in actual and actual[key] != cell['targetSHA']:
                    raise ValueError('Conflicting joined hand target hashes')
                actual[key] = cell['targetSHA']
        pid = ledger.get('pid')
        process = Path('/proc') / str(pid) / 'cmdline'
        if isinstance(pid, int) and process.exists() and ledger.get('state', '').startswith('RENDERING_'):
            script = REVIEW / 'art' / renderer_script
            if any((ROOT / arg).resolve() == script.resolve()
                   for arg in process.read_bytes().decode().split('\0') if arg.endswith('.py')):
                workers.append({'pid': pid, 'ledger': str(ledger_path.relative_to(ROOT))})
    return {'completed': len(actual), 'planned': len(expected), 'workers': workers,
            'precision': 'additive source-tuple art candidates; not full runtime reachability or acceptance'}


def publish():
    frames = json.loads((ROOT / 'assets/characters/link/frames.json').read_text())
    scope = json.loads((REVIEW / 'verification/action-runtime-scenario-map.json').read_text())
    inventory = json.loads((REVIEW / 'inventory.json').read_text())
    principal = [row for row in inventory['actions'] if row.get('applicable') is True]
    items = [row for row in inventory['itemCompatibilityRows'] if row.get('applicable') is True]
    mapped = lambda rows: sum(row.get('milestones', {}).get('source') is True for row in rows)
    extra_path = ROOT / '.tmp/link-preview-status-owner-updates.json'
    extra = json.loads(extra_path.read_text()) if extra_path.exists() else {}
    profiles = frames['runtimeBodyProfiles']
    export_receipt, body_count, composed_count, live_workers = export_progress()
    exported_body_total = body_count + export_receipt['firstStaticReviewedInstalled']['completed']
    running_kinds = {worker['kind'] for worker in live_workers}
    if running_kinds == {'ordinary', 'composed'}:
        activity = 'Body and moving/shooting artwork exports are running. '
    elif 'ordinary' in running_kinds:
        activity = 'Body artwork exports are running; moving/shooting export has no verified active worker. '
    elif 'composed' in running_kinds:
        activity = ('Base body export is complete; moving/shooting artwork export continues. '
                    if body_count == export_receipt['bodyMainCleared']['planned']
                    else 'Moving/shooting artwork export is running; body export has no verified active worker. ')
    else:
        activity = ('Base body and moving/shooting exports are complete; fitting and installation remain. '
                    if body_count == export_receipt['bodyMainCleared']['planned'] and composed_count == export_receipt['composedBase']['planned']
                    else 'Artwork export has no verified active worker; completed frames are retained. ')
    conditional_count, conditional_total, conditional_worker = conditional_progress()
    activity += ('Conditional receiving export is running. ' if conditional_worker['running'] else '')
    hand_count, hand_total, hand_worker = hand_progress()
    joined_hand = joined_hand_progress()
    activity += ('The known hand/equipment artwork bank is exporting. ' if hand_worker['running'] else '')
    if joined_hand and joined_hand['workers']:
        activity += 'Moving and shooting hand/shield artwork is exporting. '
    status = {
        'schema': 'link-preview-progress/1',
        'updatedAt': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'currentActivity': activity + extra.get('currentActivity', 'Source mapping and runtime integration continue.'),
        'activeExportWorkers': live_workers,
        'conditionalExportWorker': conditional_worker,
        'handExportWorker': hand_worker,
        'joinedHandExport': joined_hand,
        'stages': [
            {'title': 'Requirements inventoried', 'value': f"{scope['counts']['applicableRows']} required cases", 'detail': 'Actions, items, shared resources, and conditional receiving variants are listed. Remaining native source gaps stay documented.'},
            {'title': 'Move specifications', 'value': f'{mapped(principal)}/{len(principal)} mapped', 'detail': 'Source rules and behavior mapping; gameplay verification pending.'},
            {'title': 'Weapon/item specifications', 'value': f'{mapped(items)}/{len(items)} mapped', 'detail': 'Source rules and behavior mapping; gameplay verification pending.'},
            {'title': 'Installed artwork', 'value': f"{len(profiles)} motion families · {sum(len(p['drawings']) for p in profiles.values())} drawings", 'detail': 'The installed motion families are available in this preview. Gameplay verification remains pending.'},
            {'title': 'Base body artwork exported', 'value': f"{exported_body_total:,}/{export_receipt['bodyIncludingFirst133']['planned']:,} drawings", 'detail': 'Includes the first 133 installed drawings. Remaining exports still need visual review, geometry fitting, packing, and installation.'},
            {'title': 'Base moving/shooting artwork exported', 'value': f"{composed_count:,}/{export_receipt['composedBase']['planned']:,} paired drawings", 'detail': 'Exact lower-body/upper-body pose pairs. Hand and equipment additions, projectiles, cargo, and Finals remain additional work.'},
            {'title': 'Additional grab and throw artwork', 'value': f'{conditional_count:,}/{conditional_total:,} drawings', 'detail': 'Conditional receiving templates for supported grab variants. Export only; pixel review, fitting, packing, installation, and match acceptance remain.'},
            {'title': 'Known held-item hand artwork exported', 'value': f'{hand_count:,}/{hand_total:,} drawings', 'detail': 'Bounded set of 11 body motions and two hand helpers. Additional item, joined shooting, gear, cargo and Final contexts remain; review, fitting, binding and installation are pending.'},
            *([{'title': 'Moving/shooting hand and shield artwork', 'value': f"{joined_hand['completed']:,}/{joined_hand['planned']:,} candidate drawings", 'detail': 'Additional hand and shield placement over the finished base artwork. '+('All current source combinations are exported' if joined_hand['completed']==joined_hand['planned'] else 'Current source combinations are exporting')+'; reachable contexts, review, fitting, binding and installation remain.'}] if joined_hand else []),
            extra.get('handStage', {'title': 'Hand and equipment artwork', 'value': 'Pending', 'detail': 'Source channel audit and equipment context are ready. New matched hand poses and shield placement still need artwork.'}),
            extra.get('finalStage', {'title': 'Final Smash artwork', 'value': 'Pending', 'detail': 'New Donkey Kong and Pikachu Final Smash artwork and Donkey Kong collision fitting are still being prepared.'}),
            {'title': 'Match verification', 'value': f"0 / {scope['counts']['applicableRows']} accepted", 'detail': 'The complete end verification run starts after implementation and required artwork are ready.'},
        ],
        'remaining': [
            'Finish and install the remaining body, item, projectile, and Final Smash artwork.',
            'Fit hand and equipment poses, cargo receiving anchors, and the Donkey Kong collision geometry.',
            'Complete item equipment timing and the remaining runtime connections.',
            'Prepare every required input, hit, miss, boundary, and cleanup verification case.',
            'Run the complete final verification, including both facings, keyboard/gamepad, and memory measurements.',
        ],
        'verificationExecuted': False,
        'gameBuildChangedByPreview': False,
    }
    DEST.parent.mkdir(exist_ok=True)
    temporary = DEST.with_suffix('.json.next')
    temporary.write_text(json.dumps(status, indent=2) + '\n')
    os.replace(temporary, DEST)
    message = status['updatedAt'] + ' Published ' + str(DEST)
    with (ROOT / '.tmp/link-preview-status-watcher.log').open('a') as log: log.write(message + '\n')
    print(message, flush=True)


def fingerprint():
    h = hashlib.sha256()
    receipt_path = export_receipt_path()
    receipt = json.loads(receipt_path.read_text())
    owner_updates = ROOT / '.tmp/link-preview-status-owner-updates.json'
    extra = json.loads(owner_updates.read_text()) if owner_updates.exists() else {}
    paths = INPUTS + [receipt_path] + [ROOT / row['path'] for row in receipt['ledgers']] + [ROOT / path for path in extra.get('additionalQualifiedLedgers', [])]
    for path in paths:
        h.update(str(path).encode())
        h.update(path.read_bytes() if path.exists() else b'<missing>')
    for row in receipt['ledgers'] + [{'path': path} for path in extra.get('additionalQualifiedLedgers', [])]:
        data = json.loads((ROOT / row['path']).read_text())
        process_path = Path('/proc') / str(data.get('pid')) / 'cmdline'
        h.update(process_path.read_bytes() if process_path.exists() else b'<worker-absent>')
    conditional = json.loads(CONDITIONAL_LEDGER.read_text())
    process = Path('/proc') / str(conditional.get('pid')) / 'cmdline'
    h.update(process.read_bytes() if process.exists() else b'<conditional-worker-absent>')
    hand = json.loads(HAND_LEDGER.read_text())
    process = Path('/proc') / str(hand.get('pid')) / 'cmdline'
    h.update(process.read_bytes() if process.exists() else b'<hand-worker-absent>')
    if JOINED_HAND_PLAN.exists():
        h.update(JOINED_HAND_PLAN.read_bytes())
        for bank, _script in JOINED_HAND_BANKS:
            directory = REVIEW / 'art' / bank
            plan_path = directory / 'plan.json'
            h.update(plan_path.read_bytes() if plan_path.exists() else b'<joined-hand-continuation-absent>')
            for ledger_path in sorted(directory.glob('worker-*/job-ledger.json')):
                data = json.loads(ledger_path.read_text())
                h.update(ledger_path.read_bytes())
                process = Path('/proc') / str(data.get('pid')) / 'cmdline'
                h.update(process.read_bytes() if process.exists() else b'<joined-hand-worker-absent>')
    return h.digest()

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--watch', action='store_true')
    args = parser.parse_args()
    if not args.watch:
        publish()
    else:
        # Singleton lock belongs to this process, released automatically on exit.
        lock = open(ROOT / '.tmp/link-preview-status.lock', 'a')
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise SystemExit('Status watcher already running')
        (ROOT / '.tmp/link-preview-status.pid').write_text(str(os.getpid()) + '\n')
        previous = None
        while True:
            try:
                current = fingerprint()
                if current != previous:
                    publish()
                    previous = current
            except Exception as error:
                print(datetime.now(timezone.utc).isoformat(), type(error).__name__, str(error), flush=True)
                # Retain last complete JSON on partial concurrent source writes.
            time.sleep(15)
