"""Prepare actual generated DK cells for human visual review, never accepts."""
from PIL import Image,ImageDraw
from pathlib import Path
import json,hashlib,numpy as np
b=Path('docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/art');p=b/'dk-identity-contact-pilot-attempt1-cutout.png';im=Image.open(p).convert('RGBA');rows=[]
for i,key in enumerate(['identity-reference','jab1-native4','jab2-native3','dtilt-native5']):
 x=(i%2)*1536;y=(i//2)*1024;cell=im.crop((x,y,x+1536,y+1024));a=np.asarray(cell);yy,xx=np.where(a[:,:,3]>=32)
 for name,col in [('light',(244,244,240,255)),('dark',(32,39,46,255))]:
  bg=Image.new('RGBA',cell.size,col);bg.alpha_composite(cell);bg.convert('RGB').save(b/f'pilot-output-{key}-{name}.png')
 cell.save(b/f'pilot-output-{key}-cutout.png')
 game=cell.resize((round(1536*5/26),round(1024*5/26)),Image.Resampling.LANCZOS);world=Image.new('RGBA',(640,240),(230,239,247,255));ground=200;rx=170;ry=round(832*5/26);world.alpha_composite(game,(rx-round(512*5/26),ground-ry));world.alpha_composite(game.transpose(Image.Transpose.FLIP_LEFT_RIGHT),(470-round((1536-512)*5/26),ground-ry));d=ImageDraw.Draw(world);d.line((0,ground,640,ground),fill=(20,80,80),width=1);world.convert('RGB').save(b/f'pilot-output-{key}-world-scale-both-facing.png')
 rows.append({'key':key,'cell':i,'alpha32_bounds':[int(xx.min()),int(yy.min()),int(xx.max()),int(yy.max())],'alpha32_floor_clearance_world':float((832-(yy.max()+.5))*5/26),'body_scale':'onefixed5/26worldperpixel; noperposealpha normalization','actual_generated_cutout_sha256':hashlib.sha256((b/f'pilot-output-{key}-cutout.png').read_bytes()).hexdigest(),'review':'pending actualidentity/anatomy/fistcontact/chroma/floor review','source_cell_role':'conditioningonly'if i==0 else'pilotbody'} )
(b/'pilot-output-observations.json').write_text(json.dumps({'actual_output':str(p),'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'rows':rows,'runtime':'not actual Phaser; art-only pixel preview'},indent=2)+'\n');print(json.dumps(rows))
