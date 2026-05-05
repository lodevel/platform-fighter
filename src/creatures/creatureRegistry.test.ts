import { afterEach, describe, expect, it } from 'vitest';

import {
  _resetCreatureRegistryForTests,
  getCreatureSpec,
  hasCreature,
  listCreatureSpecs,
  registerCreature,
} from './creatureRegistry';
import type { CreatureSpec } from './creatureSchema';

const sampleSpec = (id: string): CreatureSpec => ({
  id,
  displayName: `Sample ${id}`,
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
  moveset: {},
  ai: { aggroRangePx: 200, leashRangePx: 400, attackCadenceFrames: 30 },
  despawnPolicies: ['onHpZero'],
});

afterEach(() => {
  _resetCreatureRegistryForTests();
});

describe('creatureRegistry', () => {
  it('starts empty after reset', () => {
    expect(listCreatureSpecs()).toEqual([]);
  });

  it('registers and retrieves a spec', () => {
    const s = sampleSpec('alpha');
    registerCreature(s);
    expect(hasCreature('alpha')).toBe(true);
    expect(getCreatureSpec('alpha').id).toBe('alpha');
  });

  it('throws on unknown id', () => {
    expect(() => getCreatureSpec('missing')).toThrow(/Unknown creature id/);
  });

  it('is idempotent for an identical re-registration', () => {
    const s = sampleSpec('alpha');
    registerCreature(s);
    expect(() => registerCreature({ ...s })).not.toThrow();
    expect(listCreatureSpecs().length).toBe(1);
  });

  it('throws on id collision with different spec', () => {
    registerCreature(sampleSpec('alpha'));
    expect(() =>
      registerCreature({ ...sampleSpec('alpha'), maxHp: 99 }),
    ).toThrow(/collision/);
  });

  it('validates eagerly on register (rejects malformed spec)', () => {
    expect(() =>
      registerCreature({ ...sampleSpec('alpha'), maxHp: 0 }),
    ).toThrow(/maxHp/);
    expect(hasCreature('alpha')).toBe(false);
  });

  it('listCreatureSpecs returns insertion order', () => {
    registerCreature(sampleSpec('a'));
    registerCreature(sampleSpec('b'));
    registerCreature(sampleSpec('c'));
    expect(listCreatureSpecs().map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });
});
