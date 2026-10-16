#!/usr/bin/env python3
"""Author Pikachu Final drawings from retained native poses with a CPU toon recipe.

This is a new code-art renderer, not a native game shader or a collision source.
It retains skeletal motion/root registration and authors palette bands, light,
outline and occlusion ink. Helper orient constraints remain an explicit visual
approximation. The mechanics exporter independently qualifies bone samples.

PYTHONPATH=.tmp/pikachu-final-libs:tools python3 tools/render-pikachu-final-art.py --pilot
PYTHONPATH=.tmp/pikachu-final-libs:tools flock .tmp/dk-heavy.lock python3 tools/render-pikachu-final-art.py
"""
from pathlib import Path
import argparse, hashlib, json, time
import numpy as np
from PIL import Image, ImageFilter
import ssbh_data_py as ssbh
from pikachu_native_pose import PikachuNativePose, BASE, MOTIONS

ROOT=Path(__file__).resolve().parent.parent
PLAN=ROOT/'docs/review/2026-10-15/pikachu-final/owner-art-plan.json'
OUT=ROOT/'docs/review/2026-10-15/pikachu-final/owner-art-staging'
BODY=BASE/'geometry-reference/fighter/pikachu/model/body/c00'
SIZE=(1024,1536); ORIGIN=(512,1152)
PPU=150/7 # 5 world pixels/native unit, 4.2857 drawing pixels/world pixel.
SCALE=5/PPU
INK=np.array([41,30,26],dtype=np.uint8)
LIGHT=np.array([-.45,.8,.38]);LIGHT=LIGHT/np.linalg.norm(LIGHT)

def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()

