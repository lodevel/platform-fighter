/**
 * Actor abstraction — post-M2 unified damageable-entity contract.
 *
 * Three flavors of damageable entity exist (or will exist) in the
 * world:
 *
 *   1. **Character** — player-controlled fighter. Damage is tracked
 *      as a percent meter; "death" = stocks-exhausted. Already
 *      implemented in `src/characters/Character.ts`.
 *
 *   2. **Creature** — AI-controlled summoned entity. Damage is
 *      tracked as integer HP; "death" = HP reaches 0 (despawn).
 *      Foundation in `src/creatures/`; runtime class lands in M6.5.
 *
 *   3. **Item** — projectile / pickup / hazard body. Already
 *      implemented in `src/items/` with a self-contained shape.
 *
 * # The Actor contract
 *
 * Every damageable entity exposes:
 *
 *   • `actorId: string`              — stable per-instance id
 *   • `actorKind: ActorKind`         — discriminator for runtime branching
 *   • `ownerActorId: string | null`  — the actor that summoned this
 *                                       (null for Characters and
 *                                       independent Items; non-null
 *                                       for summoned Creatures and
 *                                       owned projectiles)
 *   • `factionId: string | null`     — team-mode marker (future); for
 *                                       now `null` for free-for-all
 *   • `applyHit(hit: HitInfo)`       — accept incoming damage
 *   • `isAlive(): boolean`           — runtime liveness check
 *
 * # Owner-only friendly fire
 *
 * The hitbox damage handler enforces:
 *
 *     attacker.actorId === target.ownerActorId  → ignore
 *     attacker.ownerActorId === target.actorId  → ignore
 *
 * The two-direction check covers both "your creature can't hit you"
 * and "you can't hit your own creature." A future team-mode
 * extension adds:
 *
 *     attacker.factionId === target.factionId   → ignore (when factionId !== null)
 *
 * Today's mode is free-for-all: factionId is always null and the
 * faction check is a no-op.
 *
 * # Why an interface, not an abstract class
 *
 *   • Character is a 4000-line concrete class with deep Phaser/Matter
 *     coupling — refactoring it under a `class extends Actor` would
 *     touch every call site.
 *   • Creature is a fresh class that can implement Actor cleanly.
 *   • An interface lets each implementation own its physics shape
 *     (Character has a percent meter, Creature has HP) while the
 *     hit-resolver reads the same surface.
 */

import type { HitInfo } from '../characters/combat';

/** Discriminator for runtime branching on actor kind. */
export type ActorKind = 'character' | 'creature' | 'item';

/**
 * Damageable-entity contract. Implemented by Character (lazily —
 * the existing class already exposes the methods this interface
 * declares; a future sub-task adds an `implements Actor` for type
 * safety) and by Creature (M6.5).
 */
export interface Actor {
  /** Stable per-instance id — typically the underlying body's numeric id stringified. */
  readonly actorId: string;
  /** Discriminator for the hit-resolver and debug HUDs. */
  readonly actorKind: ActorKind;
  /**
   * Id of the actor that summoned / owns this one. `null` for
   * standalone entities (Characters, independent Items).
   */
  readonly ownerActorId: string | null;
  /**
   * Team / faction marker. `null` in free-for-all. Future team
   * modes set this to a shared id across allied players + their
   * summons.
   */
  readonly factionId: string | null;
  /** Apply an incoming hit (damage + knockback + hitstun, etc.). */
  applyHit(hit: HitInfo): unknown;
  /** True iff the actor is still in the world and can take hits. */
  isAlive(): boolean;
}

/**
 * Pure friendly-fire predicate. Returns `true` if the attacker
 * SHOULD damage the target (no friendly-fire conflict). Returns
 * `false` if the hit must be ignored.
 *
 * Rules (in order):
 *
 *   1. Self-hit: same actor → ignore.
 *   2. Owner protection: if either actor's `ownerActorId` matches
 *      the other's `actorId`, ignore.
 *   3. Same faction: if both actors share a non-null `factionId`,
 *      ignore.
 *   4. Otherwise: allow.
 *
 * Pure — no side effects, no I/O. Safe to call from inside the
 * deterministic physics tick.
 */
export function canDamage(
  attacker: Pick<Actor, 'actorId' | 'ownerActorId' | 'factionId'>,
  target: Pick<Actor, 'actorId' | 'ownerActorId' | 'factionId'>,
): boolean {
  // 1. Self-hit
  if (attacker.actorId === target.actorId) return false;
  // 2. Owner-only friendly fire (both directions)
  if (attacker.ownerActorId === target.actorId) return false;
  if (target.ownerActorId === attacker.actorId) return false;
  // 3. Same faction
  if (
    attacker.factionId !== null &&
    target.factionId !== null &&
    attacker.factionId === target.factionId
  ) {
    return false;
  }
  return true;
}
