/**
 * Side-special move data schema — AC 60101 Sub-AC 1.
 *
 * Sixth move family in the per-character kit (after the grounded triplet
 * jab / tilt / smash, the aerial triplet nair / fair / bair, the neutral
 * special, and the up special). Each of the four roster slots ships
 * exactly ONE side special, and each one uses a *different* mechanic so
 * the four characters feel meaningfully different on the "side + special"
 * input AND fill a unique tactical niche distinct from their neutral and
 * up-special.
 *
 * The Seed mandates four distinct side-special mechanics for the four
 * roster slots. We pick one canonical Smash-Bros side-B archetype per
 * character, mapped to the character's existing role:
 *
 *   • Wolf  (bruiser) → dashStrike   — Wolf rushes forward at fixed
 *                                      velocity for a few frames with a
 *                                      committal hitbox attached to his
 *                                      body. Mirrors Falcon's Raptor
 *                                      Boost / Ganondorf's Flame Choke
 *                                      (the simple "go fast in a line and
 *                                      hit hard" archetype).
 *
 *   • Cat   (ninja)   → multiHit     — Cat strikes 3 times in a forward
 *                                      flurry (think Marth's Dancing
 *                                      Blade or Sheik's Forward Tilt
 *                                      cancel-extension). Each hit can be
 *                                      followed up by repressing the
 *                                      special button to chain into the
 *                                      next swing — runtime concern, but
 *                                      the per-hit damage / knockback
 *                                      ladder is authored here.
 *
 *   • Owl   (mage)    → reflector    — Owl conjures a reflector field in
 *                                      front of him for a brief active
 *                                      window. Incoming projectiles
 *                                      bounce back at the source with
 *                                      `reflectMultiplier` damage. The
 *                                      reflector itself carries a small
 *                                      contact hit. Mirrors Fox/Falco's
 *                                      Reflector — the "anti-projectile"
 *                                      tool that defines a character's
 *                                      neutral game.
 *
 *   • Bear  (grappler)→ commandDash  — Bear lunges forward with a grab
 *                                      hitbox. On connect the move
 *                                      transitions into a throw (similar
 *                                      to a neutral command grab, but
 *                                      with travel distance baked in).
 *                                      Mirrors Bowser's Side-B Flying
 *                                      Slam — the "approach grab" that
 *                                      lets a grappler close gaps.
 *
 * This module is the data contract those records share. Like
 * `aerialSchema.ts`, `specialSchema.ts`, and `upSpecialSchema.ts` it sits
 * OUTSIDE the base `attacks.ts` / `moveSchema.ts` so the four shared
 * kinds can declare kind-specific fields without polluting the grounded
 * / aerial / neutral / up-special schemas. Every `SideSpecialMove` is
 * also a structural `AttackMoveWithAnimation`, so:
 *
 *   • The runtime attack state machine (startup → active → recovery →
 *     done) drives them through `Character.tickAttack` unchanged. The
 *     four kinds layer additional behaviour on top of the canonical
 *     hitbox-spawn-during-active mechanic without re-implementing it.
 *
 *   • The animation state machine
 *     (`computeAttackPhase` / `selectAnimationFrame`) keeps working —
 *     each side-special declares the same `animation` block other moves
 *     do.
 *
 *   • The roster tooling (`CHARACTER_ROSTER`, `findMoveByType`) sees
 *     side-specials as plain `AttackMove`s with `type: 'sideSpecial'`,
 *     so a consumer that asks "does Wolf have a side-special?" via
 *     `findMoveByType(spec, 'sideSpecial')` gets the right record.
 *
 * The four kinds are a *discriminated union* on `sideSpecialKind` so a
 * caller iterating a moveset can narrow type-safely:
 *
 *     for (const m of spec.moves) {
 *       if (m.type !== 'sideSpecial') continue;
 *       const sd = m as SideSpecialMove;
 *       switch (sd.sideSpecialKind) {
 *         case 'dashStrike':   handleDashStrike(sd);   break;
 *         case 'multiHit':     handleMultiHit(sd);     break;
 *         case 'reflector':    handleReflector(sd);    break;
 *         case 'commandDash':  handleCommandDash(sd);  break;
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
 * working unchanged. New `SideSpecialMove` records are APPENDED to each
 * character's moveset and registered through the existing
 * `Character.registerAttack` pipeline (the framework's
 * `sideSpecialId` slot is filled by a follow-up sub-AC's small
 * extension, mirroring the `neutralSpecialId` / `upSpecialId` wiring).
 */

