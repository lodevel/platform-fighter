"""today | rig v1 (one drawing cut in 5 parts) | rig v2 (with swapped arm/head variants), per jab drawing."""
import json, sys
from PIL import Image
sys.path.insert(0,'.')
from compare import placed, sheet
m1=json.load(open(f'{sys.path[0] or "."}/out/fit_metrics.json')); m2=json.load(open('out/rig2_metrics.json'))['today_fit']
S='/tmp/claude-1000/-home-lombet-Workspace-platform-fighter/a7dfccb5-31fd-4c9e-86a2-6a914ded46da/scratchpad/explore-skeleton'
frames=[f'jab/{i}' for i in range(7)]
rows=[[placed(f),Image.open(f"{S}/fit/{f.replace('/','_')}.png"),Image.open(f"{S}/fit2/{f.replace('/','_')}.png")] for f in frames]
labels=[f"{f}\nv1 diff {m1[f]['sigdiff']}\nv2 diff {m2[f]['sigdiff']}\n{m2[f]['arm']}\n{m2[f]['head']}" for f in frames]
for mag,suf in ((1,'match'),(2,'x2')):
  sheet(rows,labels,['today (drawing)','rig v1: 5 parts of jab/4','rig v2: + arm/head variants'],f'{S}/out/fit_v1_v2_{suf}.png',mag)
