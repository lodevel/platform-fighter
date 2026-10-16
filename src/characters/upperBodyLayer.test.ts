import { describe, expect, it } from 'vitest';
import { shootingLayerLayout } from './upperBodyLayer';
import anchors from './pikachuShootingLayerAnchors.json';
import { getPikachuSheetRenderMetrics } from './pikachuPresentation';

describe('shooting body registration', () => {
  it('joins the measured forward-walk pelvis and charged-scope drawing without stretching either', () => {
    const joined = shootingLayerLayout('pikachu', 'item_shoot_legs_walk_f', 2, 'item_scope_wait_upper', 2)!;
    // Independently reviewed native Hip: lower Y=-3.030, upper Y=-5.433.
    // Yellow torso centers: lower7.933px, upper-1.167px (brown tail excluded).
    expect(joined.upperOffsetX).toBeCloseTo(9.10000065, 5);
    expect(joined.upperOffsetY).toBeCloseTo(2.403, 2);
    expect(joined.lowerCutRow).toBeCloseTo(118.94, 1);
    expect(joined.upperCutRow).toBeCloseTo(109.79, 1);
  });

  it('pins both actual crop boundaries to one world seam for every prepared pairing', () => {
    const clips = anchors.clips as Record<string, readonly { torsoX: number; hipY: number; cutRow: number }[]>;
    for (const [lowerSheet, lowerRows] of Object.entries(clips).filter(([name]) => name.startsWith('item_shoot_legs_'))) {
      for (const [upperSheet, upperRows] of Object.entries(clips).filter(([name]) => name.endsWith('_upper'))) {
        const lowerMetrics = getPikachuSheetRenderMetrics(lowerSheet);
        const upperMetrics = getPikachuSheetRenderMetrics(upperSheet);
        lowerRows.forEach((_lower, i) => upperRows.forEach((_upper, j) => {
          const joined = shootingLayerLayout('pikachu', lowerSheet, i, upperSheet, j)!;
          const lowerSeam = (joined.lowerCutRow - lowerMetrics.rootY) * lowerMetrics.scaleToWorld;
          const upperSeam = (joined.upperCutRow - upperMetrics.rootY) * upperMetrics.scaleToWorld + joined.upperOffsetY;
          expect(upperSeam).toBeCloseTo(lowerSeam, 4);
        }));
      }
    }
  });

  it('leaves DK and unsplit poses on their existing route and rejects missing Pikachu drawings', () => {
    expect(shootingLayerLayout('donkeykong', 'item_shoot_legs_walk_f', 0, 'item_scope_wait_upper', 0)).toBeNull();
    expect(shootingLayerLayout('pikachu', 'item_scope_wait', 0, 'item_scope_wait_upper', 0)).toBeNull();
    expect(() => shootingLayerLayout('pikachu', 'item_shoot_legs_walk_f', 99, 'item_scope_wait_upper', 0)).toThrow();
  });
});
