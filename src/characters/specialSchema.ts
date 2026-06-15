/**
 * Neutral-special move data schema — AC 60201 Sub-AC 1.
 *
 * Fourth move family in the per-character kit (after jab / tilt / smash
 * grounded triplet and the nair / fair / bair aerial triplet). Each of
 * the four roster slots ships exactly ONE neutral special, and each one
 * uses a *different* mechanic so the four characters feel meaningfully
 * different on the special button press:
 *
 *   • Wolf  (bruiser) → counter        — short window of i-frames; an
 *                                         incoming hit during the active
 *                                         window is absorbed and a
 *                                         retaliation hit fires in front
 *                                         of Wolf scaling with what was
 *                                         absorbed.
 *   • Cat   (ninja)   → projectile     — a small fast-moving sensor body
 *                                         that travels forward across the
 *                                         stage, deals damage on contact,
 *                                         and despawns after a short
 *                                         lifetime. Lets Cat poke from
 *                                         far outside her usual paw range.
 *   • Owl   (mage)    → charge attack  — held charge that scales damage /
 *                                         knockback up to a max-charge
 *                                         cap. Released anywhere in the
 *                                         charge window; a fully-charged
 *                                         release is a real KO threat.
 *   • Bear  (grappler)→ command grab   — short-range tight hitbox that on
 *                                         connect transitions into a
 *                                         throw: Bear locks the victim in
 *                                         place for a brief hold then
 *                                         launches them with a heavy
 *                                         knockback vector. Unblockable
 *                                         (in the canonical Smash idiom
 *                                         grabs ignore shield) — encoded
 *                                         here as a pure data record so
 *                                         the (later AC) shield ignore
 *                                         logic can read the kind tag.
 *
 * This module is the data contract those records share. Like
 * `aerialSchema.ts`, it sits OUTSIDE the base `attacks.ts` /
 * `moveSchema.ts` so the four shared kinds can declare kind-specific
 * fields without polluting the grounded / aerial schemas. Every
 * `NeutralSpecialMove` is also a structural `AttackMoveWithAnimation`,
 * so:
 *
 *   • The runtime attack state machine (startup → active → recovery →
 *     done) drives them through `Character.tickAttack` unchanged. The
 *     four kinds layer additional behaviour on top of the canonical
 *     hitbox-spawn-during-active mechanic without re-implementing it.
 *
 *   • The animation state machine
 *     (`computeAttackPhase` / `selectAnimationFrame`) keeps working —
 *     each special declares the same `animation` block other moves do.
 *
 *   • The roster tooling (`CHARACTER_ROSTER`, `findMoveByType`) sees
 *     specials as plain `AttackMove`s with `type: 'special'`, so a
 *     consumer that asks "does Wolf have a special?" via
 *     `findMoveByType(spec, 'special')` gets the right record.
 *
 * The four kinds are a *discriminated union* on `specialKind` so a
 * caller iterating a moveset can narrow type-safely:
 *
 *     for (const m of spec.moves) {
 *       if (m.type !== 'special') continue;
 *       const sp = m as NeutralSpecialMove;   // narrow at the seam
 *       switch (sp.specialKind) {
 *         case 'projectile':    handleProjectile(sp); break;
 *         case 'charge':        handleCharge(sp);     break;
 *         case 'commandGrab':   handleGrab(sp);       break;
 *         case 'counter':       handleCounter(sp);    break;
 *       }
 *     }
 *
 * Determinism: every helper here is a pure function of integer frame
 * counters and frozen move data. No `Math.random()`, no `Date.now()`,
 * no Matter / Phaser side effects. Identical inputs always produce
 * identical outputs — the property the replay system requires.
 *
 * Backwards compatibility: this module is purely additive. Existing
 * `AttackMove`, `AttackMoveWithAnimation`, the move data tables on
 * Wolf/Cat/Owl/Bear, and the runtime attack state machine all keep
 * working unchanged. The new `NeutralSpecialMove` records are
 * APPENDED to each character's moveset and registered through the
 * existing `Character.registerAttack` pipeline (with a small extension
 * that auto-fills a `neutralSpecialId` slot when a `'special'`-typed
 * move is registered).
 */

