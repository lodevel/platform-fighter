"""Stage approved four-cell anatomy corrections and same-clock receiving.

No live mutation during preparation. Candidate install is guarded and reversible;
original asset/metadata/leaf bytes are retained. Actual candidate body/caps/floor
review and a subsequent immutable production probe are separate gates.
"""
from pathlib import Path
import argparse,copy,json,math,re,shutil
from PIL import Image,ImageDraw
from pikachu_native_pose import ROOT,sha
E=ROOT/'docs/review/2026-10-06/pikachu-character';B=E/'art';A=ROOT/'assets/characters/pikachu';D=E/'art/floor-retarget-staged';KEY='tiled-floor-retarget-medium-pilot-bounded-source0'
parser=argparse.ArgumentParser();parser.add_argument('--install-reviewed-candidate',action='store_true');parser.add_argument('--restore-prior',action='store_true');args=parser.parse_args()
receipt=D/'candidate.json'
if args.install_reviewed_candidate or args.restore_prior:
 d=json.loads(receipt.read_text());rows=d['installFiles'];restoring=args.restore_prior
 if not restoring and d['state']!='staged_cells_and12caps_actually_reviewed_ready_for_candidate_runtime':raise ValueError('Actual saved body/12caps review required before install')
 for r in rows:
  live=ROOT/r['live'];expected=r['candidateSha256'] if restoring else r['priorSha256'];source=ROOT/r['priorBackup'] if restoring else ROOT/r['candidate']
  if sha(live)!=expected or sha(source)!=(r['priorSha256'] if restoring else r['candidateSha256']):raise ValueError('Candidate/live checkpoint changed; do not overwrite concurrent work: '+str(live))
 for r in rows:shutil.copy2(ROOT/(r['priorBackup'] if restoring else r['candidate']),ROOT/r['live'])
 d['currentInstallation']='prior_restored_after_candidate_build' if restoring else 'candidate_installed_actualruntime_pending';receipt.write_text(json.dumps(d,indent=2)+'\n');print(json.dumps({'files':len(rows),'state':d['currentInstallation']}));raise SystemExit
if receipt.exists():raise ValueError('Existing stage immutable; inspect retained receipt')
D.mkdir(parents=True,exist_ok=True);(D/'animations').mkdir(exist_ok=True);(D/'pose-batches').mkdir(exist_ok=True);(D/'originals').mkdir(exist_ok=True)
row=next(r for r in json.loads((B/'tiled-generation-ledger.json').read_text()) if r['pose_key']==KEY and r['attempt']==1);assert row['state']=='accepted';review=B/row['review_file'];assert sha(review)==row['review_sha256'];tile=next(r for r in json.loads((B/'tiled-pilot-preparation.json').read_text())['records'] if r['key']==KEY);atlas=B/row['outputs']['cutout']['file'];assert sha(atlas)==row['outputs']['cutout']['sha256'];source=E/'sources/full-body-native-review/floor-retarget/preparation.json';sourceData=json.loads(source.read_text());assert sha(source)==tile['parent_preparation_sha256'];image=Image.open(atlas).convert('RGBA');framePath=A/'frames.json';frameBytes=framePath.read_bytes();frames=json.loads(frameBytes);candidateFrames=copy.deepcopy(frames);leaf=ROOT/'src/characters/pikachuStateHurtboxes.ts';leafText=leaf.read_text();prefix='export const PIKACHU_STATE_AUTHORED_HURTBOX_POSES = ';start=leafText.index(prefix)+len(prefix);end=leafText.index(' as const;',start);poses=json.loads(leafText[start:end]);install=[];changes=[];galleries={};sheetData={}
def stagefile(live,candidate):
 backup=D/'originals'/(sha(live)+'-'+live.name)
 if not backup.exists():shutil.copy2(live,backup)
 install.append({'live':str(live.relative_to(ROOT)),'priorSha256':sha(live),'priorBackup':str(backup.relative_to(ROOT)),'candidate':str(candidate.relative_to(ROOT)),'candidateSha256':sha(candidate)})
