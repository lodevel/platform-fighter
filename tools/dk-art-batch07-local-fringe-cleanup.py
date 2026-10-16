#!/usr/bin/env python3
"""Bounded inspected palette defects only; preserves exact authored pose alpha."""
from pathlib import Path
import hashlib,json,importlib.util
import numpy as np
from scipy.ndimage import distance_transform_edt,gaussian_filter
from PIL import Image,ImageDraw
ROOT=Path(__file__).resolve().parents[1];ART=ROOT/'docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/art'
spec=importlib.util.spec_from_file_location('display',ROOT/'tools/dk-art-firstbatch-palette-cleanup.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def main():
 prep=json.loads((ART/'dk-firstclips-batch07-preparation.json').read_text());ref=Image.open(ROOT/prep['identityReference']['path']).convert('RGBA');rows=[]
 for row in prep['records']:
  name=row['prefix'];src=ART/f'dk-firstclips-batch07-attempt1-{name}-cutout-candidate.png';a=np.asarray(Image.open(src).convert('RGBA')).copy();original=a.copy();rgb=a[:,:,:3].astype(float);visible=a[:,:,3]>=32
  dist=distance_transform_edt(visible);pink=((rgb[:,:,2]>rgb[:,:,1]*1.25)&(rgb[:,:,2]>rgb[:,:,0]*.15)&(rgb[:,:,2]>20))|((rgb[:,:,2]>rgb[:,:,1]*.95)&(rgb[:,:,2]>rgb[:,:,0]*.4)&(rgb[:,:,1]>45)&(rgb[:,:,0]>rgb[:,:,1]*1.1));edge=(a[:,:,3]>0)&pink;valid=visible&~pink&(dist>6);_,near=distance_transform_edt(~valid,return_indices=True);rgb[edge]=rgb[near[0][edge],near[1][edge]];ops=[{'operation':'pink material/fringe RGB decontamination (exact alpha preserved)','pixels':int(edge.sum())}]
  a[:,:,:3]=np.round(np.clip(rgb,0,255)).astype(np.uint8)
  assert np.array_equal(a[:,:,3],original[:,:,3]);stem=f'dk-firstclips-batch07-clean1-{name}';body=Image.fromarray(a);out=ART/(stem+'-cutout-candidate.png');body.save(out);module.display(body,stem,ref)
  light=Image.new('RGBA',body.size,(236,240,247,255));light.alpha_composite(body);light.convert('RGB').save(ART/(stem+'-light.png'));packed=body.resize((384,256),Image.Resampling.LANCZOS);pack=ART/(stem+'-quarter-candidate.png');packed.save(pack);last=int(np.where(np.asarray(packed)[:,:,3]>=32)[0].max())
  rows.append({**{k:row[k] for k in ('clip','nativeSample','gameplayAge','windowStart','windowEndExclusive','prefix','floorTransform')},'sourceImage':src.name,'sourceSha256':sha(src),'image':out.name,'imageSha256':sha(out),'packedImage':pack.name,'packedImageSha256':sha(pack),'alphaIdenticalToAttempt1':True,'changedRGBPixels':int(np.any(a[:,:,:3]!=original[:,:,:3],axis=2).sum()),'operations':ops,'root':[512,832],'scaleToWorld':5/26,'packedRoot':[128,208],'packedScaleToWorld':5/6.5,'bodyCentreFromRootY':-42,'packedFloorPixelCentreWorldDelta':(last+.5-208)*5/6.5,'staticArtAccepted':False,'receivingQualified':False,'actualMatchVerified':False})
 report={'state':'localized_rgb_correction_actual_review_pending','records':rows,'geometryChanged':False,'shippingChanged':False,'toolSha256':sha(Path(__file__))};(ART/'dk-firstclips-batch07-clean1-review.json').write_text(json.dumps(report,indent=2)+'\n');print('Two RGB-only candidates prepared; actual inspection pending.')
if __name__=='__main__':main()
