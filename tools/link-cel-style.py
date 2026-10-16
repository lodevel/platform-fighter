"""Bounded fresh atlas target style proposal; no full-pack/native renderer claim."""
from pathlib import Path
import sys,json,hashlib,subprocess
import numpy as np
from PIL import Image,ImageFilter,ImageDraw
O=Path('docs/review/2026-10-12/link-character/rework/art');A=O/'uv-atlas-pilot';src=Path(sys.argv[1]);outputPath=Path(sys.argv[2]);meta=json.load(open(str(src)+'.json'));im=Image.open(str(src)+'-source.png').convert('RGBA');a=np.array(im);owners=np.array(Image.open(str(src)+'-object-ids.png'));sem=np.array(Image.open(str(src)+'-semantic-ids.png'));protected=np.isin(sem,[101,102,103])
for oid,row in meta['objectIds'].items():
 if any(row['mesh'].startswith(n)for n in ['link_ken','link_tate','link_sayatuka'])or row.get('role')=='sourceBowArticle':protected|=owners==int(oid)
# Deterministic cleanup uses actual source body material/ownership. Palette
# derives from accepted fresh pilots; no old Link appearance used.
base=np.array(Image.fromarray(a[:,:,:3]).filter(ImageFilter.MedianFilter(1)));palette=np.array([[62,150,52],[43,111,40],[83,169,67],[246,204,153],[222,167,120],[248,229,171],[221,195,138],[125,65,21],[96,46,18],[255,224,59],[219,176,39],[27,22,14],[197,218,229],[251,237,191]],float);body=(a[:,:,3]>0)&~protected&~np.isin(owners,[9,10]);flat=base[body].astype(float);dist=np.sum((flat[:,None,:]-palette[None,:,:])**2,axis=2);a[body,:3]=palette[np.argmin(dist,axis=1)].astype(np.uint8)
# Source-bone quiver/Slate palette is now authored in the SAME renderer pass.
# Intrinsic metal equipment uses the exact reviewed UV texture. Controlled ink.
inside=np.array(Image.fromarray((protected*255).astype(np.uint8)).filter(ImageFilter.MinFilter(3)))>0;a[protected&~inside,:3]=[27,22,14]
# Authored two-tone surface shading from SAME source geometry camera depth.
# This is a target cel shader, not a recovered native lighting/material pass.
depth=np.load(str(src)+'-source-depth.npz')['cameraDepthNativeX'];gx=np.zeros(depth.shape);gy=np.zeros(depth.shape);occlusion=np.zeros(depth.shape,bool)
for axis,out in [(1,gx),(0,gy)]:
 other=np.roll(depth,1,axis=axis);finite=np.isfinite(depth)&np.isfinite(other);np.subtract(depth,other,out=out,where=finite);occlusion|=finite&(np.abs(out)>.38);out[~finite]=0
shadow=(gx*.35+gy*.55)>.16;shadeBody=body&shadow;rgb=a[shadeBody,:3].astype(float);a[shadeBody,:3]=np.clip(rgb*np.array([.84,.86,.85]),0,255).astype(np.uint8)
# Anatomical garment boundaries are authored from the same mesh/UV sample.
# They produce consistent cuff/hem/boot ink, independent of noisy RGB pixels.
uvPrefix=src;uvMeta=json.load(open(str(uvPrefix)+'.json'));uvData=np.load(str(uvPrefix)+'-uv-correspondence.npz');classes=np.zeros(body.shape,np.uint8)
if uvMeta['motion']['sha256']!=meta['motion']['sha256'] or uvMeta['nativeFrameIndex']!=meta['nativeFrameIndex'] or uvMeta['artRoot']!=meta['artRoot']:raise ValueError('Semantic boundary UV/sample mismatch')
for name,tid in uvMeta['uvAuthoringCorrespondence']['textureIds'].items():
 cp=A/'fresh-target-atlas-v4'/(name+'-authored-semantic-classes.png')
 if not cp.exists():continue
 ca=np.array(Image.open(cp));yy,xx=np.where(body&(uvData['textureId']==tid));coords=uvData['uv'][yy,xx];tx=np.floor(np.mod(coords[:,0],1)*ca.shape[1]).astype(int);ty=np.floor(np.mod(coords[:,1],1)*ca.shape[0]).astype(int);classes[yy,xx]=ca[ty,tx]
boundary=np.zeros(body.shape,bool)
for axis in [0,1]:
 other=np.roll(classes,1,axis=axis);boundary|=(classes>0)&(other>0)&(classes!=other)
boundary[0,:]=False;boundary[:,0]=False;a[boundary&body,:3]=[27,22,14]

# Body silhouette and real depth occlusion seams get controlled 2D ink.
alpha=Image.fromarray(a[:,:,3]);outer=alpha.filter(ImageFilter.MaxFilter(7));canvas=Image.new('RGBA',im.size,(27,22,14,0));canvas.putalpha(outer);edge=occlusion&body;edge[0,:]=False;edge[:,0]=False;a[edge,:3]=[27,22,14];canvas.alpha_composite(Image.fromarray(a));out=outputPath;out.parent.mkdir(parents=True,exist_ok=True);pre=out.with_name(out.stem+'-pre-cap.png');canvas.save(pre)
# The authored cap volume follows the Head bone; an article-only guide (no body) has none.
if 'Head' in meta.get('sourceRigAnchors',{}):subprocess.run(['python3',str('tools/link-cap-volume.py'),src.name,str(src),str(pre),str(out)],check=True)
else:canvas.save(out)
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
record={'state':'AUTHORED_FRESH_TARGET_PRODUCTION_CELL_PENDING_PER_RESOURCE_VISUAL_PAIRED_GEOMETRY_AND_END_RUNTIME_ACCEPTANCE','target':str(out),'targetSHA':sha(out),'sourceRender':str(src)+'.json','sourceRenderSHA':sha(Path(str(src)+'.json')),'nativeSample':meta['nativeFrameIndex'],'rawArtRoot':meta['artRoot'],'scaleToWorld':5/34,'bodyCentreFromRootY':-36,'equipmentStateCorrection':'Held and stowed source object prefixes protected equally: link_ken+link_kenb, link_tate+link_tateb. No body palette applied to their actual source-owned surface. Earlier partial-prefix artifacts retained historical.','appearanceRoute':'Atlas-v4/cel-v3 statically reviewed fresh appearance; source-part clothing/skin/glove palette, controlled garment-boundary/silhouette ink, separate reviewed equipment and cap-v2 volume.','rootRegistration':'In-place raw preview; per-target anatomical sole support and packed sampling retarget exported uniformly later.','artistCode':str(Path(__file__)),'artistCodeSHA':sha(Path(__file__)),'sourceLimits':meta['nativeShaderLimits'],'nativeSourceMotion':meta['motion'],'oldLinkSpritesUsed':False};out.with_name(out.stem+'-authoring.json').write_text(json.dumps(record,indent=1)+'\n');print(json.dumps({'cell':str(out),'SHA':sha(out)}))
