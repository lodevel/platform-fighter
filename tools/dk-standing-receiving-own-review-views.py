"""Lightweight cached-only actual source/target/ownership review sheets."""
from pathlib import Path
import json,hashlib
from PIL import Image,ImageDraw
R=Path(__file__).resolve().parents[1];D=R/'.tmp/dk-grab-receiving-preparation';p=D/'remaining-nine-actual-ownership-review-inputs.json';d=json.loads(p.read_text());colors=[(217,70,70),(170,65,170),(240,190,50),(75,150,230),(40,210,200),(30,160,80),(150,100,230),(60,90,200),(245,130,40),(130,185,50),(215,110,175),(100,215,140),(150,155,245),(245,130,150),(230,220,120)]
def pin(p):return {'path':str(p.relative_to(R)),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
def verified(v):
 p=R/v['path'];assert pin(p)==v;return p
result=[]
for row in d['rows']:
 for key in ['source','ownership','overlay','mask','labels']:verified(row[key])
 for key in ['target','quarterTarget','staticReview','sourceGuide']:verified(row['inputs'][key])
 source=json.loads(verified(row['source']).read_text());own=json.loads(verified(row['ownership']).read_text());warp=row['inputs']['floorTransform'];ratio=warp['inclusiveRowsRatio'];target=Image.open(verified(row['inputs']['quarterTarget'])).convert('RGBA');bg=Image.new('RGBA',target.size,(25,30,39,255));bg.alpha_composite(target);prior=bg.copy();dr=ImageDraw.Draw(prior)
 for i,(region,points) in enumerate(source['projectedPointsByRegion'].items()):
  for x,y in points[::max(1,len(points)//100)]:
   py=832+(y-42)*26/5
   if py>=760:py=760+(py-760)*ratio
   px=(512+x*26/5)/4;py/=4;dr.ellipse((px-.7,py-.7,px+.7,py+.7),fill=colors[i])
  pts=own['projectedPointsByRegion'][region]
  if pts:
   mx=sum(v[0] for v in pts)/len(pts);my=sum(v[1] for v in pts)/len(pts);dr.text((128+mx/(5/6.5),208+(my-42)/(5/6.5)),region,fill=(250,250,250),stroke_width=1,stroke_fill=(0,0,0))
 cosmetic=bg.copy();mask=Image.open(verified(row['mask'])).convert('L');t=Image.new('RGBA',target.size,(255,0,255,120));t.putalpha(mask.point(lambda x:120 if x else 0));cosmetic.alpha_composite(t)
 sheet=Image.new('RGB',(1536,286),(25,30,39));draw=ImageDraw.Draw(sheet)
 for col,(im,title) in enumerate([(bg,'actual target'),(prior,'own source cloud/support warp'),(Image.open(verified(row['overlay'])),'actual anatomical tint'),(cosmetic,'cosmetic pendant exclusion')]):sheet.paste(im.convert('RGB'),(col*384,30));draw.text((col*384+6,8),f'{row["clip"]} native{row["nativeSample"]}: {title}',fill=(230,230,230))
 out=D/f'{row["clip"]}-native{row["nativeSample"]}-own-actual-review-sheet.png';assert not out.exists();sheet.save(out);result.append({'clip':row['clip'],'nativeSample':row['nativeSample'],'reviewSheet':pin(out),'ownershipProposal':row['ownership'],'source':row['source']})
r=D/'remaining-nine-actual-review-sheets.json';assert not r.exists();r.write_text(json.dumps({'state':'CACHED_SOURCE_TARGET_OWNERSHIP_VIEWS_PENDING_ACTUAL_REVIEW','rows':result,'sourceInputs':pin(p),'canonicalChanged':False,'sourceOrOwnershipChanged':False,'tool':pin(Path(__file__))},indent=2)+'\n');print(pin(r))
