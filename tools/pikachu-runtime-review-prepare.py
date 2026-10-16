"""Arrange lossless runtime captures for manual review; never accept output."""
from pathlib import Path
import argparse, hashlib, json
from PIL import Image, ImageDraw

ROOT=Path(__file__).resolve().parent.parent
E=ROOT/'docs/review/2026-10-06/pikachu-character'
parser=argparse.ArgumentParser()
parser.add_argument('action',choices=['smash','smash-packed','dash-attack-packed','neutral-air-packed','back-air','back-air-packed','down-air-packed','vertical-tilt-packed','jab','jab-packed'])
args=parser.parse_args()
folder='smashes/packed-browser' if args.action=='smash-packed' else 'smashes/browser' if args.action=='smash' else 'dash-attack/packed-browser' if args.action=='dash-attack-packed' else 'neutral-air/packed-browser' if args.action=='neutral-air-packed' else 'jab/packed-browser' if args.action=='jab-packed' else 'back-air/packed-browser' if args.action=='back-air-packed' else 'down-air/packed-browser' if args.action=='down-air-packed' else 'vertical-tilts/packed-browser' if args.action=='vertical-tilt-packed' else f'{args.action}/browser'
out=E/folder
build=json.loads((E/f'{args.action}-preview-build.json').read_text())
report=json.loads((out/'acceptance.json').read_text())
if report['status']!='passed':raise ValueError('Browser checks must pass before actual capture review')
schedule=build['poseSchedule']
rows=[{**row,'action':action} for action,group in schedule.items() for row in group] if isinstance(schedule,dict) else schedule+build.get('landingPoseSchedule',[])
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
record={'state':'manual_visual_review_required','acceptanceSha256':sha(out/'acceptance.json'),'screenshots':{},'galleries':{}}
for start in range(0,len(rows),4):
    group=rows[start:start+4];gallery=Image.new('RGB',(1100,300*len(group)),'#17253a');draw=ImageDraw.Draw(gallery)
    for i,row in enumerate(group):
        draw.text((8,i*300+8),f'{row["pose"]}: actual runtime Canvas / source {row["sourceIndex"]}',fill='white')
        for side,facing in enumerate(['right','left']):
            prefix=f'{row["action"]}-' if args.action in ['vertical-tilt-packed','smash','smash-packed'] else ''
            name=f'{prefix}{row["pose"]}-{facing}.png';p=out/name
            im=Image.open(p).convert('RGB')
            expected_size=(1100,620) if args.action in ['vertical-tilt-packed','smash','smash-packed'] else (1100,520)
            if im.size!=expected_size:raise ValueError('Unexpected runtime capture dimensions '+name)
            record['screenshots'][name]=sha(p)
            gallery.paste(im.resize((550,260),Image.Resampling.LANCZOS),(side*550,i*300+30))
    p=out/f'actual-runtime-review-{start//4+1}.png';gallery.save(p);record['galleries'][p.name]=sha(p)
(out/'visual-review-preparation.json').write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps({'action':args.action,'screenshots':len(record['screenshots']),'galleries':len(record['galleries']),'manualReview':'pending'}))
