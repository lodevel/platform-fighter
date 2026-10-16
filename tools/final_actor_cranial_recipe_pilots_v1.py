"""Actor-specific authored scalp, independent from ear/hair-owned receiving.

Head-local ellipsoid dimensions are measured/authored from the frozen target
rig. They are target anatomical recipes, never native hurtbox/footstool data.
"""
from pathlib import Path
import sys,json,hashlib
sys.path[:0]=['/tmp/pikachu-source-libs','tools']
import numpy as np
from PIL import Image,ImageDraw
from dk_native_pose import DonkeyKongNativePose
from pikachu_native_pose import PikachuNativePose
A=Path('docs/review/2026-10-12/link-character/rework/art');D=A/'final-actor-cranial-six-pilots-v1';D.mkdir(exist_ok=True)
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
definitions={
 'donkeykong':{'centre':[2.2,2.6,0.],'radii':[4.1,3.8,3.4],
  'referenceFit':'FrozenHead bind origin24.2338Y/3.5327Z; authored rounded braincase upperbind scalp30.5338Y belowactual S_Hair tuft. Actualface/muzzle/ear mesh remains receiving independently. CosmeticS_Hair1/2 owners excluded; no physicalHead-weight minY contact.',
  'headOwnedSourceBindLimits':{'nativeModelXYZmin':[-3.9317100048065186,21.18910026550293,.5392100214958191],'nativeModelXYZmax':[3.9317100048065186,31.239599227905273,11.516200065612793]},
  'precision':'AUTHORED_TARGET_CRANIAL_ENVELOPE_NOT_NATIVE_CAPSULE'},
 'pikachu':{'centre':[.8,1.0,0.],'radii':[2.75,2.45,2.3],
  'referenceFit':'FrozenHead bind origin7.20384Y/.35965Z; authored scalpupperbind10.75384Y agreeswithactual Headownedskullupper10.78110Y, excludesseparate EarL1/2+EarR1/2 tips from crownonly. ActualallEar surfaces remain receiving.',
  'headOwnedSourceBindLimits':{'nativeModelXYZmin':[-2.7115700244903564,5.720570087432861,-2.1416800022125244],'nativeModelXYZmax':[2.7115700244903564,10.781100273132324,3.979020118713379]},
  'precision':'AUTHORED_TARGET_CRANIAL_ENVELOPE_NOT_NATIVE_CAPSULE'}}
for actor,recipe in definitions.items():
 recipe.update({'actor':actor,'space':'Head-bone-local nativeunits, sourcecolumn-vector hierarchy. Head-localX maps bindworldup; Yforward, Zlateral. Same actualbodypose Head matrix minus capturedTrans once.',
  'sampling':{'thetaPoints':161,'phiPoints':81,'thetaSpan':'0..2pi','phiSpan':'0..pi'},'contactSelection':'Uppermost WORLD-Y point of authored cranium only afteractualpose projection; notHeadmask, ear tips, hairtuft orcosmetic extent.',
  'receiving':'ActualselectedphysicalHead/face/ears union separatelyauthoredknownbraincase. No nativecapsule/vulnerability parity, margin/geometryretarget explicit.',
  'support':'No supportretarget yet; actorSOURCE ROOT fixed. Laterqualifieduniformsupport applies exactlyonce toreceiving, contact, sockets andFXpoints.',
  'authorOperator':str(Path(__file__)),'authorOperatorSha256':sha(__file__),'visualReview':'PENDING_ACTUAL_SIX_SCALP_AND_CROWN_REVIEW'})
 (D/(actor+'-cranial-recipe.json')).write_text(json.dumps(recipe,indent=2)+'\n')
