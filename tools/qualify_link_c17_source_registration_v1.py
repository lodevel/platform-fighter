"""Read-only source-root/foot inventory and current outgoing/socket panels."""
from pathlib import Path
import json,hashlib,math,time
import numpy as np
from PIL import Image,ImageDraw
A=Path('docs/review/2026-10-12/link-character/rework/art')
S=A/'first1842-c17-staged-v1';D=A/'c17-source-registration-contact-review-v1'
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
def write(p,v):p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(v,indent=2)+'\n')
def main():
    start=time.perf_counter();D.mkdir(exist_ok=True)
    f=json.load(open(S/'frames.json'));registrations={};support=[]
    support_path=D/'support1097-source-root-inventory.json'
    retained_support={(r['resource'],r['nativeSample']):r for r in json.load(open(support_path))['rows']}if support_path.exists()else {}
    for path in sorted(S.glob('*/registration.json')):
        for r in json.load(open(path))['rows']:
            resource=path.parent.name;sample=r['nativeSample'];registrations[(resource,sample)]=r
            j=json.load(open(r['selectedJournal']));b=j['originalGeometry'];m=json.load(open(r['sourceRecord']))
            assert sha(r['selectedJournal'])==r['selectedJournalSha256'] and sha(r['sourceRecord'])==r['sourceRecordSha256']
            if (resource,sample) in retained_support:
                prior=retained_support[(resource,sample)]
                assert prior['selectedJournalSha256']==r['selectedJournalSha256'] and prior['sourceRecordSha256']==r['sourceRecordSha256']
                support.append(prior);continue
            scale=r['scaleToWorld'];root=np.array(m['artRoot'],float);ppu=m['artPixelsPerNativeUnit'];trans=np.array(m['capturedTrans'])
            feet=[]
            for rr in [11,14]:
                mp=next(p for p in j['qualifiedRetainedPhysical14Masks']if p.endswith(f'-physical-region-{rr}.png'))
                assert sha(mp)==j['qualifiedRetainedPhysical14Masks'][mp]
                box=Image.open(mp).getbbox()
                feet.append({'part':rr,'mask':mp,'maskSha256':j['qualifiedRetainedPhysical14Masks'][mp],
                    'rawPixelBounds':list(box)if box else None,
                    'lowestPhysicalPixelCentreYFromSourceRoot':(box[3]-.5-root[1])*5/ppu if box else None})
            joint_points={}
            for name in ['FootL','FootR','ToeL','ToeR']:
                matrix=np.array(m['sourceRigAnchors'][name]);v=matrix[:3,3]-trans
                joint_points[name]={'x':float(5*v[2]),'y':float(-5*v[1])}
            footcaps=[c for c in r['receiving']if c.get('region')=='foot']
            receivingbottom=max([max(c['start']['y'],c['end']['y'])+c['radius']for c in footcaps],default=None)
            bottom=max([x['lowestPhysicalPixelCentreYFromSourceRoot']for x in feet if x['rawPixelBounds']],default=None)
            support.append({'resource':resource,'nativeSample':sample,'logicalArtFrameIndex':r['frameIndex'],
                'sourceRecordSha256':r['sourceRecordSha256'],'selectedJournalSha256':r['selectedJournalSha256'],
                'sourceSampleInterval':r['sourceSampleInterval'],'footParts':feet,'capturedFootToeWorld':joint_points,
                'lowestPhysicalFootPixel':bottom,'lowestFootReceivingExtent':receivingbottom,
                'nominalActorHullFloorFromSourceRoot':0.,'physicalClearanceAboveNominalFloor':-bottom if bottom is not None else None,
                'bodyCentreFromRootY':-36.,'supportRetargetY':0.,'rootDelta':{'x':0.,'y':0.},
                'phase':'airborne motion / lifted anatomy; no inferred floor requirement'if 'attackair' in resource else 'ground owner; source Foot/Toe pose lift preserved',
                'limits':'Static authored source registration inventory. Nominal hull floor is not actual terrain/contact evidence; no per-frame floor snap.'})
    assert len(support)==1097
    write(D/'support1097-source-root-inventory.json',{'rows':support,'selectedSupportRetargetY':0.,'gameChecksRun':False})
    packets={};proofs=[];matrixcount=virtualcount=0
    for fam in ['04','05']:
        source=A.parent/'art-support'/f'normal-contact-family-{fam}-source-centres-v1-reviewed/index.json'
        data=json.load(open(source))
        for move in data['moves']:
            resource=Path(move['resource']['path']).stem
            for group in move['groups']:
                for row in group['rows']:
                    sample=row['rawNativeSample'];reg=registrations.get((resource,sample));stored=row['storedDrawing']
                    record=reg['sourceRecord']if reg else stored['sourceRecord'];m=json.load(open(record));centres=row['nativeSourceCentres']
                    bone=centres['actualSkeletonBone'];kind=centres['geometryProvenance']
                    if bone is not None:
                        assert centres['rawBoneMatrix']==m['sourceRigAnchors'][bone],('PAIRED_NATIVE_BONE_MATRIX_MISMATCH',resource,sample,bone)
                        assert centres['capturedTransTranslationXYZ']==m['capturedTrans']
                        matrixcount+=1
                    else:
                        assert kind=='AUTHORED_VIRTUAL_TOP_ACTOR_SOURCE_ROOT_PLANE_NOT_NATIVE_MATRIX';virtualcount+=1
                    cap=row['selectedSourceCapsule'];actual=next(d for d in f['runtimeBodyProfiles'][resource]['drawings']if d['nativeSample']==sample)
                    native_end=centres['end'] or centres['start']
                    assert cap['start']==centres['start']['unregisteredWorldRootXY'] and cap['end']==native_end['unregisteredWorldRootXY']
                    assert cap['radius']==centres['nativeRadius']*5
                    packets.setdefault((resource,sample),[]).append({'packetId':row['packetId'],'packetRole':row['packetRole'],'capsule':cap,'geometryProvenance':kind})
                    proofs.append({'resource':resource,'nativeSample':sample,'logicalArtFrameIndex':actual['frameIndex'],
                        'packetId':row['packetId'],'packetRole':row['packetRole'],'geometryProvenance':kind,
                        'sourceIndexSha256':sha(source),'pairedSourceRecordSha256':sha(record),'actualBoneMatrixExactlyEqual':bone is not None,
                        'explicitVirtualTop':bone is None,'sourceRootSupportShiftApplied':0.,'nativeRadiusWorldScale':5.,'gameChecksRun':False})
    write(D/'source-packet-and-socket-qualification.json',{'rows':proofs,'namedMatrixExactCount':matrixcount,
        'explicitAuthoredVirtualTopCount':virtualcount,'sameSourceRegistration':'Source Trans removed once; native axes X=5Z,Y=-5Y; ROOT0/support0. Sword HaveR and Waist sockets share actual source record and raw sample.','gameChecksRun':False})
    panels=[];tiles=[];tileproof=[];cache={}
    for (resource,sample),hits in sorted(packets.items()):
        profile=f['runtimeBodyProfiles'][resource];drawing=next(d for d in profile['drawings']if d['nativeSample']==sample)
        render=drawing['render'];clip=f['animations'][render['sheet']];path=S/clip['strip'];cachekey=str(path)
        if cachekey not in cache:cache={cachekey:Image.open(path).convert('RGBA')}
        atlas=cache[cachekey];w=clip['frameWidth'];h=clip['frameHeight'];cols=atlas.width//w;i=render['frameIndex'];xy=((i%cols)*w,(i//cols)*h)
        cell=atlas.crop((xy[0],xy[1],xy[0]+w,xy[1]+h));root=np.array([drawing['originX']*w,drawing['originY']*h]);scale=profile['scaleToWorld']
        points=[np.array([0.,0.])]
        for hit in hits:
            c=hit['capsule']
            for end in ['start','end']:
                p=np.array([c[end]['x'],c[end]['y']])/scale+root;r=c['radius']/scale
                points.extend([p-r,p+r])
        lower=np.floor(np.minimum([0,0],np.min(points,0))).astype(int);upper=np.ceil(np.maximum([w,h],np.max(points,0))).astype(int)
        dims=upper-lower+20;offset=-lower+10;tile=Image.new('RGBA',(int(dims[0]*2),int(dims[1]+45)),'#182738')
        tile.alpha_composite(cell,tuple((offset+[0,45]).astype(int)));tile.alpha_composite(cell,tuple((offset+[dims[0],45]).astype(int)));draw=ImageDraw.Draw(tile)
        def pixel(p):return tuple((np.array([p['x'],p['y']])/scale+root+offset+[dims[0],45]).tolist())
        for hit in hits:
            c=hit['capsule'];aa=pixel(c['start']);bb=pixel(c['end']);rr=c['radius']/scale
            draw.line([aa,bb],fill='#ffb753',width=3)
            for x,y in [aa,bb]:draw.ellipse((x-rr,y-rr,x+rr,y+rr),outline='#ffb753',width=2)
        for at in drawing['attachments']:
            x,y=pixel(at['point']);draw.ellipse((x-4,y-4,x+4,y+4),fill='#4af4ee');draw.text((x+5,y),at['role'],fill='#4af4ee')
        x,y=pixel({'x':0.,'y':0.});draw.line((x-8,y,x+8,y),fill='white',width=2);draw.line((x,y-8,x,y+8),fill='white',width=2)
        draw.text((5,5),f'{resource} raw{sample}: current pixels LEFT | outgoing + Sword/waist RIGHT',fill='white')
        draw.text((5,21),'ROOT0; orange source packet radius; virtual TOP explicitly authored where declared',fill='#e6cedf')
        tiles.append(tile);tileproof.append({'resource':resource,'nativeSample':sample,'logicalArtFrameIndex':drawing['frameIndex'],
            'pageSha256':sha(path),'originX':drawing['originX'],'originY':drawing['originY'],'scaleToWorld':scale,'packets':hits,'attachments':drawing['attachments']})
    for start_i in range(0,len(tiles),9):
        group=tiles[start_i:start_i+9];cw=max(t.width for t in group);ch=max(t.height for t in group)
        panel=Image.new('RGBA',(cw*3,ch*math.ceil(len(group)/3)),'#182738')
        for i,tile in enumerate(group):panel.alpha_composite(tile,((i%3)*cw,(i//3)*ch))
        path=D/f'current-packet-socket-{start_i//9+1:02}.png';panel.save(path)
        panels.append({'path':str(path),'sha256':sha(path),'drawingCount':len(group),'rows':tileproof[start_i:start_i+9]})
    write(D/'index.json',{'state':'CURRENT_SOURCE_PACKET_SOCKET_PANELS_ACTUAL_REVIEW_PENDING',
        'sourceStageFramesSha256':sha(S/'frames.json'),'panels':panels,'poseCount':len(tiles),'packetRows':len(proofs),
        'support1097InventorySha256':sha(D/'support1097-source-root-inventory.json'),
        'packetQualificationSha256':sha(D/'source-packet-and-socket-qualification.json'),'seconds':time.perf_counter()-start,'gameChecksRun':False})
    print('QUALIFIED',len(proofs),matrixcount,virtualcount,'PANELS',len(panels),'POSES',len(tiles),'SECONDS',time.perf_counter()-start,flush=True)
if __name__=='__main__':main()
