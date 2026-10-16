"""Approved source-bound FX pages retain exact58 RGBA cells, independently staged."""
from pathlib import Path
import json,hashlib,copy
import numpy as np
from PIL import Image
A=Path('docs/review/2026-10-12/link-character/rework/art');S=A/'final-fx-clean-recipes-v1';D=A/'final-fx-exact-cells-staged-v1';D.mkdir(exist_ok=True)
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
index=json.load(open(S/'index.json'));review=S/'coordinator-nine-recipes-58-drawings-review.json';assert review.exists()
pages=[];plans={}
for actor in ['donkeykong','pikachu']:
 proposal=json.load(open(S/(actor+'-fx-proposal.json')));plans[actor]=copy.deepcopy(proposal);plans[actor]['animations']={}
for name,r in index['recipes'].items():
 actor='pikachu'if name.startswith('pikachu')else'donkeykong';folder=D/actor/'animations';folder.mkdir(parents=True,exist_ok=True);sheet='fx__'+name
 page=Image.new('RGBA',(r['frameWidth']*r['drawingCount'],r['frameHeight']))
 for row in r['rows']:
  assert sha(row['cell'])==row['cellSha256'];cell=Image.open(row['cell']).convert('RGBA');page.paste(cell,(row['frameIndex']*cell.width,0))
 p=folder/(sheet+'.png');page.save(p);saved=Image.open(p)
 for row in r['rows']:
  x=row['frameIndex']*r['frameWidth'];assert np.array_equal(np.array(saved.crop((x,0,x+r['frameWidth'],r['frameHeight']))),np.array(Image.open(row['cell']).convert('RGBA')))
 plans[actor]['animations'][sheet]={'strip':'animations/'+sheet+'.png','frameWidth':r['frameWidth'],'frameHeight':r['frameHeight'],'frameCount':r['drawingCount']}
 for profile in plans[actor]['finalFxProfiles']['profiles'].values():
  if profile['sheet']==name:profile['sheet']=sheet
 pages.append({'actor':actor,'sheet':sheet,'path':str(p),'sha256':sha(p),'width':page.width,'height':page.height,'decodedRgbaBytes':page.width*page.height*4,'recipe':r['recipe'],'recipeSha256':r['recipeSha256'],'drawingCount':r['drawingCount'],'allCurrentRgbaCellsExact':True})
for actor,plan in plans.items():(D/actor/'metadata-merge-proposal.json').write_text(json.dumps(plan,indent=2)+'\n')
(D/'index.json').write_text(json.dumps({'state':'SCOPED_APPROVED_NINE_FX_RECIPES58_DRAWINGS102_CUES_EXACT_RGBA_PAGES_STAGED_NOT_INSTALLED','sourceCueFactsSha256':index['sourceCueFactsSha256'],'rootReview':str(review),'rootReviewSha256':sha(review),'pages':pages,'sourceFxPoints':'All851 same-drawing points remain separate until exact approved body support shift applied once. No Finalbody geometry/runtime acceptance from FX.', 'gameChecksRun':False},indent=2)+'\n')
print('pages',len(pages),'drawings',sum(p['drawingCount']for p in pages),'decoded',sum(p['decodedRgbaBytes']for p in pages))
