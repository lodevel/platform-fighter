import { describe, expect, it } from 'vitest';
import { heldItemPlacement } from '../../../src/characters/heldItemSocket';
import type { ItemView } from '../../../src/sim/view';
import { placeHeldItem } from './heldItems';

const item = (held?: ItemView['held']): ItemView => ({ id: 1, type: 'beamSword', spriteKey: 'sword', width: 20, height: 60,
  ...heldItemPlacement({ x: 380, y: 270 }, 60, { angle: -20, length: 1, facing: -1 }), ...(held ? { held } : {}) });
const grip = { x: 390, y: 296, angle: -150, length: .8, facing: -1 as const };

describe('held item placement at the drawn grip', () => {
  it('draws a held item at the grip of the drawing shown', () => {
    const held = item({ playerIndex: 2, socketAxis: 'y', turns: true });
    expect(placeHeldItem(held, grip)).toEqual({ ...held, ...heldItemPlacement(grip, 60, grip) });
  });

  it('moves an item that does not turn without turning it', () => {
    const placed = placeHeldItem(item({ playerIndex: 2, socketAxis: 'y', turns: false }), grip);
    expect([placed.rootPosition, placed.angle, placed.scaleX]).toEqual([{ x: 390, y: 296 }, 0, 1]);
  });

  it('keeps the gameplay grip without a drawn grip, and for free items', () => {
    const held = item({ playerIndex: 2, socketAxis: 'y', turns: true }), free = item();
    expect(placeHeldItem(held, null)).toBe(held);
    expect(placeHeldItem(free, grip)).toBe(free);
  });
});
