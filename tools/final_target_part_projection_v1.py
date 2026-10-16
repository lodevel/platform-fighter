"""Known target mesh surfaces from the frozen Final art rig, not native hurtboxes.

The existing explicit raw-FK helper omission is inherited unchanged. Per-part
depth restores this actual retargeted mesh behind other anatomy/cloth. Strict
native source exports retain their separate guard laws.
"""
from pathlib import Path
import sys,types,json,hashlib
import numpy as np
from PIL import Image
sys.path[:0]=['/tmp/pikachu-source-libs','tools']
A=Path('docs/review/2026-10-12/link-character/rework/art');B=A/'dk-pikachu-full-final-toon-bank-v1'
REGIONS={1:'torso',2:'neck',3:'upper-arm-L',4:'forearm-L',5:'palm-L',6:'upper-arm-R',7:'forearm-R',8:'palm-R',9:'thigh-L',10:'shin-L',11:'foot-L',12:'thigh-R',13:'shin-R',14:'foot-R',15:'head-face',16:'tail'}
_MODULES={}
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def project(actor,motion,sample,destination):
 guide=B/(actor+'-private-padded-guide.py');code=guide.read_text()
 injected='''
def physical_roles(obj,pose):
 names=[b.name for b in pose.skeleton.bones];parents={b.name:names[b.parent_index] if b.parent_index is not None else None for b in pose.skeleton.bones}
 def region(name):
  seen=set()
  while name is not None and name not in seen:
   seen.add(name)
   if 'Necktie' in name:return 0
   if name in ['Head','Jaw','Tongue'] or name.startswith(('Eye','Ear')):return 15
   if 'Tail' in name:return 16
   if name=='Neck':return 2
   for side,off in [('L',0),('R',3)]:
    if name=='Shoulder'+side:return 3+off
    if name=='Arm'+side:return 4+off
    if name=='Hand'+side or name.startswith('Finger'+side):return 5+off
    if name=='Leg'+side:return 9+off
    if name=='Knee'+side:return 10+off
    if name=='Foot'+side or name.startswith('Toe'+side):return 11+off
   if name in ['Hip','Waist','Bust','ClavicleL','ClavicleR']:return 1
   name=parents.get(name)
  return 0
 count=len(obj.positions[0].data);weights=np.zeros(count);dominant=np.full(count,'',object);cloth=np.zeros(count)
 for influence in obj.bone_influences:
  for v in influence.vertex_weights:
   if v.vertex_weight>weights[v.vertex_index]:weights[v.vertex_index]=v.vertex_weight;dominant[v.vertex_index]=influence.bone_name
   if 'Necktie' in influence.bone_name:cloth[v.vertex_index]+=v.vertex_weight
 if not obj.bone_influences:dominant[:]=obj.parent_bone_name
 vertex=np.array([region(n)for n in dominant]);vertex[cloth>0]=0;triangles=np.asarray(obj.vertex_indices).reshape(-1,3);roles=np.zeros(len(triangles),np.uint8)
 for rr in range(1,17):roles[np.sum(vertex[triangles]==rr,axis=1)>=2]=rr
 # Any actual cloth-owned vertex excludes this triangle from anatomy; no RGB test.
 roles[np.any(cloth[triangles]>0,axis=1)]=0
 return roles
'''
 code=injected+code
 code=code.replace('    queued = []','    queued = []\n    physical_queue = []')
 at='        rendered.append('
 insert="        physical_queue.append((posed[:,:3].copy(),np.asarray(obj.vertex_indices).copy(),np.asarray(obj.texture_coordinates[0].data).copy(),textures[texture_name],physical_roles(obj,pose),pupil if material_name in ['EyeL','EyeR'] else None,eye_uvs.get(material_name,[1,1,0,0])))\n" if actor=='donkeykong' else "        physical_queue.append((posed[:,:3].copy(),np.asarray(obj.vertex_indices).copy(),np.asarray(obj.texture_coordinates[0].data).copy(),textures[texture_name],physical_roles(obj,pose),None,None))\n"
 assert at in code;code=code.replace(at,insert+at)
 at='    native = Image.fromarray(pixels)'
 insert='''    for rr in range(1,17):
        physical_pixels=np.zeros((SIZE[1],SIZE[0],4),np.uint8);physical_depth=np.full((SIZE[1],SIZE[0]),np.inf);physical_face=np.zeros((SIZE[1],SIZE[0]),bool)
        for verts,indices,uv,tex,roles,eye,transform in physical_queue:
            selected=np.asarray(indices).reshape(-1,3)[roles==rr]
            if not len(selected):continue
            PART_CLASSES=np.zeros(len(selected),np.uint8);PART_PIXELS=np.zeros((SIZE[1],SIZE[0]),np.uint8)
            rasterize(verts,selected.reshape(-1),uv,tex,physical_pixels,physical_depth,physical_face,False,eye,transform)
        Image.fromarray(physical_pixels[:,:,3]).save(str(destination)+'-physical-region-'+str(rr)+'.png')
'''
 if actor=='pikachu':insert=insert.replace('rasterize(verts,selected.reshape(-1),uv,tex,physical_pixels,physical_depth,physical_face,False,eye,transform)','rasterize(verts,selected.reshape(-1),uv,tex,physical_pixels,physical_depth,physical_face,False)')
 assert at in code;code=code.replace(at,insert+at)
 if actor not in _MODULES:
  m=types.ModuleType('privateFrozenFinalTargetPart');m.__file__=str(guide);exec(compile(code,str(guide),'exec'),m.__dict__);_MODULES[actor]=m
 m=_MODULES[actor];m.ROOT_REGISTRATION='remove-trans-translation';m.ART_PIXELS_PER_UNIT=26. if actor=='donkeykong'else 300/7;destination=Path(destination);destination.parent.mkdir(parents=True,exist_ok=True);m.render(motion,sample,destination)
 metadata=json.load(open(str(destination)+'.json'))
 record={'actor':actor,'motion':motion,'nativeSample':sample,'coordinateOrigin':'actorSourceRoot','sourceGuide':str(guide),'sourceGuideSha256':sha(guide),'operator':__file__,'operatorSha256':sha(__file__),'privateInjectedCodeSha256':hashlib.sha256(code.encode()).hexdigest(),'root':metadata['root'],'canvas':metadata['canvas'],'artPixelsPerNativeUnit':metadata['art_pixels_per_native_unit'],'regions':REGIONS,'actualPartOwnedMaskPixels':{name:int((np.array(Image.open(str(destination)+'-physical-region-'+str(rr)+'.png'))>0).sum())for rr,name in REGIONS.items()},'policy':'Exact frozen target art raw-FK mesh/skin/texture sampling unchanged. Dominant actual weights plus bone ancestry select physical triangle when2/3 vertices agree; any actual positive Necktie owner excludes cloth. Each selected anatomical part self-depth restores known target tissue behind other parts. Tail/ears are explicit proposed anatomical ownership, not native hurtbox coverage. Cranial contact/support/capsule/outgoing/pocket fitting remains pending.','helperPolicy':'Inherits explicit frozen authored RAW_FK helper omission; not a strict native collision matrix export or native pose parity. Source strict joint references stay independent.','gameChecksRun':False}
 Path(str(destination)+'-part-projection.json').write_text(json.dumps(record,indent=2)+'\n');return record
