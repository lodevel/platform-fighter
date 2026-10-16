"""All-drawing body/capsule and facing panels from the actual packed pages."""
from pathlib import Path
import json,math
from PIL import Image,ImageDraw
ROOT=Path(__file__).resolve().parents[1];E=ROOT/'docs/review/2026-10-15/pikachu-final';A=E/'owner-art-staging'
art=json.loads((A/'art-clips.json').read_text());geo=json.loads((E/'owner-geometry.json').read_text())['clips'];rows=[]
for sheet,clip in art.items():
 atlas=Image.open(A/clip['strip']).convert('RGBA');count=clip['frameCount'];w=300;h=230;cols=6
 panel=Image.new('RGB',(cols*w,math.ceil(count/cols)*h),'#23334a')
 for i,(x,y,cw,ch,dx,dy)in enumerate(clip['trims']):
  body=Image.new('RGBA',(clip['frameWidth'],clip['frameHeight']));body.alpha_composite(atlas.crop((x,y,x+cw,y+ch)),(dx,dy))
  overlay=Image.new('RGBA',body.size);d=ImageDraw.Draw(overlay);root=clip['root'];s=clip['scaleToWorld']
  for box in geo[sheet]['hurtboxPoses'][i]['hurtboxes']:
   c=box['capsule'];r=c['radius']/s;points=[(root[0]+c[k]['x']/s,root[1]+c[k]['y']/s)for k in ['start','end']]
   d.line(points,fill=(171,141,255,185),width=3)
   for cx,cy in points:d.ellipse((cx-r,cy-r,cx+r,cy+r),outline=(171,141,255,185),width=3)
  d.line((root[0]-12,root[1],root[0]+12,root[1]),fill='cyan',width=3);d.line((root[0],root[1]-12,root[0],root[1]+12),fill='cyan',width=3)
  body.alpha_composite(overlay);bounds=body.getbbox();bounds=(max(0,bounds[0]-8),max(0,bounds[1]-8),min(body.width,bounds[2]+8),min(body.height,bounds[3]+8))
  image=body.crop(bounds);image.thumbnail((w-12,h-30),Image.Resampling.LANCZOS)
  ox=(i%cols)*w;oy=(i//cols)*h;panel.paste(image,(ox+(w-image.width)//2,oy+25),image)
  ImageDraw.Draw(panel).text((ox+7,oy+5),f'{sheet} raw{clip["nativeSampleIndices"][i]} /cell{i}',fill='white')
 path=A/(sheet+'-all-drawings-capsules.jpg');panel.save(path,quality=90);rows.append({'sheet':sheet,'drawings':count,'path':str(path.relative_to(ROOT))})
(A/'all-drawings-panels.json').write_text(json.dumps({'rows':rows,'scope':'Actual packed body drawings with independently captured native capsule projection;cyan sourceROOT;visual acceptance requires inspection. This does not establish native capsule scale/3D/calculator parity.'},indent=2)+'\n')
print(json.dumps(rows))
