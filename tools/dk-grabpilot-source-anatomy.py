"""One explicitly released, source-only anatomy evaluation; no fitter or raster."""
from pathlib import Path
import argparse,json,hashlib,importlib.util

ROOT=Path(__file__).resolve().parents[1]
ART=ROOT/'docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/art'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--clip',required=True,choices=['grab','dash_grab','pivot_grab','grab_pull','grab_hold']);parser.add_argument('--source-evaluation-slot-released',action='store_true');args=parser.parse_args()
    if not args.source_evaluation_slot_released:raise ValueError('Root must release source evaluation slot before execution')
    plan=ART/'grab-first-five-receiving-catch-grip-fit-plan-01.json'
    if sha(plan)!='f071f94ae2d294f879a92af47b8e8ca2a76085e4951ca8802341da9a6ef7fb20':raise ValueError('Unreviewed plan bytes')
    row=next(r for r in json.loads(plan.read_text())['targets'] if r['clip']==args.clip)
    for key in ['target','quarterTarget','sourceSocketPacket','sourceGuide']:
        if sha(ROOT/row[key]['path'])!=row[key]['sha256']:raise ValueError(f'Unreviewed {key} bytes')
    dest=ART/f'grabpilot-{args.clip}-native{row["nativeSample"]}-anatomy-source.json'
    if dest.exists():raise ValueError('Preserve prior source packet')
    guide=json.loads((ROOT/row['sourceGuide']['path']).read_text());motion=ROOT/guide['motion']['path']
    if sha(motion)!=guide['motion']['sha256']:raise ValueError('Native motion bytes changed')
    spec=importlib.util.spec_from_file_location('dk_anatomy_source',Path(__file__).with_name('dk-anatomical-capsules.py'));module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    native=module.native_region_points(motion.stem,row['nativeSample'],exclude_cosmetic_tie=True)
    packet={'state':'source_visible_skin_ownership_priors_only','clip':args.clip,'nativeSample':row['nativeSample'],'selectedGameplayAge':row['selectedGameplayAge'],'planSha256':sha(plan),'sourceGuide':row['sourceGuide'],'sourceSocketPacket':row['sourceSocketPacket'],'target':row['target'],'quarterTarget':row['quarterTarget'],'sourceMotion':native['provenance'],'sourceMesh':native['mesh'],'registration':row['registration'],'projectedPointsByRegion':{bone.lower():[[p[2]*5,42-p[1]*5] for p in points] for bone,points in native['pointsByRegion'].items()},'coordinatePolicy':'raw Trans-removed native z*5,42-native y*5 actor-centre space; source floor overhang unchanged; target-support warp not applied yet','floorWarp':None,'visibleMeshes':native['visibleMeshes'],'cosmeticReceivingExclusions':native['cosmeticReceivingExclusions'],'omittedMeshHelperConstraints':native['omittedMeshHelperConstraints'],'limits':['Native helper constraints/shader facial projection approximate.','Source ownership priors, not native hit_data, target receiving, capture socket or native3D parity.','Apply exact accepted source support transform independently before target label competition.'],'reviewedForShipping':False,'actualContactVerified':False,'GPUUsed':False,'rasterUsed':False,'toolSha256':sha(Path(__file__))}
    dest.write_text(json.dumps(packet,separators=(',',':'))+'\n');print(json.dumps({'path':str(dest.relative_to(ROOT)),'sha256':sha(dest),'regionCount':len(packet['projectedPointsByRegion'])}))
if __name__=='__main__':main()
