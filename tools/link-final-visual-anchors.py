#!/usr/bin/env python3
"""Retain native hand projections for presentation only (no gameplay rows)."""
import hashlib, json
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
source = ROOT / 'docs/review/2026-10-16/link-final-visuals/sources/native-hand-projections.json'
bundle = json.loads(source.read_text())
result = {'source': str(source.relative_to(ROOT)), 'basis': bundle['basis'], 'clips': {}}
for sheet in ['d04final', 'd04finalair']:
    rows = [{'age': r['nativeFrame'], 'nock': r['nock'], 'bow': r['bow']}
            for r in bundle['records'] if r['sheet'] == sheet]
    assert rows and rows[0]['age'] == 0 and rows[-1]['age'] == 59
    assert all(a['age'] < b['age'] for a, b in zip(rows, rows[1:]))
    result['clips'][sheet] = rows
out = ROOT / 'port/src/match/effects/linkFinalAnchors.json'
out.write_text(json.dumps(result, indent=2) + '\n')
evidence = ROOT / 'docs/review/2026-10-16/link-final-visuals/anchor-source-receipt.json'
evidence.write_text(json.dumps({'source': str(source.relative_to(ROOT)), 'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
    'originalRecords': [r['source'] for r in bundle['records']], 'output': str(out.relative_to(ROOT)),
    'sha256': hashlib.sha256(out.read_bytes()).hexdigest()}, indent=2) + '\n')
