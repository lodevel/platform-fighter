"""One genuinely missing native14 drawing, source/target/physical evidence.

No borrowed pose, original bank edits, source clocks or runtime verification.
"""
from pathlib import Path
import sys,json,hashlib,types,os,time,subprocess
sys.path[:0]=['tools','/tmp/pikachu-source-libs']
import numpy as np
from PIL import Image,ImageDraw
from link_author_raster_v2 import install_on_guide
from link_part_owned_equipment_v3 import apply
from link_physical_body_region_projection_v6 import project,REGIONS
from fit_anatomical_capsule_chain_v7_score_distance import fit
from link_immutable_input_stage_v1 import atomic_json
from final_dk_selective_crown_audit_v3 import hull
A=Path('docs/review/2026-10-12/link-character/rework/art')
D=A/'targeted-uair-native14-v1';D.mkdir(exist_ok=True)
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
assert not (D/'completed.json').exists()
old_plan=json.load(open(A/'ordinary-physical-corpus-fit-v1/plan.json'))
guards=dict(old_plan['inputHashes'])
for p in [Path(__file__),Path('tools/fit_anatomical_capsule_chain_v7_score_distance.py'),A.parent/'performance/compact-physical-operator-audit-v1/scores-v7/qualification.json']:
    guards[str(p)]=sha(p)
