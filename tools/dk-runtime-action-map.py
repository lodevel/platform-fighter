"""Emit review-side runtime contracts; never writes canonical inventory or acceptance flags."""
import json,yaml,hashlib
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
BASE=ROOT/'docs/review/2026-09-25/donkeykong-character'
rows=json.loads((BASE/'inventory.json').read_text())['actions']
ml=yaml.safe_load((BASE/'sources/motion-list.yml').read_text())['list']
contracts={}
def add(ids,sheet,motion,entry,route='Character.applyInput → donkeyKongBodyCandidate',gaps=()):
 for key in ids.split('|'):contracts[key]={'animation_key':sheet,'native_motion_selector':motion,'input_and_entry':entry,'runtime_entry_route':route,'unresolved_implementation':list(gaps)}
add('idle','idle','wait','Grounded, no committed action, neutral stick')
add('walk','walk','walk_middle','Grounded horizontal input below initial-dash threshold; analog speed selects walk target')
add('initial-dash','dash','dash','Fresh horizontal flick starts locomotion.initialDash')
add('run','run','run','Continue held horizontal stick after initial dash')
add('dash-turn','dash_turn','turn_dash','Opposite horizontal input during initial dash; latched DK phase, flag3 authored facing, eligible held opposite direction transitions to run at native18')
add('run-turn','run_turn','turn_run','Opposite horizontal input while running; latched DK source drawing extent33 commitment, source traction.615')
for side in ['r','l']:add('run-brake-'+side,'run_brake' if side=='r' else 'run_brake_left','run_brake_'+side,'Release running stick;19-step source brake; gait chooses '+side,gaps=('Left gait branch requires independently reviewed actual DK run-gait selector; runtime default right is explicitly authored',) if side=='l' else ())
contracts['dash-turn']['source_fidelity_limits']=['Common TURN_DASH flag3 facing consumer unknown; authored flip timing and.68 reversal acceleration remain explicit','Native dash-speed addition to residual velocity/setup not reconstructed']
contracts['run-turn']['source_fidelity_limits']=['Native status cancel0 unknown;33 drawing extent is explicit authored commitment','Native stop flag15 retained independently of authored state exit']
contracts['run']['source_fidelity_limits']=['Native additive acceleration and constant traction consumed; common control-energy setup/order not reconstructed']
for phase,motion in [('start','squat'),('hold','squat_wait'),('end','squat_rv')]:add('crouch-'+phase,'crouch'+('' if phase=='hold' else '_'+phase),motion,'Grounded down-stick crouch '+phase+'; start/end ages0–6 then free observed posture')
add('jump-squat','jumpsquat','jump_squat','Fresh grounded jump;3 fixed startup steps before impulse')
add('full-hop','jump','jump_f','Grounded jump held through jumpsquat; full impulse; latched jump entry controls',gaps=('Backward native jump resource needs dedicated branch rather than forward-only pose',))
add('short-hop','jump_short','jump_f','Grounded jump released within jumpsquat; selected short-hop impulse',gaps=('Backward native jump resource needs dedicated branch rather than forward-only pose',))
add('air-jump','airjump','jump_aerial_f','Fresh airborne jump with jumps remaining',gaps=('Backward native air-jump resource needs dedicated branch rather than forward-only pose',))
add('air-drift','air_drift','fall_f','Airborne rise without active jump presentation; proportional horizontal steering')
add('fall','fall','fall','Airborne downward velocity without helpless or fast-fall latch')
add('fast-fall','fall_fast','fall','Fresh down-stick after apex sets fast-fall latch; sourced fall pose with distinct selected kinetic state')
for key in ['air-drift','fall','fast-fall']:contracts[key]['source_fidelity_limits']=['Ordinary uncommitted DK air control consumes add+.05stick and fixed.075 neutral brake; special/cargo/item/attack-owned kinetic states retain separate adapters']
add('soft-land','landing_soft','landing_light','Matter ground contact at selected soft landing speed')
add('hard-land','landing_hard','landing_heavy','Matter ground contact at selected hard landing speed')
for key,sheet,motion,entry in [('shield','shield','guard','Hold shield while ground actionable'),('shield-release','shield_end','guard_off','Release ordinary raised shield'),('shield-block','shield_hit','guard_damage','Receive blockable hit while shield raised; actual blockstun age'),('parry','parry','guard_off','Blockable hit in shield-release parry eligibility window; source parry effect/body selection still unresolved'),('shield-break','shield_break','furafura','Shield HP exhausted; actual break-stun countdown')]:add(key,sheet,motion,entry,gaps=('Native guard-on/off8-step clock versus retained shared beta release11 remains unresolved',) if key=='shield-release' else ('Dedicated native parry body/effect resource applicability unresolved',) if key=='parry' else ())
add('spot-dodge','spot_dodge','escape','Grounded dodge press with neutral horizontal input; conditional attack cancel')
add('roll-forward','roll','escape_f','Grounded dodge press with forward horizontal input')
add('roll-back','roll_back','escape_b','Grounded dodge press with backward horizontal input')
add('air-dodge-neutral','air_dodge','escape_air','Airborne dodge press with neutral stick; selected intangibility and landing')
for direction in ['down','down-diagonal','horizontal','up-diagonal','up']:add('air-dodge-'+direction,'air_dodge_'+direction.replace('-','_'),'escape_air_slide','Airborne dodge press with '+direction+' stick; source same native air-dodge body, actual directional kinetic vector latched')
attack=[('jab','jab','attack_11','Neutral light attack'),('jab2','jab2','attack_12','Fresh attack in jab1 continuation window'),('forward-tilt','ftilt','attack_s3_s','Horizontal light attack below smash flick threshold'),('forward-tilt-up','ftilt_up','attack_s3_hi','Horizontal light attack with upward angle'),('forward-tilt-down','ftilt_down','attack_s3_lw','Horizontal light attack with downward angle'),('up-tilt','utilt','attack_hi3','Upward light attack'),('down-tilt','dtilt','attack_lw3','Downward light attack'),('dash-attack-early|dash-attack-late','dash_attack','attack_dash','Light attack while running; exact collision rung selected by elapsed age'),('forward-smash-close|forward-smash-far','fsmash','attack_s4_s','Horizontal heavy attack release; close/far region chosen by actual capsule contact'),('up-smash','usmash','attack_hi4','Upward heavy attack release'),('down-smash-early-fist|down-smash-late-fist|down-smash-arms','dsmash','attack_lw4','Downward heavy attack release; region and early/late clocks from collision records'),('neutral-air-early|neutral-air-late','nair','attack_air_n','Airborne neutral light attack; elapsed early/late source rung'),('forward-air-early|forward-air-late-meteor|forward-air-late-arms','fair','attack_air_f','Airborne forward light attack; region/time source rung'),('back-air-early|back-air-late','bair','attack_air_b','Airborne backward light attack; elapsed early/late source rung'),('up-air','uair','attack_air_hi','Airborne upward light attack'),('down-air-foot|down-air-body','dair','attack_air_lw','Airborne downward light attack; contacted foot/body source region')]
for args in attack:add(*args,route='Character attack arbitration → AttackInstance elapsed clock → DK paired metadata and HitboxDamageHandler')
for direction,base,motion in [('forward','fsmash','attack_s4_hold'),('up','usmash','attack_hi4_hold'),('down','dsmash','attack_lw4_hold')]:add(direction+'-smash-charge',base+'_charge',motion,'Hold heavy attack after native charge entry; loop age advances only unfrozen')
for situation in ['ground','air']:
 prefix='special_air_n' if situation=='air' else 'special_n';base='neutral_special'+('_air' if situation=='air' else '')
 add('giant-punch-'+situation+'-charge',base+'_charge',prefix+'_loop','Fresh neutral special press starts7-step entry then automatic wind; releasing or holding does not fire; airborne charging allowed; dedicated start/loop/end phase clocks consumed')
 add('giant-punch-'+situation+'-partial',base,prefix,'Fresh second neutral special press below111 automatically winding steps; integer partial damage source; situation latched at release')
 add('giant-punch-'+situation+'-full','neutral_special_full'+('_air' if situation=='air' else ''),prefix+'_max','Fresh special with111 banked charge steps fires directly; full automatic wind banks after4-step end; separate full damage/armor/launch and dedicated situation body selected')
 add('giant-punch-'+situation+'-cancel-bank',base+'_cancel',prefix+'_cancel','Ground shield/roll/jump or air dodge cancels wind after4steps; air jump after5 only with resource; phase body, held shield at exit, landing interruption and bank/resume are consumed')
 add('headbutt-'+situation,'side_special'+('_air' if situation=='air' else ''),'special_air_s' if situation=='air' else 'special_s','Side special; ground/air entry momentum scales and half gravity; bury only grounded target')
 spin='up_special_'+situation
 add('|'.join('spinning-kong-'+situation+'-'+phase for phase in ['first','multihit','final']),spin,'special_air_hi' if situation=='air' else 'special_hi','Up special selected at entry; elapsed region/rung; grounded steering profile or sustained aerial lift')
 add('spinning-kong-'+situation+'-land',spin+'_land','landing_fall_special' if situation=='air' else 'special_hi','Ground contact during spin; selected landing tail',gaps=('Ground-spin mid-action floor-loss/landing continuation mechanics needs final source-specific review',) if situation=='ground' else ())
