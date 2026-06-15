/**
 * Per-fighter attack-registration helper — Sub-AC 3 of the T2 refactor.
 *
 * The base {@link Character} class no longer carries the type-aware
 * "fill which dispatch slot" logic. That logic lived on the legacy
 * `Character.registerAttack(move)` method; Sub-AC 3 of the T2 refactor
 * extracts it into this leaf module so the base class only owns
 * *storage scaffolding* (the moveset Map, the dispatch slot fields, the
 * setters / getters) — never the policy that decides which slot a move
 * belongs to. Each per-fighter subclass (Wolf, Cat, Owl, Bear) uses the
 * helper exported here from inside its own constructor to populate the
 * scaffolding from its authored move records.
 *
 * Architectural goals satisfied:
 *
 *   1. **Zero attack-implementation code in shared base** — the policy
 *      ("a `'jab'`-typed move fills the light slot", "an `'aerial'`
 *      move with `aerialDirection: 'forward'` fills the
 *      aerialForward slot", …) does not appear inside `Character.ts`.
 *      A `grep registerAttack src/characters/Character.ts` returns 0.
 *
 *   2. **Per-fighter ownership** — each subclass calls
 *      {@link registerFighterAttack} once per move, the helper returns
 *      no value (mutates the character through its public scaffolding
 *      surface), and the subclass gets the same auto-fill semantics the
 *      legacy method shipped without the base class needing to know
 *      about move taxonomy.
 *
 *   3. **Backwards compatibility for tests** — the legacy
 *      `Character.prototype.registerAttack` method is restored at
 *      module load via TypeScript declaration merging + a thin
 *      prototype-assignment shim. Existing tests that call
 *      `ch.registerAttack(...)` continue to work without modification
 *      because anyone who imports the per-fighter classes (Wolf, Cat,
 *      Owl, Bear) transitively imports this module, and the test suites
 *      that drive the base class directly (`Character.test.ts`,
 *      `combatSfx.test.ts`) are seeded with a side-effect import of
 *      this module so the prototype shim is installed before any test
 *      runs.
 *
 *   4. **Open / closed for the T3 item framework** — items declare slot
 *      overrides via the same {@link AttackMovesetSlotName} taxonomy
 *      this helper consumes. Adding a hypothetical 4th item only
 *      requires authoring its move record + override declaration; the
 *      registration / dispatch path here keeps working unchanged.
 *
 * Determinism: pure data routing — no `Math.random()`, no wall-clock
 * reads, no Phaser / Matter side effects. Identical inputs always
 * produce identical mutations on the supplied character.
 */

import type { AttackMove } from './attacks';
import type { AerialDirection, AerialMove } from './aerialSchema';
import { Character } from './Character';

// ---------------------------------------------------------------------------
// Free-function entry point — the canonical post-refactor API.
// ---------------------------------------------------------------------------

/**
 * Register a single move on a fighter. Mirrors the slot-wiring contract
 * the legacy `Character.registerAttack` method enforced:
 *
 *   • The move is added to the {@link Character} instance's moveset map.
 *   • The first move passed (regardless of type) becomes the default
 *     attack id (the rising-edge `attack`-button fallback).
 *   • The move's `type` selects which dispatch slot it fills (only if
 *     that slot is still empty — a subsequent move of the same type
 *     does NOT overwrite an earlier registration):
 *
 *       'jab'         → light slot (and the legacy default)
 *       'tilt'        → light slot AND tilt slot
 *       'smash'       → heavy slot
 *       'special'     → neutral-special slot
 *       'sideSpecial' → no dedicated dispatch slot today (looked up
 *                       on demand by the executeSideSpecial hook)
 *       'upSpecial'   → up-special slot
 *       'downSpecial' → down-special slot
 *       'aerial'      → legacy aerial slot AND directional aerial slot
 *                       (forward / back / neutral) per `aerialDirection`
 *
 * Pass-through to the supplied character's *public* scaffolding methods
 * — never reaches into private fields. That keeps the base class's
 * encapsulation intact: the helper composes `addAttack`, `setDefault*`,
 * and the dispatch slot setters; the base class still owns the storage
 * and the throw-on-unknown-id guards.
 */
