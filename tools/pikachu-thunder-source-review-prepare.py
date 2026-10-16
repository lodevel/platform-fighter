"""Original UFD column plus tracked body zoom, for inspection only.

Review crops never author game-space geometry, motion clocks or sprite roots.
"""
from pathlib import Path
import json,hashlib
from collections import deque
import numpy as np
from PIL import Image,ImageDraw
ROOT=Path(__file__).resolve().parent.parent;E=ROOT/'docs/review/2026-10-06/pikachu-character';O=E/'sources/thunder-full-source-review';O.mkdir(exist_ok=True)
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();rows=[]
def body_review_bounds(mask):
 # A largest warm-colour component distinguishes body/tail from tiny
 # antialiased hitbox numerals. Padding includes adjacent pale/black anatomy;
 # this heuristic is a review viewport only, never a collision measurement.
 seen=set();best=[]
 for y,x in zip(*np.nonzero(mask)):
  point=(int(y),int(x))
  if point in seen:continue
  pending=deque([point]);seen.add(point);group=[]
  while pending:
   y,x=pending.popleft();group.append((y,x))
   for dy in [-1,0,1]:
    for dx in [-1,0,1]:
     p=(y+dy,x+dx)
     if 0<=p[0]<mask.shape[0] and 0<=p[1]<mask.shape[1] and mask[p] and p not in seen:seen.add(p);pending.append(p)
  if len(group)>len(best):best=group
 if not best:raise ValueError('Missing warm-colour review component')
 ys,xs=zip(*best)
 return max(0,min(xs)-80),max(0,min(ys)-80),min(mask.shape[1],max(xs)+81),min(mask.shape[0],max(ys)+81)
for name in ['PikachuThunder','PikachuThunderHit']:
 p=ROOT/f'assets/gen/pikachu-ufd/{name}.gif';im=Image.open(p);r={'source':str(p.relative_to(ROOT)),'sourceSha256':sha(p),'frameCount':im.n_frames,'panels':[],'durationMs':[],'reviewBodyCrops':[]}
 for start in range(0,im.n_frames,9):
  n=min(9,im.n_frames-start);g=Image.new('RGB',(1800,420*((n+2)//3)),'#17253a');d=ImageDraw.Draw(g)
  for j in range(n):
   i=start+j;im.seek(i);r['durationMs'].append(im.info.get('duration'));source=im.convert('RGB');a=np.array(source);m=(a[:,:,0]>130)&(a[:,:,1]>100)&(a[:,:,2]<150);ys,xs=np.nonzero(m)
   if not len(xs):raise ValueError(f'Missing body-color review anchor {name}/{i}')
   bounds=body_review_bounds(m);r['reviewBodyCrops'].append({'sourceIndex':i,'bounds':bounds})
   whole=source.copy();whole.thumbnail((240,360));zoom=source.crop(bounds);magnification=min(3,340/zoom.width,360/zoom.height);zoom=zoom.resize((round(zoom.width*magnification),round(zoom.height*magnification)),Image.Resampling.NEAREST)
   x=j%3*600;y=j//3*420;g.paste(whole,(x+10+(240-whole.width)//2,y+45));g.paste(zoom,(x+260+(340-zoom.width)//2,y+45+(360-zoom.height)//2));d.text((x+8,y+8),f'{name} source index{i} / full column + body zoom',fill='white')
  dest=O/f'{name}-all-source-{start//9+1}.png';g.save(dest);r['panels'].append({'file':str(dest.relative_to(E)),'sha256':sha(dest),'indices':[start,start+n-1]})
 rows.append(r)
(O/'preparation.json').write_text(json.dumps({'state':'all_original_images_pending_manual_review','rows':rows,'limits':'Original GIFs retained unchanged. Right-hand crops track source body-color only for legibility; they never author target root, scale, movement, collision or frame conversion. GIF image indices/durations remain separate from native status clocks. Effects are hidden.'},indent=2)+'\n')
print(json.dumps({'images':sum(r['frameCount'] for r in rows),'panels':sum(len(r['panels']) for r in rows),'review':'manual inspection pending'}))
