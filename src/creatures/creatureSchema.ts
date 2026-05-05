/**
 * Creature spec schema — post-M2 creature subsystem (M6).
 *
 * Declarative shape for a "summonable creature" — a non-player
 * Actor that a fighter can call into the world via a `'summon'`
 * special move. Creatures are the user's vision of "creatures
 * invoked that have their own moveset and actions and tied to a
 * character (so they can't hurt them)."
 *
 * # Design canvas (M6 chosen defaults)
 *
 *   • **Lifecycle** — composable. Each spec declares one of:
 *       - `'timer'`      → despawn after `lifetimeFrames`
 *       - `'onHpZero'`   → despawn when HP drains to zero
 *       - `'onOwnerKO'`  → despawn when summoner loses a stock
 *       - `'onOwnerCommand'` → despawn on summoner-issued recall
 *     Combinations land via the runtime check (e.g. timer + HpZero
 *     means "whichever fires first").
 *
 *   • **Faction** — owner-only friendly fire. A creature owned by
 *     player X can damage everyone EXCEPT player X (and X's other
 *     creatures, since they share `ownerId`). The hitbox damage
 *     handler enforces this via `ownerId === target.ownerId →
 *     ignore`. Team-mode allyship is a future extension that adds
 *     a separate `factionId` field; for now the design is just
 *     "your minions can't hit you."
 *
 *   • **Complexity** — opt-in per spec. Every creature declares
 *     which moves it has (small subset of the Character moveset:
 *     typically a single attack + maybe a special). A dumb
 *     "chase-and-bite" minion has just `chaseAttack`; a
 *     boss-summon could have a fuller kit.
 *
 *   • **Cap per summoner** — `maxConcurrent` on the SummonSpec
 *     (lives on the special move that summons this creature).
 *
 * # Sprite handling (per project memory)
 *
 * The user has a strong preference for real sprites (not rectangle
 * placeholders). Each creature spec carries `spriteKey: string |
 * null`. `null` is allowed during initial implementation as long as
 * the creature isn't shipped to players in that state — the
 * sprite-pipeline owner will supply a CC0 sprite (Kenney / OpenGameArt
 * pattern) before the creature appears in a real match. The
 * `playable` flag distinguishes "spec exists, sprite still pending"
 * from "spec is ready to use in a match."
 *
 * # Determinism
 *
 * Every value is a frozen finite literal. AI behaviour (the future
 * sub-task) reads frozen behaviour-tree definitions; identical
 * inputs always produce identical creature trajectories.
 */

import type { AttackMoveWithAnimation } from './../characters/moveSchema';

/** Stable creature id (e.g. 'wolfPup', 'magicOrb', 'bearCub'). */
export type CreatureId = string;

/**
 * Lifecycle policies a creature can subscribe to. Multiple can be
 * present (timer + onOwnerKO is a common combo); whichever condition
 * fires first wins.
 */
export type CreatureDespawnPolicy =
  | 'timer'
  | 'onHpZero'
  | 'onOwnerKO'
  | 'onOwnerCommand';

/**
 * A creature's combat surface. Each field is optional — a "dumb
 * minion" can ship with just `chaseAttack`; a richer creature can
 * layer on a special / projectile.
 */
export interface CreatureMoveset {
  /**
   * Primary contact attack. Spawned as a Matter sensor body any
   * time the AI's "attack" tick fires. Same shape as the Character
   * `AttackMove`s so the runtime hitbox path is shared.
   */
  readonly chaseAttack?: AttackMoveWithAnimation;
  /** Optional secondary special (e.g. ranged shot, area buff). */
  readonly special?: AttackMoveWithAnimation;
}

/** Per-creature movement profile — subset of FighterMovementProfile. */
export interface CreatureMovementProfile {
  readonly maxRunSpeed: number;
  readonly groundAccel: number;
  readonly airAccel: number;
  readonly groundDamping: number;
  readonly airDamping: number;
  readonly jumpImpulse: number;
  readonly maxJumps: number;
  readonly mass: number;
}

/** Body/hurtbox geometry for the Matter rectangle. */
export interface CreatureBody {
  readonly width: number;
  readonly height: number;
  readonly chamfer: number;
}

