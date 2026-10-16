"""Bounded localized first-contact correction; actual ID head is reference-only."""
from pathlib import Path
from PIL import Image,ImageDraw,ImageFilter
import numpy as np,json,hashlib
ROOT=Path(__file__).resolve().parent.parent;BASE=ROOT/'docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/art'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
C=512;prefix='dk-firstcontact-pilot-correction';bg=(204,73,140)
seed=Image.new('RGB',(1024,1024),bg);mask=Image.new('L',seed.size,0);guide=Image.new('L',seed.size,0)
ref=ROOT/'docs/review/2026-09-25/donkeykong-character/art/idle-keyframe.png'
a=np.asarray(Image.open(ref).convert('RGBA')).copy();rgb=a[:,:,:3].astype(float);pink=(rgb[:,:,2]>rgb[:,:,0]*.7)&(rgb[:,:,2]>rgb[:,:,1]*1.25)&(rgb[:,:,2]>115);a[pink,3]=0
# Real target head reference pixels, never inserted into a pose cell.
head=Image.fromarray(a).crop((534,225,790,488)).resize((380,390),Image.Resampling.LANCZOS);cell=Image.new('RGBA',(512,512),(*bg,255));cell.alpha_composite(head,(66,61));seed.paste(cell.convert('RGB'))
records=[]
for index,(key,crop,polygons) in enumerate([
 ('jab1-native5',(448,320,960,832),[[(577,405),(638,400),(711,431),(722,471),(710,560),(661,573),(595,550),(570,475)],[(500,627),(537,628),(583,658),(638,656),(693,667),(687,716),(633,725),(573,717),(523,682),(496,649)]]),
 ('jab2-native4',(384,192,896,704),[[(442,433),(494,433),(489,478),(442,489)],[(525,458),(590,458),(590,510),(525,510)],[(617,600),(669,600),(669,697),(612,697)]]),
 ('dtilt-native6',(512,448,1024,960),[[(665,568),(750,568),(777,611),(806,636),(823,706),(827,753),(767,761),(701,735),(656,689),(655,620)]])],1):
 body_path=BASE/('firstcontact-local-'+key+'-cutout.png');body=Image.open(body_path).convert('RGBA');rgb=Image.new('RGB',body.size,bg);rgb.paste(body,mask=body.getchannel('A'));rgb=rgb.crop(crop)
 x=(index%2)*C;y=(index//2)*C;seed.paste(rgb,(x,y))
 m=Image.new('L',(1536,1024),0);d=ImageDraw.Draw(m)
 for p in polygons:d.polygon(p,fill=255)
 m=m.filter(ImageFilter.GaussianBlur(4));m=m.crop(crop);mask.paste(m,(x,y))
 # Preserve outer source head/torso boundary; let actual ID reference control face detail rather than the rejected U/gap guides.
 alpha=np.asarray(body.getchannel('A').crop(crop))>0;edge=alpha^np.asarray(Image.fromarray((alpha*255).astype('uint8')).filter(ImageFilter.MinFilter(5))).astype(bool);g=Image.fromarray((edge*255).astype('uint8'));guide.paste(g,(x,y))
 records.append({'cell':index,'key':key,'crop':list(crop),'bodyFile':body_path.name,'bodySha256':sha(body_path),'maskPolygons':polygons,'featureProtection':'none inside correction regions; actual pose eyes fully sampled','composition':'Generated RGB patches restored into this exact crop with original fullbody alpha/root; no resizing of pose pixels'})
for kind,im in [('seed',seed),('guide',guide),('render-mask',mask)]:im.save(BASE/(prefix+'-'+kind+'.png'))
graph=json.loads((BASE/'dk-firstcontact-pilot-attempt1.workflow.json').read_text())
graph['4']['inputs']['text']='Four cells in a two by two atlas. Top left is a close-up of the EXACT red cartoon Donkey Kong identity to use. Follow that reference for the other three cells: white thick softly curved eyebrows, two WHITE EYE WHITES under the brows, small BLACK OVAL pupils gazing right, cream tan muzzle with two small dark nostrils. Each eye pair sits inside its own head, exactly one brow pair and two eyes per face. Top right face is crouched straight punch, bottom right face is extremely low flat-palm strike. Maintain their exact head orientation and expression while correcting eye appearance to match reference. Bottom left is existing raised uppercut whose eyes remain unchanged; repair its small torso color marks with the surrounding red fur. Bright red cartoon fur and vivid red whipping necktie under the top-right chin, clean smooth flat cartoon shading. Blend all localized repairs seamlessly into surrounding shading. No face patch outlines or rectangular seams, no sunglasses, no black triangular eye sockets, no white U-shaped eye ribbons, no bulging round eyes, no extra eyes or eyebrows. Uniform magenta background. Preserve every body outline and all existing unmasked pixels.'
graph['7']['inputs'].update(seed=2026100806,denoise=.78)
for n,kind in [('10','guide'),('13','seed'),('16','render-mask')]:graph[n]['inputs']['image']='pf-'+prefix+'-'+kind+'.png'
for n,suffix in [('9','final'),('20','raw')]:graph[n]['inputs']['filename_prefix']='pf-dk-20261008-firstcontact-pilot-attempt2-'+suffix
workflow='dk-firstcontact-pilot-attempt2.workflow.json';(BASE/workflow).write_text(json.dumps(graph,indent=2)+'\n')
prep={'state':'prepared_actual_input_review_pending','canvas':[1024,1024],'cellSize':[512,512],'records':records,'workflow':workflow,'workflow_sha256':sha(BASE/workflow),'identity_reference':{'file':str(ref.relative_to(ROOT)),'sha256':sha(ref),'crop':[534,225,790,488],'outputRole':'reference-only conditioned latent cell0, not delivered'},'identity_mechanism':'Actual target head reference in VAE starting latent cell0 under zero mask; local required pose eye/tie patches fully generated, no protected pasted reference eye pixels','inputs':{k:{'file':prefix+'-'+k+'.png','sha256':sha(BASE/(prefix+'-'+k+'.png'))}for k in ['seed','guide','render-mask']},'restoredBody':[1536,1024],'root':[512,832],'scaleToWorld':5/26,'bodyCentreFromRootY':-42,'runtime':'Unaccepted bounded attempt2; actual output inspection/paired target receiving pending, no shipping changes'}
(BASE/'dk-firstcontact-pilot-correction-preparation.json').write_text(json.dumps(prep,indent=2)+'\n');print(json.dumps({'canvas':prep['canvas'],'workflow':workflow,'state':prep['state']}))
