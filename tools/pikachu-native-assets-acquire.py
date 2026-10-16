"""Acquire two publicly linked reference archives, authenticate and inspect them.

No game installation, model training, credentials or runtime changes. The
archive timestamps do not establish a vanilla patch. Parser dependencies live
in /tmp/pikachu-source-libs. Do not distribute these raw archives as game art.
"""
from pathlib import Path
import base64
import datetime
import hashlib
import importlib.metadata
import json
import struct
import sys
import urllib.request

sys.path.insert(0, '/tmp/pikachu-source-libs')
from Cryptodome.Cipher import AES
import py7zr

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'assets/gen/pikachu-native-reference'
EVIDENCE = ROOT / 'docs/review/2026-10-06/pikachu-character/sources/posed-resources'
FOLDER = 'AAwWzCjT'
SHARE_KEY = 'Zd5kKpuQcE647DSRtpFShw'
REFERENCES = [
    {'kind': 'model', 'handle': 'MQgwyS5R', 'filename': '08 - Pikachu.7z', 'expected_size': 15292447},
    {'kind': 'motion', 'handle': '9dATxIoJ', 'filename': 'Animations - 08 - Pikachu.7z', 'expected_size': 2776164},
]
OUT.mkdir(parents=True, exist_ok=True)
EVIDENCE.mkdir(parents=True, exist_ok=True)

def decode(text):
    return base64.urlsafe_b64decode(text + '=' * (-len(text) % 4))

def sha(data):
    return hashlib.sha256(data).hexdigest()

def api(payload):
    request = urllib.request.Request(f'https://g.api.mega.co.nz/cs?id=4072026&n={FOLDER}',
        data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)

folder_record = EVIDENCE / 'public-folder.json'
if folder_record.exists():
    folder = json.loads(folder_record.read_text())
else:
    folder = api([{'a': 'f', 'c': 1, 'r': 1, 'ca': 1}])
    folder_record.write_text(json.dumps(folder, indent=2) + '\n')
if not isinstance(folder[0], dict) or 'f' not in folder[0]:
    raise RuntimeError(f'Public archive folder unavailable: {folder}')
share = decode(SHARE_KEY)
manifest = {
    'checked_at_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'public_reference_url': f'https://mega.nz/#F!{FOLDER}!{SHARE_KEY}',
    'primary_link_evidence': 'https://github.com/tryptech/io_scene_numdlb/blob/9d02caa072da2cd1322e301de7d5c957be3940db/README.md',
    'provider': 'Public reference folder linked by the model/animation importer author',
    'game_patch': None, 'unmodified_vanilla_verified': False,
    'limits': 'Public archive contents and timestamps are evidence of available resources, not current vanilla numeric parity. No model or motion qualifies runtime collision until independently checked against source frames.',
    'parser_versions': {name: importlib.metadata.version(name) for name in ['py7zr', 'ssbh_data_py', 'pycryptodomex']},
    'archives': []
}
for ref in REFERENCES:
    node = next(x for x in folder[0]['f'] if x['h'] == ref['handle'])
    key = AES.new(share, AES.MODE_ECB).decrypt(decode(node['k'].split(':', 1)[1]))
    words = struct.unpack('>8I', key)
    aes_key = struct.pack('>4I', *[words[i] ^ words[i + 4] for i in range(4)])
    nonce = struct.pack('>2I', words[4], words[5])
    attrs = AES.new(aes_key, AES.MODE_CBC, iv=bytes(16)).decrypt(decode(node['a'])).rstrip(b'\0')
    if not attrs.startswith(b'MEGA') or json.loads(attrs[4:])['n'] != ref['filename']:
        raise RuntimeError('Reference file key/name mismatch')
    encrypted_path = OUT / f"{ref['kind']}.encrypted"
    archive_path = OUT / f"{ref['kind']}.7z"
    if not encrypted_path.exists():
        result = api([{'a': 'g', 'g': 1, 'n': ref['handle']}])
        if not isinstance(result[0], dict) or 'g' not in result[0]:
            raise RuntimeError(f'Archive download unavailable: {result}')
        url = result[0]['g'].replace('http://', 'https://', 1)
        with urllib.request.urlopen(url, timeout=30) as response:
            ciphertext = response.read(ref['expected_size'] + 1)
        if len(ciphertext) != ref['expected_size']:
            raise RuntimeError('Incomplete archive download; not retained')
        encrypted_path.write_bytes(ciphertext)
    ciphertext = encrypted_path.read_bytes()
    if len(ciphertext) != ref['expected_size'] or node['s'] != ref['expected_size']:
        raise RuntimeError('Archive byte count mismatch')
    plain = AES.new(aes_key, AES.MODE_CTR, nonce=nonce, initial_value=0).decrypt(ciphertext)
    # MEGA's authenticated file MAC: increasing128KiB chunks, capped1MiB.
    mac_iv = nonce + nonce
    position = 0
    chunk_number = 1
    file_mac = bytes(16)
    while position < len(plain):
        size = min(chunk_number, 8) * 128 * 1024
        chunk = plain[position:position + size]
        padded = chunk + bytes((-len(chunk)) % 16)
        chunk_mac = AES.new(aes_key, AES.MODE_CBC, iv=mac_iv).encrypt(padded)[-16:]
        file_mac = AES.new(aes_key, AES.MODE_CBC, iv=file_mac).encrypt(chunk_mac)
        position += size
        chunk_number += 1
    mac_words = struct.unpack('>4I', file_mac)
    if (mac_words[0] ^ mac_words[1], mac_words[2] ^ mac_words[3]) != (words[6], words[7]):
        raise RuntimeError('Archive authentication failed; no decrypted file written')
    if not plain.startswith(b'7z\xbc\xaf\x27\x1c'):
        raise RuntimeError('Not a decrypted 7z archive')
    if archive_path.exists() and archive_path.read_bytes() != plain:
        raise RuntimeError('Refusing to overwrite a different preserved archive')
    archive_path.write_bytes(plain)
    with py7zr.SevenZipFile(archive_path, 'r') as archive:
        names = archive.getnames()
        selected = [name for name in names if name.lower().endswith(('.nusktb', '.nuanmb', '.nuhlpb', '.prc'))]
        for name in selected:
            p = Path(name)
            if p.is_absolute() or '..' in p.parts:
                raise RuntimeError('Unsafe reference archive path')
        destination = OUT / f"raw-{ref['kind']}"
        if not destination.exists():
            destination.mkdir()
            archive.extract(path=destination, targets=selected)
    row = {**ref, 'archive_timestamp_utc': datetime.datetime.fromtimestamp(node['ts'], datetime.timezone.utc).isoformat(),
        'archive_sha256': sha(plain), 'encrypted_sha256': sha(ciphertext), 'mega_mac_verified': True,
        'raw_archive': str(archive_path.relative_to(ROOT)), 'all_archive_names': names, 'extracted_names': selected,
        'files': []}
    for name in selected:
        p = destination / name
        if not p.is_file():
            raise RuntimeError(f'Expected extracted resource missing: {name}')
        row['files'].append({'path': str(p.relative_to(ROOT)), 'bytes': p.stat().st_size, 'sha256': sha(p.read_bytes())})
    manifest['archives'].append(row)
    (EVIDENCE / 'acquisition.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps({'archive': ref['kind'], 'mac_verified': True, 'selected_resources': len(selected), 'sha256': row['archive_sha256']}), flush=True)
