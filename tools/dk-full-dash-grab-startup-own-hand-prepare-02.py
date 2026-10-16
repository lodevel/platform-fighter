"""Isolated own-parent hand-only dash startup attempt2 inputs, never submit GPU."""
from pathlib import Path
import argparse,copy,hashlib,json
import numpy as np
from PIL import Image,ImageDraw,ImageFilter,ImageOps
R=Path(__file__).resolve().parents[1];A=R/'docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/art'
O='dk-fullgrab-dash-startup01-attempt2-localhand'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def pin(p):return {'path':str(p.relative_to(R)),'sha256':sha(p)}
def comp(im,c):
 b=Image.new('RGBA',im.size,c+(255,));b.alpha_composite(im);return b.convert('RGB')
def save(im,s):
 p=A/(O+'-'+s+'.png');assert not p.exists(),p;im.save(p);return p
F={1:{'handPolygons':[[[788,586],[814,556],[899,545],[989,585],[993,679],[977,730],[935,771],[879,731],[789,724]],[[568,207],[633,178],[691,143],[740,141],[775,188],[771,280],[738,338],[641,318],[593,325]]], 'creases':[[[840,606],[848,620],[868,634]],[[819,648],[837,659],[849,681]],[[867,634],[895,628]],[[892,677],[909,691]],[[904,719],[919,730]],[[624,213],[641,219],[660,211],[673,201]],[[623,246],[642,244],[658,233]],[[652,280],[671,285],[686,288]]], 'thumbBoundary':[[812,607],[826,590],[850,579],[869,578]],'notes':'Five open forehand projections, fan gaps unchanged. Rear spread fingers, source thumb across palm, short source-cued folds; no closed-fist substitution.'},4:{'handPolygons':[[[823,629],[876,612],[929,626],[940,697],[916,750],[886,798],[842,793],[810,760],[820,726]],[[357,185],[406,148],[459,99],[493,84],[529,83],[531,147],[519,200],[559,226],[562,263],[501,271],[449,253],[400,242]]], 'creases':[[[892,660],[899,684],[901,710],[892,728]],[[868,698],[878,713],[881,729]],[[841,739],[850,746],[863,749],[872,741]],[[853,766],[862,774],[879,775]],[[455,174],[471,186],[491,197]],[[438,197],[452,205],[463,215]],[[474,129],[487,140]],[[478,151],[489,162]]], 'thumbBoundary':[[840,734],[850,724],[863,719],[874,723]],'notes':'Forehand fingers curled down and partly occluded by own forearm, three restrained folded-finger creases and hooked thumb boundary. Rear hand high thumb and visible branch folds, no open-forefan substitution.'}}

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--parents-receipt',type=Path,required=True);ap.add_argument('--expected-parents-sha256',required=True);ap.add_argument('--input-preparation-slot-released',action='store_true');a=ap.parse_args()
 assert a.input_preparation_slot_released;pr=a.parents_receipt.resolve();assert sha(pr)==a.expected_parents_sha256
 parents=json.loads(pr.read_text());oldp=A/'dk-fullgrab-dash-startup01-reviewed-generation-preparation.json';old=json.loads(oldp.read_text());op=A/(O+'-preparation.json');assert not op.exists()
 seed=Image.new('RGB',(1536,1024),(255,0,255));guide=Image.new('RGB',seed.size);mask=Image.new('L',seed.size)
 oldseed=Image.open(A/old['inputs']['seed']['file']);assert sha(A/old['inputs']['seed']['file'])==old['inputs']['seed']['sha256'];seed.paste(oldseed.crop((0,0,768,512)),(0,0))
 rows=[];viewpins=[]
 for n,pos in [(1,(768,0)),(4,(0,512))]:
  par=next(x for x in parents['poses'] if x['nativeSample']==n);p=R/par['target']['path'];assert sha(p)==par['target']['sha256'];base=Image.open(p).convert('RGBA');ba=np.array(base);alpha=ba[:,:,3]
  prior=next(x for x in old['records'] if x['nativeSample']==n);assert sha(R/prior['sourceGuide']['path'])==prior['sourceGuide']['sha256'];own=json.loads((R/prior['sourceGuide']['path']).read_text());assert own['native_sample_index']==n
  hand=Image.new('L',base.size);dr=ImageDraw.Draw(hand)
  for poly in F[n]['handPolygons']:dr.polygon(poly,fill=255)
  h=np.array(hand)>0;h&=alpha>=32
  seeded=base.copy();d=ImageDraw.Draw(seeded)
  for line in F[n]['creases']+[F[n]['thumbBoundary']]:d.line(line,fill=(161,101,63,255),width=4,joint='curve')
  sa=np.array(seeded);sa[~h]=ba[~h];sa[:,:,3]=alpha;seeded=Image.fromarray(sa)
  assert np.array_equal(sa[:,:,3],alpha);assert np.array_equal(sa[~h],ba[~h])
  local=Image.fromarray((h*255).astype('uint8')).filter(ImageFilter.MaxFilter(11)).filter(ImageFilter.GaussianBlur(2));lm=np.array(local);lm[alpha<32]=0;local=Image.fromarray(lm)
  # Source pose eye/brow untouched even by mask blur; every output restores own
  # base outside this actual mask's half->full reconstruction.
  eye=par['eyeAndMuzzleGuardBox'];x0,y0,x1,y1=eye;assert not lm[y0:y1,x0:x1].any()
  apath=save(Image.fromarray(alpha),f'native{n}-own-alpha');spath=save(seeded,f'native{n}-seed');mpath=save(local,f'native{n}-hand-mask')
  seed.paste(comp(seeded,(255,0,255)).resize((768,512),Image.Resampling.LANCZOS),pos);edges=comp(seeded,(255,0,255)).convert('L').filter(ImageFilter.FIND_EDGES);ea=np.array(edges);ea[lm==0]=0;guide.paste(Image.fromarray(ea).convert('RGB').resize((768,512),Image.Resampling.LANCZOS),pos);mask.paste(local.resize((768,512),Image.Resampling.LANCZOS),pos)
  for mode,c in [('light',(247,246,238)),('dark',(25,30,39))]:viewpins.append(pin(save(comp(seeded,c),f'native{n}-seed-{mode}')))
  v=Image.new('RGB',(1080,500));ref=Image.open(R/old['identityReference']['path']).convert('RGBA')
  for j,c in enumerate([(25,30,39),(247,246,238)]):
   for i,(im,flip) in enumerate([(ref,False),(seeded,False),(seeded,True)]):
    w=im.resize((295,197),Image.Resampling.LANCZOS);rx=512*5/26
    if flip:w=ImageOps.mirror(w);rx=w.width-rx
    cell=Image.new('RGBA',(360,250),c+(255,));cell.alpha_composite(w,(round(130-rx),round(185-832*5/26)));ImageDraw.Draw(cell).line((0,185,359,185),fill=(115,125,135));v.paste(cell.convert('RGB'),(360*i,250*j))
  viewpins.append(pin(save(v,f'native{n}-reference-bothface-light-dark-world')))
  # Exact own source vs rejected parent vs authored hand seed crop: both hands.
  src=Image.open(A/f'fullgrab01-dash_grab-native{n}-reference.png').convert('RGBA');strip=Image.new('RGB',(1200,720),(240,239,232));boxes=([(784,545,998,777),(562,135,777,339)] if n==1 else [(806,612,944,802),(350,80,568,272)])
  for row,box in enumerate(boxes):
   for col,im in enumerate([src,base,seeded]):strip.paste(comp(im,(247,246,238)).crop(box).resize((390,320)),(col*400,row*360+25))
  ImageDraw.Draw(strip).text((6,7),'Own native source / corrected own parent / local source-cued hand seed',fill='black');viewpins.append(pin(save(strip,f'native{n}-own-source-hand-comparison')))
  row={k:copy.deepcopy(prior[k]) for k in ['clip','nativeSample','gameplayAge','sourceImageIndex','cell','cellPosition','sourceGuide','prefix','sourceSupport']}
  row.update({'authoredPoseAlpha':apath.name,'authoredPoseAlphaSha256':sha(apath),'sourceBaseCandidate':{**pin(p),'clip':'dash_grab','nativeSample':n,'gameplayAge':n-1},'localMask':pin(mpath),'handSeed':pin(spath),'alphaBytesUnchanged':True,'RGBOutsideActualHandPolygonsUnchanged':True,'handFeatureNotes':F[n]['notes'],'ownSourceAndParentOnly':True});rows.append(row)
 inputs={}
 for label,im,node in [('seed',seed,'13'),('guide',guide,'10'),('render-mask',mask,'16')]:
  p=save(im,label);inputs[label]={'file':p.name,'sha256':sha(p),'graphNode':node,'serverFilename':'pf-'+O+'-'+label+'.png'}
 assert not np.array(mask)[:512,:768].any();assert not np.array(mask)[512:,768:].any();assert np.array_equal(np.array(seed)[:512,:768],np.array(oldseed)[:512,:768])
 graph=copy.deepcopy(json.loads((A/'dk-fullgrab-dash-startup01-attempt1.workflow.json').read_text()))
 for label,p in inputs.items():graph[p['graphNode']]['inputs']['image']=p['serverFilename']
 graph['7']['inputs']['seed']=2026101002
 graph['4']['inputs']['text']='HAND-ONLY source-cued anatomy correction. Red cartoon Donkey Kong, unchanged target identity and existing body. Top right native1: OPEN forward five projection fan with distinct palm-thumb joint boundary and restrained brown digit folds; rear spread hand with source thumb and joint crease planes. Bottom left native4: foreground hand CURLS DOWN beneath forearm, partly occluded folded fingers, visible curved knuckle creases and hooked thumb boundary, not a flat cream flipper; raised rear hand with source thumb boundary and visible finger folds. Preserve supplied exact hand outlines, true gaps and source pose planes. Warm cream skin, restrained cel shading, thin warm-brown anatomical creases. Change ONLY local hand masks. Keep eyes, brow, head, red fur, garment, limbs, root and feet EXACT. No additional digits, gloves, holes, cream chest, smooth belly, pink fringe, crosshatch, extra fighter, shadow or text. Reference top-left and empty bottom-right unchanged.'
 for node,suffix in [('9','final'),('20','raw')]:graph[node]['inputs']['filename_prefix']='pf-dk-fullgrab-dash-startup01-attempt2-'+suffix
 gp=A/'dk-fullgrab-dash-startup01-attempt2.workflow.json';assert not gp.exists();gp.write_text(json.dumps(graph,indent=2)+'\n')
 recipe={'state':'OWN_HAND_ONLY_INPUT_RECIPE_ACTUAL_REVIEW_PENDING','features':F,'parentReceipt':pin(pr),'sourceGuides':[x['sourceGuide'] for x in rows],'maskKernel':{'fullPixels':[11,11],'radiusFullPixels':5,'blurSigmaFullPixels':2},'alphaExactOwnParent':True,'outsideMaskOutputPolicy':'Restore each row own sourceBaseCandidate, never generic parent. No material alpha changes in GPU output.'}
 rp=A/(O+'-recipe.json');rp.write_text(json.dumps(recipe,indent=2)+'\n')
 result={'state':'actual_localized_dash_inputs_root_review_pending','jobFamily':'dk-fullgrab-dash-startup01','attempt':2,'canvas':[1536,1024],'cells':[768,512],'records':rows,'inputs':inputs,'workflow':gp.name,'workflow_sha256':sha(gp),'identityReference':old['identityReference'],'recipe':pin(rp),'tool':pin(Path(__file__)),'parentsReceipt':pin(pr),'actualReviewViews':viewpins,'correctionDomains':True,'GPUUsed':False,'shippingChanged':False,'generatedTargetAcceptance':False,'queueSubmissionAuthorized':False}
 op.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'receipt':pin(op),'views':viewpins,'inputs':inputs,'workflow':pin(gp)}))
if __name__=='__main__':main()