for phase in ['first','second','repeat']:add('hand-slap-ground-'+phase,'down_special','special_lw_loop','Down special on ground; two emitted shocks; fresh down-special/attack during continuation window repeats without arbitrary maximum',gaps=('Distinct native start/loop/end visual phase clocks required',))
for phase in ['first','second']:add('hand-slap-air-'+phase,'down_special_air','special_air_lw','Down special airborne; selected two source windows and landing cancel')
add('hand-slap-air-land','down_special_air_land','landing_air_lw','Landing during airborne Hand Slap; source selected landing lag')
for variant,motion,sheet in [('standing','catch','grab'),('dash','catch_dash','dash_grab'),('pivot','catch_turn','pivot_grab')]:add('grab-'+variant,sheet,motion,'Fresh grab in '+variant+' ground context; actual range sensor capture')
for key,sheet,motion,entry in [('grab-pull','grab_pull','catch_pull','Grab sensor connects; first20 hold steps'),('grab-hold','grab_hold','catch_wait','Holding captive after pull age20'),('pummel','pummel','catch_attack','Fresh attack while ordinary holding; no cargo pummel'),('grab-escape','grab_escape','catch_cut','Ordinary held target mash/timeout releases;29-step real release owner'),('forward-throw-cargo-entry','fthrow','throw_f','Forward ordinary throw direction enters cargo without damage;16 entry steps and invincibility'),('back-throw','bthrow','throw_b','Backward ordinary held throw; reverse at release'),('up-throw','uthrow','throw_hi','Upward ordinary held throw'),('down-throw','dthrow','throw_lw','Downward ordinary held throw')]:add(key,sheet,motion,entry)
for key,sheet,motion,entry in [('cargo-hold-ground','cargo_hold','shoulder_wait','Cargo ready grounded; percent-scaled budget minus ordinary spent hold/mash'),('cargo-hold-air','cargo_hold_air','shoulder_fall','Cargo ready airborne; no air-jump/dodge/special/items'),('cargo-walk','cargo_walk','shoulder_walk_middle','Horizontal cargo input below dash threshold; walk only'),('cargo-jump','cargo_jump','shoulder_jump','One grounded cargo jump, no airborne jump')]:add(key,sheet,motion,entry,gaps=('Dedicated cargo jumpsquat/landing phase presentation currently not latched',) if key=='cargo-jump' else ())
for direction,base,native in [('forward','fthrow','throw_f_f'),('back','bthrow','throw_f_b'),('up','uthrow','throw_f_hi'),('down','dthrow','throw_f_lw')]:
 for situation in ['ground','air']:add('cargo-'+direction+'-throw-'+situation,'cargo_'+base+('_air' if situation=='air' else ''),native,'Fresh attack/grab plus '+direction+' while cargo ready; '+situation+' branch latched at throw entry; same native ACMD resource; down-air boost−7.5/reversal on back')
