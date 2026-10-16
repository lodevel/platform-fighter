"""Versioned Final physical guides: explicit DK cosmetic Hair exclusion.

Original whole-reference raster remains unchanged. Only independent physical
part passes use the existing compiled raster; their pixels must qualify against
the original Python part pass before corpus propagation. No source/game parity.
"""
from pathlib import Path
import types,hashlib,json
import numpy as np
from PIL import Image
from link_author_raster_v2 import rasterize_uv
BASE_OPERATOR=Path('tools/final_target_part_projection_v1.py')
_modules={}
def project(actor,motion,sample,destination,*,compiled=False):
 code=BASE_OPERATOR.read_text()
 # Explicit owner before ancestry, not colour or global Head-weight minY.
 code=code.replace("if 'Necktie' in name:return 0", "if 'Necktie' in name or name in ['S_Hair1','S_Hair2']:return 0")
 old="rasterize(verts,selected.reshape(-1),uv,tex,physical_pixels,physical_depth,physical_face,False,eye,transform)"
 new="compiled_physical(verts,selected.reshape(-1),uv,tex,physical_pixels,physical_depth,physical_face,eye,transform,art_root=ART_ROOT,ppu=ART_PIXELS_PER_UNIT,view_side=VIEW_SIDE)"
 if compiled:
  # This string is emitted into the private actor guide by V1; the whole-body
  # reference rendering and native helper omissions are preserved unchanged.
  assert old in code;code=code.replace(old,new)
  code=code.replace("insert=insert.replace('"+old+"','rasterize(verts,selected.reshape(-1),uv,tex,physical_pixels,physical_depth,physical_face,False)')", "insert=insert.replace('"+new+"','compiled_physical(verts,selected.reshape(-1),uv,tex,physical_pixels,physical_depth,physical_face,None,None,art_root=ART_ROOT,ppu=ART_PIXELS_PER_UNIT,view_side=VIEW_SIDE)')")
  code=code.replace("m=types.ModuleType('privateFrozenFinalTargetPart');m.__file__=str(guide);", "m=types.ModuleType('privateFrozenFinalTargetPart');m.__file__=str(guide);m.compiled_physical=compiled_physical;")
 key=(actor,compiled)
 if key not in _modules:
  mod=types.ModuleType('privateFinalTargetProjectionV2');mod.__file__=str(BASE_OPERATOR)
  def compiled_physical(v,i,u,t,p,d,f,eye,transform,*,art_root,ppu,view_side):
   owners=np.zeros(f.shape,np.uint16)
   rasterize_uv(v,i,u,t,p,d,owners,1,eye,transform,art_root=art_root,ppu=ppu,view_side=view_side)
   f[:]=owners>0
  mod.compiled_physical=compiled_physical;exec(compile(code,str(BASE_OPERATOR),'exec'),mod.__dict__);_modules[key]=mod
 record=_modules[key].project(actor,motion,sample,destination)
 record['operator']=__file__;record['operatorSha256']=hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
 record['originalSourceProjectionOperatorSha256']=hashlib.sha256(BASE_OPERATOR.read_bytes()).hexdigest()
 record['privateVersionedOperatorCodeSha256']=hashlib.sha256(code.encode()).hexdigest()
 record['cosmeticOwnerExclusions']=['Necktie','S_Hair1','S_Hair2']
 record['physicalBackend']='UNQUALIFIED_PRIVATE_COMPILED_TRIAL'if compiled else'exact-original-python-raster-hair-exclusion'
 record['policy']+=' Explicit actualS_Hair1/2 cosmeticowners excluded beforeancestry; actual anatomical Pika ears/tail retained as target receiving guides, without native capsule/vulnerability parity. Cranial FOOTSTOOL contact requires independent actor-specific scalp recipe, not global Head mask minY.'
 Path(str(destination)+'-part-projection.json').write_text(json.dumps(record,indent=2)+'\n')
 return record