import type { AttackMove } from './attacks';
import type {
  AttackMoveWithAnimation,
  KnockbackSpec,
} from './moveSchema';
import { computeAttackPhase, getMoveBusyFrames } from './moveSchema';
import {
  type ChargeSpec,
  computeChargeTFromSpec,
  computeChargedDamageFromSpec,
  computeChargedKnockbackFromSpec,
  validateChargeSpec,
} from './chargeSchema';

// Re-export the generalized charge symbols so existing call sites that
// reach into specialSchema for charge concerns keep compiling. Callers
// authoring NEW chargeable moves should import directly from
// `./chargeSchema` instead.
export type {
  ChargeSpec,
} from './chargeSchema';
export {
  computeChargeTFromSpec,
  computeChargedDamageFromSpec,
  computeChargedKnockbackFromSpec,
  validateChargeSpec,
} from './chargeSchema';

// ---------------------------------------------------------------------------
// Special-kind discriminator
// ---------------------------------------------------------------------------

/**
 * Which mechanic the neutral special implements. Each character ships
 * exactly one of these, and the four are deliberately distinct so the
 * "press special" button feels different on every character.
 *
 *   - `'projectile'`   : spawn a moving sensor body in front of the
 *                        attacker that travels at a fixed horizontal
 *                        speed for `lifetimeFrames`. The body carries
 *                        the move's damage / knockback. Despawns on
 *                        contact OR when its lifetime expires.
 *
 *   - `'charge'`       : the move's `active` phase scales the realised
 *                        damage / knockback with how long the player
 *                        held the special button before release. A
 *                        tap-press fires the minimum-charge variant on
 *                        `minChargeFrames`; holding through
 *                        `maxChargeFrames` produces the full-charge
 *                        variant. Anywhere in between linearly
 *                        interpolates between min and max.
 *
 *   - `'commandGrab'`  : a tight short-range hitbox; on connect, the
 *                        attacker enters a "hold" sub-state for
 *                        `grabHoldFrames` and then releases the victim
 *                        with `throwDamage` + `throwKnockback`. The
 *                        canonical Smash-style "ignores shield" tag is
 *                        encoded as `ignoresShield: true` so the
 *                        (future) shield system can branch on it.
 *
 *   - `'counter'`      : during the move's active window the fighter
 *                        is invincible AND latches the next incoming
 *                        hit. On a successful catch, a retaliation
 *                        hitbox spawns in front of the fighter dealing
 *                        damage scaled by what was absorbed (clamped
 *                        between `minCounterDamage` and
 *                        `maxCounterDamage`). Whiffed counters carry
 *                        a long recovery so the move is committal.
 */
export type NeutralSpecialKind =
  | 'projectile'
  | 'charge'
  | 'commandGrab'
  | 'counter'
  | 'summon';

// ---------------------------------------------------------------------------
// Per-kind detail records
// ---------------------------------------------------------------------------

/**
 * Configuration for the projectile sub-kind.
 *
 * The projectile is authored as a separate sensor body (not the move's
 * own hitbox) — the move's `active` phase is the *spawn frame window*,
 * after which the projectile lives independently of the attacker. The
 * fighter is free to act during the projectile's lifetime (subject to
 * the move's recovery + cooldown).
 *
 * Coordinate system: the projectile spawns at the attacker's body
 * centre offset by `(spawnOffsetX * facing, spawnOffsetY)` and travels
 * along the X axis at `speed * facing` px-per-fixed-step. The move's
 * authored `hitbox` is unused for projectile specials — the projectile
 * carries its own dimensions in `width / height` here.
 *
 * Determinism: integer frame counters + frozen geometry. The runtime
 * advances the projectile by `speed` units per fixed step; identical
 * spawn frames always produce identical trajectories.
 */