import type { AttackMove } from './attacks';
import type {
  AttackMoveWithAnimation,
  KnockbackSpec,
} from './moveSchema';
import { computeAttackPhase, getMoveBusyFrames } from './moveSchema';

// ---------------------------------------------------------------------------
// Side-special-kind discriminator
// ---------------------------------------------------------------------------

/**
 * Which mechanic the side-special implements. Each character ships
 * exactly one of these, and the four are deliberately distinct so the
 * "stick-side + special" press feels different on every character AND
 * offers four genuinely different gameplay textures.
 *
 *   - `'dashStrike'`  : a fixed-distance forward burst with a committal
 *                       body-attached hitbox. The fighter's velocity is
 *                       overridden to `(facing * dashSpeed, 0)` for
 *                       `dashFrames` consecutive frames at the start of
 *                       the active window. Single hit on contact —
 *                       subsequent contacts are suppressed by the
 *                       standard hitbox-already-hit logic.
 *
 *   - `'multiHit'`    : a sequence of `hitCount` hits that fire on a
 *                       per-hit interval. Optionally chainable — each
 *                       hit can be "extended" into the next swing if the
 *                       player re-presses the special button before
 *                       `chainWindowFrames` after the hit lands. The
 *                       per-hit damage / knockback ladder is authored
 *                       here; the chain logic is a runtime concern.
 *
 *   - `'reflector'`   : a brief defensive field that reflects projectiles
 *                       back at their owner. The reflector body carries
 *                       a small contact hit (`contactDamage`) for the
 *                       case where a fighter walks into the field. The
 *                       active window is the reflect window — projectiles
 *                       that touch the field during this window get their
 *                       velocity inverted and damage multiplied by
 *                       `reflectMultiplier`.
 *
 *   - `'commandDash'` : a forward lunge with a grab-style hitbox at its
 *                       head. On connect the runtime transitions into a
 *                       hold + throw sequence (same shape as the neutral
 *                       command grab, but with the `dashSpeed` /
 *                       `dashFrames` travel baked in). Whiffed dash
 *                       carries a committal recovery so the move is
 *                       punishable on reads.
 */
export type SideSpecialKind =
  | 'dashStrike'
  | 'multiHit'
  | 'reflector'
  | 'commandDash';

// ---------------------------------------------------------------------------
// Per-kind detail records
// ---------------------------------------------------------------------------

/**
 * Configuration for the dashStrike sub-kind.
 *
 * The fighter's velocity is set to `(facing * dashSpeed, 0)` for
 * `dashFrames` consecutive frames at the start of the active window,
 * with the move's authored `hitbox` attached to the body each frame.
 * After `dashFrames` the runtime restores normal physics; the hitbox
 * still spawns/despawns on the canonical active-phase boundaries.
 *
 * Determinism: integer frame counters + frozen geometry. The runtime
 * advances the dash velocity each fixed step; identical press frames
 * always produce identical trajectories.
 */
export interface SideSpecialDashStrikeSpec {
  /**
   * Forward dash speed in Matter px-per-step units. Mirrored by `facing`
   * — a fighter facing right dashes at `+dashSpeed`, left at `-dashSpeed`.
   * Typical values: 12-22 (faster than the fighter's max run speed so
   * the move covers ground beyond what a dash-attack would).
   */
  readonly dashSpeed: number;
  /**
   * Frames the dash velocity is enforced. Must be <= `activeFrames` so
   * the dash ends inside the active window (the runtime restores normal
   * physics on the dash-end frame).
   */
  readonly dashFrames: number;
  /**
   * If `true`, the move enters a helpless / no-input state after the
   * dash until the fighter touches ground (matches the canonical
   * "side-B is committal off-stage" rule). Default `false` —
   * dashStrike is meant to be a neutral-game tool, not a recovery,
   * but the flag is here for the rare grappler / knight-class
   * fighter that wants extra commitment.
   */
  readonly helplessAfterDash: boolean;
}

