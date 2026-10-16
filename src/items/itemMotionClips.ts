/**
 * Native item motions that play the same animation file as another item motion, so they share one drawn clip
 * (docs/review/2026-10-11/ultimate-items/art/item-clips.json `already_installed_aliases`; the motion lists name the
 * file: item_bat/sword/starrod_swing_1/_3/_dash = h04swing1/3/dash, item_sword/starrod_swing_4(_hold) =
 * h04swing4(charge), item_lgun/fflower_shoot(_upper/_air) = the gun shot files). An item use names its native motion
 * (`AttackMove.itemClip`); every fighter draws it with the clip resolved here. Fighter-independent: DK and Pikachu
 * group the files identically.
 */
const SHARED_FILE_CLIP: Readonly<Record<string, string>> = Object.freeze({
  item_sword_swing_1: 'item_bat_swing_1', item_starrod_swing_1: 'item_bat_swing_1',
  item_sword_swing_3: 'item_bat_swing_3', item_starrod_swing_3: 'item_bat_swing_3',
  item_sword_swing_dash: 'item_bat_swing_dash', item_starrod_swing_dash: 'item_bat_swing_dash',
  item_starrod_swing_4: 'item_sword_swing_4', item_starrod_swing_4_hold: 'item_sword_swing_4_hold',
  item_fflower_shoot: 'item_lgun_shoot', item_fflower_shoot_upper: 'item_lgun_shoot_upper',
  item_fflower_shoot_air: 'item_lgun_shoot_air', item_fflower_shoot_aerial: 'item_lgun_shoot_air',
});

/** The drawn clip of a native item motion. */
export function itemMotionClip(motion: string): string {
  return SHARED_FILE_CLIP[motion] ?? motion;
}

/** The drawn clip of a chargeable item use's hold loop (native `<swing>_hold`). */
export function itemChargeClip(motion: string): string {
  return itemMotionClip(`${motion}_hold`);
}
