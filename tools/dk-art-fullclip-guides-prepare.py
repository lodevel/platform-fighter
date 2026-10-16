#!/usr/bin/env python3
"""Sequential CPU-only preparation of the agreed first three complete clips."""
from pathlib import Path
import hashlib, json, subprocess, sys

ROOT=Path(__file__).resolve().parents[1]
ART=ROOT/'docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/art'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()

def main():
    planpath=ART/'first-three-complete-clips-pose-plan.json'
    plan=json.loads(planpath.read_text());rows=[]
    for clip in plan['clips']:
        for pose in clip['poses']:
            if pose['reuseAcceptedFirstContactSample']:continue
            prefix=f"firstclips-{clip['key']}-native{pose['nativeSample']}"
            destination=ART/prefix;metadata=destination.with_suffix('.json')
            if metadata.exists():
                prior=json.loads(metadata.read_text())
                if prior['native_sample_index']!=pose['nativeSample'] or prior['root']!=[512,832]:
                    raise ValueError('Existing guide registration differs; preserve and review before rerender')
                for filename,digest in prior['output_files'].items():
                    if sha(ART/filename)!=digest:raise ValueError('Existing source image changed')
            else:
                subprocess.run([sys.executable,str(ROOT/'tools/dk-native-guide.py'),Path(clip['motion']).stem,str(pose['nativeSample']),str(destination),
                    '--width','1536','--height','1024','--root-x','512','--root-y','832',
                    '--view-side','negative','--root-registration','remove-trans-translation'],cwd=ROOT,check=True)
            rows.append({'clip':clip['key'],**pose,'prefix':prefix,'metadata':metadata.name,'metadataSha256':sha(metadata),
                'actualGuideInspection':'pending','generation':'not_submitted','receivingAndAttackFit':'pending'})
            receipt={'state':'source_only_CPU_guides_preparing_actual_per_cell_review_pending','planSha256':sha(planpath),
                'sourceRows':rows,'newCellCount':plan['additionalGenerationSamples'],'gpuUsed':False,
                'scope':'No delivered images/metadata or canonical inventory changed. Source anatomy previews cannot ship as generated fighter art.'}
            (ART/'first-three-complete-clips-source-guide-preparation.json').write_text(json.dumps(receipt,indent=2)+'\n')
            print(f"Prepared {len(rows)}/{plan['additionalGenerationSamples']}: {prefix}",flush=True)

if __name__=='__main__':main()
