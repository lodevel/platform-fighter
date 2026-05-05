import { describe, expect, it } from 'vitest';

import {
  type CreatureSpec,
  validateCreatureSpec,
} from './creatureSchema';

const validSpec = (): CreatureSpec => ({
  id: 'demo',
  displayName: 'Demo Creature',
  spriteKey: null,
  playable: false,
  body: { width: 20, height: 20, chamfer: 4 },
  movement: {
    maxRunSpeed: 8,
    groundAccel: 0.5,
    airAccel: 0.3,
    groundDamping: 0.85,
    airDamping: 0.95,
    jumpImpulse: 10,
    maxJumps: 1,
    mass: 5,
  },
  maxHp: 20,
  moveset: {
    chaseAttack: {
      id: 'demo.chase',
      type: 'jab',
      damage: 4,
      knockback: { x: 1, y: -0.5, scaling: 0.05 },
      hitbox: { offsetX: 12, offsetY: 0, width: 18, height: 14 },
      startupFrames: 4,
      activeFrames: 2,
      recoveryFrames: 8,
      cooldownFrames: 12,
      animation: { startupFrames: 1, activeFrames: 1, recoveryFrames: 2 },
    },
  },
  ai: {
    aggroRangePx: 200,
    leashRangePx: 400,
    attackCadenceFrames: 30,
  },
  despawnPolicies: ['timer', 'onHpZero'],
  lifetimeFrames: 480,
});

describe('validateCreatureSpec — happy path', () => {
  it('accepts a valid spec', () => {
    const s = validSpec();
    expect(validateCreatureSpec(s)).toBe(s);
  });
});

describe('validateCreatureSpec — invariants', () => {
  it('rejects empty id', () => {
    expect(() => validateCreatureSpec({ ...validSpec(), id: '' })).toThrow(/id/);
  });

  it('rejects empty displayName', () => {
    expect(() =>
      validateCreatureSpec({ ...validSpec(), displayName: '' }),
    ).toThrow(/displayName/);
  });

  it('rejects non-positive body dimensions', () => {
    expect(() =>
      validateCreatureSpec({
        ...validSpec(),
        body: { ...validSpec().body, width: 0 },
      }),
    ).toThrow(/body/);
  });

  it('rejects non-positive maxHp', () => {
    expect(() => validateCreatureSpec({ ...validSpec(), maxHp: 0 })).toThrow(
      /maxHp/,
    );
  });

  it('rejects non-positive movement.mass', () => {
    expect(() =>
      validateCreatureSpec({
        ...validSpec(),
        movement: { ...validSpec().movement, mass: 0 },
      }),
    ).toThrow(/mass/);
  });

  it('rejects non-positive ai.aggroRangePx', () => {
    expect(() =>
      validateCreatureSpec({
        ...validSpec(),
        ai: { ...validSpec().ai, aggroRangePx: 0 },
      }),
    ).toThrow(/aggroRangePx/);
  });

  it('rejects empty despawnPolicies', () => {
    expect(() =>
      validateCreatureSpec({ ...validSpec(), despawnPolicies: [] }),
    ).toThrow(/despawn/);
  });

  it("requires lifetimeFrames when policy includes 'timer'", () => {
    expect(() =>
      validateCreatureSpec({
        ...validSpec(),
        despawnPolicies: ['timer'],
        lifetimeFrames: undefined,
      }),
    ).toThrow(/lifetimeFrames/);
  });
});
