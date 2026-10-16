"""Versioned RGB-only reach guidance correction; no source/alpha or shipping edits."""
from pathlib import Path
import hashlib,json
import numpy as np
from PIL import Image,ImageDraw
R=Path(__file__).resolve().parents[1]; A=R/'docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/art'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def pin(p):return {'path':str(p.relative_to(R)),'sha256':sha(p)}
f='dk-fullgrab-standing-reach01';old=A/(f+'-preparation.json');prep=json.loads(old.read_text()); out=A/(f+'-fold2-preparation.json')
if out.exists():raise ValueError('Preserve derivative')
canvas=Image.open(R/prep['inputs']['seed']['path']).convert('RGB'); guides=Image.open(R/prep['inputs']['guide']['path']).convert('L'); changes=[]
for row in prep['records']:
 p=R/row['authoredSeed']['path']; base=np.asarray(Image.open(p).convert('RGB')); im=Image.fromarray(base); alpha=np.asarray(Image.open(R/row['authoredAlpha']['path']).convert('L')); visible=alpha>=32
 if row['nativeSample']==7:
  domain=np.zeros(visible.shape,bool);domain[675:720,545:600]=True; change=domain&visible&(base[:,:,0]<60);arr=base.copy();arr[change]=[190,22,5];im=Image.fromarray(arr)
  lines=[[(848,594),(866,625),(855,652)]]
 else:lines=[[(880,646),(908,652),(929,649)],[(879,689),(906,695),(928,691)],[(867,724),(892,730),(914,725)],[(851,750),(876,756),(899,751)]]
 draw=ImageDraw.Draw(im)
 for line in lines:draw.line(line,fill=(156,100,64),width=4,joint='curve')
 arr=np.asarray(im).copy();arr[~visible]=base[~visible]; im=Image.fromarray(arr);changed=np.any(arr!=base,2)
 dest=A/(f+f'-native{row["nativeSample"]}-authored-seed-fold2.png');im.save(dest);row['authoredSeed']=pin(dest)
 half=im.resize((768,512),Image.Resampling.LANCZOS);h=np.asarray(half).astype(int);edge=np.zeros((512,768),bool)
 for axis in [0,1]:edge|=np.max(np.abs(h-np.roll(h,1,axis)),axis=2)>35
 canvas.paste(half,tuple(row['cellPosition']));guides.paste(Image.fromarray((edge*255).astype('uint8')),tuple(row['cellPosition']))
 body=im.convert('RGBA');body.putalpha(Image.fromarray(alpha));
 for mode,col in [('dark',(25,30,39)),('light',(247,246,238))]:
  bg=Image.new('RGBA',body.size,col+(255,));bg.alpha_composite(body);bg.convert('RGB').save(A/(f+f'-native{row["nativeSample"]}-fold2-{mode}.png'))
 world=Image.new('RGBA',(900,290),(25,30,39,255));v=body.resize((295,197),Image.Resampling.LANCZOS)
 for x,face in [(130,1),(510,-1)]:world.alpha_composite(v if face==1 else v.transpose(Image.Transpose.FLIP_LEFT_RIGHT),(x,50))
 world.convert('RGB').save(A/(f+f'-native{row["nativeSample"]}-fold2-world.png'))
 changes.append({'nativeSample':row['nativeSample'],'parent':pin(p),'derivative':pin(dest),'RGBChangedPixels':int(changed.sum()),'authoredFoldAxes':lines,'alphaUnchanged':True,'outsideVisibleRGBUnchanged':bool(np.array_equal(arr[~visible],base[~visible]))})
for kind,im in [('seed',canvas),('guide',guides)]:
 dest=A/(f+'-fold2-'+kind+'.png');im.save(dest);prep['inputs'][kind].update(pin(dest));prep['inputs'][kind]['serverFilename']='pf-dk-fullgrab-standing-reach01-fold2-'+kind+'.png'
graph=json.loads((R/prep['workflow']['path']).read_text())
for kind,rec in prep['inputs'].items():graph[rec['graphNode']]['inputs']['image']=rec['serverFilename']
graphfile=A/(f+'-attempt1-fold2.workflow.json');graphfile.write_text(json.dumps(graph,indent=2)+'\n');prep['workflow']=pin(graphfile)
prep['RGBGuidanceDerivative']={'parentPreparation':pin(old),'changes':changes,'tool':pin(Path(__file__))};out.write_text(json.dumps(prep,indent=2)+'\n');print(json.dumps(pin(out)))
