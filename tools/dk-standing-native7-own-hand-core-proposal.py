"""Actual native7 pixel-selected skin/gap probes; no receiving-derived coordinates."""
from pathlib import Path
import json,hashlib
from PIL import Image,ImageDraw
R=Path(__file__).resolve().parents[1];D=R/'.tmp/dk-grab-receiving-preparation';op=D/'fullgrab-standing-native7-ownership-proposal.json';o=json.loads(op.read_text());im=Image.open(R/o['targetImage']).convert('RGBA');labels=Image.open(R/o['labelImage']);scale=5/6.5
skin=[(231,129),(243,138),(247,151),(244,163),(237,174)];gaps=[(238,134),(249,144),(250,157),(245,170),(242,183)];palm=(218,156)
def pin(p):return {'path':str(p.relative_to(R)),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
def record(point,name,kind):
 x,y=point;rgba=im.getpixel(point);label=labels.getpixel(point);assert (label==6 and rgba[3]>=192) if kind=='skin' else (label==0 and rgba[3]==0)
 return {'id':name,'region':'handl','kind':kind,'quarterPixel':[x,y],'actualTargetRGBA':list(rgba),'actualOwnershipLabel':label,'actorRelativeWorldPoint':{'x':(x+.5-128)*scale,'y':42+(y+.5-208)*scale},'probeRadiusWorld':.15,'selection':'Independently selected actual native7 target pixels from directly viewed open hand; not receiving geometry.','fitCoreInsetAndAllPrimitiveGapClearance':'pending actual fit'}
probes=[record(palm,'handl-palm-core','skin')]+[record(p,f'handl-exposed-branch-{i+1}','skin') for i,p in enumerate(skin)];miss=[record(p,f'handl-adjacent-gap-{i+1}','gap') for i,p in enumerate(gaps)]
view=Image.new('RGBA',im.size,(25,30,39,255));view.alpha_composite(im);draw=ImageDraw.Draw(view)
for p in probes+miss:
 x,y=p['quarterPixel'];col=(0,250,70) if p['kind']=='skin' else (255,30,220);draw.ellipse((x-1.1,y-1.1,x+1.1,y+1.1),fill=col)
vp=D/'native7-own-skin-gap-probes-target.png';assert not vp.exists();view.convert('RGB').save(vp);detail=D/'native7-own-skin-gap-probes-detail.png';view.crop((195,108,265,190)).resize((420,492),Image.Resampling.NEAREST).convert('RGB').save(detail)
core={'state':'ACTUAL_TARGET_LABEL_OWN_HAND_CORE_AND_GAP_PROPOSAL','sourceOwnershipProposalSha256':pin(op)['sha256'],'ownershipProposal':pin(op),'targetImage':{'path':o['targetImage'],'sha256':o['targetImageSha256']},'sourceAnatomy':{'path':o['sourceOwnershipPrior'],'sha256':o['sourceOwnershipPriorSha256']},'probes':probes,'gapMisses':miss,'actualTargetProbeView':pin(vp),'detailProbeView':pin(detail),'handPieceLimit':6,'geometryCoverageAccepted':False,'canonicalChanged':False};p=D/'fullgrab-standing-native7-own-hand-core-probes.json';assert not p.exists();p.write_text(json.dumps(core,indent=2)+'\n');print(pin(p))
