"""Immutable, lightweight source matrices only; no mesh or target attachment fit."""
from pathlib import Path
import json
import numpy as np
from PIL import Image, ImageDraw
from dk_native_pose import DonkeyKongNativePose, ROOT, sha

ART = ROOT / 'docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/art'
PLAN = ART / 'grab-pull-hold-source-conditioned-plan.json'
MECHANICS = ROOT / 'docs/review/2026-09-25/donkeykong-character/completion-2026-10-08/mechanics/grab-throw-next-batch-source-plan.json'
DEST = ART / 'grab-source-socket-review-01'
NAMES = ['Trans','Rot','Hip','Waist','Bust','Neck','Head','ShoulderL','ArmL','HandL','HaveL','ShoulderR','ArmR','HandR','HaveR','LegL','KneeL','FootL','LegR','KneeR','FootR','Throw']
SOCKETS = ['Throw','HaveL','HaveR','HandL','HandR']
SAMPLES = {'grab':[8], 'dash_grab':[11], 'pivot_grab':[12], 'grab_pull':[1,2,20], 'grab_hold':[1], 'pummel':[1,2,3,7], 'bthrow':[14,15,16], 'uthrow':[13,14,15], 'dthrow':[18,19,20]}
FIRST = {('grab',8),('dash_grab',11),('pivot_grab',12),('grab_pull',1),('grab_hold',1)}

def project(point):
    return {'x':float(point[2]*5), 'y':float(42-point[1]*5)}

def render_bones(packet):
    im = Image.new('RGB',(768,512),(30,34,42)); draw=ImageDraw.Draw(im)
    # Half-resolution common authoring projection, no body/floor deformation.
    def px(point): return (256+point['x']*2.6,416+(point['y']-42)*2.6)
    draw.line([(0,416),(767,416)], fill=(105,105,105))
    pos=packet['boneOriginProjectionActorWorld']
    for a,b in [('Hip','Waist'),('Waist','Bust'),('Bust','Neck'),('Neck','Head'),('Bust','ShoulderL'),('ShoulderL','ArmL'),('ArmL','HandL'),('Bust','ShoulderR'),('ShoulderR','ArmR'),('ArmR','HandR'),('Hip','LegL'),('LegL','KneeL'),('KneeL','FootL'),('Hip','LegR'),('LegR','KneeR'),('KneeR','FootR')]:
        draw.line([px(pos[a]),px(pos[b])],fill=(180,180,180),width=2)
    for region in packet['sourceCatchProjections']:
        a,b=px(region['capsule']['start']),px(region['capsule']['end']); r=region['capsule']['radius']*2.6
        color=(60,200,125) if region['situation'].endswith('_G') else (80,140,235)
        draw.line([a,b],fill=color,width=max(1,int(r*2)))
        for p in [a,b]:draw.ellipse((p[0]-r,p[1]-r,p[0]+r,p[1]+r),outline=color,width=2)
    for name in ['Head',*SOCKETS]:
        p=px(pos[name]); color=(255,180,50) if name=='Throw' else (240,230,210)
        draw.ellipse((p[0]-3,p[1]-3,p[0]+3,p[1]+3),fill=color)
        draw.text((p[0]+4,p[1]-12),name,fill=color)
    draw.text((10,10),f"{packet['sheet']} native {packet['nativeSample']} / age {packet['selectedGameplayAge']}",fill='white')
    draw.text((10,30),'SOURCE BONES/CATCH ONLY - no mesh, receiving or accepted victim socket',fill='white')
    return im

