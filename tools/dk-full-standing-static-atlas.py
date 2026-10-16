"""Exact static-only standing art atlas/world draft. Never writes production."""
from pathlib import Path
import argparse,json,hashlib
R=Path(__file__).resolve().parents[1];A=R/'docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/art'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def pin(p):return {'path':str(p.relative_to(R)),'sha256':sha(p)}
def verify(d):
 p=R/d['path'];assert sha(p)==d['sha256'];return p
p=argparse.ArgumentParser();p.add_argument('--manifest',type=Path,required=True);p.add_argument('--cpu-slot-released',action='store_true');args=p.parse_args();assert args.cpu_slot_released
m=json.loads(args.manifest.read_text());rows=m['rows'];assert not m['missingNativeSamples'];assert [r['nativeSample'] for r in rows]==[1,4,7,8,9,10,11,24,33,38]
from PIL import Image,ImageDraw
import numpy as np
atlas=Image.new('RGBA',(3840,256));world=Image.new('RGBA',(2000,400),(25,30,39,255));draw=ImageDraw.Draw(world)
for y in [173,365]:draw.line((0,y,2000,y),fill=(95,113,140))
for i,r in enumerate(rows):
 assert r['staticAccepted'];verify(r['staticReview']);q=Image.open(verify(r['quarterTarget'])).convert('RGBA');assert q.size==(384,256);assert r['root']==[128,208] and abs(r['scaleToWorld']-5/6.5)<1e-12
 a=np.asarray(q)[:,:,3];assert abs((np.where(a>=32)[0].max()+.5-208)*5/6.5)<=.55
 atlas.paste(q,(i*384,0));actual=np.asarray(atlas.crop((i*384,0,(i+1)*384,256)));assert np.array_equal(actual,np.asarray(q))
 im=Image.open(verify(r['target'])).convert('RGBA')
 for face,base in [(1,173),(-1,365)]:
  b=im if face==1 else im.transpose(Image.Transpose.FLIP_LEFT_RIGHT);rx=512 if face==1 else 1024;b=b.resize((295,197),Image.Resampling.LANCZOS);world.alpha_composite(b,(i*200+85-round(rx*5/26),base-round(832*5/26)))
 draw.text((i*200+6,5),f'age{r["gameplayAge"]} native{r["nativeSample"]}',fill=(220,227,239));draw.text((i*200+6,196),f'age{r["gameplayAge"]} mirrored',fill=(220,227,239))
png=A/'full-standing-grab-ten-cell-static-atlas-draft.png';wp=A/'full-standing-grab-ten-cell-bothfaces-world-draft.png';receipt=A/'full-standing-grab-ten-cell-static-atlas-draft.json';assert not any(p.exists() for p in [png,wp,receipt]);atlas.save(png);world.convert('RGB').save(wp)
d={'state':'TEN_STATIC_DRAWINGS_ATLAS_DRAFT_ACTUAL_SEQUENCE_REVIEW_PENDING','manifest':pin(args.manifest.resolve()),'atlas':pin(png),'worldBothFaces':pin(wp),'exactQuarterRGBAAllCells':True,'root':[128,208],'scaleToWorld':5/6.5,'sourceWindows':[r['frameWindow'] for r in rows],'receivingQualified':False,'wholeActionQualified':False,'canonicalChanged':False,'tool':pin(Path(__file__))};receipt.write_text(json.dumps(d,indent=2)+'\n');print(pin(receipt))
