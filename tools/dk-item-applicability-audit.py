"""Retain additional DK item applicability proposals; never edits root inventory."""
import hashlib
import json
import re
from pathlib import Path
import yaml

BASE = Path('docs/review/2026-09-25/donkeykong-character/completion-2026-10-08/mechanics')
MOTION = Path('docs/review/2026-10-06/dk-all-attack-values/sources/motion-list.yml')
motions = yaml.safe_load(MOTION.read_text())['list']
pins = json.loads((BASE / 'sources/items/weapon-actual-scripts-verified.json').read_text())
pins += [p for p in json.loads((BASE / 'sources/items/weapon-heavy-verified.json').read_text()) if 'sha256' in p]
pins = {p['script']: p for p in pins}

def record(path):
    p = Path(path)
    result = {'path': str(p), 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()}
    wiki_urls = {'wiki-item.html':'https://www.ssbwiki.com/Item',
      'wiki-home-run-bat.html':'https://www.ssbwiki.com/Home-Run_Bat',
      'wiki-ray-gun.html':'https://www.ssbwiki.com/Ray_Gun',
      'wiki-fighter-ability.html':'https://www.ssbwiki.com/Fighter_ability'}
    if p.name in wiki_urls: result['url'] = wiki_urls[p.name]
    if p.suffix == '.json':
        source = json.loads(p.read_text())
        if isinstance(source, dict):
            for field in ['url','revision']:
                if field in source:result[field]=source[field]
    return result

def row(identifier, action, motion=None, script=None, source=None, status='missing', **kwargs):
    records = [record(MOTION), record(BASE / 'sources/native-fighter-donkey-items.json')]
    if script:
        records.append(pins[script])
    if source:
        records.append(record(source))
    result = {'id': 'donkeykong.' + identifier, 'family': 'items', 'action': action,
      'entry_state': kwargs.pop('entry_state', 'Actionable, holding the named item; input edge and item identity captured once'),
      'input': kwargs.pop('input', 'Fresh declared item-use input; blocked during capture, hitstun, hitlag, ledge or other exclusive action'),
      'native_motion_selector': motion, 'native_motion_files': [a['name'] for a in motions[motion]['animations']] if motion else [],
      'native_motion_flags': motions[motion]['flags'] if motion else None,
      'native_motion_extra': motions[motion]['extra'] if motion else None,
      'native_motion_record': motions[motion] if motion else None,
      'source_records': records, 'sources': records,
      'source_urls': [p['url'] for p in records if 'url' in p],
      'implementation': status, 'accepted_visuals': False, 'accepted_runtime_match': False}
    result.update(kwargs)
    return result

catch_source = BASE / 'sources/research-native-item-catch-web.json'
catch_rows = []
for ident, action, context, window, underlying in [
    ('item-catch-air', 'Stationary airborne item catch', 'air-stationary', 1, 'current jump/fall'),
    ('item-catch-aerial', 'Catch while entering an aerial', 'aerial', 4, 'selected aerial'),
    ('item-catch-air-dodge', 'Catch while entering an air dodge', 'air-dodge', 5, 'selected neutral/directional air dodge'),
    ('item-pickup-dash-attack', 'Catch while entering dash attack', 'dash-attack', 5, 'dash_attack'),
    ('item-pickup-tilt', 'Catch while entering tilt attack', 'tilt', 2, 'selected forward/up/down tilt')]:
    airborne = context.startswith('air') or context == 'aerial'
    catch_rows.append(row(ident, action, source=catch_source,
      entry_state=('Airborne' if airborne else 'Grounded') + ' empty hand, holdable item acquisition rectangles overlap',
      input='Air stationary: fresh grab while actionable; attack/dodge routes: a fresh action entry starts its finite catch window. No held input refresh.',
      source_context=context, source_acceptance_human_frames=[1, window], runtime_acceptance_age=[0, window],
      source_event='Catch commits at actual overlap inside the acceptance window; ground standing/walking pickup alone commits callback2.',
      body_contract={'preserve_underlying_action': underlying, 'new_pickup_motion': False,
        'grip': 'Reviewed current posed target hand/socket, separately from raw native grip offsets'},
      source_limits=['Original research selects aerial1–4; generic SmashWiki Item says5. Native common selector body unavailable; conflict retained.',
        'Pickup rectangle anchoring/full-height interpretation and item-side rectangle require an explicit 2D fit;64px proximity is authored, not these native ranges.',
        'Airborne heavy items cannot be acquired by this ordinary light-item catch route.',
        'Simultaneous contested item: original research lowest player index wins; nearest same-player candidate ordering remains target adapter.']))

