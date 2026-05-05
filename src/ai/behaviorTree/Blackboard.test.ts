import { describe, expect, it } from 'vitest';
import { BLACKBOARD_SCOPE_SEPARATOR, Blackboard } from './Blackboard';

interface BotState {
  currentTargetId: number;
  isGrounded: boolean;
  lastHitFrame: number | undefined;
  weights: ReadonlyArray<number>;
}

describe('Blackboard', () => {
  describe('basic get / set / has', () => {
    it('returns undefined for unset keys', () => {
      const bb = new Blackboard<BotState>();
      expect(bb.get('currentTargetId')).toBeUndefined();
      expect(bb.has('currentTargetId')).toBe(false);
    });

    it('round-trips a primitive value through set/get', () => {
      const bb = new Blackboard<BotState>();
      bb.set('currentTargetId', 7);
      expect(bb.get('currentTargetId')).toBe(7);
      expect(bb.has('currentTargetId')).toBe(true);
    });

    it('round-trips a boolean value', () => {
      const bb = new Blackboard<BotState>();
      bb.set('isGrounded', true);
      expect(bb.get('isGrounded')).toBe(true);
      bb.set('isGrounded', false);
      expect(bb.get('isGrounded')).toBe(false);
    });

    it('round-trips a reference value (array)', () => {
      const bb = new Blackboard<BotState>();
      const weights = [0.1, 0.2, 0.7];
      bb.set('weights', weights);
      // Same reference comes back — Blackboard does not defensive-copy.
      expect(bb.get('weights')).toBe(weights);
    });

    it('overwrites an existing entry', () => {
      const bb = new Blackboard<BotState>();
      bb.set('currentTargetId', 1);
      bb.set('currentTargetId', 2);
      expect(bb.get('currentTargetId')).toBe(2);
      expect(bb.size).toBe(1);
    });

    it('treats `set(key, undefined)` as present-with-undefined per Map semantics', () => {
      const bb = new Blackboard<BotState>();
      bb.set('lastHitFrame', undefined);
      expect(bb.has('lastHitFrame')).toBe(true);
      expect(bb.get('lastHitFrame')).toBeUndefined();
    });
  });

  describe('delete', () => {
    it('removes the entry and returns true', () => {
      const bb = new Blackboard<BotState>();
      bb.set('currentTargetId', 3);
      expect(bb.delete('currentTargetId')).toBe(true);
      expect(bb.has('currentTargetId')).toBe(false);
      expect(bb.get('currentTargetId')).toBeUndefined();
    });

    it('returns false when the entry was absent', () => {
      const bb = new Blackboard<BotState>();
      expect(bb.delete('currentTargetId')).toBe(false);
    });
  });

  describe('clear', () => {
    it('removes every entry', () => {
      const bb = new Blackboard<BotState>();
      bb.set('currentTargetId', 5);
      bb.set('isGrounded', true);
      expect(bb.size).toBe(2);
      bb.clear();
      expect(bb.size).toBe(0);
      expect(bb.has('currentTargetId')).toBe(false);
      expect(bb.has('isGrounded')).toBe(false);
    });

    it('is idempotent — clearing an empty Blackboard is a no-op', () => {
      const bb = new Blackboard<BotState>();
      expect(() => bb.clear()).not.toThrow();
      expect(bb.size).toBe(0);
    });
  });

  describe('size', () => {
    it('reports the number of stored entries', () => {
      const bb = new Blackboard<BotState>();
      expect(bb.size).toBe(0);
      bb.set('currentTargetId', 1);
      expect(bb.size).toBe(1);
      bb.set('isGrounded', true);
      expect(bb.size).toBe(2);
      bb.delete('currentTargetId');
      expect(bb.size).toBe(1);
    });
  });

  describe('constructor seeding', () => {
    it('accepts initial entries via partial schema', () => {
      const bb = new Blackboard<BotState>({
        currentTargetId: 4,
        isGrounded: true,
      });
      expect(bb.get('currentTargetId')).toBe(4);
      expect(bb.get('isGrounded')).toBe(true);
      expect(bb.has('weights')).toBe(false);
      expect(bb.size).toBe(2);
    });

    it('treats explicit-undefined seed values as present-with-undefined', () => {
      const bb = new Blackboard<BotState>({ lastHitFrame: undefined });
      expect(bb.has('lastHitFrame')).toBe(true);
      expect(bb.get('lastHitFrame')).toBeUndefined();
    });

    it('starts empty when no seed is provided', () => {
      const bb = new Blackboard<BotState>();
      expect(bb.size).toBe(0);
    });
  });

  describe('requireGet', () => {
    it('returns the value when the key is set', () => {
      const bb = new Blackboard<BotState>();
      bb.set('currentTargetId', 9);
      expect(bb.requireGet('currentTargetId')).toBe(9);
    });

    it('throws a descriptive error when the key is absent', () => {
      const bb = new Blackboard<BotState>();
      expect(() => bb.requireGet('currentTargetId')).toThrow(
        /required key "currentTargetId"/i,
      );
    });

    it('returns explicit-undefined values without throwing', () => {
      // The contract is "key must be present", not "value must be defined".
      // A schema that allows `undefined` as a value should round-trip cleanly.
      const bb = new Blackboard<BotState>();
      bb.set('lastHitFrame', undefined);
      expect(bb.requireGet('lastHitFrame')).toBeUndefined();
    });
  });

  describe('iteration helpers', () => {
    it('preserves insertion order across keys()', () => {
      const bb = new Blackboard<BotState>();
      bb.set('currentTargetId', 1);
      bb.set('isGrounded', true);
      bb.set('weights', [0.5]);
      expect(Array.from(bb.keys())).toEqual([
        'currentTargetId',
        'isGrounded',
        'weights',
      ]);
    });

    it('preserves insertion order across entries()', () => {
      const bb = new Blackboard<BotState>();
      bb.set('isGrounded', true);
      bb.set('currentTargetId', 1);
      const entries = Array.from(bb.entries());
      expect(entries).toEqual([
        ['isGrounded', true],
        ['currentTargetId', 1],
      ]);
    });
  });

  describe('determinism', () => {
    it('two Blackboards seeded identically produce identical iteration', () => {
      const a = new Blackboard<BotState>({
        currentTargetId: 2,
        isGrounded: false,
      });
      const b = new Blackboard<BotState>({
        currentTargetId: 2,
        isGrounded: false,
      });
      expect(Array.from(a.entries())).toEqual(Array.from(b.entries()));
      expect(a.size).toBe(b.size);
    });

    it('mutating one Blackboard does not affect another', () => {
      const a = new Blackboard<BotState>();
      const b = new Blackboard<BotState>();
      a.set('currentTargetId', 1);
      expect(b.has('currentTargetId')).toBe(false);
    });
  });

  describe('default schema (no type parameter)', () => {
    it('accepts arbitrary string keys with unknown values', () => {
      const bb = new Blackboard();
      bb.set('foo', 1);
      bb.set('bar', { nested: 'value' });
      expect(bb.get('foo')).toBe(1);
      expect(bb.get('bar')).toEqual({ nested: 'value' });
    });

    it('does not collide with Object.prototype keys', () => {
      // Using Map (rather than a plain object) means writing to "toString"
      // does not shadow the prototype method or surprise has() semantics.
      const bb = new Blackboard();
      expect(bb.has('toString')).toBe(false);
      bb.set('toString', 'hello');
      expect(bb.has('toString')).toBe(true);
      expect(bb.get('toString')).toBe('hello');
    });
  });

  describe('scoped keys', () => {
    interface PerceptionScope {
      target: number;
      cooldown: number;
    }

    interface CombatScope {
      target: number;
      lastHitFrame: number;
    }

    it('exposes a stable separator constant', () => {
      // The constant is part of the public surface so snapshot tooling
      // and replay machinery can reason about scoped on-store keys.
      expect(BLACKBOARD_SCOPE_SEPARATOR).toBe(':');
    });

    it('round-trips a value through a scoped view', () => {
      const bb = new Blackboard();
      const perception = bb.scope<PerceptionScope>('perception');
      perception.set('target', 7);
      expect(perception.get('target')).toBe(7);
      expect(perception.has('target')).toBe(true);
    });

    it('isolates sibling scopes — same key, different namespaces', () => {
      const bb = new Blackboard();
      const perception = bb.scope<PerceptionScope>('perception');
      const combat = bb.scope<CombatScope>('combat');

      perception.set('target', 1);
      combat.set('target', 2);

      expect(perception.get('target')).toBe(1);
      expect(combat.get('target')).toBe(2);
      // Each scope sees only its own entry; unrelated keys (under their
      // own well-typed schema) start absent and remain absent unless
      // explicitly written.
      expect(combat.has('lastHitFrame')).toBe(false);
      expect(perception.has('cooldown')).toBe(false);
    });

    it('addresses the underlying store at "${prefix}:${key}"', () => {
      const bb = new Blackboard();
      const perception = bb.scope<PerceptionScope>('perception');
      perception.set('target', 99);
      // The unscoped root sees the rewritten key — that's how snapshot
      // serialisation continues to work transparently.
      const rootKeys = Array.from(bb.keys());
      expect(rootKeys).toContain('perception:target');
      expect(rootKeys).not.toContain('target');
    });

    it('shares the underlying store with the parent Blackboard', () => {
      const bb = new Blackboard();
      const perception = bb.scope<PerceptionScope>('perception');
      perception.set('target', 4);
      // Root size includes the scoped entry — there is one physical map.
      expect(bb.size).toBe(1);
      // Reading via the rewritten key from the root succeeds.
      expect(bb.get('perception:target')).toBe(4);
    });

    it('reports size and clears scoped only — parent and siblings survive', () => {
      const bb = new Blackboard();
      const perception = bb.scope<PerceptionScope>('perception');
      const combat = bb.scope<CombatScope>('combat');

      bb.set('topLevel', 'keep-me');
      perception.set('target', 1);
      perception.set('cooldown', 10);
      combat.set('target', 2);

      expect(perception.size).toBe(2);
      expect(combat.size).toBe(1);
      expect(bb.size).toBe(4);

      perception.clear();

      expect(perception.size).toBe(0);
      expect(perception.has('target')).toBe(false);
      // Sibling and root entries are untouched.
      expect(combat.get('target')).toBe(2);
      expect(bb.get('topLevel')).toBe('keep-me');
      expect(bb.size).toBe(2);
    });

    it('removes only the scoped entry on delete()', () => {
      const bb = new Blackboard();
      const perception = bb.scope<PerceptionScope>('perception');
      const combat = bb.scope<CombatScope>('combat');

      perception.set('target', 1);
      combat.set('target', 2);

      expect(perception.delete('target')).toBe(true);
      expect(perception.has('target')).toBe(false);
      expect(combat.get('target')).toBe(2);
    });

    it('returns false from delete() when the scoped key was absent', () => {
      const bb = new Blackboard();
      const perception = bb.scope<PerceptionScope>('perception');
      expect(perception.delete('target')).toBe(false);
    });

    it('nests scopes — composed prefix addresses outer:inner:<key>', () => {
      const bb = new Blackboard();
      const outer = bb.scope('outer');
      const inner = outer.scope('inner');

      inner.set('value', 42);

      // Both inner and a freshly composed outer-then-inner view see it.
      expect(inner.get('value')).toBe(42);
      expect(bb.scope('outer').scope('inner').get('value')).toBe(42);
      // The on-store key reflects full composition.
      expect(Array.from(bb.keys())).toContain('outer:inner:value');
    });

    it('clears nested scopes without affecting siblings or parents', () => {
      const bb = new Blackboard();
      const outer = bb.scope('outer');
      const innerA = outer.scope('innerA');
      const innerB = outer.scope('innerB');

      innerA.set('value', 'a');
      innerB.set('value', 'b');
      outer.set('outerOnly', 'kept');

      innerA.clear();

      expect(innerA.size).toBe(0);
      expect(innerA.has('value')).toBe(false);
      // innerB and outer-only writes are untouched.
      expect(innerB.get('value')).toBe('b');
      expect(outer.get('outerOnly')).toBe('kept');
    });

    it('outer.clear() removes nested scopes that share its prefix', () => {
      // The contract is "every entry with this scope's prefix" — nested
      // scopes are addressed as `outer:inner:<key>` so they share the
      // outer prefix and must be removed by outer.clear(). This matches
      // the natural "subtree reset" mental model.
      const bb = new Blackboard();
      const outer = bb.scope('outer');
      const inner = outer.scope('inner');
      inner.set('value', 1);
      bb.set('siblingTopLevel', 'survive');

      outer.clear();

      expect(inner.has('value')).toBe(false);
      expect(outer.size).toBe(0);
      expect(bb.get('siblingTopLevel')).toBe('survive');
    });

    it('rejects empty scope prefixes', () => {
      const bb = new Blackboard();
      expect(() => bb.scope('')).toThrow(/non-empty/i);
    });

    it('rejects scope prefixes containing the separator', () => {
      // Embedding a `:` in the prefix would alias `a:b:key` between a
      // single-level scope `'a:b'` and a nested `'a' -> 'b'` scope —
      // which would silently cross-contaminate the namespaces.
      const bb = new Blackboard();
      expect(() => bb.scope('a:b')).toThrow(/separator/i);
      const outer = bb.scope('outer');
      expect(() => outer.scope('inner:trick')).toThrow(/separator/i);
    });

    it('preserves determinism — identical scoped writes yield identical iteration', () => {
      const a = new Blackboard();
      const b = new Blackboard();

      const aPerception = a.scope('perception');
      aPerception.set('target', 1);
      a.set('top', 'x');

      const bPerception = b.scope('perception');
      bPerception.set('target', 1);
      b.set('top', 'x');

      expect(Array.from(a.entries())).toEqual(Array.from(b.entries()));
    });

    it('survives a parent clear/reseed cycle without rebinding', () => {
      // Replay scrub: the runner clears+reseeds the root Blackboard.
      // Existing scoped views must keep working — they hold a Map
      // reference, not a snapshot, so reads after the cycle reflect
      // whatever the parent now contains.
      const bb = new Blackboard();
      const perception = bb.scope<PerceptionScope>('perception');
      perception.set('target', 9);

      bb.clear();
      expect(perception.has('target')).toBe(false);

      // Re-seed via the scope after the clear — the same view still
      // writes into the same shared Map.
      perception.set('target', 10);
      expect(perception.get('target')).toBe(10);
      expect(bb.get('perception:target')).toBe(10);
    });
  });
});
