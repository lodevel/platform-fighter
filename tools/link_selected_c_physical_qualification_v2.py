"""Exact selected-visibility physical pilot projection, independent part depth."""
from pathlib import Path
import json,types,hashlib
A=Path('docs/review/2026-10-12/link-character/rework/art')
D=A/'remaining-normal17-exclusive-equipment-context-v1'
_modules={}
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
def project(record,destination):
    m=json.load(open(record));ctx=m['equipmentOverride']['equipmentContext'];shield=ctx['shield']
    visibility={'link_ken':True,'link_kenb':False,'link_tate':shield=='normal','link_tateb':shield=='back'}
    assert ctx['sword']=='normal' and shield in ['normal','back'] and ctx['bow']=='hidden'
    if shield not in _modules:
        original=Path('tools/link-authored-guide.py');code=original.read_text()
        marker=" mesh=ssbh.mesh_data.read_mesh(str(BODY/'model.numshb'));pending=[];semanticPending=[];rendered=[];hidden=[]"
        assert marker in code;code=code.replace(marker,' visibility.update('+repr(visibility)+')\n'+marker)
        private=D/('frozen-selected-'+shield+'-physical-guide.py');private.write_text(code)
        projection=Path('tools/link_physical_body_region_projection_v6.py').read_text()
        projection=projection.replace("GUIDE=Path('tools/link-authored-guide.py')",'GUIDE=Path('+repr(str(private))+')')
        mod=types.ModuleType('privateSelectedPhysical'+shield);mod.__file__=__file__;exec(compile(projection,'tools/link_physical_body_region_projection_v6.py','exec'),mod.__dict__);_modules[shield]=mod
    result=_modules[shield].project(record,destination)
    assert _modules[shield]._MODULE.PPU==m['artPixelsPerNativeUnit']
    result['selectedEquipmentContext']=ctx;result['selectorQualificationOperator']=__file__;result['selectorQualificationOperatorSha256']=sha(__file__)
    Path(str(destination)+'-physical-region-provenance.json').write_text(json.dumps(result,indent=2)+'\n')
    return result