class ToonRenderer:
    def __init__(self):
        self.mesh=ssbh.mesh_data.read_mesh(str(BODY/'model.numshb'))
        self.materials={m.material_label:next((t.data for t in m.textures if t.param_id.name=='Texture0'),None)
            for m in ssbh.matl_data.read_matl(str(BODY/'model.numatb')).entries}
        self.material_map={(m.mesh_object_name,m.mesh_object_subindex):m.material_label
            for m in ssbh.modl_data.read_modl(str(BODY/'model.numdlb')).entries}
        geom=BASE/'geometry-reference'
        names={'skin_pikachu_001_col':'skin-reference.png','pikachu_facial_01_col':'face-reference.png',
            **{f'pikachu_facial_{i:02}_col':f'face{i}-reference.png' for i in [2,3,4]}}
        self.textures={k:np.asarray(Image.open(geom/v).convert('RGBA')) for k,v in names.items()}
        self.animations={}
        self.objects=[]
        for obj in self.mesh.objects:
            texture=self.materials.get(self.material_map[(obj.name,obj.subindex)])
            if texture not in self.textures:continue
            points=np.asarray(obj.positions[0].data[:,:3],dtype=np.float64)
            normals=np.asarray(obj.normals[0].data[:,:3],dtype=np.float64)
            influences=[(i.bone_name,np.array([v.vertex_index for v in i.vertex_weights],dtype=int),
                         np.array([v.vertex_weight for v in i.vertex_weights])) for i in obj.bone_influences]
            self.objects.append((obj,texture,np.column_stack((points,np.ones(len(points)))),normals,influences))

    def rasterize(self,vertices,normals,obj,texture,pixels,depth):
        screen=np.column_stack((ORIGIN[0]+vertices[:,2]*PPU,ORIGIN[1]-vertices[:,1]*PPU))
        uv=np.asarray(obj.texture_coordinates[0].data[:,:2]);facial=not texture.startswith('skin_');tex=self.textures[texture]
        length=np.linalg.norm(normals,axis=1,keepdims=True);normals=normals/np.maximum(length,1e-9)
        intensity=normals@LIGHT
        for triangle in np.asarray(obj.vertex_indices).reshape((-1,3)):
            p=screen[triangle]
            low=np.maximum(np.floor(p.min(axis=0)).astype(int),[0,0]);high=np.minimum(np.ceil(p.max(axis=0)).astype(int),[SIZE[0]-1,SIZE[1]-1])
            if np.any(low>high):continue
            a,b,c=p;den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
            if abs(den)<1e-8:continue
            xx,yy=np.meshgrid(np.arange(low[0],high[0]+1)+.5,np.arange(low[1],high[1]+1)+.5)
            w0=((b[1]-c[1])*(xx-c[0])+(c[0]-b[0])*(yy-c[1]))/den
            w1=((c[1]-a[1])*(xx-c[0])+(a[0]-c[0])*(yy-c[1]))/den;w2=1-w0-w1
            weights=np.stack((w0,w1,w2),axis=-1)
            z=weights@vertices[triangle,0];coords=weights@uv[triangle]
            colors=tex[np.floor(np.mod(coords[:,:,1],1)*tex.shape[0]).astype(int),np.floor(np.mod(coords[:,:,0],1)*tex.shape[1]).astype(int)]
            section=np.s_[low[1]:high[1]+1,low[0]:high[0]+1]
            covered=(w0>=-1e-6)&(w1>=-1e-6)&(w2>=-1e-6)&(z<depth[section])&(colors[:,:,3]>127)
            if not covered.any():continue
            r,g,b=(colors[:,:,i].astype(float) for i in range(3))
            shade=weights@intensity[triangle]
            # Authored golden-yellow toon palette, red cheeks, dark ears, warm brown stripes.
            paint=np.zeros(colors.shape,dtype=np.uint8);paint[:]=[248,216,52,255]
            paint[shade<-.15]=[218,174,31,255];paint[shade>.55]=[255,233,91,255]
            dark=(r<76)&(g<76)&(b<76)
            brown=(r>g*1.22)&(b<g*.75)&~dark
            red=(r>g*1.25)&(b>=g*.75)&~dark
            white=(r>215)&(g>215)&(b>215)
            paint[brown]=[147,73,30,255];paint[red]=[209,48,37,255]
            paint[dark]=[*INK,255];paint[white]=[255,252,235,255]
            if facial:paint[(r<125)&(g<115)&(b<115)]=[*INK,255]
            pixels[section][covered]=paint[covered];depth[section][covered]=z[covered]

    def render(self,motion,sample):
        pose=self.animations.get(motion)
        if pose is None:
            pose=PikachuNativePose(MOTIONS/(motion+'.nuanmb'))
            omitted=sorted(pose.constrained);pose.constrained=set()
            names=[b.name for b in pose.skeleton.bones]
            bind=pose.matrices(0,names,bind_pose=True)
            pose._art_inverse_bind={name:np.linalg.inv(matrix) for name,matrix in bind.items()}
            pose._art_omitted=omitted;self.animations[motion]=pose
        world=pose.matrices(sample,[b.name for b in pose.skeleton.bones])
        visible={'Body':True,'Pikachu_LEye':True,'Pikachu_REye':True,'Pikachu_Mouth':True}
        for group in pose.animation.groups:
            if group.group_type.name=='Visibility':
                for node in group.nodes:
                    values=node.tracks[0].values;visible[node.name]=values[0 if len(values)==1 else sample]
        pixels=np.zeros((SIZE[1],SIZE[0],4),dtype=np.uint8);depth=np.full((SIZE[1],SIZE[0]),np.inf)
        for obj,texture,points,normals,influences in self.objects:
            if not visible.get(obj.name.split('_VIS')[0],False):continue
            if influences:
                posed=np.zeros_like(points);posed_normals=np.zeros_like(normals);total=np.zeros(len(points))
                for name,indices,weights in influences:
                    transform=world[name]@pose._art_inverse_bind[name]
                    posed[indices]+=(points[indices]@transform.T)*weights[:,None]
                    posed_normals[indices]+=(normals[indices]@np.linalg.inv(transform[:3,:3]))*weights[:,None]
                    total[indices]+=weights
                if np.max(np.abs(total-1))>.0001:raise ValueError('Native mesh skinning weights do not sum to one')
            elif obj.parent_bone_name:
                transform=world[obj.parent_bone_name];posed=points@transform.T
                posed_normals=normals@np.linalg.inv(transform[:3,:3])
            else:raise ValueError('Visible mesh has no coordinate route')
            posed[:,:3]-=world['Trans'][:3,3]
            self.rasterize(posed[:,:3],posed_normals,obj,texture,pixels,depth)
        mask=Image.fromarray(pixels[:,:,3]);outline=mask.filter(ImageFilter.MaxFilter(5))
        result=Image.new('RGBA',SIZE,(*INK,0));result.putalpha(outline);result.alpha_composite(Image.fromarray(pixels))
        opaque=pixels[:,:,3]>0;seams=np.zeros(opaque.shape,dtype=bool)
        for axis in [0,1]:
            other=np.roll(depth,1,axis=axis);both=np.isfinite(depth)&np.isfinite(other)
            diff=np.zeros_like(depth);np.subtract(depth,other,out=diff,where=both)
            seams|=both&(np.abs(diff)>.55)
        seams[0,:]=False;seams[:,0]=False
        ink=np.asarray(result).copy();ink[seams,:3]=INK
        result=Image.fromarray(ink)
        bounds=result.getbbox()
        if bounds is None or min(bounds[:2])<2 or bounds[2]>SIZE[0]-2 or bounds[3]>SIZE[1]-2:raise ValueError(f'Art clipped: {motion}/{sample}/{bounds}')
        return result,{'nativeSample':sample,'bounds':bounds,'trans':world['Trans'][:3,3].tolist(),'omittedHelperConstraints':pose._art_omitted}


