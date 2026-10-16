#!/usr/bin/env python3
"""Review existing world geometry against source-only quarter-size pilot sprites."""
from pathlib import Path
import json, hashlib
import numpy as np
from PIL import Image, ImageDraw, ImageOps
from scipy.ndimage import distance_transform_edt

ROOT = Path(__file__).resolve().parents[1]
ART = ROOT/'docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/art'
SCALE = 5/6.5
ROOT_PIXEL = (128, 208)

def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()

def capsule_mask(c, x, y):
    ax, ay = c['start']['x'], c['start']['y']
    bx, by = c['end']['x'], c['end']['y']
    vx, vy = bx-ax, by-ay
    length2 = vx*vx + vy*vy
    t = np.clip(((x-ax)*vx+(y-ay)*vy)/length2, 0, 1) if length2 else 0
    return (x-ax-t*vx)**2 + (y-ay-t*vy)**2 <= c['radius']**2

def outline(draw, c, color):
    pts = [(ROOT_PIXEL[0]+c[k]['x']/SCALE, ROOT_PIXEL[1]+(c[k]['y']-42)/SCALE) for k in ['start','end']]
    radius = c['radius']/SCALE
    if pts[0] != pts[1]:
        # Capsule union outline is diagnostic; opaque centre lines mark named segments.
        draw.line(pts, fill=color, width=2)
    for x,y in pts:
        draw.ellipse((x-radius,y-radius,x+radius,y+radius), outline=color, width=1)

def main():
    accepted = json.loads((ART/'firstcontact-clean3-static-receiving-acceptance.json').read_text())
    records=[]
    for r in accepted['records']:
        key=r['key']; imagepath=ART/f'{key}-packed-scale-0.25-candidate.png'
        image=Image.open(imagepath).convert('RGBA')
        packetpath=ART/r['candidate'];packet=json.loads(packetpath.read_text())
        if sha(packetpath)!=r['candidateSha256']:raise ValueError('Reviewed geometry changed')
        source_labels=np.asarray(Image.open(ART/f'{key}-clean3-target-anatomy-labels.png'))
        anatomy_alpha=Image.fromarray((source_labels>0).astype(np.uint8)*255).resize(image.size,Image.Resampling.LANCZOS)
        alpha=np.asarray(image.getchannel('A'))>=32
        anatomical=(np.asarray(anatomy_alpha)>=32)&alpha
        yy,xx=np.indices(alpha.shape); x=(xx+.5-128)*SCALE; y=42+(yy+.5-208)*SCALE
        union=np.zeros(alpha.shape,dtype=bool); tint=np.zeros((*alpha.shape,4),dtype=np.uint8)
        boxes=packet['hurtboxPoses'][0]['hurtboxes']
        for box in boxes:
            mask=capsule_mask(box['capsule'],x,y);union|=mask
            color=(205,85,250,105) if key.startswith('dtilt') and box['region'] in ['shoulderl','arml'] else (35,220,210,90)
            tint[mask]=color
        distance=distance_transform_edt(~anatomical)*SCALE
        outside=union&~anatomical; beyond=union&(distance>1+1e-9)
        # Pixel centres are discrete probes; the visible raster pixels occupy
        # closed unit squares. Measure the four diagonal disagreements against
        # that exact footprint, without changing the 1-world-unit fit margin.
        body_y,body_x=np.nonzero(anatomical)
        footprint_checks=[]
        for py,px in zip(*np.nonzero(beyond)):
            dx=np.maximum(np.abs(body_x-px)-.5,0)*SCALE
            dy=np.maximum(np.abs(body_y-py)-.5,0)*SCALE
            cell_distance=float(np.sqrt(np.min(dx*dx+dy*dy)))
            footprint_checks.append({'packedPixel':[int(px),int(py)],
                'distanceToClosestAnatomicalPixelCentreWorld':float(distance[py,px]),
                'distanceToClosestClosedAnatomicalPixelSquareWorld':cell_distance,
                'withinUnchanged1WorldMargin':cell_distance<=1})
        base=Image.new('RGBA',image.size,'#252a35');base.alpha_composite(image)
        receiving=Image.alpha_composite(base,Image.fromarray(tint))
        draw=ImageDraw.Draw(receiving)
        for box in boxes:outline(draw,box['capsule'],'#64fff4')
        attackpath=ART/f'{key}-clean3-paired-attack-candidate.json';attack=json.loads(attackpath.read_text())
        combined=receiving.copy();draw=ImageDraw.Draw(combined)
        for hit in attack['attackCollisionPoses'][0]['collisionHits']:outline(draw,hit['capsule'],'#ff6278')
        for name,canvas in [('receiving',receiving),('combined',combined)]:
            side=Image.new('RGBA',(image.width*2,image.height),'#252a35');side.paste(canvas,(0,0));side.paste(ImageOps.mirror(canvas),(image.width,0))
            side.convert('RGB').save(ART/f'{key}-packed-quarter-{name}-bothfaces.png')
        records.append({'key':key,'packedImage':imagepath.name,'packedImageSha256':sha(imagepath),
            'receivingPacket':packetpath.name,'receivingPacketSha256':sha(packetpath),
            'attackPacket':attackpath.name,'attackPacketSha256':sha(attackpath),
            'receivingPrimitives':len(boxes),'worldGeometryChanged':False,
            'root':[128,208],'flippedOriginX':1-128/384,'unflippedOriginX':128/384,
            'bodyCentreFromRootY':-42,'targetAnatomicalPixels':int(anatomical.sum()),
            'anatomicalCoverage':float((anatomical&union).sum()/anatomical.sum()),
            'receivingOutsideAnatomyPixels':int(outside.sum()),'receivingBeyond1WorldMarginPixels':int(beyond.sum()),
            'maxOutsidePixelCentreDistanceWorld':float(distance[union].max()),
            'strictCentreDisagreementsExactFootprintChecks':footprint_checks,
            'footprintPolicy':'Visible anatomical pixels occupy closed square [x,x+1]×[y,y+1]; receiving raster probe is at x+.5,y+.5. Exact minimum point-to-square distance over every anatomical pixel. Margin remains 1 world unit; continuous capsule-boundary qualification is not inferred from this discrete check.',
            'diagnosticRasterPolicy':'Actual resized alpha32 intersected with LANCZOS resized accepted anatomical binary alpha32; capsule pixel-centre membership. Distance to closest anatomical pixel centre; no automatic margin relaxation.',
            'accepted':False,'actualPackedRuntimeVerified':False})
    out={'state':'source_only_packed_collision_candidates_actual_inspection_pending','records':records,
        'scope':'Existing world source attack geometry and accepted authored receiving remain unchanged. Packing candidate only; delivered immutable pilot untouched.'}
    (ART/'firstcontact-quarter-packed-collision-review.json').write_text(json.dumps(out,indent=2)+'\n')
    print(json.dumps(records,indent=2))

if __name__=='__main__':main()
