"""Contact sheets at match size: today's drawing vs rig fitted to it vs Ultimate frame, per tick."""
import json, sys, numpy as np
from PIL import Image, ImageDraw, ImageFont
sys.path.insert(0,'.')
from metrics import sigdiff, iou
S='/tmp/claude-1000/-home-lombet-Workspace-platform-fighter/a7dfccb5-31fd-4c9e-86a2-6a914ded46da/scratchpad/explore-skeleton'
MATCH=0.4666667*1.4  # screen px per source px at match zoom 1.4 on a 1920 buffer
pkg=json.load(open('/home/lombet/Workspace/platform-fighter/.tmp/character-packages/donkeykong/character.json'))
meta=json.load(open(f'{S}/rig/rig.json')); CW,CH=meta['canvas']; RX,RY=meta['root']
def placed(did):
  d=pkg['drawings'][did]; im=Image.open(f"{S}/dk/{did.replace('/','_')}.png").convert('RGBA')
  c=Image.new('RGBA',(CW,CH)); c.paste(im,(RX-d['anchor'][0],RY-d['anchor'][1])); return c
BG=(38,44,58,255)
def cell(im,mag,crop):
  im=im.crop(crop); w,h=im.size; s=MATCH*mag
  im=im.resize((round(w*s),round(h*s)),Image.LANCZOS)
  bg=Image.new('RGBA',im.size,BG); bg.alpha_composite(im); return bg
def sheet(rows,labels,cols,out,mag,crop=(60,40,440,300)):
  cw=None; tiles=[[cell(r[i],mag,crop) for i in range(len(cols))] for r in rows]
  w,h=tiles[0][0].size; pad=4; lw=110
  S_=Image.new('RGBA',(lw+len(cols)*(w+pad),18+len(rows)*(h+pad)),(250,250,250,255)); d=ImageDraw.Draw(S_)
  for j,c in enumerate(cols): d.text((lw+j*(w+pad)+2,3),c,fill=(0,0,0))
  for i,r in enumerate(tiles):
    d.text((2,18+i*(h+pad)+h//2-12),labels[i],fill=(0,0,0))
    for j,t in enumerate(r): S_.alpha_composite(t,(lw+j*(w+pad),18+i*(h+pad)))
  S_.convert('RGB').save(out)
if __name__=='__main__':
  frames=[f'jab/{i}' for i in range(7)]
  rows=[[placed(f) for f in frames],[Image.open(f"{S}/fit/{f.replace('/','_')}.png") for f in frames]]
  m={f:dict(sigdiff=round(sigdiff(rows[0][i],rows[1][i]),3),iou=round(iou(rows[0][i],rows[1][i]),3),rest_sigdiff=round(sigdiff(rows[0][i],placed('jab/4')),3)) for i,f in enumerate(frames)}
  print(json.dumps(m))
  json.dump(m,open(f'{S}/out/fit_metrics.json','w'),indent=1)
  for mag,suf in ((1,'match'),(2,'x2')):
    sheet([[rows[0][i],rows[1][i]] for i in range(7)],[f"{f}\ndiff {m[f]['sigdiff']}\nIoU {m[f]['iou']}" for f in frames],['today (drawing)','rig from jab/4 parts'],f'{S}/out/fit_today_{suf}.png',mag)