for key,sheet,motion,entry,gap in [('ledge-catch','ledge_catch','cliff_catch','Airborne ledge catch','Native hand/root attachment and source20-sample catch age not yet wired'),('ledge-hang','ledge','cliff_wait','Hang after ledge catch','Native DK hand attachment not yet wired'),('ledge-getup','ledge_getup','cliff_climb_quick','Upward input while hanging','Native root traversal remains metadata pending'),('ledge-jump','ledge_jump','cliff_jump_quick1','Fresh jump while hanging','Dedicated14-step ledge jump start before source flight not yet wired'),('ledge-roll','ledge_roll','cliff_escape_quick','Dodge while hanging','UFD45-step total selected versus native49; authored source root traversal pending'),('ledge-attack','ledge_attack','cliff_attack_quick','Attack while hanging','Attack schema wired; native root traversal metadata pending'),('ledge-drop','fall','fall','Down input while hanging','Distinct drop transition presentation needs reviewed adaptation')]:add(key,sheet,motion,entry,gaps=(gap,))
for key,sheet,motion,entry in [('getup-face-up','getup_attack','down_attack_u','Light attack while face-up prone'),('getup-face-down','getup_attack_face_down','down_attack_d','Light attack while face-down prone'),('trip-attack','trip_attack','slip_attack','Light attack while tripped'),('getup-neutral','getup','down_stand_u','Jump/neutral input while prone;29-step neutral/getup;22 protected'),('getup-roll','getup_roll','down_forward_u','Horizontal input while prone;35-step directional roll; origin-specific protection'),('tech-ground','tech','passive','Shield/dodge press buffered within20 steps before ground impact;26-step neutral or40-step directional')]:add(key,sheet,motion,entry,gaps=('Face-down and backward dedicated sheets are selected at entry; final per-age root metadata pending',) if key=='getup-roll' else ('Face-down source variant needs independently reviewed dedicated sheet',) if key=='getup-neutral' else ())
contracts['tech-ground']['input_and_entry']='Shield/dodge press buffered before actual ground impact, neutral horizontal stick;26-step neutral source recovery with20 protected steps'
for direction,native in [('forward','passive_stand_f'),('back','passive_stand_b')]:add('tech-ground-'+direction,'tech_forward' if direction=='forward' else 'tech_back',native,'Buffered shield/dodge before ground impact with '+direction+' horizontal input;40-step source directional recovery with20 protected steps',gaps=('Final per-age directional root traversal metadata pending',))
for surface,motion in [('wall','passive_wall'),('ceiling','passive_ceil')]:add('tech-'+surface,'tech_'+surface,motion,'Fresh shield/dodge buffered before actual '+surface+' impact during hitstun/tumble',gaps=())
add('tech-wall-jump','tech_wall_jump','passive_wall_jump','Jump held at eligible buffered wall-tech impact; distinct from ordinary wall jump; no source protection',gaps=())
for key,sheet,motion,entry,gap in [('hurt-hitlag','hurt','damage_n_2','Receive actual damaging hit; hitlag freezes native body clock','Native damage-region/severity pose selection pending'),('tumble','tumble','damage_fly_n','Reference knockback above tumble threshold','Native high/low/meteor tumble pose selection pending'),('respawn','entry','entry_r','StockTracker respawn','DK respawn presentation age not yet installed'),('footstool-ground','footstool_pose','step_jump','Actual footstool recipient on ground','Native source step_jump eligibility/clock adaptation pending'),('footstool-air','footstool_air_pose','step_fall','Actual footstool recipient airborne','Native source step_fall eligibility/clock adaptation pending'),('helpless','fall_special','fall_special','Aerial spin completes before landing',''),('trip-recovery','trip','slip','Trip recipient waits ground recovery','Native trip stand/roll branch selection needs dedicated routes'),('prone-face-up','down_wait','down_wait_u','Ground knockdown with face-up observed origin',''),('prone-face-down','down_wait_face_down','down_wait_d','Ground knockdown with face-down observed origin',''),('captured-hold','captured','capture_wait_hi','Captured by actual other fighter','Low/high and cargo-captive source motion applicability remains unresolved'),('captured-damage','captured_hit','capture_damage_hi','Held-target damage event has own20 unfrozen steps then resumes hold age','Low/high captured damage applicability remains unresolved'),('captured-release','captured_release','capture_cut','Actual held target ordinary mash/timeout release29steps','Native ground/air release split adaptation remains recorded'),('item-pickup','item_pickup','item_light_get','Actual ItemManager pickup event','Native item socket/item-carry actor routing not yet DK-specific'),('item-carry','item_carry','wait_item','Actual held item while idle/walking','Dedicated held-item presentation not yet DK-specific'),('item-throw','item_throw','item_light_throw_f','Actual ItemManager throw event','Native direction/ground-air throw phase/socket routing not yet DK-specific')]:add(key,sheet,motion,entry,gaps=(gap,) if gap else ())
contracts['footstool-ground']['native_motion_selector']='step_pose'
contracts['footstool-ground']['unresolved_implementation']=['Dedicated recipient StepPose versus backward StepPoseBack selection and source status exit need review']
contracts['footstool-air']['native_motion_selector']='step_pose_air'
contracts['footstool-air']['unresolved_implementation']=[]
add('footstool-jump','footstool_jump','step_jump','Fresh jumper contact onto actual recipient; native1.3 vertical multiplier; performer StepJump is separate from recipient StepPose',gaps=())
add('footstool-mini-jump','footstool_jump_mini','step_jump','Release footstool jump within selected mini window; native.7 multiplier; same captured StepJump body, distinct kinetic state',gaps=())
for direction,native in [('up','appeal_hi'),('side','appeal_s'),('down','appeal_lw')]:
 for side in ['r','l']:add('taunt-'+direction+'-'+side,'taunt_'+direction+'_'+side,native+'_'+side,'Fresh appeal direction while ground actionable;50-step cancel; latched '+side+' facing; native left/right records explicitly reuse captured right motion')
