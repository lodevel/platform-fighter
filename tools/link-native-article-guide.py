"""CPU source article guide on actor-root body viewport, no common-engine claim."""
from pathlib import Path
import sys,json,hashlib,importlib.util
import numpy as np
from PIL import Image
from link_native_pose import LinkNativePose,BASE,sha
import ssbh_data_py as ssbh

def article_pose(article,motion):
 folder=BASE/'extracted/fighter/link/model'/article/'c00';path=BASE/'extracted/fighter/link/motion'/article/'c00'/(motion+'.nuanmb');pose=LinkNativePose.__new__(LinkNativePose);pose.motion_path=path;pose.skeleton=ssbh.skel_data.read_skel(str(folder/'model.nusktb'));pose.animation=ssbh.anim_data.read_anim(str(path));helper=ssbh.hlpb_data.read_hlpb(str(folder/'model.nuhlpb'));pose.constrained={c.target_bone_name.lower()for c in helper.orient_constraints};pose.constrained.update(c.target_bone_name1.lower()for c in helper.aim_constraints);pose.bones={b.name.lower():i for i,b in enumerate(pose.skeleton.bones)};pose.tracks={};pose.resource_role='SOURCE_ARTICLE';pose.track_binding_policy=None;pose.ignored_unbound_channels=[]
 if len(pose.bones)!=len(pose.skeleton.bones):raise ValueError('Ambiguous article skeleton names')
 for group in pose.animation.groups:
  if group.group_type.name!='Transform':continue
  for node in group.nodes:
   name=node.name.lower()
   if name not in pose.bones or len(node.tracks)!=1 or name in pose.tracks:raise ValueError('Unresolved article transform track '+node.name)
   pose.tracks[name]=node.tracks[0]
 return pose

