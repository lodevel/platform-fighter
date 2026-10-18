"""Memory model for a cutout-parts character versus today's full drawings (BC7 = 1 byte per pixel).
Inputs are measurements: package baselines (Phase 3 repacked BC7), median non-empty pixels of a
drawing (out/nonempty.json), and the prototype's measured part rectangles (rig2/rig.json)."""
import json
MiB=2**20
base={'donkeykong':158.1,'link':70.9,'pikachu':63.9}            # repacked BC7 MiB (Phase 3 README)
final_share={'donkeykong':0.39,'link':0.08,'pikachu':0.61}       # share of pixels in Final actions (Phase 3 README)
ne=json.load(open('out/nonempty.json'))
rig=json.load(open('rig2/rig.json'))
proto_rect=sum((p['bbox'][2]+4)*(p['bbox'][3]+4) for p in rig['parts'].values())
proto_px=sum(p['pixels'] for p in rig['parts'].values())
# One view of a full cutout set: the body's visible area, +30% for hidden regions painted
# under overlaps and joint caps, stored in tight rectangles that are ~60% full (prototype: see below).
HIDDEN=1.30; FILL=0.60
VIEWS=5            # 3/4 front, profile, 3/4 back, front, back (left facing is a mirror)
EXTRAS=0.5         # hand shapes, head angles x expressions, feet, accessories: +50% of the view sets
def library(A, final_res=False):
  px=A*HIDDEN/FILL*VIEWS*(1+EXTRAS)
  return px*(4 if final_res else 1)/MiB
out={'prototype':{'parts':len(rig['parts']),'nonempty_px':proto_px,'rect_px_with_padding':proto_rect,'fill':round(proto_px/proto_rect,2),
                  'bc7_KiB':round(proto_rect/1024,1),'jab_today_bc7_KiB':None},'fighters':{}}
for f,B in base.items():
  A=ne[f]['median_nonempty_nonfinal']
  lib=library(A); libF=library(A,True)
  rows={}
  for keep in (0.05,0.10,0.20,0.30):
    for fr,L in (('match-res',lib),('final-res',libF)):
      tot=L+keep*B; rows[f'{int(keep*100)}% kept / {fr}']=dict(total_MiB=round(tot,1),factor=round(B/tot,1))
  # Finals kept as drawings on top of 10% corrections elsewhere
  tot=lib+B*final_share[f]+0.10*B*(1-final_share[f])
  rows['Finals kept as drawings + 10% elsewhere / match-res']=dict(total_MiB=round(tot,1),factor=round(B/tot,1))
  out['fighters'][f]=dict(baseline_bc7_MiB=B,median_body_px=A,library_MiB=round(lib,2),library_final_res_MiB=round(libF,2),scenarios=rows)
# pose data: 20 bones x (angle, dx, dy, sx, sy as float16 + attachment byte + z byte) per key
for f in base:
  p=json.load(open(f'/home/lombet/Workspace/platform-fighter/.tmp/character-packages/{f}/character.json'))
  ticks=sum(a['drawings']['windows'][-1]['end'] for a in p['actions'].values() if a['drawings']['windows'])
  out['fighters'][f]['pose_data_KiB_every_tick']=round(ticks*20*12/1024)
  out['fighters'][f]['pose_data_KiB_keys_at_today_windows']=round(len(p['drawings'])*20*12/1024)
print(json.dumps(out,indent=1))
json.dump(out,open('out/memory_model.json','w'),indent=1)
