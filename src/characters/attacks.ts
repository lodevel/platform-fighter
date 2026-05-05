/**
 * Attack-move primitives shared by every fighter subclass.
 *
 * This module is the data layer for AC 202 Sub-AC 2: it declares the
 * shape of a basic attack (hitbox, damage value, frame timings,
 * cooldown), the Matter `label` stamped on every spawned hitbox body,
 * and the small body-factory used by `Character.attemptAttack` to emit
 * a sensor in front of the fighter. The class wires these primitives
 * into a per-frame state machine; concrete characters (Wolf, Cat, …)
 * register their `AttackMove` definitions at construction time.
 *
 * Why a separate file:
 *   • Keeps the base `Character` class readable — body construction
 *     and movement physics already live there.
 *   • Lets the M2 roster declare movesets as plain data tables next to
 *     each subclass without dragging in Phaser/Matter symbol soup.
 *   • Lets unit tests assert hitbox shape, damage, cooldown semantics
 *     against pure data, no rendering required.
 *
 * Determinism note: every value here is integer frames or a static
 * geometry offset. No wall-clock reads, no `Math.random()` — replays
 * driving identical inputs into a fighter constructed with the same
 * `AttackMove` table will spawn identical hitboxes on identical
 * frames.
 */

import type { MoveType } from '../types';
import { COLLISION_CATEGORIES, COLLISION_MASKS } from '../engine/collisionCategories';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Matter `label` stamped on every attack hitbox sensor body. */
export const HITBOX_LABEL = 'hitbox.attack';

/** Convenience alias for the canonical hitbox collision filter. */
export const HITBOX_COLLISION_FILTER = {
  category: COLLISION_CATEGORIES.HITBOX,
  mask: COLLISION_MASKS.HITBOX,
  group: 0,
} as const;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Static description of an attack move. All fields are required so a
 * subclass can't accidentally ship a half-defined attack — defaults
 * for "no special tuning" still mean writing them out (`scaling: 0`,
 * `recoveryFrames: 0`, etc.) which is what we want for clarity.
 *
 * Frame model (values in deterministic 60 Hz frames):
 *
 *   ── startupFrames ── activeFrames ── recoveryFrames ── cooldownFrames ──
 *   |                  | hitbox live |                  | locked out      |
 *   press                                                                  next press
 *
 *   total move-busy frames = startup + active + recovery
 *   cooldown is the gap *after* the move ends before another attack
 *   can begin. Combined "lockout" from press → next press is therefore
 *   `startup + active + recovery + cooldown`.
 */
export interface AttackMove {
  /** Stable identifier — used by AI / replay logs / debug overlays. */
  readonly id: string;
  /** Ontology bucket for this move — jab / tilt / smash / aerial / … */
  readonly type: MoveType;
  /** Damage applied on connect (added to the target's percent meter). */
  readonly damage: number;
  /**
   * Knockback vector at 0 % damage. Each component is in Matter
   * "px-per-step" units so multiplying by 60 gives px/sec.
   *
   * `scaling` is the per-percent multiplier — the realised knockback
   * vector at percent `p` is `(x, y) * (1 + scaling * p)`. A jab might
   * have `scaling: 0.05`; a finisher smash has `scaling: 0.4`+.
   */
  readonly knockback: { readonly x: number; readonly y: number; readonly scaling: number };
  /**
   * Hitbox sensor geometry, in design pixels, relative to the
   * fighter's centre. `offsetX` is mirrored by `facing` automatically
   * so subclasses can author their hitbox as if always facing right.
   */
  readonly hitbox: {
    readonly offsetX: number;
    readonly offsetY: number;
    readonly width: number;
    readonly height: number;
  };
  /** Frames between input press and hitbox going active. */
  readonly startupFrames: number;
  /** Frames the hitbox is live and can connect. */
  readonly activeFrames: number;
  /** Frames the fighter is committed after the hitbox ends. */
  readonly recoveryFrames: number;
  /** Frames after the move ends before any attack can start again. */
  readonly cooldownFrames: number;
  /**
   * Optional "sweet spot" sub-region — the canonical Smash idiom
   * where a portion of the move's hitbox (e.g. Marth's tipper, Falcon's
   * knee tip) lands harder than the rest. When the contact lands
   * within this sub-region the runtime treats the hit as a sweet-spot
   * connect:
   *
   *   • +4 frames of hitlag (extra crunch on impact — see
   *     `combat.ts:HITLAG_SWEET_SPOT_BONUS_FRAMES`).
   *   • Optional damage / knockback multipliers applied on top of the
   *     authored base values. Defaults of 1.0 mean "same damage, same
   *     knockback" — most moves only use the hitlag bonus.
   *
   * Geometry is authored in the same coordinate system as `hitbox` —
   * `offsetX` mirrored by attacker facing, `offsetY` taken as-is. The
   * sweet-spot region MUST be a strict sub-region of `hitbox` (the
   * runtime tests `pointInSweetSpot && pointInHitbox`); a region
   * outside the parent hitbox simply never fires the bonus.
   *
   * Omitted on the vast majority of moves — only signature kill moves
   * tend to author one (Wolf bair, smash sweet-spots, etc.).
   */
  readonly sweetSpot?: {
    readonly hitbox: {
      readonly offsetX: number;
      readonly offsetY: number;
      readonly width: number;
      readonly height: number;
    };
    readonly damageMultiplier?: number;
    readonly knockbackMultiplier?: number;
  };
  /**
   * When `true`, the fighter's sprite stays in its non-attack pose
   * (idle / run / jump / fall) while this move is in flight. The move
   * still applies damage / knockback / projectile spawning normally —
   * only the holder's *visual* swing animation is suppressed.
   *
   * Use case: ranged-weapon item moves (ray gun shot, etc.) where the
   * weapon does the visible work and the fighter's punch pose would
   * read as "I just punched air, AND somehow a laser also came out."
   * Melee item moves like the bat swing leave this `false` so the
   * arc of the swing is still visible.
   *
   * Defaults to `false` — existing moves keep their pose.
   */
  readonly suppressFighterPose?: boolean;
}

