"""Bounded own-source standing pose inputs under delegated specialist review.
Only creates versioned review artifacts; no native evaluation, GPU, or shipping.
"""
from pathlib import Path
import argparse,json,hashlib
import numpy as np
from PIL import Image,ImageDraw,ImageFilter
from scipy.ndimage import binary_fill_holes,distance_transform_edt
R=Path(__file__).resolve().parents[1];A=R/'docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/art';BG=(204,73,140)
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def pin(p):return {'path':str(p.relative_to(R)),'sha256':sha(p)}
def polygon_mask(poly,size):
 im=Image.new('L',size);ImageDraw.Draw(im).polygon(poly,fill=255);return np.asarray(im)>0

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--recipe',type=Path,required=True);ap.add_argument('--input-slot-released',action='store_true');args=ap.parse_args()
 if not args.input_slot_released:raise ValueError('Exclusive art resource required')
 recipe=json.loads(args.recipe.read_text());assert recipe['actualNativeSourceImagesReviewed'];family=recipe['jobFamily'];dest=A/(family+'-preparation.json')
 if dest.exists():raise ValueError('Preserve existing prepared inputs')
 ref=R/recipe['identityReference']['path'];assert sha(ref)==recipe['identityReference']['sha256'];canvas=Image.new('RGB',(1536,1024),BG);refcell=Image.new('RGBA',(768,512),BG+(255,));refcell.alpha_composite(Image.open(ref).convert('RGBA').resize((768,512),Image.Resampling.LANCZOS));canvas.paste(refcell.convert('RGB'),(0,0));guides=Image.new('L',canvas.size);noise=Image.new('L',canvas.size);rows=[]
 for idx,f in enumerate(recipe['poses']):
  n=f['nativeSample'];prefix=A/f'fullgrab01-grab-native{n}';meta=Path(str(prefix)+'.json');assert sha(meta)==f['sourceGuideSha256'];md=json.loads(meta.read_text());assert md['root']==[512,832] and md['canvas']==[1536,1024]
  for file,h in md['output_files'].items():assert sha(A/file)==h
  alpha=np.asarray(Image.open(str(prefix)+'-mask.png').convert('L')).copy();old=alpha.copy();source=np.asarray(Image.open(str(prefix)+'-palette-seed.png').convert('RGB'));on=alpha>=32;envelope=binary_fill_holes(on);depth=distance_transform_edt(envelope);selection=np.zeros(on.shape,bool);skin=np.zeros(on.shape,bool)
  for d in f['materialDomains']:
   m=polygon_mask(d['polygon'],(1536,1024));selection|=m
   if d['material']=='skin':skin|=m
  gap=np.zeros(on.shape,bool)
  for box in f['realGapBoxes']:
   x0,y0,x1,y1=box;gap[y0:y1,x0:x1]=True
  repairs=selection&envelope&(depth>3)&(alpha<255)&~gap;alpha[repairs]=255
  assert np.array_equal(old[gap],alpha[gap]);assert np.array_equal(binary_fill_holes(alpha>=32),envelope)
  visible=alpha>=32;last=int(np.where(on)[0].max());assert last==f['measuredSourceLastSupportPixelY'];smooth=np.asarray(Image.fromarray(source).filter(ImageFilter.MedianFilter(21)));palette=np.array([[190,22,5],[233,16,1],[255,211,145],[252,250,238],[24,15,10]],dtype=np.int16);dist=((smooth.astype(np.int16)[:,:,None,:]-palette[None,None,:,:]).astype('float32')**2).sum(3);rgb=palette[dist.argmin(2)].astype('uint8');rgb[visible&(rgb[:,:,0]<60)]=[164,17,4]
  cream=((source[:,:,0]>240)&(source[:,:,1]>150)&on)|skin;rgb[repairs&cream]=[255,211,145];rgb[repairs&~cream]=[190,22,5];rgb[~visible]=BG;im=Image.fromarray(rgb);dr=ImageDraw.Draw(im)
  for d in f['paintDomains']:dr.polygon(d['polygon'],fill=tuple(d['RGB']))
  for eye in f['eyes']:dr.ellipse(eye['scleraBox'],fill=(253,250,238));dr.ellipse(eye['pupilBox'],fill=(20,12,7))
  for line in f['fingerCreaseGuides']:dr.line(line,fill=(156,100,64),width=4,joint='curve')
  painted=np.asarray(im).copy();painted[~visible]=BG
  def warp(im):
   out=Image.new(im.mode,(1536,1024),0 if im.mode=='L' else BG);out.paste(im.crop((0,0,1536,760)),(0,0));out.paste(im.crop((0,760,1536,last+1)).resize((1536,71),Image.Resampling.NEAREST if im.mode=='L' else Image.Resampling.BICUBIC),(0,760));return out
  rgbimage=warp(Image.fromarray(painted));support=warp(Image.fromarray(alpha));sp=A/(family+f'-native{n}-authored-seed.png');af=A/(family+f'-native{n}-authored-alpha.png');rgbimage.save(sp);support.save(af)
  pos=[768,0] if idx==0 else [0,512];half=rgbimage.resize((768,512),Image.Resampling.LANCZOS);h=np.asarray(half).astype(int);edges=np.zeros((512,768),bool)
  for axis in [0,1]:edges|=np.max(np.abs(h-np.roll(h,1,axis)),2)>35
  canvas.paste(half,tuple(pos));guides.paste(Image.fromarray((edges*255).astype('uint8')),tuple(pos));noise.paste(support.resize((768,512),Image.Resampling.LANCZOS).filter(ImageFilter.MaxFilter(11)),tuple(pos))
  body=rgbimage.convert('RGBA');body.putalpha(support)
  for mode,color in [('dark',(25,30,39)),('light',(247,246,238))]:
   bg=Image.new('RGBA',body.size,color+(255,));bg.alpha_composite(body);bg.convert('RGB').save(A/(family+f'-native{n}-input-{mode}.png'))
  q=body.resize((384,256),Image.Resampling.LANCZOS);q.save(A/(family+f'-native{n}-input-quarter.png'));py=np.where(np.asarray(q)[:,:,3]>=32)[0];delta=(int(py.max())+.5-208)*5/6.5;assert abs(delta)<=.55
  world=Image.new('RGBA',(1000,330),(25,30,39,255));ImageDraw.Draw(world).line((0,230,1000,230),fill=(95,113,140));refbody=Image.open(ref).convert('RGBA')
  for cx,b,rx in [(130,refbody,512),(440,body,512),(780,body.transpose(Image.Transpose.FLIP_LEFT_RIGHT),1024)]:world.alpha_composite(b.resize((295,197),Image.Resampling.LANCZOS),(cx-round(rx*5/26),230-round(832*5/26)))
  world.convert('RGB').save(A/(family+f'-native{n}-input-world.png'))
  domain=Image.open(str(prefix)+'-palette-seed.png').convert('RGB');dd=ImageDraw.Draw(domain)
  for d in f['materialDomains']:dd.line(d['polygon']+[d['polygon'][0]],fill=(40,215,240),width=3)
  for box in f['realGapBoxes']:dd.rectangle(box,outline=(250,220,50),width=3)
  for line in f['fingerCreaseGuides']:dd.line(line,fill=(60,240,90),width=4)
  domain.save(A/(family+f'-native{n}-feature-domains.png'))
  rows.append({'clip':'grab','nativeSample':n,'gameplayAge':n-1,'sourceImageIndex':n-1,'prefix':f'fullgrab01-grab-native{n}','cell':idx+1,'cellPosition':pos,'sourceGuide':pin(meta),'authoredSeed':pin(sp),'authoredAlpha':pin(af),'authoredPoseAlpha':af.name,'authoredPoseAlphaSha256':sha(af),'materialAlphaRepairs':{'changedPixels':int(repairs.sum()),'alphaZeroMaterialPixels':int((repairs&(old==0)).sum()),'alpha32ExteriorFilledEnvelopeUnchanged':True,'trueGapsUnchanged':True,'explicitRGBBeforeClamp':True},'floorTransform':{'inputBandStartPixelY':760,'inputLastPixelY':last,'targetLastPixelY':830,'inclusiveRowsRatio':71/(last-760+1),'rootPixelY':832,'pixelsPerNativeUnit':26},'packedFloorDelta':delta})
 inputs={}
 for node,kind,im in [('10','guide',guides),('13','seed',canvas),('16','render-mask',noise)]:
  p=A/(family+'-'+kind+'.png');im.save(p);inputs[kind]={**pin(p),'file':p.name,'graphNode':node,'serverFilename':'pf-'+family+'-'+kind+'.png'}
 graph=json.loads((A/'dk-fullgrab-standing-reach01-attempt1.workflow.json').read_text());graph['4']['inputs']['text']=recipe['prompt'];graph['7']['inputs']['seed']=recipe['seed']
 for k,v in inputs.items():graph[v['graphNode']]['inputs']['image']=v['serverFilename']
 for node,kind in [('9','final'),('20','raw')]:graph[node]['inputs']['filename_prefix']='pf-'+family+'-attempt1-'+kind
 gf=A/(family+'-attempt1.workflow.json');gf.write_text(json.dumps(graph,indent=2)+'\n')
 result={'state':'actual_authored_inputs_review_pending','jobFamily':family,'attempt':1,'records':rows,'inputs':inputs,'workflow':gf.name,'workflow_sha256':sha(gf),'canvas':[1536,1024],'cells':[768,512],'identityReference':recipe['identityReference'],'identity_mechanism':'Accepted DK target cell0 VAE initial latent/noise0 plus own source-conditioned palette/edges through installed ZImageFunControlnet; output visually reviewed; no LoRA claim.','outputNodes':{'9':'final','20':'raw'},'recipe':pin(args.recipe.resolve()),'tool':pin(Path(__file__)),'referenceAndEmptyCellsNoiseZero':True,'maskKernel':'MaxFilter11x11,5halfcanvaspixelradius','canonicalChanged':False};dest.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(pin(dest)))
if __name__=='__main__':main()
