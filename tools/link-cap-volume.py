"""Cosmetic NEW-reference hat volume; source-depth occlusion, excluded receiving."""
from pathlib import Path
import json,numpy as np,sys,importlib.util,hashlib
from PIL import Image,ImageFilter
sys.path.insert(0,'tools')
O=Path('docs/review/2026-10-12/link-character/rework/art');pose=sys.argv[1];source=Path(sys.argv[2]);base=Path(sys.argv[3]);out=Path(sys.argv[4]);m=json.load(open(str(source)+'.json'));neutral=json.load(open(O/'native-pilot/neutral-native0.json'));H0=np.array(neutral['sourceRigAnchors']['Head']);H=np.array(m['sourceRigAnchors']['Head']);# Reference-derived rounded cap shell plus a tapered folded tail. All dimensions
# stay in source-native units; identical local form follows raw Head at every pose.
vertices=[];faces=[];count=20
centre=np.array([H0[0,3],15.75,-1.0]);radius=np.array([1.9,1.6,1.6])
def localworld(p):return (H@np.linalg.inv(H0)@np.r_[p,1])[:3]-np.array(m['capturedTrans'])
for i in range(11):
 theta=np.pi*i/10
 for j in range(count):
  phi=2*np.pi*j/count;p=centre+radius*np.array([np.sin(theta)*np.cos(phi),np.cos(theta),np.sin(theta)*np.sin(phi)]);vertices.append(localworld(p))
for i in range(10):
 for j in range(count):
  a=i*count+j;b=i*count+(j+1)%count;c=(i+1)*count+j;d=(i+1)*count+(j+1)%count;faces.extend([[a,b,d],[a,d,c]])
# Drooping point echoes the NEW concept's long green fold behind the ear.
offset=len(vertices);rings=[(15.35,-2.0,1.10),(14.4,-2.45,.75),(13.25,-2.8,.06)]
for yy,zz,rr in rings:
 for j in range(count):
  angle=2*np.pi*j/count;p=np.array([H0[0,3]+rr*np.cos(angle),yy+rr*.25*np.sin(angle),zz+rr*.45*np.sin(angle)]);vertices.append(localworld(p))
for i in range(len(rings)-1):
 for j in range(count):
  a=offset+i*count+j;b=offset+i*count+(j+1)%count;c=offset+(i+1)*count+j;d=offset+(i+1)*count+(j+1)%count;faces.extend([[a,b,d],[a,d,c]])
spec=importlib.util.spec_from_file_location('dk_raster','tools/dk-native-guide.py');r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r);r.ART_ROOT=tuple(m['artRoot']);r.ART_PIXELS_PER_UNIT=34;r.VIEW_SIDE='negative';w,h=m['artCanvas'];pixels=np.zeros((h,w,4),np.uint8);depth=np.load(str(source)+'-source-depth.npz')['cameraDepthNativeX'].copy();owner=np.zeros((h,w),np.uint16);texture=np.array([[[13,83,7,255]]],np.uint8);v=np.array(vertices);r.rasterize(v,np.array(faces,np.uint32).reshape(-1),np.zeros((len(vertices),2)),texture,pixels,depth,owner,1);visible=pixels[:,:,3]>0;inner=np.asarray(Image.fromarray((visible*255).astype(np.uint8)).filter(ImageFilter.MinFilter(3)))>0;pixels[visible&~inner,:3]=[27,22,14]
# No diffusion or body relocation. Cap alone overlays the captured native depth.
original=np.array(Image.open(base).convert('RGBA'));result=original.copy();result[visible]=pixels[visible];Image.fromarray(result).save(out);maskPath=out.with_name(out.stem+'-cap-layer.png');Image.fromarray(pixels).save(maskPath);sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();record={'state':'Cosmetic cap volume proposal pending actual appearance/occlusion review','sourceGuide':str(source)+'.json','sourceGuideSha256':sha(Path(str(source)+'.json')),'sourceDepth':str(source)+'-source-depth.npz','sourceDepthSha256':sha(Path(str(source)+'-source-depth.npz')),'bodyBase':str(base),'bodyBaseSha256':sha(base),'output':str(out),'outputSha256':sha(out),'capLayer':str(maskPath),'capLayerSha256':sha(maskPath),'referenceConcept':str(O/'identity-concept-v1.png'),'referenceConceptSha256':sha(O/'identity-concept-v1.png'),'form':'Rounded new-reference cap shell with tapered folded tail, dimensions measured against source-neutral anatomy/reference silhouette; transformed by same raw native Head bone. Head-local cosmetic adapter, not sourced native cap geometry.','nativeHeadMatrix':H.tolist(),'verticesNativeBodyRoot':v.tolist(),'faces':faces,'visiblePixels':int(visible.sum()),'outsideCapBodyPixelsChanged':int(np.any(result!=original,axis=2)[~visible].sum()),'receiving':'Cap excluded; no body/foot/grip/kinetics/root registration change.','occlusion':'Native model camera-X depth +same Trans removal, actual sword/shield/head geometry. Target body contours may differ slightly from raw model, requiring actual pilot inspection.'};out.with_suffix('.json').write_text(json.dumps(record,indent=1)+'\n');print(json.dumps({'output':str(out),'visibleCapPixels':int(visible.sum()),'sha256':sha(out)}))
