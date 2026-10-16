#!/usr/bin/env python3
"""Eight-cell complete jab review draft; writes evidence only, never shipping."""
from pathlib import Path
import copy,hashlib,json
import numpy as np
from PIL import Image,ImageDraw,ImageOps
ROOT=Path(__file__).resolve().parents[1];ART=ROOT/'docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/art';RUNTIME=ART.parent/'runtime'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def main():
 proposalpath=RUNTIME/'full-jab-integration-proposal.json';proposal=json.loads(proposalpath.read_text());baseline=ROOT/'assets/characters/donkeykong/frames.json';metadata=json.loads(baseline.read_text());sourcefiles={1:'dk-firstclips-batch01-clean4-firstclips-jab-native1-quarter-candidate.png',3:'dk-firstclips-batch01-clean4-firstclips-jab-native3-quarter-candidate.png',5:'jab1-native5-packed-scale-0.25-candidate.png',6:'dk-firstclips-batch01-clean4-firstclips-jab-native6-quarter-candidate.png',7:'dk-firstclips-batch02-matte1-firstclips-jab-native7-quarter-candidate.png',9:'dk-firstclips-batch02-matte1-firstclips-jab-native9-quarter-candidate.png',17:'dk-firstclips-batch02-matte1-firstclips-jab-native17-quarter-candidate.png',24:'dk-firstclips-batch03-clean1-firstclips-jab-native24-quarter-candidate.png'}
 strip=Image.new('RGBA',(3072,256));world=Image.new('RGBA',(1180,520),(25,30,39,255));draw=ImageDraw.Draw(world);rows=[];hurts=[];attacks=[];pending=[]
 for row in proposal['poseRows']:
  i=row['artFrameIndex'];n=row['nativeSample'];imagepath=ART/sourcefiles[n];image=Image.open(imagepath).convert('RGBA');assert image.size==(384,256);strip.paste(image,(i*384,0));a=np.array(image);last=int(np.where(a[:,:,3]>=32)[0].max());floor=(last+.5-208)*5/6.5;assert abs(floor)<=.55
  col=i%4;line=i//4;x=col*295;y=line*260;draw.text((x+6,y+4),f'cell{i} native{n} age[{row["windowStart"]},{row["windowEndExclusive"]})',fill='white');draw.line((x,y+242,x+294,y+242),fill=(90,107,130));view=image.resize((round(384*5/6.5),round(256*5/6.5)),Image.Resampling.LANCZOS)
  for cx,face in [(x+72,1),(x+220,-1)]:
   v=view if face==1 else ImageOps.mirror(view);rx=round(128*5/6.5) if face==1 else v.width-round(128*5/6.5);world.alpha_composite(v,(cx-rx,y+242-round(208*5/6.5)))
  receivingpath=ROOT/row['receivingCandidate'] if row['receivingCandidate'] else ART/'jab-native24-clean1-quarter-receiving-candidate.json';record={**row,'image':str(imagepath.relative_to(ROOT)),'imageSha256':sha(imagepath),'alpha32FloorPixelCentreWorldDelta':floor,'receivingCandidate':str(receivingpath.relative_to(ROOT)),'receivingCandidateSha256':sha(receivingpath) if receivingpath.exists() else None}
  if receivingpath.exists():
   rp=json.loads(receivingpath.read_text());hurt=copy.deepcopy(rp['hurtboxPoses'][0]);hurt['artFrameIndex']=i;assert hurt['nativeSample']==n;hurts.append(hurt)
  else:pending.append({'nativeSample':n,'gap':'paired receiving fit pending'})
  ap=json.loads((ROOT/row['attackSourcePacket']).read_text());hits=ap.get('collisionHits')
  if hits is None:hits=ap['attackCollisionPoses'][0]['collisionHits']
  attacks.append({'artFrameIndex':i,'nativeSample':n,'collisionHits':[{'id':h['id'],'capsule':copy.deepcopy(h['capsule'])}for h in hits]});rows.append(record)
 stripfile=ART/'full-jab-eight-cell-quarter-draft.png';strip.save(stripfile);world.convert('RGB').save(ART/'full-jab-eight-cell-bothfaces-world-draft.png');registration={k:v for k,v in proposal['registration'].items() if k!='columns'}
 clip={'strip':'animations/jab.png',**registration,'sourceCells':[[i,0]for i in range(8)],'frameWindows':[{'startFrame':r['windowStart'],'endFrame':r['windowEndExclusive'],'artFrameIndex':r['artFrameIndex']}for r in rows],'loopDuration':None,'pairedActionTimeline':{'endFrame':24},'hurtboxPoses':hurts,'attackCollisionPoses':attacks,'artProvenance':{'state':'eight_separately_reviewed_source_clock_cells_draft_actual_packed_match_pending','receiving':'authored target contour; no native hit_data parity','discreteSampling':'Explicit held drawing windows outside active samples; source motion samples1/3/5/6/7/9/17/24'}}
 metadata['animations']['jab']=clip;draft=ART/'full-jab-frames-draft.json';draft.write_text(json.dumps(metadata,indent=2)+'\n');report={'state':'complete_eight_cell_atlas_draft_metadata_pairs_pending' if pending else 'complete_eight_cell_atlas_paired_metadata_draft_review_pending','registration':proposal['registration'],'sourceMetadata':str(baseline.relative_to(ROOT)),'sourceMetadataSha256':sha(baseline),'sourceProposal':str(proposalpath.relative_to(ROOT)),'sourceProposalSha256':sha(proposalpath),'strip':str(stripfile.relative_to(ROOT)),'stripSha256':sha(stripfile),'metadataDraft':str(draft.relative_to(ROOT)),'metadataDraftSha256':sha(draft),'poseRows':rows,'pending':pending,'shippingChanged':False,'actualAtlasViewed':False,'wholeClipStaticAccepted':False,'actualMatchVerified':False};(ART/'full-jab-eight-cell-draft-review.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'state':report['state'],'stripSha256':report['stripSha256'],'pending':pending},indent=2))
if __name__=='__main__':main()