weapon_rows = []
current_specs = {
    'bat': ('Bat', 'item.bat.swing', ['jab', 'tilt', 'smash'], [4,4,10],14),
    'sword': ('Sword', 'item.sword.slash', ['jab', 'tilt', 'smash'], [5,3,9],11),
    'hammer': ('Hammer', 'item.hammer.smash', ['jab', 'tilt', 'smash'], [14,4,18],22),
    'spear': ('Spear', 'item.spear.thrust', ['jab', 'tilt'], [6,3,8],9),
    'raygun': ('RayGun', 'item.rayGun.shot', ['jab'], [4,3,10],10),
    'bomb': ('Bomb', 'item.bomb.detonate', ['jab'], [6,4,14],18),
}
for item, (filename, attack, slots, phases, damage) in current_specs.items():
    for situation, slot in [('ground', s) for s in slots] + [('air', 'use')]:
        suffix = {'jab':'1', 'tilt':'3', 'smash':'4', 'use':'1'}[slot]
        motion = script = None
        if item in ('bat', 'sword'):
            motion = f'item_{item}_swing_{suffix}'
            script = filename + 'Swing' + suffix
        elif item == 'raygun':
            motion = 'item_lgun_shoot' + ('_air' if situation == 'air' else '')
            script = 'LGunShoot' + ('Air' if situation == 'air' else '')
        source = BASE / ('sources/wiki-home-run-bat.html' if item == 'bat' else 'sources/wiki-ray-gun.html' if item == 'raygun' else 'sources/wiki-item.html')
        r = row(f'item-{item}-{situation}-{slot}', f'{item} {situation} {slot}', motion, script, source,
          status='Existing authored attack executes; distinct declared ground slot input/body/equipment acceptance pending',
          item_type=item, authored_attack_id=attack, declared_slot='jab' if slot == 'use' else slot,
          authored_attack={'startup':phases[0], 'active':phases[1], 'recovery':phases[2], 'damage':damage,
            'source':record(Path('src/items') / (filename + '.ts'))},
          input=('Fresh primary item attack in the air regardless of direction, as explicitly requested earlier by the user' if situation == 'air'
            else 'Fresh declared grounded ' + slot + ' item input; shield+attack remains the separate sourced toss request'),
          source_limits=['Existing item-specific attack damage, launch, durability, projectile/explosion physics and commitment are intentionally preserved project behavior.',
            'Pose timelines must fit the authored attack contacts; playing the native motion at rate1 would misalign existing attack startup/active/recovery.',
            'Native weapons replace neutral/forward tilt/dash/forward smash only. Generic project tilt/smash slots across all axes are an explicit adapter.',
            'Airborne melee swing body is an authored adaptation; DK has no separate native air Bat/Sword swing clip.',
            'Custom Sword/Hammer/Spear/Bomb identities are not native Beam Sword/Hammer/Bob-omb parity. Synthetic Bomb primary use detonates in hand; grab or shield+attack tosses.'])
        if script:
            text = Path(pins[script]['path']).read_text()
            game = text.split('unsafe extern "C" fn')[1]
            frame = 0; events=[]
            for line in game.splitlines():
                found = re.search(r'frame\(agent.lua_state_agent, ([\d.]+)\)',line)
                if found: frame=float(found[1])
                if any(k in line for k in ['game_Bat','game_Sword','SHOOT_ITEM_BULLET','clear_all','START_SMASH_HOLD','SEARCH(','shield(']):
                    events.append({'native_frame':frame, 'command':line.strip()})
            r['native_events'] = events
            r['native_common_attack_parameters'] = 'Common callback definitions unavailable; DK wrapper alone does not contain complete item ATTACK values.'
        else:
            r['motion_reference_applicability'] = 'Authored target-specific item action; no selected native weapon counterpart claimed'
        weapon_rows.append(r)

