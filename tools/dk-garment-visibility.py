"""Source-only necktie visibility under the declared approximate art camera."""
from pathlib import Path
import numpy as np,json,argparse
from PIL import Image
from dk_native_pose import DonkeyKongNativePose,MOTIONS,BASE,sha
import ssbh_data_py as ssbh
W,H=1536,1024;ROOT=(512,832);PPU=26

def render(motion,sample,destination):
 pose=DonkeyKongNativePose(MOTIONS/(motion+'.nuanmb'));omitted=sorted(pose.constrained);pose.constrained=set();names=[b.name for b in pose.skeleton.bones];world=pose.matrices(sample,names);bind=pose.matrices(0,names,bind_pose=True);inverse={n:np.linalg.inv(m)for n,m in bind.items()}
 visibility={}
 for group in pose.animation.groups:
  if group.group_type.name=='Visibility':
   for node in group.nodes:v=node.tracks[0].values;visibility[node.name]=v[0 if len(v)==1 else sample]
 mesh=ssbh.mesh_data.read_mesh(str(BASE/'raw-model/fighter/donkey/model/body/c00/model.numshb'));depth=np.full((H,W),np.inf);labels=np.zeros((H,W),np.uint8);tie_points=[]
 for obj in mesh.objects:
  key=obj.name.split('_VIS')[0].split('_O_OBJ')[0]
  if not visibility.get(key,'_VIS'not in obj.name):continue
  p=np.asarray(obj.positions[0].data[:,:3]);h=np.column_stack((p,np.ones(len(p))));posed=np.zeros_like(h);tie_weight=np.zeros(len(p))
  if obj.bone_influences:
   for influence in obj.bone_influences:
    i=np.asarray([v.vertex_index for v in influence.vertex_weights]);w=np.asarray([v.vertex_weight for v in influence.vertex_weights]);posed[i]+=(h[i]@(world[influence.bone_name]@inverse[influence.bone_name]).T)*w[:,None]
    if 'necktie'in influence.bone_name.lower():tie_weight[i]+=w
  elif obj.parent_bone_name:posed=h@world[obj.parent_bone_name].T
  else:raise ValueError('Missing geometry route')
  posed[:,:3]-=world['Trans'][:3,3];selected=tie_weight>.5;tie_points.extend(posed[selected,:3].tolist());screen=np.column_stack((ROOT[0]+posed[:,2]*PPU,ROOT[1]-posed[:,1]*PPU))
  for t in obj.vertex_indices.reshape(-1,3):
   p=screen[t];lo=np.maximum(np.floor(p.min(0)).astype(int),[0,0]);hi=np.minimum(np.ceil(p.max(0)).astype(int),[W-1,H-1])
   if np.any(lo>hi):continue
   a,b,c=p;den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
   if abs(den)<1e-8:continue
   xx,yy=np.meshgrid(np.arange(lo[0],hi[0]+1)+.5,np.arange(lo[1],hi[1]+1)+.5);u=((b[1]-c[1])*(xx-c[0])+(c[0]-b[0])*(yy-c[1]))/den;v=((c[1]-a[1])*(xx-c[0])+(a[0]-c[0])*(yy-c[1]))/den;weights=np.stack((u,v,1-u-v),-1);z=weights@posed[t,0];sl=np.s_[lo[1]:hi[1]+1,lo[0]:hi[0]+1];cover=(weights.min(-1)>=-1e-6)&(z<depth[sl]);depth[sl][cover]=z[cover];tie=weights@tie_weight[t];labels[sl][cover]=(tie[cover]>.5).astype(np.uint8)+1
 visible=labels==2;ys,xs=np.where(visible);Image.fromarray((visible*255).astype(np.uint8)).save(str(destination)+'-mask.png')
 a={'state':'source-only garment visibility diagnostic, not delivered art','motion':pose.provenance(),'nativeSample':sample,'root':list(ROOT),'pixelsPerNative':PPU,'camera':'orthographic negative nativeX closer, same declared DK guide','omittedConstraints':omitted,'raster':'all selected visible mesh triangles opaque; ignores material alpha/lighting, sufficient conservative garment occlusion diagnostic for captured opaque skin','tieVertexOwnership':'sum captured Necktie and S_Necktie influences>.5','tieVertexCount':len(tie_points),'visibleTiePixelCount':int(visible.sum()),'visibleTieBounds':None if not len(xs)else[int(xs.min()),int(ys.min()),int(xs.max()),int(ys.max())],'maskSha256':sha(Path(str(destination)+'-mask.png')),'toolSha256':sha(Path(__file__)),'directRGBDelivery':False,'receivingPolicy':'neckcloth cosmetic, not native body hurt_data'}
 Path(str(destination)+'.json').write_text(json.dumps(a,indent=2)+'\n');print(json.dumps({k:a[k]for k in ['nativeSample','tieVertexCount','visibleTiePixelCount','visibleTieBounds']}))
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('motion');p.add_argument('sample',type=int);p.add_argument('destination',type=Path);a=p.parse_args();render(a.motion,a.sample,a.destination)
