#!/usr/bin/env python3
"""Copy an immutable installed artwork snapshot; no game/build execution."""
from pathlib import Path
import hashlib,json,os
ROOT=Path(__file__).resolve().parents[1]
source=ROOT/'assets/characters/link/frames.json'
raw=source.read_bytes();sha=hashlib.sha256(raw).hexdigest();frames=json.loads(raw)
relative=Path('.tmp/link-preview-assets')/sha[:16];dest=ROOT/relative;dest.mkdir(parents=True,exist_ok=True)
profiles=frames['runtimeBodyProfiles'];sheets={p['sheet'] for p in profiles.values()}
for p in profiles.values():
 for d in p['drawings']:
  if d.get('render'):sheets.add(d['render']['sheet'])
animations={};assets=[]
for key in sorted(sheets):
 a=frames['animations'][key];src=source.parent/a['strip'];target=dest/(key+'.png');temp=target.with_suffix('.png.tmp');h=hashlib.sha256();size=0
 with src.open('rb') as incoming,temp.open('wb') as outgoing:
  while chunk:=incoming.read(65536):outgoing.write(chunk);h.update(chunk);size+=len(chunk)
 os.replace(temp,target)
 animations[key]={**a,'url':str(relative/target.name)}
 assets.append({'sheet':key,'path':str(relative/target.name),'sha256':h.hexdigest(),'bytes':size})
preview={'schema':'link-artwork-preview/1','status':'ARTWORK_IN_PROGRESS_NOT_RUNTIME_VERIFIED','framesSha256':sha,'profiles':profiles,'animations':animations,'assets':assets}
tmp=dest/'preview.json.tmp';tmp.write_text(json.dumps(preview,separators=(',',':')));os.replace(tmp,dest/'preview.json')
print(json.dumps({'metadata':str(relative/'preview.json'),'framesSha256':sha,'families':len(profiles),'drawings':sum(len(p['drawings']) for p in profiles.values()),'pages':len(assets)}))