native_weapon_branches = []
for ident, motion, script, action in [
    ('item-bat-dash', 'item_bat_swing_dash','BatSwingDash','Native bat dash swing'),
    ('item-sword-dash','item_sword_swing_dash','SwordSwingDash','Native sword dash swing reference for custom Sword'),
    ('item-sword-charge','item_sword_swing_4_hold','SwordSwing4Charge','Native sword smash hold reference for custom Sword'),
    ('item-raygun-walk-forward','item_shoot_legs_walk_f','ItemLegsWalkF','Walk forward during raygun upper-body fire'),
    ('item-raygun-walk-back','item_shoot_legs_walk_b','ItemLegsWalkB','Walk backward during raygun upper-body fire'),
    ('item-raygun-jump-squat','item_shoot_legs_jump_squat','ShootLegsJumpSquat','Raygun firing jump squat lower-body branch'),
    ('item-raygun-landing','item_shoot_legs_landing','ShootLegsLanding','Raygun firing landing lower-body branch')]:
    native_weapon_branches.append(row(ident,action,motion,script,BASE/'sources/wiki-item.html',
      source_limits=['Applicable source branch requires explicit selector/consumer and authored-item timing/body reconciliation. No behavior acceptance inferred from resource existence.',
        'Native cancel0 is status-owned, not zero commitment; lower-body layer must coexist with item_lgun_shoot_upper.']))

heavy_rows = []
for motion in [k for k in motions if k.startswith('super_lift_') or k.startswith('item_heavy_')]:
    script = None
    if motion == 'item_heavy_get':script='ItemHeavyGet'
    elif motion.startswith('item_heavy_throw_'):
        suffix=motion.removeprefix('item_heavy_throw_')
        script='ItemHeavyThrow'+{'f':'F','b':'B','hi':'Hi','lw':'Lw','f4':'F4','b4':'B4','hi4':'Hi4','lw4':'Lw4'}[suffix]
    else:
        guess='SuperLift'+''.join(s.title() for s in motion.removeprefix('super_lift_').split('_'))
        if guess in pins:script=guess
    heavy_rows.append(row('heavy-'+motion.replace('_','-'),motion,motion,script,BASE/'sources/wiki-fighter-ability.html',
      entry_state='A real heavy item such as Crate/Barrel; ordinary six-item spawn roster has no heavy classification',
      input='DK can walk, jump and retain heavy item when falling from ledge; cannot dash or Z-drop; four directions and ordinary/strong throws',
      status='Missing applicable engine heavy-item framework; not non-applicable',
      source_limits=['DK-specific heavy-item resistance includes small armor per technical Wiki; exact native armor threshold/common kinetic/action exits remain unsourced.',
        'Pickup callback5/cancel25 and heavy throws are distinct from light-item callbacks.',
        'Native item_lift accel multiplier/add/maximum retained; available parameters alone do not prove the actual common movement formula.',
        'No automatic classification of authored Hammer/Spear as native heavy items.']))

contract = {'checked':'2026-10-08','scope':'Proposals only; root owns inventory merging. Existing171 rows are not a full native-item-parity denominator.',
  'air_and_ground_startup_catch_rows':catch_rows, 'supported_six_item_use_rows':weapon_rows,
  'additional_native_weapon_branch_rows':native_weapon_branches,'missing_heavy_item_rows':heavy_rows,
  'counts':{'catch':len(catch_rows),'supported_item_use':len(weapon_rows),'native_weapon_branches':len(native_weapon_branches),'heavy':len(heavy_rows)},
  'source_acquisition_correction':'Initial ItemBatSwing/ItemSwordSwing/ItemLGunShoot guesses404 were filename errors. Correct BatSwing/SwordSwing/LGunShoot captures now pinned; no source-absence claim.',
  'empty_gun_applicability':{'native_resources':[k for k in motions if k.startswith('item_lgun') and 'empty' in k],
    'source_status_rule':'Ultimate technical Wiki says attack with empty shooting item tosses it; retained empty animation resources alone do not prove ordinary empty firing is applicable.',
    'current_adapter':'Authored6-use RayGun breaks after last successful shot. Empty item retention/automatic toss is an explicit source gap, not current supported fire.',
    'proposal':'Attach source empty-gun auto-toss condition to existing item throw rows if native ammo retention is later adopted. Do not create six duplicate blank-fire rows by resource count.'},
  'other_native_families':'Other rod/star/fireflower/scope/cracker/staff/etc item families remain missing or applicability unresolved; not all156 residual motion entries are applicable to the current six custom items.',
  'native_throw_offset_semantics':{'raw_arguments':'Retained exactly per callback','common_consumer':'Only Lua wrappers recovered; root/facing/height semantics not independently proven',
    'target_release':'Reviewed posed hand/socket when available is target adaptation. Static32/−4 fallback is authored, never native parity.'},
  'integration_remaining':['Catch/repeat helper consumed by actual Character/Scene with rectangles and events, preserving underlying action.','Distinct supported ground item slots must reach input selector while preserving airborne primary use.','Dedicated item body/equipment/active contact fit, real projectiles/explosions and durability interrupts.','Native weapon/common/item-specific parity limits retained, not hidden by unit tests.']}
