"""Finite authored rectangular receiving alternatives from cached anatomy.

Actual target pixels are measured, not changed. Source point ownership is the
retained dominant-skin-weight adaptation, not native receiving. No acceptance
or production metadata is written.
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


def compare(packet, target_path):
    image = Image.open(target_path).convert('RGBA')
    if image.size != (1536, 1024):
        raise ValueError('Expected registered pilot cell1536x1024/root512,832')
    alpha = np.asarray(image)[:, :, 3] >= 32
    margin = packet['authoredMarginWorld']
    proposals = []
    for axis in (0, 1):
        for pieces in (1, 2, 4, 8):
            boxes, regions = [], []
            for region, raw in packet['projectedPointsByRegion'].items():
                points = np.asarray(raw)
                boundaries = np.linspace(points[:,axis].min(),points[:,axis].max(),pieces+1)
                indices = np.minimum(pieces-1,np.searchsorted(boundaries,points[:,axis],side='right')-1)
                selected_boxes=[]
                for i in range(pieces):
                    selected=points[indices==i]
                    if not len(selected):continue
                    minimum,maximum=selected.min(axis=0)-margin,selected.max(axis=0)+margin
                    centre=(minimum+maximum)/2;size=maximum-minimum
                    box={'id':f'donkeykong.rect.{axis}.{pieces}.{region}.{i}','region':region,
                        'offsetX':float(centre[0]),'offsetY':float(centre[1]),'width':float(size[0]),'height':float(size[1])}
                    boxes.append(box);selected_boxes.append(box)
                covered=np.zeros(len(points),dtype=bool)
                for box in selected_boxes:
                    covered|=(np.abs(points[:,0]-box['offsetX'])<=box['width']/2+1e-8)&(np.abs(points[:,1]-box['offsetY'])<=box['height']/2+1e-8)
                regions.append({'region':region,'sourcePointCoverage':float(covered.mean()),
                    'receivingBelowPhysicalFloorWorld':max(0.,max(b['offsetY']+b['height']/2 for b in selected_boxes)-42)})
            mask=Image.new('1',image.size)
            draw=ImageDraw.Draw(mask)
            for box in boxes:
                x0=512+(box['offsetX']-box['width']/2)*26/5;x1=512+(box['offsetX']+box['width']/2)*26/5
                y0=832+(box['offsetY']-box['height']/2-42)*26/5;y1=832+(box['offsetY']+box['height']/2-42)*26/5
                draw.rectangle((x0,y0,x1,y1),fill=1)
            receiving=np.asarray(mask,dtype=bool)
            proposals.append({'strategy':'x-strips' if axis==0 else 'y-strips','piecesPerRegion':pieces,
                'primitiveCount':len(boxes),'regions':regions,'hurtboxes':boxes,'reviewedForShipping':False,
                'targetAlphaDiagnostics':{'alphaThreshold':32,'receivingPixelCount':int(receiving.sum()),
                    'targetAlphaPixelCount':int(alpha.sum()),
                    'receivingOutsideAlphaFraction':float((receiving&~alpha).sum()/max(1,receiving.sum())),
                    'targetAlphaCoveredFraction':float((receiving&alpha).sum()/max(1,alpha.sum())),
                    'interpretation':'whole-visible-alpha diagnostic; anatomical region ownership and cosmetic exclusion still require inspection'}})
    return {'sourceMotion':packet['sourceMotion'],'nativeSample':packet['nativeSample'],
        'floorWarp':packet['floorWarp'],'bodyCentreFromRootY':-42,'authoredMarginWorld':margin,
        'targetImage':str(target_path),'targetImageSha256':hashlib.sha256(target_path.read_bytes()).hexdigest(),
        'fitPolicy':'uniform region strips, enclosing every selected source point plus1world px margin; no quantile exclusions',
        'status':'finite authored rectangle alternatives; no native receiving or accepted contour parity claim',
        'proposals':proposals,'reviewedForShipping':False}


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--packet',type=Path,required=True)
    parser.add_argument('--target',type=Path,required=True);parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args();data=compare(json.loads(args.packet.read_text()),args.target)
    args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps(data,indent=2)+'\n')
    print(args.output)
