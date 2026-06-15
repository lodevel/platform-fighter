import { describe, it, expect } from 'vitest';
import {
  HITBOX_DEBUG_ATTACK_COLOR,
  HITBOX_DEBUG_GRAB_COLOR,
  HITBOX_DEBUG_HURTBOX_COLOR,
  attackDebugBox,
  computeFighterDebugBoxes,
  grabDebugBox,
  hurtboxDebugBoxes,
  type HitboxDebugFighterSnapshot,
} from './hitboxDebugFormat';
import { computeHitboxCenter, type AttackMove } from '../characters/attacks';
import type { Hurtbox } from '../characters/moveSchema';

/**
 * The hitbox-debug formatter is the single source of truth for the F3
 * overlay's boxes. The point of the overlay is TRUTHFULNESS — the red
 * attack box must land exactly where the real Matter sensor does. These
 * tests pin that against the same `computeHitboxCenter` the runtime
 * spawns from, plus the facing-mirroring for hitboxes / grabs and the
 * body-relative placement of hurtboxes.
 */

const MOVE: AttackMove = {
  id: 'wolf.smash.forward',
  type: 'smash',
  damage: 18,
  knockback: { x: 8, y: -4, scaling: 0.3 },
  hitbox: { offsetX: 70, offsetY: -8, width: 90, height: 50 },
  startupFrames: 12,
  activeFrames: 4,
  recoveryFrames: 20,
  cooldownFrames: 6,
};

const BODY_HURTBOX: Hurtbox = Object.freeze({
  id: 'body',
  offsetX: 0,
  offsetY: 0,
  width: 90,
  height: 130,
});

function snapshot(
  overrides: Partial<HitboxDebugFighterSnapshot>,
): HitboxDebugFighterSnapshot {
  return {
    bodyX: 400,
    bodyY: 300,
    facing: 1,
    hurtboxes: [BODY_HURTBOX],
    activeAttack: null,
    activeGrab: null,
    ...overrides,
  };
}

describe('hitboxDebugFormat — attackDebugBox', () => {
  it('is null when no attack is active', () => {
    expect(attackDebugBox(snapshot({ activeAttack: null }))).toBeNull();
  });

  it('is null during startup / recovery (no live sensor)', () => {
    expect(
      attackDebugBox(
        snapshot({ activeAttack: { move: MOVE, facing: 1, phase: 'startup' } }),
      ),
    ).toBeNull();
    expect(
      attackDebugBox(
        snapshot({ activeAttack: { move: MOVE, facing: 1, phase: 'recovery' } }),
      ),
    ).toBeNull();
  });

  it('lands exactly on the real sensor centre (facing right)', () => {
    const snap = snapshot({
      activeAttack: { move: MOVE, facing: 1, phase: 'active' },
    });
    const box = attackDebugBox(snap)!;
    const truth = computeHitboxCenter({ x: snap.bodyX, y: snap.bodyY }, MOVE, 1);
    expect(box.kind).toBe('attack');
    expect(box.x).toBe(truth.x);
    expect(box.y).toBe(truth.y);
    expect(box.width).toBe(MOVE.hitbox.width);
    expect(box.height).toBe(MOVE.hitbox.height);
    expect(box.color).toBe(HITBOX_DEBUG_ATTACK_COLOR);
  });

  it('mirrors the box to the left when the attack faces left', () => {
    const snap = snapshot({
      activeAttack: { move: MOVE, facing: -1, phase: 'active' },
    });
    const box = attackDebugBox(snap)!;
    const truth = computeHitboxCenter({ x: snap.bodyX, y: snap.bodyY }, MOVE, -1);
    expect(box.x).toBe(truth.x);
    expect(box.x).toBeLessThan(snap.bodyX); // mirrored to the left
  });
});

describe('hitboxDebugFormat — hurtboxDebugBoxes', () => {
  it('places body-relative hurtboxes at the body centre (green)', () => {
    const boxes = hurtboxDebugBoxes(snapshot({}));
    expect(boxes).toHaveLength(1);
    expect(boxes[0]!.kind).toBe('hurtbox');
    expect(boxes[0]!.x).toBe(400);
    expect(boxes[0]!.y).toBe(300);
    expect(boxes[0]!.color).toBe(HITBOX_DEBUG_HURTBOX_COLOR);
    expect(boxes[0]!.fillAlpha).toBe(0); // outline only
  });

  it('offsets a non-centred hurtbox by its authored offset', () => {
    const limb: Hurtbox = {
      id: 'wolf.smash.windup',
      offsetX: 20,
      offsetY: -30,
      width: 40,
      height: 40,
    };
    const boxes = hurtboxDebugBoxes(snapshot({ hurtboxes: [BODY_HURTBOX, limb] }));
    expect(boxes).toHaveLength(2);
    expect(boxes[1]!.x).toBe(420);
    expect(boxes[1]!.y).toBe(270);
  });
});

describe('hitboxDebugFormat — grabDebugBox', () => {
  it('is null when no grab range is live', () => {
    expect(grabDebugBox(snapshot({ activeGrab: null }))).toBeNull();
  });

  it('mirrors the grab range by body facing (yellow)', () => {
    const grabHitbox = { offsetX: 50, offsetY: 0, width: 30, height: 60 };
    const right = grabDebugBox(
      snapshot({ facing: 1, activeGrab: { hitbox: grabHitbox } }),
    )!;
    const left = grabDebugBox(
      snapshot({ facing: -1, activeGrab: { hitbox: grabHitbox } }),
    )!;
    expect(right.kind).toBe('grab');
    expect(right.color).toBe(HITBOX_DEBUG_GRAB_COLOR);
    expect(right.x).toBe(450); // 400 + 50
    expect(left.x).toBe(350); // 400 - 50 (mirrored)
  });
});

describe('hitboxDebugFormat — computeFighterDebugBoxes', () => {
  it('returns hurtboxes only when nothing else is active', () => {
    const boxes = computeFighterDebugBoxes(snapshot({}));
    expect(boxes.map((b) => b.kind)).toEqual(['hurtbox']);
  });

  it('layers attack + grab on top of hurtboxes in order', () => {
    const boxes = computeFighterDebugBoxes(
      snapshot({
        activeAttack: { move: MOVE, facing: 1, phase: 'active' },
        activeGrab: { hitbox: { offsetX: 50, offsetY: 0, width: 30, height: 60 } },
      }),
    );
    expect(boxes.map((b) => b.kind)).toEqual(['hurtbox', 'attack', 'grab']);
  });
});