/**
 * Runtime instance state for an in-flight attack. Lives inside the
 * `Character` class — exposed read-only via `getActiveAttack()` for
 * tests, debug HUDs, and AI behaviour trees.
 */
export interface ActiveAttack {
  /** The static definition this instance was spawned from. */
  readonly move: AttackMove;
  /** Facing latched at attack start — hitbox geometry mirrors against this. */
  readonly facing: 1 | -1;
  /**
   * Phase of the attack:
   *   - 'startup'  : `framesElapsed < startupFrames` (no hitbox yet)
   *   - 'active'   : hitbox is in the world and can connect
   *   - 'recovery' : hitbox is gone; fighter still committed
   */
  readonly phase: 'startup' | 'active' | 'recovery';
  /** Frames since attack press (0 on the press frame itself). */
  readonly framesElapsed: number;
  /**
   * Live hitbox body — present only during the 'active' phase. The
   * sensor body has `label === HITBOX_LABEL` and a `plugin.ownerId`
   * field carrying the attacker's character id so collision handlers
   * can suppress self-hits.
   */
  readonly hitboxBody: MatterJS.BodyType | null;
}

/** Plugin metadata stamped on every hitbox body. Read by damage/KO handlers. */
export interface HitboxPlugin {
  readonly ownerId: string;
  /**
   * Numeric id of the attacker's Matter body. Used by the damage
   * handler's self-hit suppression so two instances of the same
   * character (e.g. Wolf P1 vs Wolf P2) can damage each other —
   * comparing `ownerId` alone would conflate "same instance" with
   * "same character kind" and silently swallow inter-mirror-match
   * damage. We store the integer id (not the body reference) so
   * Matter's deep-clone (`Common.extend`) doesn't recurse into the
   * attacker's body graph and stack-overflow at construction.
   */
  readonly ownerBodyId?: number;
  readonly moveId: string;
  readonly damage: number;
  readonly knockback: AttackMove['knockback'];
  readonly facing: 1 | -1;
  /**
   * Optional discriminator that distinguishes a regular attack
   * hitbox from a grab range-sensor (post-M2 grab/throw subsystem).
   *
   *   • `undefined` / `'attack'` → standard attack: contact applies
   *     damage + knockback via `Character.applyHit`.
   *   • `'grab'` → grab range-sensor: contact transitions both
   *     fighters into a held/grabbing pair (no immediate damage).
   *     The damage / knockback fields are typically zero on a grab
   *     sensor — the throw release fires the damage later via the
   *     target's `applyHit` from inside the grabber's tick.
   *
   * The damage handler reads this tag to route contact events to
   * the right resolver. Optional for back-compat — every existing
   * attack hitbox is implicitly `'attack'`.
   */
  readonly kind?: 'attack' | 'grab';
}

/**
 * Abstract scene shape we need to spawn / remove a Matter sensor.
 * Mirrors the surface used by `Character` — pulling it into a tiny
 * interface lets the unit tests construct fake scenes without a full
 * Phaser import (same pattern as `StageRenderer` and `Character`).
 *
 * `body.setPosition` is required by AC 60103 Sub-AC 3 — aerial hitboxes
 * track the attacker's position each fixed step so a fighter drifting
 * through the air during a fair / nair / bair carries the sensor with
 * him instead of leaving it where the body was on the spawn frame.
 */
