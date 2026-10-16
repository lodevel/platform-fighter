"""Known target-rig Head projection before non-head occluders; authored, not native capsules."""
from pathlib import Path
import sys,types,json,hashlib
sys.path[:0]=['/tmp/pikachu-source-libs','tools']
ROOT=Path('/mnt/c/workspace/platform-fighter');GUIDE=ROOT/'tools/link-authored-guide.py'
def project(source_metadata,destination):
 m=json.load(open(source_metadata));original=GUIDE.read_text();code=original
 # Preserve actual whole-body camera/canvas; triangle filtering does not recenter.
 code=code.replace("  mat=materialMap[(obj.name,obj.subindex)];texture=materials[mat].get('Texture0')","  mat=materialMap[(obj.name,obj.subindex)];texture=materials[mat].get('Texture0')\n  if mat not in ['skin_link_001','EyeL','EyeR']:continue")
 code=code.replace("  pending.append((posed[:,:3],obj.vertex_indices,obj.texture_coordinates[0].data", "  allTriangles=np.asarray(obj.vertex_indices).reshape(-1,3);selectedTriangles=allTriangles[np.sum(dominant[allTriangles]=='Head',axis=1)>=2]\n  if len(selectedTriangles)==0:continue\n  pending.append((posed[:,:3],selectedTriangles.reshape(-1),obj.texture_coordinates[0].data")
 code=code.replace("triangles=np.asarray(obj.vertex_indices).reshape(-1,3);roles", "triangles=selectedTriangles;roles")
 old=" lo=np.min(np.array([r['boundsNative'][0]for r in rendered]),axis=0);hi=np.max(np.array([r['boundsNative'][1]for r in rendered]),axis=0);ART_ROOT=(max(512,int(math.ceil(-lo[2]*PPU+48))),max(850,int(math.ceil(hi[1]*PPU+48))));SIZE=(int(math.ceil(max(1024,ART_ROOT[0]+hi[2]*PPU+48)/64)*64),int(math.ceil(max(1024,ART_ROOT[1]-lo[1]*PPU+48)/64)*64));raster.ART_ROOT=ART_ROOT"
 assert old in code;code=code.replace(old," ART_ROOT=FROZEN_ART_ROOT;SIZE=FROZEN_ART_CANVAS;raster.ART_ROOT=ART_ROOT")
 # No Head or facial visibility is overridden; isolate actual selected mesh data.
 # Rendering order now contains only Head-weight-owned triangles.
 mod=types.ModuleType('headProjectionPrivate');mod.__file__=str(GUIDE);exec(compile(code,str(GUIDE),'exec'),mod.__dict__);mod.FROZEN_ART_ROOT=tuple(m['artRoot']);mod.FROZEN_ART_CANVAS=tuple(m['artCanvas']);mod.render(Path(m['motion']['path']).stem,m['nativeFrameIndex'],destination,ROOT/'docs/review/2026-10-12/link-character/rework/art/uv-atlas-pilot/fresh-target-atlas-v4')
 p=Path(str(destination)+'.json');d=json.load(open(p));d['anatomicalHeadProjection']={'policy':'Actual skin/eye material mesh triangles (hair/clothing/brow cards excluded) with at least2of3 vertices dominated by real Head bone, rendered with actual target atlas before non-head Shield/arm/gear/cap occluders. Source head geometry and exact frozen raw camera/root retained; self-depth remains. No cosmetic Hair-only/cap/feather volume or alpha-bbox anchor.','targetWholeBodySourceRecord':str(source_metadata),'targetWholeBodySourceRecordSha256':hashlib.sha256(Path(source_metadata).read_bytes()).hexdigest(),'bodyAuthoringGuideSha256':hashlib.sha256(GUIDE.read_bytes()).hexdigest(),'privateTriangleFilterSnapshotSha256':hashlib.sha256(code.encode()).hexdigest(),'limitations':'Existing exact body authoring helper-preview/UV/shader laws retained, not native game renderer or hurtbox/radius fidelity.'};p.write_text(json.dumps(d,indent=2)+'\n');return d
