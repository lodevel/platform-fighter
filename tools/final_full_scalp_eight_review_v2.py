"""Actual eight full unclipped authored scalp views and rejected foot input."""
from pathlib import Path
import sys,json,hashlib
sys.path[:0]=['tools','/tmp/pikachu-source-libs']
import numpy as np
from PIL import Image,ImageDraw
from dk_native_pose import DonkeyKongNativePose
from final_frozen_native_read_cache_v1 import install
A=Path('docs/review/2026-10-12/link-character/rework/art');B=A/'final-actor-851-physical-fit-v1';D=B/'full-scalp-eight-and-foot-review-v2';D.mkdir(exist_ok=True)
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
plan=json.load(open(B/'plan.json'));install(plan['inputHashes']);audit=json.load(open(B/'bounds-diagnosis-v1/all851-pre-raster-scalp-bounds-audit.json'));keys={r['key']for r in audit['rows']if r['preRasterHullOutsideOriginalCell']};recipePath=A/'final-actor-cranial-six-pilots-v1/donkeykong-cranial-recipe.json';recipe=json.load(open(recipePath));poses={};rows=[]
theta,phi=np.meshgrid(np.linspace(0,2*np.pi,161),np.linspace(0,np.pi,81));unit=np.stack([np.cos(phi),np.sin(phi)*np.cos(theta),np.sin(phi)*np.sin(theta)],-1).reshape(-1,3)
def hull(points):
 p=sorted(set(map(tuple,points)))
 def cross(a,b,c):return(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
 def half(seq):
  out=[]
  for q in seq:
   while len(out)>=2 and cross(out[-2],out[-1],q)<=0:out.pop()
   out.append(q)
  return out
 return half(p)[:-1]+half(p[::-1])[:-1]
for r in plan['rows']:
 if r['key']not in keys:continue
 m=json.load(open(r['sourceRecord']));path=m['motion']['path']
 if path not in poses:poses[path]=DonkeyKongNativePose(Path('/mnt/c/workspace/platform-fighter')/path)
 mat=poses[path].matrices(r['nativeSample'],['Head','Trans']);head=mat['Head'];trans=mat['Trans'][:3,3];local=unit*np.array(recipe['radii'])+np.array(recipe['centre']);world=(np.c_[local,np.ones(len(local))]@head.T)[:,:3]-trans;root=np.array(r['knownRootAfterExactReductionCrop']);scale=r['scaleToWorld'];points=root+np.c_[world[:,2]*5,-world[:,1]*5]/scale;contact=world[np.argmax(world[:,1])];contactPixel=root+np.array([contact[2]*5,-contact[1]*5])/scale;pad=np.array([20,20]);cell=Image.open(r['cell']).convert('RGBA');size=(cell.width+40,cell.height+40);base=Image.new('RGBA',size,'#182738');base.alpha_composite(cell,tuple(pad));view=base.copy();boundary=hull(points+pad);dr=ImageDraw.Draw(view);dr.polygon(boundary,fill=(97,200,255,65));view.alpha_composite(cell,tuple(pad));dr=ImageDraw.Draw(view);dr.line(boundary+[boundary[0]],fill='#88dcff',width=2);q=contactPixel+pad;dr.line([(q[0]-7,q[1]),(q[0]+7,q[1])],fill='#ff7ecc',width=2);dr.line([(q[0],q[1]-7),(q[0],q[1]+7)],fill='#ff7ecc',width=2)
 for im in [base,view]:
  q=root+pad;d=ImageDraw.Draw(im);d.line([(q[0]-7,q[1]),(q[0]+7,q[1])],fill='white');d.line([(q[0],q[1]-7),(q[0],q[1]+7)],fill='white')
 panel=Image.new('RGBA',(size[0]*2,size[1]+25),'#182738');panel.alpha_composite(base,(0,25));panel.alpha_composite(view,(size[0],25));ImageDraw.Draw(panel).text((5,5),r['key']+' | exact body, full scalp/crown; padding20px REVIEW ONLY',fill='white');p=D/(r['key']+'.png');panel.save(p);rows.append({'key':r['key'],'view':str(p),'viewSha256':sha(p),'originalCell':r['cell'],'originalCellSha256':r['cellSha256'],'recipe':str(recipePath),'recipeSha256':sha(recipePath),'fullHullMin':points.min(0).tolist(),'fullHullMax':points.max(0).tolist(),'originalRegisteredSourceRoot':root.tolist(),'sourceRootWorldUnchanged':True,'sourceHeadMatrix':head.tolist(),'review':'PENDING_ACTUAL_SCOPED_FULL_SCALP_REVIEW'})
key='pikachu-d04finaldashend-raw35';r=next(r for r in plan['rows']if r['key']==key);failure=next(p for p in B.glob('worker-*/failure.json')if json.load(open(p))['key']==key);prefix=failure.parent/key;cell=Image.open(r['cell']).convert('RGBA');raw=Image.open(str(prefix)+'-physical-region-11.png');half=raw.resize((raw.width//2,raw.height//2),Image.Resampling.NEAREST).crop(r['crop2x']);padded=Image.new('L',(cell.width+24,cell.height+24));padded.paste(half,(12,12));body=Image.new('RGBA',padded.size,'#182738');body.alpha_composite(cell,(12,12));pixels=np.array(body);mask=np.array(padded)>0;pixels[mask,:3]=[214,174,255];view=Image.fromarray(pixels);ImageDraw.Draw(view).rectangle((12,12,12+cell.width-1,12+cell.height-1),outline='#ff7ecc');p=D/(key+'-actual-foot11-padded-input.png');view.save(p);rows.append({'key':key,'view':str(p),'viewSha256':sha(p),'scope':'Exact actualFoot11 mask violet, unchanged body; pink oldviewport bounds. Padding12 diagnostic, sourceROOT unchanged; rejected primitive recorded separately. No margin/proof weakened.'})
(D/'index.json').write_text(json.dumps({'state':'EIGHT_ACTUAL_DK_BODY_FULL_SCALP_AND_ONE_FOOT_INPUT_REVIEW_PENDING','rows':rows,'gameChecksRun':False},indent=2)+'\n');print('9 actual originals prepared')