def render(article,motion,frame,body_prefix,out,authored_textures=None):
 if article!='bow':raise ValueError('Only Bow actor-root placement has independently reviewed source crossread; another article needs separate policy first')
 body_prefix=Path(body_prefix);out=Path(out);body=json.load(open(str(body_prefix)+'.json'));folder=BASE/'extracted/fighter/link/model'/article/'c00';pose=article_pose(article,motion);names=[b.name for b in pose.skeleton.bones];world=pose.matrices(frame,names);bind=pose.matrices(0,names,bind_pose=True);inv={n:np.linalg.inv(m)for n,m in bind.items()};material=ssbh.matl_data.read_matl(str(folder/'model.numatb'));model=ssbh.modl_data.read_modl(str(folder/'model.numdlb'));materials={m.material_label:{t.param_id.name:t.data for t in m.textures}for m in material.entries};mapping={(m.mesh_object_name,m.mesh_object_subindex):m.material_label for m in model.entries};textureFolder=BASE/'decoded-c00'/article;textures={p.stem:np.array(Image.open(p).convert('RGBA'))for p in textureFolder.glob('*.png')}
 if authored_textures:
  for p in Path(authored_textures).glob('*_col.png'):textures[p.stem]=np.array(Image.open(p).convert('RGBA'))
 mesh=ssbh.mesh_data.read_mesh(str(folder/'model.numshb'));pending=[];objects=[]
 for obj in mesh.objects:
  mat=mapping[(obj.name,obj.subindex)];tex=materials[mat].get('Texture0')
  if tex not in textures:raise ValueError('Article texture missing '+mat+'/'+str(tex))
  points=np.array(obj.positions[0].data)[:,:3];hom=np.column_stack([points,np.ones(len(points))]);posed=np.zeros_like(hom);weightsTotal=np.zeros(len(points))
  if obj.bone_influences:
   for influence in obj.bone_influences:
    indices=np.array([w.vertex_index for w in influence.vertex_weights]);weights=np.array([w.vertex_weight for w in influence.vertex_weights]);posed[indices]+=(hom[indices]@(world[influence.bone_name]@inv[influence.bone_name]).T)*weights[:,None];weightsTotal[indices]+=weights
   if np.max(abs(weightsTotal-1))>.0001:raise ValueError('Unnormalized article skin weights')
  elif obj.parent_bone_name:posed=hom@world[obj.parent_bone_name].T
  else:raise ValueError('No source article mesh placement')
  # Animated Bow Have is already actor-Trans-relative; no body HaveL parenting
  # or body Trans subtraction is added to this article placement.
  pending.append((posed[:,:3],obj.vertex_indices,obj.texture_coordinates[0].data,textures[tex]));objects.append({'mesh':obj.name,'subindex':obj.subindex,'material':mat,'texture':tex,'nativeBounds':[posed[:,:3].min(axis=0).tolist(),posed[:,:3].max(axis=0).tolist()]})
 spec=importlib.util.spec_from_file_location('raster','tools/dk-native-guide.py');r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r);r.ART_ROOT=tuple(body['artRoot']);r.ART_PIXELS_PER_UNIT=34;r.VIEW_SIDE='negative';pixels=np.array(Image.open(str(body_prefix)+'-source.png').convert('RGBA'));depth=np.load(str(body_prefix)+'-source-depth.npz')['cameraDepthNativeX'].copy();regions=np.array(Image.open(str(body_prefix)+'-object-ids.png'));start=max(int(k)for k in body['objectIds'])+1;newids={}
 for i,(verts,indices,uv,texture)in enumerate(pending,start):
  xs=body['artRoot'][0]+verts[:,2]*34;ys=body['artRoot'][1]-verts[:,1]*34
  if min(xs)<2 or min(ys)<2 or max(xs)>pixels.shape[1]-3 or max(ys)>pixels.shape[0]-3:raise ValueError('Article exceeds body viewport; jointly repad root/canvas, never clip or shrink')
  r.rasterize(verts,indices,uv,texture,pixels,depth,regions,i);newids[str(i)]={**objects[i-start],'role':'sourceBowArticle'}
 out.parent.mkdir(parents=True,exist_ok=True);Image.fromarray(pixels).save(str(out)+'-source.png');Image.fromarray(regions).save(str(out)+'-object-ids.png');np.savez_compressed(str(out)+'-source-depth.npz',cameraDepthNativeX=depth)
 # Preserve actual body material/semantic masks, marking the new article region.
 for suffix in ['material-ids','semantic-ids']:
  mask=np.array(Image.open(str(body_prefix)+'-'+suffix+'.png'));mask[regions>=start]=103;Image.fromarray(mask).save(str(out)+'-'+suffix+'.png')
 meta={**body,'objectIds':{**body['objectIds'],**newids},'sourceBodyPrefix':str(body_prefix),'sourceBodyRecordSHA':sha(Path(str(body_prefix)+'.json')),'sourceArticle':{'article':article,'motion':{'path':str(pose.motion_path),'sha256':sha(pose.motion_path)},'modelInputHashes':{f.name:sha(f)for f in folder.iterdir()if f.is_file()and f.suffix in ['.nusktb','.nuhlpb','.numshb','.numdlb','.numatb']},'rawMatrices':{n:m.tolist()for n,m in world.items()},'sourcePlacementPolicy':'Bow animated Have already actor-Trans-relative, independently matches body HaveL. Render article own rig once on SAME actor source root. No extra HaveL multiply or Trans subtraction.','rootCrossread':'docs/review/2026-10-12/link-character/rework/source-contracts/bow-pilot-root-crossread.json','clockPolicy':'Paired same raw native17 source-guide pilot only; gameplay article/body status synchronization is a separate adapter/native consumer gap','authoredTextureDirectory':str(authored_textures)if authored_textures else None,'authoredTextureHashes':{p.name:sha(p)for p in Path(authored_textures).glob('*_col.png')}if authored_textures else None,'helperPolicy':'Unchanged strict matrix method; no article constraint/scale guard disabled'},'state':'Combined body+source Bow guide only; no target art, common attachment or gameplay acceptance'};Path(str(out)+'.json').write_text(json.dumps(meta,indent=1)+'\n');print(json.dumps({'guide':str(out),'articleMeshes':len(objects),'nativeSample':frame}))
if __name__=='__main__':render(sys.argv[1],sys.argv[2],int(sys.argv[3]),sys.argv[4],sys.argv[5],sys.argv[6]if len(sys.argv)>6 else None)
