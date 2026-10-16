"""Every changed actual C gear drawing, paired at unchanged SOURCE ROOT."""
from pathlib import Path
import sys,json,hashlib,math,time
sys.path.insert(0,'tools')
from PIL import Image,ImageDraw
from link_immutable_input_stage_v1 import atomic_json
A=Path('docs/review/2026-10-12/link-character/rework/art');S=A/'remaining-c17-selected-equipment-bank-v2';D=A/'remaining-c17-current-gear-review-v2';D.mkdir(exist_ok=True)
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
index=json.load(open(S/'index.json'));groups={}
for ref in index['rows']:
    if ref['changed']:groups.setdefault(ref['resource'],[]).append(ref)
resources=[]
for resource,refs in sorted(groups.items()):
    refs.sort(key=lambda r:r['nativeSample']);R=D/resource;R.mkdir(exist_ok=True);tiles=[];proof=[]
    for ref in refs:
        assert sha(ref['journal'])==ref['sha256'];r=json.load(open(ref['journal']));assert sha(r['cell'])==r['cellSha256'] and sha(r['previousCell'])==r['previousCellSha256']
        selected=Image.open(r['cell']).convert('RGBA');old=Image.open(r['previousCell']).convert('RGBA');crop=r['actualPackingCrop'];prior=r['originalGeometry']['crop'];offset=[prior[0]-crop[0],prior[1]-crop[1]];assert min(offset)>=0
        w=max(selected.width,old.width+offset[0])+20;h=max(selected.height,old.height+offset[1])+46
        tile=Image.new('RGBA',(w*2,h),'#182738');tile.alpha_composite(old,(10+offset[0],40+offset[1]));tile.alpha_composite(selected,(w+10,40));d=ImageDraw.Draw(tile);ctx=r['equipmentContext']
        d.text((6,5),f'{resource} raw{r["nativeSample"]}: old unaccepted gear | selected Swordnormal/Shield{ctx["shield"]}',fill='white')
        d.text((6,21),f'heldItemVisible={ctx["heldItemVisible"]}; actual entity NONE; physical14/face/anchors/Head/ROOT unchanged',fill='#e6cedf')
        tiles.append(tile);proof.append({**ref,'equipmentContext':ctx,'gearOwner':r['gearOwner'],'sourceSampleInterval':r['sourceSampleInterval'],'registeredRootPixel':r['registeredRootPixel'],'oldToNewIntegerOffset':offset,'sourcePhysicalJournal':r['sourcePhysicalJournal'],'sourcePhysicalJournalSha256':r['sourcePhysicalJournalSha256'],'physicalInputEqualityReceipt':r['physicalReuseQualification'],'receivingAndHeadContactExactlyRetained':True})
    panels=[]
    for start in range(0,len(tiles),12):
        cc=tiles[start:start+12];cw=max(c.width for c in cc);ch=max(c.height for c in cc);panel=Image.new('RGBA',(cw*3,ch*math.ceil(len(cc)/3)),'#182738')
        for i,tile in enumerate(cc):panel.alpha_composite(tile,((i%3)*cw,(i//3)*ch))
        path=R/(resource+'-selected-gear-'+str(start//12+1)+'.png');panel.save(path);panels.append({'path':str(path),'sha256':sha(path),'dimensions':list(panel.size),'drawingCount':len(cc),'rows':proof[start:start+12]})
    p=R/'index.json';atomic_json(p,{'resource':resource,'drawingCount':len(refs),'panels':panels,'gameChecksRun':False});resources.append({'resource':resource,'drawingCount':len(refs),'index':str(p),'indexSha256':sha(p),'panels':panels});print(resource,len(refs),len(panels),flush=True)
assert sum(g['drawingCount']for g in resources)==514
atomic_json(D/'index.json',{'state':'ALL514_ACTUAL_CURRENT_SOURCE_SELECTED_GEAR_DRAWINGS_REVIEW_PENDING','resources':resources,'drawingCount':514,'panelCount':sum(len(g['panels'])for g in resources),'qualifiedExactOriginalPixelReuses':583,'newLogicalCCount':1097,'sourceIndex':str(S/'index.json'),'sourceIndexSha256':sha(S/'index.json'),'gameChecksRun':False})
