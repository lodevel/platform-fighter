"""Author new Volt recipient recipes from accepted identity artwork.

The source pictures seed each actor's identity, not a claimed native Final
victim dispatch. New phase/sample recipes apply actual ROOT-relative affine
poses and electrical treatment. The identical similarity operator transforms
the independently posed receiving capsules and actual Hip capture point.
No existing clip is aliased, no physics displacement or floor snap is added.
"""
from pathlib import Path
import hashlib,json,math,sys
sys.path[:0]=[str(Path(__file__).resolve().parent),str(Path(__file__).resolve().parents[1]/'.tmp/pikachu-final-libs')]
import numpy as np
from PIL import Image,ImageDraw,ImageFilter
import ssbh_data_py as ssbh
from pikachu_native_pose import PikachuNativePose,MOTIONS as PM
from dk_native_pose import DonkeyKongNativePose,MOTIONS as DM
from link_native_pose import LinkNativePose,MOTIONS as LM
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'docs/review/2026-10-15/pikachu-final/victim-art-staging'
SIZE=(512,512);ORIGIN=np.array([256.,384.]);SCALE=7/15
MAJOR=['Hip','Bust','Head','ShoulderL','ArmL','HandL','ShoulderR','ArmR','HandR','LegL','KneeL','FootL','LegR','KneeR','FootR']
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()

def load_cell(actor,clip,index):
 page=Image.open(ROOT/'assets/characters'/actor/clip['strip']).convert('RGBA')
 if 'trims'in clip:
  x,y,w,h,dx,dy=clip['trims'][index];cell=Image.new('RGBA',(clip['frameWidth'],clip['frameHeight']));cell.alpha_composite(page.crop((x,y,x+w,y+h)),(dx,dy));return cell
 columns=page.width//clip['frameWidth'];x=(index%columns)*clip['frameWidth'];y=(index//columns)*clip['frameHeight']
 return page.crop((x,y,x+clip['frameWidth'],y+clip['frameHeight']))

def link_declarations():
 """Authored 98%-radial skin capsules, same established DK fit procedure.
 Only body_c00_highShape1 is used: equipment meshes cannot become receiving.
 """
 p=LinkNativePose(LM/'f02damageelec.nuanmb');bind=p.matrices(0,MAJOR,bind_pose=True)
 names=[b.name for b in p.skeleton.bones];parents={b.name:names[b.parent_index]if b.parent_index is not None else None for b in p.skeleton.bones}
 mesh=ssbh.mesh_data.read_mesh(str(ROOT/'assets/gen/link-native-reference/extracted/fighter/link/model/body/c00/model.numshb'))
 obj=next(o for o in mesh.objects if o.name=='body_c00_highShape'and o.subindex==1)
 vertices=np.asarray(obj.positions[0].data[:,:3]);owners=np.full(len(vertices),'',object);scores=np.zeros(len(vertices))
 for influence in obj.bone_influences:
  name=influence.bone_name
  while name is not None and name not in MAJOR:name=parents.get(name)
  if name is None:continue
  for v in influence.vertex_weights:
   if v.vertex_weight>scores[v.vertex_index]:scores[v.vertex_index]=v.vertex_weight;owners[v.vertex_index]=name
 rows=[]
 for bone in MAJOR:
  world=vertices[owners==bone]
  if len(world)<5:continue
  points=(np.c_[world,np.ones(len(world))]@np.linalg.inv(bind[bone]).T)[:,:3]
  centre=points.mean(axis=0);_,_,axes=np.linalg.svd(points-centre,full_matrices=False);axis=axes[0]
  longitudinal=(points-centre)@axis;radial=np.linalg.norm(points-centre-longitudinal[:,None]*axis,axis=1)
  radius=float(np.quantile(radial,.98));lo=float(longitudinal.min());hi=float(longitudinal.max());inset=min(radius,(hi-lo)/2)
  rows.append({'bone':bone,'endpoint1':(centre+axis*(lo+inset)).tolist(),'endpoint2':(centre+axis*(hi-inset)).tolist(),'radius':radius,'fitVertices':len(points)})
 return rows

