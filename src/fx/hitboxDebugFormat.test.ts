import { describe, it, expect } from 'vitest';
import {
  HITBOX_DEBUG_ATTACK_COLOR,
  HITBOX_DEBUG_GRAB_COLOR,
  HITBOX_DEBUG_HURTBOX_COLOR,
  attackDebugBox,
  attackSensorDebugBoxes,
  computeFighterDebugBoxes,
  grabDebugBox,
  hurtboxDebugBoxes,
  type HitboxDebugFighterSnapshot,
} from './hitboxDebugFormat';
import { computeHitboxCenter, HITBOX_LABEL, type AttackMove } from '../characters/attacks';
import type { Hurtbox } from '../characters/moveSchema';

describe('live attack sensor overlays', () => {
  const sensor = { label: HITBOX_LABEL, position: { x: 100, y: 200 },
    bounds: { min: { x: 80, y: 155 }, max: { x: 120, y: 245 } } };
  it.each([1, -1] as const)('draws Thunder early circle and late capsule at the article root facing%s', facing => {
    const early = attackSensorDebugBoxes({ ...sensor, position: { x: 100, y: 190 }, plugin: {
      facing, hitbox: { offsetX: 0, offsetY: -10, width: 60, height: 60 },
      collisionHits: [{ id: 0, capsule: { start: { x: 0, y: -10 }, end: { x: 0, y: -10 }, radius: 30 } }],
    } });
    expect(early[0]?.capsule).toEqual({ start: { x: 100, y: 190 }, end: { x: 100, y: 190 }, radius: 30 });
    const late = attackSensorDebugBoxes({ ...sensor, plugin: {
      facing, hitbox: { offsetX: 0, offsetY: -45, width: 40, height: 90 },
      collisionHits: [{ id: 0, capsule: { start: { x: 0, y: -20 }, end: { x: 0, y: -70 }, radius: 20 } }],
    } });
    expect(late[0]).toMatchObject({ kind: 'attack', x: 100, y: 200, width: 40, height: 90,
      capsule: { start: { x: 100, y: 225 }, end: { x: 100, y: 175 }, radius: 20 } });
  });
  it('uses the live owner root for attached contacts, and ignores stage bodies', () => {
    const plugin = { facing: -1 as const, ownerAnchoredContact: true,
      hitbox: { offsetX: 10, offsetY: 0, width: 10, height: 10 },
      collisionHits: [{ id: 0, capsule: { start: { x: 10, y: 0 }, end: { x: 10, y: 0 }, radius: 5 } }],
    };
    expect(attackSensorDebugBoxes({ ...sensor, plugin }, { x: 300, y: 400 })[0]?.capsule?.start)
      .toEqual({ x: 290, y: 400 });
    expect(attackSensorDebugBoxes({ ...sensor, label: 'platform.solid', plugin })).toEqual([]);
    expect(attackSensorDebugBoxes(sensor)[0]).toMatchObject({ x: 100, y: 200, width: 40, height: 90 });
  });
});

/**
 * The hitbox-debug formatter is the single source of truth for the F3
 * overlay's boxes. The point of the overlay is TRUTHFULNESS — the red
 * attack box must land exactly where the real Matter sensor does. These
 * tests pin that against the same `computeHitboxCenter` the runtime
 * spawns from, plus the facing-mirroring for hitboxes / grabs and the
 * body-relative placement of hurtboxes.
 */

const MOVE: AttackMove = {
  id: 'donkeykong.smash.forward',
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
  it('mirrors posed capsules and rectangle offsets with the defender facing', () => {
    const limb: Hurtbox = { ...BODY_HURTBOX, offsetX: 20, capsule: {
      start: { x: 30, y: -10 }, end: { x: 40, y: 0 }, radius: 2 } };
    const box = hurtboxDebugBoxes(snapshot({ facing: -1, hurtboxes: [limb] }))[0]!;
    expect(box.capsule).toEqual({ start: { x: 370, y: 290 }, end: { x: 360, y: 300 }, radius: 2 });
    expect(box).toMatchObject({ x: 365, y: 295, width: 14, height: 14 });
    const { capsule: _capsule, ...rectangular } = limb;
    expect(hurtboxDebugBoxes(snapshot({ facing: -1, hurtboxes: [rectangular] }))[0]!.x).toBe(380);
  });
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
      id: 'donkeykong.smash.windup',
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
