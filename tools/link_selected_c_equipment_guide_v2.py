"""Source-selected C-stage exclusive gear, reusing qualified frozen-camera guide."""
from pathlib import Path
import json,hashlib
import link_normal_equipment_guide_v1 as original
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
def render(source_record,destination,context):
    assert set(context)=={'sword','shield','bow','heldItemVisible','ancientBowVisible'}
    assert context['sword']=='normal' and context['shield'] in ['normal','back']
    assert context['bow']=='hidden' and context['ancientBowVisible'] is False
    original.EQUIPMENT=dict(context)
    original.VISIBILITY={'link_ken':True,'link_kenb':False,'link_tate':context['shield']=='normal','link_tateb':context['shield']=='back'}
    result=original.render(source_record,destination)
    result['equipmentOverride']['policy']='SOURCE_SELECTED_CAPTURED_EXPRESSION_STOCK_UNHELD_CONTEXT; SCRIPT clocks independent of body samples; exclusively one selected Shield, actual external Bow absent. No native common visibility precedence claim.'
    result['equipmentOverride']['qualifiedBaseOperator']='tools/link_normal_equipment_guide_v1.py'
    result['equipmentOverride']['qualifiedBaseOperatorSha256']=sha('tools/link_normal_equipment_guide_v1.py')
    result['equipmentOverride']['selectorOperator']=__file__
    result['equipmentOverride']['selectorOperatorSha256']=sha(__file__)
    Path(str(destination)+'.json').write_text(json.dumps(result,indent=2)+'\n')
    return result
