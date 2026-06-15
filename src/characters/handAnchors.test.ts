import { describe, it, expect } from 'vitest';
import {
  DEFAULT_HAND_ANCHOR,
  FIGHTER_HAND_ANCHORS,
  computeHeldItemPosition,
  getHandAnchor,
} from './handAnchors';
import type { CharacterId } from '../types';

const IDS: ReadonlyArray<CharacterId> = ['wolf', 'cat', 'owl', 'bear'];

describe('FIGHTER_HAND_ANCHORS — table shape', () => {
  it('defines a grip for every roster fighter', () => {
    for (const id of IDS) {
      const anchor = FIGHTER_HAND_ANCHORS[id];
      expect(anchor).toBeDefined();
      expect(Number.isFinite(anchor.x)).toBe(true);
      expect(Number.isFinite(anchor.y)).toBe(true);
    }
  });

  it('places every grip IN FRONT of the body (positive forward offset)', () => {
    // A zero / negative forward offset would re-create the waist-pin
    // bug this module exists to fix.
    for (const id of IDS) {
      expect(FIGHTER_HAND_ANCHORS[id].x).toBeGreaterThan(0);
    }
  });

  it('is deeply frozen', () => {
    expect(Object.isFrozen(FIGHTER_HAND_ANCHORS)).toBe(true);
    for (const id of IDS) {
      expect(Object.isFrozen(FIGHTER_HAND_ANCHORS[id])).toBe(true);
    }
  });

  it('getHandAnchor resolves the table entry', () => {
    expect(getHandAnchor('wolf')).toBe(FIGHTER_HAND_ANCHORS.wolf);
  });

  it('getHandAnchor falls back defensively on unknown ids', () => {
    expect(getHandAnchor('???' as CharacterId)).toBe(DEFAULT_HAND_ANCHOR);
  });
});

describe('computeHeldItemPosition — facing mirror', () => {
  it('offsets forward of the holder when facing right', () => {
    const pos = computeHeldItemPosition({ x: 100, y: 200 }, 1, 'wolf');
    expect(pos.x).toBe(100 + FIGHTER_HAND_ANCHORS.wolf.x);
    expect(pos.y).toBe(200 + FIGHTER_HAND_ANCHORS.wolf.y);
  });

  it('mirrors the forward offset when facing left', () => {
    const right = computeHeldItemPosition({ x: 100, y: 200 }, 1, 'wolf');
    const left = computeHeldItemPosition({ x: 100, y: 200 }, -1, 'wolf');
    expect(left.x).toBe(100 - (right.x - 100));
    // Vertical offset is facing-independent.
    expect(left.y).toBe(right.y);
  });

  it('is deterministic (same inputs → same frozen output)', () => {
    const a = computeHeldItemPosition({ x: 5, y: 7 }, -1, 'bear');
    const b = computeHeldItemPosition({ x: 5, y: 7 }, -1, 'bear');
    expect(a).toEqual(b);
    expect(Object.isFrozen(a)).toBe(true);
  });

  it('keeps the grip aligned with the hitbox mirror convention (offsetX * facing)', () => {
    // attacks.ts mirrors hitboxes via `offsetX * facing`; the grip
    // uses the same convention so a weapon's visual and its swing
    // hitbox sit on the same side of the body.
    for (const id of IDS) {
      const left = computeHeldItemPosition({ x: 0, y: 0 }, -1, id);
      expect(left.x).toBeLessThan(0);
    }
  });
});
