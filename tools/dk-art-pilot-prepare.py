"""Prepare bounded identity-image-conditioned DK pilot; never submits jobs."""
from pathlib import Path
from PIL import Image,ImageFilter
import json,hashlib,numpy as np
ROOT=Path(__file__).resolve().parent.parent
BASE=ROOT/'docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/art'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
W,H=1536,1024
size=(W*2,H*2)
seed=Image.new('RGB',size,(204,73,140));guide=Image.new('L',size,0);mask=Image.new('L',size,0)
ref=ROOT/'docs/review/2026-09-25/donkeykong-character/art/idle-keyframe.png'
a=np.array(Image.open(ref).convert('RGBA'));rgb=a[:,:,:3].astype(float);bg=(rgb[:,:,2]>rgb[:,:,0]*.70)&(rgb[:,:,2]>rgb[:,:,1]*1.25)&(rgb[:,:,2]>115);a[bg,3]=0
idim=Image.fromarray(a);box=idim.getbbox();idim=idim.crop(box);ratio=540/idim.height;idim=idim.resize((round(idim.width*ratio),540),Image.Resampling.LANCZOS)
idcanvas=Image.new('RGBA',(W,H),(204,73,140,255));idcanvas.alpha_composite(idim,(512-idim.width//2,832-idim.height));seed.paste(idcanvas.convert('RGB'),(0,0))
# The inspected actual identity stays in sampling latents under a zero mask.
keys=['jab1-native4','jab2-native3','dtilt-native5']
records=[{'cell':0,'role':'actual_inspected_identity_reference','path':str(ref.relative_to(ROOT)),'sha256':sha(ref),'generation_mask':'zero_preserves_actual_reference_pixels','output_role':'conditioning_only_not_delivered'}]
for i,key in enumerate(keys,1):
 x=(i%2)*W;y=(i//2)*H
 p=BASE/(key+'-palette-seed.png');g=BASE/(key+'-guide.png');m=BASE/(key+'-mask.png')
 # Mild sourceguide denoise only, not a delivered or accepted asset.
 im=Image.open(p).convert('RGB').filter(ImageFilter.MedianFilter(5));seed.paste(im,(x,y))
 guide.paste(Image.open(g).convert('L'),(x,y))
 mask.paste(Image.open(m).convert('L').filter(ImageFilter.MaxFilter(19)),(x,y))
 records.append({'cell':i,'role':'native_motion_guide','key':key,'source_metadata':str((BASE/(key+'.json')).relative_to(ROOT)),'source_metadata_sha256':sha(BASE/(key+'.json')),'seed_sha256':sha(p),'guide_sha256':sha(g),'mask_sha256':sha(m),'pose_root':[512,832],'pixels_per_native_unit':26,'world_units_per_native_unit':5,'output_role':'pilot_only_runtime_pending'})
for kind,im in [('seed',seed),('guide',guide),('render-mask',mask)]:im.save(BASE/f'dk-identity-contact-pilot-{kind}.png')
old=ROOT/'docs/review/2026-10-06/pikachu-character/art/tiled-tilts-medium-pilot-source0-attempt2.workflow.json'
workflow=json.loads(old.read_text());workflow['4']['inputs']['text']='A two-by-two sprite atlas. Cell0 is the identity reference: red cartoon Donkey Kong gorilla, cream tan face chest hands feet, red necktie, small dark eyes, expressive cream brows, broad muscular gorilla anatomy. Reproduce that exact identity and simple flat cartoon style in all three other cells. Cell1 crouched gorilla throws straight punch toward right with the near fist fully extended, far fist held back. Cell2 same body proportions in upward hook punch toward right, near fist rising, torso coiled. Cell3 same gorilla is crouched extremely low on all fours, near arm braced under face and far arm extending straight forward to right along ground. Follow each source pose outline and colored seed exactly. Never move or scale any drawing. Preserve the rightward fist contact and low flat down-tilt posture. Black outline, simple clean flat red shading, not photorealistic. Uniform magenta background, no ground shadows, no glow, no opponents or collision diagrams, no weapons. Exactly one character per cell, no duplicate heads or arms. Keep cell0 unchanged.'
workflow['5']['inputs']['text']='photorealism, 3D render, brown fur, yellow gorilla, furry texture, extra limbs, missing head, duplicate face, giant torso, shrunken fist, orb, glow, equipment, sword, text, letters, logo, signature, watermark, shadow, drop shadow, ground shadow, cast shadow, reflection, gradient background'
workflow['7']['inputs']['seed']=2026100802
for n,kind in [('10','guide'),('13','seed'),('16','render-mask')]:
 workflow[n]['inputs']['image']=f'pf-dk-identity-contact-pilot-{kind}.png'
workflow['17']['inputs']['image']=['16',0]
workflow['9']['inputs']['filename_prefix']='pf-dk-20261008-identity-contact-pilot-attempt1-final'
workflow['20']['inputs']['filename_prefix']='pf-dk-20261008-identity-contact-pilot-attempt1-raw'
# Full generated body interiors, conditioned on an actual identity image; native source body is never protected or delivered as final art.
workflow['19']['inputs']['resize_source']=False
(BASE/'dk-identity-contact-pilot-attempt1.workflow.json').write_text(json.dumps(workflow,indent=2)+'\n')
review=Image.new('RGB',(1536,1024),'white');review.paste(seed.resize((1536,1024)),(0,0));review.save(BASE/'dk-identity-contact-pilot-input-review.png')
record={'state':'prepared_actual_input_review_pending','profile':'new_dk_identity_image_VAEseed_FunControl_8Euler_cfg1_denoise065_noLoRA','records':records,'canvas':list(size),'cells':[W,H],'workflow':'dk-identity-contact-pilot-attempt1.workflow.json','identity_mechanism':'Actual reviewed identity pixels in VAE conditioned starting latent, retained by noise mask; sourcepose cells generated fully via masked img2img. Identity acceptance unproven until actual pilot inspection. Pose patch is older non-inpaint Union; inpaint_image not claimed as effective.','source_model_pixels_delivery':'never_directly_delivered','inputs':{kind:{'file':f'dk-identity-contact-pilot-{kind}.png','sha256':sha(BASE/f'dk-identity-contact-pilot-{kind}.png')} for kind in ['seed','guide','render-mask']},'workflow_sha256':sha(BASE/'dk-identity-contact-pilot-attempt1.workflow.json'),'root':[512,832],'world_scale':5/26,'runtime':'pending actual bothface scale/sourcecollision/floor checks'}
(BASE/'dk-identity-contact-pilot-preparation.json').write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps({'canvas':size,'workflowSHA':record['workflow_sha256'],'identity_reference_sha':sha(ref)}))