/**
 * Configuration for the multiHit sub-kind.
 *
 * The mechanic spawns a sequence of hits at fixed intervals, with each
 * hit optionally chainable into the next via a re-press of the special
 * button.
 *
 *   • The first hit fires on the first frame of the active phase.
 *   • Subsequent hits fire `hitInterval` frames apart.
 *   • Each hit deals `damagePerHit[i]` damage and applies
 *     `knockbackPerHit[i]`. The arrays must match in length to
 *     `hitCount`.
 *   • If `chainWindowFrames > 0`, a player who repressses special
 *     within `chainWindowFrames` of a hit landing extends the move
 *     into the next swing in the ladder. If the player misses the
 *     window, the move terminates after the current hit's recovery.
 *     The runtime enforces this; the schema just describes the
 *     window.
 *
 * Determinism: integer frame counters + frozen damage / knockback
 * tables. The chain decision is a function of the input record at
 * frame T (the press detector reads it deterministically); identical
 * inputs always produce identical chain outcomes.
 */
export interface SideSpecialMultiHitSpec {
  /**
   * Total number of hits in the swing ladder. Must match the lengths
   * of `damagePerHit` and `knockbackPerHit`. Must be >= 1.
   */
  readonly hitCount: number;
  /**
   * Frames between consecutive hits. The first hit fires on the first
   * active frame; subsequent hits fire every `hitInterval` frames.
   * Must be a positive integer. `(hitCount - 1) * hitInterval` must
   * be < `activeFrames` so the final hit fires inside the active
   * window.
   */
  readonly hitInterval: number;
  /**
   * Per-hit damage values. Index 0 = first hit, index `hitCount - 1`
   * = final hit. Length MUST equal `hitCount`. Validators enforce this.
   */
  readonly damagePerHit: ReadonlyArray<number>;
  /**
   * Per-hit knockback vectors. Index aligned with `damagePerHit`.
   * Length MUST equal `hitCount`. Typical pattern: small lock-in
   * knockback for early hits, heavier launcher knockback for the
   * final hit.
   */
  readonly knockbackPerHit: ReadonlyArray<KnockbackSpec>;
  /**
   * Frames after a hit lands during which a re-press of `special`
   * extends the move into the next swing. `0` disables chaining
   * entirely (the move plays out to completion regardless of
   * subsequent input). Non-zero ⇒ the player must time the chain
   * input within the window or the move terminates at the current
   * hit.
   */
  readonly chainWindowFrames: number;
}

/**
 * Configuration for the reflector sub-kind.
 *
 * A reflector spawns a defensive sensor body in front of the fighter
 * during the active window. Projectiles colliding with the sensor are
 * "reflected" — their velocity inverted and their damage multiplied —
 * and re-emitted as a hit owned by the reflecting fighter. The
 * reflector itself carries a small contact-damage value so a fighter
 * who walks into it eats a poke (the rare case where the reflector
 * catches a body rather than a projectile).
 *
 * Determinism: integer frame counter for the reflect window + frozen
 * multipliers. The reflect-on-contact event is a pure consequence of
 * the projectile's contact frame; identical inputs always produce
 * identical reflect outcomes.
 */
