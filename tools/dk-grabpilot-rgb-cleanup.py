"""Bounded candidate RGB cleanup; alpha and originals remain byte-identical."""
from pathlib import Path
import argparse,json,hashlib
import numpy as np
from PIL import Image,ImageDraw,ImageFilter
from scipy.ndimage import distance_transform_edt

ROOT=Path(__file__).resolve().parents[1]
ART=ROOT/'docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/art'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def bounds(mask):
    y,x=np.where(mask)
    return [int(x.min()),int(y.min()),int(x.max()),int(y.max())] if len(x) else None

def main(version):
    suffix=f'clean{version}'
    receipt=ART/f'grab-first-four-rgb-{suffix}-review.json'
    if receipt.exists():raise ValueError('Preserve prior cleanup version')
    rows=[]
    for b in (1,3):
        family=f'dk-grabpilot-batch{b:02}';job=family+'-attempt1'
        prep=json.loads((ART/(family+'-preparation.json')).read_text())
        for row in prep['records']:
            key=row['prefix'];stem=job+'-'+key
            src=ART/(stem+'-cutout-candidate.png');original=np.asarray(Image.open(src).convert('RGBA'))
            array=original.copy();alpha=array[:,:,3];rgb=array[:,:,:3]
            red,green,blue=rgb.astype(float).transpose(2,0,1)
            # This targets the inspected purple/magenta fringe left after
            # applying reviewed source contour to generated RGB, not red shade.
            fringe=(alpha>0)&(red>90)&(blue>45)&(blue>green*1.03)&(green<red*.72)
            valid=(alpha>=192)&~fringe
            _,nearest=distance_transform_edt(~valid,return_indices=True)
            replacement=rgb[nearest[0],nearest[1]]
            rgb[fringe]=replacement[fringe]
            domains={'magentaFringe':{'pixelCount':int(fringe.sum()),'boundsInclusive':bounds(fringe),'method':'nearest non-magenta opaque generated RGB; no source RGB or alpha copied'}}
            # Two inspected isolated pale temple flecks are texture noise,
            # separate from the attached eye plane. Preserve all darker ear.
            speckboxes={'grab-native8':(640,445,690,490),'dash_grab-native11':(673,470,712,513),'grab_pull-native1':(963,486,979,504)}
            if key in speckboxes:
                x0,y0,x1,y1=speckboxes[key];box=np.zeros(alpha.shape,bool);box[y0:y1,x0:x1]=True
                white=box&(alpha>=192)&(rgb[:,:,0]>90)&((rgb[:,:,2]>8)|(rgb[:,:,1]>40))&(rgb[:,:,1]<rgb[:,:,0]*.8)
                if key=='grab_pull-native1':white=box&(alpha>=192)&((rgb[:,:,0]<180)|(rgb[:,:,1]<130)|(rgb[:,:,2]>210))
                base=box&(alpha>=192)&~white
                if white.any() and base.any():
                    _,idx=distance_transform_edt(~base,return_indices=True)
                    rgb[white]=rgb[idx[0],idx[1]][white]
                domains['inspectedIsolatedSpecks']={'pixelCount':int(white.sum()),'roi':[x0,y0,x1,y1],'boundsInclusive':bounds(white),'method':'nearest same-region generated RGB'}
            if key=='grab_pull-native1':
                region=Image.new('L',tuple(row['fullCanvas']));ImageDraw.Draw(region).polygon(row['featureAuthoring']['brow'],fill=255)
                region=np.asarray(region.filter(ImageFilter.MaxFilter(5)))>0
                brow=region&(alpha>=192)&(rgb[:,:,0]>180)&(rgb[:,:,1]>150)&(rgb[:,:,2]>90)
                rgb[brow]=[253,250,238]
                domains['creamBrowTint']={'pixelCount':int(brow.sum()),'boundsInclusive':bounds(brow),'method':'RGB only white palette correction on existing attached bright brow; no new alpha'}
            assert np.array_equal(array[:,:,3],original[:,:,3])
            changed=np.any(array[:,:,:3]!=original[:,:,:3],axis=2)
            assert not np.any(changed&(alpha==0))
            out=ART/(stem+'-'+suffix+'-cutout.png');Image.fromarray(array).save(out)
            body=Image.fromarray(array)
            for mode,col in [('dark',(25,30,39)),('light',(247,246,238))]:
                canvas=Image.new('RGBA',body.size,col+(255,));canvas.alpha_composite(body)
                canvas.convert('RGB').save(ART/(stem+'-'+suffix+'-'+mode+'.png'))
            packed=body.resize(tuple(row['packedCell']),Image.Resampling.LANCZOS)
            pp=ART/(stem+'-'+suffix+'-quarter.png');packed.save(pp)
            yy,xx=np.where(np.asarray(packed)[:,:,3]>=32)
            floor=(int(yy.max())+.5-row['packedRoot'][1])*row['packedScaleToWorld'];assert abs(floor)<=.55
            reference=Image.open(ROOT/prep['identityReference']['path']).convert('RGBA')
            ref=reference.resize((round(reference.width*5/26),round(reference.height*5/26)),Image.Resampling.LANCZOS)
            world=Image.new('RGBA',(1000,330),(25,30,39,255));ImageDraw.Draw(world).line((0,230,1000,230),fill=(95,113,140));world.alpha_composite(ref,(125-round(512*5/26),230-round(832*5/26)))
            preview=body.resize((round(body.width*5/26),round(body.height*5/26)),Image.Resampling.LANCZOS)
            for cx,face in [(430,1),(790,-1)]:
                v=preview if face==1 else preview.transpose(Image.Transpose.FLIP_LEFT_RIGHT);rx=round(row['fullRoot'][0]*5/26) if face==1 else v.width-round(row['fullRoot'][0]*5/26)
                world.alpha_composite(v,(cx-rx,230-round(832*5/26)))
            world.convert('RGB').save(ART/(stem+'-'+suffix+'-reference-bothface-world.png'))
            rows.append({'prefix':key,'source':src.name,'sourceSha256':sha(src),'cleaned':out.name,'cleanedSha256':sha(out),'changedRGBPixels':int(changed.sum()),'changedBoundsInclusive':bounds(changed),'domains':domains,'alphaBytesIdentical':True,'alphaSha256':hashlib.sha256(alpha.tobytes()).hexdigest(),'packedImage':pp.name,'packedImageSha256':sha(pp),'packedRoot':row['packedRoot'],'packedScaleToWorld':row['packedScaleToWorld'],'packedFloorPixelCentreWorldDelta':floor,'state':'corrected_candidate_actual_review_pending','receivingAccepted':False,'attachmentAccepted':False})
    report={'state':'four_rgb_only_corrected_candidates_actual_review_pending','rows':rows,'canonicalAssetsChanged':False,'GPUUsed':False,'toolSha256':sha(Path(__file__))}
    receipt.write_text(json.dumps(report,indent=2)+'\n');print(receipt.name,sha(receipt))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--version',type=int,default=1);main(p.parse_args().version)