(BASE/'item-additional-context-proposals.json').write_text(json.dumps(contract,indent=2)+'\n')
print(json.dumps(contract['counts']))

if '--merge-context' in __import__('sys').argv:
    context_path = BASE / 'context-row-source-proposals.json'
    ledger = json.loads(context_path.read_text())
    prior_ids = {r['id'] for r in ledger['proposals']}
    additions = []
    for group in [catch_rows, weapon_rows, native_weapon_branches, heavy_rows]:
        for original in group:
            proposal = dict(original)
            native = proposal['native_motion_record']
            proposal['native_motion_fields'] = {field:native[field] for field in ['blend_frames','flags','extra']} if native else None
            proposal['fidelity_limits'] = proposal.pop('source_limits', [])
            proposal['source_contract_only'] = True
            if original in catch_rows:
                proposal['runtime_route'] = 'MatchScene DK startup catch selector → current Character action age + item pickup rectangles → inventory commit; preserve underlying body (integration pending)'
                proposal['source_fidelity'] = 'Published original catch-window research and native fighter ranges; common selector, geometry projection and aerial-window conflict explicit'
            elif original in weapon_rows:
                proposal['runtime_route'] = 'Character DK held-item input slot → existing authored ItemDefinition attack → dedicated adapted DK body/posed item socket and contact (integration pending)'
                proposal['source_fidelity'] = 'Project item attack/air-use behavior preserved; native DK bat/sword/gun resource is a motion reference where identified, not copied item damage/physics'
            elif original in native_weapon_branches:
                proposal['runtime_route'] = 'DK held-weapon source context selector → layered/native referenced body + existing authored item attack; dedicated consumer missing'
                proposal['source_fidelity'] = 'Applicable native DK motion/context; custom equipment behavior/timing adaptation and common status consumer unresolved'
            else:
                proposal['runtime_route'] = 'Heavy item classification/reservation → DK super-lift status/kinetics/body → heavy pickup/throw events; engine framework missing'
                proposal['source_fidelity'] = 'Applicable DK-specific native capability and resources; heavy item framework, common clocks/armor/kinetics remain missing'
            additions.append(proposal)
    new_ids = {r['id'] for r in additions}
    if len(new_ids) != 49:raise ValueError('Expected49 independent additional item IDs')
    retained = [r for r in ledger['proposals'] if r['id'] not in new_ids]
    if len(retained) != 90:raise ValueError('Expected90 previously reconciled context rows')
    # Preserve every prior generic item and all coordinator corrections.
    if 'donkeykong.item-carry' not in prior_ids:raise ValueError('Generic item-carry/use contract missing')
    ledger['proposals'] = retained + additions
    ledger['proposal_count'] = len(ledger['proposals'])
    ledger['inventory_count_before_additional_item_expansion'] = 171
    ledger['inventory_count'] = 220
    ledger['additional_item_expansion'] = {'new_rows':49,'scope':'Root-authorized evidence normalization; canonical import belongs root',
      'groups':contract['counts'],'preserved_prior_generic_item_contract':'donkeykong.item-carry',
      'preserved_primary_behavior':'All six authored item attacks including in-hand Bomb detonation; airborne item use remains user-required project adapter',
      'heavy':'Applicable and missing, never N/A','canonical_import_pending':True}
    ledger['scope'] = '139 normalized contextual proposals plus81 combat rows for proposed220 canonical actions. Source, implementation, visual and match acceptance remain independent.'
    context_path.write_text(json.dumps(ledger,indent=2)+'\n')
    print('Normalized139 context proposals; preserved prior90 unchanged')
