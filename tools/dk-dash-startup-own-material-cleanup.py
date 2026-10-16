"""Separate own-parent opacity and RGB contamination derivative; no diffusion."""
from pathlib import Path
import argparse, hashlib, json
import numpy as np
from PIL import Image, ImageDraw, ImageOps
from scipy.ndimage import binary_fill_holes, distance_transform_edt

ROOT=Path(__file__).resolve().parents[1]
ART=ROOT/'docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/art'
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def pin(p): return {'path':str(p.relative_to(ROOT)),'sha256':sha(p)}

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--plan',type=Path,required=True);parser.add_argument('--expected-plan-sha256',required=True);parser.add_argument('--material-correction-slot-released',action='store_true');args=parser.parse_args()
    if not args.material_correction_slot_released: raise ValueError('Own material correction CPU slot required')
    if sha(args.plan)!=args.expected_plan_sha256: raise ValueError('Own material plan changed')
    plan=json.loads(args.plan.read_text());rows=[]
    receipt=ART/'full-dash-grab-startup-own-material-clean1-receipt.json'
    if receipt.exists():raise ValueError('Preserve all earlier derivatives')
    reference=Image.open(ROOT/plan['reference']['path']).convert('RGBA')
    assert sha(ROOT/plan['reference']['path'])==plan['reference']['sha256']
    for row in plan['poses']:
        n=row['nativeSample'];parent=ROOT/row['parent']['path'];assert sha(parent)==row['parent']['sha256']
        before=np.asarray(Image.open(parent).convert('RGBA'));assert list(before.shape[:2])==[1024,1536]
        original=before[:,:,3];on=original>=32;envelope=binary_fill_holes(on);depth=distance_transform_edt(envelope)
        domains=np.zeros(on.shape,bool);protected=np.zeros(on.shape,bool)
        for box in row['materialDomainBoxes'].values():
            x0,y0,x1,y1=box;domains[y0:y1,x0:x1]=True
        for box in row['retainedRealGapBoxes']+[row['eyeAndMuzzleGuardBox']]:
            x0,y0,x1,y1=box;protected[y0:y1,x0:x1]=True
        alpha_scope=domains&envelope&(depth>3)&~protected
        alpha_change=alpha_scope&(original<255)
        after=before.copy();after[:,:,3][alpha_change]=255
        rgb=before[:,:,:3].astype(int)
        contaminated=(original>=32)&(rgb[:,:,2]>50)&(rgb[:,:,2]>rgb[:,:,1]*1.3)&(rgb[:,:,2]>rgb[:,:,0]*.15)
        rgb_change=contaminated&((depth<=8)|domains)&~protected
        valid=(original>=32)&~contaminated
        _,nearest=distance_transform_edt(~valid,return_indices=True)
        after[:,:,:3][rgb_change]=before[:,:,:3][nearest[0][rgb_change],nearest[1][rgb_change]]
        # Alpha-zero interior repairs receive own neighbouring anatomical RGB.
        zero_material=alpha_change&(original==0)
        after[:,:,:3][zero_material]=before[:,:,:3][nearest[0][zero_material],nearest[1][zero_material]]
        rgb_change|=zero_material
        assert np.array_equal(binary_fill_holes(after[:,:,3]>=32),envelope)
        assert np.array_equal(before[protected],after[protected])
        assert np.array_equal(before[~(alpha_change|rgb_change)],after[~(alpha_change|rgb_change)])
        yy,xx=np.where(after[:,:,3]>=32);assert int(yy.max())==830
        stem=f'dk-fullgrab-dash-startup01-attempt1-dash_grab-native{n}-material-clean1'
        if any(ART.glob(stem+'-*')):raise ValueError('Preserve derivative images')
        body=Image.fromarray(after);path=ART/(stem+'-cutout.png');body.save(path)
        alpha_path=ART/(stem+'-alpha-repair-mask.png');Image.fromarray((alpha_change*255).astype('uint8')).save(alpha_path)
        rgb_path=ART/(stem+'-RGB-repair-mask.png');Image.fromarray((rgb_change*255).astype('uint8')).save(rgb_path)
        images=[]
        for mode,color in [('dark',(25,30,39)),('light',(247,246,238))]:
            bg=Image.new('RGBA',body.size,color+(255,));bg.alpha_composite(body);p=ART/(stem+'-'+mode+'.png');bg.convert('RGB').save(p);images.append(pin(p))
        view=Image.new('RGB',(1080,500),(25,30,39))
        for y,bg in enumerate([(25,30,39),(247,246,238)]):
            for i,(im,mirrored) in enumerate([(reference,False),(body,False),(body,True)]):
                v=im.resize((round(im.width*5/26),round(im.height*5/26)),Image.Resampling.LANCZOS)
                rx=512*5/26
                if mirrored:v=ImageOps.mirror(v);rx=v.width-rx
                cell=Image.new('RGBA',(360,250),bg+(255,));cell.alpha_composite(v,(round(130-rx),round(185-832*5/26)))
                ImageDraw.Draw(cell).line((0,185,359,185),fill=(115,125,135));view.paste(cell.convert('RGB'),(360*i,250*y))
        vp=ART/(stem+'-reference-bothface-light-dark-world.png');view.save(vp);images.append(pin(vp))
        ab=Image.new('L',(1536,512));ab.paste(Image.fromarray(original).resize((768,512)),(0,0));ab.paste(Image.fromarray(after[:,:,3]).resize((768,512)),(768,0));ap=ART/(stem+'-alpha-before-after.png');ab.save(ap);images.append(pin(ap))
        quarter=body.resize((384,256),Image.Resampling.LANCZOS);qp=ART/(stem+'-quarter.png');quarter.save(qp)
        qa=np.asarray(quarter)[:,:,3];packed_floor=(int(np.where(qa>=32)[0].max())+.5-208)*5/6.5;assert abs(packed_floor)<=.55
        rows.append({**row,'target':pin(path),'quarter':pin(qp),'alphaRepairMask':pin(alpha_path),'RGBRepairMask':pin(rgb_path),'actualReviewViews':images,'alphaChangedPixels':int(alpha_change.sum()),'alphaZeroMaterialPixelsRepaired':int(zero_material.sum()),'RGBChangedPixels':int(np.any(before[:,:,:3]!=after[:,:,:3],axis=2).sum()),'alpha32InteriorHolePixelsAdded':int(((after[:,:,3]>=32)&~on).sum()),'externalFilledAlpha32EnvelopeIdentical':True,'allEyeMuzzleAndDeclaredRealGapRGBAUnchanged':True,'RGBAOutsideActualCorrectionMasksUnchanged':True,'sourceSupportLastPixelUnchanged':830,'packedFloorWorld':packed_floor,'accepted':False,'handFoldQualityReviewPending':True})
    result={'state':'OWN_MATERIAL_CLEANUP_DERIVATIVES_ACTUAL_VISUAL_REVIEW_PENDING','plan':pin(args.plan.resolve()),'tool':pin(Path(__file__)),'poses':rows,'GPUUsed':False,'nativeEvaluationExecuted':False,'canonicalChanged':False}
    receipt.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'receipt':pin(receipt),'metrics':[{'nativeSample':r['nativeSample'],'alphaChangedPixels':r['alphaChangedPixels'],'alphaZeroMaterialPixelsRepaired':r['alphaZeroMaterialPixelsRepaired'],'RGBChangedPixels':r['RGBChangedPixels']} for r in rows]}))

if __name__=='__main__':main()