add('buried-recipient','buried',None,'Actual sourced Headbutt collision_attr_bury on grounded recipient; duration independently recomputed at weight100 and stock rank','Character.applyHit → createBuriedState → tickBuriedState',('No DK-specific native buried body motion was captured; target art needs explicit authored source-anatomy adaptation',))
add('buried-escape','buried_escape',None,'Natural/mash unbury enters12 vulnerable steps and calibrated short-hop pop; weak stored launch overrides pop;90 native KB hit releases immediately','Character.applyHit → receiveBuriedHit/tickBuriedState',('Native unbury pop kinetics/body resource unknown; selected beta calibration must be independently reviewed',))
# Explicit standard light-item variants retain independent source timing and
# implementation flags. Actual accepted body/socket/match evidence is separate.
for situation in ['ground','air']:
 for direction,suffix in [('forward','f'),('back','b'),('up','hi'),('down','lw')]:
  for strength in ['ordinary','strong']:
   key='item-throw-'+situation+'-'+direction+('-strong' if strength=='strong' else '')
   if key=='item-throw-ground-forward':key='item-throw'
   sheet='item_throw_'+('air_' if situation=='air' else '')+suffix+('4' if strength=='strong' else '')
   native='item_light_throw_'+('air_' if situation=='air' else '')+suffix+('4' if strength=='strong' else '')
   add(key,sheet,native,'Held standard light item; fresh grab/throw attack and '+direction+' '+situation+'; '+strength+' selected only by source6/8 fresh directional flick window; native release '+str({'forward':10,'back':14,'up':15,'down':8}[direction])+' at unfrozen gameplay age minus1',route='MatchScene.prepareDonkeyKongItemInput → Character.begin/stepDonkeyKongItemAction → once-only drain → postphysics commitDonkeyKongItemEvents')
   contracts[key]['source_fidelity_limits']=['Direction flick thresholds are explicit project calibration','Target per-art-frame Have/release socket metadata absent until accepted source-motion art; static fallback remains unqualified']
