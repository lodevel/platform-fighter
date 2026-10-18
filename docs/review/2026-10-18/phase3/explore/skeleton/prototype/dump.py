import json,sys,os
from PIL import Image
pkg=sys.argv[1]; acts=sys.argv[2].split(','); out=sys.argv[3]
root=f'/home/lombet/Workspace/platform-fighter/.tmp/character-packages/{pkg}'
p=json.load(open(root+'/character.json'))
os.makedirs(out,exist_ok=True)
pages={}
for a in acts:
  A=p['actions'][a]
  for w in A['drawings']['windows']:
    did=w['drawing']; d=p['drawings'][did]
    pg=d['page']
    if pg not in pages: pages[pg]=Image.open(os.path.join(root,p['pages'][pg]['file'])).convert('RGBA')
    x,y,ww,hh=d['rect']
    im=pages[pg].crop((x,y,x+ww,y+hh))
    im.save(f"{out}/{did.replace('/','_')}.png")
    print(did, d['anchor'], ww,hh, w['start'],w['end'])
