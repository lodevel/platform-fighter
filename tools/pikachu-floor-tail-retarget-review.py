"""Bounded native-pose tail adaptation pilot, never a native motion claim.

Rotate only Tail1 and its descendants in the source side-view plane, around the
actual posed Tail1 attachment. Root, core body, bone lengths and sprite scale are
preserved. The renderer still omits helper constraints/material animation and is
only an authoring guide. All proposed images/receiving require actual review.
"""
from pathlib import Path
import sys,importlib.util,json,math
sys.path[:0]=['/tmp/pikachu-source-libs',str(Path(__file__).parent)]
import numpy as np
from PIL import Image,ImageDraw
from pikachu_native_pose import PikachuNativePose,MOTIONS,ROOT,sha
spec=importlib.util.spec_from_file_location('nativeguide',ROOT/'tools/pikachu-native-guide.py');guide=importlib.util.module_from_spec(spec);spec.loader.exec_module(guide)
E=ROOT/'docs/review/2026-10-06/pikachu-character';DEST=E/'sources/floor-tail-retarget-pilot';DEST.mkdir(parents=True,exist_ok=True)
CAPS=json.loads((E/'sources/native-hurtbox-capsules.json').read_text())['capsules']
TAIL={'Tail1','Tail2','Tail3','Tail4'}
CASES=[('back-throw','e01throwb',23,14),('back-throw','e01throwb',26,40),('back-throw','e01throwb',40,43),('tumble','f01damageflyn',9,-74)]
if '--alternate-tail' in sys.argv:
 CASES=[('back-throw','e01throwb',26,-120),('back-throw','e01throwb',40,-120)]
 DEST=DEST/'alternate-tail';DEST.mkdir(parents=True,exist_ok=True)

def transform(world,angle,bone='Tail1'):
 pivot=world[bone][:3,3];a=math.radians(angle);r=np.eye(4);r[:3,:3]=[[1,0,0],[0,math.cos(a),-math.sin(a)],[0,math.sin(a),math.cos(a)]];r[:3,3]=pivot-r[:3,:3]@pivot
 return r,pivot

class AdaptedPose(PikachuNativePose):
 angle=0
 earAngle=0
 def matrices(self,frame,names,bind_pose=False):
  requested=list(dict.fromkeys([*names,'Tail1','EarR1']));world=super().matrices(frame,requested,bind_pose)
  if not bind_pose:
   delta,_=transform(world,self.angle)
   earDelta,_=transform(world,self.earAngle,'EarR1')
   for n in requested:
    if n.lower() in {b.lower() for b in TAIL}:world[n]=delta@world[n]
    if n.lower() in {'earr1','earr2'}:world[n]=earDelta@world[n]
  return {n:world[n] for n in names}

def geometry(motion,frame,angle,earAngle=0):
 p=PikachuNativePose(MOTIONS/(motion+'.nuanmb'));names=list(dict.fromkeys(['Trans','Tail1','EarR1','EarR2',*TAIL]+[c['bone']['label'] for c in CAPS]));world=p.matrices(frame,names);delta,pivot=transform(world,angle);earDelta,earPivot=transform(world,earAngle,'EarR1');trans=world['Trans'][:3,3];project=lambda v:[5*(v[2]-trans[2]),25-5*(v[1]-trans[1])]
 rows=[]
 for c in CAPS:
  bone=c['bone']['label'];matrix=delta@world[bone] if bone.lower() in {b.lower() for b in TAIL} else world[bone]
  rows.append({'index':c['index'],'bone':bone,'start':project((matrix@np.array([*c['endpoint1'],1]))[:3]),'end':project((matrix@np.array([*c['endpoint2'],1]))[:3]),'radiusCandidate':float(c['size']*max(np.linalg.norm(matrix[:3,n]) for n in range(3))*5),'radiusProvenance':'same authored source2D radius convention as ordinary reviewed receiving; not native size consumer proof'})
 return {'source':p.provenance(),'deltaWorldMatrix':delta.tolist(),'earDeltaWorldMatrix':earDelta.tolist(),'earAttachmentNative':earPivot.tolist(),'attachmentNative':pivot.tolist(),'attachmentBodyOffset':project(pivot),'hurtboxCandidates':rows,'unchangedCoreBones':[n for n in names if n.lower() not in {b.lower() for b in TAIL}],'tailDescendants':sorted(TAIL),'capturedTrans':trans.tolist()}

rows=[]
if '--folded-ear' in sys.argv:
 CASES=[('back-throw','e01throwb',23,14),('back-throw','e01throwb',26,-120),('back-throw','e01throwb',40,-120),('tumble','f01damageflyn',9,-74)]
 DEST=E/'sources/floor-tail-retarget-pilot/folded-ear';DEST.mkdir(parents=True,exist_ok=True)