export interface HitboxScene {
  matter: {
    add: {
      rectangle(
        x: number,
        y: number,
        w: number,
        h: number,
        options: Record<string, unknown>,
      ): MatterJS.BodyType;
    };
    body: {
      setInertia(body: MatterJS.BodyType, inertia: number): void;
      setPosition(body: MatterJS.BodyType, vec: { x: number; y: number }): void;
    };
    world: {
      remove(body: MatterJS.BodyType): void;
    };
  };
}

// ---------------------------------------------------------------------------
// Hitbox body factory
// ---------------------------------------------------------------------------

/**
 * Spawn the Matter sensor body for an attack hitbox. Centralised here
 * (instead of inlined in `Character`) so subclasses, projectiles, and
 * tests all build hitboxes through the same code path:
 *
 *   • The body is a `isSensor: true` rectangle — it generates collision
 *     events but never pushes the target around. The damage / knockback
 *     handler is responsible for translating "your hitbox touched me"
 *     into actual physics impulses.
 *   • The collision filter is the canonical HITBOX/CHARACTER pair from
 *     `engine/collisionCategories`, so character bodies opt-in to being
 *     hit (`COLLISION_MASKS.CHARACTER` already includes `HITBOX`).
 *   • The body's `plugin` bag carries the attacker's character id, the
 *     move id, the damage value, and the knockback vector. This is the
 *     contract the (later AC) damage handler reads — no reverse lookup
 *     into per-character state needed.
 *   • `friction*` and `restitution` are zeroed so a bug that leaves a
 *     hitbox in the world for an extra step still doesn't impart any
 *     spurious physics, and `setInertia(Infinity)` keeps the body from
 *     rotating if a future change drops `isSensor`.
 */
export function spawnHitbox(
  scene: HitboxScene,
  attacker: {
    id: string;
    position: { x: number; y: number };
    /**
     * Optional — Matter assigns each body a numeric `id`; when
     * present, the damage handler uses this for self-hit suppression
     * so mirror matches (Wolf P1 vs Wolf P2) deal damage instead of
     * being filtered out by character-id-equality. Pass the id as a
     * primitive (NOT the body reference) — the body holds back-
     * pointers into the world / parts / vertices and Matter's
     * `Common.extend` deep-clone would stack-overflow on it.
     */
    bodyId?: number;
  },
  move: AttackMove,
  facing: 1 | -1,
): MatterJS.BodyType {
  const offsetX = move.hitbox.offsetX * facing;
  const cx = attacker.position.x + offsetX;
  const cy = attacker.position.y + move.hitbox.offsetY;

  const plugin: HitboxPlugin = {
    ownerId: attacker.id,
    ownerBodyId: attacker.bodyId,
    moveId: move.id,
    damage: move.damage,
    knockback: move.knockback,
    facing,
  };

  const body = scene.matter.add.rectangle(cx, cy, move.hitbox.width, move.hitbox.height, {
    label: HITBOX_LABEL,
    isSensor: true,
    isStatic: false,
    // Hitboxes are short-lived sensors. Mass needs to be non-zero to
    // satisfy Matter's solver, but the value is irrelevant — sensors
    // never participate in impulse resolution.
    mass: 0.0001,
    friction: 0,
    frictionAir: 0,
    frictionStatic: 0,
    restitution: 0,
    collisionFilter: { ...HITBOX_COLLISION_FILTER },
    plugin,
  });

  // Lock rotation so the sensor's AABB stays predictable across steps.
  scene.matter.body.setInertia(body, Infinity);
  return body;
}

/** Remove a previously spawned hitbox body from the world. Idempotent. */
export function despawnHitbox(scene: HitboxScene, body: MatterJS.BodyType | null): void {
  if (!body) return;
  scene.matter?.world?.remove(body);
}

/**
 * Spawn a Matter sensor body for a GRAB range hitbox (post-M2 grab/
 * throw subsystem). Mirrors {@link spawnHitbox} structurally — the
 * sensor body is identical in collision filter, geometry placement,
 * and lifetime — but stamps `kind: 'grab'` on the plugin so the
 * damage handler routes contact events to the grab resolver instead
 * of the attack-damage path.
 *
 * Damage / knockback on a grab sensor are zero (the contact itself
 * does no damage; the throw release fires the launch via the
 * target's `applyHit` later). The sensor's `moveId` is the grab
 * spec's `id` so debug HUDs / replay logs can attribute the connect
 * to the right authored grab.
 *
 * Pure call into the scene's matter API + a pure plugin record —
 * deterministic given identical attacker positions and facing.
 */
