/**
 * Creature runtime — post-M2 creature subsystem (M6.6).
 *
 * Phaser entity that pairs a {@link CreatureSpec} with a live Matter
 * body and a per-frame AI tick. A summoned creature is conceptually
 * a "weak NPC fighter": it has HP (not a percent meter), it can be
 * damaged by attack hitboxes, it chases / attacks nearby enemies,
 * and it despawns by spec-declared lifecycle policy (timer / HP
 * zero / owner KO / explicit recall).
 *
 * # Friendly-fire safety
 *
 * Implements {@link Actor} so the hit-resolver can route damage
 * through `canDamage(attacker, target)`. The creature's
 * `ownerActorId` is the Matter body id of the summoner; an
 * incoming hit from the summoner is dropped, and any hitbox the
 * creature spawns carries the same `ownerActorId` so it can't
 * damage the summoner either.
 *
 * # AI surface — minimum viable
 *
 * The first cut uses a simple scripted chase loop instead of
 * the full BehaviorTree integration:
 *
 *   • Find the nearest non-owner Actor within `spec.ai.aggroRangePx`
 *   • If none, return to the owner's position (passive follow)
 *   • If one is in range, walk toward it horizontally and call
 *     `attemptChaseAttack` on contact
 *
 * A future sub-task swaps this for a real {@link BehaviorTree}
 * driven by the existing AI infrastructure once the runtime
 * proves out.
 *
 * # Determinism
 *
 * Every per-tick state mutation is a pure function of `(spec, hp,
 * position, target world-state, current frame)`. The body's
 * physics integration is the canonical Matter step from the
 * deterministic engine. No `Math.random`, no `Date.now`.
 *
 * # Sprite gap
 *
 * The first cut renders a minimal placeholder (a colored circle)
 * with an explicit TODO referencing the project memory feedback on
 * "use real sprites, not ugly rectangles." The Phaser visual
 * indirection lives in the `attachVisual` method so a future pass
 * can swap in a real CC0 atlas without touching gameplay code.
 */

import type { Actor } from '../actors/Actor';
import { canDamage } from '../actors/Actor';
import type { HitInfo } from '../characters/combat';
import { computeKnockback } from '../characters/combat';
import type { CreatureSpec } from './creatureSchema';

/**
 * Minimal scene shape needed by Creature. Mirrors the
 * Phaser-free interface pattern used by `attacks.ts:HitboxScene`
 * so this module stays unit-testable.
 */
export interface CreatureScene {
  matter: {
    add: {
      rectangle(
        x: number,
        y: number,
        w: number,
        h: number,
        options: Record<string, unknown>,
      ): unknown;
    };
    body: {
      setVelocity(body: unknown, v: { x: number; y: number }): void;
      setPosition(body: unknown, v: { x: number; y: number }): void;
    };
    world: {
      remove(body: unknown): void;
    };
  };
}

/** Constructor options. */
export interface CreatureOptions {
  /** Validated CreatureSpec the entity is built from. */
  readonly spec: CreatureSpec;
  /** Stable owner id — typically the summoner's Matter body id stringified. */
  readonly ownerActorId: string;
  /** World spawn position. */
  readonly spawnX: number;
  readonly spawnY: number;
  /** Frame the creature spawned (used by the timer-despawn policy). */
  readonly spawnedAtFrame: number;
  /**
   * Optional faction marker. Default `null` (free-for-all). Future
   * team-mode wiring sets this to a shared faction id with the owner.
   */
  readonly factionId?: string | null;
}

/**
 * Read-only Actor target shape the AI chases. The runtime supplies
 * a list of these each tick (the live characters + other creatures);
 * the creature picks the nearest non-owner one within aggro range.
 *
 * Decoupled from the concrete Character / Creature classes so tests
 * can fabricate targets without booting Phaser.
 */
export interface CreatureAITarget {
  readonly actorId: string;
  readonly ownerActorId: string | null;
  readonly factionId: string | null;
  readonly position: { readonly x: number; readonly y: number };
  isAlive(): boolean;
  applyHit(hit: HitInfo): unknown;
}

export class Creature implements Actor {
  readonly actorId: string;
  readonly actorKind = 'creature' as const;
  readonly ownerActorId: string;
  readonly factionId: string | null;
  readonly spec: CreatureSpec;
  readonly spawnedAtFrame: number;

