#!/usr/bin/env python3
"""Create labelled diagnostic crops from actual match screenshots; never modify art."""
import json,sys,hashlib
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw
p=Path(sys.argv[1]);r=json.loads((p/'observations.json').read_text());captures=[(c,x) for c in r['cases'] for x in c['captures']]
for page in range((len(captures)+11)//12):
 out=Image.new('RGB',(1200,660),'#161923');draw=ImageDraw.Draw(out)
 for index,(case,capture) in enumerate(captures[page*12:(page+1)*12]):
  im=Image.open(p/capture['screenshot']).convert('RGB');a=np.asarray(im);mask=(a[:,:,0]>170)&(a[:,:,1]>120)&(a[:,:,2]<120);mask[:150,:]=False;mask[550:,:]=False;ys,xs=np.where(mask)
  if not len(xs):raise RuntimeError('No rendered Pikachu yellow pixels: '+capture['screenshot'])
  cx=int((xs.min()+xs.max())/2);cy=int((ys.min()+ys.max())/2);crop=im.crop((cx-75,cy-45,cx+75,cy+45)).resize((300,180),Image.Resampling.NEAREST)
  x=(index%4)*300;y=(index//4)*220;out.paste(crop,(x,y));o=capture['observation'];label=capture['screenshot'].replace('.png','');draw.text((x+5,y+183),label,fill='white');draw.text((x+5,y+201),f"{o['texture'].split('.')[-1]}#{o['textureFrame']} floor gap {o['alpha']['clearance']:.3f}px",fill='white')
 name=p/f'actual-contact-sheet-{page}.png';out.save(name);print(name)
