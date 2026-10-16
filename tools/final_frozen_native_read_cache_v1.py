"""Memoize only pinned immutable native parsed inputs inside this private process."""
from pathlib import Path
import sys,os
sys.path.insert(0,'/tmp/pikachu-source-libs')
import ssbh_data_py as ssbh
def install(expected):
 keys={os.path.normpath(os.path.abspath(p)).replace('/mnt/c/Workspace/','/mnt/c/workspace/')for p in expected};cache={};hits={}
 for module,name in [(ssbh.mesh_data,'read_mesh'),(ssbh.matl_data,'read_matl'),(ssbh.modl_data,'read_modl'),(ssbh.skel_data,'read_skel'),(ssbh.hlpb_data,'read_hlpb'),(ssbh.anim_data,'read_anim')]:
  original=getattr(module,name)
  def reader(path,original=original,name=name):
   key=os.path.normpath(os.path.abspath(path)).replace('/mnt/c/Workspace/','/mnt/c/workspace/')
   if key not in keys:raise ValueError('Unpinned native input read: '+key)
   ck=(name,key)
   if ck not in cache:cache[ck]=original(path)
   else:hits[name]=hits.get(name,0)+1
   return cache[ck]
  setattr(module,name,reader)
 return cache,hits
