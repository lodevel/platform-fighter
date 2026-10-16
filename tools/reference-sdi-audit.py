"""Archive primary SDI hook evidence without changing game code."""
import hashlib
import json
from pathlib import Path
from urllib.request import Request, urlopen

root = Path('docs/review/2026-09-22/combat-parity/shared/sources')
root.mkdir(parents=True, exist_ok=True)

def fetch(url):
    return urlopen(Request(url, headers={'User-Agent': 'platform-fighter-reference-audit'}), timeout=30).read()

repo = 'jugeeya/UltimateTrainingModpack'
info = json.loads(fetch(f'https://api.github.com/repos/{repo}'))
tree = json.loads(fetch(f'https://api.github.com/repos/{repo}/git/trees/{info["default_branch"]}?recursive=1'))
paths = [item['path'] for item in tree['tree'] if 'sdi' in item['path'].lower() and item['type'] == 'blob']
records = []
for path in paths:
    url = f'https://raw.githubusercontent.com/{repo}/{tree["sha"]}/{path}'
    data = fetch(url)
    name = 'training-' + path.replace('/', '-')
    (root / name).write_bytes(data)
    records.append({'path': path, 'file': name, 'url': url, 'sha256': hashlib.sha256(data).hexdigest()})
    print(path)
    if path.endswith('.rs'):
        print(data.decode())
(root / 'sdi-provenance.json').write_text(json.dumps({'repo': repo, 'commit': tree['sha'], 'files': records}, indent=2) + '\n')
