"""Lightweight own-label fixed segment proposal views; no geometry fitter."""
from pathlib import Path
import hashlib,json,math
from PIL import Image,ImageDraw,ImageOps
R=Path(__file__).resolve().parents[1];D=R/'.tmp/dk-grab-receiving-preparation';A=R/'docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/art'
def pin(p):return {'path':str(p.resolve().relative_to(R)),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
def branch(i,a,b,roi,role='digit'):return {'id':i,'role':role,'quarterStart':a,'quarterEnd':b,'roiPolygonQuarter':roi}
B={7:[
branch('upper-thumb',[220,144],[234,125],[[210,142],[222,137],[235,120],[239,122],[236,134],[223,149]]),
branch('upper-long',[224,148],[248,138],[[219,146],[229,143],[249,133],[253,135],[251,143],[235,152],[222,155]]),
branch('middle-long',[226,154],[252,150],[[221,152],[236,147],[254,145],[256,149],[254,155],[236,160],[222,161]]),
branch('lower-long',[224,160],[249,163],[[218,157],[236,160],[250,159],[252,164],[250,168],[233,169],[219,165]]),
branch('lowest',[220,165],[240,176],[[215,163],[227,169],[244,173],[245,178],[240,181],[225,178],[214,169]]),
branch('palm-core',[214,150],[220,161],[[207,141],[225,141],[232,154],[225,169],[211,170]],'palm')],
4:[
branch('folded-left',[96,55],[88,50],[[82,49],[91,47],[98,54],[96,61],[84,59]]),
branch('inner-raised',[99,52],[99,43],[[90,45],[98,37],[104,39],[107,53],[101,59],[91,55]]),
branch('tall-raised',[105,45],[112,27],[[100,43],[108,25],[112,21],[117,25],[116,37],[110,50],[103,52]]),
branch('right-spread',[113,58],[132,42],[[108,55],[119,51],[128,39],[135,39],[137,44],[128,54],[115,62]]),
branch('palm-core',[101,48],[103,55],[[93,47],[107,45],[115,54],[111,62],[99,62],[91,56]],'palm')],
33:[
branch('upright-thumb',[208,126],[211,102],[[199,107],[205,96],[213,95],[217,106],[215,130],[205,134]]),
branch('top-fold',[216,118],[228,112],[[213,106],[224,103],[234,110],[235,117],[219,126]]),
branch('middle-fold',[218,130],[230,125],[[214,119],[231,118],[235,122],[235,130],[222,138],[214,135]]),
branch('lower-fold',[214,136],[225,140],[[211,130],[224,132],[232,137],[230,145],[219,148],[211,143]]),
branch('palm-core',[209,121],[212,135],[[199,119],[215,116],[222,125],[222,140],[210,145],[200,137]],'palm')]
}
for n,branches in B.items():
 ownpath=(D if n==7 else A)/f'fullgrab-standing-native{n}-ownership-proposal.json'
 if n==4:ownpath=A/'fullgrab-standing-native4-redguard3-ownership-proposal.json'
 own=json.loads(ownpath.read_text());im=Image.open(R/own['targetImage']).convert('RGBA');lab=Image.open(R/own['labelImage']);assert pin(R/own['targetImage'])['sha256']==own['targetImageSha256'];assert pin(R/own['labelImage'])['sha256']==own['labelImageSha256'];idx=own['regionLabelIds']['handl'];checks=[]
 for b in branches:
  a=b['quarterStart'];z=b['quarterEnd'];count=max(2,math.ceil(math.dist(a,z))*4+1);bad=[]
  for k in range(count):
   t=k/(count-1);x=math.floor(a[0]+.5+(z[0]-a[0])*t);y=math.floor(a[1]+.5+(z[1]-a[1])*t)
   if lab.getpixel((x,y))!=idx or im.getpixel((x,y))[3]<32:bad.append([x,y])
  checks.append({'id':b['id'],'wholePixelCentreLineOwnAlpha32HandL':not bad,'badPixels':bad})
 if any(c['badPixels'] for c in checks):print(json.dumps({'native':n,'FAILED':checks}));continue
 base=A/f'fullgrab-standing-native{n}-reviewed-fit-indexed-candidate.json'
 if n==7:base=D/'fullgrab-standing-native7-reviewed-fit-indexed-candidate.json'
 if n==4:base=A/'fullgrab-standing-native4-redguard3-compact-fit-indexed-candidate.json'
 bc=json.loads(base.read_text());nonhand=[v for v in bc['hurtboxPoses'][0]['hurtboxes'] if v['region']!='handl'];out=D/f'fullgrab-standing-native{n}-own-hand-branch-layout01-proposal.json';assert not out.exists()
 p={'state':'OWN_HAND_FIXED_SEGMENT_LAYOUT_ACTUAL_INPUT_REVIEW_PENDING','clip':'grab','nativeSample':n,'artFrameIndex':own['artFrameIndex'],'sourceOwnershipProposalSha256':pin(ownpath)['sha256'],'targetImageSha256':own['targetImageSha256'],'labelImageSha256':own['labelImageSha256'],'sourceReceivingCandidate':pin(base),'allNonHandPrimitiveSerializationSha256':hashlib.sha256(json.dumps(nonhand,separators=(',',':'),ensure_ascii=False).encode()).hexdigest(),'branches':branches,'centrelineChecks':checks,'selection':'Finite own visible branch axes selected from actual target/labels and source pose, separately from independent held skin/gap probes. ROI is clipped to actual HandL alpha for coverage, never added as anatomy.','authoredMarginWorld':1,'groundedReceivingFloorMaximumY':42.55,'sourcePrior':{'path':own['sourceOwnershipPrior'],'sha256':own['sourceOwnershipPriorSha256']},'ownSupportWarp':own['sourcePriorFloorWarp'],'allOtherPrimitivesMustRemainByteEqual':True,'native8GeometryOrROIReused':False,'newHandPrimitiveMaximum':6,'actualFitPerformed':False}
 out.write_text(json.dumps(p,indent=2)+'\n');colors=['#ff8080','#ffdf60','#55ffb5','#85b8ff','#ed9aff','#ffffff'];views=[]
 for typ in ['target','labels']:
  view=Image.new('RGBA',im.size,(25,30,39,255));view.alpha_composite(im)
  if typ=='labels':
   tint=Image.new('RGBA',im.size,(0,0,0,0));td=ImageDraw.Draw(tint)
   for y in range(im.height):
    for x in range(im.width):
     if lab.getpixel((x,y))==idx:td.point((x,y),fill=(30,220,230,100))
   view.alpha_composite(tint)
  draw=ImageDraw.Draw(view)
  for k,b in enumerate(branches):
   roi=[tuple(x) for x in b['roiPolygonQuarter']];draw.line(roi+[roi[0]],fill=colors[k],width=1);draw.line([tuple(b['quarterStart']),tuple(b['quarterEnd'])],fill=colors[k],width=1);draw.text(tuple(b['quarterEnd']),str(k+1),fill=colors[k])
  pp=D/f'native{n}-own-hand-layout01-{typ}.png';view.save(pp);views.append(pin(pp))
  xs=[v[0] for b in branches for v in b['roiPolygonQuarter']];ys=[v[1] for b in branches for v in b['roiPolygonQuarter']];detail=view.crop((min(xs)-8,min(ys)-8,max(xs)+8,max(ys)+8));dp=D/f'native{n}-own-hand-layout01-{typ}-detail.png';detail.resize((detail.width*6,detail.height*6),Image.Resampling.NEAREST).save(dp);views.append(pin(dp))
 world=Image.new('RGB',(650,290),(25,30,39));v=Image.open(R/views[0]['path']);scaled=v.resize((round(384*5/6.5),round(256*5/6.5)),Image.Resampling.LANCZOS);world.paste(scaled.convert('RGB'),(10,30));world.paste(ImageOps.mirror(scaled).convert('RGB'),(340,30));wp=D/f'native{n}-own-hand-layout01-bothfaces-world.png';world.save(wp);views.append(pin(wp));vp=D/f'native{n}-own-hand-layout01-view-pins.json';vp.write_text(json.dumps({'proposal':pin(out),'actualViews':views,'tool':pin(Path(__file__))},indent=2)+'\n');print(json.dumps({'nativeSample':n,'proposal':pin(out),'views':pin(vp)}))
