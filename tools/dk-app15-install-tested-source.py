"""Install ONLY the exact 28 reviewed APP15 source leaves after root grant.

Preparation does not execute this installer. Runtime art/metadata staging is
separate and root-owned. All old leaves (including absence) are backed up and
pinned before a second full hash check and any source write. Existing candidate
snapshots and evidence are never modified.
"""
from pathlib import Path
import argparse
import hashlib
import json
import os
import shutil
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
PROPOSAL = 'docs/review/2026-09-25/donkeykong-character/completion-2026-10-08/runtime/checkpoint-15-final-tested-installation-proposal.json'
PROPOSAL_SHA = '0a49df445aad697ab9d111fbe803770f5580ac9e4fb150b9beadfbda2f8bf0d8'
EXPECTED_NATIVES = [1, 4, 7, 8, 9, 10, 11, 24, 33, 38]


def digest(data):
    return hashlib.sha256(data).hexdigest()


def sha(path):
    return digest(path.read_bytes()) if path.exists() else None


def owned_path(raw, prefix=None):
    if not isinstance(raw, str) or not raw or Path(raw).is_absolute() or '..' in Path(raw).parts:
        raise ValueError(f'Unsafe relative path: {raw!r}')
    rel = Path(raw)
    if prefix is not None and rel.parts[0] != prefix:
        raise ValueError(f'Outside {prefix} ownership: {raw}')
    path = ROOT / rel
    if not path.resolve().is_relative_to(ROOT):
        raise ValueError(f'Path escapes repository: {raw}')
    for part in [path, *path.parents]:
        if part == ROOT:
            break
        if part.is_symlink():
            raise ValueError(f'Symlink source/install path refused: {part}')
    return path


def pinned(raw, expected):
    path = owned_path(raw)
    if sha(path) != expected:
        raise ValueError(f'Pin changed: {raw}')
    return path


def review_rows(raw, expected_sha, ordinary=False):
    review = json.loads(pinned(raw, expected_sha).read_text())
    expected_state = 'ORDINARY_PULL_HOLD_BODY_INPUTS_ACCEPTED' if ordinary else 'COMPLETE_STANDING_GRAB_BODY_INPUTS_ACCEPTED'
    if review.get('state') != expected_state:
        raise ValueError('Whole body-input review has not been finally accepted')
    rows = review.get('rows')
    if not isinstance(rows, list) or len(rows) != (2 if ordinary else 10):
        raise ValueError('Complete independently accepted body rows required')
    selectors = [(r.get('clip'), r.get('nativeSample'), r.get('artFrameIndex')) for r in rows]
    expected = [('grab_pull', 1, 0), ('grab_hold', 1, 0)] if ordinary else [
        ('grab', native, i) for i, native in enumerate(EXPECTED_NATIVES)]
    if sorted(selectors) != sorted(expected):
        raise ValueError('Body review has missing/duplicate/wrong exact source/art selectors')
    for row in rows:
        if row.get('staticAccepted') is not True or row.get('receivingAccepted') is not True:
            raise ValueError('Every body row requires explicit static+receiving acceptance')
        for field in ['quarterTarget', 'receivingCandidate', 'staticReview', 'receivingReview']:
            record = row[field]
            pinned(record['path'], record['sha256'])
    return {'path': raw, 'sha256': expected_sha, 'rows': len(rows)}


