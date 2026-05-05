/**
 * Creature registry — post-M2 creature subsystem (M6).
 *
 * Single lookup table mapping {@link CreatureId} → {@link CreatureSpec}.
 * Mirrors the pattern of the character `roster.ts` so the runtime
 * has one well-known place to resolve "what does the wolf-pup spec
 * look like?" Useful for:
 *
 *   • Summon special-move dispatchers (the move declares
 *     `creatureId: 'wolfPup'` and the runtime looks up the spec
 *     here at spawn time).
 *   • Tests / debug HUDs / replay tooling.
 *   • The (later) creature-builder UI that lists every authored
 *     creature.
 *
 * Determinism: all registrations land at module load; the lookup
 * table is frozen.
 */

import { type CreatureId, type CreatureSpec, validateCreatureSpec } from './creatureSchema';

const REGISTRY = new Map<CreatureId, CreatureSpec>();

/**
 * Register a creature spec under its id. Validates eagerly so a
 * malformed spec fails at module load rather than the first summon.
 * Idempotent for identical specs (re-registering the same id with
 * the same fields is a no-op); throws on conflict (different specs
 * sharing an id).
 */
export function registerCreature(spec: CreatureSpec): void {
  validateCreatureSpec(spec);
  const existing = REGISTRY.get(spec.id);
  if (existing !== undefined) {
    if (JSON.stringify(existing) !== JSON.stringify(spec)) {
      throw new Error(
        `Creature id collision: '${spec.id}' is already registered with a different spec`,
      );
    }
    return;
  }
  REGISTRY.set(spec.id, Object.freeze(spec));
}

/**
 * Look up a creature spec by id. Throws if the id is unregistered —
 * a typo in a SummonSpecialMove's `creatureId` should fail loudly,
 * not silently spawn nothing.
 */
export function getCreatureSpec(id: CreatureId): CreatureSpec {
  const spec = REGISTRY.get(id);
  if (spec === undefined) {
    throw new Error(
      `Unknown creature id '${id}'. Registered: [${[...REGISTRY.keys()].join(', ')}]`,
    );
  }
  return spec;
}

/** True iff a creature with the given id is registered. */
export function hasCreature(id: CreatureId): boolean {
  return REGISTRY.has(id);
}

/** Snapshot of every registered creature spec, in insertion order. */
export function listCreatureSpecs(): ReadonlyArray<CreatureSpec> {
  return Object.freeze([...REGISTRY.values()]);
}

/**
 * Test-only helper — clears the registry. Used by unit tests that
 * register temporary specs to avoid leaking into other tests. NOT
 * exported through the package index; consumers must reach into
 * this module directly to access it.
 */
export function _resetCreatureRegistryForTests(): void {
  REGISTRY.clear();
}
