"""Static-art-only timed gallery. GIF delays are a display adapter, not gameplay."""
from pathlib import Path
import json,hashlib
from PIL import Image,ImageDraw
R=Path(__file__).resolve().parents[1];A=R/'docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/art';p=A/'full-standing-grab-10-static-targets-art-manifest.json';m=json.loads(p.read_text());assert len(m['rows'])==10 and not m['missingNativeSamples']
def pin(p):return {'path':str(p.relative_to(R)),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
frames=[];delays=[]
for row in m['rows']:
 src=R/row['target']['path'];assert pin(src)==row['target'];im=Image.open(src).convert('RGBA');canvas=Image.new('RGBA',(700,280),(25,30,39,255));draw=ImageDraw.Draw(canvas);draw.line((0,225,700,225),fill=(95,113,140));draw.text((8,8),f'Static art candidate | age {row["gameplayAge"]} / native {row["nativeSample"]} | Match pending',fill=(226,230,239))
 for cx,b,rx in [(190,im,512),(520,im.transpose(Image.Transpose.FLIP_LEFT_RIGHT),1024)]:canvas.alpha_composite(b.resize((295,197),Image.Resampling.LANCZOS),(cx-round(rx*5/26),225-round(832*5/26)))
 frames.append(canvas.convert('RGB'));span=row['frameWindow']['endFrame']-row['gameplayAge'];delays.append(max(10,round(span*1000/60/10)*10))
g=A/'full-standing-grab-ten-cell-static-art-only-gallery.gif';receipt=A/'full-standing-grab-ten-cell-static-art-only-gallery.json';assert not g.exists() and not receipt.exists();frames[0].save(g,save_all=True,append_images=frames[1:],duration=delays,loop=0,optimize=False,disposal=2)
r={'state':'STATIC_ART_ONLY_GALLERY_MATCH_PENDING','manifest':pin(p),'gallery':pin(g),'nativeSamples':[r['nativeSample'] for r in m['rows']],'sourceAges':[r['gameplayAge'] for r in m['rows']],'displayDelaysMilliseconds':delays,'displayPolicy':'Selected source windows converted to nearest10ms GIF delays; not a60Hz engine or native interpolation parity proof. Both facing drawings share constant registered physical floor.','canonicalChanged':False,'wholeActionQualified':False,'receivingQualified':False,'tool':pin(Path(__file__))};receipt.write_text(json.dumps(r,indent=2)+'\n');print(pin(receipt))
