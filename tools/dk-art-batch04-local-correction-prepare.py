#!/usr/bin/env python3
"""Two rejected profile eyes only, bounded attempt2; native10 body frozen."""
from pathlib import Path
import hashlib,json
import numpy as np
from PIL import Image,ImageDraw,ImageFilter
ROOT=Path(__file__).resolve().parents[1];ART=ROOT/'docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/art'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def main():
 first=json.loads((ART/'dk-firstclips-batch04-preparation.json').read_text());canvas=Image.new('RGB',(1024,1024),(204,73,140));noise=Image.new('L',canvas.size);guide=Image.new('L',canvas.size)
 ref=ART/'dk-firstclips-batch03-clean1-firstclips-jab2-native5-cutout-candidate.png';r=Image.open(ref).convert('RGBA').crop((620,215,793,433)).resize((360,453),Image.Resampling.LANCZOS);c=Image.new('RGBA',(512,512),(204,73,140,255));c.alpha_composite(r,(76,29));canvas.paste(c.convert('RGB'))
 rows=[]
 for cell,row in enumerate(first['records'],1):
  n=row['nativeSample'];src=ART/f'dk-firstclips-batch04-attempt1-{row["prefix"]}-cutout-candidate.png';src=ART/f'dk-firstclips-batch04-clean1-{row["prefix"]}-cutout-candidate.png' if n==10 else src;body=Image.open(src).convert('RGBA');alpha=np.asarray(body.getchannel('A'));rgb=Image.fromarray(np.asarray(body)[:,:,:3]);draw=ImageDraw.Draw(rgb)
  crop=(420,100,932,612) if n in [6,7] else (420,180,932,692)
  points={6:[(646,248),(698,248),(718,275),(723,316),(704,319),(675,313),(645,284)],7:[(637,257),(686,257),(711,281),(714,320),(696,323),(665,317),(635,291)]}
  m=Image.new('L',body.size)
  if n in [6,7]:
   draw.polygon(points[n],fill=(188,20,5));eye={6:(676,282,697,307),7:(667,289,689,315)}[n];draw.ellipse(eye,fill=(253,250,238));x0,y0,x1,y1=eye;w=x1-x0;h=y1-y0;draw.ellipse((x0+w*.55,y0+h*.14,x0+w*.94,y0+h*.85),fill=(20,12,7));brow={6:[(665,273),(675,268),(695,282),(700,291),(691,287),(676,279),(666,282)],7:[(656,279),(667,274),(688,289),(694,297),(684,292),(668,285),(657,290)]}[n];draw.polygon(brow,fill=(253,250,238));ImageDraw.Draw(m).polygon(points[n],fill=255);m=m.filter(ImageFilter.GaussianBlur(3))
  a=np.asarray(body).copy();a[:,:,:3]=np.asarray(rgb);authored=Image.fromarray(a);full=ART/(row['prefix']+'-batch04-local-eye-seed.png');authored.save(full);bg=Image.new('RGBA',body.size,(204,73,140,255));bg.alpha_composite(authored);patch=bg.convert('RGB').crop(crop);arr=np.asarray(patch).astype(int);edges=np.zeros((512,512),bool)
  for axis in [0,1]:edges|=np.max(np.abs(arr-np.roll(arr,1,axis)),axis=2)>35
  x=cell%2*512;y=cell//2*512;canvas.paste(patch,(x,y));guide.paste(Image.fromarray((edges*255).astype(np.uint8)),(x,y));noise.paste(m.crop(crop),(x,y));rows.append({**row,'cell':cell,'crop':list(crop),'bodyFile':src.name,'bodySha256':sha(src),'localSeed':full.name,'localSeedSha256':sha(full),'generatedThisAttempt':n in [6,7],'generatedInputReview':'pending','correctionScope':'Single attached source-plane profile eye and target white brow only; raw muzzle/nose/ear/arms/whole-body/root/alpha preserved. Native10 frozen.'})
 prefix='dk-firstclips-batch04-local-eye'
 for kind,im in [('seed',canvas),('guide',guide),('render-mask',noise)]:im.save(ART/(prefix+'-'+kind+'.png'))
 graph=json.loads((ART/'dk-firstclips-batch01-attempt3.workflow.json').read_text());graph['4']['inputs']['text']='Four cells two by two atlas. Top left is the actually reviewed SAME red cartoon gorilla PROFILE head identity. Top right and bottom left are two successive mostly BACK-facing uppercut profiles. Correct ONLY each supplied small ocular region to one small attached WHITE eye oval with one BLACK OVAL pupil and a curved thick WHITE brow on the actual source head plane. Only ONE eye is visible; the other eye is physically occluded. Never add a second white wall, paired white ribbons, pupil-free slits or an eye crossing the actual arm/head gap. Preserve existing cream profile muzzle, nostrils, ear, head outline and red fur; looking right/up along its existing head plane. All unmasked body pixels and bottom right recovery pose unchanged. Smooth target cartoon shading, no fur ink, rectangle paste seam or floating eye. Magenta background unchanged.';graph['7']['inputs'].update(seed=2026100915,denoise=.50)
 for node,kind in [('10','guide'),('13','seed'),('16','render-mask')]:graph[node]['inputs']['image']='pf-'+prefix+'-'+kind+'.png'
 for node,kind in [('9','final'),('20','raw')]:graph[node]['inputs']['filename_prefix']='pf-dk-firstclips-batch04-attempt2-'+kind
 workflow='dk-firstclips-batch04-attempt2.workflow.json';(ART/workflow).write_text(json.dumps(graph,indent=2)+'\n');prep={**first,'attempt':2,'state':'prepared_actual_input_review_pending','canvas':[1024,1024],'cells':[512,512],'workflow':workflow,'workflow_sha256':sha(ART/workflow),'records':rows,'inputs':{kind:{'file':prefix+'-'+kind+'.png','sha256':sha(ART/(prefix+'-'+kind+'.png')),'graphNode':node}for node,kind in [('10','guide'),('13','seed'),('16','render-mask')]},'identityReference':{'path':str(ref.relative_to(ROOT)),'sha256':sha(ref),'cell':0,'crop':[620,215,793,433],'noiseMask':'zero','ancestry':'Locked idle via accepted firstcontact native5 and parent reviewed batch03 native5 profile'},'identity_mechanism':'Accepted batch03 native5 actual PROFILE target crop in reference VAE cell0 under zero noise; rejected native6/7 ocular interiors freely regenerated from single-eye/brow authored guide only. Body alpha/root held on restoration, no reference eye paste. Native10 zero noise.'};(ART/'dk-firstclips-batch04-correction-preparation.json').write_text(json.dumps(prep,indent=2)+'\n');print('Prepared bounded native6/7 eye attempt2; GPU not submitted.')
if __name__=='__main__':main()
