"""Attempt2 hand-only dash seed with own-skin edge bleed; never submits GPU.

The attempt2 localhand seed placed each own hand on pure magenta. The noise
mask works at latent resolution, so regenerated partial-alpha hand edges would
inherit magenta again (the attempt1 fringe defect). This derivative keeps the
reviewed guide, mask, alpha, parents and hand seeds byte-identical and only
replaces the background beneath/around each hand with the adjacent own skin
colour, propagated outward from opaque hand pixels.
"""
from pathlib import Path
import argparse,copy,hashlib,json
import numpy as np
from PIL import Image

R=Path(__file__).resolve().parents[1];A=R/'docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/art'
O='dk-fullgrab-dash-startup01-attempt2-bleed'
MAGENTA=(255,0,255)
BLEED_FULL_PIXELS=28
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def pin(p):return {'path':str(p.relative_to(R)),'sha256':sha(p)}
def save(im,s):
 p=A/(O+'-'+s+'.png');assert not p.exists(),p;im.save(p);return p

def bleed(rgb,known,steps):
 """Propagate known colours outward one ring per step (mean of known 8-neighbours)."""
 rgb=rgb.astype(np.float32).copy();known=known.copy()
 for _ in range(steps):
  acc=np.zeros_like(rgb);cnt=np.zeros(known.shape,np.float32)
  for dy in (-1,0,1):
   for dx in (-1,0,1):
    if dy==0 and dx==0:continue
    k=np.roll(np.roll(known,dy,0),dx,1);c=np.roll(np.roll(rgb,dy,0),dx,1)
    acc+=c*k[...,None];cnt+=k
  grow=(~known)&(cnt>0)
  rgb[grow]=acc[grow]/cnt[grow][:,None];known|=grow
 return rgb,known

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--localhand-preparation',type=Path,required=True);ap.add_argument('--expected-sha256',required=True);a=ap.parse_args()
 pp=a.localhand_preparation.resolve();assert sha(pp)==a.expected_sha256
 prep=json.loads(pp.read_text());assert prep['attempt']==2 and prep['state']=='actual_localized_dash_inputs_root_review_pending'
 out=A/(O+'-preparation.json');assert not out.exists()
 for v in prep['inputs'].values():assert sha(A/v['file'])==v['sha256']
 oldseed=np.asarray(Image.open(A/prep['inputs']['seed']['file']).convert('RGB'))
 mask=np.asarray(Image.open(A/prep['inputs']['render-mask']['file']).convert('L'))
 seed=oldseed.copy();rows=[];counts={}
 for rec in prep['records']:
  n=rec['nativeSample'];x,y=rec['cellPosition']
  hs=R/rec['handSeed']['path'];assert sha(hs)==rec['handSeed']['sha256']
  hm=R/rec['localMask']['path'];assert sha(hm)==rec['localMask']['sha256']
  seeded=np.asarray(Image.open(hs).convert('RGBA'));alpha=seeded[:,:,3]
  hand=np.asarray(Image.open(hm).convert('L'))>0
  known=hand&(alpha==255)
  under,reach=bleed(seeded[:,:,:3],known,BLEED_FULL_PIXELS)
  zone=reach&~known&(alpha<255)
  base=np.zeros(seeded.shape[:2]+(3,),np.float32);base[:]=MAGENTA;base[zone]=under[zone]
  af=alpha[...,None].astype(np.float32)/255
  comp=Image.fromarray(np.clip(seeded[:,:,:3]*af+base*(1-af)+.5,0,255).astype('uint8'))
  cell=np.asarray(comp.resize((768,512),Image.Resampling.LANCZOS))
  # Only half-res pixels whose full-res footprint touches the bleed zone change.
  zone_half=np.asarray(Image.fromarray((zone*255).astype('uint8')).resize((768,512),Image.Resampling.BOX))>0
  zone_half=np.asarray(Image.fromarray((zone_half*255).astype('uint8')).resize((768,512)))>0
  block=seed[y:y+512,x:x+768];block[zone_half]=cell[zone_half]
  counts[n]={'fullBleedPixels':int(zone.sum()),'halfSeedPixelsChanged':int(np.any(block!=oldseed[y:y+512,x:x+768],axis=2).sum()),
             'halfMaskPixelsInsideChanged':int((np.any(block!=oldseed[y:y+512,x:x+768],axis=2)&(mask[y:y+512,x:x+768]>0)).sum())}
  rows.append(copy.deepcopy(rec))
 seedimg=Image.fromarray(seed)
 changed=np.any(seed!=oldseed,axis=2)
 assert not changed[:512,:768].any() and not changed[512:,768:].any(),'reference/empty cells must stay exact'
 sp=save(seedimg,'seed')
 inputs=copy.deepcopy(prep['inputs'])
 inputs['seed']={'file':sp.name,'sha256':sha(sp),'graphNode':'13','serverFilename':'pf-'+O+'-seed.png'}
 graph=json.loads((A/prep['workflow']).read_text());assert sha(A/prep['workflow'])==prep['workflow_sha256']
 graph['13']['inputs']['image']=inputs['seed']['serverFilename']
 gp=A/(O+'.workflow.json');assert not gp.exists();gp.write_text(json.dumps(graph,indent=2)+'\n')
 view=Image.new('RGB',(1536,1024));view.paste(Image.fromarray(oldseed),(0,0))
 vp=save(Image.fromarray(np.concatenate([oldseed,seed],axis=1)),'seed-before-after')
 result={'state':'actual_localized_dash_inputs_root_review_pending','jobFamily':prep['jobFamily'],'attempt':2,'canvas':prep['canvas'],'cells':prep['cells'],
  'records':rows,'inputs':inputs,'workflow':gp.name,'workflow_sha256':sha(gp),'identityReference':prep['identityReference'],'recipe':prep['recipe'],
  'derivedFrom':pin(pp),'bleed':{'fullPixels':BLEED_FULL_PIXELS,'policy':'Background under/around own hand only, nearest opaque own-hand colour; guide, mask, alpha, parents, reference and empty cells unchanged.','counts':counts},
  'tool':pin(Path(__file__)),'actualReviewViews':[pin(vp)],'correctionDomains':True,'outputNodes':{'9':'final','20':'raw'},
  'GPUUsed':False,'shippingChanged':False,'generatedTargetAcceptance':False,'queueSubmissionAuthorized':False}
 out.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'preparation':pin(out),'counts':counts,'seed':pin(sp)},indent=1))
if __name__=='__main__':main()