for cell in tile['cells']:
 r=next(r for r in sourceData['records'] if r['key']==cell['sourceKey']);case=r['retargetCase'];sheet='bthrow' if r['action']=='back-throw' else 'tumble';clip=frames['animations'][sheet];index=clip['nativeSampleIndices'].index(cell['nativeSample']);sourcePNG=A/clip['strip'];assert sha(sourcePNG)==clip['sha256'];metaPath=A/'pose-batches'/('full-'+sheet+'-tiled.json')
 if sheet not in sheetData:sheetData[sheet]={'original':Image.open(sourcePNG).convert('RGBA'),'image':Image.open(sourcePNG).convert('RGBA'),'metadata':json.loads(metaPath.read_text()),'metaPath':metaPath,'sourcePNG':sourcePNG}
 width,height=clip['frameWidth'],clip['frameHeight'];x,y=cell['offset'];cw,ch=tile['coordinate_contract']['cell_canvas'];body=image.crop((x,y,x+cw,y+ch)).resize((512,round(ch*512/cw)),Image.Resampling.LANCZOS)
 if body.height!=height:
  if body.width!=width or body.height<height or body.getbbox()[3]>height:raise ValueError('Only empty lower canvas can be discarded; preserve fixed root/scale')
  body=body.crop((0,0,width,height))
 col,rowIndex=clip['sourceCells'][index];pos=(col*width,rowIndex*height);old=sheetData[sheet]['original'].crop((*pos,pos[0]+width,pos[1]+height));sheetData[sheet]['image'].paste(body,pos)
 target=next(p for p in poses if p['sheet']==sheet and p['nativeSample']==cell['nativeSample']);caps=case['hurtboxCandidates'];unchanged=[]
 for j,h in enumerate(target['hurtboxes']):
  c=caps[j];oldCaps=h['capsule'];newCaps={'start':{'x':c['start'][0],'y':c['start'][1]},'end':{'x':c['end'][0],'y':c['end'][1]},'radius':c['radiusCandidate']}
  if j not in [10,11]:
   diff=max(abs(oldCaps[k][v]-newCaps[k][v]) for k in ['start','end'] for v in ['x','y']);assert diff<1e-7;unchanged.append(j);continue
  assert abs(oldCaps['radius']-newCaps['radius'])<1e-5
  radius=oldCaps['radius'];a,b=newCaps['start'],newCaps['end'];h.update(offsetX=(a['x']+b['x'])/2,offsetY=(a['y']+b['y'])/2,width=abs(a['x']-b['x'])+2*radius,height=abs(a['y']-b['y'])+2*radius,capsule={**newCaps,'radius':radius})
 src=sheetData[sheet]['metadata']['sources'][index];src['authoredGeometryAdaptation']={'sourcePreparation':str(source.relative_to(ROOT)),'sourcePreparationSha256':sha(source),'sourceKey':r['key'],'targetReference':r['source_path'],'targetReferenceSha256':r['source_sha256'],'tailAngleDegrees':case['authoredTailAngleDegrees'],'earR1AngleDegrees':case['authoredEarR1AngleDegrees'],'tailWorldDelta':case['deltaWorldMatrix'],'earWorldDelta':case['earDeltaWorldMatrix'],'capsuleConvention':'Only original12region tail1/tail3 receiving matrices adapt;10otherregions and radii unchanged. Distal ear/tail remain outside source12coverage.'};src.update(atlas=str(atlas.relative_to(ROOT)),atlasSha256=sha(atlas),atlasCell=cell['index'],cellOffset=cell['offset'],uniformScale=512/cw,review=str(review.relative_to(ROOT)),reviewSha256=sha(review))
 bounds=body.getchannel('A').point(lambda a:255 if a>=32 else 0).getbbox();change={'sheet':sheet,'nativeSample':cell['nativeSample'],'artFrameIndex':index,'unchangedCapsuleIndices':unchanged,'changedCapsuleIndices':[10,11],'frameWindow':{'startElapsed':target['startElapsed'],'endElapsed':target['endElapsed']},'adaptation':src['authoredGeometryAdaptation'],'alpha32Bounds':bounds,'alpha32BelowFootRootWorldPx':(bounds[3]-1-clip['root'][1])*clip['scaleToWorld'],'hurtboxes':copy.deepcopy(target['hurtboxes'])};changes.append(change)
 gallery=Image.new('RGBA',(width*4,height+40),'#17253a')
 for side,(im,bgcolor,label) in enumerate([(old,'#f7f5ef','previous'),(body,'#f7f5ef','candidate+12caps'),(old,'#17253a','previous'),(body,'#17253a','candidate+12caps')]):
  panel=Image.new('RGBA',im.size,bgcolor);panel.alpha_composite(im);draw=ImageDraw.Draw(panel);draw.line((0,416,width,416),fill='#ff5968',width=1)
  if im is body:
   for h in target['hurtboxes']:
    c=h['capsule'];pts=[(256+p['x']/clip['scaleToWorld'],416+(p['y']-25)/clip['scaleToWorld']) for p in [c['start'],c['end']]];radius=c['radius']/clip['scaleToWorld'];draw.line(pts,fill='#ada6ff',width=1)
    for px,py in pts:draw.ellipse((px-radius,py-radius,px+radius,py+radius),outline='#ada6ff',width=1)
  gallery.alpha_composite(panel,(side*width,40));ImageDraw.Draw(gallery).text((side*width+8,8),f'{sheet} source{cell["nativeSample"]} {label}',fill='white')
 path=D/(sheet+'-'+str(cell['nativeSample'])+'-saved-body-caps-review.png');gallery.save(path);galleries[str(path.relative_to(ROOT))]=sha(path)
