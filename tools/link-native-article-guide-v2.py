"""CPU source article guide: a native Link article model (bow, ancientbow, bowarrow, ancientbowarrow, boomerang)
rasterised by the same UV raster kernel and side-view camera (34 art px per native unit) as the body guide.

  render(article, motion, frame, body_prefix, out)   a held article posed by its own motion, added to a body guide
                                                     (bow / ancientbow / parasail / navy: the article motion is
                                                     actor-Trans-relative; ROOT_CROSSREADS holds the evidence)
  article_motion(article, body_motion)               the article motion played with a body motion: its namesake, or
                                                     the facing-free name of an r/l body motion (navy j01appeals for
                                                     j01appealsr)
Posing rules shared by both: a bone named *_BILLBOARD* faces the camera (its rotation is replaced by the side-view
camera basis, scale and position kept: Navi's ball), and a mesh whose skinning bones are all scaled below HIDDEN_SCALE
is not drawn (Ultimate hides an article by scaling it to ~0: the paraglider after it folds, raw 60+).
  render_alone(article, out, spin_degrees=0)         an article on its own in its bind pose, root = model origin,
                                                     optionally turned about the native X axis (the camera axis)
Both write the guide file set the cel pass (tools/link-cel-style.py) reads: <out>-source.png, -source-depth.npz,
-object-ids.png, -material-ids.png, -semantic-ids.png (article texels = 103), -uv-correspondence.npz and <out>.json.
No common-engine claim.
"""
from pathlib import Path
import sys,json,math
import numpy as np
from PIL import Image
from link_native_pose import LinkNativePose,BASE,sha
import ssbh_data_py as ssbh

PPU=34
MODELS=BASE/'extracted/fighter/link/model'
MOTIONS=BASE/'extracted/fighter/link/motion'
ARTICLE_SEMANTIC_ID=103
CONTRACTS='docs/review/2026-10-12/link-character/rework/source-contracts/'
ROOT_CROSSREADS={'bow':CONTRACTS+'bow-pilot-root-crossread.json','ancientbow':CONTRACTS+'ancient-bow-pilot-root-crossread.json',
                 'parasail':CONTRACTS+'parasail-pilot-root-crossread.json',
                 'navy':'docs/review/2026-10-15/link-art-pass-3/navy-root-crossread.json'}
HELD_ARTICLES=tuple(ROOT_CROSSREADS)   # independently crossread actor-root placement of their own motions
ARTICLE_ROLE='sourceBowArticle'      # the cel pass protects this role (keeps the article's own texture colours)
BILLBOARD_TAG='_BILLBOARD'
CAMERA_FACING=np.array([[0.,0,-1],[0,1,0],[1,0,0]])   # local x -> screen x (native +Z), y -> up, z -> the camera (native -X)
HIDDEN_SCALE=0.01


def article_motion(article,body_motion):
 """The article's own motion played with `body_motion` (namesake, else the facing-free name), or None."""
 names=[body_motion]+([body_motion[:-1]]if body_motion[-1:]in('r','l')else[])
 return next((n for n in names if (MOTIONS/article/'c00'/(n+'.nuanmb')).exists()),None)


def face_camera(world):
 """World matrices with every billboard bone turned to face the side-view camera (scale and position kept)."""
 out=dict(world)
 for name,m in world.items():
  if BILLBOARD_TAG in name:
   m=np.array(m,dtype=np.float64);m[:3,:3]=CAMERA_FACING*np.linalg.norm(m[:3,:3],axis=0);out[name]=m
 return out


def bone_scale(m):
 return float(np.cbrt(abs(np.linalg.det(np.asarray(m,dtype=np.float64)[:3,:3]))))


def article_pose(article,motion):
 folder=MODELS/article/'c00';path=MOTIONS/article/'c00'/(motion+'.nuanmb');pose=LinkNativePose.__new__(LinkNativePose);pose.motion_path=path;pose.skeleton=ssbh.skel_data.read_skel(str(folder/'model.nusktb'));pose.animation=ssbh.anim_data.read_anim(str(path));helper=ssbh.hlpb_data.read_hlpb(str(folder/'model.nuhlpb'));pose.constrained={c.target_bone_name.lower()for c in helper.orient_constraints};pose.constrained.update(c.target_bone_name1.lower()for c in helper.aim_constraints);pose.bones={b.name.lower():i for i,b in enumerate(pose.skeleton.bones)};pose.tracks={};pose.resource_role='SOURCE_ARTICLE';pose.track_binding_policy=None;pose.ignored_unbound_channels=[]
 if len(pose.bones)!=len(pose.skeleton.bones):raise ValueError('Ambiguous article skeleton names')
 for group in pose.animation.groups:
  if group.group_type.name!='Transform':continue
  for node in group.nodes:
   name=node.name.lower()
   if name not in pose.bones or len(node.tracks)!=1 or name in pose.tracks:raise ValueError('Unresolved article transform track '+node.name)
   pose.tracks[name]=node.tracks[0]
 return pose


