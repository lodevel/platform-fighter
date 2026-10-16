import { projectCornerAnchoredLedgeRoot, type LedgeRootPoint } from './ledgeRootMotionSchema';

/**
 * Donkey Kong ledge attack (CliffAttack) root motion, ages 0–54 (SmashWiki DK/Edge_attack:
 * "Interruptible 56", hitbox 23–25; UFD total 55).
 *
 * Source: the native `Trans` bone of g02cliffattack.nuanmb, samples 0..54, as [Y, Z] native
 * units (assets/gen/dk-native-reference/raw-motion/fighter/donkey/motion/body/c00/
 * g02cliffattack.nuanmb, sha256 04d236bba0b015f22d49abbec586cb69e9c9e6bfeeb4e7290c7fa3f260c28555,
 * evaluated with tools/dk_native_pose.py). Native Y is up, Z is forward.
 *
 * Projection (same corner-anchored adapter as Pikachu's): x = 5·Z px forward of the corner, the
 * exact native horizontal path (−18.1 px at the start; DK's hang body rests ~30 px outside the
 * corner). Vertically the engine hangs DK with his body bottom one body height (84 px) under the
 * corner, while the native hang root sits 27.25 u (136 px) under it, so the native rise is scaled
 * onto the hang depth: y = 84·Y/Y₀ px under the corner. DK stands on the stage from native
 * sample 16 (Y = 0).
 */
const NATIVE_CLIFF_ATTACK_TRANS_YZ: readonly (readonly [number, number])[] = [
  [-27.25, -3.6199], [-25.1655, -3.6198], [-21.4432, -3.6196], [-18.1385, -3.6192], [-15.7753, -3.6188],
  [-13.7955, -3.6182], [-11.8207, -3.6177], [-9.881, -3.6171], [-8.0131, -3.6165], [-6.2539, -3.6159],
  [-4.6399, -3.6122], [-3.2079, -3.2868], [-1.9947, -2.4925], [-1.0369, -1.3228], [-0.3713, 0.1285],
  [-0.0345, 1.768], [0, 3.5021], [0, 5.2371], [0, 6.8796], [0, 8.3358], [0, 9.5124], [0, 10.3156],
  [0, 10.6518], [0, 10.6569], [0, 10.6575], [0, 10.6579], [0, 10.6582], [0, 10.6586], [0, 10.6588],
  [0, 10.6591], [0, 10.6594], [0, 10.6596], [0, 10.6599], [0, 10.6603], [0, 10.6607], [0, 10.6613],
  [0, 10.6619], [0, 10.6626], [0, 10.6635], [0, 10.7278], [0, 10.9091], [0, 11.1927], [0, 11.5639],
  [0, 12.0083], [0, 12.511], [0, 13.0576], [0, 13.6333], [0, 14.2235], [0, 14.8003], [0, 15.3144],
  [0, 15.7652], [0, 16.1558], [0, 16.4893], [0, 16.7685], [0, 16.9964],
];

/** DK's latched body bottom under the ledge corner: one body height (DONKEYKONG_TUNING.height). */
const DK_HANG_DEPTH_PX = 84;

export const DONKEYKONG_LEDGE_ATTACK_ROOT_MOTION: readonly LedgeRootPoint[] =
  projectCornerAnchoredLedgeRoot(NATIVE_CLIFF_ATTACK_TRANS_YZ, DK_HANG_DEPTH_PX);
