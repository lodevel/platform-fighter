"""Native-reader memo qualification on six reviewed projections, exact pixels."""
from pathlib import Path
import sys,json,hashlib,time
sys.path[:0]=['tools','/tmp/pikachu-source-libs']
import numpy as np
from PIL import Image
from final_target_part_projection_v2 import project
from final_frozen_native_read_cache_v1 import install
from link_immutable_input_stage_v1 import ImmutableInputs
A=Path('docs/review/2026-10-12/link-character/rework/art');D=A/'final-native-memo-six-qualification-v1';D.mkdir(exist_ok=True)
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
guards=json.load(open(A/'dk-pikachu-full-final-toon-bank-v1/plan.json'))['inputHashes']
for name in ['skin-reference.png','face-reference.png','face2-reference.png','face3-reference.png','face4-reference.png']:
 p=Path('assets/gen/pikachu-native-reference/geometry-reference')/name;guards[str(p)]=sha(p)
memo=ImmutableInputs(guards,guards);memo.install();cache,hits=install(guards);rows=[]
for old in json.load(open(A/'final-target-part-six-hair-v2/index.json'))['rows']:
 key=old['actor']+'-'+old['motion']+'-raw'+str(old['nativeSample']);prefix=D/key;t=time.perf_counter();c=time.process_time();project(old['actor'],old['motion'],old['nativeSample'],prefix,compiled=False)
 for suffix in ['-reference.png']+[f'-physical-region-{i}.png'for i in range(1,17)]:assert np.array_equal(np.array(Image.open(str(prefix)+suffix)),np.array(Image.open(old['prefix']+suffix))),(key,suffix)
 rows.append({'key':key,'sourceAndAll16PhysicalMasksChangedPixels':0,'wallSeconds':time.perf_counter()-t,'cpuSeconds':time.process_time()-c,'parsedNativeInputs':len(cache),'cacheHits':dict(hits)});print(rows[-1],flush=True)
memo.verify();(D/'qualification.json').write_text(json.dumps({'state':'SIX_EXACT_SOURCE_RGBA_AND_ALL16_MASKS_QUALIFIED_IMMUTABLE_NATIVE_READER_MEMO','rows':rows,'inputHashes':guards,'operatorSha256':sha('tools/final_frozen_native_read_cache_v1.py'),'gameChecksRun':False},indent=2)+'\n')
