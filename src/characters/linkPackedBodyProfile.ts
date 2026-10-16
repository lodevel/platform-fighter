/**
 * Link's packed-body profile. The fresh Link art (assets/characters/link/frames.json, DK format, packed by
 * tools/fighter-pack.py and assembled by tools/link-build-final.py) has its clips keyed by the engine sheet name
 * where the clip plan chose one (idle, walk, jab, fair, fall_aerial...) and by the native motion file otherwise
 * (b00guard, e00catch...).
 *
 * Aliases are genuine same-motion aliases only: an engine sheet → the clip that plays the same native motion file
 * (Ultimate motion list, the same engine-sheet → motion mapping DK uses: tools/dk-runtime-action-map.py). A sheet
 * with no clip and no alias draws nothing (user decision 2026-10-14: missing pose = invisible, no fallback pose).
 */
import metadata from '../../assets/characters/link/frames.json';
import type { PackedBodyClip, PackedBodyProfile } from './packedBodyPresentation';

/** Engine sheet → drawn clip. Resolved only while the engine sheet has no clip of its own. */
export const LINK_SHEET_ALIASES: Readonly<Record<string, string>> = {
  // Final owner: the retained d04 clips are the same native motion named
  // final/final_air by the source status. This is presentation mapping only,
  // not a new ROOT/receiving/attachment qualification.
  final: 'd04final', final_air: 'd04finalair',
  // Locomotion (a01–a05).
  dash: 'a02dash', run: 'a02run', run_turn: 'a02turnrun', dash_turn: 'a02turndash',
  run_brake: 'a02runbraker', run_brake_left: 'a02runbrakel',
  crouch_start: 'a05squat', crouch: 'a05squatwait', crouch_end: 'a05squatrv',
  jumpsquat: 'a03jumpsquat',
  // Short hops play the full-hop motion (jump_f / jump_b); fast fall plays the fall motion.
  jump_short: 'jump', jump_short_b: 'jump_b', fall_fast: 'fall',
  landing_soft: 'a05landinglight', landing_hard: 'a05landingheavy',
  // Air-dodge landing lag is the special-fall landing motion (LandingFallSpecial).
  landing_air_dodge: 'a04landingfallspecial',
  // Match entry: the left-side entry plays the right motion facing the other way (as the taunts do).
  entry_r: 'j00entryr', entry_l: 'entry_r',
  // Defence (b00–b02). The directional air dodges play the one escape_air motion.
  shield: 'b00guard', shield_end: 'b00guardoff', shield_hit: 'b01guarddamage', parry: 'b00justshieldoff',
  shield_break: 'f06furafura', roll: 'b02escapef', roll_back: 'b02escapeb',
  air_dodge_up: 'air_dodge', air_dodge_up_diagonal: 'air_dodge', air_dodge_horizontal: 'air_dodge',
  air_dodge_down_diagonal: 'air_dodge', air_dodge_down: 'air_dodge',
  // Damage, downs and techs (f00–f06, g03).
  hurt: 'f00damagen1', hurt_air: 'f01damageair1', tumble: 'f01damageflyn',
  down_wait: 'f03downwaitu', down_wait_face_down: 'f04downwaitd',
  getup: 'f03downstandu', getup_face_down: 'f04downstandd',
  getup_roll: 'f03downforwardu', getup_roll_face_down: 'f04downforwardd',
  getup_roll_back: 'f03downbacku', getup_roll_back_face_down: 'f04downbackd',
  getup_attack: 'f03downattacku', getup_attack_face_down: 'f04downattackd',
  trip: 'g03slip', trip_attack: 'g03slipattack',
  tech: 'f05passive', tech_forward: 'f05passivestandf', tech_back: 'f05passivestandb',
  tech_wall: 'f05passivewall', tech_wall_jump: 'f05passivewalljump', tech_ceiling: 'f05passiveceil',
  // Ledge (g01–g02).
  ledge_catch: 'g01cliffcatch', ledge: 'g01cliffwait', ledge_getup: 'g02cliffclimb', ledge_roll: 'g02cliffescape',
  ledge_attack: 'g02cliffattack', ledge_jump: 'g02cliffjump1',
  // Grab, throws, captured (e00–e03).
  grab: 'e00catch', dash_grab: 'e00catchdash', pivot_grab: 'e00catchturn', grab_pull: 'e00catchpull',
  grab_hold: 'e00catchwait', pummel: 'e00catchattack', grab_escape: 'e00catchcut',
  fthrow: 'e01throwf', bthrow: 'e01throwb', uthrow: 'e01throwhi', dthrow: 'e01throwlw',
  captured: 'e02capturewaithi', captured_hit: 'e02capturedamagehi', captured_release: 'e03capturecut',
  // Bury: no bury motion in the motion list. SmashWiki Buried: fighters are buried upright (the standing wait drawing,
  // sunk by the renderer: buriedPresentation.ts) and the bury ending makes them jump (same rule as DK).
  buried: 'idle', buried_escape: 'jump',
  // Results screen (j02): the three victories, their waits and the loss.
  win_1: 'j02win1', win_1_wait: 'j02win1wait', win_2: 'j02win2', win_2_wait: 'j02win2wait',
  win_3: 'j02win3', win_3_wait: 'j02win3wait', lose: 'j02lose',
  // Taunts (j01): the left-facing taunts play the right motion.
  taunt_up_r: 'j01appealhir', taunt_side_r: 'j01appealsr', taunt_down_r: 'j01appeallwr',
  taunt_up_l: 'taunt_up_r', taunt_side_l: 'taunt_side_r', taunt_down_l: 'taunt_down_r',
  // Specials: the phase motion each intrinsic controller routes (linkIntrinsicPresentation.ts → PackedBodyState.intrinsic).
  // Bow: draw (start, which also carries the charge windup), full-charge hold (loop) and release (end).
  special_n_start: 'd00specialnstart', special_air_n_start: 'd00specialairnstart',
  special_n: 'd00specialnloop', special_air_n: 'd00specialairnloop',
  special_n_end: 'd00specialnend', special_air_n_end: 'd00specialairnend',
  // The retained native motion_list.yml assigns the failed/blank throw to
  // exactly the same body file as the normal throw. Its game callbacks still
  // emit no new article; missing this alias made Link disappear on repeat B.
  special_s1: 'd01specials1', special_air_s1: 'd01specialairs1', special_s2: 'd01specials2', special_air_s2: 'd01specialairs2',
  special_s1_blank: 'd01specials1', special_air_s1_blank: 'd01specialairs1',
  // Spin Attack: ground charge start / hold / release and the aerial spin.
  special_hi_start: 'd02specialhistart', special_hi_hold: 'd02specialhihold', special_hi: 'd02specialhi', special_air_hi: 'd02specialairhi',
  // Remote Bomb pull and detonation.
  special_lw: 'd03speciallw', special_air_lw: 'd03specialairlw', special_lw_blast: 'd03speciallwblast', special_air_lw_blast: 'd03specialairlwblast',
  // Items (h00–h12). Item swings that share a native file already resolve through itemMotionClip.
  item_carry: 'a00waititem', item_pickup_stand: 'h00lightget', item_pickup_walk: 'h00lightwalkget',
  item_light_eat: 'h00lighteat', item_light_walk_eat: 'h00lightwalkeat',
  item_throw_dash: 'h01lightthrowdash', item_throw_drop: 'h01lightthrowdrop',
  ...Object.fromEntries(['f', 'b', 'hi', 'lw'].flatMap(d => [
    [`item_throw_${d}`, `h01lightthrow${d}`], [`item_throw_air_${d}`, `h02lightthrowair${d}`],
    [`item_heavy_throw_${d}`, `h03heavythrow${d}`],
    // Strong (smash) throws play the same light / heavy throw motion.
    [`item_throw_${d}4`, `item_throw_${d}`], [`item_throw_air_${d}4`, `item_throw_air_${d}`],
    [`item_heavy_throw_${d}4`, `item_heavy_throw_${d}`]])),
  item_heavy_get: 'h03heavyget',
  item_bat_swing_1: 'h04swing1', item_bat_swing_3: 'h04swing3', item_bat_swing_4: 'h06swing4bat',
  item_bat_swing_dash: 'h04swingdash', item_sword_swing_4: 'h04swing4', item_sword_swing_4_hold: 'h04swing4charge',
  item_hammer_wait: 'h05itemhammerwait', item_hammer_move: 'h05itemhammermove', item_hammer_jump: 'h05itemhammerair',
  item_lgun_shoot: 'h11itemshoot', item_lgun_shoot_air: 'h11itemshootair', item_lgun_shoot_upper: 'h11itemshootupper',
  item_fflower_shoot_loop: 'h11itemshootloop', item_fflower_shoot_air_loop: 'h11itemshootairloop',
  item_fflower_shoot_loop_upper: 'h11itemshootloopupper',
  item_shoot_legs_jump_squat: 'h10itemlegsjumpsquat', item_shoot_legs_landing: 'h10itemlegslanding',
  item_shoot_legs_walk_f: 'h10itemlegswalkf', item_shoot_legs_walk_b: 'h10itemlegswalkb',
  ...Object.fromEntries(['start', 'wait', 'fire', 'rapid', 'end'].flatMap(p => [
    [`item_scope_${p}`, `h12itemscope${p}`], [`item_scope_${p}_upper`, `h12itemscope${p}upper`]])),
  ...Object.fromEntries(['start', 'fire', 'rapid', 'end'].map(p => [`item_scope_air_${p}`, `h12itemscopeair${p}`])),
  item_scope_fall: 'h12itemscopefall',
};

/** Per-aerial landing lag motions (c05landingair*). */
const LINK_AERIAL_LANDING: Readonly<Record<string, string>> = {
  'link.nair': 'landing_air_n', 'link.fair': 'landing_air_f', 'link.bair': 'landing_air_b',
  'link.uair': 'landing_air_hi', 'link.dair': 'landing_air_lw',
};

export const LINK_BODY_PROFILE: PackedBodyProfile = {
  id: 'link', label: 'Link',
  // Article sheets (fx__*) carry null native samples; the body never selects them.
  clips: metadata.animations as unknown as Record<string, PackedBodyClip>,
  sheetAliases: LINK_SHEET_ALIASES,
  missingSheet: 'invisible',
  bodyCentreFromRootY: -36,
  // Forward smash's second swing plays its own motion (attack_s4_s2); the driver names both swings `smash`.
  attackSheet: (sheet, a) => a.move.id === 'link.smash2' ? 'smash2' : sheet,
  aerialLandingSheet: moveId => (moveId && LINK_AERIAL_LANDING[moveId]) || 'landing_aerial',
  // Link's only special fall is the aerial Spin Attack.
  specialLandingSheet: () => 'a04landingfallspecial',
};
