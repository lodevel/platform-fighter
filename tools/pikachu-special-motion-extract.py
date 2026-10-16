"""Export authenticated Thunder Jolt bone motion and body-special projections."""
from pathlib import Path
import json, sys
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parent))
from pikachu_native_pose import PikachuNativePose, ROOT, BASE, MOTIONS, rotation_matrix, sha
import ssbh_data_py as ssbh
E=ROOT/'docs/review/2026-10-06/pikachu-character/sources/posed-resources'
E.mkdir(parents=True,exist_ok=True)
# Reuse guarded evaluator with article-specific sources and ancestry. Avoid modifying global fighter constants.
article='dengeki';model=BASE/f'raw-model/fighter/pikachu/model/{article}/c00';motion=BASE/f'raw-motion/fighter/pikachu/motion/{article}/c00/main.nuanmb'
p=PikachuNativePose.__new__(PikachuNativePose);p.motion_path=motion;p.skeleton=ssbh.skel_data.read_skel(str(model/'model.nusktb'));p.animation=ssbh.anim_data.read_anim(str(motion));helper=ssbh.hlpb_data.read_hlpb(str(model/'model.nuhlpb'));p.constrained={c.target_bone_name.lower() for c in helper.orient_constraints};p.constrained.update(c.target_bone_name1.lower() for c in helper.aim_constraints);p.bones={b.name.lower():i for i,b in enumerate(p.skeleton.bones)};p.tracks={n.name.lower():n.tracks[0] for g in p.animation.groups if g.group_type.name=='Transform' for n in g.nodes if n.name.lower() in p.bones}
rows=[]
for sample in range(int(p.animation.final_frame_index)+1):
 matrices=p.matrices(sample,[b.name for b in p.skeleton.bones]);rows.append({'nativeSample':sample,'bones':{name:{'origin':m[:3,3].tolist(),'matrix':m.tolist()} for name,m in matrices.items()}})
independent=[np.max(np.abs(p.matrices(0,[b.name],bind_pose=True)[b.name]-np.asarray(p.skeleton.calculate_world_transform(b)).T)) for b in p.skeleton.bones]
assert max(independent)<2e-6
record={'state':'source curve extracted; runtime binding/clock mapping remains separate','article':article,'animation':{'path':str(motion.relative_to(ROOT)),'sha256':sha(motion),'finalFrameIndex':p.animation.final_frame_index},'skeleton':{'path':str((model/'model.nusktb').relative_to(ROOT)),'sha256':sha(model/'model.nusktb')},'helper':{'path':str((model/'model.nuhlpb').relative_to(ROOT)),'sha256':sha(model/'model.nuhlpb'),'constraintCount':len(p.constrained)},'evaluatorSha256':sha(ROOT/'tools/pikachu_native_pose.py'),'units':'Native model x/y/z; no scale, camera or object/status transform','bindPoseMaximumMatrixDifference':float(max(independent)),'frames':rows,'limits':['Static origins Rot=[0,0,13] and Sphere-local=[0,0,-13]; moving Sphere world origin comes from Rot rotation','Final native sample36 does not establish status lifetime or automatic animation loop semantics','Unknown patch/unmodified provenance; projection5px/unit is target adaptation, not source engine world conversion','Need status/article attachment/collision animation consumer evidence before treating Sphere motion as article root kinetics']}
(E/'thunder-jolt-native-motion.json').write_text(json.dumps(record,indent=2)+'\n')
body=[]
for name in ['d01specials','d01specialairsstart','d01specialairsend','d01specialsend','d02specialairhi','d02specialhistart','d02specialairhistart','d02specialhiend','d02specialairhiend']:
 pose=PikachuNativePose(MOTIONS/(name+'.nuanmb'));frames=[]
 for sample in range(int(pose.animation.final_frame_index)+1):
  mats=pose.matrices(sample,['Trans','Rot','Neck']);trans=mats['Trans'][:3,3]
  frames.append({'nativeSample':sample,'bones':{bone:{'matrix':m.tolist(),'fixedRootOrigin':(m[:3,3]-trans).tolist(),'projectedOrigin':{'x':float((m[2,3]-trans[2])*5),'y':float(25-(m[1,3]-trans[1])*5)}} for bone,m in mats.items()},'capturedTrans':trans.tolist()})
 body.append({'motion':name,'provenance':pose.provenance(),'frames':frames})
(E/'special-body-bone-projections.json').write_text(json.dumps({'state':'guarded source projection export; local native indices need status mapping','projection':{'pixelsPerNativeUnit':5,'rootBelowBodyCentre':25,'transRemoved':True},'motions':body},indent=2)+'\n')
print(json.dumps({'joltSamples':len(rows),'specialMotions':len(body),'specialSamples':sum(len(b['frames']) for b in body)}))
