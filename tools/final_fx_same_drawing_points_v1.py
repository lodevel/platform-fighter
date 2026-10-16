"""Same-drawing actor SOURCE ROOT registrations for selected Final VFX.

Hip uses actual guarded captured hierarchy. Top is an explicitly authored
virtual actor ROOT, never a claimed native Top matrix or particle parent.
No root support calibration, mirroring or posture rotation is baked here.
"""
from pathlib import Path
import sys,json,hashlib
sys.path[:0]=['/tmp/pikachu-source-libs','tools']
import numpy as np
from dk_native_pose import DonkeyKongNativePose
from pikachu_native_pose import PikachuNativePose
A=Path('docs/review/2026-10-12/link-character/rework/art');D=A/'final-fx-same-drawing-points-v1';D.mkdir(exist_ok=True)
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
FACTS=Path('src/finalSmash/finalFxCueFacts.json');input_hashes={str(FACTS):sha(FACTS),__file__:sha(__file__)}
for p in ['tools/dk_native_pose.py','tools/pikachu_native_pose.py']:input_hashes[p]=sha(p)
rows=[];poses={};source_indexes={}
for actor,cls in [('donkeykong',DonkeyKongNativePose),('pikachu',PikachuNativePose)]:
 index=A/f'final-toon-sharp-pages-review-v1-{actor}/index.json';p=json.load(open(index));source_indexes[actor]={'path':str(index),'sha256':sha(index)}
 for group in p['groups']:
  for r in group['rows']:
   assert sha(r['sourceRecord'])==r['sourceRecordSha256']
   m=json.load(open(r['sourceRecord']));source=Path(m['motion']['path']);assert sha(source)==m['motion']['sha256'];sample=r['nativeSample']
   assert sample==m['native_sample_index'], 'WRONG_BODY_DRAWING_NATIVE_SAMPLE'
   key=(actor,str(source))
   if key not in poses:poses[key]=cls(Path('/mnt/c/workspace/platform-fighter')/source)
   # Keep helper constraint and scale-compensation rejection enabled.
   matrices=poses[key].matrices(sample,['Trans','Hip']);trans=matrices['Trans'][:3,3]
   assert np.array_equal(trans,np.asarray(m['captured_trans_translation']))
   delta=0.
   if actor=='donkeykong':
    delta=float(np.max(np.abs(matrices['Hip']-np.asarray(m['bone_matrices']['Hip']))))
    assert delta==0., ('HIP_MATRIX_DIFFERS_FROM_ACTUAL_BODY_DRAWING',sample,delta)
   hip=matrices['Hip'][:3,3]-trans;point={'x':float(hip[2]*5),'y':float(-hip[1]*5)}
   review_key=r['sourceRecordSha256']+':'+str(sample)+':'+sha(__file__)
   points=[{'bone':'top','point':{'x':0.,'y':0.},'reviewKey':review_key+':virtual-source-root','precision':'authored-virtual-top'},
           {'bone':'hip','point':point,'reviewKey':review_key+':captured-hip','precision':'captured-bone'}]
   row={'actor':actor,'resource':group['motion'],'runtimeSheet':group['runtimeSheet'],'nativeSample':sample,
        'logicalArtFrameIndex':r['logicalArtFrameIndex'],'sourceRecord':r['sourceRecord'],'sourceRecordSha256':r['sourceRecordSha256'],
        'sourceMotion':m['motion'],'packedCell':r['cell'],'packedCellSha256':r['cellSha256'],
        'sourceEffectPointPoses':points,'coordinateOrigin':'actorSourceRoot','uniformSupportRetargetWorldY':0.,
        'capturedHipSourceMatrix':matrices['Hip'].tolist(),'capturedTransSourceMatrix':matrices['Trans'].tolist(),
        'hipMatrixDeltaFromStoredBodySnapshot':delta if actor=='donkeykong'else None,
        'actualPoseInput':poses[key].provenance(),'helperGuardsNeverDisabled':True,
        'pointPolicy':'Exact same native sample actual Hip centre minus actual Trans, projected(5Z,-5Y). Top virtualactorROOT explicitlyauthored(0,0). No nativeTop/3D FXparent/shader parity. If later bodyfit selects a uniform supportshift, addthatshift exactlyonce to bothpoints; currentwholeFinalbank has no accepted supportcalibration.',
        'visualRegistration':'PENDING_PAIRED_ANCHOR_REVIEW','gameChecksRun':False}
   rows.append(row)
  print(actor,group['motion'],len(group['rows']),flush=True)
 for path in input_hashes:assert sha(path)==input_hashes[path]
 (D/'progress.json').write_text(json.dumps({'state':'SAME_DRAWING_SOURCE_ROOT_FX_POINT_RECORDS_ANCHOR_REVIEW_PENDING','rows':rows,'inputHashes':input_hashes,'sourceIndexes':source_indexes,'gameChecksRun':False},indent=2)+'\n')
assert len(rows)==851
(D/'index.json').write_text(json.dumps({'state':'ALL851_SAME_DRAWING_SOURCE_ROOT_TOP_HIP_POINTS_ANCHOR_REVIEW_PENDING','drawingCount':851,'rows':rows,'inputHashes':input_hashes,'sourceIndexes':source_indexes,
 'sourceCueFactsSha256':sha(FACTS),'allHelperGuardsRetained':True,'topIsAuthoredVirtualSourceRoot':True,'pending':'Actualpairedanchorinspection and consumedbodyuniformsupportshift reconciliation; no Final art/body/FX/game acceptance from this source accounting','gameChecksRun':False},indent=2)+'\n')
print('851 points',flush=True)
