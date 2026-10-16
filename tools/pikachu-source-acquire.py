#!/usr/bin/env python3
"""Acquire pinned Pikachu evidence. Network access only with --download."""
import concurrent.futures, hashlib, html, json, re, subprocess, sys, urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/review/2026-10-06/pikachu-character/sources'
ASSETS = ROOT / 'assets/gen/pikachu-ufd'
REV = '59004685238a3f6f93bae905d3a4e079701c40b4'
MOTION_REV = '3f14a9d46b69eb9e7cd622bddde459192848580e'

def write_json(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2) + '\n')

def fetch(pair):
    url, path = pair
    path.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(['curl', '-L', '--fail', '-sS', '--retry', '3', urllib.parse.quote(url, safe=':/?=&%'), '-o', str(path)], check=True)
    return {'url':url, 'path':str(path.relative_to(ROOT)), 'sha256':hashlib.sha256(path.read_bytes()).hexdigest(), 'bytes':path.stat().st_size}

def inventory():
    raw = Path('/tmp/pikachu-ufd.html').read_text()
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / 'ufd-pikachu.html').write_text(raw)
    rows = []
    for part in re.split(r'<div class="movecontainer">', raw)[1:]:
        vals = {}
        for key in ['movename','startup','totalframes','landinglag','notes','basedamage','shieldlag','shieldstun','whichhitbox','advantage','activeframes','endlag']:
            m = re.search(r'<div class="'+key+r'">(.*?)</div>', part, re.S)
            if m: vals[key] = re.sub(r'\s+', ' ', html.unescape(re.sub('<[^>]+>', '', m[1]))).strip()
        vals['motion_urls'] = list(dict.fromkeys('https://ultimateframedata.com/'+html.unescape(x) for x in re.findall(r'data-featherlight="([^"]+)"', part)))
        if vals: rows.append(vals)
    write_json(OUT / 'ufd-moves.json', {'url':'https://ultimateframedata.com/pikachu','checked':'2026-10-06','patch_label':None,'moves':rows})
    urls = list(dict.fromkeys('https://ultimateframedata.com/'+html.unescape(x) for x in re.findall(r'data-featherlight="([^"]+)"',raw)))
    write_json(OUT / 'ufd-motion-links.json', [{'url':u,'local_path':str((ASSETS / u.rsplit('/',1)[1]).relative_to(ROOT))} for u in urls])
    (OUT / 'motion-list.yml').write_bytes(Path('/tmp/pikachu-motion-list.yml').read_bytes())
    (OUT / 'script-object-list.json').write_bytes(Path('/tmp/pikachu-script-list.json').read_bytes())
    (OUT / 'script-main-tree.json').write_bytes(Path('/tmp/pikachu-main-tree.json').read_bytes())
    return urls

if __name__ == '__main__':
    urls = inventory()
    if '--status' in sys.argv:
        tree = json.loads(Path('/tmp/pikachu-status-tree.json').read_text())
        revision = tree['sha']
        prefix = 'ghidra_scripts/lua2cpp_pikachu.nro/pikachu/'
        files = [('https://raw.githubusercontent.com/Coolsonickirby/SSBU-Dumped-Status-Scripts/'+revision+'/'+e['path'], OUT/'status'/e['path'][len(prefix):]) for e in tree['tree'] if e['type']=='blob' and e['path'].startswith(prefix)]
        with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
            records = list(pool.map(fetch, files))
        (OUT/'status-capture-README.md').write_bytes(Path('/tmp/pikachu-status-readme.md').read_bytes())
        write_json(OUT/'status-verified.json', {'checked':'2026-10-06','revision':revision,'files':records})
        print(f'Acquired and hashed {len(records)} primary status captures.'); sys.exit()
    if '--download' not in sys.argv:
        print(f'Wrote UFD inventory and {len(urls)} motion links'); sys.exit()
    objects = json.loads((OUT / 'script-object-list.json').read_text())
    files = []
    for obj in objects:
        tree_path = OUT / (obj['name']+'-tree.json')
        if obj['name'] == 'pikachu':
            tree = json.loads((OUT / 'script-main-tree.json').read_text())
        else:
            fetch((obj['git_url']+'?recursive=1', tree_path))
            tree = json.loads(tree_path.read_text())
        for entry in tree['tree']:
            if entry['type'] == 'blob' and entry['path'].endswith('.txt'):
                url = 'https://raw.githubusercontent.com/WuBoytH/SSBU-Dumped-Scripts/'+REV+'/'+obj['path']+'/'+entry['path']
                files.append((url, OUT / 'scripts' / obj['name'] / entry['path']))
    files += [(u, ASSETS / u.rsplit('/',1)[1]) for u in urls]
    files += [('https://ultimateframedata.com/'+p, OUT / ('ufd-'+p+'.html')) for p in ['stats','smash']]
    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
        records = list(pool.map(fetch,files))
    write_json(OUT / 'verified.json', {'checked':'2026-10-06','script_revision':REV,'motion_revision':MOTION_REV,'files':records})
    print(f'Acquired and hashed {len(records)} files ({len(urls)} GIFs).')
