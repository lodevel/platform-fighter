"""Record explicitly completed saved body inspections, no live installation.

Run only after opening every --inspected sheet's saved paired image. This does
not establish runtime acceptance and never changes bitmap or receiving data.
"""
from pathlib import Path
import argparse,hashlib,json
ROOT=Path(__file__).resolve().parent.parent
parser=argparse.ArgumentParser();parser.add_argument('--stage',choices=['staged-events','staged-carry'],required=True);parser.add_argument('--inspected',nargs='+',required=True);parser.add_argument('--notes',required=True);args=parser.parse_args()
B=ROOT/'docs/review/2026-10-06/pikachu-character/art/completion-states-items';D=B/args.stage
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
receiptPath=D/'candidate.json';candidate=json.loads(receiptPath.read_text())
assert candidate['state'].endswith('review_pending'),'Reviewed candidate is immutable'
keys=[r['sheet'] for r in candidate['profiles']];assert len(args.inspected)==len(keys) and set(args.inspected)==set(keys)
for f in candidate['installFiles']:assert sha(ROOT/f['candidate'])==f['candidateSha256']
reviews=[]
for row in candidate['profiles']:
 images=row.get('pairedReviewFiles',[row.get('pairedReview')]);assert images and all(images)
 for path in images:
  image=ROOT/path;assert image.exists();reviews.append({'sheet':row['sheet'],'file':path,'sha256':sha(image)})
framesFile=next(f for f in candidate['installFiles'] if f['live'].endswith('/frames.json'));framesPath=ROOT/framesFile['candidate'];text=framesPath.read_text()
for f in candidate['installFiles']:
 if '/pose-batches/' not in f['live']:continue
 p=ROOT/f['candidate'];meta=json.loads(p.read_text());old=f['candidateSha256'];meta['state']='packed_cells_visually_reviewed_runtime_pending'
 meta['actualVisualReview']={'reviewer':'state_art_completion','notes':args.notes,'images':[r for r in reviews if r['sheet'] in meta['animations']],'runtimeQualified':False}
 p.write_text(json.dumps(meta,indent=2)+'\n');f['candidateSha256']=sha(p);assert old in text;text=text.replace(old,f['candidateSha256'])
framesPath.write_text(text);framesFile['candidateSha256']=sha(framesPath)
candidate['state']='saved_actual_item_body_receiving_socket_visually_reviewed_runtime_pending';candidate['actualVisualReview']={'reviewer':'state_art_completion','notes':args.notes,'images':reviews,'runtimeQualified':False}
receiptPath.write_text(json.dumps(candidate,indent=2)+'\n')
print(json.dumps({'families':len(keys),'actualReviewImages':len(reviews),'candidate':str(receiptPath)}))
