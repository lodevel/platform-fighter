"""Export source ownership priors and active ATTACK transforms for23 DK cells.

No images or shipping metadata are changed. Anatomy clouds are source ownership
priors; fitting actual accepted target contours remains a separate required step.
Native hit_data and native status interpolation parity are not asserted.
"""
import hashlib, importlib.util, json, re
from pathlib import Path
import numpy as np

ROOT=Path(__file__).resolve().parent.parent
ART=ROOT/'docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/art'
SOURCE=ROOT/'docs/review/2026-09-25/donkeykong-character/completion-2026-10-08/mechanics/pilot-native-attack-capsules.json'

def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()

def export():
    spec=importlib.util.spec_from_file_location('anatomy',Path(__file__).with_name('dk-anatomical-capsules.py'))
    anatomy=importlib.util.module_from_spec(spec);spec.loader.exec_module(anatomy)
    manifest=ART/'first-three-complete-clips-source-guide-preparation.json'
    rows=json.loads(manifest.read_text())['sourceRows']
    contacts=json.loads(SOURCE.read_text())['pilotContacts']
    by_clip=dict(zip(('jab','jab2','dtilt'),contacts))
    receipts=[]
    for row in rows:
        guide_path=ART/row['metadata'];guide=json.loads(guide_path.read_text())
        if sha(guide_path)!=row['metadataSha256']:raise ValueError('Source guide manifest hash mismatch')
        sample=row['nativeSample'];age=row['gameplayAge'];reference=by_clip[row['clip']]
        source_path=ROOT/reference['sourcePath']
        if sha(source_path)!=reference['sourceSha256']:raise ValueError('Native ATTACK source hash mismatch')
        motion=Path(guide['motion']['path']).stem
        native=anatomy.native_region_points(motion,sample,exclude_cosmetic_tie=True)
        # Include expression-specific visible faces and exclude captured tie
        # skin weights. Keep original floor overhang; no target warp is guessed.
        clouds={bone.lower():[[p[2]*5,42-p[1]*5] for p in points]
            for bone,points in native['pointsByRegion'].items()}
        packet={'state':'source_anatomical_ownership_priors_only_target_fit_pending',
            'sourceGuide':str(guide_path.relative_to(ROOT)),'sourceGuideSha256':sha(guide_path),
            'sourceMotion':native['provenance'],'sourceMesh':native['mesh'],
            'nativeSample':sample,'gameplayAge':age,'bodyCentreFromRootY':-42,
            'root':[512,832],'scaleToWorld':5/26,'floorWarp':None,
            'authoredMarginWorld':1,'projectedPointsByRegion':clouds,
            'visibleMeshes':native['visibleMeshes'],'cosmeticReceivingExclusions':native['cosmeticReceivingExclusions'],
            'omittedMeshHelperConstraints':native['omittedMeshHelperConstraints'],
            'geometryProvenance':'source visible skin ownership prior; NOT native hit_data or accepted target receiving',
            'reviewedForShipping':False,'actualContactVerified':False}
        cloud_path=ART/(row['prefix']+'-anatomy-source.json');cloud_path.write_text(json.dumps(packet,separators=(',',':'))+'\n')
        # Read the actual frame/wait command ledger, including jab2's wait3.
        # Keep the primary window distinct from selected runtime/UFD timing.
        game_body=source_path.read_text().split('unsafe extern "C" fn effect_')[0]
        clock=0.;creation=None;clear=None
        for command in re.finditer(r'(frame|wait)\(agent\.lua_state_agent, ([\d.]+)\)|macros::ATTACK\(|AttackModule::clear_all',game_body):
            if command.group(1):clock=float(command.group(2)) if command.group(1)=='frame' else clock+float(command.group(2))
            elif command.group(0).startswith('macros::ATTACK'):creation=clock if creation is None else creation
            else:clear=clock;break
        if creation!=reference['nativeContactFrame'] or clear is None or clear<=creation:
            raise ValueError('Unreviewed active-event clock')
        start_age,end_age=creation-1,clear-1
        active=start_age<=age<end_age
        matrices={name.lower():np.asarray(value,dtype=float) for name,value in guide['bone_matrices'].items()}
        root=matrices['trans'][:3,3];hits=[]
        for hit in reference['hitRegions'] if active else []:
            bone='trans' if hit['bone']=='top' else hit['bone'].lower()
            if bone not in matrices:raise ValueError('Unknown native ATTACK bone')
            ends=[]
            for key in ('startNative','endNative'):
                p=hit[key];world=(matrices[bone]@np.array([p['x'],p['y'],p['z'],1.]))[:3]-root
                ends.append({'x':float(world[2]*5),'y':float(42-world[1]*5)})
            hits.append({'id':hit['id'],'capsule':{'start':ends[0],'end':ends[1],'radius':hit['radiusNative']*5},'sourceRegion':hit})
        attacks={'state':'source_projected_attack_geometry_target_fit_pending','sourceGuide':str(guide_path.relative_to(ROOT)),
            'sourceGuideSha256':sha(guide_path),'sourceCommand':reference['sourcePath'],'sourceCommandSha256':reference['sourceSha256'],
            'nativeSample':sample,'gameplayAge':age,'primaryActiveWindow':{'startFrame':start_age,'endFrame':end_age},
            'active':active,'collisionHits':hits,'registration':{'root':[512,832],'bodyCentreFromRootY':-42,'scaleToWorld':5/26},
            'projection':'full XYZ bone transform, top alias Trans, remove Trans translation, z-forward/y-up into screen at5world/native; radius unscaled by bone matrix',
            'targetFitAccepted':False,'actualContactVerified':False}
        attack_path=ART/(row['prefix']+'-attack-source.json');attack_path.write_text(json.dumps(attacks,indent=2)+'\n')
        receipts.append({'clip':row['clip'],'nativeSample':sample,'gameplayAge':age,'activeHitIds':[hit['id'] for hit in hits],
            'anatomyPacket':str(cloud_path.relative_to(ROOT)),'anatomyPacketSha256':sha(cloud_path),
            'attackPacket':str(attack_path.relative_to(ROOT)),'attackPacketSha256':sha(attack_path)})
    out=ART/'first-three-complete-clips-source-packets.json'
    out.write_text(json.dumps({'state':'SOURCE_ONLY_TARGET_FIT_AND_MATCH_PENDING','sourceManifestSha256':sha(manifest),
        'nativeAttackSourcePacketSha256':sha(SOURCE),'rows':receipts},indent=2)+'\n')
    print(json.dumps({'rows':len(receipts),'destination':str(out.relative_to(ROOT))}))

if __name__=='__main__':export()
