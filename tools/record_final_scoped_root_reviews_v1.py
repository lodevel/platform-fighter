"""Persist coordinator's actual scoped image observations without runtime upgrade."""
from pathlib import Path
import json,hashlib
A=Path('docs/review/2026-10-12/link-character/rework/art')
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
def save(folder,name,scope,images,dependencies):
 index=A/folder/'index.json'
 data={'state':'COORDINATOR_ACTUALLY_VIEWED_SCOPED_ART_INPUTS_APPROVED','reviewer':'/root','index':str(index),'indexSha256':sha(index),'scope':scope,'images':[{'path':p,'sha256':sha(p)}for p in images],'remainingDependencies':dependencies,'runtimeAcceptance':False,'gameChecksRun':False}
 p=A/folder/name;p.write_text(json.dumps(data,indent=2)+'\n');print(p,sha(p))
fx=json.load(open(A/'final-fx-clean-recipes-v1/index.json'))
save('final-fx-clean-recipes-v1','coordinator-nine-recipes-58-drawings-review.json','All nine original panels /58 drawings: clean open arcs/streaks/stars/branched electricity/glow, no closed attack or debug rings. Authored visual recipes retain selected source cues; no native particles/shader/lifetime parity.',[r['review']for r in fx['recipes'].values()],['Same-drawing approved support must apply once to all851 points before full body installation','Source-bound packing/consumer integration','Final-phase game checks'])
points=json.load(open(A/'final-fx-point-six-review-v1/index.json'))
save('final-fx-point-six-review-v1','coordinator-six-body-anchor-review.json','Six current body/anchor originals: captured Hip coherent; authored virtual TOP/SOURCE ROOT explicitly independent, airborne ROOT outside silhouette allowed. No approval of full851 geometry/support.',[r['view']for r in points['rows']],['Eventual body support retarget exactly once','Full851 body-fit integration','Final-phase game checks'])
crown=json.load(open(A/'final-actor-cranial-six-pilots-v1/index.json'))
save('final-actor-cranial-six-pilots-v1','coordinator-six-scalp-crown-review.json','Six authored actor scalp/crown input originals: DK below cosmetic tuft; Pika scalp between ears including dash/end. Authored Head-local ellipsoid highestWORLD-Y contact retained, ears receiving separately; not native capsules/parity.',[r['view']for r in crown['rows']]+sorted(set(r['recipe']for r in crown['rows'])),['Refined Hair receiving projections actual review','Measured six pilot V6 fit qualification','Full851 fitting/integration','Final-phase game checks'])
