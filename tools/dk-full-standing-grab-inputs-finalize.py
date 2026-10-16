"""Finalize exact ten separately reviewed standing samples, not whole action.

Root's separate ordered-body review remains mandatory before the packing builder
can emit reviewedInputs. This stdlib step never edits shipping assets/source.
"""
from pathlib import Path
import argparse,hashlib,json
R=Path(__file__).resolve().parents[1]
AGES=[0,3,6,7,8,9,10,23,32,37]
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def load(path,expected):
 if sha(path)!=expected:raise ValueError(f'Pinned bytes changed: {path}')
 return json.loads(path.read_text())
def pin(path):return {'path':str(path.resolve().relative_to(R)),'sha256':sha(path)}
def main():
 p=argparse.ArgumentParser()
 for name in ['partial-paired-manifest','partial-probe-index','native4-review','native4-probe-packet']:
  p.add_argument('--'+name,type=Path,required=True);p.add_argument('--expected-'+name+'-sha256',required=True)
 p.add_argument('--paired-output',type=Path,required=True);p.add_argument('--probe-index-output',type=Path,required=True);a=p.parse_args()
 if a.paired_output.exists() or a.probe_index_output.exists() or a.paired_output.resolve()==a.probe_index_output.resolve():raise ValueError('Preserve all original and partial outputs')
 paired=load(a.partial_paired_manifest,a.expected_partial_paired_manifest_sha256);index=load(a.partial_probe_index,a.expected_partial_probe_index_sha256);review=load(a.native4_review,a.expected_native4_review_sha256);probes=load(a.native4_probe_packet,a.expected_native4_probe_packet_sha256)
 if review.get('state')!='ACTUAL_TARGET_RECEIVING_STATIC_ACCEPTED_MATCH_PENDING' or review.get('receivingAccepted') is not True or review.get('nativeSample')!=4 or review.get('artFrameIndex')!=1:raise ValueError('Exact actually accepted root native4 receiving review required')
 candidate_pin=review.get('receivingCandidate');candidate=load(R/candidate_pin['path'],candidate_pin['sha256'])
 if probes.get('candidate')!=candidate_pin or probes.get('nativeSample')!=4 or probes.get('allFixedSkinCoresPass') is not True or probes.get('allFixedAllPrimitiveGapMissesPass') is not True:raise ValueError('Finally accepted native4 packet must bind all unchanged own skin/gap points')
 if not any(v==pin(a.native4_probe_packet) for v in review.values() if isinstance(v,dict)):raise ValueError('Root review must directly bind final actual probe packet pin')
 static=load(R/paired['sourceStaticManifest']['path'],paired['sourceStaticManifest']['sha256']);source=next(r for r in static['rows'] if r['nativeSample']==4)
 if candidate.get('targetImageSha256')!=source['quarterTarget']['sha256'] or candidate.get('nativeSample')!=4 or candidate.get('artFrameIndex')!=1 or candidate.get('clip')!='grab' or candidate['hurtboxPoses'][0]['artFrameIndex']!=1 or candidate['hurtboxPoses'][0]['nativeSample']!=4:raise ValueError('Final receiving does not bind own static target/native/art clock')
 native4={k:source[k] for k in ['clip','nativeSample','artFrameIndex','quarterTarget','staticReview','gameplayAge','frameWindow','root','scaleToWorld','bodyCentreFromRootY']};native4.update({'receivingCandidate':candidate_pin,'receivingReview':pin(a.native4_review),'staticAccepted':True,'receivingAccepted':True})
 rows=paired['rows']+[native4];rows.sort(key=lambda r:r['artFrameIndex']);cells=index['cells']+[{'sourceAge':3,'nativeSample':4,'artFrameIndex':1,'targetImageSha256':source['quarterTarget']['sha256'],'probeSchema':'art-branch-final','ownProbePacket':pin(a.native4_probe_packet),'receivingCandidate':candidate_pin,'acceptanceReview':pin(a.native4_review)}];cells.sort(key=lambda r:r['artFrameIndex'])
 if len(rows)!=10 or len(cells)!=10 or [r['gameplayAge'] for r in rows]!=AGES or [r['sourceAge'] for r in cells]!=AGES:raise ValueError('Exact10contiguous source-native sample ordering required')
 for i,(row,cell) in enumerate(zip(rows,cells)):
  if row['artFrameIndex']!=i or cell['artFrameIndex']!=i or row['nativeSample']!=AGES[i]+1 or cell['nativeSample']!=AGES[i]+1 or row['receivingAccepted'] is not True or row['staticAccepted'] is not True:raise ValueError('Every own static/receiving sample must already be independently accepted')
  for key in ['quarterTarget','staticReview','receivingCandidate','receivingReview']:
   if sha(R/row[key]['path'])!=row[key]['sha256']:raise ValueError(f'Exact accepted {key} bytes changed')
  if cell['receivingCandidate']!=row['receivingCandidate'] or cell['acceptanceReview']!=row['receivingReview']:raise ValueError('Body/probe recipe exact candidate-review identities differ')
 out={'state':'TEN_SEPARATE_STATIC_PAIRED_BODY_SAMPLES_ACCEPTED_WHOLE_BODY_REVIEW_PENDING','rows':rows,'sourceStaticManifest':paired['sourceStaticManifest'],'native4FinalReview':pin(a.native4_review),'allTenSeparateBodySamplesAccepted':True,'orderedWholeBodyReviewAccepted':False,'wholeActionQualified':False,'actualMatchVerified':False,'canonicalChanged':False}
 transport={'kind':'accepted-full-standing-own-probe-index','cells':cells,'sourcePartialIndex':pin(a.partial_probe_index),'native4FinalReview':pin(a.native4_review),'actualMatchVerified':False,'canonicalChanged':False}
 a.paired_output.write_text(json.dumps(out,indent=2)+'\n');a.probe_index_output.write_text(json.dumps(transport,indent=2)+'\n');print(json.dumps({'pairedManifest':pin(a.paired_output),'probeIndex':pin(a.probe_index_output)}))
if __name__=='__main__':main()