def source_geometry(actor,motion,sample,declared):
 cls,folder={'pikachu':(PikachuNativePose,PM),'donkeykong':(DonkeyKongNativePose,DM),'link':(LinkNativePose,LM)}[actor]
 pose=cls(folder/(motion+'.nuanmb'));names=list(dict.fromkeys(['Trans','Hip']+[r.get('bone',{}).get('label')if isinstance(r.get('bone'),dict)else r['bone']for r in declared]))
 matrices=pose.matrices(sample,names);trans=matrices['Trans'][:3,3];result=[]
 for i,row in enumerate(declared):
  bone=row['bone']['label']if isinstance(row['bone'],dict)else row['bone'];m=matrices[bone]
  radius=float(row.get('size',row.get('radius'))*max(np.linalg.norm(m[:3,j])for j in range(3))*5)
  ends=[]
  for endpoint in ['endpoint1','endpoint2']:
   v=(m@np.array([*row[endpoint],1]))[:3]-trans;ends.append(np.array([v[2]*5,-v[1]*5]))
  result.append({'id':str(i)+'.'+bone,'region':'head'if'head'in bone.lower()else'leg'if any(q in bone.lower()for q in ['leg','knee','foot'])else'arm'if any(q in bone.lower()for q in ['shoulder','arm','hand'])else'torso','start':ends[0],'end':ends[1],'radius':radius})
 hip=matrices['Hip'][:3,3]-trans
 return result,np.array([hip[2]*5,-hip[1]*5]),pose.provenance()

def authored_cell(cell,clip,pivot,angle,scale,pulse):
 radians=angle*math.pi/180;rot=np.array([[math.cos(radians),-math.sin(radians)],[math.sin(radians),math.cos(radians)]])*scale
 shift=pivot-rot@pivot
 src_scale=clip['scaleToWorld'];matrix=rot*(src_scale/SCALE);offset=ORIGIN+shift/SCALE-matrix@np.array(clip['root'])
 inverse=np.linalg.inv(matrix);translation=-inverse@offset
 result=cell.transform(SIZE,Image.Transform.AFFINE,(*inverse[0],translation[0],*inverse[1],translation[1]),resample=Image.Resampling.BICUBIC)
 body_bounds=result.getbbox();assert body_bounds is not None
 # Source identity colours remain visible under a small intermittent cool flash.
 pixels=np.asarray(result).copy();alpha=pixels[:,:,3]>0
 if pulse:
  amount=.10 if pulse%2 else .18;pixels[alpha,:3]=(pixels[alpha,:3]*(1-amount)+np.array([175,222,255])*amount).astype(np.uint8)
 result=Image.fromarray(pixels);mask=Image.fromarray(pixels[:,:,3]);outer=mask.filter(ImageFilter.MaxFilter(7));rim=np.maximum(0,np.asarray(outer).astype(int)-np.asarray(mask).astype(int)).astype(np.uint8)
 aura=Image.new('RGBA',SIZE,(125,191,255,0));aura.putalpha(Image.fromarray((rim*.55).astype(np.uint8)));aura.alpha_composite(result)
 d=ImageDraw.Draw(aura);x0,y0,x1,y1=body_bounds
 for n in range(4):
  side=-1 if n%2 else 1;cx=x0-8 if side<0 else x1+8;cy=y0+(y1-y0)*(n+1)/5
  zig=[(cx-side*6,cy-20),(cx+side*7,cy-7),(cx-side*5,cy+2),(cx+side*8,cy+18)]
  d.line(zig,fill=(108,183,255,230),width=5);d.line(zig,fill=(231,250,255,255),width=2)
 assert aura.getbbox()[0]>1 and aura.getbbox()[1]>1 and aura.getbbox()[2]<SIZE[0]-1 and aura.getbbox()[3]<SIZE[1]-1,'Authored victim clipped'
 return aura,rot,shift,body_bounds

