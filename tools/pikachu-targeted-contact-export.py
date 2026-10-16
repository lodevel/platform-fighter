"""Export guarded native contact anchors for runtime consumers; retain mapping limits."""
from pathlib import Path
import json,sys
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parent))
from pikachu_native_pose import PikachuNativePose,MOTIONS,ROOT,sha
E=ROOT/'docs/review/2026-10-06/pikachu-character/sources';N=json.loads((E/'native-attacks.json').read_text())['motions'];OUT=ROOT/'src/characters'
angles={};sources=[]
for action,motion in [('AttackS3Hi','c01attacks3hi'),('AttackS3Lw','c01attacks3lw')]:
 pose=PikachuNativePose(MOTIONS/(motion+'.nuanmb'));attacks=N['pikachu/'+action]['functions'][0]['attacks'];frames=[]
 for game in [6,7,8]:
  sample=game-1;mats=pose.matrices(sample,['Trans','KneeL','Hip']);trans=mats['Trans'][:3,3];regions=[]
  for a in attacks:
   local=[a[k] for k in ['x','y','z']];end=[a[k+'2'] if a[k+'2'] is not None else a[k] for k in ['x','y','z']];matrix=next(m for name,m in mats.items() if name.lower()==a['bone'])
   def project(coords):
    p=(matrix@np.array([*coords,1]))[:3]-trans;return {'x':float(p[2]*5),'y':float(25-p[1]*5)}
   regions.append({'id':a['id'],'bone':a['bone'],'sourceLocal':local,'sourceEnd':end,'start':project(local),'end':project(end)})
  frames.append({'gameFrame':game,'nativeSample':sample,'regions':regions})
 angles['pikachu/'+action]=frames;sources.append({'action':action,'provenance':pose.provenance(),'scriptSha256':N['pikachu/'+action]['sha256']})
record={'state':'sampled_native_target_projection; source motion mapping and actual contact review pending','sourceFrameMapping':'game6/7/8 -> native5/6/7 by ordinary elapsed=game-1; no motion rate events in captured attack script; independently review angled GIF before declaring parity','projection':{'pixelsPerUnit':5,'rootBelowBodyCentre':25,'removeTrans':True},'sources':sources,'rows':angles}
(E/'posed-resources/angled-forward-tilt-contact-candidates.json').write_text(json.dumps(record,indent=2)+'\n')
text='''/** Guarded native 2D projection for angled forward tilts.\n * 5px/native unit; world body centre is25px above fixed root.\n * Evidence: angled-forward-tilt-contact-candidates.json; projection is authored\n * target geometry, with ordinary game6..8/native5..7 mapping recorded separately. */\nimport { PIKACHU_NATIVE_ATTACKS } from './pikachuAttackData';\nimport type { PikachuPoseProjector } from './pikachuSourceMoves';\nconst SAMPLES = '''+json.dumps(angles,separators=(',',':'))+''' as const;\nexport const pikachuAngledTiltPose: PikachuPoseProjector = (row, gameFrame) => {\n  if (!Number.isInteger(gameFrame)) throw new Error('Invalid Pikachu angled-tilt clock');\n  const action = (Object.keys(SAMPLES) as Array<keyof typeof SAMPLES>).find(action => PIKACHU_NATIVE_ATTACKS[action].some(source => source === row));\n  const sample = action ? SAMPLES[action].find(sample => sample.gameFrame === gameFrame) : undefined;\n  const region = sample?.regions.find(region => region.id === row.id && region.bone === row.bone);\n  const local = [row.x,row.y,row.z]; const end = [row.x2??row.x,row.y2??row.y,row.z2??row.z];\n  if (!region || local.some((value,i)=>value !== region.sourceLocal[i]) || end.some((value,i)=>value !== region.sourceEnd[i]))\n    throw new Error(`Unsupported Pikachu angled-tilt anchor frame${gameFrame} ${row.bone}/${row.id}`);\n  return { start: {...region.start}, end: {...region.end} };\n};\n'''
(OUT/'pikachuAngledTiltPose.ts').write_text(text)
contacts={};specialSources=[]
for kind,motion,bone,local,last in [('quickAttackFirst','d02specialairhi','Neck',[0,0,0],5),('quickAttackSecond','d02specialairhi','Neck',[0,0,0],5),('skullBash','d01specials','Rot',[0,-.7,3],35)]:
 pose=PikachuNativePose(MOTIONS/(motion+'.nuanmb'));points=[]
 for sample in range(last+1):
  matrices=pose.matrices(sample,['Trans',bone]);p=(matrices[bone]@np.array([*local,1]))[:3]-matrices['Trans'][:3,3];point={'x':float(p[2]*5),'y':float(25-p[1]*5)};points.append({'start':point,'end':point.copy()})
 contacts[kind]=points;specialSources.append({'kind':kind,'bone':bone,'local':local,'provenance':pose.provenance()})
jolt=json.loads((E/'posed-resources/thunder-jolt-native-motion.json').read_text());curve=[{'nativeSample':f['nativeSample'],'x':f['bones']['Sphere']['origin'][2],'y':f['bones']['Sphere']['origin'][1]} for f in jolt['frames']]
(OUT/'pikachuSpecialContactData.ts').write_text('''/** Guarded source bone projections; local motion frames are separate from action clocks.\n * All contact offsets use 5px/native unit, fixed-root Trans removed, root25.\n * Jolt curve retains native units and samples, with no object-speed claim. */\nconst CONTACTS = '''+json.dumps(contacts,separators=(',',':'))+''' as const;\nexport type PikachuSpecialContactKind = keyof typeof CONTACTS;\nexport function pikachuSpecialContact(kind: PikachuSpecialContactKind, localMotionFrame: number) {\n  if (!Number.isInteger(localMotionFrame) || localMotionFrame < 0 || localMotionFrame >= CONTACTS[kind].length)\n    throw new Error(`Unqualified Pikachu special contact ${kind}/${localMotionFrame}`);\n  const point = CONTACTS[kind][localMotionFrame]!;\n  return {start:{...point.start},end:{...point.end}};\n}\nexport const PIKACHU_CURVED_JOLT_SOURCE_SHA256 = '''+json.dumps(jolt['animation']['sha256'])+''';\nexport const curvedJoltPoints = '''+json.dumps(curve,separators=(',',':'))+''' as const;\n''')
(E/'posed-resources/special-contact-export.json').write_text(json.dumps({'state':'guarded exported target anchors; runtime/status mapping and contact review separate','sources':specialSources,'projection':record['projection'],'joltCurveSource':jolt['animation'],'outputs':{'src/characters/pikachuAngledTiltPose.ts':sha(OUT/'pikachuAngledTiltPose.ts'),'src/characters/pikachuSpecialContactData.ts':sha(OUT/'pikachuSpecialContactData.ts')}},indent=2)+'\n')
print('Exported angled-tilt and special-contact leaf modules')
