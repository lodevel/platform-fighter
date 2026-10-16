"""Prepare remaining Pikachu native body/input batches without GPU submission.

Native source samples are authoring coordinates, not gameplay clock assertions.
Actual native, seed/mask and control-guide inspection is a separate required step.
"""
from pathlib import Path
import argparse, copy, hashlib, importlib.util, json
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
ROOT=Path(__file__).resolve().parent.parent
E=ROOT/'docs/review/2026-10-06/pikachu-character'
B=E/'art'; REVIEW=E/'sources/full-body-native-review'
OUT=ROOT/'assets/gen/pikachu-native-reference/geometry-reference/full-body'
CAT={r['name']:r for r in json.loads((E/'sources/posed-resources/body-motion-catalog.json').read_text())['rows']}
# Explicit authored sampling of authenticated native clips; no unreviewed interpolation to gameplay frames.
PLAN={
 'locomotion':[
 ('idle','a00wait1',[0,26,53,79,106]),
 ('walk-slow','a01walkslow',[0,10,20,30,40]),('walk-middle','a01walkmiddle',[0,8,15,23,30]),('walk-fast','a01walkfast',[0,4,8,12,15]),
 ('initial-dash','a02dash',[0,5,12,24,37]),('run','a02run',[0,7,13,20,26]),
 ('dash-turn','a02turndash',[0,8,16,24,32]),('run-turn','a02turnrun',[0,5,10,15,19]),
 ('run-brake-r','a02runbraker',[0,8,16,24,29]),('run-brake-l','a02runbrakel',[0,8,16,24,29]),
 ('jump-squat','a03jumpsquat',[0,2,4]),('jump-forward','a03jumpf',[0,8,20,32,44]),('jump-backward','a03jumpb',[0,8,20,32,45]),
 ('air-jump-forward','a03jumpaerialf',[0,10,24,40,59]),('air-jump-backward','a03jumpaerialb',[0,10,24,40,64]),
 ('fall','a04fall',[0,6,12,18]),('fall-special','a04fallspecial',[0,4,8]),
 ('soft-land','a05landinglight',[0,4,8,15]),('hard-land','a05landingheavy',[0,6,15,24,30]),('special-land','a04landingfallspecial',[0,6,15,24,30]),
 ('crouch-start','a05squat',[0,7,14]),('crouch-hold','a05squatwait',[0,15,30,45,59]),('crouch-end','a05squatrv',[0,7,15]),
 ('crawl-forward','a05squatf',[0,4,8,12,16]),('crawl-backward','a05squatb',[0,6,11,17,22])],
 'defense':[
 ('shield-start','b00guardon',[0,6,13]),('shield-hold','b00guard',[0,90,180,270,360]),('shield-release','b00guardoff',[0,7,15]),
 ('parry','b00justshieldoff',[0,5,10,19]),('shield-hit','b01guarddamage',[0,5,10,20]),
 ('spot-dodge','b02escapen',[0,4,8,15,25,37]),('roll-forward','b02escapef',[0,4,10,18,27,35]),('roll-back','b02escapeb',[0,4,10,18,27,39]),
 ('air-dodge-neutral','b02escapeair',[0,4,12,24,44,64,83]),
 ('shield-break-dizzy','f06furafura',[0,30,60,90,120]),('shield-break-recover','f06furafuraend',[0,12,24,36,49])],
 'capture':[
 ('grab-standing','e00catch',[0,3,6,7,12,25,47]),('grab-dash','e00catchdash',[0,6,9,11,25,49]),('grab-pivot','e00catchturn',[0,6,10,12,25,49]),
 ('grab-pull','e00catchpull',[0,5,10,20]),('grab-hold','e00catchwait',[0,8,15,23,30]),('pummel','e00catchattack',[0,2,4,8,16,23]),
 ('forward-throw','e01throwf',[0,10,15,20,25,30,36,45,59]),('back-throw','e01throwb',[0,5,10,16,23,26,40,65]),
 ('up-throw','e01throwhi',[0,5,10,14,16,20,30,49]),('down-throw','e01throwlw',[0,4,8,13,14,20,21,24,28,35,43,54]),
 ('grab-escape','e00catchcut',[0,10,22,33,44]),('captured-hold','e02capturewaithi',[0,15,30,45,60]),
 ('captured-damage','e02capturedamagehi',[0,5,10,19]),('captured-release','e03capturecut',[0,7,15,29])],
 'tilts':[
 ('forward-tilt-up','c01attacks3hi',[0,3,5,6,7,9,12,20,32,45]),('forward-tilt-down','c01attacks3lw',[0,3,5,6,7,9,12,20,32,45])],
 'ledge-getup':[
 ('ledge-catch','g01cliffcatch',[0,6,12,24]),('ledge-hang','g01cliffwait',[0,30,60,90,120]),('ledge-getup','g02cliffclimb',[0,9,18,28,37]),
 ('ledge-jump-start','g02cliffjump1',[0,5,11]),('ledge-jump-air','g02cliffjump2',[0,6,13,20,26]),
 ('ledge-roll','g02cliffescape',[0,10,20,35,50,62]),('ledge-attack','g02cliffattack',[0,10,18,20,22,28,40,59]),
 ('getup-attack-face-up','f03downattacku',[0,7,14,19,23,26,35,54]),('getup-attack-face-down','f04downattackd',[0,7,14,19,23,26,35,54]),
 ('trip-attack','g03slipattack',[0,7,14,19,23,26,35,49]),
 ('getup-face-up','f03downstandu',[0,7,15,22,29]),('getup-face-down','f04downstandd',[0,7,15,22,29]),
 ('getup-roll-forward-face-up','f03downforwardu',[0,9,18,28,37]),('getup-roll-back-face-up','f03downbacku',[0,10,20,30,39]),
 ('getup-roll-forward-face-down','f04downforwardd',[0,9,18,27,36]),('getup-roll-back-face-down','f04downbackd',[0,10,20,30,39]),
 ('tech-ground','f05passive',[0,8,16,24,34]),('tech-forward','f05passivestandf',[0,11,22,33,44]),('tech-backward','f05passivestandb',[0,10,21,31,42]),
 ('tech-wall','f05passivewall',[0,6,12,18,24]),('tech-ceiling','f05passiveceil',[0,6,13,20,26]),('wall-jump','f05passivewalljump',[0,11,22,33,44])],
 'specials':[
 ('thunder-jolt-ground','d00specialn',[0,8,16,19,24,35,50,74]),('thunder-jolt-air','d00specialairn',[0,8,16,19,24,35,50,74]),
 ('skull-bash-ground-start','d01specialsstart',[0,4,8,13]),('skull-bash-ground-hold','d01specialshold',[0,2,4,6]),('skull-bash-ground-ready','d01specialsready',[0,4,8,12,16]),
 ('skull-bash-air-start','d01specialairsstart',[0,4,8,13]),('skull-bash-air-hold','d01specialairshold',[0,2,4,6]),('skull-bash-air-ready','d01specialairsready',[0,4,8,12,16]),
 ('skull-bash-ground-release','d01specials',[0,6,13,20,30,39]),('skull-bash-ground-end','d01specialsend',[0,10,20,35,57]),
 ('skull-bash-air-end','d01specialairsend',[0,10,20,35,46]),('skull-bash-air-miss-end','d01specialairsmissend',[0,10,20,35,46]),
 ('quick-attack-ground-start','d02specialhistart',[0,4,8,14]),('quick-attack-air-start','d02specialairhistart',[0,4,8,14]),
 ('quick-attack-dash','d02specialairhi',[0,2,5]),('quick-attack-ground-end','d02specialhiend',[0,10,25,40,50]),('quick-attack-air-end','d02specialairhiend',[0,10,25,40,50])],
 'reactions-misc':[
 ('hurt-ground','f00damagen1',[0,5,11]),('hurt-air','f01damageair1',[0,7,14]),('tumble','f01damageflyn',[0,9,18,27,36]),
 ('down-wait-face-up','f03downwaitu',[0,18,35,53,70]),('down-wait-face-down','f04downwaitd',[0,18,35,53,70]),('trip-wait','g03slipwait',[0,23,45,68,90]),
 ('taunt-up','j01appealhir',[0,10,25,40,55,77]),('taunt-side','j01appealsr',[0,10,25,40,55,70]),('taunt-down','j01appeallwr',[0,10,25,40,55,74]),
 ('respawn-entry','j00entryr',[0,25,50,75,100,128]),('footstool-jump','a06stepjump',[0,4,8]),('footstool-fall','a06stepfall',[0,4,8,12,16])]
}
sha=lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
def loadguide(family):
 spec=importlib.util.spec_from_file_location('pikachu_full_guide',ROOT/'tools/pikachu-native-guide.py');g=importlib.util.module_from_spec(spec);spec.loader.exec_module(g)
 g.SIZE=(2048,2560) if family in ['ledge-getup','reactions-misc'] else (2048,2048)
 g.ART_ROOT=(1024,1664);g.VIEW_SIDE='negative';g.ROOT_REGISTRATION='remove-trans-translation';return g

