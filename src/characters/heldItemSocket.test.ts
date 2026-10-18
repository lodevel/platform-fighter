import { describe, expect, it } from 'vitest';
import { heldItemMuzzle, heldItemPlacement, HELD_ITEM_MIN_FORESHORTENING } from './heldItemSocket';

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

describe('heldItemPlacement', () => {
  it('puts the sprite bottom on the grip and its centre half way to the muzzle, mirrored and foreshortened', () => {
    const grip = { x: 10, y: 20 }, socket = { ...grip, angle: -90, length: .2 };
    const placed = heldItemPlacement(grip, 40, { angle: -90, length: .2, facing: -1 });
    const muzzle = heldItemMuzzle(socket, { height: 40 })!;
    expect(placed.rootPosition).toEqual(grip);
    expect(placed.position.x).toBeCloseTo((grip.x + muzzle.x) / 2, 9);
    expect(placed.position.y).toBeCloseTo((grip.y + muzzle.y) / 2, 9);
    expect([placed.angle, placed.scaleX, placed.scaleY]).toEqual([-Math.PI / 2, -1, HELD_ITEM_MIN_FORESHORTENING]);
  });

  it('keeps an item that does not turn upright above the grip', () => {
    expect(heldItemPlacement({ x: 5, y: 50 }, 30, null)).toEqual({ rootPosition: { x: 5, y: 50 }, position: { x: 5, y: 35 }, angle: 0, scaleX: 1, scaleY: 1 });
  });
});
