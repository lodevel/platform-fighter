"""Localized authored target-identity correction; retains all generator originals.

This draws target palette features in the source face plane, not pasted reference
image rectangles. It is a review candidate, never auto-accepted or shipped.
"""
from pathlib import Path
from PIL import Image,ImageDraw,ImageFilter
import json,numpy as np,hashlib
BASE=Path(__file__).resolve().parent.parent/'docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/art'
REF=BASE.parents[1]/'art/idle-keyframe.png'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
S=4;W,H=1536,1024
red=(188,21,7,255);white=(253,250,238,255);black=(21,12,7,255)
def polygon(layer,points,color):
 ImageDraw.Draw(layer).polygon([(round(x*S),round(y*S))for x,y in points],fill=color)
def ellipse(layer,box,color):ImageDraw.Draw(layer).ellipse(tuple(round(v*S)for v in box),fill=color)
def eyes(layer,near,far,brows):
 for box in [near,far]:ellipse(layer,box,white)
 # Pupils sit inside actual sclera shapes and follow the rightward source gaze.
 for x0,y0,x1,y1 in [near,far]:
  width=x1-x0;height=y1-y0
  ellipse(layer,(x0+width*.52,y0+height*.18,x0+width*.9,y0+height*.88),black)
 for p in brows:polygon(layer,p,white)