def prepare(family,only_action=None):
 dest=OUT/family;review=REVIEW/family;dest.mkdir(parents=True,exist_ok=True);review.mkdir(parents=True,exist_ok=True)
 g=loadguide(family);template=json.loads((B/'fair-startup-source0-attempt1.workflow.json').read_text());rows=[];panels=[];guidepanels=[]
 for action,motion,samples in PLAN[family]:
  if only_action and action!=only_action:continue
  source=CAT[motion]
  for index in samples:
   if index>source['native_final_frame_index']:raise ValueError('Sample past animation end')
   key=f'full-{action}-sample{index}-source{index}';prefix=dest/key;meta=prefix.with_suffix('.json')
   if meta.exists() and json.loads(meta.read_text())['canvas'] != list(g.SIZE):
    # Retain failed/clipped source captures; rerender native geometry on a taller
    # canvas with identical scale/root instead of stretching or padding clipped art.
    archived=dest/'rejected-canvas-2048';archived.mkdir(exist_ok=True)
    old=json.loads(meta.read_text())
    for filename in old['output_files']:
     original=dest/filename;backup=archived/filename
     if backup.exists():raise ValueError('Archive already exists; reconcile before overwrite')
     original.rename(backup)
    meta.rename(archived/meta.name)
   if not meta.exists():g.render(motion,index,prefix)
   data=json.loads(meta.read_text());
   if data['canvas']!=list(g.SIZE) or data['root']!=list(g.ART_ROOT):raise ValueError('Registration changed')
   for f,h in data['output_files'].items():
    if sha(dest/f)!=h:raise ValueError('Native output changed')
   seed=Image.open(str(prefix)+'-palette-seed.png').convert('RGB');control=Image.open(str(prefix)+'-guide.png').convert('RGB');anatomy=Image.open(str(prefix)+'-mask.png').convert('L');native=Image.open(str(prefix)+'-reference.png').convert('RGBA');bounds=anatomy.getbbox()
   if not bounds or min(bounds[0],bounds[1],g.SIZE[0]-bounds[2],g.SIZE[1]-bounds[3])<16:raise ValueError(f'Clipped/empty {key}: {bounds}')
   px=np.asarray(seed);red=(px[:,:,0]>160)&(px[:,:,1]<90)&(px[:,:,2]<65)
   protected=Image.fromarray(red.astype(np.uint8)*255).filter(ImageFilter.MaxFilter(9));mask=anatomy.filter(ImageFilter.MaxFilter(21)).filter(ImageFilter.GaussianBlur(2));mask=Image.fromarray(np.where(np.asarray(protected)>0,0,np.asarray(mask)).astype(np.uint8)).convert('RGB')
   for kind,im in [('seed',seed),('guide',control),('anatomy-mask',anatomy),('render-mask',mask)]:im.save(B/f'{key}-{kind}.png')
   graph=copy.deepcopy(template);uploads={}
   for node,remote,local in [('10','guide','guide'),('13','seed','seed'),('16','mask','render-mask')]:
    filename=f'pf-pikachu-{key}-full-beta1-{remote}.png';graph[node]['inputs']['image']=filename;uploads[filename]=f'{key}-{local}.png'
   graph['4']['inputs']['text']=('Canonical Pikachu in the accepted clean outlined 2D cartoon identity and exact colored seed palette. One yellow mouse, two black-tipped ears with source occlusion, one attached lightning-shaped tail with brown base, short mouse limbs. '
      f'Exact {action} body pose from native sample {index}: preserve body lean, head angle, limb arrangement, front/back visibility and complete tail. '
      'Keep red cheeks distinct from brown tail/back markings; never invent visible eyes or paws on the back. Preserve silhouette, fixed canvas, body scale and root. Clean black anatomy outlines and simple flat cel shading. Uniform flat magenta background. '
      'This drawing is the Pikachu body alone: no opponent, shield bubble, electrical particles, lightning, cloud, shadow, weapon, labels or collision circles. Those objects are rendered separately.')
   for node,kind in [('9','masked-final'),('20','raw-diagnostic')]:graph[node]['inputs']['filename_prefix']=f'pf-pikachu-20261008-{key}-attempt1-{kind}'
   workflow=f'{key}-attempt1.workflow.json';request=f'{key}-attempt1.request.json';(B/workflow).write_text(json.dumps(graph,indent=2)+'\n');(B/request).write_text(json.dumps({'prompt':graph,'client_id':f'pf-pikachu-{key}'},indent=2)+'\n')
   row={'key':key,'action':action,'family':family,'motion':motion,'source_index':index,'native_sample_index':index,'native_final_frame_index':source['native_final_frame_index'],'gameplay_frame_mapping':None,'hold_game':None,'pose':f'native-{index}',
     'source_kind':'Authenticated native animation evaluated by approximate body-only CPU renderer; gameplay clocks separately sourced', 'source_path':str(Path(str(prefix)+'-reference.png').relative_to(ROOT)),'source_sha256':sha(Path(str(prefix)+'-reference.png')),'native_reference_metadata':str(meta.relative_to(ROOT)),'native_reference_metadata_sha256':sha(meta),
     'root_registration':'remove-trans-translation','captured_trans_translation':data['captured_trans_translation'],'bounds':list(bounds),'workflow':workflow,'request':request,'upload_mapping':uploads,'hashes':{kind:sha(B/f'{key}-{kind}.png') for kind in ['seed','guide','render-mask']},'state':'prepared; actual reference/input/control inspection required'}
   rows.append(row)
   crop=(bounds[0]-25,bounds[1]-25,bounds[2]+25,bounds[3]+25);bg=Image.new('RGBA',native.size,'#17253a');bg.alpha_composite(native)
   panel=Image.new('RGB',(1800,450),'#17253a')
   for side,im in enumerate([bg.convert('RGB'),seed,mask]):
    im=im.crop(crop);im.thumbnail((580,395));panel.paste(im,(side*600+(600-im.width)//2,35+(395-im.height)//2))
   ImageDraw.Draw(panel).text((8,8),key+' / native, palette seed, red-protected mask / body only',fill='white');panels.append(panel)
   cp=Image.new('RGB',(900,450),'#17253a');im=control.crop(crop);im.thumbnail((880,400));cp.paste(im,((900-im.width)//2,35+(400-im.height)//2));ImageDraw.Draw(cp).text((8,8),key+' / actual control input',fill='white');guidepanels.append(cp)
 galleries={};guides={}
 for start in range(0,len(panels),6):
  for kind,arr,width,record in [('inputs',panels,1800,galleries),('controls',guidepanels,900,guides)]:
   gallery=Image.new('RGB',(width,450*len(arr[start:start+6])),'#17253a')
   for i,panel in enumerate(arr[start:start+6]):gallery.paste(panel,(0,i*450))
   file=review/f'{only_action+"-" if only_action else ""}{kind}-gallery-{start//6+1:02}.png';gallery.save(file);record[str(file.relative_to(ROOT))]=sha(file)
 record={'state':'generation_inputs_pending_actual_review','family':family,'records':rows,'coordinate_contract':{'canvas':list(g.SIZE),'root':list(g.ART_ROOT),'world_scale':70/600},'input_galleries':galleries,'control_galleries':guides,
  'limits':['Native clip sample indices are not gameplay frames; phase clocks/rates/holds/loops require source mapping before runtime parity','Native body references are authoring inputs only; helper constraints, animated materials, VFX and attached victims omitted','Root translation removed from body; captured Trans translation retained in per-pose metadata for separately sourced movement','No GPU submission, generated-art acceptance, hurtbox qualification or runtime verification']}
 path=review/(f'{only_action}-preparation.json' if only_action else 'preparation.json');path.write_text(json.dumps(record,indent=2)+'\n');print(json.dumps({'family':family,'poses':len(rows),'preparation':str(path.relative_to(ROOT))}),flush=True)
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('family',choices=PLAN);p.add_argument('--action');p.add_argument('--inventory-only',action='store_true');args=p.parse_args()
 if args.inventory_only:
  REVIEW.mkdir(parents=True,exist_ok=True);(REVIEW/'plan.json').write_text(json.dumps({'families':PLAN,'sampleCount':sum(len(s) for f in PLAN.values() for _,_,s in f),'unresolvedNativeRoutes':['EscapeAirSlide uses acquired b02escapeair declared by motion-list; directional status clock/kinetics/basis binding still needed','ShieldBreakFly absent from acquired Pikachu resources; shared route needed','ItemLightGet/ItemLightThrow and other item declarations resolve acquired h00/h01 etc resources; native body/status/equipment contracts and actual review still needed','Left taunt/entry clips absent; facing/render flip and selection must be qualified']},indent=2)+'\n');print('Plan written')
 else:prepare(args.family,args.action)
