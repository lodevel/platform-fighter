"""Exact two observed exposed-skin RGB domains, preserving every alpha byte."""
from pathlib import Path
import hashlib,json,argparse
import numpy as np
from scipy.ndimage import distance_transform_edt
from PIL import Image,ImageDraw
ROOT=Path(__file__).resolve().parents[1];A=ROOT/'docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/art'
S='dk-fullgrab-standing-startup01-attempt2-fullgrab01-grab-native4'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def pin(p):return {'path':str(p.relative_to(ROOT)),'sha256':sha(p)}
def main():
    ap=argparse.ArgumentParser();ap.add_argument('--root-named-skin-correction-released',action='store_true');a=ap.parse_args()
    if not a.root_named_skin_correction_released:raise ValueError('Explicit named-domain correction required')
    receipt=A/(S+'-clean2-skin-palette-review.json')
    if receipt.exists():raise ValueError('Preserve derivative')
    p=A/(S+'-clean1-cutout.png');old=np.asarray(Image.open(p).convert('RGBA'));new=old.copy();rgb=new[:,:,:3];alpha=new[:,:,3]
    r,g,b=[rgb[:,:,k].astype(float) for k in range(3)];domain=np.zeros(alpha.shape,bool);boxes=[(442,103,466,144),(331,200,350,220)]
    for x0,y0,x1,y1 in boxes:domain[y0:y1,x0:x1]=True
    defect=domain&(alpha>0)&((r-g)>65)&(b>g*.7)
    hand=np.zeros(alpha.shape,bool);hand[95:290,322:550]=True
    cream=hand&(alpha>=192)&(g>180)&(b>120)&(b<g*.9)&((r-g)<65)&~defect
    _,near=distance_transform_edt(~cream,return_indices=True);rgb[defect]=rgb[near[0],near[1]][defect]
    assert np.array_equal(old[:,:,3],new[:,:,3]);assert np.array_equal(old[~defect],new[~defect])
    im=Image.fromarray(new);out=A/(S+'-clean2-cutout.png');im.save(out);mask=A/(S+'-clean2-exact-RGB-change-domain.png');Image.fromarray(defect.astype('uint8')*255).save(mask)
    for mode,color in [('dark',(25,30,39)),('light',(247,246,238))]:
        bg=Image.new('RGBA',im.size,color+(255,));bg.alpha_composite(im);bg.convert('RGB').save(A/(S+'-clean2-'+mode+'.png'))
    q=A/(S+'-clean2-quarter.png');im.resize((384,256),Image.Resampling.LANCZOS).save(q)
    world=Image.new('RGBA',(1000,330),(25,30,39,255));ImageDraw.Draw(world).line((0,230,1000,230),fill=(95,113,140))
    for cx,body,rx in [(130,Image.open(A/'firstcontact-clean3-jab1-native5-cutout.png').convert('RGBA'),512),(440,im,512),(780,im.transpose(Image.Transpose.FLIP_LEFT_RIGHT),1024)]:
        v=body.resize((round(1536*5/26),round(1024*5/26)),Image.Resampling.LANCZOS);world.alpha_composite(v,(cx-round(rx*5/26),230-round(832*5/26)))
    world.convert('RGB').save(A/(S+'-clean2-reference-bothface-world.png'))
    changes=[{'pixel':[int(x),int(y)],'beforeRGBA':old[y,x].tolist(),'afterRGBA':new[y,x].tolist(),'copiedGeneratedCreamPixel':[int(near[1,y,x]),int(near[0,y,x])]} for y,x in zip(*np.where(defect))]
    receipt.write_text(json.dumps({'state':'NAMED_EXPOSED_SKIN_RGB_DERIVATIVE_ACTUAL_REVIEW_PENDING','source':pin(p),'target':pin(out),'quarterTarget':pin(q),'exactChangeMask':pin(mask),'namedFullPixelDomains':boxes,'changedRGBPixels':int(defect.sum()),'changes':changes,'alphaBytesUnchanged':True,'allRGBAOutsideExactMaskUnchanged':True,'native1Clean1Unchanged':True,'noFoldGeometryRepaint':True,'tool':pin(Path(__file__)),'shippingChanged':False},indent=2)+'\n');print(json.dumps({'receipt':pin(receipt),'changedRGBPixels':int(defect.sum())},indent=2))
if __name__=='__main__':main()
