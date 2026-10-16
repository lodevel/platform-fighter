"""CPU native-resource source guide; not shipped art or game-renderer parity.

Strict raw source matrices stay independent. Mesh helper rotations reconstruct
only a pinned community preview approximation; original quat/range semantics
remain unqualified. High LOD is explicit; default eyelid visibility is layered.
"""
from pathlib import Path
import importlib.util,sys,json,math
import numpy as np
import os
from link_native_uv_raster import rasterize_uv
from PIL import Image,ImageFilter,ImageDraw
from link_native_pose import LinkNativePose,ROOT,BASE,MOTIONS,sha
import ssbh_data_py as ssbh
spec=importlib.util.spec_from_file_location('dk_cpu_raster',ROOT/'tools/dk-native-guide.py');raster=importlib.util.module_from_spec(spec);spec.loader.exec_module(raster)
BODY=BASE/'extracted/fighter/link/model/body/c00';TEXTURES=BASE/'decoded-c00/body';SIZE=(1024,1024);ART_ROOT=(512,850);PPU=34.;VIEW='negative'
raster.ART_ROOT=ART_ROOT;raster.ART_PIXELS_PER_UNIT=PPU;raster.VIEW_SIDE=VIEW

def value(track,frame,linear=False):
 v=track.values
 if not v:raise ValueError('Empty source track')
 f=max(0,min(float(frame),len(v)-1));low=int(math.floor(f))
 return (np.asarray(v[low])*(1-f+low)+np.asarray(v[low+1])*(f-low)).tolist()if linear and low+1<len(v)else v[low]
def euler(m):
 s=np.linalg.norm(m[:3,:3],axis=0);r=m[:3,:3]/s;y=math.asin(float(np.clip(-r[2,0],-1,1)))
 if abs(math.cos(y))>1e-6:x=math.atan2(r[2,1],r[2,2]);z=math.atan2(r[1,0],r[0,0])
 else:x=0;z=math.atan2(-r[0,1],r[1,1])
 return np.array([x,y,z]),s

def rotation(angles):
 x,y,z=angles;cx,sx=math.cos(x),math.sin(x);cy,sy=math.cos(y),math.sin(y);cz,sz=math.cos(z),math.sin(z)
 return np.array([[cz*cy,cz*sy*sx-sz*cx,cz*sy*cx+sz*sx],[sz*cy,sz*sy*sx+cz*cx,sz*sy*cx-cz*sx],[-sy,cy*sx,cy*cx]])
def preview_helpers(world,pose):
 helper=ssbh.hlpb_data.read_hlpb(str(BODY/'model.nuhlpb'));boneBy={b.name:b for b in pose.skeleton.bones};original={n:m.copy()for n,m in world.items()};names=[b.name for b in pose.skeleton.bones]
 for c in helper.orient_constraints:
  target=c.target_bone_name;source=c.source_bone_name;a,scale=euler(world[target]);b,_=euler(world[source]);delta=b-a
  # Exact signed-remainder shortest-angle expression in pinned communitysource.
  diff=np.array([math.fmod(float(v),2*math.pi)for v in delta]);short=np.array([math.fmod(2*float(v),2*math.pi)-v for v in diff]);axes=np.asarray(c.constraint_axes);new=world[target].copy();new[:3,:3]=rotation(a+short*axes)@np.diag(scale);world[target]=new
  def descendants(parent):
   for bone in pose.skeleton.bones:
    if bone.parent_index is not None and names[bone.parent_index]==parent:
     local=np.linalg.inv(original[parent])@original[bone.name];world[bone.name]=world[parent]@local;descendants(bone.name)
  descendants(target)
 return world