add('item-throw-dash','item_throw_dash','item_light_throw_dash','Fresh held-item ordinary forward throw while dashing; source motion rate.92 release6 crossing at gameplayage6;29 total selected common status versus native32/rate conflict',route='MatchScene item request → Character item clock → postphysics once-only release')
add('item-drop-ground','item_throw_drop','item_light_throw_drop','Fresh neutral grab/throw input holding a ground-droppable item; native callback7/gameplayage6;23 duration',route='MatchScene item request → Character item clock → postphysics once-only release')
add('item-drop-air','air_drift',None,'Fresh neutral grab holding airborne light item; immediate Zdrop; preserves current aerial body and used dodge resource; neutral airdodge first3 can cancel',route='MatchScene item request → Character immediate item event/input suppression → postphysics release')
add('item-pickup-walking','item_pickup_walk','item_light_walk_get','Fresh attack near reserved actual grounded light item while horizontal stick walking; native attach2/age1,19-step source lifecycle',route='MatchScene specific item reservation → Character item clock → postphysics pickup')
contracts['item-pickup'].update({'input_and_entry':'Fresh attack near reserved actual grounded light item; native attach2/age1,7-step standing source lifecycle','unresolved_implementation':[],'runtime_entry_route':'MatchScene specific item reservation → Character item clock → postphysics pickup'})
for key in ['item-throw-dash','item-drop-ground','item-drop-air','item-pickup','item-pickup-walking']:
 contracts[key]['source_fidelity_limits']=['Dedicated target item body/root/socket metadata remains pending visual authoring','Item-specific physics/damage/multipliers remain authored project values unless independently sourced']