export interface NeutralSpecialProjectileSpec {
  /** Horizontal speed in px-per-fixed-step (positive = forward of facing). */
  readonly speed: number;
  /** Frames the projectile lives in the world after spawn. */
  readonly lifetimeFrames: number;
  /** Projectile sensor body width in design pixels. */
  readonly width: number;
  /** Projectile sensor body height in design pixels. */
  readonly height: number;
  /** Spawn-offset X (positive = forward of attacker centre, mirrored by facing). */
  readonly spawnOffsetX: number;
  /** Spawn-offset Y (negative = above attacker centre — Phaser screen-space). */
  readonly spawnOffsetY: number;
}

/**
 * Optional "charge beam" overlay for a projectile special — the Samus
 * Charge Shot mechanic. When a {@link ProjectileSpecialMove} carries this
 * block, the neutral-special press HOLDS to charge instead of firing
 * instantly: the released shot's damage, knockback, travel speed, and
 * sprite size all scale from the un-charged baseline (the parent move's
 * `damage`/`knockback` and the parent `projectile.speed`/`width`/`height`,
 * i.e. the `t = 0` endpoint) up to the full-charge endpoint here at
 * `t = 1`. The charge can be banked ("charge-cancel") and kept across
 * actions until fired — see `Character.storedSpecialCharge`.
 *
 * Determinism: every realised value is a pure lerp of the integer
 * held-frame count via the {@link ChargeSpec} helpers — no randomness,
 * no wall-clock. Identical hold durations always fire identical shots.
 */
export interface ProjectileChargeSpec {
  /**
   * Damage / knockback ramp. The `min*` endpoint MUST match the parent
   * move's authored `damage` / `knockback` (the un-charged bare-press
   * shot); the `max*` endpoint is the full-charge KO shot.
   */
  readonly charge: ChargeSpec;
  /** Full-charge travel speed (px-per-fixed-step). Parent `projectile.speed` is the un-charged speed. */
  readonly maxSpeed: number;
  /** Full-charge sprite/sensor width. Parent `projectile.width` is the un-charged width. */
  readonly maxWidth: number;
  /** Full-charge sprite/sensor height. Parent `projectile.height` is the un-charged height. */
  readonly maxHeight: number;
}

/**
 * Back-compat alias for the generalized {@link ChargeSpec}. The
 * charge spec was generalized out of this module after M2 so it could
 * be reused by chargeable lights and smashes (not just neutral
 * specials). Existing call sites that reference
 * `NeutralSpecialChargeSpec` keep compiling via this alias; new code
 * should prefer `ChargeSpec` from `./chargeSchema`.
 */
export type NeutralSpecialChargeSpec = ChargeSpec;

/**
 * Configuration for the commandGrab sub-kind.
 *
 * Command grab is a two-phase mechanic: an opening "grab" hitbox tries
 * to connect during the move's `active` phase; on a successful catch,
 * the runtime transitions both fighters into a "hold" sub-state for
 * `grabHoldFrames` after which the attacker releases the victim with
 * `throwDamage` + `throwKnockback`.
 *
 * The opening hitbox is the move's own `hitbox` field (unlike
 * projectile, command grab's opening reach IS authored on the
 * `AttackMove.hitbox`). The throw damage / knockback are SEPARATE from
 * the move's own `damage` / `knockback` fields — the move's own values
 * carry zero so a missed grab does nothing, and the realised damage /
 * launch only fires on the throw release.
 *
 * `ignoresShield: true` is the Smash-canonical "grabs beat shield"
 * tag, encoded here so the (future) shield system reads it through the
 * data layer rather than hard-coding the bypass per move id.
 *
 * Determinism: integer frame counters; throw damage / knockback are
 * frozen at authoring time. The "hold then throw" sequence is driven
 * by frame counters, not wall-clock.
 */