  private hp: number;
  private destroyed = false;
  private positionX: number;
  private positionY: number;
  private velocityX = 0;
  private velocityY = 0;
  /** Frames since the last attack attempt — gates the cadence. */
  private framesSinceLastAttack: number;
  /** Live Matter body if the scene attached one; null in unit-test mode. */
  body: unknown = null;

  constructor(
    private readonly scene: CreatureScene | null,
    options: CreatureOptions,
  ) {
    this.spec = options.spec;
    this.ownerActorId = options.ownerActorId;
    this.factionId = options.factionId ?? null;
    this.actorId = `creature.${options.spec.id}.${options.spawnedAtFrame}`;
    this.spawnedAtFrame = options.spawnedAtFrame;
    this.hp = options.spec.maxHp;
    this.positionX = options.spawnX;
    this.positionY = options.spawnY;
    this.framesSinceLastAttack = options.spec.ai.attackCadenceFrames;

    if (this.scene !== null) {
      this.body = this.scene.matter.add.rectangle(
        options.spawnX,
        options.spawnY,
        options.spec.body.width,
        options.spec.body.height,
        {
          label: 'creature.body',
          isSensor: false,
          chamfer: { radius: options.spec.body.chamfer },
          mass: options.spec.movement.mass,
          friction: 0,
          frictionAir: 0,
          plugin: {
            actorId: this.actorId,
            ownerActorId: this.ownerActorId,
            factionId: this.factionId,
            characterId: options.spec.id,
          },
        },
      );
    }
  }

  // -------------------------------------------------------------------------
  // Actor interface
  // -------------------------------------------------------------------------

  /**
   * Apply an incoming hit. Drops HP by `hit.damage` and despawns the
   * creature if HP reaches zero AND the spec opted into the
   * `'onHpZero'` policy. Knockback impulse is applied to the body so
   * a creature getting hit visibly recoils.
   *
   * Friendly-fire enforcement is handled at the hit-resolver layer
   * via `canDamage(attacker, target)`; this method assumes the call
   * survived that gate.
   */
  applyHit(hit: HitInfo): { hp: number; killed: boolean } {
    if (this.destroyed) {
      return { hp: 0, killed: false };
    }
    this.hp = Math.max(0, this.hp - Math.max(0, hit.damage));
    // Push the body via the canonical knockback math. Creatures use
    // their `mass` from the movement profile so heavier creatures
    // resist knockback more.
    const result = computeKnockback(
      hit,
      0, // creatures have no percent meter — knockback grows only with the move's authored values
      this.spec.movement.mass,
    );
    this.velocityX = result.vector.x;
    this.velocityY = result.vector.y;
    if (this.scene !== null && this.body !== null) {
      this.scene.matter.body.setVelocity(this.body, {
        x: result.vector.x,
        y: result.vector.y,
      });
    }
    const killed =
      this.hp === 0 && this.spec.despawnPolicies.includes('onHpZero');
    if (killed) {
      this.destroy();
    }
    return { hp: this.hp, killed };
  }

  isAlive(): boolean {
    return !this.destroyed && this.hp > 0;
  }

  // -------------------------------------------------------------------------
  // Per-tick AI
  // -------------------------------------------------------------------------

