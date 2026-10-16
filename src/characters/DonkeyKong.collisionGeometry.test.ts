import { describe, expect, it } from 'vitest';
import { DONKEYKONG_TILT, DONKEYKONG_NAIR, DONKEYKONG_UP_SPECIAL } from './DonkeyKong';
import { dkSourceHits } from './donkeykongSourceMoves';
import { selectAttackCollisionHit } from './attackCollisionShapes';
import { getAuthorableCharacterSpec } from './authorableCharacterRegistry';
import { parseCharacterDataFile, serializeCharacterDataSpec } from './characterSerializer';

const point = (x: number, y: number) => ({ min: { x: x - 0.5, y: y - 0.5 }, max: { x: x + 0.5, y: y + 0.5 } });
const origin = { x: 0, y: 0 };

describe('DK explicit collision geometry regressions', () => {
  it.each([1, -1] as const)('angled tilts preserve their fist reach facing %s', facing => {
    for (const [direction, y] of [['up', -30], ['down', 15]] as const) {
      const hits = DONKEYKONG_TILT.angledVariants![direction]!.collisionHits!;
      expect(selectAttackCollisionHit(hits, origin, facing, [point(125 * facing, y)], true)?.id).toBe(0);
      expect(selectAttackCollisionHit(hits, origin, facing, [point(134 * facing, y)], true)).toBeUndefined();
      expect(selectAttackCollisionHit(hits, origin, facing, [point(-40 * facing, y)], true)).toBeUndefined();
    }
  });
  it.each([1, -1] as const)('continuing nair removes only the one-frame forward sphere facing %s', facing => {
    const [first, continuing, late] = DONKEYKONG_NAIR.hitWindows!;
    expect(first!.collisionHits).toHaveLength(4);
    for (const window of [continuing!, late!]) {
      expect(window.collisionHits).toHaveLength(3);
      expect(selectAttackCollisionHit(window.collisionHits!, origin, facing, [point(40 * facing, -20)], false)?.id).toBe(0);
      expect(selectAttackCollisionHit(window.collisionHits!, origin, facing, [point(-45 * facing, 0)], false)?.id).toBe(1);
      expect(selectAttackCollisionHit(window.collisionHits!, origin, facing, [point(82 * facing, -20)], false)).toBeUndefined();
    }
    expect(selectAttackCollisionHit(first!.collisionHits!, origin, facing, [point(82 * facing, 2)], false)?.id).toBe(3);
  });
  it.each([1, -1] as const)('aerial spin exposes separate inner and outer contacts facing %s', facing => {
    const rows = DONKEYKONG_UP_SPECIAL.multiHitRising.collisionHitsPerHit!;
    for (const hits of rows.slice(1)) {
      expect(selectAttackCollisionHit(hits, origin, facing, [point(100 * facing, -18)], false)?.id).toBe(0);
      expect(selectAttackCollisionHit(hits, origin, facing, [point(-100 * facing, -18)], false)?.id).toBe(1);
      expect(selectAttackCollisionHit(hits, origin, facing, [point(20 * facing, -18)], false)?.id).toBe(2);
      expect(selectAttackCollisionHit(hits, origin, facing, [point(-20 * facing, -18)], false)?.id).toBe(3);
      expect(selectAttackCollisionHit(hits, origin, facing, [point(111 * facing, -18)], false)).toBeUndefined();
    }
  });
  it('refuses generic anchors for any unsupplied limb region', () => {
    expect(() => dkSourceHits('AttackS3', 7)).toThrow('Missing authored DK collision geometry');
    expect(() => dkSourceHits('SpecialAirHi', 12)).toThrow('Missing authored DK collision geometry');
    expect(dkSourceHits('AttackAirLw', 14)).toHaveLength(2);
  });
  it('preserves corrected geometry through the complete saved-kit round trip', () => {
    const spec = getAuthorableCharacterSpec('donkeykong');
    const restored = parseCharacterDataFile(JSON.parse(JSON.stringify(serializeCharacterDataSpec(spec))));
    expect(restored.moves).toEqual(spec.moves);
  });
});