def main():
    args=argparse.ArgumentParser();args.add_argument('--pilot',action='store_true');options=args.parse_args()
    OUT.mkdir(parents=True,exist_ok=True);(OUT/'animations').mkdir(exist_ok=True)
    plan=json.loads(PLAN.read_text());renderer=ToonRenderer();records=[];start=time.monotonic()
    if options.pilot:
        jobs=[('d04final',0),('d04final',47),('d04finaldash',3),('d04final2',10)]
        review=Image.new('RGBA',(SIZE[0]*len(jobs),SIZE[1]),(47,56,78,255))
        for i,(motion,sample) in enumerate(jobs):
            drawing,meta=renderer.render(motion,sample);drawing.save(OUT/f'pilot-{motion}-{sample}.png');review.alpha_composite(drawing,(SIZE[0]*i,0));records.append(meta)
        review.convert('RGB').save(OUT/'pilot.jpg');print(json.dumps({'pilot':str(OUT/'pilot.jpg'),'seconds':time.monotonic()-start,'samples':records}));return
    metadata={}
    for clip in plan['clips']:
        drawings=[];receipts=[];trims=[];cursor_x=2;cursor_y=2;row_height=0;atlas_width=2048
        atlas=Image.new('RGBA',(atlas_width,4096))
        for index,sample in enumerate(clip['samples']):
            drawing,receipt=renderer.render(clip['motion'],sample)
            bounds=drawing.getbbox();crop=drawing.crop(bounds)
            if cursor_x+crop.width+2>atlas_width:cursor_x=2;cursor_y+=row_height+4;row_height=0
            if cursor_y+crop.height+2>4096:raise ValueError('Art atlas exceeds reviewed texture budget')
            atlas.alpha_composite(crop,(cursor_x,cursor_y));trims.append([cursor_x,cursor_y,crop.width,crop.height,bounds[0],bounds[1]])
            cursor_x+=crop.width+4;row_height=max(row_height,crop.height);receipts.append(receipt)
        dest=OUT/'animations'/f"{clip['sheet']}.png";atlas=atlas.crop((0,0,atlas_width,cursor_y+row_height+2));atlas.save(dest,optimize=True)
        metadata[clip['sheet']]={'strip':f"animations/{clip['sheet']}.png",'frameCount':len(receipts),'frameWidth':SIZE[0],'frameHeight':SIZE[1],
            'atlas':list(atlas.size),'trims':trims,'root':list(ORIGIN),'scaleToWorld':SCALE,'bodyCentreFromRootY':-25,'coordinateOrigin':'actorSourceRoot',
            'sourceSampleBasis':'zero-based-native-index','nativeSampleIndices':clip['samples'],'loopDuration':clip['loopDuration'],
            'sha256':sha(dest),'artProvenance':{'recipe':'authored CPU toon palette/three-band lighting/outline/depth seams from native skeletal pose',
                'rendererSha256':sha(__file__),'meshSha256':sha(BODY/'model.numshb'),'motionSha256':clip['motionSha256'],
                'limitations':['helper-orient constraints omitted for visual skinning','authored orthographic camera/palette/light, not native shader parity'],
                'noPerPoseFloorSnap':True,'rootRegistration':'remove-trans-translation'},'drawingReceipts':receipts}
        print(json.dumps({'sheet':clip['sheet'],'drawings':len(receipts),'seconds':round(time.monotonic()-start,2)}),flush=True)
    (OUT/'art-clips.json').write_text(json.dumps(metadata,indent=2)+'\n')
    print(json.dumps({'complete':True,'drawings':sum(x['frameCount'] for x in metadata.values()),'seconds':time.monotonic()-start}),flush=True)

if __name__=='__main__':main()