export interface SideSpecialReflectorSpec {
  /**
   * Damage multiplier applied to a reflected projectile. The reflected
   * hit's damage = `original.damage * reflectMultiplier`. Canonical
   * Smash reflectors use 1.4x-2.0x; we pick 1.5x as the default.
   * Must be > 0.
   */
  readonly reflectMultiplier: number;
  /**
   * Velocity scaling applied to the reflected projectile. Standard
   * "1.0" inverts the velocity vector; values >1 also speed it up
   * (e.g. Falco's reflector uses 2.0). Must be > 0.
   */
  readonly velocityScale: number;
  /**
   * Damage dealt if a fighter (rather than a projectile) touches the
   * reflector field. Small — the reflector is a tool, not a swing.
   * Defaults to 0 if you want a pure-defensive reflector.
   */
  readonly contactDamage: number;
  /**
   * Knockback applied alongside the contact damage. Generally a small
   * "shove away" to disengage, since the reflector isn't meant to KO.
   */
  readonly contactKnockback: KnockbackSpec;
  /**
   * Reflector-field geometry — the sensor body authored facing-right.
   * The runtime mirrors `offsetX` by the fighter's facing on spawn.
   * Authored separately from the move's `hitbox` so the contact-vs-
   * reflect collision filter can route differently.
   */
  readonly reflectorBody: {
    readonly offsetX: number;
    readonly offsetY: number;
    readonly width: number;
    readonly height: number;
  };
}

/**
 * Configuration for the commandDash sub-kind.
 *
 * Combines the dash-strike "go fast in a line" mechanic with the
 * neutral command grab "on connect, throw" mechanic. The fighter
 * lunges forward at `dashSpeed` for `dashFrames`. The opening hitbox
 * (the move's own `hitbox` field) attempts to grab during the active
 * window. On a successful grab the runtime transitions both fighters
 * into a hold + throw sequence at the contact point — the dash itself
 * is the approach, the throw is the payoff.
 *
 * Determinism: integer windows + frozen throw values. Mirrors the
 * neutral command grab schema where applicable; the dash mechanic is
 * the new piece.
 */
export interface SideSpecialCommandDashSpec {
  /** Forward dash speed in Matter px-per-step units. Mirrored by facing. */
  readonly dashSpeed: number;
  /**
   * Frames the dash velocity is enforced. Must be <= `activeFrames`.
   */
  readonly dashFrames: number;
  /**
   * Frames the victim is locked in the held state before the throw
   * launches. Mirrors `NeutralSpecialCommandGrabSpec.grabHoldFrames`.
   */
  readonly grabHoldFrames: number;
  /** Damage applied to the victim on the throw release frame. */
  readonly throwDamage: number;
  /** Knockback vector applied on the throw release frame. */
  readonly throwKnockback: KnockbackSpec;
  /**
   * If `true`, the opening grab hitbox bypasses shield (canonical Smash
   * "grab beats shield" rule). Default `true` — same rationale as
   * `NeutralSpecialCommandGrabSpec.ignoresShield`.
   */
  readonly ignoresShield: boolean;
  /**
   * If `true`, the move enters a helpless state after a whiffed dash
   * until the fighter touches ground. Default `true` for command-dash
   * since the move's payoff is committal.
   */
  readonly helplessOnWhiff: boolean;
}

// ---------------------------------------------------------------------------
// SideSpecialMove discriminated union
// ---------------------------------------------------------------------------

/**
 * Common fields every side-special record carries — extends the base
 * `AttackMoveWithAnimation` contract and pins `type: 'sideSpecial'`.
 */
interface SideSpecialMoveBase extends AttackMoveWithAnimation {
  readonly type: 'sideSpecial';
  readonly sideSpecialKind: SideSpecialKind;
}

/** Dash-strike side-special. */
export interface DashStrikeSideSpecialMove extends SideSpecialMoveBase {
  readonly sideSpecialKind: 'dashStrike';
  readonly dashStrike: SideSpecialDashStrikeSpec;
}

/** Multi-hit side-special. */
export interface MultiHitSideSpecialMove extends SideSpecialMoveBase {
  readonly sideSpecialKind: 'multiHit';
  readonly multiHit: SideSpecialMultiHitSpec;
}

/** Reflector side-special. */
export interface ReflectorSideSpecialMove extends SideSpecialMoveBase {
  readonly sideSpecialKind: 'reflector';
  readonly reflector: SideSpecialReflectorSpec;
}

/** Command-dash side-special. */
export interface CommandDashSideSpecialMove extends SideSpecialMoveBase {
  readonly sideSpecialKind: 'commandDash';
  readonly commandDash: SideSpecialCommandDashSpec;
}

/**
 * Discriminated union of every side-special record. Use
 * `SideSpecialMove['sideSpecialKind']` to switch on the variant; the
 * compiler narrows to the matching detail record automatically.
 */
