import { describe, expect, it } from 'vitest';
import { heldItemMuzzle, HELD_ITEM_MIN_FORESHORTENING } from './heldItemSocket';

describe('heldItemMuzzle', () => {
  it('runs the drawn sprite length along the socket axis (Phaser degrees: 0 up, 90 forward facing right)', () => {
    const at = (angle: number, length = 1) => heldItemMuzzle({ x: 10, y: 20, angle, length }, { height: 32 })!;
    expect(at(90).x).toBeCloseTo(42, 9); expect(at(90).y).toBeCloseTo(20, 9);
    expect(at(-90).x).toBeCloseTo(-22, 9);
    expect(at(0).x).toBeCloseTo(10, 9); expect(at(0).y).toBeCloseTo(-12, 9);
    expect(at(180).y).toBeCloseTo(52, 9);
    expect(at(90, .5).x).toBeCloseTo(26, 9);
  });

  it('keeps the renderer\'s foreshortening floor', () => {
    const m = heldItemMuzzle({ x: 0, y: 0, angle: 90, length: .05 }, { height: 40 })!;
    expect(m.x).toBeCloseTo(40 * HELD_ITEM_MIN_FORESHORTENING, 9);
  });

  it('has no muzzle without a socket axis', () => {
    expect(heldItemMuzzle({ x: 1, y: 2, angle: null, length: 1 }, { height: 32 })).toBeNull();
  });
});