records=[]
for key in ['jab1-native5','jab2-native4','dtilt-native6']:
 src=BASE/('firstcontact1-'+key+'-cutout.png');orig=Image.open(src).convert('RGBA');a=np.asarray(orig).copy();rgb=a[:,:,:3].astype(float);alpha=a[:,:,3].copy()
 # Colored chroma residue alone; opaque target red/cream costume does not match this condition.
 pink=(rgb[:,:,2]>rgb[:,:,1]*1.35)&(rgb[:,:,2]>rgb[:,:,0]*.32)&(rgb[:,:,2]>45)&(alpha>0)
 # Color decontamination rather than opacity deletion preserves fingers and registered bounds.
 a[pink,:3]=np.where((rgb[pink,0]>220)[:,None],np.array([251,208,150]),np.array([187,21,7]))
 layer=Image.new('RGBA',(W*S,H*S))
 changes=[]
 if key=='jab1-native5':
  polygon(layer,[(580,415),(627,410),(671,429),(704,450),(705,479),(677,508),(637,510),(601,491),(582,482)],red)
  eyes(layer,(596,481,639,512),(640,493,671,518),[[(590,471),(607,467),(641,483),(639,491),(611,481),(594,481)],[(641,485),(655,489),(678,487),(681,495),(659,501),(642,495)]])
  # SourceNecktie2..5 selected native5 trajectory, authored whipping cloth contour.
  polygon(layer,[(507,640),(523,636),(577,671),(632,670),(666,670),(676,681),(642,703),(590,705),(542,683),(519,661)],(116,22,8,255))
  polygon(layer,[(511,642),(523,640),(576,676),(632,674),(665,674),(670,681),(640,698),(591,700),(545,680),(522,659)],(237,44,9,255))
  changes=['Local white-brow/dark-oval eye pair in source face plane; previous U-ribbon and triangular shadow removed without altering head outline','Visible authored tie contour follows selected native5 S_Necktie2..5 trajectory; approximate cloth visibility, not copied model pixels']
 elif key=='jab2-native4':
  # Unselected cream triangles on back and blue pelvis are color artifacts, not anatomy.
  polygon(layer,[(450,441),(478,441),(481,469),(456,479)],(190,20,6,255))
  polygon(layer,[(531,466),(581,466),(577,501),(528,501)],(191,20,7,255))
  polygon(layer,[(625,610),(658,610),(658,688),(622,688)],(194,22,10,255))
  changes=['Two stray cream flank triangles removed in retained red torso','Unwanted blue pelvis replaced by local retained red palette; head/eyes remain actual generated pixels']
 else:
  # A separate forehead speck is not the selected target identity.
  polygon(layer,[(680,579),(729,579),(736,613),(680,613)],(186,22,7,255))
  polygon(layer,[(675,621),(715,615),(756,627),(779,643),(779,665),(771,692),(746,704),(708,694),(678,668)],red)
  eyes(layer,(701,657,740,690),(741,670,768,696),[[(695,648),(710,645),(742,659),(740,667),(714,657),(697,658)],[(742,662),(755,661),(777,665),(775,673),(756,671),(744,671)]])
  polygon(layer,[(1068,716),(1110,716),(1110,776),(1068,776)],(251,207,146,255))
  changes=['Forehead cream speck removed','White-ridge/triangular socket replaced by localized source-plane white-brow/dark-oval target eyes','Red palm wedge recolored cream without changing fingers/palm reach or alpha']
 decorated=Image.alpha_composite(Image.fromarray(a),layer.resize((W,H),Image.Resampling.LANCZOS));b=np.asarray(decorated).copy();b[:,:,3]=alpha
 # Restore every original transparent background RGB: no authored drawing may create new body alpha.
 b[alpha==0]=a[alpha==0]
 out=Image.fromarray(b)
 floor=None
 if key=='jab1-native5':
  last=int(np.nonzero(alpha>=32)[0].max());start=760;target=830
  warped=Image.new('RGBA',(W,H));warped.paste(out.crop((0,0,W,start)),(0,0));warped.paste(out.crop((0,start,W,last+1)).resize((W,target-start+1),Image.Resampling.BICUBIC),(0,start));out=warped
  floor={'inputBandStartPixelY':start,'inputLastPixelY':last,'targetLastPixelY':target,'ratioInclusiveRows':(target-start+1)/(last-start+1),'upperBodyPixelsUnchangedByFloor':True}
 stem='firstcontact-local-'+key;path=BASE/(stem+'-cutout.png');out.save(path)
 for name,c in [('light',(247,246,238)),('dark',(25,30,39))]:
  comp=Image.new('RGB',(W,H),c);comp.paste(out,mask=out.getchannel('A'));comp.save(BASE/(stem+'-'+name+'.png'))
 arr=np.asarray(out);ys,xs=np.where(arr[:,:,3]>=32)
 records.append({'key':key,'input':src.name,'inputSha256':sha(src),'output':path.name,'outputSha256':sha(path),'root':[512,832],'scaleToWorld':5/26,'bodyCentreFromRootY':-42,'changes':changes,'changedRgbaPixels':int(np.count_nonzero(np.any(arr!=np.asarray(orig),2))),'alphaChangedPixels':int(np.count_nonzero(arr[:,:,3]!=alpha)),'floorWarp':floor,'alpha32LastPixelY':int(ys.max()),'floorPixelCentreWorldDelta':(int(ys.max())+.5-832)*5/26,'accepted':False,'identityProvenance':'Authored target palette geometry calibrated to inspected identity, no reference-pixel paste, no native RGB copy; source body/root pose preserved outside declared local regions'})
 # Actual world scale side-by-side with retained identity, both mirrored facings.
 canvas=Image.new('RGBA',(780,330),(25,30,39,255));draw=ImageDraw.Draw(canvas);draw.line((0,230,780,230),fill=(95,113,140),width=1)
 reference=np.asarray(Image.open(REF).convert('RGBA')).copy();v=reference[:,:,:3].astype(float);pink=(v[:,:,2]>v[:,:,0]*.7)&(v[:,:,2]>v[:,:,1]*1.25)&(v[:,:,2]>115);reference[pink,3]=0;r=Image.fromarray(reference);r=r.crop(r.getbbox());r=r.resize((round(r.width*104/r.height),104),Image.Resampling.LANCZOS);canvas.alpha_composite(r,(110-r.width//2,230-r.height))
 view=out.resize((round(W*5/26),round(H*5/26)),Image.Resampling.LANCZOS)
 for cx,facing in [(330,1),(645,-1)]:
  im=view if facing==1 else view.transpose(Image.Transpose.FLIP_LEFT_RIGHT);rx=round(512*5/26) if facing==1 else im.width-round(512*5/26);canvas.alpha_composite(im,(cx-rx,230-round(832*5/26)))
 canvas.convert('RGB').save(BASE/(stem+'-reference-bothface-world.png'))
(BASE/'firstcontact-local-authoring.json').write_text(json.dumps({'state':'actual_corrected_visual_review_pending','reference':str(REF),'referenceSha256':sha(REF),'toolSha256':sha(Path(__file__)),'records':records,'runtime':'Art-only diagnostics; paired target receiving and running game proof pending; no shipping writes'},indent=2)+'\n')
print(json.dumps(records))
