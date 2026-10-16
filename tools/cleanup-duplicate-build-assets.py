#!/usr/bin/env python3
"""Plan removal of obsolete scratch build assets with identical retained originals.

This reads the original October 14 manifest but never deletes review evidence,
source inputs, active builds or unique bytes. Default is a dry run. --apply
rechecks every source/destination hash in the saved plan before deleting.
Run from the repository root. All receipts retain the restoration source.
"""
import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'docs/review/2026-10-15/takeover/cleanup'
OLD = ROOT / 'docs/review/2026-10-14/cleanup/delete-list.txt'
RUNTIME_TREES = {'characters', 'sprites', 'audio', 'stages', 'generated'}
PROTECTED = (
    '.tmp/golden-dist/', '.tmp/takeover-2026-10-15/',
    '.tmp/dk-live-gallery/platform-fighter/',
    '.tmp/pikachu-live-gallery/platform-fighter/',
)


def digest(file):
    result = hashlib.sha256()
    with file.open('rb') as stream:
        for block in iter(lambda: stream.read(1 << 20), b''):
            result.update(block)
    return result.hexdigest()


def valid_scratch(relative):
    # Only disposable browser build snapshots; never Python/native/art staging.
    if not relative.startswith('.tmp/') or relative.startswith(PROTECTED):
        return False
    name = Path(relative).parts[1]
    return 'gallery' in name or name.startswith('dk-app15-execution-')


def plan():
    rows = []
    retained_hashes = {}
    for relative in OLD.read_text().splitlines():
        if not valid_scratch(relative):
            continue
        original = ROOT / relative
        if not original.is_file() or original.is_symlink():
            continue
        parts = Path(relative).parts
        for index, part in enumerate(parts[2:], 2):
            if part not in RUNTIME_TREES:
                continue
            retained = ROOT / 'assets' / Path(*parts[index:])
            if retained.is_file() and not retained.is_symlink() and retained.stat().st_size == original.stat().st_size:
                retained_key = str(retained.relative_to(ROOT))
                sha = retained_hashes.setdefault(retained_key, None)
                if sha is None:
                    sha = retained_hashes[retained_key] = digest(retained)
                if digest(original) == sha:
                    rows.append({'remove': relative, 'retain': retained_key,
                                 'bytes': original.stat().st_size, 'sha256': sha})
                break
    return {'schemaVersion': 1, 'policy': 'exact duplicate runtime assets in obsolete scratch browser builds only',
            'files': len(rows), 'bytes': sum(row['bytes'] for row in rows), 'entries': rows}


def apply(receipt):
    # Validate the whole plan before the first mutation. Originals remain in assets/.
    for row in receipt['entries']:
        if not valid_scratch(row['remove']) or not row['retain'].startswith('assets/'):
            raise ValueError('Out-of-scope cleanup path')
        remove, retain = ROOT / row['remove'], ROOT / row['retain']
        if remove.is_symlink() or retain.is_symlink() or not remove.resolve().is_relative_to(ROOT / '.tmp') or not retain.resolve().is_relative_to(ROOT / 'assets'):
            raise ValueError('Unsafe cleanup path')
        if digest(remove) != row['sha256'] or digest(retain) != row['sha256']:
            raise ValueError(f"Changed cleanup file: {row['remove']}")
    for row in receipt['entries']:
        (ROOT / row['remove']).unlink()
    (OUT / 'applied.json').write_text(json.dumps({'files': receipt['files'], 'bytes': receipt['bytes'],
                                               'plan': 'duplicate-build-assets.json'}, indent=2) + '\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    file = OUT / 'duplicate-build-assets.json'
    if args.apply:
        receipt = json.loads(file.read_text())
        apply(receipt)
    else:
        receipt = plan()
        file.write_text(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps({'mode': 'apply' if args.apply else 'dry-run',
                      'files': receipt['files'], 'bytes': receipt['bytes'], 'receipt': str(file.relative_to(ROOT))}))
