"""Read-only source motion audit. No runtime, packing or inventory edits."""
import hashlib, json, re
from pathlib import Path
import ssbh_data_py as ssbh
import importlib.metadata
BASE = Path('docs/review/2026-10-06/pikachu-character')
RAW = Path('assets/gen/pikachu-native-reference/raw-motion/fighter/pikachu/motion/body/c00')
YAML = BASE / 'sources/motion-list.yml'
yaml = YAML.read_text()
rows=[]
for sheet,motion,entry in [('crawl','a05squatf','squat_f'),('crawl_back','a05squatb','squat_b'),('crouch_start','a05squat','squat'),('crouch_end','a05squatrv','squat_rv'),('dash_turn','a02turndash','turn_dash'),('run_turn','a02turnrun','turn_run'),('air_dodge_directional','b02escapeair','escape_air_slide')]:
    path=RAW/(motion+'.nuanmb');anim=ssbh.anim_data.read_anim(str(path))
    values=[]
    for group in anim.groups:
        if group.group_type.name!='Transform':continue
        for node in group.nodes:
            if node.name.lower()=='trans':
                for i,v in enumerate(node.tracks[0].values):values.append({'nativeFrame':i,'translation':list(v.translation)})
    match=re.search(r'^  '+entry+r':\n(.*?)(?=^  [a-z0-9_]+:|\Z)',yaml,re.M|re.S)
    block=match.group(1);field=lambda key: re.search(r'^\s+'+key+r': (.+)$',block,re.M).group(1)
    row={'sheet':sheet,'motionEntry':entry,'file':str(path),'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'nativeFinalFrameIndex':anim.final_frame_index,'nativeFlags':{k:field(k) for k in ['loop','move','turn']},'nativeCancelFrame':int(field('cancel_frame')),'sourceTrans':values,'limits':'Native Trans is a local motion measurement, not source common rate/status exit proof. Pinned extracted assets have unknown patch/unmodified provenance as recorded elsewhere.'}
    if sheet.startswith('crawl'):
        row['sourceMotionTransportPerNativeStepWorldPx']=[(values[i]['translation'][2]-values[i-1]['translation'][2])*5 for i in range(1,len(values))]
        row['authoredBetaRecommendation']='Use phase-ordered source Trans delta as Matter horizontal velocity at5px/native unit, mirrored by latched body facing. Wrap phase at native loop endpoint without teleporting world position; motion-enabled flag backs this transport. Native common rate/geometry remain separate.'
    rows.append(row)
report={'scope':'Primary-file parse/matrix observations only, no runtime action qualification. Native sample indices do not assert source state commitment.','parser':{'name':'ssbh_data_py','version':importlib.metadata.version('ssbh_data_py')},'motionListSha256':hashlib.sha256(YAML.read_bytes()).hexdigest(),'rows':rows}
out=BASE/'integration/completion-gap-audit/locomotion-primary-measurements.json';out.write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps([{'sheet':r['sheet'],'motionEnd':r['nativeFinalFrameIndex'],'cancel':r['nativeCancelFrame'],'transport':r.get('sourceMotionTransportPerNativeStepWorldPx',[])[:2]} for r in rows]))
