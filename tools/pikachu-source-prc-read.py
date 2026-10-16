#!/usr/bin/env python3
"""Read captured PRC evidence without rewriting it or installing dependencies.

Format follows ultimate-research/prc-rs c5855b8d0e910b1c3622c3131e6dfe0567d62397
src/disasm.rs. Struct entries remain ordered and duplicate hashes are preserved.
"""
import argparse
import csv
import hashlib
import json
import struct
from pathlib import Path


def read_prc(data, labels):
    def unpack(fmt, pos):
        size = struct.calcsize('<' + fmt)
        if pos < 0 or pos + size > len(data):
            raise ValueError(f'out-of-bounds read at {pos}')
        return struct.unpack_from('<' + fmt, data, pos)

    if data[:8] != b'paracobn':
        raise ValueError('invalid PRC magic')
    hash_size, ref_size = unpack('II', 8)
    if hash_size % 8:
        raise ValueError('invalid hash table size')
    ref_start = 16 + hash_size
    param_start = ref_start + ref_size
    hashes = [unpack('Q', 16 + i * 8)[0] for i in range(hash_size // 8)]
    if unpack('B', param_start)[0] != 12:
        raise ValueError('root is not a struct')
    types = {1: ('Bool', 'B'), 2: ('I8', 'b'), 3: ('U8', 'B'),
             4: ('I16', 'h'), 5: ('U16', 'H'), 6: ('I32', 'i'),
             7: ('U32', 'I'), 8: ('Float', 'f')}

    def hash_record(value):
        return {'hash40': f'0x{value:010x}', 'label': labels.get(value)}

    def node(pos, ancestry=()):
        if pos in ancestry or len(ancestry) > 100:
            raise ValueError('cyclic or excessively deep PRC structure')
        tag = unpack('B', pos)[0]
        result = {'offset': pos, 'type_tag': tag}
        if tag in types:
            name, fmt = types[tag]
            value = unpack(fmt, pos + 1)[0]
            result.update(type=name, value=bool(value) if tag == 1 else value)
            if tag == 8:
                result['float32_bits'] = f'0x{unpack("I", pos + 1)[0]:08x}'
        elif tag == 9:
            result.update(type='Hash', value=hash_record(hashes[unpack('i', pos + 1)[0]]))
        elif tag == 10:
            start = ref_start + unpack('I', pos + 1)[0]
            end = data.index(b'\0', start)
            result.update(type='Str', value=data[start:end].decode('latin1'))
        elif tag == 11:
            size = unpack('I', pos + 1)[0]
            offsets = unpack('I' * size, pos + 5)
            result.update(type='List', value=[node(pos + off, ancestry + (pos,)) for off in offsets])
        elif tag == 12:
            size, ref_pos = unpack('II', pos + 1)
            refs = [unpack('II', ref_start + ref_pos + i * 8) for i in range(size)]
            refs.sort(key=lambda pair: pair[0])
            result.update(type='Struct', value=[dict(hash_record(hashes[index]),
                          value=node(pos + offset, ancestry + (pos,))) for index, offset in refs])
        else:
            raise ValueError(f'unknown type {tag} at {pos}')
        return result

    return node(param_start)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('input', type=Path)
    parser.add_argument('labels', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    labels = {}
    for row in csv.reader(args.labels.read_text().splitlines()):
        if len(row) >= 2 and row[0].startswith('0x'):
            labels[int(row[0], 16)] = row[1]
    data = args.input.read_bytes()
    result = {'sha256_binary': hashlib.sha256(data).hexdigest(),
              'byte_count': len(data), 'game_patch': None,
              'parser_reference': 'ultimate-research/prc-rs@c5855b8d0e910b1c3622c3131e6dfe0567d62397/src/disasm.rs',
              'tree': read_prc(data, labels)}
    args.output.write_text(json.dumps(result, indent=2) + '\n')
    print(f'Parsed {len(result["tree"]["value"])} root fields from {len(data)} bytes; SHA256 {result["sha256_binary"]}')


if __name__ == '__main__':
    main()
