#!/usr/bin/env python3
"""Review-only final target/source attack overlay. Never writes shipping assets."""
from pathlib import Path
import json, hashlib
from PIL import Image, ImageDraw
ART=Path('docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/art')
SCALE=5/26
COLORS=[(255,205,30,220),(30,220,255,220),(255,95,95,220),(185,140,255,220)]
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def main():
    report={'state':'actual_final_target_attack_overlay_review_pending','scope':'Three exact first-contact source projections only; receiving and actual game sensor checks separate.','records':[]}
    for key in ['jab1-native5','jab2-native4','dtilt-native6']:
        target=ART/f'firstcontact-clean3-{key}-cutout.png'
        original=ART/f'{key}-paired-attack-candidate.json'
        packet=json.loads(original.read_text())
        packet['targetImage']=str(target);packet['targetImageSha256']=sha(target)
        packet['candidateDerivedFrom']=str(original);packet['candidateDerivedFromSha256']=sha(original)
        packet['reviewedForShipping']=False;packet['actualSensorContactVerified']=False
        finalpacket=ART/f'{key}-clean3-paired-attack-candidate.json'
        finalpacket.write_text(json.dumps(packet,indent=2)+'\n')
        art=Image.open(target).convert('RGBA')
        full=Image.new('RGBA',art.size,(28,30,36,255));full.alpha_composite(art)
        draw=ImageDraw.Draw(full)
        draw.line((0,832,1535,832),fill=(130,130,130,255),width=2)
        draw.ellipse((507,827,517,837),fill=(0,255,160,255))
        for i,hit in enumerate(packet['attackCollisionPoses'][0]['collisionHits']):
            cap=hit['capsule'];r=cap['radius']/SCALE
            pts=[(512+cap[k]['x']/SCALE,832+(cap[k]['y']-42)/SCALE) for k in ['start','end']]
            color=COLORS[i%len(COLORS)]
            if pts[0]!=pts[1]: draw.line((*pts[0],*pts[1]),fill=color,width=round(2*r))
            for x,y in pts: draw.ellipse((x-r,y-r,x+r,y+r),outline=color,width=4)
            draw.text((pts[0][0]+6,pts[0][1]+6),f"ID{hit['id']}",fill=color)
        full.save(ART/f'{key}-clean3-attack-overlay.png')
        # At exactly world scale; margins permit broad native contact spheres.
        tile=full.resize((round(1536*SCALE),round(1024*SCALE)),Image.Resampling.LANCZOS)
        comparison=Image.new('RGBA',(760,260),(28,30,36,255))
        comparison.alpha_composite(tile,(32,38)); comparison.alpha_composite(tile.transpose(Image.Transpose.FLIP_LEFT_RIGHT),(420,38))
        dd=ImageDraw.Draw(comparison);dd.text((32,10),f'{key}: source attack IDs; right-facing',fill='white');dd.text((420,10),'same registered drawing mirrored',fill='white')
        comparison.save(ART/f'{key}-clean3-attack-bothface-world.png')
        report['records'].append({'key':key,'finalTarget':str(target),'targetSha256':sha(target),'candidate':str(finalpacket),'candidateSha256':sha(finalpacket),'fullOverlay':f'{key}-clean3-attack-overlay.png','worldOverlay':f'{key}-clean3-attack-bothface-world.png','registration':{'root':[512,832],'scaleToWorld':SCALE,'bodyCentreFromRootY':-42},'notNative3DCollisionParity':True,'actualSensorContactVerified':False})
    (ART/'firstcontact-clean3-attack-overlay-review.json').write_text(json.dumps(report,indent=2)+'\n')
    print('Prepared final-target attack candidate packets and six actual image overlays.')
if __name__=='__main__': main()
