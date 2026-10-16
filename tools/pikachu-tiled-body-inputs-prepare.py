"""Prepare a four-cell body-art pilot; source input review and tiled review separate."""
from pathlib import Path
import argparse,copy,hashlib,json
from PIL import Image,ImageDraw,ImageFilter
import numpy as np
ROOT=Path(__file__).resolve().parent.parent;E=ROOT/'docs/review/2026-10-06/pikachu-character';B=E/'art';sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
p=argparse.ArgumentParser();p.add_argument('family');p.add_argument('--pilot',action='store_true');p.add_argument('--bounded-contour',action='store_true');p.add_argument('--keys',help='Comma-separated reviewed source keys for representative pilot');p.add_argument('--cell-size',type=int,choices=[512,1024],default=512);args=p.parse_args();source=E/'sources/full-body-native-review'/args.family/'preparation.json';data=json.loads(source.read_text());assert data['state'] in ['generation_inputs_visually_reviewed','native_authoring_inputs_visually_reviewed']
records=data['records'];keys=['full-forward-tilt-up-sample0-source0','full-forward-tilt-up-sample3-source3','full-forward-tilt-up-sample5-source5','full-forward-tilt-down-sample20-source20'] if args.pilot else None
if args.keys: keys=args.keys.split(',')
if keys:records=[next(r for r in records if r['key']==k) for k in keys]
prep=B/'tiled-pilot-preparation.json';existing=json.loads(prep.read_text()) if prep.exists() else {'state':'tiled_inputs_pending_actual_review','coordinate_contract':{'canvas':[1024,1024],'root':None,'world_scale':4*70/600,'cell_canvas':[512,512],'cell_root':[256,416]},'records':[]};template=json.loads((B/'fair-startup-source0-attempt1.workflow.json').read_text())
for start in range(0,len(records),4):
 selected=records[start:start+4];cell=args.cell_size;source_size=Image.open(B/(selected[0]['key']+'-seed.png')).size
 if source_size[0]!=2048 or source_size[1] not in [2048,2560]:raise ValueError('Unsupported source canvas')
 height=round(source_size[1]*cell/2048);key=f'tiled-{args.family}-'+(('pilot' if cell==512 else 'medium-pilot') if args.pilot else f'batch{start//4:03}')+('-bounded' if args.bounded_contour else '')+'-source0'
 if any(r['key']==key for r in existing['records']):raise ValueError('Existing tiled input immutable')
 canvases={'seed':Image.new('RGB',(cell*2,height*2),'#cc498c'),'guide':Image.new('RGB',(cell*2,height*2),'black'),'render-mask':Image.new('RGB',(cell*2,height*2),'black')};cells=[]
 for i,row in enumerate(selected):
  assert row['state']=='inputs_visually_reviewed';offset=[i%2*cell,i//2*height]
  for kind in canvases:
   f=B/f'{row["key"]}-{kind}.png';assert sha(f)==row['hashes'][kind];im=Image.open(f).convert('RGB');assert im.size==source_size;im=im.resize((cell,height),Image.Resampling.LANCZOS if kind=='seed' else Image.Resampling.NEAREST);canvases[kind].paste(im,tuple(offset))
  cells.append({'index':i,'offset':offset,'sourceKey':row['key'],'action':row['action'],'nativeSample':row['native_sample_index'],'sourceReference':row['source_path'],'sourceReferenceSha256':row['source_sha256'],'nativeMetadata':row['native_reference_metadata'],'nativeMetadataSha256':row['native_reference_metadata_sha256']})
 if args.bounded_contour:
  if cell!=1024:raise ValueError('Bounded recipe qualified only1024-square cells')
  locked=Image.new('L',(cell*2,height*2),0)
  for c in cells:
   anatomy=Image.open(B/(c['sourceKey']+'-anatomy-mask.png')).convert('L')
   interior=anatomy.filter(ImageFilter.MinFilter(21)).resize((cell,height),Image.Resampling.NEAREST);locked.paste(interior,tuple(c['offset']))
  pixels=np.asarray(canvases['seed']);features=((pixels[:,:,0]>110)&(pixels[:,:,1]<125)&(pixels[:,:,2]<80))|(np.max(pixels,axis=2)<70)
  identity=Image.fromarray(features.astype('uint8')*255).filter(ImageFilter.MaxFilter(3))
  protect=(np.asarray(locked)>0)|(np.asarray(identity)>0)
  canvases['render-mask']=Image.fromarray(np.where(protect,0,np.asarray(canvases['render-mask'])[:,:,0]).astype('uint8')).convert('RGB')
 for kind,im in canvases.items():im.save(B/f'{key}-{kind}.png')
 graph=copy.deepcopy(template);uploads={}
 for node,remote,kind in [('10','guide','guide'),('13','seed','seed'),('16','mask','render-mask')]:
  name=f'pf-pikachu-{key}-tiled-qualification1-{remote}.png';graph[node]['inputs']['image']=name;uploads[name]=f'{key}-{kind}.png'
 graph['4']['inputs']['text']=('A precise two-by-two sprite grid containing four separate Pikachu body drawings, one in each fixed512pixel square cell, on perfectly uniform magenta background. The colored seed and outline guide define all four distinct poses exactly. Match each pose independently without moving or scaling it. Canonical yellow mouse with two black-tipped ears, short mouse paws, attached zigzag tail with brown base, red cheeks and brown back stripes visible only as in each seed. Clean black outlines, simple flat cel shading consistent with the accepted Pikachu identity. Do not invent visible eyes on the back, duplicate limbs or detached tails. No text, border, dividing lines, shadows, opponents, shields, electrical effects, or collision circles. Preserve every cell silhouette, body scale and registration. Separate poses are: '+', '.join(f'cell{i+1} {r["action"]} sample{r["native_sample_index"]}' for i,r in enumerate(selected))+'.')
 graph['4']['inputs']['text']=graph['4']['inputs']['text'].replace('fixed512pixel square',f'fixed{cell}by{height}pixel rectangular' if height!=cell else f'fixed{cell}pixel square')
 for node,kind in [('9','masked-final'),('20','raw-diagnostic')]:graph[node]['inputs']['filename_prefix']=f'pf-pikachu-20261008-{key}-attempt1-{kind}'
 workflow=f'{key}-attempt1.workflow.json';(B/workflow).write_text(json.dumps(graph,indent=2)+'\n')
 review=Image.new('RGB',(1800,640),'#17253a')
 for side,kind in enumerate(['seed','guide','render-mask']):
  im=canvases[kind].resize((round(600*cell/height),600),Image.Resampling.NEAREST);review.paste(im,(side*600,30));ImageDraw.Draw(review).text((side*600+8,8),key+' / '+kind,fill='white')
 review.save(B/f'{key}-input-review.png')
 existing['records'].append({'key':key,'family':args.family,'cells':cells,'coordinate_contract':{'canvas':[cell*2,height*2],'root':None,'world_scale':70/600*2048/cell,'cell_canvas':[cell,height],'cell_root':[cell/2,1664*cell/2048]},'source_index':0,'hold_game':None,'source_path':str((B/f'{key}-seed.png').relative_to(ROOT)),'source_sha256':sha(B/f'{key}-seed.png'),'workflow':workflow,'upload_mapping':uploads,'hashes':{kind:sha(B/f'{key}-{kind}.png') for kind in canvases},'input_review_sha256':sha(B/f'{key}-input-review.png'),'parent_preparation':str(source.relative_to(ROOT)),'parent_preparation_sha256':sha(source),'state':'prepared; tiled actual input review required','boundedContourProfile':args.bounded_contour,'qualificationReference':'tiled-tilts-medium-pilot-source0-attempt2.review.json' if args.bounded_contour else None,'limits':['New tiled resolution route; pilot acceptance required before any batch expansion',f'Only uniform{cell/2048}input rescale; no fit/crop/recentering','Source native references are not distributed fighter art; actual generator output needed']})
prep.write_text(json.dumps(existing,indent=2)+'\n')
ledger=B/'tiled-generation-ledger.json'
if not ledger.exists():ledger.write_text('[]\n')
print(json.dumps({'preparedTiles':(len(records)+3)//4,'bodyInputs':len(records),'review':'pending actual tiled inspection'}))