export interface NeutralSpecialCommandGrabSpec {
  /**
   * Frames the victim is locked in the held state before the throw
   * launches. The victim has no input authority during the hold; the
   * attacker is locked in the "holding pose" for the same window. A
   * 0-frame hold throws instantly; a hold of e.g. 18 frames gives the
   * camera + animator time to register the grab.
   */
  readonly grabHoldFrames: number;
  /** Damage applied to the victim on the throw release frame. */
  readonly throwDamage: number;
  /** Knockback vector applied on the throw release frame. */
  readonly throwKnockback: KnockbackSpec;
  /**
   * If `true`, the opening grab hitbox bypasses shield (the canonical
   * Smash "grab beats shield" rule). The (future) shield-collision
   * handler reads this tag to skip the shield check for command-grab
   * hitboxes. Default `true` — there is no use case in this AC for a
   * shieldable command grab.
   */
  readonly ignoresShield: boolean;
}

/**
 * Configuration for the counter sub-kind.
 *
 * Counter is a *parry-and-retaliate* mechanic: during the move's
 * `[counterWindowStart, counterWindowEnd)` frame range the fighter is
 * invincible AND will latch the next incoming hit. On a successful
 * catch, the runtime spawns a retaliation hitbox in front of the
 * fighter that deals damage scaled by the absorbed move's damage:
 *
 *   counterDamage = clamp(
 *     absorbedDamage * damageMultiplier,
 *     minCounterDamage,
 *     maxCounterDamage,
 *   )
 *
 * The realised knockback is a flat `counterKnockback` (not scaled by
 * the absorbed hit) so a counter against a featherlight jab still
 * launches with finisher-tier force — that's the canonical Smash
 * counter risk/reward shape: you have to predict the swing AND eat the
 * commitment, but the payoff is a fixed-strength launch.
 *
 * A whiffed counter (no incoming hit during the window) plays out the
 * full move including its lengthy recovery — counters are designed to
 * be punishable on a misread. The move's own `damage` / `knockback`
 * are zero (counter has no proactive hitbox); only the retaliation
 * hitbox (spawned by the runtime on a catch) carries the damage.
 *
 * Determinism: integer windows, frozen multipliers + clamps.
 * `accumulateDamage` (called by the damage handler) clamps the
 * realised damage at `MAX_DAMAGE_PERCENT` so the counter math never
 * overflows.
 */
export interface NeutralSpecialCounterSpec {
  /** First frame of the parry window (inclusive). */
  readonly counterWindowStart: number;
  /** First frame past the parry window (exclusive). */
  readonly counterWindowEnd: number;
  /**
   * Multiplier applied to the absorbed move's damage to derive the
   * retaliation damage. Canonical Smash counters use 1.2-1.5×; we pick
   * 1.3× here (Wolf bruiser archetype: hard hit, modest multiplier).
   */
  readonly damageMultiplier: number;
  /** Floor damage the retaliation deals — even a 1% jab counters into this. */
  readonly minCounterDamage: number;
  /** Ceiling damage; protects against a 50% absorbed hit one-shotting a stock. */
  readonly maxCounterDamage: number;
  /** Knockback the retaliation hitbox carries. Flat — does not scale with absorbed damage. */
  readonly counterKnockback: KnockbackSpec;
  /**
   * Geometry for the retaliation hitbox spawned on a successful catch.
   * Authored facing-right; the runtime mirrors `offsetX` by the
   * fighter's facing on spawn.
   */
  readonly counterHitbox: {
    readonly offsetX: number;
    readonly offsetY: number;
    readonly width: number;
    readonly height: number;
  };
}

/**
 * Configuration for the summon sub-kind (post-M2 creature subsystem).
 *
 * Spawns a creature into the world tied to the summoner via the
 * owner-only friendly-fire model — the spawned creature can damage
 * everyone EXCEPT its summoner. The creature's behaviour, HP, and
 * lifecycle are declared on the matching {@link CreatureSpec} in
 * the creature registry; this record just names the creature and
 * the per-summon limits.
 *
 * Determinism: integer counters + frozen geometry. Identical press
 * frames always produce identical spawn positions.
 */
