import json, sys
from PIL import Image
PK='/home/lombet/Workspace/platform-fighter/.tmp/character-packages'
OUT=sys.argv[1]
SET={'donkeykong':['jab/0','jab/3','idle/0','final_attack/3','final_attack/40'],
     'link':['idle/0','jab/2','d02specialhi/1','d02specialhi/5','d04final/30'],
     'pikachu':['idle/0','jab/4',None]}
meta={}
for c,ds in SET.items():
    p=json.load(open(f'{PK}/{c}/character.json'))
    if c=='pikachu':
        ws=p['actions']['final2']['drawings']['windows']; ds[2]=ws[len(ws)//2]['drawing']
    for d in ds:
        dr=p['drawings'][d]; pg=p['pages'][dr['page']]
        im=Image.open(f"{PK}/{c}/{pg['file']}").convert('RGBA')
        x,y,w,h=dr['rect']; crop=im.crop((x,y,x+w,y+h))
        name=f"{c}__{d.replace('/','_')}"
        crop.save(f'{OUT}/{name}.png')
        meta[name]={'character':c,'drawing':d,'size':[w,h],'scale':dr['scale'],'costumes':p.get('costumes')}
json.dump(meta,open(f'{OUT}/meta.json','w'),indent=1)
print(len(meta))
