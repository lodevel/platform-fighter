from pathlib import Path
import json,hashlib
import numpy as np
from PIL import Image,ImageDraw
R=Path(__file__).resolve().parents[1];A=R/'docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/art';F='dk-fullgrab-standing-remaining04'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def pin(p):return {'path':str(p.relative_to(R)),'sha256':sha(p)}
p=A/(F+'-preparation.json');d=json.loads(p.read_text());row=next(r for r in d['records'] if r['nativeSample']==33);src=R/row['authoredSeed']['path'];old=np.asarray(Image.open(src).convert('RGB'));im=Image.fromarray(old);poly=[[643,331],[686,331],[693,368],[648,368]];ImageDraw.Draw(im).polygon(poly,fill=(190,22,5));out=np.asarray(im).copy();alpha=np.asarray(Image.open(R/row['authoredAlpha']['path']));out[alpha<32]=old[alpha<32];im=Image.fromarray(out);target=A/(F+'-native33-authored-seed-forehead2.png');im.save(target);row['authoredSeed']=pin(target);row['observedSourceForeheadRGBRepair']={'polygon':poly,'RGBChangedPixels':int(np.any(old!=out,2).sum()),'parent':pin(src),'allSourcePoseAlphaUnchanged':True,'reason':'Actual source material produced isolated cream crescent above authored attached eye/brow; remove source shader identity artifact only.'}
canvas=Image.open(R/d['inputs']['seed']['path']).convert('RGB');guides=Image.open(R/d['inputs']['guide']['path']).convert('L');half=im.resize((768,512),Image.Resampling.LANCZOS);canvas.paste(half,tuple(row['cellPosition']));a=np.asarray(half).astype(int);edge=np.zeros((512,768),bool)
for axis in [0,1]:edge|=np.max(np.abs(a-np.roll(a,1,axis)),2)>35
guides.paste(Image.fromarray((edge*255).astype('uint8')),tuple(row['cellPosition']))
for kind,data in [('seed',canvas),('guide',guides)]:
 dest=A/(F+'-forehead2-'+kind+'.png');data.save(dest);d['inputs'][kind].update(pin(dest));d['inputs'][kind]['file']=dest.name;d['inputs'][kind]['serverFilename']='pf-'+F+'-forehead2-'+kind+'.png'
graph=json.loads((A/d['workflow']).read_text())
for v in d['inputs'].values():graph[v['graphNode']]['inputs']['image']=v['serverFilename']
gf=A/(F+'-attempt1-forehead2.workflow.json');gf.write_text(json.dumps(graph,indent=2)+'\n');d['workflow']=gf.name;d['workflow_sha256']=sha(gf);dest=A/(F+'-forehead2-preparation.json');dest.write_text(json.dumps(d,indent=2)+'\n')
body=im.convert('RGBA');body.putalpha(Image.fromarray(alpha));light=Image.new('RGBA',body.size,(247,246,238,255));light.alpha_composite(body);light.convert('RGB').save(A/(F+'-native33-forehead2-light.png'));print(pin(dest))