def bind_matrices(skeleton):
 """World bind matrices of a skeleton (the article's rest pose), by bone name."""
 names=[b.name for b in skeleton.bones];world={}
 for b in skeleton.bones:
  local=np.asarray(b.transform,dtype=np.float64).T
  world[b.name]=local if b.parent_index is None else world[names[b.parent_index]]@local
 return world


def article_textures(article,authored_textures=None):
 textures={p.stem:np.array(Image.open(p).convert('RGBA'))for p in (BASE/'decoded-c00'/article).glob('*.png')}
 if authored_textures:
  for p in Path(authored_textures).glob('*_col.png'):textures[p.stem]=np.array(Image.open(p).convert('RGBA'))
 return textures


def posed_meshes(article,world,bind,authored_textures=None):
 """[(native vertices, indices, uvs, texture)] and per-mesh records of the article skinned from `bind` to `world`."""
 world=face_camera(world);folder=MODELS/article/'c00';inv={n:np.linalg.inv(m)for n,m in bind.items()};material=ssbh.matl_data.read_matl(str(folder/'model.numatb'));model=ssbh.modl_data.read_modl(str(folder/'model.numdlb'));materials={m.material_label:{t.param_id.name:t.data for t in m.textures}for m in material.entries};mapping={(m.mesh_object_name,m.mesh_object_subindex):m.material_label for m in model.entries};textures=article_textures(article,authored_textures)
 mesh=ssbh.mesh_data.read_mesh(str(folder/'model.numshb'));pending=[];objects=[]
 for obj in mesh.objects:
  mat=mapping[(obj.name,obj.subindex)];tex=materials[mat].get('Texture0')
  if tex not in textures:raise ValueError('Article texture missing '+mat+'/'+str(tex))
  if all(b in world and bone_scale(world[b])<HIDDEN_SCALE for b in [i.bone_name for i in obj.bone_influences]or[obj.parent_bone_name]):continue
  points=np.array(obj.positions[0].data)[:,:3];hom=np.column_stack([points,np.ones(len(points))]);posed=np.zeros_like(hom);weightsTotal=np.zeros(len(points))
  if obj.bone_influences:
   for influence in obj.bone_influences:
    indices=np.array([w.vertex_index for w in influence.vertex_weights]);weights=np.array([w.vertex_weight for w in influence.vertex_weights]);posed[indices]+=(hom[indices]@(world[influence.bone_name]@inv[influence.bone_name]).T)*weights[:,None];weightsTotal[indices]+=weights
   if np.max(abs(weightsTotal-1))>.0001:raise ValueError('Unnormalized article skin weights')
  elif obj.parent_bone_name:posed=hom@world[obj.parent_bone_name].T
  else:raise ValueError('No source article mesh placement')
  pending.append((posed[:,:3],obj.vertex_indices,obj.texture_coordinates[0].data,textures[tex]));objects.append({'mesh':obj.name,'subindex':obj.subindex,'material':mat,'texture':tex,'nativeBounds':[posed[:,:3].min(axis=0).tolist(),posed[:,:3].max(axis=0).tolist()]})
 return pending,objects


def model_hashes(article):
 folder=MODELS/article/'c00'
 return {f.name:sha(f)for f in folder.iterdir()if f.is_file()and f.suffix in ['.nusktb','.nuhlpb','.numshb','.numdlb','.numatb']}