export interface NeutralSpecialSummonSpec {
  /**
   * Id of the creature to summon — looked up in the creature
   * registry (`getCreatureSpec(creatureId)`) at spawn time. Throws
   * loudly on a typo so a misauthored summon doesn't silently no-op.
   */
  readonly creatureId: string;
  /**
   * Spawn offset relative to the summoner's body centre, mirrored
   * by facing on `offsetX` (so the creature lands in front of the
   * summoner regardless of which way they face).
   */
  readonly spawnOffsetX: number;
  readonly spawnOffsetY: number;
  /**
   * Maximum number of THIS creature kind a single summoner can
   * have alive at once. Pressing summon again past the cap either
   * (a) silently fails or (b) despawns the oldest instance — the
   * runtime decides; the schema just declares the cap.
   */
  readonly maxConcurrent: number;
  /**
   * Frames after a successful summon before another summon press
   * by the same summoner can spawn anything. Prevents a player
   * from queuing N creatures in N consecutive frames at the cost
   * of nothing.
   */
  readonly cooldownFrames: number;
}

// ---------------------------------------------------------------------------
// NeutralSpecialMove discriminated union
// ---------------------------------------------------------------------------

/**
 * Common fields every neutral-special record carries — extends the base
 * `AttackMoveWithAnimation` contract and pins `type: 'special'`.
 */
interface NeutralSpecialMoveBase extends AttackMoveWithAnimation {
  readonly type: 'special';
  readonly specialKind: NeutralSpecialKind;
}

/** Projectile-kind neutral special. */
export interface ProjectileSpecialMove extends NeutralSpecialMoveBase {
  readonly specialKind: 'projectile';
  readonly projectile: NeutralSpecialProjectileSpec;
  /**
   * Optional Samus-style charge overlay. When present the move is a
   * hold-to-charge beam: the press starts charging, the release fires a
   * charge-scaled travelling projectile, and the charge can be banked
   * with shield and kept across actions. Absent on a plain fire-on-press
   * projectile (Owl / Bruno / Volt) — they are unaffected.
   */
  readonly chargedProjectile?: ProjectileChargeSpec;
}

/** Charge-kind neutral special. */
export interface ChargeSpecialMove extends NeutralSpecialMoveBase {
  readonly specialKind: 'charge';
  readonly charge: NeutralSpecialChargeSpec;
}

/** Command-grab-kind neutral special. */
export interface CommandGrabSpecialMove extends NeutralSpecialMoveBase {
  readonly specialKind: 'commandGrab';
  readonly grab: NeutralSpecialCommandGrabSpec;
}

/** Counter-kind neutral special. */
export interface CounterSpecialMove extends NeutralSpecialMoveBase {
  readonly specialKind: 'counter';
  readonly counter: NeutralSpecialCounterSpec;
}

/** Summon-kind neutral special — invokes a creature tied to the summoner. */
export interface SummonSpecialMove extends NeutralSpecialMoveBase {
  readonly specialKind: 'summon';
  readonly summon: NeutralSpecialSummonSpec;
}

/**
 * Discriminated union of every neutral-special record. Use
 * `NeutralSpecialMove['specialKind']` to switch on the variant; the
 * compiler narrows to the matching detail record automatically.
 */
export type NeutralSpecialMove =
  | ProjectileSpecialMove
  | ChargeSpecialMove
  | CommandGrabSpecialMove
  | CounterSpecialMove
  | SummonSpecialMove;

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

/** True iff `move` is typed `'special'` AND carries a `specialKind` tag. */
export function isNeutralSpecialMove(
  move: AttackMove,
): move is NeutralSpecialMove {
  if (move.type !== 'special') return false;
  const kind = (move as Partial<NeutralSpecialMoveBase>).specialKind;
  return (
    kind === 'projectile' ||
    kind === 'charge' ||
    kind === 'commandGrab' ||
    kind === 'counter' ||
    kind === 'summon'
  );
}

