"""Named source-only atlas/root audit and candidate edit masks. No live mutation."""
from pathlib import Path
import json,hashlib
import numpy as np
from PIL import Image,ImageDraw,ImageFilter
ROOT=Path(__file__).resolve().parent.parent;B=ROOT/'docs/review/2026-10-06/pikachu-character/art/completion-states-source-floor-audit';B.mkdir(exist_ok=True)
if (B/'SOURCE-ONLY-floor-audit.json').exists():raise ValueError('Retained audit immutable; choose a new named evidence directory')
F=ROOT/'assets/characters/pikachu/frames.json';frames=json.loads(F.read_text());sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();rows=[]
for sheet in ['shield_break','shield_break_end','grab_pull','grab_escape','captured_release']:
 c=frames['animations'][sheet];source=ROOT/'assets/characters/pikachu'/c['strip'];assert sha(source)==c['sha256'];atlas=Image.open(source).convert('RGBA');w,h=c['frameWidth'],c['frameHeight'];gallery=Image.new('RGBA',(512*len(c['sourceCells']),640),'#e4e3df')
 for i,(col,row) in enumerate(c['sourceCells']):
  cell=atlas.crop((col*w,row*h,(col+1)*w,(row+1)*h));alpha=cell.getchannel('A');anyBounds=alpha.getbbox();visible=alpha.point(lambda a:255 if a>=32 else 0).getbbox();assert visible
  intrusion=(visible[3]-.5-c['root'][1])*c['scaleToWorld']+.05
  # Candidate local edit region only: source alpha near the underside. Runtime
  # may invalidate an assumed ground floor; masks never establish acceptance.
  mask=np.asarray(alpha)>0;mask[:403]=False;mask=Image.fromarray(mask.astype('uint8')*255).filter(ImageFilter.MaxFilter(7));maskPath=B/f'SOURCE-ONLY-{sheet}-{i}-candidate-local-mask.png';mask.save(maskPath);cellPath=B/f'SOURCE-ONLY-{sheet}-{i}-original-cell.png';cell.save(cellPath)
  panel=Image.new('RGBA',(512,640),'#e4e3df');panel.alpha_composite(cell);ImageDraw.Draw(panel).line((0,c['root'][1],512,c['root'][1]),fill='red');ImageDraw.Draw(panel).text((8,15),f'SOURCE ONLY {sheet}/{i} native{c["nativeSampleIndices"][i]}',fill='black');gallery.alpha_composite(panel,(i*512,0))
  windows=[win for win in c.get('frameWindows',[]) if win['artFrameIndex']==i];rows.append({'sheet':sheet,'artFrameIndex':i,'nativeSample':c['nativeSampleIndices'][i],'strip':str(source.relative_to(ROOT)),'stripSha256':sha(source),'originalCanvas':[w,h],'root':c['root'],'scaleToWorld':c['scaleToWorld'],'anyAlphaBounds':anyBounds,'alpha32Bounds':visible,'nominalStandingPixelCenterIntrusionWorldPx':intrusion,'nominalStandingReferenceOnly':True,'observedRuntime':False,'authoredWindows':windows,'sourceEndpointUnused':None,'runtimeBindingUnknown':not windows,'cell':cellPath.name,'cellSha256':sha(cellPath),'mask':maskPath.name,'maskSha256':sha(maskPath),'candidateMaskMeaning':'Source local underside only; not accepted new geometry, not a native collision/clock claim.'})
 gallery.save(B/f'SOURCE-ONLY-{sheet}-contact-sheet.png')
(B/'SOURCE-ONLY-floor-audit.json').write_text(json.dumps({'state':'source-only actual image review pending; no generation','framesSha256':sha(F),'scope':'Named source drawing alpha32 pixel centres and raw alpha with prospective masks. Nominal support at physical root+Matter .05 is diagnostic, not observed runtime. Unused endpoints remain explicit.','rows':rows},indent=2)+'\n');print(json.dumps({'sourceCells':len(rows),'nominalFloorViolations':sum(r['nominalStandingPixelCenterIntrusionWorldPx']>.55 for r in rows)}))