for p,h in guards.items():assert sha(p)==h,('FROZEN_INPUT_CHANGED',p)
motion=Path('assets/gen/link-native-reference/extracted/fighter/link/motion/body/c00/c05attackairhi.nuanmb')
assert sha(motion)=='94ec4923898617ca7f51c7e0c93dd971071f288c2a6f93e147a5c5deffbac591'
atomic_json(D/'frozen-inputs.json',{'inputHashes':guards,'sourceMotion':str(motion),'sourceMotionSha256':sha(motion),'nativeSample':14,'resource':'c05attackairhi','old1096And745Unchanged':True,'gameChecksRun':False})
prefix=D/'c05attackairhi-native14';guide=types.ModuleType('privateTargetedUairNative14');guide.__file__='tools/link-authored-guide.py'
code=Path(guide.__file__).read_text();exec(compile(code,guide.__file__,'exec'),guide.__dict__);install_on_guide(guide)
start=time.perf_counter();cpu=time.process_time();os.environ['LINK_AUTHOR_UV_MAP']='1'
guide.render('c05attackairhi',14,prefix,A/'uv-atlas-pilot/fresh-target-atlas-v4')
source_timing={'wallSeconds':time.perf_counter()-start,'cpuSeconds':time.process_time()-cpu}
record=Path(str(prefix)+'.json');m=json.load(open(record));assert m['nativeFrameIndex']==14 and m['motion']['sha256']==sha(motion)
final=Path(str(prefix)+'-final.png');subprocess.run(['python3',str('tools/link-cel-style.py'),str(prefix),str(final)],check=True)
rgba=np.array(Image.open(final).convert('RGBA'));revised=apply(rgba,np.array(Image.open(str(prefix)+'-object-ids.png')),np.array(Image.open(str(prefix)+'-semantic-ids.png')),m)
assert np.array_equal(rgba[:,:,3],revised[:,:,3]);Image.fromarray(revised).save(D/'c05attackairhi-native14-rgb-equipment-v3.png')
sharp=Image.fromarray(revised).resize((revised.shape[1]//2,revised.shape[0]//2),Image.Resampling.LANCZOS)
yy,xx=np.where(np.array(sharp)[:,:,3]>0);crop=[max(0,int(xx.min())-2),max(0,int(yy.min())-2),min(sharp.width,int(xx.max())+3),min(sharp.height,int(yy.max())+3)]
body=sharp.crop(crop);cell=D/'c05attackairhi-native14-sharp-cell.png';body.save(cell)
scale=10/float(m['artPixelsPerNativeUnit']);root=np.array(m['artRoot'],float)/2-np.array(crop[:2])
physical=D/'c05attackairhi-native14-physical';start=time.perf_counter();cpu=time.process_time();project(record,physical)
projection_timing={'wallSeconds':time.perf_counter()-start,'cpuSeconds':time.process_time()-cpu}
pad=int(np.ceil(1/scale))+2;dims=(body.width+pad*2,body.height+pad*2);fitroot=root+pad
def cropped(raw):
    image=Image.fromarray(raw.astype('uint8')*255)
    return np.array(image.crop((crop[0]-pad,crop[1]-pad,crop[2]+pad,crop[3]+pad)))>0
masks={}
for rr in REGIONS:
    im=Image.open(str(physical)+f'-physical-region-{rr}.png');a=np.array(im.resize((im.width//2,im.height//2),Image.Resampling.NEAREST))>0
    yy,xx=np.where(a)
    if len(xx):assert xx.min()>=crop[0]-pad and xx.max()<crop[2]+pad and yy.min()>=crop[1]-pad and yy.max()<crop[3]+pad,('PHYSICAL_CLIP',rr)
    masks[rr]=cropped(a)
union=np.logical_or.reduce(list(masks.values()));caps=[];parts=[];start=time.perf_counter();cpu=time.process_time()
for rr,name in REGIONS.items():
    mask=masks[rr]
    if not mask.any():parts.append({'part':name,'surfacePixels':0,'state':'NO_PROJECTED_ACTUAL_SURFACE'});continue
    chain,proof=fit(mask,union,1/scale);region='torso' if rr in(1,2) else 'foot' if rr in(11,14) else 'leg' if rr in(9,10,12,13) else 'arm'
    for i,(aa,bb,radius) in enumerate(chain):caps.append({'id':name+'-'+str(i),'region':region,'start':dict(zip(('x','y'),((aa-fitroot)*scale).tolist())),'end':dict(zip(('x','y'),((bb-fitroot)*scale).tolist())),'radius':float(radius*scale)})
    parts.append({'part':name,'runtimeRegion':region,'discreteFitProof':proof})
face_im=Image.open(str(physical)+'-physical-face-source.png').convert('RGBA');face=face_im.resize((face_im.width//2,face_im.height//2),Image.Resampling.LANCZOS);face=cropped(np.array(face)[:,:,3]>200)
recipe_path=A/'full-motion-authored-cranium-four-v2/cranial-recipe.json';recipe=json.load(open(recipe_path));tt,pp=np.meshgrid(np.linspace(0,2*np.pi,161),np.linspace(0,np.pi,81));unit=np.stack([np.cos(pp),np.sin(pp)*np.cos(tt),np.sin(pp)*np.sin(tt)],-1).reshape(-1,3);local=unit*np.array(recipe['radii'])+np.array(recipe['centre']);world=(np.c_[local,np.ones(len(local))]@np.array(m['sourceRigAnchors']['Head']).T)[:,:3]-np.array(m['capturedTrans']);points=np.c_[m['artRoot'][0]/2+world[:,2]*m['artPixelsPerNativeUnit']/2-crop[0]+pad,m['artRoot'][1]/2-world[:,1]*m['artPixelsPerNativeUnit']/2-crop[1]+pad]
assert (points.min(0)>=0).all() and (points.max(0)<np.array(dims)).all(),'CRANIAL_HULL_CLIP'
hm=Image.new('L',dims);ImageDraw.Draw(hm).polygon(hull(points),fill=255);dome=np.array(hm)>0;head=face|dome;head_caps=[]
for y in range(0,dims[1],3):
    yy,xx=np.where(head[y:min(y+3,dims[1])])
    if not len(xx):continue
    cy=y+float(yy.mean());head_caps.append({'id':'head-contour-'+str(len(head_caps)),'region':'head','start':dict(zip(('x','y'),((np.array([float(xx.min()),cy])-fitroot)*scale).tolist())),'end':dict(zip(('x','y'),((np.array([float(xx.max()),cy])-fitroot)*scale).tolist())),'radius':2.05*scale})
from fit_anatomical_capsule_envelope_v1 import capsule_coverage
yy,xx=np.where(head);pixels=np.c_[xx,yy].astype(float);covered=np.zeros(len(pixels),bool)
for cap in head_caps:
    aa=np.array([cap['start'][k] for k in ('x','y')])/scale+fitroot;bb=np.array([cap['end'][k] for k in ('x','y')])/scale+fitroot;covered|=capsule_coverage(pixels,aa,bb,2.05)
assert covered.all();top=points[np.argmin(points[:,1])];contact={'point':dict(zip(('x','y'),((top-fitroot)*scale).tolist())),'reviewKey':sha(recipe_path)+':c05attackairhi-raw14'}
fit_timing={'wallSeconds':time.perf_counter()-start,'cpuSeconds':time.process_time()-cpu}
row={'resource':'c05attackairhi','sourceIdentity':m['motion'],'sourceNativeSample':14,'logicalArtFrameIndex':59,'admission':'NEW_EXACT_NATIVE14_SAMPLE_ADDED_TO_OLD59_SPARSE_UAIR_DRAWINGS','sourceRecord':str(record),'sourceRecordSha256':sha(record),'historicalFrozenTarget':str(D/'c05attackairhi-native14-rgb-equipment-v3.png'),'historicalFrozenTargetSha256':sha(D/'c05attackairhi-native14-rgb-equipment-v3.png'),'ownerMask':str(prefix)+'-object-ids.png','ownerMaskSha256':sha(str(prefix)+'-object-ids.png'),'semanticMask':str(prefix)+'-semantic-ids.png','semanticMaskSha256':sha(str(prefix)+'-semantic-ids.png'),'packedCell':str(cell),'packedCellSha256':sha(cell),'knownRawRoot':m['artRoot'],'crop':crop,'registeredRootPixel':root.tolist(),'originX':float(root[0]/body.width),'originY':float(root[1]/body.height),'scaleToWorld':scale,'coordinateOrigin':'actorSourceRoot','bodyCentreFromRootY':-36,'uniformSupportRetargetY':0,'receiving':head_caps+caps,'headContact':contact,'parts':parts,'primitiveCount':len(head_caps+caps),'knownFaceEarPhysicalPixels':int(face.sum()),'authoredOnlyCranialPixels':int((dome&~face).sum()),'physicalHeadCoverageMissingPixels':0,'cranialRecipeSha256':sha(recipe_path),'projectionProvenance':str(physical)+'-physical-region-provenance.json','projectionProvenanceSha256':sha(str(physical)+'-physical-region-provenance.json'),'projectionPrefix':str(physical),'targetedSourceTiming':source_timing,'projectionTiming':projection_timing,'fittingTiming':fit_timing,'fitViewportPadding':pad,'retainedOtherDrawingCount':1096,'newCStageAdmissionCount':1097,'equipmentContext':'PENDING_ACTUAL_REACHABLE_SCRIPT_CONTEXT_SEPARATE_FROM_NATIVE14','supportOutgoingEquipmentRuntimeAccepted':False,'gameChecksRun':False}
atomic_json(D/'c05attackairhi-raw14-fit.json',row)
for p,h in guards.items():assert sha(p)==h,('FROZEN_INPUT_CHANGED_AT_END',p)
atomic_json(D/'completed.json',{'state':'EXACT_NATIVE14_TARGET_SHARP_AND_PHYSICAL_INPUT_COMPLETE_REVIEW_PENDING','row':str(D/'c05attackairhi-raw14-fit.json'),'rowSha256':sha(D/'c05attackairhi-raw14-fit.json'),'newCStageAdmissionCount':1097,'oldBanksUnchanged':True,'sourceMotionSha256':sha(motion),'sourceNativeSample':14,'gameChecksRun':False})
print('native14 genuinely rendered, sharp and fitted',len(caps+head_caps),flush=True)
