/** Donkey Kong's packed-body profile: the data packedBodyPresentation.ts needs to draw DK. */
import metadata from '../../assets/characters/donkeykong/frames.json';
import type { PackedBodyClip, PackedBodyProfile } from './packedBodyPresentation';

/** Runtime keys whose art is queued (rework 2026-10-10). Until a key is installed in
 * frames.json it resolves (transitively) to the installed equivalent, so presentation never
 * requests a missing texture. */
const DONKEYKONG_SHEET_ALIASES:Readonly<Record<string,string>>={
  fall_b:'fall',fall_aerial:'fall',fall_aerial_f:'air_drift',fall_aerial_b:'fall_b',
  jump_b:'jump',jump_short_b:'jump_short',airjump_b:'airjump',
  // No dedicated aerial-landing-lag drawing yet: the heavy landing reads as the lag, not a crouch.
  landing_aerial:'landing_hard',
  // Defense art: the directional air dodges and the parry share the one drawn motion (cells.json aliases).
  air_dodge_up:'air_dodge',air_dodge_up_diagonal:'air_dodge',air_dodge_horizontal:'air_dodge',
  air_dodge_down_diagonal:'air_dodge',air_dodge_down:'air_dodge',landing_air_dodge:'landing_soft',
  // Giant Punch: the Max motions share the partial punch drawings; the entry (start), full-bank end and
  // jump-cancel motions are not drawn yet and hold the charge / cancel drawings.
  neutral_special_full:'neutral_special',neutral_special_full_air:'neutral_special_air',
  neutral_special_start:'neutral_special_charge',neutral_special_air_start:'neutral_special_air_charge',
  neutral_special_end:'neutral_special_charge',neutral_special_air_end:'neutral_special_air_charge',
  neutral_special_jump_cancel:'neutral_special_cancel',neutral_special_air_jump_cancel:'neutral_special_air_cancel',
  // Grabs/throws/cargo art: the airborne cargo throws share the grounded throw drawings (cells.json aliases).
  cargo_fthrow_air:'cargo_fthrow',cargo_bthrow_air:'cargo_bthrow',cargo_uthrow_air:'cargo_uthrow',cargo_dthrow_air:'cargo_dthrow',
  // Ledge/recovery art: variants without their own drawing share the installed motion (cells.json aliases): a hit in the air
  // reads as the same damage motion, the mini footstool jump key, and face-down / backward get-up rolls.
  hurt_air:'hurt',footstool_jump:'footstool_jump_mini',getup_face_down:'getup',getup_roll_face_down:'getup_roll',
  getup_roll_back:'getup_roll',getup_roll_back_face_down:'getup_roll',
  // Items/taunts art: strong throws and left taunts share the one drawn motion (cells.json aliases); item swings that
  // share a native file resolve through itemMotionClip (src/items/itemMotionClips.ts).
  ...Object.fromEntries(['f','b','hi','lw'].flatMap(d=>[[`item_throw_${d}4`,`item_throw_${d}`],[`item_throw_air_${d}4`,`item_throw_air_${d}`],
    [`item_heavy_throw_${d}4`,`item_heavy_throw_${d}`]])),
  taunt_up_l:'taunt_up_r',taunt_side_l:'taunt_side_r',taunt_down_l:'taunt_down_r',
  // Bury: DK's motion list has no bury motion. SmashWiki Buried: "Fighters are normally buried upright" (the standing wait
  // drawing, sunk by the renderer: buriedPresentation.ts) and the bury ending "causes them to automatically jump".
  buried:'idle',buried_escape:'jump'};

export const DONKEYKONG_BODY_PROFILE:PackedBodyProfile={
  id:'donkeykong',label:'DK',
  clips:metadata.animations as Record<string,PackedBodyClip>,
  sheetAliases:DONKEYKONG_SHEET_ALIASES,
  // DK's remaining 256 px clips (no root / native timing) keep the generic classifier path.
  missingSheet:'generic',
  bodyCentreFromRootY:-42,
  /** DK's aerial Spinning Kong is the base up special (no sheetVariant); its drawings are `up_special_air`.
   * A spin that lands before special fall continues on the grounded variant at SpecialHi frame 63
   * (`groundedLandingFrame`), so the clip plan's `up_special_ground_land` is `up_special_ground`'s
   * tail (drawings native 62/75/88/102) on the action clock, not a separate key. A Giant Punch with 111
   * banked charge steps is the Max punch. */
  attackSheet:(sheet,a)=>a.move.id==='donkeykong.neutral_special'&&(a.chargeHeldFrames??0)>=111
    ?`neutral_special_full${a.move.sheetVariant==='air'?'_air':''}`:sheet==='up_special'?'up_special_air':sheet,
  attackPilots:{
    'donkeykong.jab':{sheet:'review_pilot_jab1_contact',age:4},
    'donkeykong.jab2':{sheet:'review_pilot_jab2_contact',age:3},
    'donkeykong.dtilt':{sheet:'review_pilot_dtilt_contact',age:5}},
  grabPilots:{
    standing:{sheet:'review_pilot_standing_grab_contact',age:7,nativeSample:8},
    dash:{sheet:'review_pilot_dash_grab_contact',age:10,nativeSample:11},
    pivot:{sheet:'review_pilot_pivot_grab_contact',age:11,nativeSample:12}},
  /** Hand Slap's own landing, otherwise landing_fall_special (DK's only special fall is Spinning Kong). */
  specialLandingSheet:moveId=>moveId==='donkeykong.down_special'?'down_special_air_land':'up_special_air_land',
};
