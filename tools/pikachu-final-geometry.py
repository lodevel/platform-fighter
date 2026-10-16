"""Export captured Pika Final capsules and same-sample FX anchors.

TOP is the explicitly selected virtual actor SOURCE ROOT adapter. Native local
packet offsets/radii remain unchanged; this does not recover native TOP/camera
or nonuniform native collision consumers. No rendered-pixel attack inference.
"""
from pathlib import Path
import hashlib,json,sys
sys.path[:0]=[str(Path(__file__).resolve().parent),str(Path(__file__).resolve().parents[1]/'.tmp/pikachu-final-libs')]
import numpy as np
from pikachu_native_pose import PikachuNativePose,MOTIONS,ROOT

E=ROOT/'docs/review/2026-10-15/pikachu-final'
plan=json.loads((E/'owner-art-plan.json').read_text())
source=ROOT/'docs/review/2026-10-06/pikachu-character/sources/native-hurtbox-capsules.json'
caps=json.loads(source.read_text())['capsules']
packets=json.loads((ROOT/'src/finalSmash/selectedPackets.json').read_text())['packets']
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
def scalar(value):
 if isinstance(value,(int,float)):return float(value)
 if isinstance(value,str)and value.startswith('Some(')and value.endswith(')'):return float(value[5:-1])
 raise ValueError('Unresolved native packet scalar: '+str(value))
def attack(packet):
 assert packet['bone']=='Hash40::new("top")'
 first={'x':scalar(packet['z'])*5,'y':-scalar(packet['y'])*5}
 second=first if packet['z2']is None else {'x':scalar(packet['z2'])*5,'y':-scalar(packet['y2'])*5}
 return {'id':packet['id'],'capsule':{'start':first,'end':second,'radius':scalar(packet['radius'])*5}}
def selected(callback,damage):
 rows=[r for r in packets if r['actor']=='pikachu'and r['function']==callback and r['packet']['damage']==damage]
 # Enabled-start-camera branch is the current selected startup contract.
 # A later camera-disabled duplicate is separate source evidence, not selected.
 result={}
 for row in rows:
  packet=dict(row['packet'])
  for override in row['wikiPriorityOverrides']:packet[override['field']]=override['selected']
  result.setdefault(packet['id'],attack(packet))
 return list(result.values())
result={}
for clip in plan['clips']:
 pose=PikachuNativePose(MOTIONS/(clip['motion']+'.nuanmb'))
 assert sha(pose.motion_path)==clip['motionSha256']
 names=list(dict.fromkeys(['Trans','Hip']+[c['bone']['label']for c in caps]))
 receiving=[];points=[]
 for index,sample in enumerate(clip['samples']):
  matrices=pose.matrices(sample,names);trans=matrices['Trans'][:3,3];boxes=[]
  for cap in caps:
   matrix=matrices[cap['bone']['label']]
   radius=float(cap['size']*max(np.linalg.norm(matrix[:3,j])for j in range(3))*5)
   ends=[]
   for key in ['endpoint1','endpoint2']:
    v=(matrix@np.array([*cap[key],1]))[:3]-trans;ends.append({'x':float(v[2]*5),'y':float(-v[1]*5)})
   a,b=ends;minx=min(a['x'],b['x'])-radius;maxx=max(a['x'],b['x'])+radius;miny=min(a['y'],b['y'])-radius;maxy=max(a['y'],b['y'])+radius
   boxes.append({'id':'pikachu.final.'+str(cap['index'])+'.'+cap['bone']['label'],'region':'head'if cap['part']['label']=='collision_part_head'else'torso',
    'offsetX':(minx+maxx)/2,'offsetY':(miny+maxy)/2,'width':maxx-minx,'height':maxy-miny,
    'capsule':{'start':a,'end':b,'radius':radius}})
  receiving.append({'artFrameIndex':index,'nativeSample':sample,'hurtboxes':boxes})
  hip=matrices['Hip'][:3,3]-trans
  points.append({'artFrameIndex':index,'nativeSample':sample,'points':[
   {'bone':'top','point':{'x':0,'y':0},'reviewKey':sha(__file__)+':virtual-top','precision':'authored-virtual-top'},
   {'bone':'hip','point':{'x':float(hip[2]*5),'y':float(-hip[1]*5)},'reviewKey':clip['motionSha256']+':Hip:'+str(sample),'precision':'captured-bone'}]})
 sheet=clip['sheet'];air='_air'in sheet
 if sheet in ['final','final_air']:
  roles={'pika-start':selected('game_finalair'if air else'game_final',.3),'pika-start-transition':selected('game_finalair'if air else'game_final',1)}
 elif sheet=='final_dash':
  roles={'pika-dash':selected('game_finaldash',1),'pika-loop':selected('game_finalattack',1.5),'pika-loop-finish':selected('game_finalattackfinish',1.5)}
 elif sheet in ['final2','final_air2']:
  roles={'pika-finish-pre':selected('game_finalair2'if air else'game_final2',0),'pika-finisher':selected('game_finalair2'if air else'game_final2',20)}
 else:roles={}
 origin=pose.matrices(0,['Trans'])['Trans'][:3,3]
 delta=[]
 for frame in range(clip['nativeEnd']+1):
  v=pose.matrices(frame,['Trans'])['Trans'][:3,3]-origin;delta.append({'x':float(v[2]*5),'y':float(-v[1]*5)})
 result[sheet]={'coordinateOrigin':'actorSourceRoot','sourceSampleBasis':'zero-based-native-index','bodyCentreFromRootY':-25,
  'nativeSampleIndices':clip['samples'],'loopDuration':clip['loopDuration'],'hurtboxPoses':receiving,'sourceEffectPointPoses':points,
  'sourceRootDelta':delta,'attackCollisionPosesByRole':{role:[{'artFrameIndex':index,'nativeSample':sample,'collisionHits':hits}for index,sample in enumerate(clip['samples'])]for role,hits in roles.items()},
  'sourceProvenance':pose.provenance()}
output={'schema':'pikachu-final-source-geometry/1','planSha256':sha(E/'owner-art-plan.json'),'sourceCapsulesSha256':sha(source),'exporterSha256':sha(__file__),
 'precision':'Captured strict native bone transforms, 5worldpx/nativeunit in 2D(Z,-Y); local radius uses maximum world matrix column length as existing Pika source-guided projection adapter. TOP virtual actorSOURCE_ROOT0 is selected authored origin; native TOP callee/3D/collision parity unproven. Owner protection comes from actual Final lease, not these exported normal receiving shapes.',
 'clips':result}
(E/'owner-geometry.json').write_text(json.dumps(output,indent=2)+'\n')
print(json.dumps({'clips':len(result),'drawings':sum(len(r['hurtboxPoses'])for r in result.values()),'allTransDeltasZero':all(p['x']==p['y']==0 for r in result.values()for p in r['sourceRootDelta'])}))