for sheet,data in sheetData.items():
 clip=frames['animations'][sheet];targetPNG=D/'animations'/(sheet+'.png');data['image'].save(targetPNG);saved=Image.open(targetPNG).convert('RGBA');assert saved.tobytes()==data['image'].tobytes();changed={r['artFrameIndex'] for r in changes if r['sheet']==sheet}
 for i,(col,rowIndex) in enumerate(clip['sourceCells']):
  if i in changed:continue
  box=(col*clip['frameWidth'],rowIndex*clip['frameHeight'],(col+1)*clip['frameWidth'],(rowIndex+1)*clip['frameHeight']);assert saved.crop(box).tobytes()==data['original'].crop(box).tobytes()
 meta=data['metadata'];meta['animations'][sheet]['sha256']=sha(targetPNG);meta['state']='staged_corrected_body_receiving_actualreview_and_runtime_pending';meta['authoredGeometryAdaptationScope']='Four essential source-guided local tail/ear corrections; actor/root/artscale/source timings and attack numeric fields unchanged. Original asset metadata retained bySHA.';targetMeta=D/'pose-batches'/data['metaPath'].name;targetMeta.write_text(json.dumps(meta,indent=2)+'\n');candidateFrames['animations'][sheet]['sha256']=sha(targetPNG);candidateFrames['animations'][sheet]['packingMetadataSha256']=sha(targetMeta);stagefile(data['sourcePNG'],targetPNG);stagefile(data['metaPath'],targetMeta)
candidateFramePath=D/'frames.json';candidateFramePath.write_text(json.dumps(candidateFrames,indent=2)+'\n');stagefile(framePath,candidateFramePath);candidateLeaf=D/'pikachuStateHurtboxes.ts';candidateLeaf.write_text(leafText[:start]+json.dumps(poses,separators=(',',':'))+leafText[end:]);stagefile(leaf,candidateLeaf)
receipt.write_text(json.dumps({'state':'staged_candidate_saved_body12caps_actualreview_required','profile':str((B/'floor-retarget-generation-tool-profile.json').relative_to(ROOT)),'profileSha256':sha(B/'floor-retarget-generation-tool-profile.json'),'outputReview':str(review.relative_to(ROOT)),'outputReviewSha256':sha(review),'sourcePreparation':str(source.relative_to(ROOT)),'sourcePreparationSha256':sha(source),'changes':changes,'galleries':galleries,'installFiles':install,'artCountsUnchanged':{'sheets':len(frames['animations']),'cells':sum(c['frameCount'] for c in frames['animations'].values())},'receivingWindowsUnchanged':len(poses),'runtimeReview':None,'limits':['No live file modified; guarded candidate install/build/restore required for actual production qualification','Original9 unaffected bthrow/tumble cells byte-identical,4 targetcells only; no root/scale/physics/clock changes','Source 12caps remain conservative2D regions;10corecaps and all radii preserved, onlytail1/tail3geometry moves']},indent=2)+'\n');print(json.dumps({'receipt':str(receipt.relative_to(ROOT)),'changes':[{k:r[k] for k in ['sheet','nativeSample','alpha32BelowFootRootWorldPx']} for r in changes],'liveMutation':False,'receivingWindows':len(poses)}))