  /**
   * Advance one fixed step of the creature's AI + lifecycle. Called
   * once per fixed step from the scene's update loop.
   *
   *   • Drains the timer-despawn counter (if `spec.despawnPolicies`
   *     includes `'timer'`).
   *   • Decides on an aggro target (nearest non-owner Actor within
   *     `spec.ai.aggroRangePx`).
   *   • Walks toward the target horizontally up to `maxRunSpeed`.
   *   • Calls `attemptChaseAttack` on the target if the chase-attack
   *     cadence allows AND the target is in attack-hitbox range.
   *
   * Returns metadata about what happened so the runtime can fire
   * visual / audio side effects from a single source.
   */
  tickAI(
    currentFrame: number,
    targets: ReadonlyArray<CreatureAITarget>,
    ownerPosition: { readonly x: number; readonly y: number } | null,
  ): {
    readonly hit: { target: CreatureAITarget; hit: HitInfo } | null;
    readonly despawned: boolean;
  } {
    if (this.destroyed) return { hit: null, despawned: true };
    // Timer-despawn drain.
    if (
      this.spec.despawnPolicies.includes('timer') &&
      this.spec.lifetimeFrames !== undefined
    ) {
      if (currentFrame - this.spawnedAtFrame >= this.spec.lifetimeFrames) {
        this.destroy();
        return { hit: null, despawned: true };
      }
    }

    // Pick the nearest non-friendly target within aggro range.
    let nearest: CreatureAITarget | null = null;
    let nearestDist = Infinity;
    for (const t of targets) {
      if (!t.isAlive()) continue;
      if (
        !canDamage(
          {
            actorId: this.actorId,
            ownerActorId: this.ownerActorId,
            factionId: this.factionId,
          },
          t,
        )
      ) {
        continue;
      }
      const dx = t.position.x - this.positionX;
      const dy = t.position.y - this.positionY;
      const d = Math.hypot(dx, dy);
      if (d <= this.spec.ai.aggroRangePx && d < nearestDist) {
        nearest = t;
        nearestDist = d;
      }
    }

    let hit: { target: CreatureAITarget; hit: HitInfo } | null = null;
    if (nearest !== null) {
      // Leash: bail if we've drifted too far from the owner.
      if (
        ownerPosition !== null &&
        Math.hypot(
          this.positionX - ownerPosition.x,
          this.positionY - ownerPosition.y,
        ) > this.spec.ai.leashRangePx
      ) {
        nearest = null;
      }
    }
    if (nearest !== null) {
      // Move toward target horizontally.
      const dx = nearest.position.x - this.positionX;
      const facing: 1 | -1 = dx >= 0 ? 1 : -1;
      const targetVx = facing * this.spec.movement.maxRunSpeed;
      this.velocityX = targetVx;
      // Attempt a chase attack if cadence permits and the chase-attack
      // hitbox would overlap the target.
      this.framesSinceLastAttack += 1;
      const chase = this.spec.moveset.chaseAttack;
      if (
        chase !== undefined &&
        this.framesSinceLastAttack >= this.spec.ai.attackCadenceFrames
      ) {
        const reach = chase.hitbox.offsetX + chase.hitbox.width / 2;
        if (Math.abs(dx) <= reach + this.spec.body.width / 2) {
          this.framesSinceLastAttack = 0;
          // Apply the hit directly (no separate hitbox spawn — the
          // creature's chase attack is an instant resolve to keep the
          // first runtime cut simple). A future iteration can wire
          // this through `spawnHitbox` so the standard hitbox-deeper
          // pipeline (hitlag, knockback scaling, etc.) catches it.
          const hitInfo: HitInfo = {
            damage: chase.damage,
            knockback: chase.knockback,
            facing,
          };
          hit = { target: nearest, hit: hitInfo };
        }
      }
    } else if (ownerPosition !== null) {
      // Passive follow — drift toward owner at half-speed when no aggro target.
      const dx = ownerPosition.x - this.positionX;
      const facing: 1 | -1 = dx >= 0 ? 1 : -1;
      // Only move if we're outside a small "comfort radius" of the owner.
      if (Math.abs(dx) > 60) {
        this.velocityX = facing * (this.spec.movement.maxRunSpeed * 0.5);
      } else {
        this.velocityX *= this.spec.movement.groundDamping;
      }
    }

    // Apply velocity to the body if attached.
    if (this.scene !== null && this.body !== null) {
      this.scene.matter.body.setVelocity(this.body, {
        x: this.velocityX,
        y: this.velocityY,
      });
    }
    return { hit, despawned: false };
  }

  // -------------------------------------------------------------------------
  // Read-only accessors
  // -------------------------------------------------------------------------

  getHp(): number {
    return this.hp;
  }

  getMaxHp(): number {
    return this.spec.maxHp;
  }

  getPosition(): { readonly x: number; readonly y: number } {
    return { x: this.positionX, y: this.positionY };
  }

  /**
   * Sync runtime position from an external authority (typically the
   * Matter body's post-step position). Tests + runtime call this so
   * the AI tick reads the up-to-date position.
   */
  setPosition(x: number, y: number): void {
    this.positionX = x;
    this.positionY = y;
  }

  /**
   * Force-despawn — used by the `'onOwnerKO'` and `'onOwnerCommand'`
   * lifecycle paths. Idempotent.
   */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.scene !== null && this.body !== null) {
      this.scene.matter.world.remove(this.body);
    }
    this.body = null;
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }
}