export function registerFighterAttack(
  character: Character,
  move: AttackMove,
): void {
  // Add to the moveset map first so the slot setters' "throw on
  // unregistered id" guards see the id as registered.
  character.addAttack(move);

  // First-registered-move fallback. Mirrors the historical contract:
  // a single-move test fighter (one `jab` registered) fires that move
  // on every `attack` rising edge regardless of stick / facing.
  if (character.getDefaultAttackId() === null) {
    character.setDefaultAttack(move.id);
  }

  // Type-aware slot wiring. Each branch only assigns when the target
  // slot is still empty — a subsequent registration of the same type
  // does NOT overwrite the first one (preserves the canonical
  // "first-registered wins" contract).
  if (move.type === 'jab' || move.type === 'tilt') {
    if (character.getLightAttackId() === null) {
      character.setLightAttack(move.id);
    }
    // Dedicated tilt slot — only `'tilt'`-typed moves fill it. The
    // grounded "directional tap + attack" classifier reads this slot
    // first; if empty, it cascades through the light slot so a
    // single-jab roster keeps firing on every grounded press.
    if (move.type === 'tilt' && character.getTiltAttackId() === null) {
      character.setTiltAttack(move.id);
    }
  } else if (move.type === 'smash') {
    if (character.getHeavyAttackId() === null) {
      character.setHeavyAttack(move.id);
    }
  } else if (move.type === 'special') {
    if (character.getNeutralSpecialId() === null) {
      character.setNeutralSpecial(move.id);
    }
  } else if (move.type === 'upSpecial') {
    if (character.getUpSpecialId() === null) {
      character.setUpSpecial(move.id);
    }
  } else if (move.type === 'downSpecial') {
    if (character.getDownSpecialId() === null) {
      character.setDownSpecial(move.id);
    }
  } else if (move.type === 'aerial') {
    // Legacy single-aerial slot — first 'aerial' registered wins.
    if (character.getAerialAttackId() === null) {
      character.setAerialAttack(move.id);
    }

    // Directional dispatch. Read `aerialDirection` off the move (only
    // present on full `AerialMove` records); plain `AttackMove`-typed
    // aerials (legacy WOLF_NAIR / CAT_NAIR) implicitly fall through
    // to the neutral slot so they keep dispatching on any airborne
    // press exactly as before.
    const direction: AerialDirection =
      (move as Partial<AerialMove>).aerialDirection ?? 'neutral';
    if (direction === 'forward') {
      if (character.getAerialForwardId() === null) {
        character.setAerialForward(move.id);
      }
    } else if (direction === 'back') {
      if (character.getAerialBackId() === null) {
        character.setAerialBack(move.id);
      }
    } else if (direction === 'up') {
      if (character.getAerialUpId() === null) {
        character.setAerialUp(move.id);
      }
    } else if (direction === 'down') {
      if (character.getAerialDownId() === null) {
        character.setAerialDown(move.id);
      }
    } else {
      // 'neutral' — fill the neutral slot.
      if (character.getAerialNeutralId() === null) {
        character.setAerialNeutral(move.id);
      }
    }
  }
  // 'sideSpecial' — no dedicated dispatch slot today. The base class's
  // {@link Character.executeSideSpecial} hook scans the moveset map for
  // a `'sideSpecial'`-typed move on demand. Future sub-AC may add a
  // first-class slot field; until then the registration is purely
  // additive (the move sits in the moveset map and fires when the
  // hook routes to it).
}

// ---------------------------------------------------------------------------
// Backwards-compatibility shim for direct `ch.registerAttack(...)` calls.
//
// The legacy method name is preserved on `Character.prototype` via
// declaration merging + prototype assignment. Importing this module
// (which the per-fighter subclasses do) installs the method as a
// side-effect of module load. Test suites that drive the base
// {@link Character} class directly should add a side-effect import of
// this module too — `import './attackRegistration';` — so the
// prototype shim is in place before they call `ch.registerAttack(...)`.
// ---------------------------------------------------------------------------

declare module './Character' {
  interface Character {
    /**
     * Legacy entry point preserved for backwards compatibility. New
     * call sites should prefer the free function
     * {@link registerFighterAttack} which makes the per-fighter
     * ownership of the slot-wiring policy explicit. The two are
     * exactly equivalent — this method is a thin wrapper that calls
     * the free function with `this` as the first argument.
     */
    registerAttack(move: AttackMove): void;
  }
}

if (typeof (Character.prototype as { registerAttack?: unknown }).registerAttack !== 'function') {
  (Character.prototype as { registerAttack: (move: AttackMove) => void }).registerAttack =
    function registerAttack(this: Character, move: AttackMove): void {
      registerFighterAttack(this, move);
    };
}
