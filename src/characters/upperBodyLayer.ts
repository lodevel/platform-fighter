/**
 * Upper-body layer (Ultimate shooting items): the native `_upper` motion is drawn above the fighter's waist line and
 * the `item_shoot_legs_*` drawing below it. A shared root does not imply a shared waist position in different poses.
 *
 * The line is the native `Hip` bone height (world px from the body centre, y down) on the shooting motions
 * (h10itemlegswalkf / h11itemshootupper samples 1, 8, 15: DK Hip −2 … −7 → −4; Pikachu Hip −1 … −6 → −2;
 * Link Hip −3 … −8, h11itemshootupper ≈ −6.6 → −6),
 * native-derived approximate fallback for DK. Pikachu uses per-drawing Hip registration below.
 */
import type { CharacterId } from '../types';
import shootingAnchors from './pikachuShootingLayerAnchors.json';

const WAIST_Y: Readonly<Partial<Record<CharacterId, number>>> = Object.freeze({ donkeykong: -4, pikachu: -2, link: -6 });

export interface LayerMetrics {
  /** Root pixel row in the frame (originY × frameHeight). */
  readonly rootY: number;
  readonly scaleToWorld: number;
  readonly bodyCentreFromRootY: number;
}

/** Frame pixel row of the waist line in a drawing with these metrics (rows above it = upper body). */
export function upperBodyCutRow(id: CharacterId, m: LayerMetrics): number {
  return Math.round(m.rootY + ((WAIST_Y[id] ?? 0) + m.bodyCentreFromRootY) / m.scaleToWorld);
}

export interface ShootingLayerLayout {
  readonly upperOffsetX: number;
  readonly upperOffsetY: number;
  readonly lowerCutRow: number;
  readonly upperCutRow: number;
}

/** Join the selected drawings at their own Hip, rather than assuming a shared
 * root implies a shared waist. Horizontal anchors are reviewed yellow-torso
 * centers (brown tail and internal ink excluded); vertical anchors/cuts come
 * from the registered native Hip. Uniform scale and the source clocks stay intact.
 * Provenance: pikachuShootingLayerAnchors.json -> native-hip-profiles.json.
 */
export function shootingLayerLayout(id: CharacterId, lowerSheet: string, lowerArt: number,
  upperSheet: string, upperArt: number): ShootingLayerLayout | null {
  if (id !== 'pikachu' || !lowerSheet.startsWith('item_shoot_legs_')) return null;
  const clips = shootingAnchors.clips as Record<string, readonly {
    torsoX: number; hipY: number; cutRow: number;
  }[]>;
  const lower = clips[lowerSheet]?.[lowerArt], upper = clips[upperSheet]?.[upperArt];
  if (!lower || !upper) throw new Error(`Missing shooting waist registration: ${lowerSheet}/${lowerArt}, ${upperSheet}/${upperArt}`);
  return { upperOffsetX: lower.torsoX - upper.torsoX, upperOffsetY: lower.hipY - upper.hipY,
    lowerCutRow: lower.cutRow, upperCutRow: upper.cutRow };
}