for key in [k for k in contracts if k.startswith('taunt-')]:contracts[key]['input_and_entry']=contracts[key]['input_and_entry'].replace('50-step cancel','49-step source cancel (nativeFAF50)')
additional=json.loads((BASE/'completion-2026-10-08/mechanics/item-additional-context-proposals.json').read_text())
for group in ['air_and_ground_startup_catch_rows','supported_six_item_use_rows','additional_native_weapon_branch_rows','missing_heavy_item_rows']:
 for proposal in additional[group]:
  key=proposal['id'].split('.',1)[1]
  selector=proposal['native_motion_selector']
  inherited=proposal.get('body_contract',{}).get('preserve_underlying_action')
  route={
   'air_and_ground_startup_catch_rows':'Pending DK source-window acquisition consumer; preserve current action body rather than start a grounded pickup',
   'supported_six_item_use_rows':'MatchScene held authored weapon dispatch → Character weapon AttackInstance; dedicated DK slot/pose routing remains pending',
   'additional_native_weapon_branch_rows':'Pending native weapon branch input/state/body consumer',
   'missing_heavy_item_rows':'Missing applicable engine heavy-item ownership/classification and DK lift/throw state consumers',
  }[group]
  add(key,selector,selector,proposal.get('entry_state','')+'; '+proposal.get('input',''),route,
      (proposal.get('implementation','Missing runtime consumer'),))
  contracts[key]['source_fidelity_limits']=proposal.get('source_limits',[])
  contracts[key]['inherited_body_route']=inherited
  contracts[key]['source_proposal_group']=group
  contracts[key]['source_callbacks']=proposal.get('source_callbacks',proposal.get('source_event'))
  if group=='air_and_ground_startup_catch_rows':
   contracts[key]['runtime_entry_route']='MatchScene real item overlap → Character.getDonkeyKongItemCatchContext → source stationary/aerial/dodge/tilt/dash window → Inventory catch acquisition; preserves current source body'
   contracts[key]['unresolved_implementation']=[]
  elif group=='missing_heavy_item_rows':
   contracts[key]['runtime_entry_route']='MatchScene explicit heavy entity reservation → Character separate heavy action/carry controller → ordered callback events → postphysics item commit'
   contracts[key]['unresolved_implementation']=[]
   contracts[key]['source_fidelity_limits']+=['Heavy get/throw unit rate remains authored pending native common caller; workbook2/1.33 retained as conflict','Carry walk acceleration/gait and common jump setup remain explicit authored adapters; source turn timer/motion-end phases consumed','Reaction-frame armor conversion remains unresolved; app7 carry/action consumer checks exist, revised vertical trajectories need a fresh app8 observation; paired heavy art/socket remains unaccepted']
   if key.endswith(('walk-slow','walk-fast')):contracts[key]['unresolved_implementation']=['Independent native speed-linked heavy walk gait selector remains unresolved; only explicit middle drawing adapter is selected']