pilots=json.load(open(A/'final-target-part-six-preparation-v1/index.json'))['rows'];indexes={actor:json.load(open(A/f'final-toon-sharp-pages-review-v1-{actor}/index.json'))for actor in definitions};out=[]
theta,phi=np.meshgrid(np.linspace(0,2*np.pi,161),np.linspace(0,np.pi,81));unit=np.stack([np.cos(phi),np.sin(phi)*np.cos(theta),np.sin(phi)*np.sin(theta)],-1).reshape(-1,3)
def hull(points):
 p=sorted(set(map(tuple,points)))
 def cross(a,b,c):return(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
 def half(seq):
  result=[]
  for q in seq:
   while len(result)>=2 and cross(result[-2],result[-1],q)<=0:result.pop()
   result.append(q)
  return result
 return half(p)[:-1]+half(p[::-1])[:-1]
for r in pilots:
 actor=r['actor'];recipe=definitions[actor];drawing=next(q for g in indexes[actor]['groups']if g['motion']==r['motion']for q in g['rows']if q['nativeSample']==r['nativeSample'])
 m=json.load(open(drawing['sourceRecord']));cls=DonkeyKongNativePose if actor=='donkeykong'else PikachuNativePose;pose=cls(Path('/mnt/c/workspace/platform-fighter')/m['motion']['path']);mat=pose.matrices(r['nativeSample'],['Head','Trans']);head=mat['Head'];trans=mat['Trans'][:3,3]
 if actor=='donkeykong':assert np.array_equal(head,np.asarray(m['bone_matrices']['Head']))
 local=unit*np.array(recipe['radii'])+np.array(recipe['centre']);world=(np.c_[local,np.ones(len(local))]@head.T)[:,:3]-trans
 crown=world[np.argmax(world[:,1])];contact={'x':float(crown[2]*5),'y':float(-crown[1]*5)}
 root=np.array(drawing['knownRootAfterExactReductionCrop']);scale=drawing['scaleToWorld'];points=root+np.c_[world[:,2]*5,-world[:,1]*5]/scale;boundary=hull(points)
 cell=Image.open(drawing['cell']).convert('RGBA');mask=Image.new('L',cell.size);ImageDraw.Draw(mask).polygon(boundary,fill=70);overlay=Image.new('RGBA',cell.size,(97,200,255,0));overlay.putalpha(mask)
 view=Image.new('RGBA',cell.size,'#182738');view.alpha_composite(cell);view.alpha_composite(overlay);dr=ImageDraw.Draw(view)
 dr.line(boundary+[boundary[0]],fill='#88dcff',width=2);pixel=root+np.array([contact['x'],contact['y']])/scale;dr.line([(pixel[0]-6,pixel[1]),(pixel[0]+6,pixel[1])],fill='#ff7ecc',width=2);dr.line([(pixel[0],pixel[1]-6),(pixel[0],pixel[1]+6)],fill='#ff7ecc',width=2)
 key=actor+'-'+r['motion']+'-raw'+str(r['nativeSample']);path=D/(key+'-cranial-crown.png');view.save(path);mp=D/(key+'-authored-cranial-envelope.png');mask.point(lambda x:255 if x else 0).save(mp)
 out.append({'actor':actor,'resource':r['motion'],'nativeSample':r['nativeSample'],'sourceRecord':drawing['sourceRecord'],'sourceRecordSha256':drawing['sourceRecordSha256'],
  'view':str(path),'viewSha256':sha(path),'physicalCranialEnvelope':str(mp),'physicalCranialEnvelopeSha256':sha(mp),
  'recipe':str(D/(actor+'-cranial-recipe.json')),'recipeSha256':sha(D/(actor+'-cranial-recipe.json')),'headContact':{'point':contact,'reviewKey':sha(D/(actor+'-cranial-recipe.json'))+':'+key},
  'actualHeadMatrix':head.tolist(),'actualCapturedTrans':trans.tolist(),'root':root.tolist(),'scaleToWorld':scale,'noEarTuftMaskMinYUsed':True,'gameChecksRun':False})
(D/'index.json').write_text(json.dumps({'state':'SIX_ACTOR_SPECIFIC_AUTHORED_CRANIUM_CROWN_REVIEW_PENDING','rows':out,'gameChecksRun':False},indent=2)+'\n')
