"""Read only exact byte-verified Linux copies, retaining original source names.

Original workspace guards explicitly use the saved unredirected IO function.
No unlisted file, output, pose buffer or numerical operation is redirected.
"""
import os,json,io,builtins,importlib.machinery,hashlib,time
from pathlib import Path
ORIGINAL_IO_OPEN=io.open
ORIGINAL_BUILTIN_OPEN=builtins.open
ORIGINAL_LOADER_READ=importlib.machinery.SourceFileLoader.get_data
def key(path):
 return os.path.normpath(os.path.abspath(os.fspath(path))).replace('/mnt/c/Workspace/','/mnt/c/workspace/')
with ORIGINAL_IO_OPEN(os.environ['LINK_PINNED_INPUT_MAP'],'r') as file:
 MAP=json.load(file)['mapping']
def destination(path,mode):
 if isinstance(path,(str,bytes,os.PathLike)) and not any(c in mode for c in 'wax+'):
  return MAP.get(key(path),path)
 return path
def io_open(file,mode='r',*args,**kwargs):return ORIGINAL_IO_OPEN(destination(file,mode),mode,*args,**kwargs)
def builtin_open(file,mode='r',*args,**kwargs):return ORIGINAL_BUILTIN_OPEN(destination(file,mode),mode,*args,**kwargs)
io.open=io_open
builtins.open=builtin_open
def loader_read(self,path):return ORIGINAL_LOADER_READ(self,MAP.get(key(path),path))
importlib.machinery.SourceFileLoader.get_data=loader_read
def redirect_ssbh(ssbh):
 for namespace,method in [(ssbh.skel_data,'read_skel'),(ssbh.anim_data,'read_anim'),(ssbh.hlpb_data,'read_hlpb'),(ssbh.matl_data,'read_matl'),(ssbh.modl_data,'read_modl'),(ssbh.mesh_data,'read_mesh')]:
  original=getattr(namespace,method)
  def read(path,_original=original):return _original(MAP.get(key(path),path))
  setattr(namespace,method,read)
def verify_original_inputs(expected):
 for path,digest in expected.items():
  for attempt in range(12):
   try:
    actual=hashlib.sha256()
    with ORIGINAL_IO_OPEN(path,'rb') as file:
     for block in iter(lambda:file.read(65536),b''):actual.update(block)
    if actual.hexdigest()!=digest:raise ValueError('Original pinned source changed: '+path)
    break
   except OSError as error:
    if error.errno!=12 or attempt==11:raise
    time.sleep(min(2,.25*(attempt+1)))
