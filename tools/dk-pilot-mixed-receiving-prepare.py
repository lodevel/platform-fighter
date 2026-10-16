"""Prepare a bounded mixed-primitive review proposal for accepted static pilots.

The target art is unchanged. This deliberately excludes semantic neckcloth
receiving, retains all selected visible facial anatomy, and keeps source region
identity on every piece. It does not publish metadata or accept geometry.
"""
import argparse,hashlib,importlib.util,json
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw

def module(name,file):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(file))
    result=importlib.util.module_from_spec(spec);spec.loader.exec_module(result);return result
caps=module('caps','dk-receiving-fit-compare.py')
rects=module('rects','dk-receiving-rectangle-compare.py')

def prepare(packet_path,target_path,output,overlay):
    packet=json.loads(packet_path.read_text())
    rect_comparison=rects.compare(packet,target_path)
    boxes,policies=[],[]
    # Split torso and muzzle bounding pieces avoid one large circle spreading
    # into adjacent anatomy; palms/soles have flat support. Limb capsules keep
    # a concise moving-body representation. This fixed21-piece proposal is
    # inspected, rather than optimizing hundreds of shapes to whole alpha.
    rectangle_pieces={'hip':2,'bust':3,'head':2,'handl':1,'handr':1,'footl':1,'footr':1}
    for region,raw in packet['projectedPointsByRegion'].items():
        points=np.asarray(raw)
        if region in rectangle_pieces:
            pieces=rectangle_pieces[region]
            # The finite rectangle comparison supports1/2/4/8. Torso uses two
            # rather than inventing a silently different algorithm for three.
            pieces=2 if pieces==3 else pieces
            row=next(p for p in rect_comparison['proposals'] if p['strategy']=='y-strips' and p['piecesPerRegion']==pieces)
            selected=[b for b in row['hurtboxes'] if b['region']==region]
            boxes.extend(selected);policies.append({'region':region,'primitive':'rectangle','pieces':len(selected)})
        else:
            pieces=2 if region.startswith('shoulder') else 1
            for i,c in enumerate(caps.fit_region(points,'pca',pieces,packet['authoredMarginWorld'])):
                boxes.append(caps.as_hurtbox(c,region,f'donkeykong.mixed.{region}.{i}'))
            policies.append({'region':region,'primitive':'capsule','pieces':pieces})
    # Independent target-alpha diagnostics at unchanged registration.
    target=np.asarray(Image.open(target_path).convert('RGBA'))[:,:,3]>=32
    mask=Image.new('1',(1536,1024));draw=ImageDraw.Draw(mask)
    project=lambda x,y:(512+x*26/5,832+(y-42)*26/5)
    for b in boxes:
        if 'capsule' not in b:
            a=project(b['offsetX']-b['width']/2,b['offsetY']-b['height']/2);z=project(b['offsetX']+b['width']/2,b['offsetY']+b['height']/2)
            draw.rectangle((*a,*z),fill=1)
        else:
            c=b['capsule'];a=project(c['start']['x'],c['start']['y']);z=project(c['end']['x'],c['end']['y']);r=c['radius']*26/5
            draw.line([a,z],fill=1,width=round(2*r))
            for x,y in (a,z):draw.ellipse((x-r,y-r,x+r,y+r),fill=1)
    receiving=np.asarray(mask,dtype=bool)
    data={'nativeSample':packet['nativeSample'],'artFrameIndex':0,'bodyCentreFromRootY':-42,
        'sourcePosePacket':str(packet_path),'sourcePosePacketSha256':hashlib.sha256(packet_path.read_bytes()).hexdigest(),
        'targetImage':str(target_path),'targetImageSha256':hashlib.sha256(target_path.read_bytes()).hexdigest(),
        'cosmeticReceivingExclusions':packet['cosmeticReceivingExclusions'],'floorWarp':packet['floorWarp'],
        'geometryProvenance':'authored target-anatomy mixed primitives from retained visible skin clouds, not native hit_data',
        'authoredMarginWorld':packet['authoredMarginWorld'],'anatomicalFitPolicies':policies,'primitiveCount':len(boxes),
        'hurtboxPoses':[{'artFrameIndex':0,'nativeSample':packet['nativeSample'],'hurtboxes':boxes}],
        'targetAlphaDiagnostics':{'threshold':32,'receivingOutsideAlphaFraction':float((receiving&~target).sum()/max(1,receiving.sum())),
            'targetAlphaCoveredFraction':float((receiving&target).sum()/max(1,target.sum())),
            'interpretation':'cosmetic neckcloth excluded; major anatomy ownership and contour spill require actual overlay inspection'},
        'reviewedForShipping':False,'actualContactVerified':False}
    output.write_text(json.dumps(data,indent=2)+'\n')
    caps.annotate(target_path,{'strategy':'bounded mixed anatomy','piecesPerRegion':'1–2','hurtboxes':boxes},overlay)
    return data

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--packet',type=Path,required=True);p.add_argument('--target',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True);p.add_argument('--overlay',type=Path,required=True);a=p.parse_args()
    result=prepare(a.packet,a.target,a.output,a.overlay);print(json.dumps({'output':str(a.output),'primitives':result['primitiveCount'],'diagnostics':result['targetAlphaDiagnostics']}))
