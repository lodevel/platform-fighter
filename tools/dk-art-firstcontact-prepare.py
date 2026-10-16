"""Required clock-correct DK first contacts; no queue submission or shipping writes."""
from pathlib import Path
from PIL import Image,ImageFilter,ImageDraw
import numpy as np,json,hashlib
ROOT=Path(__file__).resolve().parent.parent
BASE=ROOT/'docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/art'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
W,H=1536,1024
prefix='dk-firstcontact-pilot'
seed=Image.new('RGB',(W*2,H*2),(204,73,140));guide=Image.new('L',seed.size,0);mask=Image.new('L',seed.size,0)
ref=ROOT/'docs/review/2026-09-25/donkeykong-character/art/idle-keyframe.png'
a=np.asarray(Image.open(ref).convert('RGBA')).copy();rgb=a[:,:,:3].astype(float);bg=(rgb[:,:,2]>rgb[:,:,0]*.7)&(rgb[:,:,2]>rgb[:,:,1]*1.25)&(rgb[:,:,2]>115);a[bg,3]=0
im=Image.fromarray(a);im=im.crop(im.getbbox());im=im.resize((round(im.width*540/im.height),540),Image.Resampling.LANCZOS)
cell=Image.new('RGBA',(W,H),(204,73,140,255));cell.alpha_composite(im,(512-im.width//2,832-im.height));seed.paste(cell.convert('RGB'))
records=[{'cell':0,'role':'actual_identity_reference_only','path':str(ref.relative_to(ROOT)),'sha256':sha(ref),'noise_mask':'zero; retained in starting latent, not a delivered drawing'}]
for i,(key,age) in enumerate([('jab1-correct-native5',4),('jab2-correct-native4',3),('dtilt-correct-native6',5)],1):
 source=BASE/(key+'-palette-seed.png');metadata=BASE/(key+'.json');source_mask=Image.open(BASE/(key+'-mask.png')).convert('L')
 m=np.asarray(source_mask);last=int(np.nonzero(m>=32)[0].max());start=760;target=830
 # Local support band adaptation, preserving all upper-body pixels and the common anatomical root.
 def warp(im):
  out=Image.new(im.mode,(W,H),0 if im.mode=='L' else (204,73,140));out.paste(im.crop((0,0,W,start)),(0,0));out.paste(im.crop((0,start,W,last+1)).resize((W,target-start+1),Image.Resampling.NEAREST if im.mode=='L' else Image.Resampling.BICUBIC),(0,start));return out
 sm=warp(source_mask)
 # Median strips source material grain, then quantizes to the already inspected target identity palette.
 col=np.asarray(Image.open(source).convert('RGB').filter(ImageFilter.MedianFilter(11))).copy();opaque=np.asarray(source_mask)>=32
 palette=np.asarray([[190,22,3],[234,42,9],[255,211,145],[250,249,235],[24,15,10]],dtype=np.int16)
 raw=col.astype(np.int16);dist=((raw[:,:,None,:]-palette[None,None,:,:]).astype(np.float32)**2).sum(3);col[opaque]=palette[dist.argmin(2)][opaque];col[~opaque]=[204,73,140]
 # Identity white brows adapt the captured cream brow surface, not floating image patches.
 brows={'jab1-correct-native5':[(575,412),(636,407),(704,448),(707,496),(661,504),(618,484),(581,477)],'jab2-correct-native4':[(701,266),(756,278),(769,338),(739,355),(716,331),(696,293)],'dtilt-correct-native6':[(676,619),(735,626),(782,644),(778,668),(735,670),(691,656)]}
 region=Image.new('L',(W,H));ImageDraw.Draw(region).polygon(brows[key],fill=255)
 cream=(col[:,:,0]>240)&(col[:,:,1]>170)&(col[:,:,1]<235)&(col[:,:,2]<200)
 brow=np.asarray(region)>0;col[brow&cream&opaque]=[250,249,235]
 colored=warp(Image.fromarray(col))
 # Generate only clean silhouette and major palette boundaries; no eye crop/paste/protection.
 c=np.asarray(colored).astype(int);support=np.asarray(sm)>0;edges=np.zeros((H,W),bool)
 for axis in [0,1]: edges|=(np.max(np.abs(c-np.roll(c,1,axis)),2)>45)&support
 g=Image.fromarray((edges*255).astype('uint8')).filter(ImageFilter.MaxFilter(3))
 x=(i%2)*W;y=(i//2)*H;seed.paste(colored,(x,y));guide.paste(g,(x,y));mask.paste(sm.filter(ImageFilter.MaxFilter(19)),(x,y))
 for kind,im in [('seed',colored),('guide',g),('mask',sm)]:im.save(BASE/(key+'-firstcontact-'+kind+'.png'))
 records.append({'cell':i,'key':key,'native_sample':int(key.split('native')[-1]),'game_age':age,'role':'required_first_contact_pilot_not_accepted','native_source_metadata':str(metadata.relative_to(ROOT)),'native_source_metadata_sha256':sha(metadata),'source_seed_sha256':sha(source),'floor_transform':{'inputBandStartPixelY':start,'inputLastPixelY':last,'targetLastPixelY':target,'rootPixelY':832,'pixelsPerNativeUnit':26},'floor_receiving_requirement':'Refit visible native-body and selected facial point clouds AFTER this same local support-band warp. Do not only warp capsule endpoints. Authored approximation, not native hit_data.','identity_adaptation':'Explicit inspected target red/cream/white/black palette; median11 source texture-grain removal, captured cream brow surface recolored identity white, fully generated interiors; no eye image pasted or protected','root':[512,832],'bodyCentreFromRootY':-42,'scaleToWorld':5/26})
for kind,im in [('seed',seed),('guide',guide),('render-mask',mask)]:im.save(BASE/(prefix+'-'+kind+'.png'))
graph=json.loads((BASE/'dk-identity-contact-pilot-attempt1.workflow.json').read_text())
graph['4']['inputs']['text']='A two by two animation sprite atlas of EXACTLY the same red cartoon Donkey Kong identity as the top left reference. Small BLACK OVAL pupils surrounded by WHITE sclera, thick WHITE eyebrows following the forehead, cream tan rounded muzzle with two small nostrils. Red fur, cream face chest hands feet, vivid red necktie when visible in front; necktie naturally occluded for back facing uppercut. Clean flat cartoon red shading, clear black outline. Top right: low braced straight right fist punch. Bottom left: upward right hook punch with coiled torso and raised near fist, same head size and face anatomy. Bottom right: extremely low all fours posture and flat palm extending right near the floor. Follow every clean anatomy outline and source pose seed exactly, including white eyes in their actual face plane. Each face has exactly one eye pair and one brow pair, joined to its own head. Exactly one head and body per cell. Preserve all body heights, fist reach, hand direction, low posture and foot positions. Uniform magenta background, no ground shadows, no gradients. Keep top left reference unchanged.'
graph['5']['inputs']['text']+=' , red eyes, round bulging eyes, eyes floating off head, extra eyebrows, pasted rectangle, sunglasses, black eye stripe, duplicated eyes, hairy texture, tiny necktie'
graph['7']['inputs'].update(seed=2026100805,denoise=.72)
for n,kind in [('10','guide'),('13','seed'),('16','render-mask')]:graph[n]['inputs']['image']='pf-'+prefix+'-'+kind+'.png'
for n,suffix in [('9','final'),('20','raw')]:graph[n]['inputs']['filename_prefix']='pf-dk-20261008-firstcontact-pilot-attempt1-'+suffix
workflow=prefix+'-attempt1.workflow.json';(BASE/workflow).write_text(json.dumps(graph,indent=2)+'\n')
record={'state':'prepared_actual_input_review_pending','scope':'Clock-correct distinct required first-contact poses native5/4/6; rejected prior precontact native4/3/5 remain source-only and immutable','records':records,'canvas':[W*2,H*2],'cells':[W,H],'root':[512,832],'world_scale':5/26,'workflow':workflow,'workflow_sha256':sha(BASE/workflow),'identity_mechanism':'Actual inspected ID image in VAE starting latent reference cell0 under zero noise mask; each required pose fully generated from target-palette adapted source anatomical guide. No LoRA, no unsupported inpaint input, no protected eye paste. Cross-cell ID acceptance unqualified until actual outputs inspected.','inputs':{k:{'file':prefix+'-'+k+'.png','sha256':sha(BASE/(prefix+'-'+k+'.png'))} for k in ['seed','guide','render-mask']},'runtime':'No shipping changes. Identity, floor, scale, paired receiving and actual runtime contact all pending.'}
(BASE/(prefix+'-preparation.json')).write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps({'workflow':workflow,'records':records[1:],'state':record['state']}))
