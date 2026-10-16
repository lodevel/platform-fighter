#!/usr/bin/env python3
"""Source projected attacks versus three clean4 quarter targets, no runtime edit."""
from pathlib import Path
import hashlib,json
import importlib.util
from PIL import Image,ImageDraw,ImageOps
ROOT=Path(__file__).resolve().parents[1];ART=ROOT/'docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/art'
spec=importlib.util.spec_from_file_location('packed',ROOT/'tools/dk-art-packed-collision-review.py');packed=importlib.util.module_from_spec(spec);spec.loader.exec_module(packed)
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def main():
    records=[]
    rows=json.loads((ART/'dk-firstclips-batch06-clean4-review.json').read_text())['records']
    for row in rows:
        n=row['nativeSample'];clip=row['clip'];key=row['prefix']
        receiving=ART/f'{clip}-native{n}-clean4-quarter-receiving-candidate.json'
        
        rp=json.loads(receiving.read_text()) if receiving.exists() else None;target=ART/row['packedImage'];attack=ART/(key+'-attack-source.json');ap=json.loads(attack.read_text())
        if sha(target)!=row['packedImageSha256']:raise ValueError('Actual target changed')
        if rp and sha(target)!=rp['targetImageSha256']:raise ValueError('Receiving target changed')
        image=Image.open(target).convert('RGBA');canvas=Image.new('RGBA',image.size,(25,30,39,255));canvas.alpha_composite(image);draw=ImageDraw.Draw(canvas)
        for box in (rp['hurtboxPoses'][0]['hurtboxes'] if rp else []):packed.outline(draw,box['capsule'],'#6affee')
        for hit in ap['collisionHits']:
            packed.outline(draw,hit['capsule'],'#ff536f');c=hit['capsule']['start'];px=128+c['x']/(5/6.5);py=208+(c['y']-42)/(5/6.5);draw.text((px,py),str(hit['id']),fill='#fff095',stroke_width=1,stroke_fill='black')
        draw.line((0,208,image.width,208),fill='#f6f6f6');side=Image.new('RGBA',(image.width*2,image.height),(25,30,39,255));side.paste(canvas,(0,0));side.paste(ImageOps.mirror(canvas),(image.width,0));out=ART/f'{clip}-native{n}-clean4-quarter-attack-receiving-bothfaces.png';side.convert('RGB').save(out)
        record={'nativeSample':n,'clip':clip,'gameplayAge':row['gameplayAge'],'target':str(target.relative_to(ROOT)),'targetSha256':sha(target),'receiving':receiving.name if rp else None,'receivingSha256':sha(receiving) if rp else None,'attackSource':attack.name,'attackSourceSha256':sha(attack),'active':ap['active'],'sourceIds':[h['id']for h in ap['collisionHits']],'root':[128,208],'scaleToWorld':5/6.5,'bodyCentreFromRootY':-42,'worldGeometryChanged':False,'numericMoveScalarsChanged':False,'overlay':out.name,'overlaySha256':sha(out),'actualOverlayViewed':False,'staticContactAlignmentAccepted':False,'actualContactVerified':False};records.append(record)
    report={'state':'three_new_quarter_cell_source_attack_alignment_actual_overlay_review_pending','sourceProjection':'Cached native bone matrix projections, source native radii*5; target anatomy receiving separately authored. Body local floor warp affects support band only; all active sphere centres lie above that band.','claims':['Attack spheres can extend beyond body silhouette as sourced attack reach.','No exact native3D collision or wholeclip/live qualification.'],'records':records,'shippingChanged':False};(ART/'firstclips-batch06-quarter-attack-review.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(records,indent=2))
if __name__=='__main__':main()
