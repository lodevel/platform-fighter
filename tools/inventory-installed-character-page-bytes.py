#!/usr/bin/env python3
"""Static PNG/header/hash accounting, not browser decoding or performance proof."""
import hashlib,json,struct,datetime
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
DEST=ROOT/'docs/review/2026-10-12/link-character/rework/runtime/installed-character-page-bytes.json'
def digest(path):
 h=hashlib.sha256()
 with path.open('rb')as f:
  while chunk:=f.read(65536):h.update(chunk)
 return h.hexdigest()
def account(fighter):
 meta=ROOT/f'assets/characters/{fighter}/frames.json';initial=digest(meta);data=json.loads(meta.read_text());pages=[]
 for sheet,clip in data['animations'].items():
  # Mirrors actual four metadata imports in src/assets/manifest.ts.
  rel=f'animations/{sheet}.png'if fighter=='pikachu'else clip['strip']
  path=meta.parent/rel
  with path.open('rb')as f:header=f.read(33)
  if header[:8]!=b'\x89PNG\r\n\x1a\n' or header[12:16]!=b'IHDR':raise ValueError(f'Not PNG: {path}')
  width,height=struct.unpack('>II',header[16:24])
  pages.append({'key':f'char.{fighter}.{"tilt"if fighter=="pikachu"and sheet=="ftilt"else sheet}',
   'path':str(path.relative_to(ROOT)),'width':width,'height':height,'decodedRgba8Bytes':width*height*4,
   'encodedPngBytes':path.stat().st_size,'pngSha256':digest(path),
   'policy':'LINK_ENCODED_CPU_GPU_BOUNDED'if fighter=='link'else'EAGER_HTMLIMAGE_GPU_BASELINE',
   'observedResidencyBytes':None})
 if digest(meta)!=initial:raise RuntimeError(f'Metadata changed during byte accounting: {fighter}')
 return {'fighter':fighter,'metadataPath':str(meta.relative_to(ROOT)),'metadataSha256':initial,
  'registeredPageCount':len(pages),'uniqueSourcePageCount':len({x['path']for x in pages}),
  'decodedRgba8BytesIfAllRegisteredSourcesResident':sum(x['decodedRgba8Bytes']for x in pages),
  'encodedPngBytes':sum(x['encodedPngBytes']for x in pages),'pages':pages}
rows=[account(x)for x in ['link','donkeykong','pikachu']]
receipt={'schema':'installed-character-page-byte-inventory/1','status':'STATIC_PARTIAL_NOT_MEASURED','updatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
 'manifestSha256':digest(ROOT/'src/assets/manifest.ts'),'characterBanks':rows,
 'totalDecodedRgba8BytesIfAllRegisteredSourcesResident':sum(x['decodedRgba8BytesIfAllRegisteredSourcesResident']for x in rows),
 'totalEncodedPngBytes':sum(x['encodedPngBytes']for x in rows),
 'knownAdditionalUninstalledFinalBodyBytes':{'donkeykong521':514207216,'pikachu330':269336844,'combined':783544060},
 'boundaries':['PNG dimensions and file bytes are exact static inputs; no CPU/GPU RSS/PSS residency or startup/frame latency is measured.',
  'Link encoded transport separately preloads50422936 encoded bytes and manages deferred decode/GPU;489732108 describes all sourcePNG area, not claimed current CPU residency.',
  'Installed DK/Pika58FX drawings/9pages/15204352RGBA bytes are included in their current eager metadata bank totals.',
  'Existing cat/wolf/owl/bear/blaze/puff/aegis/volt/nova/bruno/kirby/palette/item/UI/stage/audio/metadata/encoded transients still need authoritative final installed manifest accounting.',
  'Full future Link/composed/HAND/gear/cargo/conditional/article/Final corpus and Final victims remain unadmitted; no full-game memory completion claimed.'],
 'checksRun':[]}
DEST.write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps({'receipt':str(DEST.relative_to(ROOT)),'pages':sum(x['registeredPageCount']for x in rows),'decodedRgba8':receipt['totalDecodedRgba8BytesIfAllRegisteredSourcesResident'],'pngBytes':receipt['totalEncodedPngBytes']}))
