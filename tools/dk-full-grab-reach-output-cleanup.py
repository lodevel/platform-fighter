"""Named partial-material and generated RGB cleanup; no generation/shipping."""
from pathlib import Path
import json,hashlib,argparse
import numpy as np
from scipy.ndimage import binary_erosion,distance_transform_edt
from PIL import Image,ImageDraw
ROOT=Path(__file__).resolve().parents[1]
ART=ROOT/'docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/art'
F='dk-fullgrab-standing-reach01-attempt1'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def pin(p):return {'path':str(p.relative_to(ROOT)),'sha256':sha(p)}
def composite(im,color):
    x=Image.new('RGBA',im.size,color+(255,));x.alpha_composite(im);return x.convert('RGB')
DOMAINS={7:[('head-fur-crest',(615,304,814,449)),('back-and-rear-wrist',(286,350,618,647)),('neck-fur',(575,352,716,507)),('front-forearm',(688,548,854,721)),('exposed-tie-pendant',(600,644,693,807)),('hip-fur',(284,644,561,782))],9:[('head-fur-crest',(602,325,784,444)),('back-and-rear-wrist',(267,329,583,595)),('neck-fur',(554,387,673,533)),('front-forearm',(676,570,813,747)),('exposed-tie-pendant',(575,650,672,818)),('hip-fur',(293,642,568,782))]}
GAPS={7:(690,677,752,750),9:(673,627,770,744)}
EYES={7:(701,429,811,524),9:(679,442,798,535)}
BROWS={7:(718,441,798,487),9:(697,451,779,504)}
def main():
    ap=argparse.ArgumentParser();ap.add_argument('--bounded-cleanup-slot-released',action='store_true');a=ap.parse_args()
    if not a.bounded_cleanup_slot_released:raise ValueError('Root bounded cleanup window required')
    receipt=ART/(F+'-clean1-review.json')
    if receipt.exists():raise ValueError('Preserve existing derivative')
    rows=[]
    for n in [7,9]:
        stem=F+f'-fullgrab01-grab-native{n}';source=ART/(stem+'-cutout-candidate.png');old=np.asarray(Image.open(source).convert('RGBA'));out=old.copy();alpha=out[:,:,3];rgb=out[:,:,:3]
        stable=binary_erosion(alpha>=32,iterations=2);changes=np.zeros(alpha.shape,bool);counts=[]
        protected=np.zeros(alpha.shape,bool)
        for box in [GAPS[n],EYES[n]]:
            x0,y0,x1,y1=box;protected[y0:y1,x0:x1]=True
        for name,(x0,y0,x1,y1) in DOMAINS[n]:
            domain=np.zeros(alpha.shape,bool);domain[y0:y1,x0:x1]=True
            selected=domain&stable&~protected&(alpha>=32)&(alpha<255)
            counts.append({'name':name,'fullPixelBox':[x0,y0,x1,y1],'changedAlphaPixels':int(selected.sum())});changes|=selected;alpha[selected]=255
        r,g,b=[rgb[:,:,k].astype(float) for k in range(3)];fringe=(alpha>0)&(r>90)&(b>45)&(b>g*1.03)&(g<r*.72)
        valid=(alpha>=192)&~fringe;_,near=distance_transform_edt(~valid,return_indices=True);rgb[fringe]=rgb[near[0],near[1]][fringe]
        # Palette-only correction of the already generated attached brow plane;
        # no new white geometry, source-color paste, alpha or pupil edit.
        browDomain=np.zeros(alpha.shape,bool);x0,y0,x1,y1=BROWS[n];browDomain[y0:y1,x0:x1]=True
        bright=browDomain&(alpha>=32)&(rgb[:,:,0]>180)&(rgb[:,:,1]>150)&(rgb[:,:,2]>90)
        brow=bright&np.any(rgb!=np.array([253,250,238]),axis=2);rgb[bright]=[253,250,238]
        assert np.array_equal(old[:,:,3]>=32,alpha>=32);assert np.array_equal(old[:,:,3]==0,alpha==0)
        assert np.array_equal(old[protected,3],alpha[protected]);assert np.array_equal(old[~(fringe|brow),:3],rgb[~(fringe|brow)])
        im=Image.fromarray(out);dest=ART/(stem+'-clean1-cutout.png');im.save(dest)
        paths=[]
        for key,data in [('alpha-change-domain',changes),('rgb-fringe-change-domain',fringe),('rgb-brow-change-domain',brow)]:
            p=ART/(stem+'-clean1-'+key+'.png');Image.fromarray(data.astype('uint8')*255).save(p);paths.append(pin(p))
        for mode,color in [('dark',(25,30,39)),('light',(247,246,238))]:composite(im,color).save(ART/(stem+'-clean1-'+mode+'.png'))
        quarter=im.resize((384,256),Image.Resampling.LANCZOS);q=ART/(stem+'-clean1-quarter.png');quarter.save(q);yy,xx=np.where(np.asarray(quarter)[:,:,3]>=32);floor=(int(yy.max())+.5-208)*5/6.5;assert abs(floor)<=.55
        beforeafter=Image.new('RGB',(3072,2048),(245,245,238))
        for x,body in [(0,Image.fromarray(old)),(1536,im)]:
            beforeafter.paste(composite(body,(25,30,39)),(x,0));beforeafter.paste(composite(body,(247,246,238)),(x,1024))
        beforeafter.resize((1536,1024),Image.Resampling.LANCZOS).save(ART/(stem+'-clean1-opacity-before-after.png'))
        world=Image.new('RGBA',(1000,330),(25,30,39,255));ImageDraw.Draw(world).line((0,230,1000,230),fill=(95,113,140))
        ref=Image.open(ART/'dk-grabpilot-batch01-attempt1-grab-native8-clean3-cutout.png').convert('RGBA')
        for cx,body,rx in [(130,ref,512),(440,im,512),(780,im.transpose(Image.Transpose.FLIP_LEFT_RIGHT),1024)]:
            v=body.resize((round(1536*5/26),round(1024*5/26)),Image.Resampling.LANCZOS);world.alpha_composite(v,(cx-round(rx*5/26),230-round(832*5/26)))
        world.convert('RGB').save(ART/(stem+'-clean1-reference-bothface-world.png'))
        rows.append({'nativeSample':n,'source':pin(source),'target':pin(dest),'quarterTarget':pin(q),'domains':counts,'alphaChangedPixels':int(changes.sum()),'RGBFringeChangedPixels':int(fringe.sum()),'RGBBrowChangedPixels':int(brow.sum()),'browPaletteDomain':list(BROWS[n]),'changeMasks':paths,'allAlphaZeroSpacesUnchanged':True,'alpha32SilhouetteUnchanged':True,'ocularAlphaUnchanged':True,'RGBOutsideFringeAndExistingBrowPlaneUnchanged':True,'root':[512,832],'packedRoot':[128,208],'scaleToWorld':5/26,'packedScaleToWorld':5/6.5,'packedFloorPixelCentreDeltaWorld':floor,'actualVisualReview':'pending','receivingQualified':False,'wholeActionQualified':False})
    receipt.write_text(json.dumps({'state':'BOUNDED_GENERATED_TARGET_CLEANUP_DERIVATIVES_ACTUAL_REVIEW_PENDING','rows':rows,'tool':pin(Path(__file__)),'GPUUsed':False,'canonicalChanged':False},indent=2)+'\n');print(json.dumps({'receipt':pin(receipt),'changes':[{k:r[k] for k in ['nativeSample','alphaChangedPixels','RGBFringeChangedPixels']} for r in rows]},indent=2))
if __name__=='__main__':main()
