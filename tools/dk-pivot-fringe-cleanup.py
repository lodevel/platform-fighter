"""One bounded RGB-only pivot derivative; never submits generation or writes assets."""
from pathlib import Path
import hashlib,json
import numpy as np
from PIL import Image,ImageDraw
from scipy.ndimage import distance_transform_edt

ROOT=Path(__file__).resolve().parents[1]
ART=ROOT/'docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/art'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def main():
    stem='dk-grabpilot-batch02-attempt2-pivot_grab-native12'
    receipt=ART/'pivot-grab-native12-attempt2-fringe-clean1-review.json'
    if receipt.exists():raise ValueError('Preserve prior derivative')
    prep=json.loads((ART/'dk-grabpilot-batch02-attempt2-preparation.json').read_text());row=prep['records'][0]
    src=ART/(stem+'-cutout-candidate.png');original=np.asarray(Image.open(src).convert('RGBA'));out=original.copy()
    alpha=out[:,:,3];rgb=out[:,:,:3];r,g,b=rgb.astype(float).transpose(2,0,1)
    fringe=(alpha>0)&(r>90)&(b>45)&(b>g*1.03)&(g<r*.72)
    boundary=distance_transform_edt(alpha>0)<=8
    protected=np.zeros(alpha.shape,bool);protected[440:541,690:791]=True
    domain=fringe&boundary&~protected
    valid=(alpha>=192)&~fringe
    _,nearest=distance_transform_edt(~valid,return_indices=True)
    replacement=rgb[nearest[0],nearest[1]];rgb[domain]=replacement[domain]
    changed=np.any(rgb!=original[:,:,:3],axis=2)
    assert np.array_equal(alpha,original[:,:,3]) and not np.any(changed&~domain)
    assert np.array_equal(out[protected],original[protected])
    y,x=np.where(changed)
    body=Image.fromarray(out);cut=ART/(stem+'-clean1-cutout.png');body.save(cut)
    mask=ART/(stem+'-clean1-rgb-change-domain.png');Image.fromarray((changed*255).astype('uint8')).save(mask)
    views={}
    for mode,col in [('dark',(25,30,39)),('light',(247,246,238))]:
        c=Image.new('RGBA',body.size,col+(255,));c.alpha_composite(body)
        p=ART/(stem+'-clean1-'+mode+'.png');c.convert('RGB').save(p);views[mode]={'path':str(p.relative_to(ROOT)),'sha256':sha(p)}
    packed=body.resize(tuple(row['packedCell']),Image.Resampling.LANCZOS);pp=ART/(stem+'-clean1-quarter.png');packed.save(pp)
    yy,xx=np.where(np.asarray(packed)[:,:,3]>=32);floor=(int(yy.max())+.5-row['packedRoot'][1])*row['packedScaleToWorld'];assert abs(floor)<=.55
    ref=Image.open(ROOT/prep['identityReference']['path']).convert('RGBA');ref=ref.resize((round(ref.width*5/26),round(ref.height*5/26)),Image.Resampling.LANCZOS)
    world=Image.new('RGBA',(1000,330),(25,30,39,255));ImageDraw.Draw(world).line((0,230,1000,230),fill=(95,113,140));world.alpha_composite(ref,(125-round(512*5/26),230-round(832*5/26)))
    preview=body.resize((round(body.width*5/26),round(body.height*5/26)),Image.Resampling.LANCZOS)
    for cx,face in [(430,1),(790,-1)]:
        v=preview if face==1 else preview.transpose(Image.Transpose.FLIP_LEFT_RIGHT);rx=round(row['fullRoot'][0]*5/26) if face==1 else v.width-round(row['fullRoot'][0]*5/26)
        world.alpha_composite(v,(cx-rx,230-round(832*5/26)))
    wp=ART/(stem+'-clean1-reference-bothface-world.png');world.convert('RGB').save(wp);views['world']={'path':str(wp.relative_to(ROOT)),'sha256':sha(wp)}
    report={'state':'bounded_rgb_only_derivative_actual_review_pending','source':{'path':str(src.relative_to(ROOT)),'sha256':sha(src)},'cleaned':{'path':str(cut.relative_to(ROOT)),'sha256':sha(cut)},'changedRGBPixels':int(changed.sum()),'boundsInclusive':[int(x.min()),int(y.min()),int(x.max()),int(y.max())],'domain':{'path':str(mask.relative_to(ROOT)),'sha256':sha(mask),'criterion':'inspected magenta predicate, within 8 full-resolution pixels of existing alpha perimeter, excluding face ROI [690,440,791,541]','method':'nearest non-magenta opaque generated RGB only'},'alphaBytesIdentical':True,'alphaSha256':hashlib.sha256(alpha.tobytes()).hexdigest(),'facialROIBytesIdentical':True,'outsideDomainRGBAIdentical':True,'registration':{'fullRoot':row['fullRoot'],'fullScaleToWorld':5/26,'packedRoot':row['packedRoot'],'packedScaleToWorld':row['packedScaleToWorld'],'bodyCentreFromRootY':-42},'packed':{'path':str(pp.relative_to(ROOT)),'sha256':sha(pp),'floorPixelCentreWorldDelta':floor},'views':views,'GPUUsed':False,'canonicalWrites':False,'receivingAccepted':False,'attachmentAccepted':False,'wholeActionAccepted':False,'toolSha256':sha(Path(__file__))}
    receipt.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'receipt':str(receipt.relative_to(ROOT)),'sha256':sha(receipt),'changed':int(changed.sum())}))
if __name__=='__main__':main()
