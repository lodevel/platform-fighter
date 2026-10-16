"""Read-only complete jab/jab2/dtilt pairing gate; does not qualify art or actual contacts."""
import argparse
import hashlib
import json
import math
from pathlib import Path


def require(condition, message):
    if not condition:
        raise ValueError(message)


def indexed(rows, kind):
    result = {}
    for row in rows:
        index = row['artFrameIndex']
        require(isinstance(index, int) and index not in result, f'{kind}: repeated or invalid art index')
        result[index] = row
    return result


def capsule_geometry(capsule, kind):
    numbers = [capsule['radius'], *capsule['start'].values(), *capsule['end'].values()]
    require(all(isinstance(v, (int, float)) and math.isfinite(v) for v in numbers), f'{kind}: non-finite capsule')
    require(capsule['radius'] > 0, f'{kind}: non-positive capsule radius')
    require(set(capsule['start']) == set(capsule['end']) == {'x', 'y'}, f'{kind}: unexpected coordinate fields')


def review(metadata_path, proposal_path):
    metadata = json.loads(metadata_path.read_text())
    proposal = json.loads(proposal_path.read_text())
    canonical = proposal['canonicalKey']
    require(canonical in ('jab', 'jab2', 'dtilt'), 'Unknown fullclip canonical key')
    clip = metadata['animations'][canonical]
    expected = proposal['poseRows']
    count = 7 if canonical == 'dtilt' else 8
    require(len(expected) == count, 'Proposal does not contain the separately reviewed source samples')
    for key, value in proposal['registration'].items():
        if key == 'columns':
            continue  # A contiguous horizontal strip is also a valid layout.
        require(clip.get(key) == value, f'jab registration changed: {key}')
    end = expected[-1]['windowEndExclusive']
    require(clip.get('pairedActionTimeline') == {'endFrame': end}, 'Canonical jab has no declared full paired timeline')
    windows = clip.get('frameWindows', [])
    require(len(windows) == len(expected), 'jab drawing window count differs from the source sampling plan')
    hurts = indexed(clip.get('hurtboxPoses', []), 'receiving')
    attacks = indexed(clip.get('attackCollisionPoses', []), 'attack')
    require(set(hurts) == set(attacks) == set(range(count)), 'jab cells lack exactly one receiving/attack pair')
    diagnostics = []
    for window, row in zip(windows, expected):
        index = row['artFrameIndex']
        require(window == {'startFrame': row['windowStart'], 'endFrame': row['windowEndExclusive'], 'artFrameIndex': index}, f'jab drawing window {index} differs from the captured source sampling plan')
        receiving, attack = hurts[index], attacks[index]
        require(receiving['nativeSample'] == attack['nativeSample'] == row['nativeSample'], f'jab cell {index} has a mismatched native pose clock')
        source_path = Path(row['attackSourcePacket'])
        require(hashlib.sha256(source_path.read_bytes()).hexdigest() == row['attackSourcePacketSha256'], f'jab source packet hash changed in cell {index}')
        source = json.loads(source_path.read_text())
        if 'collisionHits' in source:
            source_hits = source['collisionHits']
            require(source['nativeSample'] == row['nativeSample'], f'jab source sample differs in cell {index}')
        else:
            # The reused, qualified contact packet has the shipping pose
            # wrapper; new source-only exports use a direct collision list.
            source_poses = source.get('attackCollisionPoses', [])
            require(len(source_poses) == 1 and source_poses[0]['nativeSample'] == row['nativeSample'], f'jab source packet has no unique selected sample in cell {index}')
            source_hits = source_poses[0]['collisionHits']
        source_ids = sorted(hit['id'] for hit in source_hits)
        require(source_ids == row['sourceCollisionIDs'], f'jab source IDs differ at native sample {row["nativeSample"]}')
        hits = attack['collisionHits']
        require(sorted(hit['id'] for hit in hits) == source_ids, f'jab cell {index} changes the active source collision IDs')
        for hit in hits:
            require(set(hit) == {'id', 'capsule'}, f'jab metadata cell {index} overrides a source attack scalar or flag')
            capsule_geometry(hit['capsule'], f'jab attack {index}/{hit["id"]}')
            source_hit = next(item for item in source_hits if item['id'] == hit['id'])
            require(hit['capsule'] == source_hit['capsule'], f'jab cell {index} changes its independently reviewed/projected attack capsule')
        boxes = receiving['hurtboxes']
        candidate_path = Path(row['receivingCandidate'])
        require(hashlib.sha256(candidate_path.read_bytes()).hexdigest() == row['receivingCandidateSha256'], f'jab receiving candidate hash changed in cell {index}')
        candidate = json.loads(candidate_path.read_text())
        selected = [pose for pose in candidate['hurtboxPoses'] if pose['nativeSample'] == row['nativeSample']]
        require(len(selected) == 1 and boxes == selected[0]['hurtboxes'], f'jab cell {index} changes the separately reviewed target receiving')
        require(bool(boxes), f'jab cell {index} has no authored receiving')
        require(len({box['id'] for box in boxes}) == len(boxes), f'jab cell {index} has repeated receiving IDs')
        for box in boxes:
            require(bool(box.get('region')), f'jab cell {index} has unnamed anatomy')
            capsule_geometry(box['capsule'], f'jab receiving {index}/{box["id"]}')
            cap = box['capsule']
            require(max(cap['start']['y'], cap['end']['y']) + cap['radius'] <= 42.55001, f'jab cell {index} exceeds the authored grounded receiving floor band')
        diagnostics.append({'artFrameIndex': index, 'nativeSample': row['nativeSample'], 'window': [window['startFrame'], window['endFrame']], 'receivingPrimitives': len(boxes), 'sourceCollisionIDs': source_ids, 'attackSourcePacketSha256': hashlib.sha256(source_path.read_bytes()).hexdigest()})
    return {'state': 'paired_metadata_checked_only', 'canonicalKey':canonical, 'metadataSha256': hashlib.sha256(metadata_path.read_bytes()).hexdigest(), 'proposalSha256': hashlib.sha256(proposal_path.read_bytes()).hexdigest(), 'cells': diagnostics, 'artAcceptance': False, 'actualMatchAcceptance': False, 'nativeHurtDataParity': False}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--metadata', type=Path, default=Path('assets/characters/donkeykong/frames.json'))
    parser.add_argument('--proposal', type=Path, default=Path('docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/runtime/full-jab-integration-proposal.json'))
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    result = review(args.metadata, args.proposal)
    text = json.dumps(result, indent=2) + '\n'
    if args.output:
        args.output.write_text(text)
    print(text)
