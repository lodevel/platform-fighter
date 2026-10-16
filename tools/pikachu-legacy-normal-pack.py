"""Pack accepted original ftilt/fair art without cropping or per-pose fitting."""
from pathlib import Path
import re,json,hashlib
from PIL import Image,ImageDraw
ROOT=Path(__file__).resolve().parent.parent;E=ROOT/'docs/review/2026-10-06/pikachu-character';B=E/'art';O=ROOT/'assets/characters/pikachu';sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
for kind,source,prefix,sheet,scope,height in [('ftilt','pikachuForwardTiltPreviewPoses.ts','PIKACHU_TILT','ftilt','motion-eight-pose',2048),('fair','pikachuForwardAirPreviewPoses.ts','PIKACHU_FAIR','fair','fair-motion',2112)]:
 text=(ROOT/'src/previews'/source).read_text();approval=json.loads((E/scope/'art-approval.json').read_text());assert approval['status']=='accepted_for_candidate_build'
 files=dict(re.findall(r"(?:'([^']+)'|([\w-]+)):\s*'([^']+\.png)'",re.search(prefix+r'_PREVIEW_FILES\s*=\s*\{(.*?)\}',text,re.S).group(1))) if False else {}
 for match in re.finditer(r"(?:'([^']+)'|([\w-]+)):\s*'([^']+\.png)'",re.search(prefix+r'_PREVIEW_FILES\s*=\s*\{(.*?)\}',text,re.S).group(1)):files[match.group(1) or match.group(2)]=match.group(3)
 rows=[{'pose':m.group(1),'sourceIndex':int(m.group(2)),'startFrame':int(m.group(3)),'endFrame':int(m.group(4))} for m in re.finditer(r"pose: '([^']+)', sourceIndex: (\d+), startElapsed: (\d+), endElapsed: (\d+)",text)]
 cells=[];sources=[];review=E/scope/'packed-preparation';review.mkdir(parents=True,exist_ok=True)
 for r in rows:
  p=B/files[r['pose']];a=approval['files'][p.name];assert a['status']=='accepted_for_rough_preview' and a['sha256']==sha(p);im=Image.open(p).convert('RGBA');assert im.width==1536 and im.height<=(height-784)
  canvas=Image.new('RGBA',(2048,height));canvas.paste(im,(256,784));cells.append(canvas.resize((512,height//4),Image.Resampling.LANCZOS));sources.append({'file':str(p.relative_to(ROOT)),'sha256':sha(p),'translation':[256,784],'scale':.25,'crop':None})
 strip=Image.new('RGBA',(512*len(cells),height//4))
 for i,im in enumerate(cells):strip.paste(im,(i*512,0))
 target=O/'animations'/(sheet+'.png');strip.save(target);galleries={}
 for start in range(0,len(cells),4):
  group=cells[start:start+4];gal=Image.new('RGB',(1024,(height//4+40)*len(group)),'#17253a');d=ImageDraw.Draw(gal)
  for i,im in enumerate(group):
   d.text((8,i*(height//4+40)+7),f'{sheet} packed frame{start+i} / source{rows[start+i]["sourceIndex"]} / actual pixels',fill='white')
   for side,color in enumerate(['#f7f5ef','#17253a']):
    bg=Image.new('RGBA',im.size,color);bg.alpha_composite(im);gal.paste(bg.convert('RGB'),(side*512,i*(height//4+40)+30))
  p=review/f'{sheet}-cells-{start//4+1}.png';gal.save(p);galleries[str(p.relative_to(ROOT))]=sha(p)
 record={'state':'packed_output_visual_and_runtime_review_required','scope':'Reviewed original rough attack drawings; runtime registration qualification separate','coordinateContract':{'canonicalCanvas':[2048,height],'canonicalRoot':[1024,1664],'frameWidth':512,'frameHeight':height//4,'root':[256,416],'scaleToWorld':4*70/600,'bodyCentreFromRoot':[0,-25]},'approvalSha256':sha(E/scope/'art-approval.json'),'sources':sources,'animations':{sheet:{'strip':'animations/'+sheet+'.png','frameCount':len(cells),'sha256':sha(target),'frameWindows':[dict(r,artFrameIndex=i) for i,r in enumerate(rows)]}},'galleries':galleries}
 (O/'pose-batches'/(kind+'.json')).write_text(json.dumps(record,indent=2)+'\n');print(json.dumps({'sheet':sheet,'frames':len(cells),'cell':[512,height//4],'root':[256,416]}))
