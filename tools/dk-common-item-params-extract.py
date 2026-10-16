#!/usr/bin/env python3
"""Extract cell-bound source records from the retained original parameter workbook.

Uses the standard library only. Researcher names/descriptions remain separate
from hash/value cells; a matching hash does not establish the runtime consumer.
"""
from pathlib import Path
import hashlib
import json
import re
import xml.etree.ElementTree as ET
import zipfile
import zlib

BASE = Path('docs/review/2026-09-25/donkeykong-character/completion-2026-10-08/mechanics')
WORKBOOK = BASE / 'sources/ultimate-13.0.1-params.xlsx'
EXPECTED_SHA = '90ffc428a0377d43bfbf1a7d1806d18d08edbe735bfef5deb4696e8178f00748'
N = {'x': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
R = {'r': 'http://schemas.openxmlformats.org/package/2006/relationships'}


def numeric(raw):
    try:
        if raw.lower().startswith('0x'):
            return int(raw, 16)
        return float(raw)
    except (ValueError, AttributeError):
        return raw


def hash40(name):
    return (len(name.encode()) << 32) | zlib.crc32(name.encode())


def main():
    sha = hashlib.sha256(WORKBOOK.read_bytes()).hexdigest()
    if sha != EXPECTED_SHA:
        raise ValueError('Workbook source hash changed')
    with zipfile.ZipFile(WORKBOOK) as book:
        shared = [''.join(node.itertext()) for node in ET.fromstring(book.read('xl/sharedStrings.xml')).findall('x:si', N)]
        relationships = {node.attrib['Id']: node.attrib['Target'] for node in
                         ET.fromstring(book.read('xl/_rels/workbook.xml.rels')).findall('r:Relationship', R)}
        sheets = {}
        for sheet in ET.fromstring(book.read('xl/workbook.xml')).findall('x:sheets/x:sheet', N):
            rid = sheet.attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id']
            target = 'xl/' + relationships[rid]
            cells = {}
            for cell in ET.fromstring(book.read(target)).findall('.//x:c', N):
                value = cell.find('x:v', N)
                if value is not None:
                    cells[cell.attrib['r']] = shared[int(value.text)] if cell.attrib.get('t') == 's' else value.text
            sheets[sheet.attrib['name']] = cells

        def record(sheet, hash_cell, value_cell, name_cell, description_cell=None):
            cells = sheets[sheet]
            raw_hash, raw_value, name = cells.get(hash_cell), cells.get(value_cell), cells.get(name_cell)
            return {'sheet': sheet, 'hash_cell': hash_cell, 'raw_hash': raw_hash,
                    'value_cell': value_cell, 'raw_value': raw_value, 'value': numeric(raw_value),
                    'researcher_name_cell': name_cell, 'researcher_name': name,
                    'researcher_description_cell': description_cell,
                    'researcher_description': cells.get(description_cell) if description_cell else None,
                    'name_crc_matches_hash': bool(raw_hash and name and hash40(name) == int(raw_hash, 16))}

        common_rows = [2, 3, 17, 20, 21, 60, 63, 66, 67, 79, 292, 293]
        common = [record('common', f'A{row}', f'B{row}', f'C{row}', f'D{row}') for row in common_rows]
        items = [record('item', f'A{row}', f'B{row}', f'C{row}', f'D{row}') for row in range(2, 18)]
        throws = []
        for row in range(91, 120, 4):
            cells = sheets['item']
            fields = []
            for offset in range(1, 4):
                field_row = row + offset
                column = 'C' if f'C{field_row}' in cells else 'D'
                fields.append(record('item', f'A{field_row}', f'B{field_row}', f'{column}{field_row}'))
            throws.append({'sheet': 'item', 'selector_cell': f'C{row}', 'selector': cells[f'C{row}'],
                           'hash_cell': f'A{row}', 'raw_hash': cells[f'A{row}'], 'fields': fields})
        battle = [record('battle_object', f'A{row}', f'B{row}', f'C{row}', f'D{row}') for row in [23, 24, 25]]
        fighter_sheet = 'fighter_param (13.0.1)'
        cells = sheets[fighter_sheet]
        dk_row = next(int(cell[1:]) for cell, value in cells.items() if cell.startswith('B') and value == 'donkey')
        fighter = []
        for cell, name in cells.items():
            if not re.fullmatch(r'[A-Z]+2', cell) or not re.search(r'^(jump|mini_jump|air_|damage_fly_top_|dive_|ground_brake|walk_|run_|dash_|item_lift|throw_item)', name):
                continue
            column = cell[:-1]
            fighter.append(record(fighter_sheet, column + '1', column + str(dk_row), cell, column + '3'))

        native = json.loads(Path('docs/review/2026-09-22/combat-parity/defense/sources/native-fighter-param.json').read_text())
        dk = next(row for row in native['struct']['list']['struct'] if any(f['@hash'] == 'fighter_kind' and f['#text'] == 'fighter_kind_donkey' for f in row['hash40']))
        primary = {field['@hash']: numeric(field['#text']) for field in dk['float'] + dk['int']}
        for field in fighter:
            field['retained_native_fighter_export_value'] = primary.get(field['researcher_name'])
            field['retained_native_fighter_export_match'] = field['value'] == primary.get(field['researcher_name'])
        authors = []
        for entry in book.namelist():
            if re.fullmatch(r'xl/comments\d+\.xml', entry):
                authors.extend(node.text for node in ET.fromstring(book.read(entry)).findall('x:authors/x:author', N) if node.text)
        attribution = {'source_url': 'https://docs.google.com/spreadsheets/d/1UdH2L0xi8dO6jyPCcO5e5-8j7SGzezxkeZuF1uP8uOw/export?format=xlsx',
                       'source_link_page': 'https://www.ssbwiki.com/Item_throw',
                       'role': 'Public community parameter workbook. Hash/value cells and researcher semantic descriptions are independent evidence.',
                       'version_labels': [name for name in sheets if '13.0.1' in name],
                       'core_properties_present': 'docProps/core.xml' in book.namelist(),
                       'nonempty_comment_authors': sorted(set(authors)),
                       'named_author': None,
                       'attribution_limit': 'XLSX has no core-properties author and empty comment authors. Do not invent a named compiler or treat workbook labels as native consumer code.'}
    result = {'checked_date': '2026-10-09', 'workbook': {'path': str(WORKBOOK), 'sha256': sha},
              'attribution': attribution, 'common': common, 'item': items, 'heavy_throw_data': throws,
              'reaction_thresholds': battle, 'donkey_fighter': fighter,
              'limits': ['Native value does not establish which status reads it; use pinned consumer bodies where retained.',
                         'item_no_air_catch_frame8 is distinct from published seven-step aerial rethrow delay; consumer unresolved.',
                         'Jump height/initial fields are not all initial velocities. Preserve raw values and researcher labels independently.',
                         'Workbook13.0.1 and pinned status revision are retained separately; game-version identity is not established by matching names alone.']}
    output = BASE / 'common-item-workbook-extraction.json'
    output.write_text(json.dumps(result, indent=2) + '\n')
    print(f'Extracted {len(common)} common, {len(items)} item, 8 heavy throw and {len(fighter)} DK records; native DK matches {sum(f["retained_native_fighter_export_match"] for f in fighter)}.')


if __name__ == '__main__':
    main()
