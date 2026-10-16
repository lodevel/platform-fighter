"""Six current target/toon anatomical projection review panels, no acceptance claim."""
from pathlib import Path
import json, hashlib
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
A=Path('docs/review/2026-10-12/link-character/rework/art')
S=A/'final-target-part-six-hair-v2';D=A/'final-target-part-six-hair-review-v2';D.mkdir(exist_ok=True)
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
colors=[(246,124,65),(181,214,96),(243,174,124),(226,156,109),(250,218,170),(117,177,241),(95,149,224),(165,212,251),(158,109,239),(135,86,219),(205,172,255),(230,121,181),(212,91,165),(253,178,224),(253,211,73),(79,231,210)]
source=json.load(open(S/'index.json'));rows=[]
for r in source['rows']:
 actor=r['actor'];index=json.load(open(A/f'final-toon-sharp-pages-review-v1-{actor}/index.json'))
 drawing=next(x for g in index['groups'] if g['motion']==r['motion'] for x in g['rows'] if x['nativeSample']==r['nativeSample'])
 cell=Image.open(drawing['cell']).convert('RGBA');crop=drawing['crop2x'];root=drawing['knownRootAfterExactReductionCrop'];overlay=Image.new('RGBA',cell.size)
 all_masks=[];outside=[]
 for rr in range(1,17):
  raw=Image.open(r['prefix']+f'-physical-region-{rr}.png').convert('L');reduced=raw.resize((raw.width//2,raw.height//2),Image.Resampling.NEAREST)
  body=np.array(reduced)>0;excluded=body.copy();excluded[crop[1]:crop[3],crop[0]:crop[2]]=False
  mask=Image.new('L',cell.size);mask.paste(reduced.crop(crop),(0,0));ma=np.array(mask)>0;all_masks.append(ma)
  rgba=np.zeros((cell.height,cell.width,4),np.uint8);rgba[ma]=[*colors[rr-1],115]
  rim=ma&~(np.array(mask.filter(ImageFilter.MinFilter(3)))>0);rgba[rim]=[*colors[rr-1],235];overlay.alpha_composite(Image.fromarray(rgba))
  outside.append({'region':r['regions'][str(rr)],'outsideVisibleViewportMaskPixels':int(excluded.sum())})
 view=Image.new('RGBA',cell.size,'#182738');view.alpha_composite(cell);view.alpha_composite(overlay)
 dr=ImageDraw.Draw(view);dr.line([(root[0]-9,root[1]),(root[0]+9,root[1])],fill='white');dr.line([(root[0],root[1]-9),(root[0],root[1]+9)],fill='white')
 panel=Image.new('RGBA',(cell.width*2,cell.height+98),'#182738');panel.alpha_composite(cell,(0,26));panel.alpha_composite(view,(cell.width,26))
 pd=ImageDraw.Draw(panel);key=actor+'-'+r['motion']+'-raw'+str(r['nativeSample']);pd.text((5,5),key+' actual toon | self-depth physical parts; white ROOT',fill='white')
 for rr,name in r['regions'].items():
  q=int(rr)-1;x=(q%4)*(panel.width//4)+5;y=cell.height+33+(q//4)*15;pd.text((x,y),str(rr)+' '+name,fill=colors[q])
 path=D/(key+'-toon-anatomy.png');panel.save(path)
 rows.append({'actor':actor,'motion':r['motion'],'nativeSample':r['nativeSample'],'view':str(path),'viewSha256':sha(path),
              'partProjection':r['prefix']+'-part-projection.json','partProjectionSha256':sha(r['prefix']+'-part-projection.json'),
              'packedCell':drawing['cell'],'packedCellSha256':drawing['cellSha256'],'crop2x':crop,'registeredSourceRoot':root,
              'sourceSampleRootAndScaleUnchanged':True,'physicalGuideCropChecks':outside,
              'review':'PENDING_ACTUAL_PART_ANATOMY_REVIEW_NOT_FULL_FINAL_ACCEPTANCE','policy':r['policy'],'helperPolicy':r['helperPolicy']})
 (D/'index.json').write_text(json.dumps({'state':'SIX_PAIRED_CURRENT_TOON_ANATOMY_VIEWS_REVIEW_PENDING','rows':rows,'operatorSha256':sha(__file__),'gameChecksRun':False},indent=2)+'\n')
 print(key,flush=True)
