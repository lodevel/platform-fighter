"""Own actual-label cores/background probes and immutable-fit static views.

Selects probe pixels from target labels before reading any receiving geometry.
Analytical fit diagnostics do not establish real Matter/contact behavior.
"""
from pathlib import Path
import argparse,json,hashlib
import numpy as np
from PIL import Image,ImageDraw
from scipy.ndimage import distance_transform_edt
R=Path(__file__).resolve().parents[1]
def pin(p):return {'path':str(p.relative_to(R)),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
def segment_distance(point,a,z):
 v=z-a;t=np.clip(np.dot(point-a,v)/max(1e-12,np.dot(v,v)),0,1);return float(np.linalg.norm(point-(a+t*v)))
p=argparse.ArgumentParser();p.add_argument('--ownership',type=Path,required=True);p.add_argument('--candidate',type=Path,required=True);p.add_argument('--overlay',type=Path,required=True);p.add_argument('--output-stem',type=Path,required=True);p.add_argument('--own-probes',type=Path);args=p.parse_args()
op=args.ownership.resolve();o=json.loads(op.read_text());target=R/o['targetImage'];assert pin(target)['sha256']==o['targetImageSha256'];im=Image.open(target).convert('RGBA');a=np.asarray(im)[:,:,3];labels=np.asarray(Image.open(R/o['labelImage']));assert pin(R/o['labelImage'])['sha256']==o['labelImageSha256'];root=np.asarray(o['root'],float);scale=o['scaleToWorld'];probe_radius=.15
ys,xs=np.indices(labels.shape);wx=(xs+.5-root[0])*scale;wy=42+(ys+.5-root[1])*scale;outside=(abs(wx)>30+probe_radius)|(abs(wy)>42+probe_radius)
cores=[]
for region in ['head','handl','handr','bust']:
 mask=(labels==o['regionLabelIds'][region])&(a>=192);edt=distance_transform_edt(mask);elig=mask&outside
 if not elig.any():elig=mask
 if not elig.any():raise ValueError('Missing own target-labelled region '+region)
 score=np.where(elig,edt,-1);y,x=np.unravel_index(score.argmax(),score.shape);cores.append({'id':region+'-actual-label-core','region':region,'kind':'skin','quarterPixel':[int(x),int(y)],'actualTargetRGBA':list(im.getpixel((int(x),int(y)))),'actualOwnershipLabel':int(labels[y,x]),'actorRelativeWorldPoint':{'x':float(wx[y,x]),'y':float(wy[y,x])},'targetLabelInteriorDistanceWorld':float(edt[y,x]*scale),'outsideMovementBody':bool(outside[y,x]),'probeRadiusWorld':probe_radius,'selection':'Largest own actual-label interior outside physical movement body when available; selected before reading candidate geometry.'})
neg=[];hand=labels==o['regionLabelIds']['handl'];hy,hx=np.where(hand);assert len(hx);distance=distance_transform_edt(a<32);nearhand=distance_transform_edt(~hand);eligible=(a==0)&outside&(distance*scale>=1.5)&(nearhand*scale<6)
for side in ['top','right','bottom']:
 gate=eligible.copy()
 if side=='top':gate&=ys<np.median(hy)
 elif side=='bottom':gate&=ys>np.median(hy)
 else:gate&=xs>np.median(hx)
 if not gate.any():continue
 score=np.where(gate,nearhand,-1e9);y,x=np.unravel_index(score.argmax(),score.shape);neg.append({'id':'handl-nearby-transparent-'+side,'region':'handl','kind':'gap','quarterPixel':[int(x),int(y)],'actualTargetRGBA':list(im.getpixel((int(x),int(y)))),'actualOwnershipLabel':0,'actorRelativeWorldPoint':{'x':float(wx[y,x]),'y':float(wy[y,x])},'alpha32ContourDistanceWorld':float(distance[y,x]*scale),'probeRadiusWorld':probe_radius,'selection':'Own actual fully transparent pixel outside movement body near hand contour; selected before reading receiving.'})
if args.own_probes:
 prior=json.loads(args.own_probes.read_text());assert prior['sourceOwnershipProposalSha256']==pin(op)['sha256'];cores=prior['probes']+cores;neg=prior['gapMisses']+neg
# Candidate is read only after target-labelled probes are fixed above.
cp=args.candidate.resolve();c=json.loads(cp.read_text());assert c['targetOwnershipProposalSha256']==pin(op)['sha256'];assert c['targetImageSha256']==o['targetImageSha256'];boxes=c['hurtboxPoses'][0]['hurtboxes']
for point in cores+neg:
 q=np.asarray([point['actorRelativeWorldPoint']['x'],point['actorRelativeWorldPoint']['y']]);rows=[]
 for box in boxes:
  k=box['capsule'];inset=k['radius']-segment_distance(q,np.asarray([k['start']['x'],k['start']['y']]),np.asarray([k['end']['x'],k['end']['y']]))
  rows.append((inset,box['id'],box['region']))
 point['allPrimitiveMaximumInsetWorld']=max(r[0] for r in rows);point['containingPrimitiveIds']=[r[1] for r in rows if r[0]>=point['probeRadiusWorld']];own=[r[0] for r in rows if r[2]==point['region']];point['ownRegionMaximumInsetWorld']=max(own,default=-1e9);point['analyticalPass']=point['ownRegionMaximumInsetWorld']>=probe_radius if point['kind']=='skin' else point['allPrimitiveMaximumInsetWorld']<=-probe_radius
ov=Image.open(args.overlay).convert('RGBA');assert ov.size==im.size;probe=Image.new('RGBA',im.size,(25,30,39,255));probe.alpha_composite(im);draw=ImageDraw.Draw(probe)
for point in cores+neg:
 x,y=point['quarterPixel'];col=(0,255,75) if point['kind']=='skin' else (255,20,230);draw.ellipse((x-1,y-1,x+1,y+1),fill=col)
world=Image.new('RGBA',(950,330),(25,30,39,255));dr=ImageDraw.Draw(world);dr.line((0,230,950,230),fill=(95,113,140));dr.text((8,8),f'{o["clip"]} native{o["nativeSample"]}: static receiving candidate; Match pending',fill=(230,230,230))
for cx,b,rx in [(160,ov,128),(470,ov.transpose(Image.Transpose.FLIP_LEFT_RIGHT),256),(790,probe,128)]:world.alpha_composite(b.resize((295,197),Image.Resampling.LANCZOS),(cx-round(rx*scale),230-round(208*scale)))
light=Image.new('RGBA',im.size,(247,246,238,255));light.alpha_composite(im);sheet=Image.new('RGB',(384*3,286),(25,30,39));dr=ImageDraw.Draw(sheet)
for i,(b,name) in enumerate([(ov,'fit overlay dark'),(light,'actual target light'),(probe,'own actual skin/gap probes')]):sheet.paste(b.convert('RGB'),(i*384,30));dr.text((i*384+4,8),name,fill=(230,230,230))
stem=args.output_stem.resolve();png=stem.with_name(stem.name+'-static-fit-target-probes.png');wp=stem.with_name(stem.name+'-bothfaces-world.png');receipt=stem.with_suffix('.json');assert not any(p.exists() for p in [png,wp,receipt]);sheet.save(png);world.convert('RGB').save(wp)
d={'state':'OWN_FIT_PROBES_ACTUAL_VISUAL_REVIEW_PENDING','clip':o['clip'],'nativeSample':o['nativeSample'],'artFrameIndex':o['artFrameIndex'],'ownershipProposal':pin(op),'candidate':pin(cp),'overlay':pin(args.overlay.resolve()),'target':pin(target),'skinProbes':cores,'gapMisses':neg,'allIndependentSkinCoresPass':all(p['analyticalPass'] for p in cores),'allIndependentGapMissesPass':all(p['analyticalPass'] for p in neg),'actualViews':[pin(png),pin(wp)],'receivingAccepted':False,'actualMatterContactsVerified':False,'canonicalChanged':False,'tool':pin(Path(__file__))};receipt.write_text(json.dumps(d,indent=2)+'\n');print(pin(receipt))
