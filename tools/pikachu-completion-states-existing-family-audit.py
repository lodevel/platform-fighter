"""Verify genuine accepted generated art provenance; preserve unbound-clock gaps."""
from pathlib import Path
import json,hashlib
from PIL import Image,ImageDraw
ROOT=Path(__file__).resolve().parent.parent;B=ROOT/'docs/review/2026-10-06/pikachu-character/art/completion-states-family-audit';B.mkdir(exist_ok=True);F=ROOT/'assets/characters/pikachu/frames.json';frames=json.loads(F.read_text());shaCache={}
def sha(p):
 p=Path(p)
 if p not in shaCache:shaCache[p]=hashlib.sha256(p.read_bytes()).hexdigest()
 return shaCache[p]
ledger=json.loads((ROOT/'docs/review/2026-10-06/pikachu-character/art/tiled-generation-ledger.json').read_text());rows=[]
sheets=['wall_jump','ledge_jump_start','ledge_jump','getup','getup_face_down','getup_roll','getup_roll_back','getup_roll_face_down','getup_roll_back_face_down','tech','tech_forward','tech_back','tech_wall','tech_ceiling','footstool_jump','entry','footstool_fall']
for sheet in sheets:
 c=frames['animations'][sheet];png=ROOT/'assets/characters/pikachu'/c['strip'];m=ROOT/c['packingMetadata'];meta=json.loads(m.read_text());assert sha(png)==c['sha256'] and sha(m)==c['packingMetadataSha256'];sources=[]
 for src in meta['sources']:
  atlas=ROOT/src['atlas'];review=ROOT/src['review'];assert sha(atlas)==src['atlasSha256'] and sha(review)==src['reviewSha256'];accepted=next(r for r in ledger if r.get('state')=='accepted' and r.get('outputs',{}).get('cutout',{}).get('sha256')==src['atlasSha256']);sources.append({'nativeSample':src['nativeSample'],'sourceKey':src['sourceKey'],'sourceReferenceSha256':src['sourceReferenceSha256'],'atlas':src['atlas'],'atlasSha256':src['atlasSha256'],'acceptedJob':accepted['job_key'],'review':src['review'],'reviewSha256':src['reviewSha256']})
 atlas=Image.open(png).convert('RGBA');w,h=c['frameWidth'],c['frameHeight'];gallery=Image.new('RGBA',(512*len(c['sourceCells']),640),'#e4e3df');bounds=[]
 for i,(col,row) in enumerate(c['sourceCells']):
  body=atlas.crop((col*w,row*h,(col+1)*w,(row+1)*h));b=body.getchannel('A').point(lambda a:255 if a>=32 else 0).getbbox();assert b;bounds.append(b);panel=Image.new('RGBA',(512,640),'#e4e3df');panel.alpha_composite(body);ImageDraw.Draw(panel).line((0,c['root'][1],512,c['root'][1]),fill='red');ImageDraw.Draw(panel).text((8,15),f'{sheet}/{i} native{c["nativeSampleIndices"][i]}',fill='black');gallery.alpha_composite(panel,(512*i,0))
 gallery.save(B/(sheet+'-saved-source-art.png'));rows.append({'sheet':sheet,'stripSha256':sha(png),'metadataSha256':sha(m),'metadataState':meta['state'],'generatedArtProvenanceVerified':True,'sources':sources,'frameWindows':c.get('frameWindows',[]),'alpha32Bounds':bounds,'actualCurrentConsumerQualified':False,'actualImagesReviewed':False})
(B/'existing-family-audit.json').write_text(json.dumps({'state':'accepted generated provenance verified; actual images and consumers pending','framesSha256':sha(F),'rows':rows,'limits':'Empty frame windows do not invalidate accepted art provenance or establish runtime qualification. No legacy fallback or shared-sheet alias is accepted by this audit.'},indent=2)+'\n');print(json.dumps({'families':len(rows),'genuineAcceptedSourceCells':sum(len(r['sources']) for r in rows),'missingFrameWindowFamilies':sum(not r['frameWindows'] for r in rows)}))