def rasterize_articles(pending,objects,article,pixels,depth,regions,art_root,start):
 """Draw every article mesh as object ids start.. into the given buffers; returns the new objectIds rows."""
 from link_author_raster_v2 import rasterize_uv
 newids={}
 for i,(verts,indices,uv,texture)in enumerate(pending,start):
  xs=art_root[0]+verts[:,2]*PPU;ys=art_root[1]-verts[:,1]*PPU
  if min(xs)<2 or min(ys)<2 or max(xs)>pixels.shape[1]-3 or max(ys)>pixels.shape[0]-3:raise ValueError('Article exceeds body viewport; jointly repad root/canvas, never clip or shrink')
  rasterize_uv(verts,indices,uv,texture,pixels,depth,regions,i,art_root=art_root,ppu=PPU,view_side='negative');newids[str(i)]={**objects[i-start],'role':ARTICLE_ROLE,'sourceArticleKind':article}
 return newids


def viewport_padding(pending,art_root,shape):
 """Transparent padding (top, bottom, left, right) that keeps 48 px around the projected article (none if hidden)."""
 if not pending:return (0,0),(0,0)
 projected=np.concatenate([np.column_stack((art_root[0]+row[0][:,2]*PPU,art_root[1]-row[0][:,1]*PPU))for row in pending]);low=projected.min(axis=0);high=projected.max(axis=0)
 return (max(0,int(np.ceil(48-low[1]))),max(0,int(np.ceil(high[1]+48-shape[0])))),(max(0,int(np.ceil(48-low[0]))),max(0,int(np.ceil(high[0]+48-shape[1]))))


def render(article,motion,frame,body_prefix,out,authored_textures=None):
 if article not in HELD_ARTICLES:raise ValueError('Only independently crossread actor-root placement (ROOT_CROSSREADS) is allowed')
 body_prefix=Path(body_prefix);out=Path(out);body=json.load(open(str(body_prefix)+'.json'));pose=article_pose(article,motion);names=[b.name for b in pose.skeleton.bones];world=pose.matrices(frame,names);bind=pose.matrices(0,names,bind_pose=True)
 # Animated Bow Have is already actor-Trans-relative; no body HaveL parenting
 # or body Trans subtraction is added to this article placement.
 pending,objects=posed_meshes(article,world,bind,authored_textures)
 pixels=np.array(Image.open(str(body_prefix)+'-source.png').convert('RGBA'));depth=np.load(str(body_prefix)+'-source-depth.npz')['cameraDepthNativeX'].copy();regions=np.array(Image.open(str(body_prefix)+'-object-ids.png'));oldRoot=np.asarray(body['artRoot']);(padTop,padBottom),(padLeft,padRight)=pad=viewport_padding(pending,oldRoot,pixels.shape);pixels=np.pad(pixels,pad+((0,0),),constant_values=0);depth=np.pad(depth,pad,constant_values=np.inf);regions=np.pad(regions,pad,constant_values=0);body['artRoot']=(oldRoot+np.array([padLeft,padTop])).tolist();body['artCanvas']=[pixels.shape[1],pixels.shape[0]];start=max(int(k)for k in body['objectIds'])+1
 newids=rasterize_articles(pending,objects,article,pixels,depth,regions,body['artRoot'],start)
 out.parent.mkdir(parents=True,exist_ok=True);Image.fromarray(pixels).save(str(out)+'-source.png');Image.fromarray(regions).save(str(out)+'-object-ids.png');np.savez_compressed(str(out)+'-source-depth.npz',cameraDepthNativeX=depth)
 # Preserve actual body material/semantic masks, marking the new article region.
 for suffix in ['material-ids','semantic-ids']:
  mask=np.pad(np.array(Image.open(str(body_prefix)+'-'+suffix+'.png')),pad,constant_values=0);mask[regions>=start]=ARTICLE_SEMANTIC_ID;Image.fromarray(mask).save(str(out)+'-'+suffix+'.png')
 uv=np.load(str(body_prefix)+'-uv-correspondence.npz');np.savez_compressed(str(out)+'-uv-correspondence.npz',uv=np.pad(uv['uv'],pad+((0,0),),constant_values=0),textureId=np.pad(uv['textureId'],pad,constant_values=0))
 body['uvAuthoringCorrespondence']={**body['uvAuthoringCorrespondence'],'path':str(out)+'-uv-correspondence.npz'}
 meta={**body,'jointViewportPadding':{'left':padLeft,'top':padTop,'right':padRight,'bottom':padBottom,'knownRootBefore':oldRoot.tolist(),'actorRootRegistrationUnchanged':True,'onlyAddedTransparentViewport':True},'objectIds':{**body['objectIds'],**newids},'sourceBodyPrefix':str(body_prefix),'sourceBodyRecordSHA':sha(Path(str(body_prefix)+'.json')),'sourceArticle':{'article':article,'motion':{'path':str(pose.motion_path),'sha256':sha(pose.motion_path)},'modelInputHashes':model_hashes(article),'rawMatrices':{n:m.tolist()for n,m in world.items()},'sourcePlacementPolicy':'Own animated Have (Bow) or All (AncientBow, actual9bone rig without Root/Have) independently matches actor-Trans-relative body HaveL. Own rig placement applied once; no extra HaveL parenting or actorTrans subtraction.','rootCrossread':ROOT_CROSSREADS[article],'clockPolicy':'Same integer body/article sample diagnostic and authored target pairing; native shared status synchronization/caller unrecovered. Final release raw60 independently sourced, private scheduler parity not claimed.','authoredTextureDirectory':str(authored_textures)if authored_textures else None,'authoredTextureHashes':{p.name:sha(p)for p in Path(authored_textures).glob('*_col.png')}if authored_textures else None,'helperPolicy':'Unchanged strict matrix method; no article constraint/scale guard disabled'},'state':'Combined body+source Bow guide only; no target art, common attachment or gameplay acceptance'};Path(str(out)+'.json').write_text(json.dumps(meta,indent=1)+'\n');print(json.dumps({'guide':str(out),'articleMeshes':len(objects),'nativeSample':frame}))