export type SideSpecialMove =
  | DashStrikeSideSpecialMove
  | MultiHitSideSpecialMove
  | ReflectorSideSpecialMove
  | CommandDashSideSpecialMove;

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

/** True iff `move` is typed `'sideSpecial'` AND carries a `sideSpecialKind` tag. */
export function isSideSpecialMove(move: AttackMove): move is SideSpecialMove {
  if (move.type !== 'sideSpecial') return false;
  const kind = (move as Partial<SideSpecialMoveBase>).sideSpecialKind;
  return (
    kind === 'dashStrike' ||
    kind === 'multiHit' ||
    kind === 'reflector' ||
    kind === 'commandDash'
  );
}

/** True iff `move` is a dash-strike-kind side-special. */
export function isDashStrikeSideSpecial(
  move: AttackMove,
): move is DashStrikeSideSpecialMove {
  return isSideSpecialMove(move) && move.sideSpecialKind === 'dashStrike';
}

/** True iff `move` is a multi-hit-kind side-special. */
export function isMultiHitSideSpecial(
  move: AttackMove,
): move is MultiHitSideSpecialMove {
  return isSideSpecialMove(move) && move.sideSpecialKind === 'multiHit';
}

/** True iff `move` is a reflector-kind side-special. */
export function isReflectorSideSpecial(
  move: AttackMove,
): move is ReflectorSideSpecialMove {
  return isSideSpecialMove(move) && move.sideSpecialKind === 'reflector';
}