pass_proposal=BASE/'completion-2026-10-08/mechanics/heavy-platform-pass-source-proposal.json'
if pass_proposal.exists():
 p=json.loads(pass_proposal.read_text())['row']
 if any(row['id']==p['id'] for row in rows):
  add(p['id'].split('.',1)[1],'super_lift_fall','super_lift_fall',p['entry_state']+'; '+p['input'],
      'Character.tickDonkeyKongHeavyCarry source down-flick + real passable support → existing drop-through collision mask')
  contracts[p['id'].split('.',1)[1]]['source_fidelity_limits']=['Native SuperLiftPass uses captured fall drawing; selected project9-step platform-mask clearance remains authored','Actual heavy platform pass match evidence pending']
assert set(contracts)=={r['id'].split('.',1)[1] for r in rows}, sorted(set(r['id'].split('.',1)[1] for r in rows)-set(contracts))
for key in ['tech-wall','tech-wall-jump','tech-ceiling','footstool-ground','footstool-air','footstool-jump','footstool-mini-jump']:
 contracts[key]['runtime_entry_route']='Actual MatchScene keyboard input/real Matter contact or combined footstool resolver → Character DK contextual owner → donkeyKongBodyCandidate'
 contracts[key]['source_fidelity_limits']={
  'tech-wall':['Native wall status cancel0 remains unknown;25-step commitment is explicitly authored from captured DK clip extent','Common11/40 input-window drain/lockout and frozen renewal policy is an explicit gameplay-clock adapter'],
  'tech-wall-jump':['Source no-lag/no-intangibility uses one committed entry event;40 samples retain actionable source drawing','Native scalar entry-speed consumer is explicitly adapted at5px/unit'],
  'tech-ceiling':['Native ceiling speed basis unknown;incoming horizontal speed clamped to±5 is authored beta'],
  'footstool-ground':['Source StepPose status cancel0 unknown;shared9-step recipient commitment remains explicit beta','Backward StepPoseBack branch still requires dedicated entry mapping'],
  'footstool-air':['StepPoseAir drawing7 then StepFall;source recovery36 consumed'],
  'footstool-jump':['Published repeat velocity.75,minimum nextfullspeed.5native and8-step cooldown consumed; accelerated native full-jump basis remains separate beta14.3055555556 calibration','Range add-width/add-height selection unresolved'],
  'footstool-mini-jump':['Source.7 impulse consumed;3-step release window is selected beta adapter;phantom contact disallows mini'],
 }[key]
contracts['footstool-ground']['unresolved_implementation']=['Backward recipient StepPoseBack entry branch is not yet selected']
contracts['full-hop']['source_fidelity_limits']=['Authored four-step post-Matter velocity curve fits source first-four rise93.5 and total170 within.001px; native common1–5 acceleration unrecovered','Ordinary totalgravity.425 replaces actual world dose; historical53-airtime calibration is not a native phase proof']
for key in ['short-hop','air-jump']:
 if key in contracts:contracts[key]['source_fidelity_limits']=['Published0F height-derived impulse and totalgravity.425 consumed; original common kinetic setup unavailable; exact integer apex differs by bounded discretization']
output=[]
for row in rows:
 c=contracts[row['id'].split('.',1)[1]];selector=c['native_motion_selector'];native=ml.get(selector) if selector else None
 c.update({'id':row['id'],'family':row['family'],'native_motion_files':[] if selector is None else None if not native else [a['name'] for a in native['animations']], 'native_motion_record_present':native is not None,
 'runtime_receiving_consumer':'Character.getActiveHurtboxes → selectDonkeyKongBodyReceiving → getDonkeyKongBodyDrawing(sheet, action age); same art-frame index selects hurtboxPoses. Missing paired metadata retains explicitly unaccepted baseline body.',
 'implemented_entry':len(c['unresolved_implementation'])==0,'accepted_visuals':False,'accepted_runtime_match':False,'complete':False})
 output.append(c)
data={'checked_on':'2026-10-08','character_id':'donkeykong','inventory_sha256':hashlib.sha256((BASE/'inventory.json').read_bytes()).hexdigest(),'action_count':len(output),'status':'source and runtime mapping; no visual/final-match acceptance implied','receiving_policy':'authored target-fit anatomical capsules; not native hit_data or native receiving parity','actions':output}
p=BASE/'audit-2026-10-08/runtime/action-mapping.json';p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(data,indent=2)+'\n');print(p)
