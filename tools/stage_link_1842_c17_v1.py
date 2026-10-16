"""Private exact 745+1097 stage; no render, projection, fit or game execution."""
from pathlib import Path
import json, hashlib, copy, math, shutil, time
import numpy as np
from PIL import Image

A=Path('docs/review/2026-10-12/link-character/rework/art')
D=A/'first1842-c17-staged-v1'
F=Path('assets/characters/link/frames.json')
B=A/'remaining-c17-selected-equipment-bank-v2'
R=A/'remaining-c17-current-gear-review-v2'
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
def write(p,v):
    p.parent.mkdir(parents=True,exist_ok=True)
    p.write_text(json.dumps(v,indent=2)+'\n')

def main():
    start=time.perf_counter()
    assert not (D/'frames.json').exists(), 'Versioned completed stage already exists'
    D.mkdir(exist_ok=True)
    before=F.read_bytes();before_sha=sha(F)
    assert before_sha=='bcc096a390d81aa20b0682f8148e09181031de10cb359ff32558a7292657356c'
    original=json.loads(before);f=copy.deepcopy(original);f.pop('runtimeTextureSources')
    plan=json.load(open(B/'plan.json'));index=json.load(open(B/'index.json'))
    assert sha(B/'plan.json')=='445d8b24c5d47bf683e0e45f607b015db27a5558383dcb4bbdc6a66e40b3768a'
    assert len(index['rows'])==1097 and sum(r['changed']for r in index['rows'])==514
    for p,h in plan['inputHashes'].items(): assert sha(p)==h, ('FROZEN_INPUT_CHANGED',p)
    review=R/'art-29-panels-306-corrected-attack-hold-gear-review.json'
    assert json.load(open(review))['drawingCount']==306
    hold=R/'coordinator-three-hold-terminal-policy-selection.json'
    assert json.load(open(hold))['policy']['loopFrames'] is None
    refs={(r['resource'],r['nativeSample']):r for r in index['rows']}
    pages=[];registrations={};resources=[];bindings=f['runtimeEquipmentBindings']['rows']
    for sheet,c in f['animations'].items():
        src=F.parent/c['strip'];dest=D/c['strip'];dest.parent.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(src,dest);assert sha(src)==sha(dest)
        pages.append({'sheet':sheet,'path':str(dest),'sha256':sha(dest),'copiedExisting':True,
                      'dimensions':list(Image.open(dest).size),'frameCount':c['frameCount']})
    for g in plan['groups']:
        resource=g['resource'];assert resource not in f['runtimeBodyProfiles'];rows=[]
        for sample in g['samples']:
            ref=refs[(resource,sample)];assert sha(ref['journal'])==ref['sha256']
            r=json.load(open(ref['journal']));b=r['originalGeometry']
            assert sha(r['cell'])==r['cellSha256'] and sha(r['sourceRecord'])==r['sourceRecordSha256']
            assert r['supportRetargetY']==b['uniformSupportRetargetY']==0
            assert r['receiving']==b['receiving'] and r['headContact']==b['headContact']
            m=json.load(open(r['sourceRecord']));trans=np.array(m['capturedTrans'],float)
            im=Image.open(r['cell']);root=r['registeredRootPixel']
            assert np.max(np.abs(np.asarray(root)-(np.asarray(m['artRoot'])/2-np.asarray(r['actualPackingCrop'][:2]))))<1e-10
            def joint(name):
                v=np.asarray(m['sourceRigAnchors'][name],float)[:3,3]-trans
                return {'x':float(5*v[2]),'y':float(-5*v[1])}
            p,q=joint('Sword1'),joint('Sword2')
            attachments=[{'role':'sword','point':joint('HaveR'),'angleDegrees':math.degrees(math.atan2(q['y']-p['y'],q['x']-p['x']))},
                         {'role':'waist','point':joint('Waist')}]
            rows.append({'nativeSample':sample,'frameIndex':b['logicalArtFrameIndex'],'receiving':b['receiving'],
                'headContact':b['headContact'],'attachments':attachments,'passiveShield':[],'bakedArticles':[],
                'sourcePixel':r['cell'],'sourcePixelSha256':r['cellSha256'],'rootPixel':root,
                'scaleToWorld':b['scaleToWorld'],'sourceIdentity':b['sourceIdentity'],'sourceRecord':r['sourceRecord'],
                'sourceRecordSha256':r['sourceRecordSha256'],'capturedTrans':m['capturedTrans'],'uniformSupportRetargetY':0.,
                'receivingAuthoringReviewKey':r['sourcePhysicalJournalSha256'],'width':im.width,'height':im.height,
                'gearOwner':r['gearOwner'],'equipmentContext':r['equipmentContext'],'sourceSampleInterval':r['sourceSampleInterval'],
                'clockWitnesses':r['clockWitnesses'],'selectedJournal':ref['journal'],'selectedJournalSha256':ref['sha256']})
        rows.sort(key=lambda r:r['nativeSample'])
        assert rows[0]['nativeSample']==0 and len({r['frameIndex']for r in rows})==len(rows)
        width=max(r['width']for r in rows);height=max(r['height']for r in rows)
        columns=max(1,1024//width);capacity=columns*max(1,1024//height)
        drawings=[];resource_pages=[]
        for offset in range(0,len(rows),capacity):
            group=rows[offset:offset+capacity];cols=min(columns,len(group))
            dimensions=[cols*width,math.ceil(len(group)/cols)*height];assert max(dimensions)<=1024
            atlas=Image.new('RGBA',tuple(dimensions));sheet=resource if offset==0 else resource+'__c17_p'+str(offset//capacity)
            for i,r in enumerate(group):
                im=Image.open(r['sourcePixel']).convert('RGBA');xy=((i%cols)*width,(i//cols)*height)
                atlas.paste(im,xy);assert np.array_equal(np.array(im),np.array(atlas.crop((xy[0],xy[1],xy[0]+im.width,xy[1]+im.height))))
                r['render']={'sheet':sheet,'frameIndex':i};origin=[r['rootPixel'][0]/width,r['rootPixel'][1]/height]
                assert max(abs(origin[0]*width-r['rootPixel'][0]),abs(origin[1]*height-r['rootPixel'][1]))<1e-10
                interval=r['sourceSampleInterval'];assert interval[0]==r['nativeSample']
                drawings.append({k:r[k]for k in ['frameIndex','nativeSample','receiving','headContact','attachments','passiveShield','bakedArticles','render','receivingAuthoringReviewKey']}|
                    {'startAge':interval[0],'endAgeExclusive':interval[1],'originX':origin[0],'originY':origin[1]})
            strip=f'animations/c17-1097-v1/{sheet}.png';path=D/strip;path.parent.mkdir(parents=True,exist_ok=True);atlas.save(path)
            f['animations'][sheet]={'strip':strip,'frameWidth':width,'frameHeight':height,'frameCount':len(group),
                'sourceDrawingCount':len(rows)if offset==0 else len(group),'fps':60,'loop':False}
            entry={'sheet':sheet,'path':str(path),'sha256':sha(path),'dimensions':dimensions,
                'rgba8Bytes':dimensions[0]*dimensions[1]*4,'frameCount':len(group)}
            pages.append(entry);resource_pages.append(entry)
        assert all(a['endAgeExclusive']==b['startAge']for a,b in zip(drawings,drawings[1:]))
        ishold=g['motion'].endswith('_hold')
        if ishold:assert drawings[-1]['nativeSample']==60 and drawings[-1]['endAgeExclusive']==61
        f['runtimeBodyProfiles'][resource]={'sheet':resource,'coordinateOrigin':'actorSourceRoot',
            'sourceSampleBasis':'zero-based-native-index','sourceIdentity':{'resource':resource,'sha256':rows[0]['sourceIdentity']['sha256']},
            'frameWidth':width,'frameHeight':height,'scaleToWorld':rows[0]['scaleToWorld'],'bodyCentreFromRootY':-36,
            'endAgeExclusive':drawings[-1]['endAgeExclusive'],'loopFrames':None,'drawings':drawings,
            'rootDelta':[{'x':0.,'y':0.}],'rootPolicy':'in-place','nativeDeclaredLoop':False}
        for alias in set([g['motion'],'link.'+g['motion'],g['id']]):
            assert alias not in f['runtimeBodyProfileAliases']
            f['runtimeBodyProfileAliases'][alias]=resource
        for r in rows:
            base={'kind':'whole-body','body':{'motion':resource,'rawNativeSample':r['nativeSample'],
                'sourceResourceSha256':r['sourceIdentity']['sha256']},'equipmentContext':r['equipmentContext']}
            bindings.append({'overlayMotion':None,'basePose':base,'gearOwner':r['gearOwner'],
                'bindingProofKey':r['sourcePixelSha256']+':'+r['selectedJournalSha256'],'kind':'baked-equivalent',
                'proof':{'artifactSha256':r['selectedJournalSha256'],'type':'actual-baked-equipment-context','equipmentContext':r['equipmentContext']}})
        registrations[resource]=rows;rp=D/resource/'registration.json'
        write(rp,{'rows':rows,'pages':resource_pages,'motion':g['motion'],'stockDemandSha256':plan['demandSha256'],
            'rootPolicy':'Selected in-place rootDelta0; capturedTrans archived; no native common kinetic caller claim or floor snap.',
            'holdPolicy':{'terminalRawSample':60,'loopFrames':None,'selectionSha256':sha(hold)}if ishold else None,
            'gearScope':'Exact stock NONE/Bowhidden demand intervals. Custom Lab clock, held HAND and external BACK Bow remain dependencies.'})
        resources.append({'resource':resource,'motion':g['motion'],'drawingCount':len(rows),'pageCount':len(resource_pages),
            'registration':str(rp),'registrationSha256':sha(rp)})
        print('PACKED',resource,len(rows),len(resource_pages),flush=True)
    # Source-bound outgoing for all C normal roles, plus only the selected old Bair Hit2 adapter.
    outgoing_proofs=[]
    for family in ['04','05']:
        source=A.parent/'art-support'/f'normal-contact-family-{family}-source-centres-v1-reviewed/index.json'
        evidence=json.load(open(source))
        for move in evidence['moves']:
            resource=Path(move['resource']['path']).stem;profile=f['runtimeBodyProfiles'][resource]
            assert profile['sourceIdentity']['sha256']==move['resource']['sha256']
            packets={};roles=[]
            for group in move['groups']:
                role=group['packetRole'];roles.append(role)
                for r in group['rows']:
                    sample=r['rawNativeSample'];drawing=next(d for d in profile['drawings']if d['nativeSample']==sample)
                    cap=r['selectedSourceCapsule'];assert cap['coordinateOrigin']=='actorSourceRoot'
                    assert not cap['supportShiftApplied'] and not cap['bodyCentreShiftApplied'] and not cap['facingMirrorApplied']
                    if resource in registrations:
                        actual=next(d for d in registrations[resource]if d['nativeSample']==sample)
                        stored=r['storedDrawing']
                        if stored is not None:
                            assert actual['sourceRecordSha256']==stored['sourceRecordSha256']
                            assert actual['frameIndex']==stored['logicalArtFrameIndex']
                        else:
                            assert resource=='c05attackairhi' and sample==14
                            admission=source.parent/'drawing-admission-native14.json';assert sha(admission)=='d8fa724cc14fd6b56408954d5789360c347a1c06cf05eaad95dd4f21ff215578'
                    packets.setdefault((sample,role),[]).append({'id':r['packetId'],'capsule':{k:cap[k]for k in ['start','end','radius']}})
                    outgoing_proofs.append({'resource':resource,'nativeSample':sample,'frameIndex':drawing['frameIndex'],
                        'packetId':r['packetId'],'packetRole':role,'sourceIndex':str(source),'sourceIndexSha256':sha(source),
                        'publicContactFrame':r['selectedPublicContactFrame'],'sourceGameplayAge':r['actualDefaultGameplayAge'],
                        'capsule':cap,'supportRetargetY':0.,'sameStoredDrawingQualified':True})
            if resource=='c05attackairb':
                # The family04 evidence is deliberately only the selected Hit2 revision.
                assert set(roles)=={'Hit 2'}
                for old in f['runtimeOutgoingPoses'][resource]:
                    if old['packetRole']=='Hit 2':old['collisionHits']=packets.get((old['nativeSample'],'Hit 2'),[])
            else:
                assert resource not in f['runtimeOutgoingPoses']
                f['runtimeOutgoingPoses'][resource]=[{'frameIndex':d['frameIndex'],'nativeSample':d['nativeSample'],
                    'packetRole':role,'collisionHits':packets.get((d['nativeSample'],role),[])}
                    for d in profile['drawings']for role in roles]
    for resource,p in original['runtimeBodyProfiles'].items():assert f['runtimeBodyProfiles'][resource]==p
    for k,v in original['animations'].items():assert f['animations'][k]==v
    for k,v in original['runtimeBodyProfileAliases'].items():assert f['runtimeBodyProfileAliases'][k]==v
    for k,v in original['runtimeOutgoingPoses'].items():
        if k!='c05attackairb':assert f['runtimeOutgoingPoses'][k]==v
        else:
            assert [p for p in v if p['packetRole']!='Hit 2']==[p for p in f['runtimeOutgoingPoses'][k]if p['packetRole']!='Hit 2']
    assert f['runtimeEquipmentBindings']['rows'][:745]==original['runtimeEquipmentBindings']['rows']
    assert sum(len(p['drawings'])for p in f['runtimeBodyProfiles'].values())==1842 and len(bindings)==1842
    f['installedBodyResourceCount']=41;f['completionState']='PARTIAL1842_SOURCE_SELECTED_STOCK_BODY_EQUIPMENT_CONTEXT_STAGED_RUNTIME_UNVERIFIED'
    (D/'frames.before.json').write_bytes(before);write(D/'frames.json',f);write(D/'outgoing-source-qualification.json',{'rows':outgoing_proofs,'gameChecksRun':False})
    assert F.read_bytes()==before
    write(D/'index.json',{'state':'PRIVATE1842_C17_STAGE_REQUIRES_COMPLETE_SCOPED_REVIEW_AND_MATCHING_ENCODED_MANIFEST',
        'beforeSha256':before_sha,'frames':str(D/'frames.json'),'framesSha256':sha(D/'frames.json'),'resources':resources,'pages':pages,
        'pageCount':len(pages),'newDrawingCount':1097,'preservedDrawingCount':745,'gearBindings':1842,
        'allOld745BodyProfilesAliasesAnimationsExactlyPreserved':True,'allOriginal211PNGPageBytesExactlyPreserved':True,
        'oldOutgoingException':'Only separately selected Bair Hit2 outgoing source14..16; all other old packets unchanged.',
        'newGearChangedDrawings':514,'newExactPixelReuses':583,'outgoingSourceQualificationSha256':sha(D/'outgoing-source-qualification.json'),
        'holdSelectionSha256':sha(hold),'artGearReviewSha256':sha(review),'sourcePlanSha256':sha(B/'plan.json'),
        'seconds':time.perf_counter()-start,'operatorSha256':sha(__file__),'gameChecksRun':False,'shippingAssetsChanged':False})
    print('STAGED1842',len(pages),sha(D/'frames.json'),round(time.perf_counter()-start,3),flush=True)

if __name__=='__main__':main()