def render(motion_name,frame,destination,authored_texture_directory=None):
 global SIZE,ART_ROOT
 destination=Path(destination);destination.parent.mkdir(parents=True,exist_ok=True)
 exact=LinkNativePose(MOTIONS/(motion_name+'.nuanmb'));anchorNames=['Trans','Rot','Hip','Waist','Bust','Neck','Head','FootL','FootR','HandL','HandR','HaveL','HaveR','Sword1','Sword2','Shield','ShieldB','Scabbard','BowB'];anchors=exact.matrices(frame,anchorNames)
 pose=LinkNativePose(exact.motion_path);guardedTargets=sorted(pose.constrained);pose.constrained=set();names=[b.name for b in pose.skeleton.bones];world=preview_helpers(pose.matrices(frame,names),pose);bind=pose.matrices(0,names,bind_pose=True);inv={n:np.linalg.inv(m)for n,m in bind.items()};origin=anchors['Trans'][:3,3]
 visibility={};uvs={};default=ssbh.anim_data.read_anim(str(MOTIONS/'a00defaulteyelid.nuanmb'))
 for animation,at in [(default,0),(pose.animation,frame)]:
  for group in animation.groups:
   for node in group.nodes:
    if group.group_type.name=='Visibility':visibility[node.name]=bool(value(node.tracks[0],at))
    if group.group_type.name=='Material':
     for track in node.tracks:
      if track.name=='CustomVector31':uvs[node.name]=value(track,at,True)
 def visible(name):
  keys=[k for k in visibility if name.startswith(k)];return visibility[max(keys,key=len)]if keys else True
 matl=ssbh.matl_data.read_matl(str(BODY/'model.numatb'));modl=ssbh.modl_data.read_modl(str(BODY/'model.numdlb'));materials={m.material_label:{t.param_id.name:t.data for t in m.textures}for m in matl.entries};materialMap={(m.mesh_object_name,m.mesh_object_subindex):m.material_label for m in modl.entries};textures={p.stem:np.asarray(Image.open(p).convert('RGBA'))for p in TEXTURES.glob('*.png')};
 if authored_texture_directory:
  overrideFiles=list(Path(authored_texture_directory).glob('*_col.png'))
  if not overrideFiles:raise ValueError('Explicit authored texture directory has no colour textures; do not silently label native fallback as target art')
  for p in overrideFiles:textures[p.stem]=np.asarray(Image.open(p).convert('RGBA'))
 mesh=ssbh.mesh_data.read_mesh(str(BODY/'model.numshb'));pending=[];semanticPending=[];rendered=[];hidden=[]
 for obj in mesh.objects:
  if obj.name.startswith('body_c00_low')or not visible(obj.name):hidden.append({'name':obj.name,'subindex':obj.subindex,'reason':'Authored highLOD preview'if obj.name.startswith('body_c00_low')else'Layered source visibility'});continue
  mat=materialMap[(obj.name,obj.subindex)];texture=materials[mat].get('Texture0')
  if texture not in textures:raise ValueError('Visible source mesh texture unresolved '+obj.name+'/'+mat+'/'+str(texture))
  points=np.asarray(obj.positions[0].data)[:,:3];hom=np.column_stack((points,np.ones(len(points))));posed=np.zeros_like(hom);dominant=np.empty(len(points),dtype=object);highest=np.zeros(len(points))
  if obj.bone_influences:
   weightsTotal=np.zeros(len(points))
   for influence in obj.bone_influences:
    n=influence.bone_name;indices=np.array([v.vertex_index for v in influence.vertex_weights]);weights=np.array([v.vertex_weight for v in influence.vertex_weights]);posed[indices]+=(hom[indices]@(world[n]@inv[n]).T)*weights[:,None];weightsTotal[indices]+=weights;larger=weights>highest[indices];dominant[indices[larger]]=n;highest[indices[larger]]=weights[larger]
   if np.max(abs(weightsTotal-1))>.0001:raise ValueError('Unnormalized source skin weights')
  elif obj.parent_bone_name:posed=hom@world[obj.parent_bone_name].T;dominant[:]=obj.parent_bone_name
  else:raise ValueError('Unresolved source geometry route')
  posed[:,:3]-=origin
  pupil=textures.get(materials[mat].get('Texture1'))if mat in ['EyeL','EyeR']else None
  pending.append((posed[:,:3],obj.vertex_indices,obj.texture_coordinates[0].data,textures[texture],mat,pupil,uvs.get(mat,[1,1,0,0])))
  triangles=np.asarray(obj.vertex_indices).reshape(-1,3);roles=np.zeros(len(triangles),np.uint16)
  for role,name in [(101,'queiver'),(102,'sheikahstone')]:roles[np.sum(dominant[triangles]==name,axis=1)>=2]=role
  semanticPending.append((pending[-1],roles))
  rendered.append({'mesh':obj.name,'subindex':obj.subindex,'material':mat,'texture':texture,'boundsNative':(posed[:,:3].min(axis=0).tolist(),posed[:,:3].max(axis=0).tolist())})
 lo=np.min(np.array([r['boundsNative'][0]for r in rendered]),axis=0);hi=np.max(np.array([r['boundsNative'][1]for r in rendered]),axis=0);ART_ROOT=(max(512,int(math.ceil(-lo[2]*PPU+48))),max(850,int(math.ceil(hi[1]*PPU+48))));SIZE=(int(math.ceil(max(1024,ART_ROOT[0]+hi[2]*PPU+48)/64)*64),int(math.ceil(max(1024,ART_ROOT[1]-lo[1]*PPU+48)/64)*64));raster.ART_ROOT=ART_ROOT
 pixels=np.zeros((*SIZE[::-1],4),np.uint8);depth=np.full(SIZE[::-1],np.inf);regions=np.zeros(SIZE[::-1],np.uint16);materialIds={m:i+1 for i,m in enumerate(materials)}
 captureUV=os.environ.get('LINK_AUTHOR_UV_MAP')=='1';uvBuffer=np.zeros((*SIZE[::-1],2),np.float32)if captureUV else None;textureRegions=np.zeros(SIZE[::-1],np.uint16)if captureUV else None;textureIds={name:i+1 for i,name in enumerate(sorted(textures))}
 for objectId,(verts,indices,uv,tex,mat,pupil,transform) in enumerate(pending,1):
  if captureUV:
   textureName=rendered[objectId-1]['texture'];rasterize_uv(verts,indices,uv,tex,pixels,depth,regions,objectId,pupil,transform,art_root=ART_ROOT,ppu=PPU,view_side=VIEW,uv_buffer=uvBuffer,texture_regions=textureRegions,texture_id=textureIds[textureName])
  else:raster.rasterize(verts,indices,uv,tex,pixels,depth,regions,objectId,pupil,transform)
 if captureUV:np.savez_compressed(str(destination)+'-uv-correspondence.npz',uv=uvBuffer,textureId=textureRegions)
 objectRegions=regions.copy();lookup=np.array([0]+[materialIds[x[4]]for x in pending],dtype=np.uint16);regions=lookup[objectRegions]
 Image.fromarray(objectRegions).save(str(destination)+'-object-ids.png')
 semanticRegions=np.zeros(SIZE[::-1],np.uint16);semanticDepth=np.full(SIZE[::-1],np.inf);scratch=np.zeros_like(pixels)
 for objectId,((verts,indices,uv,tex,mat,pupil,transform),roles) in enumerate(semanticPending,1):
  triangles=np.asarray(indices).reshape(-1,3)
  for role in np.unique(roles):raster.rasterize(verts,triangles[roles==role].reshape(-1),uv,tex,scratch,semanticDepth,semanticRegions,int(role)or objectId,pupil,transform)
 Image.fromarray(semanticRegions).save(str(destination)+'-semantic-ids.png')
 np.savez_compressed(str(destination)+'-source-depth.npz',cameraDepthNativeX=depth)
 Image.fromarray(regions).save(str(destination)+'-material-ids.png')
 Image.fromarray(pixels).save(str(destination)+'-source.png');silhouette=Image.fromarray(pixels[:,:,3]);silhouette.save(str(destination)+'-silhouette.png');view=Image.new('RGBA',SIZE,'#172536');view.alpha_composite(Image.fromarray(pixels));d=ImageDraw.Draw(view);d.line((0,ART_ROOT[1],SIZE[0],ART_ROOT[1]),fill='#63e9b0')
 for name,m in anchors.items():
  q=m[:3,3]-origin;x=ART_ROOT[0]+q[2]*PPU;y=ART_ROOT[1]-q[1]*PPU;d.ellipse((x-3,y-3,x+3,y+3),outline='#ff7bc5',width=2);d.text((x+4,y),name,fill='white')
 view.save(str(destination)+'-source-joints.png');metadata={**exact.provenance(),'nativeFrameIndex':frame,'nativeFrameIndexBasis':'Zero-based raw animationindex; gameplay mapping requires independent static UFD/native pose comparison, not assumed.', 'sourceRigAnchors':{n:m.tolist()for n,m in anchors.items()},'artCanvas':SIZE,'artRoot':ART_ROOT,'artPixelsPerNativeUnit':PPU,'scenePixelsPerNativeUnit':5,'bodyCentreFromRootY':-36,'rootRegistration':'In-place source mesh/strict anchors minus same capturedTrans; originalTrans retained for separate normal rootdisplacement consumer, locomotion uses zero displacement.','capturedTrans':origin.tolist(),'paddingMethod':'Native source-space bounds determine onlyextra viewportpadding; actorTrans origin/PPU unchanged, not perframealpha recenter/resize.','materialIds':materialIds,'semanticRoles':{'101':'Native queiver dominant bone (at least2of3trianglevertices)','102':'Native sheikahstone dominant bone (at least2of3trianglevertices)'},'objectIds':{str(i):{'mesh':r['mesh'],'subindex':r['subindex'],'material':r['material']}for i,r in enumerate(rendered,1)},'rendered':rendered,'hidden':hidden,'visiblePrefixes':visibility,'sourceTextureReceipts':'docs/review/2026-10-12/link-character/rework/sources/native/decoded-texture-receipts.json','helperPreviewTargets':guardedTargets,'helperPreviewMethod':'Pinned ssbh_wgpu worldZYX shortestEuler peraxis interpolation; ignoresquat1/quat2/type percommunitysourceTODO, no gameengine/helper parity claim. Rawstrict attachment/foot matrices have nohelperancestor.','helperPrimaryReference':'docs/review/2026-10-12/link-character/rework/art/source-renderer-reference/provenance.json','nativeShaderLimits':'Orthographic CPU texture/eyeUV/decal preview; lighting/fullshader/materialscript/visibilityconsumer nativeparity not claimed.','uvAuthoringCorrespondence':{'path':str(destination)+'-uv-correspondence.npz','textureIds':textureIds,'purpose':'Same raw source geometry pixel-to-UV for fresh accepted target colour/feature authoring; not runtime/native shader evidence'}if captureUV else None,'authoredTextureDirectory':str(authored_texture_directory)if authored_texture_directory else None,'authoredTextureHashes':{p.name:sha(p)for p in Path(authored_texture_directory).glob('*_col.png')}if authored_texture_directory else None,'state':'Authored texture palette projected through source mesh; equipment output only, no runtime acceptance.'if authored_texture_directory else'Source guide only. No generated target art/root/collision/runtime acceptance.'};Path(str(destination)+'.json').write_text(json.dumps(metadata,indent=1)+'\n');print(json.dumps({'sourceGuide':str(destination),'nativeFrameIndex':frame,'renderedMeshes':len(rendered),'hiddenMeshes':len(hidden)}))
if __name__=='__main__':render(sys.argv[1],int(sys.argv[2]),sys.argv[3],sys.argv[4]if len(sys.argv)>4 else None)
