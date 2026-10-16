"""Lightweight immutable-probe diagnostics/views for an executed own branch fit.
No fitting, native evaluation, label editing or probe reselection.
"""
from pathlib import Path
import argparse,copy,hashlib,json,math
from PIL import Image,ImageDraw,ImageOps
R=Path(__file__).resolve().parents[1];D=R/'.tmp/dk-grab-receiving-preparation'
def pin(p):return {'path':str(p.resolve().relative_to(R)),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
def dist(q,a,z):
 v=[z[i]-a[i] for i in (0,1)];d=sum(x*x for x in v);t=max(0,min(1,sum((q[i]-a[i])*v[i] for i in (0,1))/max(1e-12,d)));return math.hypot(*(q[i]-a[i]-t*v[i] for i in (0,1)))
p=argparse.ArgumentParser();p.add_argument('--native',type=int,choices=[4,7,33],required=True);p.add_argument('--candidate',type=Path,required=True);p.add_argument('--output-stem',type=Path,required=True);a=p.parse_args();c=json.loads(a.candidate.read_text());adapter=c['ownHandBranchAdaptation'];basep=R/adapter['baseCandidate']['path'];assert pin(basep)==adapter['baseCandidate'];b=json.loads(basep.read_text());boxes=c['hurtboxPoses'][0]['hurtboxes'];old=b['hurtboxPoses'][0]['hurtboxes'];assert boxes[:len(old)]==old;assert c['targetImageSha256']==b['targetImageSha256'];assert c['nativeSample']==a.native
ownp=Path(c['targetOwnershipProposal']);o=json.loads(ownp.read_text());assert pin(ownp)['sha256']==c['targetOwnershipProposalSha256'];target=R/o['targetImage'];assert pin(target)['sha256']==o['targetImageSha256'];im=Image.open(target).convert('RGBA');labels=Image.open(R/o['labelImage']);assert pin(R/o['labelImage'])['sha256']==o['labelImageSha256'];root=o['root'];scale=o['scaleToWorld']
if a.native==7:
 pp=D/'fullgrab-standing-native7-own-hand-core-probes.json';pr=json.loads(pp.read_text());probes=copy.deepcopy(pr['probes']+pr['gapMisses'])
elif a.native==4:
 pp=D/'fullgrab-standing-native4-own-raised-hand-core-proposal.json';pr=json.loads(pp.read_text());probes=copy.deepcopy(pr['probes'])
else:
 pp=D/'native33-38-extra-own-finger-probe-review.json';pr=json.loads(pp.read_text());probes=copy.deepcopy(next(r['probes'] for r in pr['rows'] if r['nativeSample']==33))
for q in probes:
 kind=q.get('kind',q.get('expected'));point=q['actorRelativeWorldPoint'];x,y=q['quarterPixel'];q['kind']=kind;q['probeRadiusWorld']=.15;q['actualTargetRGBARechecked']=list(im.getpixel((x,y)));q['actualOwnershipLabelRechecked']=labels.getpixel((x,y));insets=[]
 for box in boxes:
  z=box['capsule'];v=z['radius']-dist([point['x'],point['y']],[z['start']['x'],z['start']['y']],[z['end']['x'],z['end']['y']]);insets.append((v,box['id'],box['region']))
 q['finalAllPrimitiveMaximumInsetWorld']=max(i[0] for i in insets);q['finalOwnRegionMaximumInsetWorld']=max((i[0] for i in insets if i[2]==q['region']),default=-1e9);q['finalContainingPrimitiveIds']=[i[1] for i in insets if i[0]>=.15];q['finalAnalyticalPass']=q['finalOwnRegionMaximumInsetWorld']>=.15 if kind=='skin' else q['finalAllPrimitiveMaximumInsetWorld']<=-.15
 assert im.getpixel((x,y))[3]>=32 if kind=='skin' else im.getpixel((x,y))[3]==0
bg=Image.new('RGBA',im.size,(25,30,39,255));bg.alpha_composite(im);draw=ImageDraw.Draw(bg)
for j,box in enumerate(boxes):
 k=box['capsule'];r=k['radius']/scale;z=[(root[0]+k[v]['x']/scale,root[1]+(k[v]['y']-42)/scale) for v in ['start','end']];theta=math.atan2(z[1][1]-z[0][1],z[1][0]-z[0][0]);outline=[]
 for centre,phase in [(z[1],theta-math.pi/2),(z[0],theta+math.pi/2)]:
  for t in range(17):ang=phase+math.pi*t/16;outline.append((centre[0]+r*math.cos(ang),centre[1]+r*math.sin(ang)))
 draw.line(outline+[outline[0]],fill=(70,245,215) if j>=len(old) else (65,145,235),width=1)
for q in probes:
 x,y=q['quarterPixel'];draw.ellipse((x-1,y-1,x+1,y+1),fill=(80,255,100) if q['kind']=='skin' else (255,60,220))
light=Image.new('RGBA',im.size,(248,246,237,255));light.alpha_composite(im);sheet=Image.new('RGB',(im.width*2,im.height+24),(25,30,39));sheet.paste(bg.convert('RGB'),(0,24));sheet.paste(light.convert('RGB'),(im.width,24));ImageDraw.Draw(sheet).text((4,4),f'Native{a.native}: complete fixed original + new receiving; independent fixed probes',fill='white');stem=a.output_stem.resolve();assert not stem.with_suffix('.json').exists();sheetp=stem.with_name(stem.name+'-allprimitive-dark-light.png');sheet.save(sheetp)
world=Image.new('RGB',(650,290),(25,30,39));s=bg.resize((round(im.width*scale),round(im.height*scale)),Image.Resampling.LANCZOS);world.paste(s.convert('RGB'),(10,30));world.paste(ImageOps.mirror(s).convert('RGB'),(340,30));wp=stem.with_name(stem.name+'-bothfaces-world.png');world.save(wp)
hand=[q['quarterPixel'] for q in probes];xs=[q[0] for q in hand];ys=[q[1] for q in hand];dp=stem.with_name(stem.name+'-hand-detail.png');crop=bg.crop((min(xs)-12,min(ys)-12,max(xs)+12,max(ys)+12));crop.resize((crop.width*6,crop.height*6),Image.Resampling.NEAREST).save(dp)
nonhand=lambda rows:[v for v in rows if v['region']!='handl'];nh=hashlib.sha256(json.dumps(nonhand(boxes),separators=(',',':'),ensure_ascii=False).encode()).hexdigest();assert nonhand(boxes)==nonhand(old)
r={'state':'OWN_BRANCH_FINAL_ACTUAL_VISUAL_REVIEW_PENDING','nativeSample':a.native,'candidate':pin(a.candidate),'baseCandidate':pin(basep),'ownershipProposal':pin(ownp),'target':pin(target),'fixedProbePacket':pin(pp),'probes':probes,'allFixedSkinCoresPass':all(q['finalAnalyticalPass'] for q in probes if q['kind']=='skin'),'allFixedAllPrimitiveGapMissesPass':all(q['finalAnalyticalPass'] for q in probes if q['kind']=='gap'),'allOriginalPrimitiveSerializationUnchanged':True,'allNonHandPrimitiveSerializationSha256':nh,'branchMetrics':adapter,'floorMaxY':max(max(v['capsule'][e]['y'] for e in ['start','end'])+v['capsule']['radius'] for v in boxes),'actualViews':[pin(sheetp),pin(wp),pin(dp)],'actualReceivingAccepted':False,'actualMatterContactsVerified':False,'canonicalChanged':False,'tool':pin(Path(__file__))};out=stem.with_suffix('.json');out.write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(pin(out)))