/**
 * AI behaviour summary. Today this is a thin "chase the nearest
 * non-owner enemy and attack on contact" descriptor. A future
 * sub-task replaces it with a full BehaviorTree reference shared
 * with the existing AI infrastructure (`src/ai/behaviorTree.ts`).
 */
export interface CreatureAI {
  /**
   * Range in design pixels at which the creature commits to a
   * target. Outside this range, the creature stays in passive
   * follow-owner behaviour.
   */
  readonly aggroRangePx: number;
  /**
   * Distance from the owner past which the creature breaks engagement
   * and returns. Prevents a creature from chasing a target across
   * the entire stage and abandoning its summoner.
   */
  readonly leashRangePx: number;
  /**
   * Approximate frames between attack attempts. The runtime gates
   * actual attempts on the chase-attack's cooldown; this is the
   * AI's pacing knob.
   */
  readonly attackCadenceFrames: number;
}

/**
 * Full per-creature declaration — equivalent to Character's
 * CharacterSpec but for the creature subsystem.
 */
export interface CreatureSpec {
  readonly id: CreatureId;
  readonly displayName: string;
  /**
   * Runtime sprite atlas key, or `null` while the visual asset is
   * still being sourced. A null `spriteKey` blocks shipping the
   * creature to players (`playable === false`); the creature spec
   * is still a valid data record for tests + tooling.
   */
  readonly spriteKey: string | null;
  /** True iff the creature is ready for live matches (sprites ready, AI tuned). */
  readonly playable: boolean;
  readonly body: CreatureBody;
  readonly movement: CreatureMovementProfile;
  /** Initial / max HP (creatures use HP, not % damage like Characters). */
  readonly maxHp: number;
  readonly moveset: CreatureMoveset;
  readonly ai: CreatureAI;
  /**
   * Despawn policies that apply to this creature. The runtime
   * checks each one per fixed step; the first to trigger wins.
   */
  readonly despawnPolicies: ReadonlyArray<CreatureDespawnPolicy>;
  /**
   * Frames the creature lives in the world before timer-based
   * despawn fires. Required iff `despawnPolicies` includes
   * `'timer'`. Ignored for purely event-driven despawn policies.
   */
  readonly lifetimeFrames?: number;
}

/**
 * Validate a {@link CreatureSpec} satisfies its invariants. Throws
 * on the first violation; returns the spec unchanged on success.
 */
export function validateCreatureSpec(
  spec: CreatureSpec,
  contextLabel = `CreatureSpec '${spec.id}'`,
): CreatureSpec {
  if (typeof spec.id !== 'string' || spec.id.length === 0) {
    throw new Error(`${contextLabel}: id must be a non-empty string`);
  }
  if (typeof spec.displayName !== 'string' || spec.displayName.length === 0) {
    throw new Error(`${contextLabel}: displayName must be a non-empty string`);
  }
  if (spec.body.width <= 0 || spec.body.height <= 0) {
    throw new Error(
      `${contextLabel}: body dimensions must be positive (got ${spec.body.width}x${spec.body.height})`,
    );
  }
  if (!Number.isFinite(spec.maxHp) || spec.maxHp <= 0) {
    throw new Error(
      `${contextLabel}: maxHp must be positive, got ${spec.maxHp}`,
    );
  }
  if (spec.movement.mass <= 0) {
    throw new Error(`${contextLabel}: movement.mass must be positive`);
  }
  if (spec.ai.aggroRangePx <= 0) {
    throw new Error(`${contextLabel}: ai.aggroRangePx must be positive`);
  }
  if (spec.ai.leashRangePx <= 0) {
    throw new Error(`${contextLabel}: ai.leashRangePx must be positive`);
  }
  if (
    !Number.isInteger(spec.ai.attackCadenceFrames) ||
    spec.ai.attackCadenceFrames <= 0
  ) {
    throw new Error(
      `${contextLabel}: ai.attackCadenceFrames must be positive integer`,
    );
  }
  if (spec.despawnPolicies.length === 0) {
    throw new Error(
      `${contextLabel}: must declare at least one despawn policy`,
    );
  }
  if (
    spec.despawnPolicies.includes('timer') &&
    (!Number.isInteger(spec.lifetimeFrames) || (spec.lifetimeFrames ?? 0) <= 0)
  ) {
    throw new Error(
      `${contextLabel}: 'timer' policy requires positive integer lifetimeFrames`,
    );
  }
  return spec;
}
