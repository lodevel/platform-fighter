"""Code-authored transparent Final VFX, source-guided cue names, not native particles.

Nine deterministic recipes service the exact102 selected cues. Geometry,
colour, density and footprint are explicit artist adaptations pending review.
No anatomy, combat circles, hit regions or source gameplay values are authored.
"""
from pathlib import Path
import json, math, hashlib
import numpy as np
from PIL import Image, ImageDraw
A=Path('docs/review/2026-10-12/link-character/rework/art');D=A/'final-fx-clean-recipes-v1';D.mkdir(exist_ok=True)
FACTS=Path('src/finalSmash/finalFxCueFacts.json');facts=json.load(open(FACTS));assert len(facts['cues'])==102
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
N=256;SS=3;C=128
def draw_recipe(name,frame,count):
 t=frame/count;im=Image.new('RGBA',(N*SS,N*SS));dr=ImageDraw.Draw(im)
 cool=name=='donkey_giantpunch';pika=name.startswith('pikachu');warm=(255,210,63)if pika else(255,151,45)
 edge=(69,172,255)if cool else warm;white=(255,255,237);amount=math.sin(math.pi*(frame+.7)/(count+.4)) if not pika or name=='pikachu_final_explosion' else .75+.2*math.sin(2*math.pi*t)
 def path(points,width,color,alpha=255):dr.line([(int(x*SS),int(y*SS))for x,y in points],fill=(*color,int(alpha)),width=max(1,int(width*SS)),joint='curve')
 def poly(points,color,alpha=255):dr.polygon([(int(x*SS),int(y*SS))for x,y in points],fill=(*color,int(alpha)))
 if name in ['donkey_final_rash','donkey_final_arc']:
  # Open directional tapered sweeps: no enclosed ring/ellipse or combat outline.
  for j in range(4 if name=='donkey_final_rash' else 3):
   if name=='donkey_final_rash':
    y=91+j*24+7*math.sin((j+frame)*1.7);x=18+frame*4
    points=[(x,y+7),(65,y+3),(123,y-4),(234-frame*3,y-8),(181,y+3),(95,y+8)]
   else:
    phase=.2+j*.15+t*.13;angles=np.linspace(-1.45+phase,.65+phase,45);r=85+j*8
    points=[(137+r*math.cos(a),141+r*math.sin(a))for a in angles]+[(137+(r-8)*math.cos(a),141+(r-8)*math.sin(a))for a in angles[::-1]]
   poly(points,edge,210*amount);path(points[:len(points)//2],2.3,white,225*amount)
 elif name in ['donkey_final_rashhit','donkey_final_lasthit','donkey_giantpunch','pikachu_final_explosion']:
  rays=10 if name.endswith('lasthit') else 8
  rotation=.1+frame*.17;reach=(55+frame*10)*amount+30
  for j in range(rays):
   a=rotation+j*2*math.pi/rays;u=np.array([math.cos(a),math.sin(a)]);v=np.array([-u[1],u[0]])
   length=reach*(.72+.22*math.sin(j*2.31+1));base=np.array([C,C])+u*(10+frame*5)
   tip=np.array([C,C])+u*length
   points=[base-v*(7*amount),tip,base+v*(7*amount)]
   poly(points,edge,230*amount);path([base,tip-u*8],2.3,white,240*amount)
  star=[]
  for j in range(16):
   a=j*math.pi/8+rotation;r=(30 if j%2==0 else 10)*amount;star.append((C+r*math.cos(a),C+r*math.sin(a)))
  poly(star,white,250*amount)
 else:
  # A filled, irregular glow plus branched electrical filaments. No outline ring.
  yy,xx=np.mgrid[:N*SS,:N*SS]/SS;x=xx-C;y=yy-C
  r=np.sqrt((x/1.0)**2+(y/1.14)**2);angle=np.arctan2(y,x)
  radius=60+8*np.sin(3*angle+t*math.pi*2)+5*np.cos(5*angle-t*math.pi*2)
  alpha=np.clip((1-r/(radius+24)),0,1)**2
  alpha*=70 if name=='pikachu_final_sphere_start' else 31
  glow=np.zeros((N*SS,N*SS,4),np.uint8);glow[:,:,:3]=[255,232,101];glow[:,:,3]=alpha.astype(np.uint8)
  im.alpha_composite(Image.fromarray(glow));dr=ImageDraw.Draw(im)
  branches=7 if name=='pikachu_final_elec' else 5
  for j in range(branches):
   a=j*2*math.pi/branches+t*2*math.pi*.3;u=np.array([math.cos(a),math.sin(a)]);v=np.array([-u[1],u[0]])
   phase=frame*1.31+j*2.7;points=[]
   for k in range(6):
    q=np.array([C,C])+u*(30+k*12)+v*(math.sin(phase+k*2.1)*(7+2*k));points.append(q)
   path(points,5,(58,160,249),190);path(points,2.6,(255,245,147),255);path(points,.9,white,255)
   path([points[3],points[3]+v*13-u*4,points[3]+v*22+u*8],1.3,white,205)
 return im.resize((N,N),Image.Resampling.LANCZOS)

names=sorted({r['source']['effectName']for r in facts['cues']});assert len(names)==9
recipes={};profiles={'donkeykong':{},'pikachu':{}};animations={'donkeykong':{},'pikachu':{}}
for name in names:
 count=9 if name in ['donkey_final_arc','donkey_final_lasthit'] else 4 if name in ['donkey_final_rash','donkey_final_rashhit','donkey_giantpunch','pikachu_final_explosion'] else 8
 folder=D/name;folder.mkdir(exist_ok=True);atlas=Image.new('RGBA',(N*count,N));rows=[]
 panel=Image.new('RGBA',(N*4,(N+20)*math.ceil(count/4)),'#182738');pd=ImageDraw.Draw(panel)
 for i in range(count):
  im=draw_recipe(name,i,count);p=folder/f'{name}-{i}.png';im.save(p);atlas.alpha_composite(im,(i*N,0))
  x=(i%4)*N;y=(i//4)*(N+20);panel.alpha_composite(im,(x,y+20));pd.text((x+4,y+3),name+' art'+str(i),fill='white')
  rows.append({'frameIndex':i,'cell':str(p),'cellSha256':sha(p),'transparentRGBA':True})
 path=folder/(name+'.png');atlas.save(path);review=folder/(name+'-all-current-art.png');panel.save(review)
 recipe={'kind':'AUTHORED_SOURCE_GUIDED_FINAL_EFFECT','effectName':name,'recipeOperator':str(Path(__file__)),
         'recipeOperatorSha256':sha(__file__),'sourceCueFacts':str(FACTS),'sourceCueFactsSha256':sha(FACTS),
         'artScaleToWorld':.3 if name.startswith('pikachu')else .25,'anchorPixel':[C,C],
         'sheet':name,'frameWidth':N,'frameHeight':N,'drawingCount':count,'rows':rows,
         'atlas':str(path),'atlasSha256':sha(path),'review':str(review),'reviewSha256':sha(review),
         'authoredLimits':'Art silhouette/palette/size/filament motion are authored source-guided visual adaptations. No native particle texture/shader/lifetime or3D parenting fidelity. Source script offsets/clocks remain separate selected facts.',
         'visualReview':'PENDING_ACTUAL_ALL_CURRENT_ART','gameChecksRun':False}
 rp=folder/'recipe.json';rp.write_text(json.dumps(recipe,indent=2)+'\n');recipes[name]={**recipe,'recipe':str(rp),'recipeSha256':sha(rp)}
 for cue in [r for r in facts['cues']if r['source']['effectName']==name]:
  actor=cue['fighter'];persistent=cue['clockDomain']=='run-flight';duration=cue['selection']['lifetimeFrames'];loop=persistent or duration>count
  if loop:drawings=[{'startAge':i,'endAgeExclusive':i+1,'frameIndex':i}for i in range(count)];end=count
  else:drawings=[{'startAge':i,'endAgeExclusive':i+1,'frameIndex':i}for i in range(count)];end=count
  profiles[actor][cue['key']]={'cueKey':cue['key'],'sheet':name,'frameWidth':N,'frameHeight':N,
       'scaleToWorld':recipe['artScaleToWorld'],'originX':.5,'originY':.5,'endAgeExclusive':end,
       'loopFrames':count if loop else None,'terminalHold':False,'drawings':drawings,
       'authoredSourceIdentity':{'kind':'AUTHORED_SOURCE_GUIDED_FINAL_EFFECT','recipeId':name,'sha256':sha(rp),'reviewKey':str(review)+':'+sha(review)}}
  animations[actor][name]={'strip':'animations/'+name+'.png','frameWidth':N,'frameHeight':N,'frameCount':count}
for actor in profiles:
 (D/(actor+'-fx-proposal.json')).write_text(json.dumps({'animations':animations[actor],
   'finalFxProfiles':{'schema':'source-guided-final-fx-profiles/1','fighter':actor,'profiles':profiles[actor]}},indent=2)+'\n')
(D/'index.json').write_text(json.dumps({'state':'NINE_PRIVATE_DEDUP_FINAL_FX_RECIPES_ALL102_CUES_MAPPED_REVIEW_PENDING',
 'cueCount':len(facts['cues']),'recipes':recipes,'sourceCueFactsSha256':sha(FACTS),'gameChecksRun':False,
 'sourceGameplayValuesChanged':False,'shippingAssetsChanged':False,'required':'Actualall9artreview plus same-body-drawing sourceROOT top/Hip anchors; Runtime exactclock/carry/layer/ownership integration; finalphasegamechecks'},indent=2)+'\n')
print('9recipes',sum(r['drawingCount']for r in recipes.values()),'drawings',len(facts['cues']),'cues',flush=True)