/** True iff `move` is a projectile-kind neutral special. */
export function isProjectileSpecial(
  move: AttackMove,
): move is ProjectileSpecialMove {
  return isNeutralSpecialMove(move) && move.specialKind === 'projectile';
}

/** True iff `move` is a charge-kind neutral special. */
export function isChargeSpecial(
  move: AttackMove,
): move is ChargeSpecialMove {
  return isNeutralSpecialMove(move) && move.specialKind === 'charge';
}

/** True iff `move` is a command-grab-kind neutral special. */
export function isCommandGrabSpecial(
  move: AttackMove,
): move is CommandGrabSpecialMove {
  return isNeutralSpecialMove(move) && move.specialKind === 'commandGrab';
}

/** True iff `move` is a counter-kind neutral special. */
export function isCounterSpecial(
  move: AttackMove,
): move is CounterSpecialMove {
  return isNeutralSpecialMove(move) && move.specialKind === 'counter';
}

/** True iff `move` is a summon-kind neutral special. */
export function isSummonSpecial(
  move: AttackMove,
): move is SummonSpecialMove {
  return isNeutralSpecialMove(move) && move.specialKind === 'summon';
}

// ---------------------------------------------------------------------------
// Charge interpolation helpers (pure)
// ---------------------------------------------------------------------------

/**
 * Back-compat wrapper around {@link computeChargeTFromSpec}. Existing
 * callers reach `computeChargeT` via this module's public surface; new
 * callers should import the generic helper from `./chargeSchema`
 * directly.
 *
 * Pure — same `(spec, heldFrames)` always returns the same `t`.
 */
export function computeChargeT(
  spec: NeutralSpecialChargeSpec,
  heldFrames: number,
): number {
  return computeChargeTFromSpec(spec, heldFrames);
}

/**
 * Linear interpolation of the realised damage at hold duration
 * `heldFrames`. Returns `minDamage` for early-release / no-charge,
 * `maxDamage` for full-charge, and a linear blend in between.
 */
export function computeChargedDamage(
  move: ChargeSpecialMove,
  heldFrames: number,
): number {
  return computeChargedDamageFromSpec(move.charge, heldFrames);
}

/**
 * Linear interpolation of the realised knockback vector at hold
 * duration `heldFrames`. Each component (`x`, `y`, `scaling`) is
 * lerped independently between the min-charge and max-charge specs.
 *
 * Note: the resulting `scaling` is also lerped — this is intentional.
 * Charge moves at higher hold percentages get BOTH a stronger base
 * vector AND steeper percent-scaling, matching the Smash idiom of
 * "fully charged smash launches at lower percent than uncharged".
 */
export function computeChargedKnockback(
  move: ChargeSpecialMove,
  heldFrames: number,
): KnockbackSpec {
  return computeChargedKnockbackFromSpec(move.charge, heldFrames);
}

// ---------------------------------------------------------------------------
// Counter helpers (pure)
// ---------------------------------------------------------------------------

/**
 * Pure predicate: is `framesElapsed` inside the counter's parry
 * window? Returns `true` iff
 * `counterWindowStart <= framesElapsed < counterWindowEnd`.
 */
export function isInCounterWindow(
  move: CounterSpecialMove,
  framesElapsed: number,
): boolean {
  return (
    framesElapsed >= move.counter.counterWindowStart &&
    framesElapsed < move.counter.counterWindowEnd
  );
}

/**
 * Compute the realised retaliation damage for a counter that absorbed
 * `absorbedDamage`. Multiplies by `damageMultiplier` then clamps
 * between `minCounterDamage` and `maxCounterDamage`. Pure.
 */
