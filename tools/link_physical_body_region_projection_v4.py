"""Part-owned clothed target body surfaces before other part/gear occlusion.

Authored receiving guides, not recovered native hurtboxes. Face/cranium uses a
separate reviewed recipe. Gear, hair, cap and dangling costume bones excluded.
"""
from pathlib import Path
import sys,types,json,hashlib
sys.path[:0]=['/tmp/pikachu-source-libs','tools']
GUIDE=Path('tools/link-authored-guide.py')
_MODULE=None
_IMAGE_CACHE={}
class _PrivateImageProxy:
 def __getattr__(self,name):return getattr(_PIL_IMAGE,name)
 def open(self,path,*args,**kwargs):
  key=str(path)
  if key not in _IMAGE_CACHE:_IMAGE_CACHE[key]=_PIL_IMAGE.open(path,*args,**kwargs).copy()
  return _IMAGE_CACHE[key].copy()
from PIL import Image as _PIL_IMAGE
REGIONS={1:'torso',2:'neck',3:'upper-arm-L',4:'forearm-L',5:'palm-L',6:'upper-arm-R',7:'forearm-R',8:'palm-R',9:'thigh-L',10:'shin-L',11:'foot-L',12:'thigh-R',13:'shin-R',14:'foot-R'}
def project(source_metadata,destination):
 global _MODULE
 m=json.load(open(source_metadata));code=GUIDE.read_text()
 classify='''
def physical_region(name):
 if name in ['Hip','Waist','Bust','ClavicleL','ClavicleR']:return 1
 if name=='Neck':return 2
 for side,offset in [('L',0),('R',3)]:
  if name=='Shoulder'+side:return 3+offset
  if name=='Arm'+side:return 4+offset
  if name=='Hand'+side or name.startswith('Finger'+side):return 5+offset
 for side,offset in [('L',0),('R',3)]:
  if name=='Leg'+side:return 9+offset
  if name=='Knee'+side:return 10+offset
  if name in ['Foot'+side,'Toe'+side]:return 11+offset
 return 0
'''
 code=classify+code
 code=code.replace("captureUV=os.environ.get('LINK_AUTHOR_UV_MAP')=='1'","captureUV=False")
 # Only redundant review products are omitted; all per-part masks and pose
 # provenance remain emitted. Original reference/target banks stay immutable.
 for text in ["Image.fromarray(objectRegions).save(str(destination)+'-object-ids.png')","Image.fromarray(regions).save(str(destination)+'-material-ids.png')","Image.fromarray(pixels).save(str(destination)+'-source.png');","silhouette.save(str(destination)+'-silhouette.png');","view.save(str(destination)+'-source-joints.png');"]:
  code=code.replace(text,'')
 code=code.replace("np.savez_compressed(str(destination)+'-source-depth.npz',cameraDepthNativeX=depth)",'')
 code=code.replace("  pending.append((posed[:,:3],obj.vertex_indices,obj.texture_coordinates[0].data", "  sourceTriangles=np.asarray(obj.vertex_indices).reshape(-1,3);vertexRegions=np.array([physical_region(n)for n in dominant],np.uint16);triangleRegions=np.zeros(len(sourceTriangles),np.uint16)\n  for rr in range(1,15):triangleRegions[np.sum(vertexRegions[sourceTriangles]==rr,axis=1)>=2]=rr\n  if mat not in ['skin_link_001','def_link_001']:triangleRegions[:]=0\n  pending.append((posed[:,:3],obj.vertex_indices,obj.texture_coordinates[0].data")
 start=code.index("  triangles=np.asarray(obj.vertex_indices).reshape(-1,3);roles=")
 end=code.index('  semanticPending.append',start)
 code=code[:start]+"  triangles=sourceTriangles;roles=triangleRegions\n"+code[end:]
 old=" lo=np.min(np.array([r['boundsNative'][0]for r in rendered]),axis=0);hi=np.max(np.array([r['boundsNative'][1]for r in rendered]),axis=0);ART_ROOT=(max(512,int(math.ceil(-lo[2]*PPU+48))),max(850,int(math.ceil(hi[1]*PPU+48))));SIZE=(int(math.ceil(max(1024,ART_ROOT[0]+hi[2]*PPU+48)/64)*64),int(math.ceil(max(1024,ART_ROOT[1]-lo[1]*PPU+48)/64)*64));raster.ART_ROOT=ART_ROOT"
 assert old in code;code=code.replace(old," ART_ROOT=FROZEN_ART_ROOT;SIZE=FROZEN_ART_CANVAS;raster.ART_ROOT=ART_ROOT")
 # Each part has its own depth buffer, restoring genuinely known physical tissue
 # behind other limbs/shield/equipment without inventing visible alpha contours.
 insertion=''' for rr in range(1,15):
  regionMask=np.zeros(SIZE[::-1],np.uint16);regionDepth=np.full(SIZE[::-1],np.inf);regionPixels=np.zeros_like(pixels)
  for ((verts,indices,uv,tex,mat,pupil,transform),roles) in semanticPending:
   triangles=np.asarray(indices).reshape(-1,3);selected=triangles[roles==rr]
   if len(selected):raster.rasterize(verts,selected.reshape(-1),uv,tex,regionPixels,regionDepth,regionMask,rr,pupil,transform)
  Image.fromarray((regionMask>0).astype('uint8')*255).save(str(destination)+'-physical-region-'+str(rr)+'.png')
'''
 point=" Image.fromarray(semanticRegions).save(str(destination)+'-semantic-ids.png')";assert point in code;code=code.replace(point,insertion)
 if _MODULE is None:
  _MODULE=types.ModuleType('privatePhysicalBodyProjectionCompiledCached');_MODULE.__file__=str(GUIDE);exec(compile(code,str(GUIDE),'exec'),_MODULE.__dict__)
  from link_author_raster_v2 import install_on_guide
  install_on_guide(_MODULE);_MODULE.Image=_PrivateImageProxy()
 mod=_MODULE;mod.FROZEN_ART_ROOT=tuple(m['artRoot']);mod.FROZEN_ART_CANVAS=tuple(m['artCanvas'])
 mod.render(Path(m['motion']['path']).stem,m['nativeFrameIndex'],destination,Path('docs/review/2026-10-12/link-character/rework/art/uv-atlas-pilot/fresh-target-atlas-v4'))
 result={'sourceRecord':str(source_metadata),'sourceRecordSha256':hashlib.sha256(Path(source_metadata).read_bytes()).hexdigest(),'regions':REGIONS,'privateCodeSha256':hashlib.sha256(code.encode()).hexdigest(),'policy':'Exact target source mesh skin/clothing triangles with >=2/3 dominant vertices in reviewed anatomical bone part. Each physical part projects with self depth only; gear/hair/cap/dangling sleeves and shirttails excluded. Clothed body surface is an authored target receiving guide; no native victim capsule parity. Source helper-preview/pose limitations unchanged.','allKnownBodyBeforeNonPartOcclusion':True,'backend':'Versioned compiled CPU raster with persistent private module and immutable per-worker decoded texture/parsed source caches; source per-pose mutable buffers remain allocated fresh','compiledKernelSha256':hashlib.sha256(Path('.tmp/link-author-raster-v2.so').read_bytes()).hexdigest()}
 Path(str(destination)+'-physical-region-provenance.json').write_text(json.dumps(result,indent=2)+'\n');return result