def main():
    if DEST.exists(): raise SystemExit('Refusing to overwrite immutable source socket review directory')
    DEST.mkdir()
    plan=json.loads(PLAN.read_text()); mechanics=json.loads(MECHANICS.read_text())
    clips={row['sheet']:row for row in plan['clips']}
    rows={row['sheet']:row for row in mechanics['rows']}
    manifest=[]
    for sheet,samples in SAMPLES.items():
        source=rows[sheet]['native_motion']['resources'][0]
        motion=ROOT/source['path']
        if sha(motion)!=source['sha256']: raise ValueError('Resource SHA mismatch')
        pose=DonkeyKongNativePose(motion)
        origin=pose.matrices(0,['Trans'])['Trans'][:3,3]
        for sample in samples:
            raw=pose.matrices(sample,NAMES); trans=raw['Trans'][:3,3]
            registered={name:mat.copy() for name,mat in raw.items()}
            for mat in registered.values():mat[:3,3]-=trans
            projections={name:project(mat[:3,3]) for name,mat in registered.items()}
            catches=[]
            for c in clips.get(sheet,{}).get('sourceCatchRegions',[]):
                def vec(v):return np.array([v['x'],v['y'],v['z']])
                catches.append({'id':c['id'],'situation':c['situation'],'source':c,'capsule':{'start':project(vec(c['startNative'])),'end':project(vec(c['endNative'])),'radius':c['radiusNative']*5},'projectionScope':'authored top/root adapter; top is a script origin, not a captured skeleton bone; no victim joint inferred'})
            packet={'state':'guarded source socket candidates, no target fit or runtime acceptance','sheet':sheet,'nativeSample':sample,'selectedGameplayAge':sample-1,'firstFivePriority':(sheet,sample) in FIRST,'sourcePlan':str(MECHANICS.relative_to(ROOT)),'sourcePlanSha256':sha(MECHANICS),'sourceProvenance':pose.provenance(),'evaluatorSha256':sha(ROOT/'tools/dk_native_pose.py'),'exporterSha256':sha(Path(__file__)),'capturedTransNative':trans.tolist(),'capturedTransDeltaFromNative0':(trans-origin).tolist(),'capturedTransDeltaActorWorld':{'x':float((trans-origin)[2]*5),'y':float(-(trans-origin)[1]*5)},'rawBoneMatrices':{n:m.tolist() for n,m in raw.items()},'transRemovedBoneMatrices':{n:m.tolist() for n,m in registered.items()},'boneOriginProjectionActorWorld':projections,'sourceSocketCandidates':{n:{'matrix':registered[n].tolist(),'originActorWorld':projections[n]} for n in SOCKETS},'sourceCatchProjections':catches,'registration':{'fullCanvas':[1536,1024],'fullRoot':[512,832],'pixelsPerNativeUnit':26,'worldPerNativeUnit':5,'bodyCentreFromRootY':-42,'packedCanvas':[384,256],'packedRoot':[128,208],'packedScaleToWorld':5/6.5,'floorWarpApplied':False},'authoredVictimAttachment':None,'recipientAnchor':None,'recipientFacing':None,'receivingGeometry':None,'meshEvaluated':False,'gpuUsed':False,'shippingChanged':False,'limits':['Native Throw/Have origins do not prove common capture constraint joint.','No body surface is inferred from bone origins; receiving and contact contour must follow actual reviewed target.','Source sample age+1 is selected rate1 adapter, not proof of common CatchPull/CatchWait status clocks.','Native cancel2, archive extent20 and current pull threshold20 are separate; no duration assigned.','Loop flag/extent67 do not establish native hold loop period.','Recipient is a separate entity with its own reviewed anchor/body/facing; no second fighter is baked into art.']}
            p=DEST/f'{sheet}-native{sample}-source-sockets.json';p.write_text(json.dumps(packet,indent=2)+'\n')
            preview=DEST/f'{sheet}-native{sample}-source-bones.png';render_bones(packet).save(preview)
            manifest.append({'sheet':sheet,'nativeSample':sample,'firstFivePriority':packet['firstFivePriority'],'packet':str(p.relative_to(ROOT)),'packetSha256':sha(p),'sourceBonePreview':str(preview.relative_to(ROOT)),'sourceBonePreviewSha256':sha(preview)})
    out=DEST/'manifest.json';out.write_text(json.dumps({'state':'20 lightweight actual native source matrix exports; raster guide/body/socket acceptance pending','packets':manifest,'meshEvaluated':False,'gpuUsed':False,'shippingChanged':False},indent=2)+'\n')
    print(json.dumps({'manifest':str(out.relative_to(ROOT)),'sha256':sha(out),'packets':len(manifest)}))

if __name__=='__main__':main()
