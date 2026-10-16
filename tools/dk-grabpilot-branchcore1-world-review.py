"""Static light/dark bothface views of candidate geometry at game scale."""
from pathlib import Path
import json,hashlib,math
from PIL import Image,ImageDraw
ROOT=Path(__file__).resolve().parents[1]
ART=ROOT/'docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/art'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def main():
    rows=[]
    for clip,n in [('grab',8),('dash_grab',11),('pivot_grab',12)]:
        stem=f'grabpilot-{clip}-native{n}-quarter-branchcore1-receiving';p=ART/(stem+'-candidate.json');j=json.loads(p.read_text());target=ROOT/j['targetImage'];assert sha(target)==j['targetImageSha256'];sprite=Image.open(target).convert('RGBA');scale=j['scaleToWorld'];root=j['root'];sprite=sprite.resize((round(sprite.width*scale),round(sprite.height*scale)),Image.Resampling.LANCZOS)
        view=Image.new('RGBA',(1200,600),(25,30,39,255));draw=ImageDraw.Draw(view);draw.rectangle((0,300,1200,600),fill=(247,246,238,255))
        boxes=j['hurtboxPoses'][0]['hurtboxes']
        for row,col in [(0,(218,225,239)),(1,(25,35,46))]:
            floor=row*300+245;draw.line((0,floor,1200,floor),fill=(120,135,155));draw.text((12,row*300+10),clip+' candidate only | actual world scale | no live contact acceptance',fill=col)
            for cx,face in [(300,1),(900,-1)]:
                s=sprite if face==1 else sprite.transpose(Image.Transpose.FLIP_LEFT_RIGHT);rx=root[0]*scale if face==1 else s.width-root[0]*scale;view.alpha_composite(s,(round(cx-rx),round(floor-root[1]*scale)))
                for b in boxes:
                    c=b['capsule'];a=(cx+c['start']['x']*face,floor-42+c['start']['y']);z=(cx+c['end']['x']*face,floor-42+c['end']['y']);r=c['radius'];theta=math.atan2(z[1]-a[1],z[0]-a[0]);points=[]
                    for center,start in [(a,theta+math.pi/2),(z,theta-math.pi/2)]:
                        for k in range(17):
                            t=start+k*math.pi/16;points.append((center[0]+r*math.cos(t),center[1]+r*math.sin(t)))
                    draw.line(points+[points[0]],fill=(65,170,230,230) if b['region'].startswith('hand') else (220,75,140,230),width=1)
        out=ART/(stem+'-bothface-light-dark-world.png');assert not out.exists();view.convert('RGB').save(out);rows.append({'clip':clip,'nativeSample':n,'candidate':str(p.relative_to(ROOT)),'candidateSha256':sha(p),'worldView':str(out.relative_to(ROOT)),'worldViewSha256':sha(out),'targetImageSha256':j['targetImageSha256'],'primitiveCount':j['primitiveCount'],'maxReceivingBottom':max(max(b['capsule']['start']['y'],b['capsule']['end']['y'])+b['capsule']['radius'] for b in boxes),'diagnostics':j['targetAlphaDiagnostics'],'regionalFitPolicies':j['finalDigitProbes']})
    out=ART/'grab-first-three-branchcore1-world-output-pins.json';assert not out.exists();out.write_text(json.dumps({'state':'three_branchcore1_candidates_actual_review_pending','rows':rows,'GPUUsed':False,'fitterRepeated':False,'canonicalWrites':False,'toolSha256':sha(Path(__file__))},indent=2)+'\n');print(out.name,sha(out))
if __name__=='__main__':main()