export function spawnGrabHitbox(
  scene: HitboxScene,
  attacker: { id: string; position: { x: number; y: number }; bodyId?: number },
  grab: {
    id: string;
    hitbox: { offsetX: number; offsetY: number; width: number; height: number };
  },
  facing: 1 | -1,
): MatterJS.BodyType {
  const offsetX = grab.hitbox.offsetX * facing;
  const cx = attacker.position.x + offsetX;
  const cy = attacker.position.y + grab.hitbox.offsetY;

  const plugin: HitboxPlugin = {
    ownerId: attacker.id,
    ownerBodyId: attacker.bodyId,
    moveId: grab.id,
    damage: 0,
    knockback: { x: 0, y: 0, scaling: 0 },
    facing,
    kind: 'grab',
  };

  const body = scene.matter.add.rectangle(
    cx,
    cy,
    grab.hitbox.width,
    grab.hitbox.height,
    {
      label: HITBOX_LABEL,
      isSensor: true,
      isStatic: false,
      mass: 0.0001,
      friction: 0,
      frictionAir: 0,
      frictionStatic: 0,
      restitution: 0,
      collisionFilter: { ...HITBOX_COLLISION_FILTER },
      plugin,
    },
  );

  scene.matter.body.setInertia(body, Infinity);
  return body;
}

/**
 * Pure helper — compute the absolute world-space centre of an attack
 * hitbox given the attacker's current position, the move's authored
 * offset, and the latched `facing`. Mirrors the math
 * `spawnHitbox` performs internally so callers (the runtime
 * position-tracker, tests, debug overlays) can derive "where would the
 * sensor sit right now?" without going through Matter.
 *
 *   • The authored `offsetX` is positive-forward — i.e. authored as
 *     if the fighter were facing right. Multiplying by `facing` mirrors
 *     it to the opposite side when the fighter is facing left, and the
 *     same path produces the correct "behind the attacker" geometry for
 *     a back-aerial whose `ActiveAttack.facing` was inverted by the
 *     dispatch layer.
 *   • `offsetY` is mirror-invariant (vertical) — applied unchanged.
 *
 * Determinism: a pure arithmetic function. Identical inputs always
 * return identical centres; no `Math.random()`, no wall-clock reads.
 */
export function computeHitboxCenter(
  attackerPosition: { readonly x: number; readonly y: number },
  move: AttackMove,
  facing: 1 | -1,
): { x: number; y: number } {
  return {
    x: attackerPosition.x + move.hitbox.offsetX * facing,
    y: attackerPosition.y + move.hitbox.offsetY,
  };
}

/**
 * AC 60103 Sub-AC 3 — re-parent an active hitbox sensor to the
 * attacker's *current* world-space position with the same facing-mirrored
 * offset that {@link spawnHitbox} applied at spawn time. Used by the
 * per-frame aerial hitbox tracker in `Character.tickAttack` so a sensor
 * spawned during the active phase of an aerial move carries with the
 * fighter as he drifts through the air, instead of staying anchored to
 * the body's position on the spawn frame.
 *
 * Why this matters specifically for aerials: a grounded fighter swinging
 * a jab is largely stationary during the active window — the original
 * spawn-time anchor reads as "rooted-stance reach" and feels right. An
 * airborne fighter, by contrast, can drift several body-lengths during
 * a 4-frame active window (especially during a falling fair or a
 * jumping nair into a launching opponent), and a static hitbox simply
 * misses targets that the fighter visibly swings through.
 *
 *   • No-op when `body` is `null` — keeps the call site free of
 *     `if (a.hitboxBody)` guards in the hot path.
 *   • Idempotent for sensors already at the right position — Matter's
 *     `setPosition` short-circuits internally when the position
 *     doesn't change, so calling this every step costs us roughly a
 *     vector compare in the no-motion case.
 *
 * Determinism: a pure projection of the attacker's body position +
 * authored move data onto the sensor's transform. Two replays driving
 * identical character physics produce identical hitbox positions every
 * frame.
 */
export function updateHitboxPosition(
  scene: HitboxScene,
  body: MatterJS.BodyType | null,
  attackerPosition: { readonly x: number; readonly y: number },
  move: AttackMove,
  facing: 1 | -1,
): void {
  if (!body) return;
  const center = computeHitboxCenter(attackerPosition, move, facing);
  scene.matter.body.setPosition(body, center);
}
