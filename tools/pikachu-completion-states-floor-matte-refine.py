"""Refine known magenta matte edges using the source underside palette.

This is a derived cutout, never art acceptance. Opaque generated defects that
cannot be explained as foreground/background mixtures remain for rejection.
Only a succeeded, unreviewed attempt may receive a new cutout revision.
"""
from pathlib import Path
import argparse, hashlib, json
import numpy as np
from PIL import Image, ImageFilter
ROOT=Path(__file__).resolve().parent.parent
parser=argparse.ArgumentParser()
parser.add_argument('--family',choices=['attack-late-floor','crouch-floor','throw-floor'],required=True)
parser.add_argument('key');args=parser.parse_args()
B=ROOT/'docs/review/2026-10-06/pikachu-character/art'/('completion-states-'+args.family)
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
lp=B/'full-generation-ledger.json';ledger=json.loads(lp.read_text())
out=next(r for r in reversed(ledger) if r['pose_key']==args.key and r['state']=='succeeded')
assert not out.get('matteRefinement'), 'Derived processing revision is immutable'
prep=next(r for r in json.loads((B/'full-pilot-preparation.json').read_text())['records'] if r['key']==args.key)
if out['attempt']>1:prep=prep['attempts'][str(out['attempt'])]
oldPath=B/out['outputs']['cutout']['file'];assert sha(oldPath)==out['outputs']['cutout']['sha256']
rawPath=B/out['outputs']['9']['file'];assert sha(rawPath)==out['outputs']['9']['sha256']
raw=Image.open(rawPath).convert('RGBA');original=Image.open(oldPath).convert('RGBA');result=np.asarray(original).copy()
frames=json.loads((ROOT/'assets/characters/pikachu/frames.json').read_text())['animations']
bg=np.array([204.,73.,140.]);rows=[]
for c in prep['cells']:
 f=frames[c['sheet']];w,h=f['frameWidth'],f['frameHeight'];col,row=f['sourceCells'][c['artFrameIndex']]
 source=ROOT/c['source'];body=Image.open(source).convert('RGBA').crop((col*w,row*h,(col+1)*w,(row+1)*h));oa=np.asarray(body)
 expected=c.get('sourceCellRgbaSha256',c.get('sourceCellRGBAsha256',c.get('sourceCellPixelSha256')))
 assert expected and hashlib.sha256(body.tobytes()).hexdigest()==expected, 'Affected source cell changed'
 paletteReference={'source':c['source'],'cellRgbaSha256':expected}
 if c.get('acceptedIdentityBaseline'):
  baseline=c['acceptedIdentityBaseline'];baselinePath=ROOT/baseline['atlas'];assert sha(baselinePath)==baseline['atlasSha256']
  assert sha(ROOT/baseline['receipt'])==baseline['receiptSha256']
  body=Image.open(baselinePath).convert('RGBA').crop((col*w,row*h,(col+1)*w,(row+1)*h));oa=np.asarray(body)
  paletteReference={'acceptedBaseline':baseline['atlas'],'atlasSha256':baseline['atlasSha256'],'cellRgbaSha256':hashlib.sha256(body.tobytes()).hexdigest()}
 first=c['adaptation']['originalArtBand'][0];allowed=oa[:,:,3]>0;allowed[:first]=False
 allowed=np.asarray(Image.fromarray(allowed.astype('uint8')*255).filter(ImageFilter.MaxFilter(7)))>0;allowed[:first]=False
 colors=oa[:,:,:3][allowed&(oa[:,:,3]>=180)];assert len(colors)
 bins=(colors//8)*8;unique,count=np.unique(bins,axis=0,return_counts=True)
 palette=unique[np.argsort(count)[-16:]].astype(float)+3.5;palette=np.vstack([palette,[0,0,0]])
 valid=np.zeros((640,512),bool);valid[:h,:w]=allowed;mask=np.repeat(np.repeat(valid,2,axis=0),2,axis=1)
 x,y=c['offset'][:2];base=result[y:y+1280,x:x+1024];rawCell=np.asarray(raw.crop((x,y,x+1024,y+1280)))
 C=rawCell[:,:,:3][mask].astype(float);vectors=palette-bg;diff=C-bg
 alpha=np.clip((diff@vectors.T)/np.sum(vectors*vectors,axis=1),0,1)
 prediction=bg[None,None,:]+alpha[:,:,None]*vectors[None,:,:]
 errors=np.sqrt(np.mean((prediction-C[:,None,:])**2,axis=2));which=errors.argmin(axis=1)
 a=alpha[np.arange(len(C)),which];error=errors[np.arange(len(C)),which];edge=(error<=12)&(a<.98)
 pixels=base[mask];priorPixels=pixels.copy()
 nearBackground=np.asarray(Image.fromarray((base[:,:,3]==0).astype('uint8')*255).filter(ImageFilter.MaxFilter(9)))>0
 # Preserve pixels already classified as background by the original key.
 edge&=(pixels[:,3]>0)&nearBackground[mask]
 pixels[edge,3]=np.minimum(pixels[edge,3],np.round(a[edge]*255).astype('uint8'))
 foreground=(C[edge]-(1-a[edge,None])*bg)/np.maximum(a[edge,None],.001)
 pixels[edge,:3]=np.clip(np.round(foreground),0,255).astype('uint8');base[mask]=pixels
 rows.append({'sheet':c['sheet'],'artFrameIndex':c['artFrameIndex'],'sourceCellRgbaSha256':expected,'paletteReference':paletteReference,
  'palette':palette.tolist(),'changedPixels':int(np.count_nonzero(np.any(pixels!=priorPixels,axis=1))),
  'unexplainedPixels':int((error>12).sum()),'unexplainedGeneratedColorsRemainUntouched':True})
name=out['job_key']+'-matte-refined-cutout.png';path=B/name;Image.fromarray(result).save(path)
out['outputs']['original_cutout']=out['outputs']['cutout']
out['outputs']['cutout']={'file':name,'sha256':sha(path),
 'process':'Original keycc498c/tolerance28; source-underside-palette matte inversion only within4 renderpixels of originallytransparent background. RGB bins8/top16 plusblack; mixtureRMS<=12 and alpha<0.98; preserve original fullytransparent pixels. No resize/recenter.'}
out['matteRefinement']={'state':'derived_cutout_actual_visual_review_pending','rawFinalSha256':sha(rawPath),
 'originalCutoutSha256':sha(oldPath),'sourcePaletteRegion':'Original source alpha>0 below local underside band, expanded3pixels; palette fromalpha>=180. Upperbody pixels unchanged.',
 'shaderBackgroundRgb':bg.tolist(),'rows':rows,'sourceParity':'Transparency processing only; unexplained colors and every proposed edge remain subject to actual rejection.'}
current=json.loads(lp.read_text());index=next(i for i,r in enumerate(current) if r['job_key']==out['job_key'])
assert current[index]['state']=='succeeded' and current[index]['outputs']['cutout']['sha256']==sha(oldPath), 'Output was reviewed or changed during processing'
current[index]=out;temporary=lp.with_name(lp.name+'.matte-refine.tmp');temporary.write_text(json.dumps(current,indent=2)+'\n');temporary.replace(lp)
print(json.dumps({'file':name,'rows':rows}))