/** True iff `move` is a command-dash-kind side-special. */
export function isCommandDashSideSpecial(
  move: AttackMove,
): move is CommandDashSideSpecialMove {
  return isSideSpecialMove(move) && move.sideSpecialKind === 'commandDash';
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Compute the dash velocity vector for a dashStrike or commandDash —
 * `(facing * dashSpeed, 0)`. Pure; identical inputs always produce
 * identical velocities.
 */
export function computeDashVelocity(
  dashSpeed: number,
  facing: 1 | -1,
): { x: number; y: number } {
  return { x: dashSpeed * facing, y: 0 };
}

/**
 * Compute the frame indices (relative to the active phase start) at
 * which each hit in a multi-hit ladder fires. Returns an array of
 * length `hitCount`, with the first entry at frame 0 (active-phase
 * start) and subsequent entries at `hitInterval` increments.
 *
 * Mirrors `computeMultiHitFrames` in `upSpecialSchema.ts`.
 */
export function computeSideMultiHitFrames(
  spec: SideSpecialMultiHitSpec,
): ReadonlyArray<number> {
  const frames: number[] = [];
  for (let i = 0; i < spec.hitCount; i += 1) {
    frames.push(i * spec.hitInterval);
  }
  return frames;
}

/**
 * True iff the given `framesIntoActive` is a hit-spawn frame for the
 * multi-hit ladder. The runtime calls this each active-phase frame to
 * decide "do I spawn a hit this frame?"
 */
export function isSideMultiHitFrame(
  spec: SideSpecialMultiHitSpec,
  framesIntoActive: number,
): boolean {
  if (framesIntoActive < 0) return false;
  if (framesIntoActive % spec.hitInterval !== 0) return false;
  const hitIndex = framesIntoActive / spec.hitInterval;
  return hitIndex >= 0 && hitIndex < spec.hitCount;
}

/**
 * Translate `framesIntoActive` to the corresponding hit index (0-based)
 * in the multi-hit ladder. Returns `-1` if the frame is not a hit-spawn
 * frame.
 */
export function getSideMultiHitIndex(
  spec: SideSpecialMultiHitSpec,
  framesIntoActive: number,
): number {
  if (!isSideMultiHitFrame(spec, framesIntoActive)) return -1;
  return framesIntoActive / spec.hitInterval;
}

/**
 * Compute the realised damage of a reflected projectile.
 * `reflectMultiplier > 0` always; the result is non-negative.
 */
export function computeReflectedDamage(
  spec: SideSpecialReflectorSpec,
  originalDamage: number,
): number {
  const raw = Math.max(0, originalDamage) * spec.reflectMultiplier;
  return raw;
}

/**
 * Compute the velocity vector of a reflected projectile.
 * Inverts the original velocity and scales it by `velocityScale`.
 */
export function computeReflectedVelocity(
  spec: SideSpecialReflectorSpec,
  originalVelocity: { readonly x: number; readonly y: number },
): { x: number; y: number } {
  return {
    x: -originalVelocity.x * spec.velocityScale,
    y: -originalVelocity.y * spec.velocityScale,
  };
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

/**
 * Validate a side-special move record satisfies the schema's
 * invariants:
 *
 *   1. `type === 'sideSpecial'` and `sideSpecialKind` is one of the
 *      four kinds.
 *   2. Per-kind detail record is present and well-formed:
 *        - dashStrike: `dashSpeed > 0`, `dashFrames` positive integer
 *                      `<= activeFrames`.
 *        - multiHit: `hitCount >= 1`, `hitInterval > 0`,
 *                    `damagePerHit.length === hitCount`,
 *                    `knockbackPerHit.length === hitCount`,
 *                    final hit fires inside `activeFrames`,
 *                    `chainWindowFrames >= 0`.
 *        - reflector: `reflectMultiplier > 0`, `velocityScale > 0`,
 *                     `contactDamage >= 0`, reflector-body dimensions
 *                     positive.
 *        - commandDash: `dashSpeed > 0`,
 *                       `dashFrames` positive integer `<= activeFrames`,
 *                       `grabHoldFrames` non-negative integer,
 *                       `throwDamage >= 0`.
 *
 * Returns the move unchanged on success; throws on the first invariant
 * violation. Tests call this on every per-character side-special record
 * so a future tuning pass can't accidentally publish a broken record.
 */
export function validateSideSpecialMove(move: SideSpecialMove): SideSpecialMove {
  if (move.type !== 'sideSpecial') {
    throw new Error(
      `SideSpecialMove '${move.id}': type must be 'sideSpecial', got '${move.type}'`,
    );
  }
  const busyTotal = getMoveBusyFrames(move);

  switch (move.sideSpecialKind) {
    case 'dashStrike': {
      const d = move.dashStrike;
      if (!Number.isFinite(d.dashSpeed) || d.dashSpeed <= 0) {
        throw new Error(
          `SideSpecialMove '${move.id}': dashStrike.dashSpeed must be > 0, got ${d.dashSpeed}`,
        );
      }
      if (!Number.isInteger(d.dashFrames) || d.dashFrames < 1) {
        throw new Error(
          `SideSpecialMove '${move.id}': dashStrike.dashFrames must be a positive integer, got ${d.dashFrames}`,
        );
      }
      if (d.dashFrames > move.activeFrames) {
        throw new Error(
          `SideSpecialMove '${move.id}': dashStrike.dashFrames=${d.dashFrames} exceeds activeFrames=${move.activeFrames}`,
        );
      }
      break;
    }
    case 'multiHit': {
      const m = move.multiHit;
      if (!Number.isInteger(m.hitCount) || m.hitCount < 1) {
        throw new Error(
          `SideSpecialMove '${move.id}': multiHit.hitCount must be a positive integer, got ${m.hitCount}`,
        );
      }
      if (!Number.isInteger(m.hitInterval) || m.hitInterval < 1) {
        throw new Error(
          `SideSpecialMove '${move.id}': multiHit.hitInterval must be a positive integer, got ${m.hitInterval}`,
        );
      }
      if (m.damagePerHit.length !== m.hitCount) {
        throw new Error(
          `SideSpecialMove '${move.id}': multiHit.damagePerHit.length=${m.damagePerHit.length} must equal hitCount=${m.hitCount}`,
        );
      }
      if (m.knockbackPerHit.length !== m.hitCount) {
        throw new Error(
          `SideSpecialMove '${move.id}': multiHit.knockbackPerHit.length=${m.knockbackPerHit.length} must equal hitCount=${m.hitCount}`,
        );
      }
      const finalHitOffset = (m.hitCount - 1) * m.hitInterval;
      if (finalHitOffset >= move.activeFrames) {
        throw new Error(
          `SideSpecialMove '${move.id}': multiHit final hit at active-frame ${finalHitOffset} exceeds activeFrames=${move.activeFrames}`,
        );
      }
      for (let i = 0; i < m.damagePerHit.length; i += 1) {
        const dmg = m.damagePerHit[i];
        if (dmg === undefined || !Number.isFinite(dmg) || dmg < 0) {
          throw new Error(
            `SideSpecialMove '${move.id}': multiHit.damagePerHit[${i}] must be a non-negative finite number, got ${dmg}`,
          );
        }
      }
      if (!Number.isInteger(m.chainWindowFrames) || m.chainWindowFrames < 0) {
        throw new Error(
          `SideSpecialMove '${move.id}': multiHit.chainWindowFrames must be non-negative integer, got ${m.chainWindowFrames}`,
        );
      }
      break;
    }
    case 'reflector': {
      const r = move.reflector;
      if (!Number.isFinite(r.reflectMultiplier) || r.reflectMultiplier <= 0) {
        throw new Error(
          `SideSpecialMove '${move.id}': reflector.reflectMultiplier must be > 0, got ${r.reflectMultiplier}`,
        );
      }
      if (!Number.isFinite(r.velocityScale) || r.velocityScale <= 0) {
        throw new Error(
          `SideSpecialMove '${move.id}': reflector.velocityScale must be > 0, got ${r.velocityScale}`,
        );
      }
      if (r.contactDamage < 0) {
        throw new Error(
          `SideSpecialMove '${move.id}': reflector.contactDamage must be >= 0, got ${r.contactDamage}`,
        );
      }
      const body = r.reflectorBody;
      if (body.width <= 0 || body.height <= 0) {
        throw new Error(
          `SideSpecialMove '${move.id}': reflector body dimensions must be positive (got ${body.width}x${body.height})`,
        );
      }
      break;
    }
    case 'commandDash': {
      const c = move.commandDash;
      if (!Number.isFinite(c.dashSpeed) || c.dashSpeed <= 0) {
        throw new Error(
          `SideSpecialMove '${move.id}': commandDash.dashSpeed must be > 0, got ${c.dashSpeed}`,
        );
      }
      if (!Number.isInteger(c.dashFrames) || c.dashFrames < 1) {
        throw new Error(
          `SideSpecialMove '${move.id}': commandDash.dashFrames must be a positive integer, got ${c.dashFrames}`,
        );
      }
      if (c.dashFrames > move.activeFrames) {
        throw new Error(
          `SideSpecialMove '${move.id}': commandDash.dashFrames=${c.dashFrames} exceeds activeFrames=${move.activeFrames}`,
        );
      }
      if (!Number.isInteger(c.grabHoldFrames) || c.grabHoldFrames < 0) {
        throw new Error(
          `SideSpecialMove '${move.id}': commandDash.grabHoldFrames must be non-negative integer, got ${c.grabHoldFrames}`,
        );
      }
      if (c.throwDamage < 0) {
        throw new Error(
          `SideSpecialMove '${move.id}': commandDash.throwDamage must be >= 0, got ${c.throwDamage}`,
        );
      }
      break;
    }
    default: {
      // Exhaustiveness: TypeScript sees `move` narrowed to `never` here.
      const _exhaustive: never = move;
      throw new Error(
        `SideSpecialMove: unknown sideSpecialKind on ${(_exhaustive as { id?: string }).id ?? '<unknown>'}`,
      );
    }
  }

  // Sanity: animation counts must each be >= 1 if present.
  const anim = move.animation;
  if (anim) {
    if (anim.startupFrames < 1 || anim.activeFrames < 1 || anim.recoveryFrames < 1) {
      throw new Error(
        `SideSpecialMove '${move.id}': animation phase counts must each be >= 1`,
      );
    }
  }

  // Validate the canonical phase classifier doesn't blow up on any
  // frame in [0, busyTotal].
  for (const f of [0, busyTotal - 1, busyTotal]) {
    computeAttackPhase(f, move);
  }

  return move;
}
