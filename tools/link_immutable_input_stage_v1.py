"""Private CPU artist input memo and verified Linux-to-workspace publication.

Only captured immutable inputs are memoized. Native readers and image algorithms
are unchanged. Output metadata paths/hashes are normalized after byte-verified
copies; original Linux records remain retained and identified in the receipt.
"""
from pathlib import Path
import hashlib
import json
import os
import shutil
import time
from PIL import Image


class ImmutableInputs:
    def __init__(self, paths, expected):
        self.read = Path.read_bytes
        self.resolve = Path.resolve
        self.image_open = Image.open
        self.bytes = {}
        self.resolved = {}
        self.images = {}
        self.rows = []
        self.hits = {'bytes': 0, 'resolve': 0, 'images': 0}
        for path in sorted(set(map(str, paths)) | set(expected)):
            p = Path(path)
            data = self.read(p)
            digest = hashlib.sha256(data).hexdigest()
            if path in expected and digest != expected[path]:
                raise ValueError('Frozen input differs: ' + path)
            key = self.key(p)
            self.bytes[key] = data
            self.resolved[key] = self.resolve(p)
            if p.suffix == '.png':
                with self.image_open(p) as image:
                    self.images[key] = image.copy()
            self.rows.append({'path': path, 'sha256': digest, 'bytes': len(data)})

    @staticmethod
    def key(path):
        return os.path.normpath(os.path.abspath(os.fspath(path))).replace('/mnt/c/Workspace/', '/mnt/c/workspace/')

    def install(self):
        owner = self
        def read(path):
            key = owner.key(path)
            if key in owner.bytes:
                owner.hits['bytes'] += 1
                return owner.bytes[key]
            return owner.read(path)
        def resolve(path, *args, **kwargs):
            key = owner.key(path)
            if key in owner.resolved:
                owner.hits['resolve'] += 1
                return owner.resolved[key]
            return owner.resolve(path, *args, **kwargs)
        def image_open(path, *args, **kwargs):
            if isinstance(path, (str, Path)) and owner.key(path) in owner.images:
                owner.hits['images'] += 1
                return owner.images[owner.key(path)].copy()
            return owner.image_open(path, *args, **kwargs)
        Path.read_bytes = read
        Path.resolve = resolve
        Image.open = image_open

    def verify(self):
        for row in self.rows:
            if hashlib.sha256(self.read(Path(row['path']))).hexdigest() != row['sha256']:
                raise ValueError('Original immutable input changed: ' + row['path'])


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def flushed_write(path, data):
    with open(path, 'wb') as output:
        output.write(data)
        output.flush()
        os.fsync(output.fileno())


def atomic_json(path, data):
    path = Path(path)
    pending = path.with_suffix(path.suffix + '.pending')
    flushed_write(pending, (json.dumps(data, indent=1) + '\n').encode())
    pending.replace(path)


def publish_cell(linux_prefix, workspace_prefix):
    """Pixel/NPZ bytes preserved; output-only JSON paths and dependent SHAs change."""
    linux_prefix, workspace_prefix = Path(linux_prefix), Path(workspace_prefix)
    paths = sorted(linux_prefix.parent.glob(linux_prefix.name + '*'))
    if not paths:
        raise ValueError('No retained Linux cell outputs')
    records = []
    hashes = {}
    for source in paths:
        destination = workspace_prefix.parent / source.name
        data = source.read_bytes()
        flushed_write(destination, data)
        before = hashlib.sha256(data).hexdigest()
        if digest(destination) != before:
            raise ValueError('Linux-to-workspace byte copy differs')
        records.append({'linux': str(source), 'workspace': str(destination), 'linuxSHA': before,
                        'publishedSHA': before, 'metadataPathsNormalized': False})
    # Source JSON precedes cap metadata, which precedes final authoring metadata.
    json_names = [linux_prefix.name + '.json', linux_prefix.name + '-final.json',
                  linux_prefix.name + '-final-authoring.json']
    extra_json = [p.name for p in paths if p.suffix == '.json' and p.name not in json_names]
    for name in json_names + extra_json:
        destination = workspace_prefix.parent / name
        if not destination.exists():
            continue
        source = linux_prefix.parent / name
        original = source.read_bytes()
        value = json.loads(original)
        def normalize(item):
            if isinstance(item, str):
                if item.startswith(str(linux_prefix)):
                    return str(workspace_prefix) + item[len(str(linux_prefix)):]
                return hashes.get(item, item)
            if isinstance(item, list):
                return [normalize(v) for v in item]
            if isinstance(item, dict):
                return {k: normalize(v) for k, v in item.items()}
            return item
        normalized = normalize(value)
        flushed_write(destination, (json.dumps(normalized, indent=2) + '\n').encode())
        hashes[hashlib.sha256(original).hexdigest()] = digest(destination)
        row = next(r for r in records if r['workspace'] == str(destination))
        row['publishedSHA'] = digest(destination)
        row['metadataPathsNormalized'] = True
    # Assert the actual dependency links used by packing and cap authoring.
    source_record = workspace_prefix.with_suffix('.json')
    author = Path(str(workspace_prefix) + '-final-authoring.json')
    cap = Path(str(workspace_prefix) + '-final.json')
    a, c = json.loads(author.read_text()), json.loads(cap.read_text())
    if a['sourceRender'] != str(source_record) or a['sourceRenderSHA'] != digest(source_record):
        raise ValueError('Published authoring source link is inconsistent')
    if c['sourceGuide'] != str(source_record) or c['sourceGuideSha256'] != digest(source_record):
        raise ValueError('Published cap source link is inconsistent')
    for row in records:
        if digest(row['workspace']) != row['publishedSHA']:
            raise ValueError('Published output changed before commit')
    return {'state': 'ALL_BYTES_FLUSHED_AND_VERIFIED_BEFORE_LEDGER_COMMIT',
            'metadataPolicy': 'Exact output prefix replacement and dependent source JSON SHA normalization; pixel/NPZ bytes unchanged.',
            'files': records}