def spin_x(degrees):
 """4x4 rotation by `degrees` about the native +X axis (the side-view camera axis) through the model origin."""
 a=math.radians(degrees);c,s=math.cos(a),math.sin(a);m=np.eye(4);m[1:3,1:3]=[[c,-s],[s,c]]
 return m


def render_alone(article,out,authored_textures=None,spin_degrees=0.0):
 """The article alone in its bind pose (turned by spin_degrees about native X), art root = the model origin."""
 out=Path(out);folder=MODELS/article/'c00';bind=bind_matrices(ssbh.skel_data.read_skel(str(folder/'model.nusktb')));turn=spin_x(spin_degrees);world={n:turn@m for n,m in bind.items()}
 pending,objects=posed_meshes(article,world,bind,authored_textures)
 (top,bottom),(left,right)=viewport_padding(pending,(0,0),(0,0));root=[left,top];size=(top+bottom,left+right)
 pixels=np.zeros((*size,4),np.uint8);depth=np.full(size,np.inf);regions=np.zeros(size,np.uint16)
 newids=rasterize_articles(pending,objects,article,pixels,depth,regions,root,1)
 out.parent.mkdir(parents=True,exist_ok=True);Image.fromarray(pixels).save(str(out)+'-source.png');Image.fromarray(regions).save(str(out)+'-object-ids.png');np.savez_compressed(str(out)+'-source-depth.npz',cameraDepthNativeX=depth)
 Image.fromarray(regions).save(str(out)+'-material-ids.png');Image.fromarray(np.where(regions>0,ARTICLE_SEMANTIC_ID,0).astype(np.uint16)).save(str(out)+'-semantic-ids.png')
 np.savez_compressed(str(out)+'-uv-correspondence.npz',uv=np.zeros((*size,2),np.float32),textureId=np.zeros(size,np.uint16))
 skeleton=folder/'model.nusktb'
 meta={'motion':{'path':str(skeleton),'sha256':sha(skeleton),'pose':'bind'},'nativeFrameIndex':0,'spinDegreesAboutNativeX':spin_degrees,'artCanvas':[size[1],size[0]],'artRoot':root,'artPixelsPerNativeUnit':PPU,'objectIds':newids,'sourceRigAnchors':{},'capturedTrans':[0,0,0],'uvAuthoringCorrespondence':{'path':str(out)+'-uv-correspondence.npz','textureIds':{}},'nativeShaderLimits':'Orthographic CPU texture preview; lighting/full shader not claimed.','sourceArticle':{'article':article,'modelInputHashes':model_hashes(article),'authoredTextureDirectory':str(authored_textures)if authored_textures else None},'state':'Article-only guide, root = native model origin'}
 Path(str(out)+'.json').write_text(json.dumps(meta,indent=1)+'\n')
 return meta


if __name__=='__main__':render(sys.argv[1],sys.argv[2],int(sys.argv[3]),sys.argv[4],sys.argv[5],sys.argv[6]if len(sys.argv)>6 else None)