def atomic_bytes(path, data, mode):
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, raw = tempfile.mkstemp(prefix='.' + path.name + '.app15-', dir=path.parent)
    temporary = Path(raw)
    try:
        with os.fdopen(handle, 'wb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        temporary.chmod(mode)
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root-stage-granted', action='store_true', required=True)
    parser.add_argument('--backup-dir', required=True, help='New repository-relative .tmp path')
    parser.add_argument('--body-review', required=True)
    parser.add_argument('--body-review-sha', required=True)
    parser.add_argument('--ordinary-review', required=True)
    parser.add_argument('--ordinary-review-sha', required=True)
    args = parser.parse_args()
    if not args.root_stage_granted:
        raise ValueError('Root staging grant is required; preparation is not execution')
    proposal = json.loads(pinned(PROPOSAL, PROPOSAL_SHA).read_text())
    candidate_root = owned_path(proposal['candidate'])
    rows = proposal['exact_leaf_installation']
    if len(rows) != 28 or len({r['path'] for r in rows}) != 28:
        raise ValueError('Exact distinct 28-leaf installation required')
    if proposal['exact_affected_leaf_count'] != 28:
        raise ValueError('Unexpected installation scope')
    pinned(str(candidate_root.relative_to(ROOT) / 'installation.diff'), proposal['diff_sha256'])
    pinned(str(candidate_root.relative_to(ROOT) / 'source-pins.json'), proposal['source_pins_sha256'])
    proof = proposal['verified_receipt']
    pinned(proof['path'], proof['sha256'])
    body = review_rows(args.body_review, args.body_review_sha)
    ordinary = review_rows(args.ordinary_review, args.ordinary_review_sha, ordinary=True)
    backup = owned_path(args.backup_dir, '.tmp')
    if backup.parent != ROOT / '.tmp' or backup.exists():
        raise ValueError('Backup path must be a new direct child directory under .tmp')
    leaves = []
    for row in rows:
        target = owned_path(row['path'], 'src')
        source = owned_path(row['candidate_path'])
        if source != candidate_root / row['path']:
            raise ValueError('Source leaf does not belong to final tested candidate')
        if row['observed_current_old_sha256'] != row['old_live_app14_sha256']:
            raise ValueError('Proposal old-hash inconsistency')
        if sha(target) != row['old_live_app14_sha256'] or sha(source) != row['tested_new_sha256']:
            raise ValueError(f'Precondition old/new source drift: {row["path"]}')
        leaves.append({'row': row, 'target': target, 'source': source,
                       'data': source.read_bytes(), 'mode': target.stat().st_mode & 0o777 if target.exists() else 0o644})
    backup.mkdir(parents=True, exist_ok=False)
    manifest = []
    for leaf in leaves:
        row, target = leaf['row'], leaf['target']
        copy = backup / row['path']
        if target.exists():
            copy.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(target, copy)
            if sha(copy) != row['old_live_app14_sha256']:
                raise ValueError('Backup did not preserve old bytes')
        manifest.append({'path': row['path'], 'old_sha256': row['old_live_app14_sha256'],
                         'existed': target.exists(), 'mode': leaf['mode'],
                         'backup_path': str(copy.relative_to(ROOT)) if target.exists() else None,
                         'new_sha256': row['tested_new_sha256']})
    manifest_path = backup / 'old-leaf-backup-manifest.json'
    manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
    shutil.copyfile(ROOT / PROPOSAL, backup / 'installation-proposal.json')
    command = {'installer': {'path': str(Path(__file__).resolve().relative_to(ROOT)), 'sha256': sha(Path(__file__).resolve())}, 'argv': sys.argv, 'proposal': {'path': PROPOSAL, 'sha256': PROPOSAL_SHA}, 'body_review': body,
               'ordinary_review': ordinary, 'backup_manifest_sha256': sha(manifest_path),
               'scope': 'Only 28 listed source leaves; no assets/metadata/data/inventory writes'}
    (backup / 'preinstall-command-receipt.json').write_text(json.dumps(command, indent=2) + '\n')
    # Recheck EVERY source and old destination after the complete pinned backup.
    for leaf in leaves:
        row = leaf['row']
        if sha(leaf['target']) != row['old_live_app14_sha256'] or sha(leaf['source']) != row['tested_new_sha256']:
            raise ValueError(f'Source drift after backup: {row["path"]}; no source writes made')
    installed = []
    try:
        for leaf in leaves:
            row = leaf['row']
            if sha(leaf['target']) != row['old_live_app14_sha256']:
                raise ValueError(f'Concurrent destination write: {row["path"]}')
            atomic_bytes(leaf['target'], leaf['data'], leaf['mode'])
            installed.append(leaf)
        for leaf in leaves:
            if sha(leaf['target']) != leaf['row']['tested_new_sha256']:
                raise ValueError('Installed source hash differs from tested candidate')
    except Exception as error:
        restored, conflicts = [], []
        for leaf in reversed(installed):
            row, target = leaf['row'], leaf['target']
            if sha(target) != row['tested_new_sha256']:
                conflicts.append(row['path'])  # Never overwrite an external concurrent change.
                continue
            if row['old_live_app14_sha256'] is None:
                target.unlink()
            else:
                atomic_bytes(target, (backup / row['path']).read_bytes(), leaf['mode'])
            restored.append(row['path'])
        (backup / 'failed-installation.json').write_text(json.dumps({'error': str(error), 'restored': restored,
            'external_conflicts_not_overwritten': conflicts}, indent=2) + '\n')
        raise
    receipt = {'status': 'EXACT_28_SOURCE_LEAVES_INSTALLED_NOT_RUNTIME_QUALIFIED', **command,
               'installed': [{'path': l['row']['path'], 'sha256': sha(l['target'])} for l in leaves],
               'limits': 'Root asset staging/build/actual Match+Lab remain separate gates. Backup preserves absent/new leaves.'}
    receipt_path = backup / 'installed-source-receipt.json'
    receipt_path.write_text(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps({'receipt': str(receipt_path.relative_to(ROOT)), 'sha256': sha(receipt_path),
                      'backup_manifest_sha256': sha(manifest_path), 'installed_leaves': len(installed)}))


if __name__ == '__main__':
    main()
