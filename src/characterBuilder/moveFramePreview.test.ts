import { describe, expect, it } from 'vitest';
import { LINK_FAIR, LINK_JAB } from '../characters/Link';
import type { AttackMoveWithAnimation } from '../characters/moveSchema';
import { inspectMoveFrame } from './moveFramePreview';

// Synthetic moves: the preview is generic, so these fixtures do not depend on any
// fighter's (changing) sourced data.
const BASE = {
  type: 'tilt' as const, damage: 10, knockback: { x: 4, y: -2, scaling: 0.1 },
  hitbox: { offsetX: 20, offsetY: 0, width: 24, height: 16 },
  startupFrames: 14, activeFrames: 5, recoveryFrames: 19, cooldownFrames: 0,
};
const win = (startFrame: number, endFrame: number, extra: object) => ({ startFrame, endFrame, ...extra });
const SWEEP = { ...BASE, id: 'fixture.sweep', type: 'smash', damage: 16, startupFrames: 10, activeFrames: 16,
  hitWindows: [win(10, 14, { group: 'front', damage: 16 }), win(22, 26, { group: 'back', facing: -1, damage: 12 })] } as unknown as AttackMoveWithAnimation;
const KICK = { ...BASE, id: 'fixture.kick', type: 'aerial', damage: 11, startupFrames: 7, activeFrames: 6,
  hitWindows: [win(7, 8, { group: 'kick', damage: 11 }), win(8, 13, { group: 'kick', damage: 6 })] } as unknown as AttackMoveWithAnimation;
const CAPSULE = { ...BASE, id: 'fixture.capsule', type: 'jab', startupFrames: 6, activeFrames: 2,
  collisionHits: [{ id: 0, capsule: { start: { x: 10, y: 0 }, end: { x: 30, y: 0 }, radius: 6 } }] } as unknown as AttackMoveWithAnimation;
const RECT = { ...BASE, id: 'fixture.rect', damage: 13 } as AttackMoveWithAnimation;

describe('move frame inspection', () => {
  it('shows forward-air strike boundaries and harmless intervening frames', () => {
    expect([14, 15, 16, 17, 22, 23, 24, 25].map(elapsed => {
      const frame = inspectMoveFrame(LINK_FAIR, elapsed);
      return [frame.frame, frame.phase, frame.windowIndex, frame.damage, frame.collisionHits.length];
    })).toEqual([
      [15, 'startup', -1, undefined, 0],
      [16, 'active', 0, 8, 6],
      [17, 'active', 0, 8, 6],
      [18, 'gap', -1, undefined, 0],
      [23, 'gap', -1, undefined, 0],
      [24, 'active', 1, 10, 3],
      [25, 'active', 1, 10, 3],
      [26, 'recovery', -1, undefined, 0],
    ]);
    for (const elapsed of [0, 17, 22, 25, 50]) {
      expect(inspectMoveFrame(LINK_FAIR, elapsed).hitbox).toBeUndefined();
      expect(inspectMoveFrame(LINK_FAIR, elapsed).resolvedMove).toBeUndefined();
    }
  });

  it('mirrors rear-window geometry against the attack-latched axis', () => {
    const front = inspectMoveFrame(SWEEP, 11);
    const back = inspectMoveFrame(SWEEP, 23);
    expect([front.facing, front.group, front.damage]).toEqual([1, 'front', 16]);
    expect([back.facing, back.group, back.damage]).toEqual([-1, 'back', 12]);
    expect(inspectMoveFrame(SWEEP, 23, -1).facing).toBe(1);
    expect(back.hitbox).toEqual(SWEEP.hitbox);
  });

  it('keeps early and late strengths in the same hit group', () => {
    const early = inspectMoveFrame(KICK, 7);
    const late = inspectMoveFrame(KICK, 8);
    expect([early.phase, late.phase]).toEqual(['active', 'active']);
    expect([early.group, late.group]).toEqual(['kick', 'kick']);
    expect([early.damage, late.damage]).toEqual([11, 6]);
    expect([early.windowIndex, late.windowIndex]).toEqual([0, 1]);
  });

  it('clamps jab scrubbing to integer display frames and its busy duration', () => {
    expect(inspectMoveFrame(LINK_JAB, -20)).toMatchObject({ elapsed: 0, frame: 1, phase: 'startup', totalFrames: 23 });
    expect(inspectMoveFrame(LINK_JAB, 6.9)).toMatchObject({ elapsed: 6, frame: 7, phase: 'active' });
    expect(inspectMoveFrame(LINK_JAB, 500)).toMatchObject({ elapsed: 22, frame: 23, phase: 'recovery' });
    expect(inspectMoveFrame(LINK_JAB, Number.NaN).elapsed).toBe(0);
    expect(inspectMoveFrame(LINK_JAB, Number.POSITIVE_INFINITY).elapsed).toBe(22);
    expect(inspectMoveFrame(LINK_JAB, Number.NEGATIVE_INFINITY).elapsed).toBe(0);
    expect(inspectMoveFrame({ ...LINK_JAB, cooldownFrames: 30 }, 500).totalFrames).toBe(23);
  });

  it('supports legacy rectangular moves and capsule moves without hit windows', () => {
    const rectangle = inspectMoveFrame(RECT, RECT.startupFrames);
    expect(rectangle).toMatchObject({ phase: 'active', windowIndex: -1, damage: 13, collisionHits: [] });
    expect(rectangle.hitbox).toEqual(RECT.hitbox);
    expect(inspectMoveFrame(CAPSULE, 6).collisionHits).toEqual(CAPSULE.collisionHits);
    expect(inspectMoveFrame(CAPSULE, 8).collisionHits).toEqual([]);
  });

  it('treats an empty hit-window list like an omitted list', () => {
    const withEmptyWindows = { ...RECT, hitWindows: [] };
    for (const elapsed of [0, 14, 18, 19, 38]) {
      const expected = inspectMoveFrame(RECT, elapsed);
      const actual = inspectMoveFrame(withEmptyWindows, elapsed);
      expect(actual.phase).toBe(expected.phase);
      expect(actual.hitbox).toEqual(expected.hitbox);
      expect(actual.collisionHits).toEqual(expected.collisionHits);
      expect(actual.damage).toBe(expected.damage);
    }
  });

  it('resolves per-window geometry and records without mutating authored data', () => {
    const move = structuredClone(LINK_FAIR);
    const original = structuredClone(move);
    for (let frame = 0; frame < 60; frame++) inspectMoveFrame(move, frame, -1);
    expect(move).toEqual(original);
    const first = inspectMoveFrame(move, 15);
    expect(first.resolvedMove?.hitlagMultiplier).toBe(0.8);
    expect(first.collisionHits[0]?.situation).toBe('ground');
    expect(inspectMoveFrame(move, 23).collisionHits[0]?.capsule.radius).toBe(22.5);

    const hitbox = { offsetX: 7, offsetY: -9, width: 10, height: 12 };
    const override = { ...RECT, hitWindows: [{ startFrame: 14, endFrame: 15, hitbox }] };
    expect(inspectMoveFrame(override, 14).hitbox).toEqual(hitbox);
    expect(inspectMoveFrame(override, 15).phase).toBe('gap');
  });
});