def main():
 OUT.mkdir(parents=True,exist_ok=True);all_rows=[]
 source_caps=json.loads((ROOT/'docs/review/2026-10-06/pikachu-character/sources/native-hurtbox-capsules.json').read_text())['capsules']
 dk_caps=json.loads((ROOT/'docs/review/2026-09-25/donkeykong-character/sources/authored-anatomical-capsules.json').read_text())['regions']
 declarations={'pikachu':source_caps,'donkeykong':dk_caps,'link':link_declarations()}
 # Genuine authored phase/sample identity; the base source pose is recorded
 # separately and is never exposed as a native Final victim sample.
 phases={'caught':[(0,-13,1.00,1),(1,8,.97,2),(1,-5,.98,1)],
  'vortex':[(1,-16,.97,2),(2,12,1.01,1),(1,-8,.96,2),(0,16,1.00,1),(2,-11,.98,2),(1,7,1.00,1)],
  'burst_pre':[(1,-8,.95,1),(0,5,.92,2),(0,-3,.90,3)]}
 for actor,centre in [('pikachu',-25),('donkeykong',-42),('link',-36)]:
  directory=OUT/actor;(directory/'animations').mkdir(parents=True,exist_ok=True)
  bank=json.loads((ROOT/'assets/characters'/actor/'frames.json').read_text());key='f02damageelec'if actor=='link'else'hurt';clip=bank['animations'][key]
  motion={'pikachu':'f00damagen1','donkeykong':'f00damagen2','link':'f02damageelec'}[actor]
  profiles={};animations={};recipes={};geometry_cache={}
  for phase,jobs in phases.items():
   sheet='final_victim_volt_'+phase;drawings=[];page=Image.new('RGBA',(SIZE[0]*len(jobs),SIZE[1]));review=Image.new('RGB',(300*len(jobs),340),'#23334a');recipe_rows=[]
   for index,(source_index,angle,scale,pulse)in enumerate(jobs):
    # Link's actual electrical body source has ten poses. Spread its authored
    # seed choices across the early/mid electric animation, not the ordinary flinch.
    if actor=='link':source_index=[1,3,5][source_index]
    native=clip['nativeSampleIndices'][source_index]-(0 if actor=='pikachu'else 1)
    if source_index not in geometry_cache:geometry_cache[source_index]=source_geometry(actor,motion,native,declarations[actor])
    source_receiving,hip,provenance=geometry_cache[source_index];cell=load_cell(actor,clip,source_index)
    picture,rot,shift,bounds=authored_cell(cell,clip,np.array([0.,float(centre)]),angle,scale,pulse);page.alpha_composite(picture,(index*SIZE[0],0))
    receiving=[]
    for c in source_receiving:
     ends=[rot@c[k]+shift for k in ['start','end']]
     receiving.append({'id':actor+'.'+sheet+'.'+c['id'],'region':c['region'],'start':dict(zip(('x','y'),ends[0].tolist())),'end':dict(zip(('x','y'),ends[1].tolist())),'radius':c['radius']*scale})
    anchor=rot@hip+shift;duration=2 if phase=='vortex'else 3
    drawings.append({'startAge':index*duration,'endAgeExclusive':(index+1)*duration,'frameIndex':index,'nativeSample':None,'authoredSampleIndex':index,
     'receiving':receiving,'attachments':[{'role':'capture-anchor','point':dict(zip(('x','y'),anchor.tolist()))}],
     'originX':ORIGIN[0]/SIZE[0],'originY':ORIGIN[1]/SIZE[1],'captureSupport':None})
    recipe_rows.append({'authoredSampleIndex':index,'sourceSheet':key,'sourceArtFrameIndex':source_index,'baseNativeMotion':motion,'baseNativeRawSample':native,
     'angleDegrees':angle,'uniformScale':scale,'pivotWorld':[0,centre],'pulse':pulse,'baseMotionProvenance':provenance,'bodyBoundsBeforeDecorativeElectricity':bounds})
    check=picture.copy();d=ImageDraw.Draw(check)
    for c in receiving:
     points=[tuple(ORIGIN+np.array([c[k]['x'],c[k]['y']])/SCALE)for k in ['start','end']];radius=c['radius']/SCALE
     d.line(points,fill='#b79aff',width=2)
     for x,y in points:d.ellipse((x-radius,y-radius,x+radius,y+radius),outline='#b79aff',width=2)
    bounds=check.getbbox();check=check.crop(bounds);check.thumbnail((290,300));review.paste(check,(index*300+(300-check.width)//2,35),check)
    ImageDraw.Draw(review).text((index*300+6,6),f'{actor} {phase} recipe{index}',fill='white')
   recipe={'schema':'authored-volt-recipient-recipe/1','actor':actor,'phase':phase,'sourceArtwork':str((ROOT/'assets/characters'/actor/clip['strip']).relative_to(ROOT)),
    'sourceArtworkSha256':sha(ROOT/'assets/characters'/actor/clip['strip']),'sourceMetadataClip':clip,'operatorSha256':sha(__file__),'samples':recipe_rows,
    'precision':'New authored cinematic recipient from accepted identity art plus explicit similarity poses/electric treatment, independently posed native or authored-skin receiving under identical transform. Not an alias and not a recovered native Final victim dispatcher. ROOT/displacement fixed; no floor snap; decorative electric halo is not receiving.'}
   recipe_path=directory/(sheet+'-recipe.json');recipe_path.write_text(json.dumps(recipe,indent=2)+'\n');dest=directory/'animations'/(sheet+'.png');page.save(dest,optimize=True)
   profile={'coordinateOrigin':'actorSourceRoot','sourceSampleBasis':'authored-final-victim-recipe-index','authoredSourceIdentity':{'kind':'AUTHORED_FINAL_CINEMATIC_RECIPIENT','recipeId':actor+'.volt.'+phase+'.authored-v1','sha256':sha(recipe_path)},
    'sheet':sheet,'frameWidth':SIZE[0],'frameHeight':SIZE[1],'scaleToWorld':SCALE,'bodyCentreFromRootY':centre,'endAgeExclusive':len(jobs)*(2 if phase=='vortex'else 3),'terminalHold':True,'rootDelta':[{'x':0,'y':0}],'drawings':drawings}
   profiles[sheet]=profile;animations[sheet]={'strip':'animations/'+sheet+'.png','sha256':sha(dest),'frameCount':len(jobs),'frameWidth':SIZE[0],'frameHeight':SIZE[1],'columns':len(jobs),'rows':1,'root':ORIGIN.tolist(),'scaleToWorld':SCALE,'bodyCentreFromRootY':centre}
   panel=directory/(sheet+'-all-drawings.png');review.save(panel);all_rows.append({'actor':actor,'sheet':sheet,'drawings':len(jobs),'panel':str(panel.relative_to(ROOT)),'panelSha256':sha(panel),'recipe':str(recipe_path.relative_to(ROOT)),'recipeSha256':sha(recipe_path)})
  proposal={'animations':animations,'runtimeFinalVictimProfiles':{'schema':'authored-final-victim-profiles/1','targetFighter':actor,'profiles':profiles}}
  (directory/'metadata-proposal.json').write_text(json.dumps(proposal,indent=2)+'\n')
 (OUT/'index.json').write_text(json.dumps({'schema':'authored-volt-recipient-stage/1','rows':all_rows,'drawings':sum(r['drawings']for r in all_rows),'runtimeVerified':False},indent=2)+'\n')
 print(json.dumps({'actors':3,'profiles':9,'drawings':sum(r['drawings']for r in all_rows),'stage':str(OUT.relative_to(ROOT))}))
if __name__=='__main__':main()
