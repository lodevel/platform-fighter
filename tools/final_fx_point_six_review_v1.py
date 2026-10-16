"""Actual toon drawing/ROOT/Hip reference panels for six Final pilots."""
from pathlib import Path
import json,hashlib,math
from PIL import Image,ImageDraw
A=Path('docs/review/2026-10-12/link-character/rework/art');S=A/'final-fx-same-drawing-points-v1';D=A/'final-fx-point-six-review-v1';D.mkdir(exist_ok=True)
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
rows=json.load(open(S/'index.json'))['rows'];pilots=json.load(open(A/'final-target-part-six-preparation-v1/index.json'))['rows'];out=[]
indexes={a:json.load(open(A/f'final-toon-sharp-pages-review-v1-{a}/index.json'))for a in ['donkeykong','pikachu']}
for p in pilots:
 r=next(x for x in rows if x['actor']==p['actor']and x['resource']==p['motion']and x['nativeSample']==p['nativeSample'])
 drawing=next(x for g in indexes[p['actor']]['groups']if g['motion']==p['motion']for x in g['rows']if x['nativeSample']==p['nativeSample'])
 cell=Image.open(r['packedCell']).convert('RGBA');root=drawing['knownRootAfterExactReductionCrop'];scale=drawing['scaleToWorld']
 points=[{'bone':q['bone'],'pixel':[root[0]+q['point']['x']/scale,root[1]+q['point']['y']/scale],'precision':q['precision']}for q in r['sourceEffectPointPoses']]
 left=min(0,math.floor(min(q['pixel'][0]for q in points)-12));top=min(0,math.floor(min(q['pixel'][1]for q in points)-12))
 right=max(cell.width,math.ceil(max(q['pixel'][0]for q in points)+13));bottom=max(cell.height,math.ceil(max(q['pixel'][1]for q in points)+13))
 view=Image.new('RGBA',(right-left,bottom-top+34),'#182738');view.alpha_composite(cell,(-left,34-top));dr=ImageDraw.Draw(view)
 key=p['actor']+'-'+p['motion']+'-raw'+str(p['nativeSample']);dr.text((5,5),key+' exact ROOT/Hip age; no facing/support shift',fill='white')
 for q in points:
  x=q['pixel'][0]-left;y=q['pixel'][1]+34-top;color='#ff78ce'if q['bone']=='hip'else'#7eddff'
  dr.line([(x-8,y),(x+8,y)],fill=color,width=2);dr.line([(x,y-8),(x,y+8)],fill=color,width=2);dr.text((x+10,y+2),q['bone']+' '+q['precision'],fill=color)
 path=D/(key+'-points.png');view.save(path);out.append({'actor':r['actor'],'resource':r['resource'],'nativeSample':r['nativeSample'],'view':str(path),'viewSha256':sha(path),
  'pointRecordSource':str(S/'index.json'),'pointRecordSourceSha256':sha(S/'index.json'),'sourceRecordSha256':r['sourceRecordSha256'],'sourceEffectPointPoses':r['sourceEffectPointPoses'],
  'reviewViewportPaddingOnly':[left,top,right,bottom],'visualReview':'PENDING_ACTUAL_PAIRED_ANCHOR_REVIEW','gameChecksRun':False})
(D/'index.json').write_text(json.dumps({'state':'SIX_CURRENT_SOURCE_ROOT_TOP_HIP_ANCHOR_VIEWS_PENDING_REVIEW','rows':out,'operatorSha256':sha(__file__),'gameChecksRun':False},indent=2)+'\n')