if '--startup-remainder' in sys.argv:
 CASES=[('back-throw','e01throwb',5,10),('back-throw','e01throwb',16,0)]
 DEST=E/'sources/floor-tail-retarget-pilot/startup-remainder';DEST.mkdir(parents=True,exist_ok=True)
if '--canonical-resolution' in sys.argv:
 DEST=DEST/'canonical-resolution';DEST.mkdir(parents=True,exist_ok=True)
for action,motion,frame,angle in CASES:
 earAngle=({23:35,26:15,40:12}.get(frame,0) if '--folded-ear' in sys.argv and action=='back-throw' else 0)
 case={'action':action,'motion':motion,'nativeSample':frame,'authoredTailAngleDegrees':angle,'authoredEarR1AngleDegrees':earAngle,**geometry(motion,frame,angle,earAngle)}
 for variant,degrees in [('native',0),('authored-tail',angle)]:
  stem=DEST/f'{motion}-{frame}-{variant}'
  if not stem.with_suffix('.json').exists():
   W=2048 if '--canonical-resolution' in sys.argv else 512;guide.SIZE=(W,W*5//4);guide.ART_ROOT=(W//2,1664*W//2048);guide.ART_PIXELS_PER_UNIT=5/(70/600*2048/W);guide.ROOT_REGISTRATION='remove-trans-translation';AdaptedPose.angle=degrees;AdaptedPose.earAngle=earAngle if variant=='authored-tail' else 0;guide.PikachuNativePose=AdaptedPose;guide.render(motion,frame,stem)
  im=Image.open(str(stem)+'-reference.png').convert('RGBA');alpha=im.getchannel('A');bounds=alpha.getbbox();case[variant]={'reference':str(Path(str(stem)+'-reference.png').relative_to(ROOT)),'sha256':sha(Path(str(stem)+'-reference.png')),'alphaBounds':bounds,'belowFootRootWorldPx':(bounds[3]-1-(1664 if im.width==2048 else 416))*(70/600*2048/im.width)}
  if im.size!=(512,640):im=im.resize((512,640),Image.Resampling.LANCZOS)
  panels=[]
  for bg in [(244,243,240,255),(30,30,36,255)]:
   panel=Image.new('RGBA',im.size,bg);panel.alpha_composite(im);d=ImageDraw.Draw(panel);d.line((0,416,512,416),fill=(255,70,80,255),width=2);d.text((10,10),f'{action} native{frame} {variant} tail={degrees}deg',(100,100,100,255));d.ellipse((252,412,260,420),outline=(60,170,220,255),width=2)
   if variant=='authored-tail':
    for c in case['hurtboxCandidates']:
     points=[(256+v['start'][0]/(4*70/600),416+(v['start'][1]-25)/(4*70/600)) for v in [c]]+[(256+c['end'][0]/(4*70/600),416+(c['end'][1]-25)/(4*70/600))];d.line(points,fill=(20,200,220,180),width=2)
   panels.append(panel)
  gallery=Image.new('RGBA',(1024,640));gallery.alpha_composite(panels[0]);gallery.alpha_composite(panels[1],(512,0));gallery.save(str(stem)+'-review.png')
 rows.append(case)
result={'state':'bounded_authored_tail_geometry_pilot_pending_actual_review','sourceParity':'Authored target-tail choreography; source animation transforms preserved for all non-tail bones. Not native/production art.','tool':{'path':str(Path(__file__).relative_to(ROOT)),'sha256':sha(Path(__file__))},'root':([1024,1664] if '--canonical-resolution' in sys.argv else [256,416]),'canvas':([2048,2560] if '--canonical-resolution' in sys.argv else [512,640]),'worldScale':(70/600 if '--canonical-resolution' in sys.argv else 4*70/600),'bodyWorldRootOffsetY':25,'floorDiagnostic':'red line at fixedfootroot/nativeY0; actualactorphysics floor margin remains separately measured','rules':['No whole sprite/root translation or scale change','Tail1 subtree rigidly rotates around its actual posed attachment; optional EarR1/R2 folds around posed ear attachment; all internal lengths and shape preserved','Original source files immutable; helper constraints omitted only in meshguide and guarded collision source unchanged'],'cases':rows,'actualReview':None,'runtime':None}
(DEST/'preparation.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'destination':str(DEST),'poses':len(rows),'bounds':[{k:v for k,v in r.items() if k in ['nativeSample','authoredTailAngleDegrees','native','authored-tail']} for r in rows]},indent=2))
