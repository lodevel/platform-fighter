"""Author small source-layout eye palette and palm cleanup on generated bodies.
No captured native RGB pixels are copied; use actual selected identity white/black
palette in the source eye mesh layout. Retain all unrelated generated RGBA bytes.
"""
from pathlib import Path
from PIL import Image,ImageDraw
import numpy as np,json,hashlib
b=Path('docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/art');sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();records=[]
for key in ['jab1-native4','dtilt-native5']:
 base=b/f'pilot2-output-{key}-cutout.png';a=np.asarray(Image.open(base).convert('RGBA')).copy();original=a.copy();old=np.asarray(Image.open(b/(key+'-reference.png')).convert('RGBA'));new=np.asarray(Image.open(b/(key+'-eye-texture1-reference.png')).convert('RGBA'))
 eye=(np.max(np.abs(old[:,:,:3].astype(int)-new[:,:,:3].astype(int)),axis=2)>20)&(new[:,:,3]>32)&(a[:,:,3]>32)
 dark=np.mean(new[:,:,:3],axis=2)<100
 brow=Image.new('L',(1536,1024),0);bd=ImageDraw.Draw(brow)
 if key=='jab1-native4':bd.polygon([(630,405),(647,404),(670,423),(698,444),(726,449),(745,441),(749,454),(730,466),(700,458),(665,435),(647,423),(635,426)],fill=255)
 else:bd.polygon([(710,647),(730,653),(764,664),(790,674),(790,687),(762,678),(733,668),(716,664)],fill=255)
 br=(np.asarray(brow)>0)&(a[:,:,0]>180)&(a[:,:,1]>140)&(a[:,:,2]>80)&(a[:,:,3]>32)
 a[br,:3]=[250,249,235]
 a[eye & dark,:3]=[22,17,16];a[eye & ~dark,:3]=[250,249,235]
 # No target RGB sampled from game reference: all colors are explicit identity-palette constants.
 palm_pixels=0
 if key=='dtilt-native5':
  p=Image.new('L',(1536,1024),0);ImageDraw.Draw(p).polygon([(1108,698),(1149,683),(1145,741),(1121,742)],fill=255);pm=np.asarray(p)>0;pm&=a[:,:,3]>32;palm_pixels=int(pm.sum());a[pm,:3]=[250,207,140]
 out=b/f'pilot3-authored-{key}-cutout.png';Image.fromarray(a).save(out)
 for k,c in [('light',(244,244,240,255)),('dark',(32,39,46,255))]:
  bg=Image.new('RGBA',(1536,1024),c);bg.alpha_composite(Image.fromarray(a));bg.convert('RGB').save(b/f'pilot3-authored-{key}-{k}.png')
 changed=np.any(a!=original,axis=2);assert np.array_equal(a[:,:,3],original[:,:,3]);assert int(changed.sum())<=int(eye.sum())+palm_pixels+int(br.sum())
 records.append({'key':key,'state':'authoredcandidate_actualvisual_reviewpending','generated_parent':{'path':str(base),'sha256':sha(base)},'source_eye_layout_old':{'path':str(b/(key+'-reference.png')),'sha256':sha(b/(key+'-reference.png'))},'source_eye_layout_Texture1':{'path':str(b/(key+'-eye-texture1-reference.png')),'sha256':sha(b/(key+'-eye-texture1-reference.png'))},'method':'Color-only mapped eye primitive IDpalette22/17/16 and250/249/235 using source-layout correction; no gameRGB copied. Palm darktriangle solidcream cleanup with samegeneratedshape.','eye_pixels':int(eye.sum()),'white_brow_pixels':int(br.sum()),'palm_pixels':palm_pixels,'changed_pixels':int(changed.sum()),'unchanged_alpha':True,'preserved_root_scale_floor':True,'output':{'path':str(out),'sha256':sha(out)},'source_limits':'Eye Texture1 staticUV layout authoredreference only; real ocularshader/gaze not reproduced; nativeindexprecontact remainsunchanged','runtime':'sourceclockcorrectcompleteclips/pairedreceiving/actualbothface match pending'})
(b/'pilot3-eye-palm-authoring.json').write_text(json.dumps(records,indent=2)+'\n');print(json.dumps(records))