export function computeCounterDamage(
  move: CounterSpecialMove,
  absorbedDamage: number,
): number {
  const raw = absorbedDamage * move.counter.damageMultiplier;
  if (raw < move.counter.minCounterDamage) return move.counter.minCounterDamage;
  if (raw > move.counter.maxCounterDamage) return move.counter.maxCounterDamage;
  return raw;
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

/**
 * Validate a neutral-special move record satisfies the schema's
 * invariants:
 *
 *   1. `type === 'special'` and `specialKind` is one of the four kinds.
 *   2. Per-kind detail record is present and well-formed:
 *        - projectile: `lifetimeFrames` / `width` / `height` / `speed`
 *                      are all positive numbers, `lifetimeFrames` is
 *                      a non-negative integer.
 *        - charge: `minChargeFrames` < `maxChargeFrames`, both
 *                  non-negative integers; `minDamage <= maxDamage`.
 *        - commandGrab: `grabHoldFrames` non-negative integer;
 *                       `throwDamage >= 0`.
 *        - counter: `counterWindowStart < counterWindowEnd`, both
 *                   non-negative integers and within the move's busy
 *                   frames; `damageMultiplier > 0`;
 *                   `minCounterDamage <= maxCounterDamage`.
 *
 * Returns the move unchanged on success; throws on the first invariant
 * violation. Tests call this on every per-character special record so
 * a future tuning pass can't accidentally publish a broken record.
 */
export function validateNeutralSpecialMove(
  move: NeutralSpecialMove,
): NeutralSpecialMove {
  if (move.type !== 'special') {
    throw new Error(
      `NeutralSpecialMove '${move.id}': type must be 'special', got '${move.type}'`,
    );
  }
  const busyTotal = getMoveBusyFrames(move);

  switch (move.specialKind) {
    case 'projectile': {
      const p = move.projectile;
      if (!Number.isFinite(p.speed) || p.speed === 0) {
        throw new Error(
          `NeutralSpecialMove '${move.id}': projectile.speed must be non-zero, got ${p.speed}`,
        );
      }
      if (!Number.isInteger(p.lifetimeFrames) || p.lifetimeFrames <= 0) {
        throw new Error(
          `NeutralSpecialMove '${move.id}': projectile.lifetimeFrames must be a positive integer, got ${p.lifetimeFrames}`,
        );
      }
      if (p.width <= 0 || p.height <= 0) {
        throw new Error(
          `NeutralSpecialMove '${move.id}': projectile dimensions must be positive (got ${p.width}x${p.height})`,
        );
      }
      // Optional Samus-style charge overlay — the un-charged endpoints are
      // the parent move/projectile values, so the full-charge endpoints
      // here must be >= them and the ramp itself must be a valid ChargeSpec.
      const cp = move.chargedProjectile;
      if (cp) {
        validateChargeSpec(cp.charge, `NeutralSpecialMove '${move.id}'`);
        if (!Number.isFinite(cp.maxSpeed) || cp.maxSpeed === 0) {
          throw new Error(
            `NeutralSpecialMove '${move.id}': chargedProjectile.maxSpeed must be non-zero, got ${cp.maxSpeed}`,
          );
        }
        if (cp.maxWidth <= 0 || cp.maxHeight <= 0) {
          throw new Error(
            `NeutralSpecialMove '${move.id}': chargedProjectile full-charge dimensions must be positive (got ${cp.maxWidth}x${cp.maxHeight})`,
          );
        }
        if (cp.charge.minDamage !== move.damage) {
          throw new Error(
            `NeutralSpecialMove '${move.id}': chargedProjectile.charge.minDamage (${cp.charge.minDamage}) must equal the move's un-charged damage (${move.damage})`,
          );
        }
      }
      break;
    }
    case 'charge': {
      validateChargeSpec(move.charge, `NeutralSpecialMove '${move.id}'`);
      break;
    }
    case 'commandGrab': {
      const g = move.grab;
      if (!Number.isInteger(g.grabHoldFrames) || g.grabHoldFrames < 0) {
        throw new Error(
          `NeutralSpecialMove '${move.id}': grab.grabHoldFrames must be non-negative integer, got ${g.grabHoldFrames}`,
        );
      }
      if (g.throwDamage < 0) {
        throw new Error(
          `NeutralSpecialMove '${move.id}': grab.throwDamage must be >= 0, got ${g.throwDamage}`,
        );
      }
      break;
    }
    case 'counter': {
      const cnt = move.counter;
      if (
        !Number.isInteger(cnt.counterWindowStart) ||
        !Number.isInteger(cnt.counterWindowEnd) ||
        cnt.counterWindowStart < 0 ||
        cnt.counterWindowEnd <= cnt.counterWindowStart
      ) {
        throw new Error(
          `NeutralSpecialMove '${move.id}': counter window [${cnt.counterWindowStart}, ${cnt.counterWindowEnd}) malformed`,
        );
      }
      if (cnt.counterWindowEnd > busyTotal) {
        throw new Error(
          `NeutralSpecialMove '${move.id}': counter window endFrame=${cnt.counterWindowEnd} exceeds busyTotal=${busyTotal}`,
        );
      }
      if (cnt.damageMultiplier <= 0) {
        throw new Error(
          `NeutralSpecialMove '${move.id}': counter.damageMultiplier must be > 0, got ${cnt.damageMultiplier}`,
        );
      }
      if (cnt.minCounterDamage < 0 || cnt.maxCounterDamage < cnt.minCounterDamage) {
        throw new Error(
          `NeutralSpecialMove '${move.id}': counter damage clamp invalid (min=${cnt.minCounterDamage}, max=${cnt.maxCounterDamage})`,
        );
      }
      break;
    }
    case 'summon': {
      const s = move.summon;
      if (typeof s.creatureId !== 'string' || s.creatureId.length === 0) {
        throw new Error(
          `NeutralSpecialMove '${move.id}': summon.creatureId must be a non-empty string`,
        );
      }
      if (!Number.isFinite(s.spawnOffsetX) || !Number.isFinite(s.spawnOffsetY)) {
        throw new Error(
          `NeutralSpecialMove '${move.id}': summon spawn offsets must be finite`,
        );
      }
      if (!Number.isInteger(s.maxConcurrent) || s.maxConcurrent <= 0) {
        throw new Error(
          `NeutralSpecialMove '${move.id}': summon.maxConcurrent must be a positive integer, got ${s.maxConcurrent}`,
        );
      }
      if (!Number.isInteger(s.cooldownFrames) || s.cooldownFrames < 0) {
        throw new Error(
          `NeutralSpecialMove '${move.id}': summon.cooldownFrames must be a non-negative integer, got ${s.cooldownFrames}`,
        );
      }
      break;
    }
    default: {
      // Exhaustiveness: TypeScript sees `move` narrowed to `never` here.
      const _exhaustive: never = move;
      throw new Error(
        `NeutralSpecialMove: unknown specialKind on ${(_exhaustive as { id?: string }).id ?? '<unknown>'}`,
      );
    }
  }

  // Sanity: the move's animation block (if present) must declare
  // per-phase frame counts > 0, mirroring the AttackMoveWithAnimation
  // schema. We don't enforce 6-8 frames here — that's a balance / asset
  // concern, not a hard schema invariant.
  const anim = move.animation;
  if (anim) {
    if (anim.startupFrames < 1 || anim.activeFrames < 1 || anim.recoveryFrames < 1) {
      throw new Error(
        `NeutralSpecialMove '${move.id}': animation phase counts must each be >= 1`,
      );
    }
  }

  // Validate the canonical phase classifier doesn't blow up on any
  // frame in [0, busyTotal] — defensive, catches malformed records
  // where startup + active + recovery sum to a non-integer somehow.
  for (const f of [0, busyTotal - 1, busyTotal]) {
    computeAttackPhase(f, move);
  }

  return move;
}
