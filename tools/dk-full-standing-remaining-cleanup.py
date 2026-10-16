"""Bounded named target material/RGB derivatives; actual acceptance is separate."""
from pathlib import Path
import argparse,json,hashlib
import numpy as np
from PIL import Image,ImageDraw
from scipy.ndimage import binary_erosion,distance_transform_edt
R=Path(__file__).resolve().parents[1];A=R/'docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/art'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def pin(p):return {'path':str(p.relative_to(R)),'sha256':sha(p)}
def mask(poly,size):
 im=Image.new('L',size);ImageDraw.Draw(im).polygon(poly,fill=255);return np.asarray(im)>0
def main():
 p=argparse.ArgumentParser();p.add_argument('--prep',type=Path,required=True);p.add_argument('--bounded-cleanup-slot-released',action='store_true');args=p.parse_args()
 if not args.bounded_cleanup_slot_released:raise ValueError('Art CPU resource required')
 prep=json.loads(args.prep.read_text());recipe=json.loads((R/prep['recipe']['path']).read_text());assert sha(R/prep['recipe']['path'])==prep['recipe']['sha256'];family=prep['jobFamily'];job=family+'-attempt'+str(prep['attempt']);review=A/(job+'-output-review.json');rows=json.loads(review.read_text())['records'];dest=A/(job+'-clean1-review.json')
 if dest.exists():raise ValueError('Preserve prior cleanup derivative')
 outputs=[]
 for row in rows:
  n=row['nativeSample'];f=next(f for f in recipe['poses'] if f['nativeSample']==n);src=A/row['image'];old=np.asarray(Image.open(src).convert('RGBA'));out=old.copy();alpha=out[:,:,3];rgb=out[:,:,:3];stable=binary_erosion(alpha>=32,iterations=2);protected=np.zeros(alpha.shape,bool)
  for box in f['realGapBoxes']:
   x,y,u,v=box;protected[y:v,x:u]=True
  for eye in f['eyes']:
   x,y,u,v=eye['scleraBox'];protected[max(0,y-10):v+10,max(0,x-10):u+10]=True
  changes=np.zeros(alpha.shape,bool);domains=[]
  for d in f['materialDomains']:
   domain=mask(d['polygon'],(1536,1024));selected=domain&stable&~protected&(alpha>=32)&(alpha<255);alpha[selected]=255;changes|=selected;domains.append({'name':d['name'],'polygon':d['polygon'],'alphaChangedPixels':int(selected.sum())})
  if n in [10,11]:
   earpoly=[[568,435],[674,435],[674,535],[568,535]]
   selected=mask(earpoly,(1536,1024))&stable&~protected&(alpha>=32)&(alpha<255)
   alpha[selected]=255;changes|=selected;domains.append({'name':'actually-viewed-ear-neck-partial-material','polygon':earpoly,'alphaChangedPixels':int(selected.sum())})
  r,g,b=[rgb[:,:,k].astype(float) for k in range(3)];fringe=(alpha>0)&(r>90)&(b>45)&(b>g*1.03)&(g<r*.72);valid=(alpha>=192)&~fringe;_,near=distance_transform_edt(~valid,return_indices=True);rgb[fringe]=rgb[near[0],near[1]][fringe]
  browpoly=next(d['polygon'] for d in f['paintDomains'] if 'white-brow' in d['name']);browdomain=mask(browpoly,(1536,1024));white=browdomain&(alpha>=32)&(rgb[:,:,0]>225)&(rgb[:,:,1]>180)&(rgb[:,:,2]>180);brow=white&np.any(rgb!=np.array([253,250,238]),2);rgb[white]=[253,250,238]
  speck=np.zeros(alpha.shape,bool)
  if n in [10,11]:
   speck[570:595,365:385]=True;speck&=(alpha>0)&(rgb[:,:,0]<100)&(rgb[:,:,1]<100)
   cream=(alpha>=192)&(rgb[:,:,0]>220)&(rgb[:,:,1]>170)&(rgb[:,:,2]>90)
   _,near=distance_transform_edt(~cream,return_indices=True);rgb[speck]=rgb[near[0],near[1]][speck]
  assert np.array_equal(old[:,:,3]>=32,alpha>=32);assert np.array_equal(old[:,:,3]==0,alpha==0);assert np.array_equal(old[:,:,3][protected],alpha[protected]);assert np.array_equal(old[~(fringe|brow|speck),:3],rgb[~(fringe|brow|speck)])
  stem=job+f'-fullgrab01-grab-native{n}-clean1';im=Image.fromarray(out);target=A/(stem+'-cutout.png');im.save(target);q=im.resize((384,256),Image.Resampling.LANCZOS);qp=A/(stem+'-quarter.png');q.save(qp);py=np.where(np.asarray(q)[:,:,3]>=32)[0];delta=(int(py.max())+.5-208)*5/6.5;assert abs(delta)<=.55;paths=[]
  for name,data in [('alpha-change-domain',changes),('rgb-fringe-change-domain',fringe),('rgb-brow-change-domain',brow),('rgb-observed-speck-change-domain',speck)]:
   fp=A/(stem+'-'+name+'.png');Image.fromarray(data.astype('uint8')*255).save(fp);paths.append(pin(fp))
  for mode,col in [('dark',(25,30,39)),('light',(247,246,238))]:
   bg=Image.new('RGBA',im.size,col+(255,));bg.alpha_composite(im);bg.convert('RGB').save(A/(stem+'-'+mode+'.png'))
  world=Image.new('RGBA',(1000,330),(25,30,39,255));ImageDraw.Draw(world).line((0,230,1000,230),fill=(95,113,140));ref=Image.open(R/prep['identityReference']['path']).convert('RGBA')
  for cx,b,rx in [(130,ref,512),(440,im,512),(780,im.transpose(Image.Transpose.FLIP_LEFT_RIGHT),1024)]:world.alpha_composite(b.resize((295,197),Image.Resampling.LANCZOS),(cx-round(rx*5/26),230-round(832*5/26)))
  world.convert('RGB').save(A/(stem+'-reference-bothface-world.png'));outputs.append({'nativeSample':n,'gameplayAge':n-1,'source':pin(src),'target':pin(target),'quarterTarget':pin(qp),'sourceGuide':next(r['sourceGuide'] for r in prep['records'] if r['nativeSample']==n),'floorTransform':next(r['floorTransform'] for r in prep['records'] if r['nativeSample']==n),'domains':domains,'alphaChangedPixels':int(changes.sum()),'RGBFringeChangedPixels':int(fringe.sum()),'RGBBrowChangedPixels':int(brow.sum()),'allAlphaZeroSpacesUnchanged':True,'alpha32SilhouetteUnchanged':True,'ocularAlphaUnchanged':True,'changeMasks':paths,'root':[512,832],'packedRoot':[128,208],'scaleToWorld':5/26,'packedScaleToWorld':5/6.5,'packedFloorPixelCentreDeltaWorld':delta,'actualVisualReview':'pending','receivingQualified':False,'wholeActionQualified':False})
 result={'state':'BOUNDED_TARGET_CLEANUP_ACTUAL_REVIEW_PENDING','rows':outputs,'tool':pin(Path(__file__)),'inputPreparation':pin(args.prep.resolve()),'rawOutputReview':pin(review),'canonicalChanged':False};dest.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(pin(dest)))
if __name__=='__main__':main()
