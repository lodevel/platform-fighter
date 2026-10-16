#!/usr/bin/env python3
"""Crop recorded match screenshots for inspection; never modify character art."""
import json,sys
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw
p=Path(sys.argv[1]);r=json.loads((p/'observations.json').read_text());captures=[(c,x) for c in r['cases']+r['landings']+r.get('contacts',[]) for x in c['captures']]
for page in range((len(captures)+11)//12):
 out=Image.new('RGB',(1200,660),'#161923');draw=ImageDraw.Draw(out)
 for index,(case,capture) in enumerate(captures[page*12:(page+1)*12]):
  im=Image.open(p/capture['screenshot']).convert('RGB');a=np.asarray(im);mask=(a[:,:,0]>55)&(a[:,:,1]>45)&(a[:,:,2]<a[:,:,1]*.65)&(a[:,:,0]>a[:,:,1]*.9)&(a[:,:,0]<a[:,:,1]*1.8);mask[595:,:]=False;o=capture['observation'];cam=o['camera'];canvas=o['canvas'];px=(o['spritePosition']['x']-cam['worldView']['x'])*cam['zoom']*im.width/canvas['internalWidth'];py=(o['spritePosition']['y']-cam['worldView']['y'])*cam['zoom']*im.height/canvas['internalHeight'];xx=np.arange(im.width)[None,:];yy=np.arange(im.height)[:,None];mask&=(abs(xx-px)<100)&(abs(yy-py)<100);ys,xs=np.where(mask)
  if not len(xs):raise RuntimeError('No rendered Pikachu yellow pixels: '+capture['screenshot'])
  cx=int((xs.min()+xs.max())/2);cy=int((ys.min()+ys.max())/2);crop=im.crop((cx-75,cy-45,cx+75,cy+45)).resize((300,180),Image.Resampling.NEAREST)
  x=(index%4)*300;y=(index//4)*220;out.paste(crop,(x,y));o=capture['observation'];draw.text((x+5,y+183),capture['screenshot'].replace('.png',''),fill='white');draw.text((x+5,y+201),f"{o['texture'].split('.')[-1]}#{o['textureFrame']} y={o['position']['y']:.1f}",fill='white')
 name=p/f'actual-contact-sheet-{page}.png';out.save(name);print(name)
