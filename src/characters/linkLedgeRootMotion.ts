import { projectCornerAnchoredLedgeRoot, type LedgeRootPoint } from './ledgeRootMotionSchema';

/**
 * Link ledge attack (CliffAttack) root motion, ages 0–54 (SmashWiki Link (SSBU)/Edge attack:
 * "Interruptible 56", "Animation length 55"; hitbox 20–22).
 *
 * Source: the native `Trans` bone of g02cliffattack.nuanmb, samples 0..54, as [Y, Z] native units
 * (assets/gen/link-native-reference/extracted/fighter/link/motion/body/c00/g02cliffattack.nuanmb,
 * sha256 47239cec5697d082c7a578006729e173385e4385aef9520ab80dbda08b5b436a, evaluated with
 * tools/link_native_pose.py). Native Y is up, Z is forward.
 * Link's native hang root sits 19.67 u under the corner and he stands on the stage from sample 11.
 * Projected onto the engine hang with the same corner-anchored adapter as DK's.
 */
const NATIVE_CLIFF_ATTACK_TRANS_YZ: readonly (readonly [number, number])[] = [
  [-19.6665, -2.6957], [-19.2765, -2.6959], [-18.6173, -2.6962], [-17.6817, -2.6964], [-16.4621, -2.6967],
  [-14.9511, -2.6969], [-13.1414, -2.6971], [-11.0254, -2.6974], [-8.025, -2.6977], [-4.3769, -2.698],
  [-1.2968, -2.6983], [0, -2.6984], [0, -2.6984], [0, -2.6984], [0, -2.6984],
  [0, -1.8169], [0, 0.3004], [0, 2.8628], [0, 6.2737], [0, 8.424],
  [0, 8.4041], [0, 8.3468], [0, 8.2554], [0, 8.1333], [0, 7.984],
  [0, 7.8108], [0, 7.6173], [0, 7.4066], [0, 7.1824], [0, 6.9479],
  [0, 6.7067], [0, 6.462], [0, 6.2173], [0, 5.976], [0, 5.7416],
  [0, 5.5173], [0, 5.3067], [0, 5.1131], [0, 4.94], [0, 4.7907],
  [0, 4.6686], [0, 4.5772], [0, 4.5199], [0, 4.5], [0, 4.5],
  [0, 4.5], [0, 4.5], [0, 4.5], [0, 4.5], [0, 4.5],
  [0, 4.5], [0, 4.5], [0, 4.5], [0, 4.5], [0, 4.5],
];

/** Link's latched body bottom under the ledge corner: one body height (LINK_TUNING.height; a
 * literal because linkFreshKit imports this module through the recovery-attack builder). */
export const LINK_HANG_DEPTH_PX = 72;

export const LINK_LEDGE_ATTACK_ROOT_MOTION: readonly LedgeRootPoint[] =
  projectCornerAnchoredLedgeRoot(NATIVE_CLIFF_ATTACK_TRANS_YZ, LINK_HANG_DEPTH_PX);
