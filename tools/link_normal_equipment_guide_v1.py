"""Explicit selected normal inventory gear, with frozen source geometry/camera.

Raw native visibility remains separately recorded; common dynamic-part
precedence is unrecovered. This target adapter follows the actual exclusive
normal equipment state and does not alter native tracks or posed anatomy.
"""
from pathlib import Path
import types,json,hashlib,os
from link_author_raster_v2 import install_on_guide
A=Path('docs/review/2026-10-12/link-character/rework/art');GUIDE=Path('tools/link-authored-guide.py');_MOD=None
EQUIPMENT={'sword':'normal','shield':'normal','bow':'hidden','heldItemVisible':False,'ancientBowVisible':False}
VISIBILITY={'link_ken':True,'link_kenb':False,'link_tate':True,'link_tateb':False}
def render(sourceRecord,destination):
 global _MOD
 m=json.load(open(sourceRecord));code=GUIDE.read_text();at=" mesh=ssbh.mesh_data.read_mesh(str(BODY/'model.numshb'));pending=[];semanticPending=[];rendered=[];hidden=[]";assert at in code;code=code.replace(at," nativeVisibilityBeforeEquipmentOverride=dict(visibility);visibility.update(SELECTED_GEAR_VISIBILITY)\n"+at)
 old=" lo=np.min(np.array([r['boundsNative'][0]for r in rendered]),axis=0);hi=np.max(np.array([r['boundsNative'][1]for r in rendered]),axis=0);ART_ROOT=(max(512,int(math.ceil(-lo[2]*PPU+48))),max(850,int(math.ceil(hi[1]*PPU+48))));SIZE=(int(math.ceil(max(1024,ART_ROOT[0]+hi[2]*PPU+48)/64)*64),int(math.ceil(max(1024,ART_ROOT[1]-lo[1]*PPU+48)/64)*64));raster.ART_ROOT=ART_ROOT"
 assert old in code;code=code.replace(old," ART_ROOT=FROZEN_ART_ROOT;SIZE=FROZEN_ART_CANVAS;raster.ART_ROOT=ART_ROOT")
 if _MOD is None:
  _MOD=types.ModuleType('privateActualNormalGear');_MOD.__file__=str(GUIDE);exec(compile(code,str(GUIDE),'exec'),_MOD.__dict__);install_on_guide(_MOD)
 _MOD.SELECTED_GEAR_VISIBILITY=VISIBILITY;_MOD.FROZEN_ART_ROOT=tuple(m['artRoot']);_MOD.FROZEN_ART_CANVAS=tuple(m['artCanvas']);_MOD.PPU=m['artPixelsPerNativeUnit'];os.environ['LINK_AUTHOR_UV_MAP']='1';_MOD.render(Path(m['motion']['path']).stem,m['nativeFrameIndex'],destination,A/'uv-atlas-pilot/fresh-target-atlas-v4')
 p=Path(str(destination)+'.json');new=json.load(open(p));new['equipmentOverride']={'equipmentContext':EQUIPMENT,'visiblePrefixes':VISIBILITY,'policy':'AUTHORED_SELECTED_INVENTORY_DYNAMIC_PART_PRECEDENCE; actual unheld FreshLink state normalSword/normalShield exclusive. Raw mesh track bothtrue preserved as source fact, not engine precedence proof. Bow external history independent.','operator':__file__,'operatorSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'frozenOriginalSourceRecord':str(sourceRecord),'frozenOriginalSourceRecordSha256':hashlib.sha256(Path(sourceRecord).read_bytes()).hexdigest(),'privateGuideCodeSha256':hashlib.sha256(code.encode()).hexdigest()};new['nativeVisibilityBeforeEquipmentOverride']=m['visiblePrefixes'];p.write_text(json.dumps(new,indent=2)+'\n');return new
