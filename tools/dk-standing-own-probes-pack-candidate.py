"""Pack pinned, already selected own skin/gap points for the Match fixture.

No new point selection or receiving fit happens here. Rejected/mismatched data
fails closed; this packet remains future fixture input, never gameplay proof.
"""
from pathlib import Path
import argparse,json,hashlib,math
R=Path(__file__).resolve().parents[1]
AGES=[0,3,6,7,8,9,10,23,32,37]
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def load(pin):
 p=R/pin['path']
 if sha(p)!=pin['sha256']:raise ValueError('Exact own review/probe/candidate bytes changed')
 return json.loads(p.read_text())
def main():
 p=argparse.ArgumentParser();p.add_argument('--input-manifest',type=Path,required=True);p.add_argument('--expected-manifest-sha256',required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
 if a.output.exists():raise ValueError('Preserve prior packet')
 if sha(a.input_manifest)!=a.expected_manifest_sha256:raise ValueError('Exact manifest pin required')
 manifest=json.loads(a.input_manifest.read_text());cells=[];seen=set()
 for row in manifest['rows']:
  review=load(row['receivingReview']);packet=load(row['probePacket'])
  if review.get('state')!='ACTUAL_TARGET_RECEIVING_STATIC_ACCEPTED_MATCH_PENDING' or review.get('receivingAccepted') is not True:raise ValueError('Actual accepted own static receiving review required')
  candidate_pin=review['receivingCandidate'];candidate=load(candidate_pin)
  if packet.get('candidate')!=candidate_pin:raise ValueError('Probes must bind the exact finally accepted candidate')
  native=candidate['nativeSample'];age=native-1
  if candidate.get('clip')!='grab' or age not in AGES or age in seen or candidate['artFrameIndex']!=AGES.index(age):raise ValueError('Unique own canonical standing clock required')
  seen.add(age)
  if packet.get('nativeSample')!=native or packet.get('artFrameIndex')!=candidate['artFrameIndex']:raise ValueError('Probe art/native clocks differ')
  entries=[]
  if 'probes' in packet:
   for q in packet['probes']:
    if q.get('matchesExpectedFit') is not True:raise ValueError('Preserve rejected own probes; cannot publish them as accepted')
    entries.append((q,q['expected'],q['actorRelativeWorld'],q.get('name'),q['probeRadiusWorld']))
  else:
   for key,kind in [('skinProbes','skin'),('gapMisses','gap')]:
    for q in packet[key]:
     if q.get('analyticalPass') is not True:raise ValueError('Preserve rejected own probes; cannot publish them as accepted')
     entries.append((q,kind,q['actorRelativeWorldPoint'],q.get('id'),q['probeRadiusWorld']))
  points=[];names=set()
  for q,kind,point,name,static_radius in entries:
   if kind not in ['skin','gap'] or not isinstance(name,str) or not name.strip() or name in names:raise ValueError('Unique named actual expected skin/gap points required')
   if any(isinstance(point.get(k),bool) or not isinstance(point.get(k),(int,float)) or not math.isfinite(point[k]) for k in ['x','y']):raise ValueError('Finite unchanged own world point required')
   if not isinstance(static_radius,(int,float)) or isinstance(static_radius,bool) or not 0<static_radius<=.15:raise ValueError('Explicit bounded original static probe radius required')
   names.add(name)
   # The existing Match pulse fixture caps radius at .1. Smaller positive
   # circles retain a .15 static core inset; smaller gap circles also remain
   # clear. Original static radius is preserved as separate provenance.
   radius=min(static_radius,.1)
   points.append({'name':name,'core' if kind=='skin' else 'gap':dict(point),'radius':radius,'sourceStaticProbeRadius':static_radius,'radiusPolicy':'Existing Match fixture maximum .1; point/expectation unchanged','sourceQuarterPixel':q['quarterPixel']})
  if not any('core' in q for q in points) or not any('gap' in q for q in points):raise ValueError('Each own cell needs independent positive AND negative probes')
  cells.append({'sourceAge':age,'nativeSample':native,'artFrameIndex':candidate['artFrameIndex'],'targetImageSha256':candidate['targetImageSha256'],'receivingReview':row['receivingReview'],'probePacket':row['probePacket'],'receivingCandidate':candidate_pin,'probes':points})
 cells.sort(key=lambda c:c['sourceAge']);out={'state':'PINNED_OWN_STATIC_PROBES_PREPARED_FOR_FUTURE_MATCH','cells':cells,'manifest':{'path':str(a.input_manifest.resolve().relative_to(R)),'sha256':a.expected_manifest_sha256},'wholeTenCellsPresent':len(cells)==10,'pointsOrExpectationsReselected':False,'actualMatchVerified':False,'canonicalChanged':False,'limits':['This packet transports already selected independently expected own points; it is not a Match acceptance receipt.','Exact static receiving reviews and original probe radii remain pinned; existing Match radius adapter is explicit.']};a.output.write_text(json.dumps(out,indent=2)+'\n');print({'path':str(a.output),'sha256':sha(a.output),'cells':len(cells)})
if __name__=='__main__':main()
