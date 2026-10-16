"""Bounded correction preserving actual generated body and identity eye pixels."""
from pathlib import Path
from PIL import Image,ImageDraw,ImageFilter
import numpy as np,json,hashlib,shutil
b=Path('docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/art');sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();W,H=1536,1024;root=(512,832)
raw=Image.open(b/'dk-identity-contact-pilot-attempt1-cutout.png').convert('RGBA');seed=Image.new('RGBA',raw.size,(204,73,140,255));mask=Image.new('L',raw.size,0);guide=Image.new('L',raw.size,0);contracts=[]
reference=Image.open('docs/review/2026-09-25/donkeykong-character/art/idle-keyframe.png').convert('RGBA');eyeref=reference.crop((623,308,733,374));e=np.array(eyeref);rgb=e[:,:,:3].astype(float);pink=(rgb[:,:,2]>rgb[:,:,0]*.7)&(rgb[:,:,2]>rgb[:,:,1]*1.25)&(rgb[:,:,2]>115);e[pink,3]=0;eyeref=Image.fromarray(e).resize((154,92),Image.Resampling.LANCZOS)
for i,key in enumerate(['identity-reference','jab1-native4','jab2-native3','dtilt-native5']):
 x=(i%2)*W;y=(i//2)*H;cell=raw.crop((x,y,x+W,y+H));a=np.array(cell);rgb=a[:,:,:3].astype(float)
 # Pink edge removal preserves explicit red/cream/black identity palette.
 residue=(rgb[:,:,2]>rgb[:,:,0]*.70)&(rgb[:,:,2]>rgb[:,:,1]*1.25)&(rgb[:,:,2]>40);a[residue,3]=0;cell=Image.fromarray(a)
 if i:
  yy,xx=np.where(np.asarray(cell)[:,:,3]>=32);oldmax=int(yy.max());start=760;newbottom=830
  # Local sole/palm/lowestjaw deformation; head/root/scale unchanged above760.
  band=cell.crop((0,start,W,oldmax+1));band=band.resize((W,newbottom-start+1),Image.Resampling.LANCZOS);n=Image.new('RGBA',(W,H));n.alpha_composite(cell.crop((0,0,W,start)),(0,0));n.alpha_composite(band,(0,start));cell=n
  contracts.append({'key':key,'original_generated_cutout_sha256':sha(b/f'pilot-output-{key}-cutout.png'),'deformation':'localized lowerbody sole/palm/lowestjaw compression only; commonroot and bodyabove760 unchanged','source_pixel_y_boundary':start,'source_pixel_y_last':oldmax,'target_pixel_y_last':newbottom,'worldY_from_actor_centre_mapping':{'bodycentre_from_floor':-42,'artroot':root,'worldperpixel':5/26},'receiving_consumer_required':'same piecewiseY deformation for pointY>760, no blanket wholebodytranslation','floor':'final runtime alpha32pending; candidatefloorpixelcentrelimit<=831.5'})
 cm=Image.new('L',(W,H),0)
 if i==1:
  # Independently observed tie follows native S_Necktie1..5; retain generated shape and make the visible red cloth distinct.
  native=np.asarray(Image.open(b/'jab1-native4-reference.png').convert('RGBA'));nrgb=native[:,:,:3].astype(float);rr,gg,bb=nrgb[:,:,0],nrgb[:,:,1],nrgb[:,:,2];yygrid,xxgrid=np.indices(rr.shape)
  ti=(rr>gg*2.5)&(rr>bb*1.2)&(native[:,:,3]>0)&(xxgrid>480)&(xxgrid<770)&(yygrid>400)&(yygrid<705)
  cloth=Image.new('L',(W,H),0);ImageDraw.Draw(cloth).polygon([(543,559),(551,607),(577,655),(625,680),(678,677),(737,651),(711,636),(651,632),(594,604),(560,568)],fill=255);ti=np.asarray(cloth)>0
  ca=np.asarray(cell).copy();ca[ti & (ca[:,:,3]>32),:3]=[236,45,14];cell=Image.fromarray(ca)
  # Native guide identifies cloth, not copied source texture pixels: only generated pixels recolored.
  edge=Image.fromarray((ti*255).astype('uint8'));outer=np.asarray(edge.filter(ImageFilter.MaxFilter(9)));inner=np.asarray(edge.filter(ImageFilter.MinFilter(9)));cm=Image.fromarray(np.where((outer>0)&(inner==0),255,0).astype('uint8'));mask.paste(cm,(x,y));guide.paste(Image.open(b/'jab1-native4-guide.png').convert('L'),(x,y))
 if i==2:
  # Actual accepted identity image supplies brows/sclera/pupils, never an invented prompt-only feature.
  d=ImageDraw.Draw(cell);d.polygon([(700,340),(760,325),(851,326),(852,417),(782,451),(704,430)],fill=(178,24,4,255));cell.alpha_composite(eyeref,(701,350));md=ImageDraw.Draw(cm);md.polygon([(690,332),(765,316),(859,319),(860,423),(784,457),(696,437)],fill=255)
  # Protect actual white/black identity features and blend only red seams.
  ca=np.asarray(cell);protected=(ca[:,:,0]>210)&(ca[:,:,1]>190)&(ca[:,:,2]>155);protected|=(ca[:,:,0]<45)&(ca[:,:,1]<45)&(ca[:,:,2]<45);ma=np.asarray(cm).copy();ma[protected]=0;cm=Image.fromarray(ma)
  contours=Image.fromarray(np.asarray(cell)[:,:,3]).filter(ImageFilter.MaxFilter(3));g=Image.fromarray((np.max(np.abs(np.asarray(cell)[:,:,:3].astype(int)-np.roll(np.asarray(cell)[:,:,:3].astype(int),1,axis=0)),axis=2)>35).astype('uint8')*255);guide.paste(g,(x,y));mask.paste(cm,(x,y))
 bg=Image.new('RGBA',(W,H),(204,73,140,255));bg.alpha_composite(cell);seed.paste(bg,(x,y));cell.save(b/f'pilot-corrected-{key}-seed-cutout.png')
seed.convert('RGB').save(b/'dk-identity-contact-pilot-correction-seed.png');mask.save(b/'dk-identity-contact-pilot-correction-render-mask.png');guide.save(b/'dk-identity-contact-pilot-correction-guide.png')
w=json.loads((b/'dk-identity-contact-pilot-attempt1.workflow.json').read_text());w['4']['inputs']['text']='Correct only the masked red face seams around actual reference eyes in cell2 and contour seams of the vivid red necktie in cell1. The red cloth must be visibly distinct from dark red fur, keeping native cloth pose. Preserve the exact Donkey Kong reference brows, white sclera and dark pupils supplied in the seed. Same red cartoon gorilla identity, clean flat simple shading, no new eyes or marks. All other body pixels, poses, scale, feet and cells remain unchanged.'
w['9']['inputs']['filename_prefix']='pf-dk-20261008-identity-contact-pilot-attempt2-final';w['20']['inputs']['filename_prefix']='pf-dk-20261008-identity-contact-pilot-attempt2-raw'
for n,kind in [('10','guide'),('13','seed'),('16','render-mask')]:w[n]['inputs']['image']='pf-dk-identity-contact-pilot-correction-'+kind+'.png'
(b/'dk-identity-contact-pilot-attempt2.workflow.json').write_text(json.dumps(w,indent=2)+'\n');seed.convert('RGB').resize((1536,1024)).save(b/'dk-identity-contact-pilot-correction-input-review.png')
record={'state':'prepared_review_pending','attempt':2,'scope':'Three retainedgeneratedcontactposes, eye-seam and visible necktie-contour generation only. No expandedposes or deliveredstripchanges','contracts':contracts,'identity_actual_eye_reference':{'path':'docs/review/2026-09-25/donkeykong-character/art/idle-keyframe.png','sha256':sha(Path('docs/review/2026-09-25/donkeykong-character/art/idle-keyframe.png')),'crop':[623,308,733,374],'derived_size':[154,92],'target_cell2_location':[701,350],'protected_pixels':'actualwhite/blackreferencepixels excludedmask; surroundingred seamgenerated'},'root':[512,832],'world_scale':5/26,'world_floor_offset_from_actorcentre':42,'workflow':'dk-identity-contact-pilot-attempt2.workflow.json','workflow_sha256':sha(b/'dk-identity-contact-pilot-attempt2.workflow.json'),'canvas':[3072,2048],'inputs':{kind:{'file':'dk-identity-contact-pilot-correction-'+kind+'.png','sha256':sha(b/('dk-identity-contact-pilot-correction-'+kind+'.png'))}for kind in ['seed','guide','render-mask']},'runtime':'allfloorbody/capsules actualmatchpending'}
(b/'dk-identity-contact-pilot-correction-preparation.json').write_text(json.dumps(record,indent=2)+'\n');print('boundedcorrection prepared')
