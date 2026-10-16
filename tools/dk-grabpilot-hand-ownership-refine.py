"""Bounded quarter label-only rear-cream-fist correction; no competition/fit."""
from pathlib import Path
import json,hashlib
import numpy as np
from PIL import Image,ImageDraw
ROOT=Path(__file__).resolve().parents[1]
ART=ROOT/'docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/art'
BOXES={'grab':(300,450,462,610,'handr'),'dash_grab':(350,365,520,550,'handr'),'pivot_grab':(1000,380,1210,540,'handl'),'grab_pull':(340,490,515,660,'handr'),'grab_hold':(280,505,448,664,'handr')}
COLORS=[(217,70,70),(170,65,170),(240,190,50),(75,150,230),(40,210,200),(30,160,80),(150,100,230),(60,90,200),(245,130,40),(130,185,50),(215,110,175),(100,215,140),(150,155,245),(245,130,150),(230,220,120)]
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def main():
    rows=[]
    for clip,native in [('grab',8),('dash_grab',11),('pivot_grab',12),('grab_pull',1),('grab_hold',1)]:
        stem=f'grabpilot-{clip}-native{native}-quarter-ownership';prior=ART/(stem+'1-proposal.json');j=json.loads(prior.read_text());out=ART/(stem+'2-proposal.json');assert not out.exists()
        target=ROOT/j['targetImage'];assert sha(target)==j['targetImageSha256'];a=np.asarray(Image.open(target).convert('RGBA'));labels=np.asarray(Image.open(ROOT/j['labelImage'])).copy();original=labels.copy();regions=list(j['regionLabelIds']);x0,y0,x1,y1,hand=BOXES[clip];roi=np.zeros(labels.shape,bool);roi[y0//4:(y1+3)//4,x0//4:(x1+3)//4]=True
        cream=roi&(labels>0)&(a[:,:,0]>170)&(a[:,:,1]>130)&(a[:,:,2]>65)&(a[:,:,0]>=a[:,:,1])&(a[:,:,1]>=a[:,:,2]);labels[cream]=j['regionLabelIds'][hand];changed=labels!=original;assert not np.any(changed&~cream)
        root=j['root'];scale=j['scaleToWorld'];records={};counts={};tint=np.zeros_like(a);tint[:,:,3]=np.where(labels>0,140,0)
        for i,r in enumerate(regions):
            yy,xx=np.where(labels==j['regionLabelIds'][r]);records[r]=np.stack(((xx+.5-root[0])*scale,42+(yy+.5-root[1])*scale),axis=1).round(6).tolist();counts[r]={'targetPixels':len(xx),'pixelBounds':None if not len(xx) else [int(xx.min()),int(yy.min()),int(xx.max()),int(yy.max())]};tint[labels==i+1,:3]=COLORS[i]
        label=ART/(stem+'2-labels.png');Image.fromarray(labels).save(label);overlay=Image.new('RGBA',tuple(j['dimensions']),(25,30,39,255));overlay.alpha_composite(Image.fromarray(a));overlay.alpha_composite(Image.fromarray(tint));draw=ImageDraw.Draw(overlay)
        for r in regions:
            yy,xx=np.where(labels==j['regionLabelIds'][r])
            if len(xx):draw.text((float(np.median(xx)),float(np.median(yy))),r,fill='white',stroke_width=1,stroke_fill='black')
        ov=ART/(stem+'2-overlay.png');overlay.save(ov);j.update({'state':'bounded_target_hand_labels_proposal_actual_review_pending','initialOwnershipProposal':str(prior.relative_to(ROOT)),'initialOwnershipProposalSha256':sha(prior),'projectedPointsByRegion':records,'targetRegionCounts':counts,'labelImage':str(label.relative_to(ROOT)),'labelImageSha256':sha(label),'overlayImage':str(ov.relative_to(ROOT)),'overlayImageSha256':sha(ov),'rearHandCorrection':{'ROIExclusiveFullArt':[x0,y0,x1,y1],'hand':hand,'changedLabelPixels':int(changed.sum()),'criterion':'actual visible opaque cream pixels in independently inspected rear fist ROI; no receiving primitive geometry used'},'targetRGBABytesUnchanged':True,'alphaOwnershipBoundaryUnchanged':bool(np.array_equal(labels>0,original>0)),'cachedCompetitionRepeated':False,'toolSha256':sha(Path(__file__))});assert j['alphaOwnershipBoundaryUnchanged'];out.write_text(json.dumps(j,indent=2)+'\n');rows.append({'clip':clip,'proposal':str(out.relative_to(ROOT)),'sha256':sha(out),'labelPixelsChanged':int(changed.sum())})
    receipt=ART/'grab-first-five-bounded-rear-hand-label-refinement.json';assert not receipt.exists();receipt.write_text(json.dumps({'state':'label_only_derivatives_actual_review_pending','rows':rows,'canonicalWrites':False,'nativeEvaluationRun':False,'ownershipCompetitionRepeated':False,'fitterRun':False,'GPUUsed':False},indent=2)+'\n');print(receipt.name,sha(receipt))
if __name__=='__main__':main()
