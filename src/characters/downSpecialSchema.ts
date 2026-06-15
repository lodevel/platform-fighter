/**
 * Down-special move data schema — AC 60304 Sub-AC 4.
 *
 * Seventh move family in the per-character kit (after the grounded
 * triplet jab / tilt / smash, the aerial triplet nair / fair / bair,
 * the neutral special, the up special, and the side special). Each of
 * the four roster slots ships exactly ONE down special, and each one
 * uses a *different* mechanic so the four characters feel meaningfully
 * different on the "stick-down + special" input AND fill a unique
 * tactical niche distinct from their other specials.
 *
 * The Seed mandates four distinct down-special mechanics for the four
 * roster slots (the AC's example list calls out "counter, ground pound,
 * trap placement" as canonical down-B archetypes). We pick one canonical
 * Smash-Bros down-B archetype per character, mapped to the character's
 * existing role and chosen so neither the discriminator nor the in-
 * game *feel* duplicates any of the character's other specials:
 *
 *   • Wolf  (bruiser) → groundPound  — Wolf hops a few frames upward
 *                                       then crashes straight down at
 *                                       high velocity. The descent body
 *                                       acts as a meteor hitbox; on
 *                                       ground contact a shockwave fires
 *                                       outward. Mirrors Bowser's
 *                                       Bowser Bomb / Donkey Kong's Hand
 *                                       Slap on the ground-side. Bruiser
 *                                       trade: huge commitment, huge
 *                                       payoff if he lands it on
 *                                       someone shielding poorly below.
 *
 *   • Cat   (ninja)   → trap         — Cat plants a small armed sensor
 *                                       at her feet that detonates when
 *                                       an opponent walks onto it.
 *                                       Mirrors Snake's down-B mine /
 *                                       Steve's TNT-place / R.O.B.'s gyro
 *                                       — the "stage-control" tool that
 *                                       extends the ninja's information-
 *                                       war kit. One trap at a time;
 *                                       placing a new trap removes the
 *                                       previous one.
 *
 *   • Owl   (mage)    → stallAndFall — Owl pauses in the air briefly
 *                                       (stall window) then plunges
 *                                       straight down with a body-
 *                                       attached meteor hitbox. On
 *                                       ground contact a shockwave
 *                                       fires outward. Mirrors Yoshi's
 *                                       Yoshi Bomb / Greninja's Hydro
 *                                       Pump-aerial-fall idiom. Mage
 *                                       trade: timing-test recovery
 *                                       option, KO finisher off-stage if
 *                                       the opponent reads it wrong.
 *
 *   • Bear  (grappler)→ counter      — Bear plants himself and opens a
 *                                       parry window. An incoming hit
 *                                       during the window is absorbed
 *                                       and a heavy-uppercut retaliation
 *                                       fires in front of Bear with a
 *                                       hard upward launch trajectory.
 *                                       Mirrors Lucario's down-B counter,
 *                                       Marth's Counter (canonically a
 *                                       down-B in the Smash Bros canon).
 *                                       Grappler trade: highest damage
 *                                       multiplier in the cast (1.5×)
 *                                       and a vertical-KO retaliation —
 *                                       the punish for misreading Bear's
 *                                       grab game is one whole stock.
 *
 * Why the four down-kinds are pairwise distinct from the four neutral-
 * special / side-special / up-special kinds the same characters ship:
 *
 *   • Wolf already has counter (neutral) and dashStrike (side) and
 *     multiHitRising (up). Down = groundPound — a vertical-body-slam
 *     archetype none of his other specials covers. Reads as "Wolf
 *     committing his whole weight straight down".
 *
 *   • Cat already has projectile (neutral) and multiHit (side) and
 *     teleport (up). Down = trap — a stage-control archetype none of her
 *     other specials covers. Reads as "Cat sets a snare and waits".
 *
 *   • Owl already has charge (neutral) and reflector (side) and
 *     directionalJump (up). Down = stallAndFall — a stall-and-plummet
 *     archetype none of his other specials covers. Reads as "Owl drops
 *     out of the air".
 *
 *   • Bear already has commandGrab (neutral) and commandDash (side) and
 *     tether (up). Down = counter — a parry archetype none of his other
 *     specials covers. Reads as "Bear plants and dares you to swing".
 *     The down-counter discriminator string ('counter') is identical to
 *     Wolf's NEUTRAL-special discriminator string, but they live on
 *     DIFFERENT schemas (`NeutralSpecialMove` vs `DownSpecialMove`) — a
 *     consumer narrowing on the move's `type` field gets the right
 *     schema without ambiguity. The numbers are also tuned differently
 *     (Bear's counter has a higher damage multiplier and a vertical-KO
 *     trajectory; Wolf's is horizontal); they read as the same
 *     *category of move* but different *flavours*.
 *
 * This module is the data contract those records share. Like
 * `aerialSchema.ts`, `specialSchema.ts`, `upSpecialSchema.ts`, and
 * `sideSpecialSchema.ts`, it sits OUTSIDE the base `attacks.ts` /
 * `moveSchema.ts` so the four shared kinds can declare kind-specific
 * fields without polluting the grounded / aerial / other-special
 * schemas. Every `DownSpecialMove` is also a structural
 * `AttackMoveWithAnimation`, so:
 *
 *   • The runtime attack state machine (startup → active → recovery →
 *     done) drives them through `Character.tickAttack` unchanged. The
 *     four kinds layer additional behaviour on top of the canonical
 *     hitbox-spawn-during-active mechanic without re-implementing it.
 *
 *   • The animation state machine
 *     (`computeAttackPhase` / `selectAnimationFrame`) keeps working —
 *     each down-special declares the same `animation` block other moves
 *     do.
 *
 *   • The roster tooling (`CHARACTER_ROSTER`, `findMoveByType`) sees
 *     down-specials as plain `AttackMove`s with `type: 'downSpecial'`,
 *     so a consumer that asks "does Wolf have a down-special?" via
 *     `findMoveByType(spec, 'downSpecial')` gets the right record.
 *
 * The four kinds are a *discriminated union* on `downSpecialKind` so a
 * caller iterating a moveset can narrow type-safely:
 *
 *     for (const m of spec.moves) {
 *       if (m.type !== 'downSpecial') continue;
 *       const dn = m as DownSpecialMove;
 *       switch (dn.downSpecialKind) {
 *         case 'groundPound':   handleGroundPound(dn);   break;
 *         case 'trap':          handleTrap(dn);          break;
 *         case 'stallAndFall':  handleStallAndFall(dn);  break;
 *         case 'counter':       handleCounter(dn);       break;
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
 * working unchanged. The new `DownSpecialMove` records are APPENDED to
 * each character's moveset and registered through the existing
 * `Character.registerAttack` pipeline (with a small extension that
 * auto-fills a `downSpecialId` slot when a `'downSpecial'`-typed move
 * is registered — mirroring the `neutralSpecialId` / `upSpecialId`
 * wiring already in place).
 */

import type { AttackMove } from './attacks';
import type {
  AttackMoveWithAnimation,
  KnockbackSpec,
} from './moveSchema';
import { computeAttackPhase, getMoveBusyFrames } from './moveSchema';

// ---------------------------------------------------------------------------
// Down-special-kind discriminator
// ---------------------------------------------------------------------------

/**
 * Which mechanic the down-special implements. Each character ships
 * exactly one of these, and the four are deliberately distinct so the
 * "stick-down + special" press feels different on every character AND
 * offers four genuinely different gameplay textures.
 *
 *   - `'groundPound'`  : a *hop-then-slam* mechanic. On press the fighter
 *                        gains a short upward impulse for `hopFrames`
 *                        frames, then gains a strong downward velocity
 *                        and falls until ground contact. The descent
 *                        body carries a meteor-style hitbox (steep
 *                        downward knockback); on ground contact a
 *                        shockwave hitbox fires outward at ground level.
 *
 *   - `'trap'`         : a *place-and-arm* mechanic. The active phase
 *                        spawns a small sensor body at the fighter's
 *                        feet that becomes lethal after `armDelayFrames`
 *                        frames and despawns after `trapLifetimeFrames`
 *                        total frames. On contact with an opponent the
 *                        trap detonates dealing `trapDamage` and
 *                        applying `trapKnockback`. Limited to
 *                        `maxActiveTraps` simultaneous traps per
 *                        fighter; placing the (limit + 1)-th trap
 *                        despawns the oldest.
 *
 *   - `'stallAndFall'` : a *brief-stall-then-plunge* mechanic. On press
 *                        the fighter's vertical velocity is set to
 *                        `stallVelocity` for `stallFrames` frames (a
 *                        short hover/wind-up), then snapped to
 *                        `fallVelocity` (positive = downward in Phaser
 *                        screen-space). The body acts as a meteor
 *                        hitbox during the fall; on ground contact a
 *                        shockwave hitbox fires outward.
 *
 *   - `'counter'`      : a *parry-and-retaliate* mechanic. During the
 *                        move's `[counterWindowStart, counterWindowEnd)`
 *                        frame range the fighter is invincible AND will
 *                        latch the next incoming hit. On a successful
 *                        catch, a retaliation hitbox spawns in front of
 *                        the fighter dealing damage scaled by the
 *                        absorbed hit (clamped between
 *                        `minCounterDamage` and `maxCounterDamage`) and
 *                        applying a fixed `counterKnockback` vector.
 *                        Whiffed counters carry a long recovery so the
 *                        move is committal. Mirrors the parry idiom of
 *                        the neutral-special counter (`specialSchema.ts`
 *                        `NeutralSpecialCounterSpec`) but tuned for the
 *                        down-special slot — different multiplier,
 *                        different clamp range, different launch vector.
 */
export type DownSpecialKind =
  | 'groundPound'
  | 'trap'
  | 'stallAndFall'
  | 'counter';

// ---------------------------------------------------------------------------
// Per-kind detail records
// ---------------------------------------------------------------------------

/**
 * Configuration for the groundPound sub-kind.
 *
 * Two-phase mechanic:
 *
 *   1. Hop phase — for the first `hopFrames` frames of the active window
 *      the fighter's vertical velocity is set to `hopImpulse`
 *      (NEGATIVE in Phaser screen-space = upward). The hop is short and
 *      cosmetic — it's the wind-up before the slam.
 *
 *   2. Slam phase — at `hopFrames` the fighter's vertical velocity is
 *      snapped to `slamVelocity` (POSITIVE = downward). The body acts
 *      as a meteor hitbox during the descent: any opponent overlapped
 *      takes `damage` (the move's own `damage` field, which is the
 *      meteor descent value) and `knockback` (typically a steep
 *      downward vector — the canonical meteor / spike trajectory).
 *
 *   3. Landing — on ground contact the runtime spawns a shockwave
 *      hitbox at the fighter's feet using the `shockwaveHitbox`
 *      geometry, dealing `shockwaveDamage` and applying
 *      `shockwaveKnockback`. The shockwave is short-lived (1-2 frames)
 *      and the runtime is responsible for despawning it on the
 *      following frame.
 *
 * Coordinate system: `hopImpulse` and `slamVelocity` are vertical
 * velocity values in Matter "px-per-step" units, with the canonical
 * Phaser screen-space sign convention (negative = upward, positive =
 * downward). `shockwaveHitbox.offsetY` is positive (below the body
 * centre) so the shockwave appears at the fighter's feet on landing.
 *
 * Determinism: integer frame counters + frozen geometry. Identical
 * press frames always produce identical hop / slam trajectories;
 * identical landing positions always produce identical shockwave
 * geometry.
 */
export interface DownSpecialGroundPoundSpec {
  /**
   * Frames the hop wind-up lasts at the start of the active window. The
   * fighter's velocity is set to `hopImpulse` for these frames; on the
   * frame after the hop ends the slam phase begins. Must be a positive
   * integer and must be < `activeFrames` so the slam phase is
   * non-empty.
   */
  readonly hopFrames: number;
  /**
   * Vertical velocity during the hop wind-up, in Matter px-per-step
   * units. NEGATIVE = upward (Phaser screen-space). Typical: -8 to -12
   * — short hop, the visual wind-up before the slam.
   */
  readonly hopImpulse: number;
  /**
   * Vertical velocity during the slam descent, in Matter px-per-step
   * units. POSITIVE = downward. Typical: 24-32 — meaningfully faster
   * than gravity-only fall so the move reads as "Wolf forces himself
   * down".
   */
  readonly slamVelocity: number;
  /**
   * Damage dealt by the shockwave hitbox spawned on ground contact.
   * Non-negative.
   */
  readonly shockwaveDamage: number;
  /**
   * Knockback applied by the shockwave hitbox. Typically a flat
   * outward + slightly upward vector so opponents standing next to the
   * landing point are launched away from the fighter (not over him).
   */
  readonly shockwaveKnockback: KnockbackSpec;
  /**
   * Geometry for the shockwave hitbox spawned on ground contact.
   * Authored facing-right; the runtime spawns the sensor centred on
   * the landing position with the given dimensions. `offsetY` is
   * usually positive (below the body centre) so the shockwave appears
   * at the fighter's feet, NOT centred on his torso.
   */
  readonly shockwaveHitbox: {
    readonly offsetX: number;
    readonly offsetY: number;
    readonly width: number;
    readonly height: number;
  };
}

/**
 * Configuration for the trap sub-kind.
 *
 * Place-and-arm mechanic: the active phase spawns a small sensor body
 * at the fighter's feet (offset by `(spawnOffsetX, spawnOffsetY)`).
 * The trap progresses through three life stages:
 *
 *   1. Arming — for the first `armDelayFrames` frames after spawn the
 *      trap is inert. Stepping on it does nothing. This window is what
 *      gives the move counter-play: a fast opponent can rush the trap
 *      and clear it before it arms.
 *
 *   2. Armed — from `armDelayFrames` until `trapLifetimeFrames` the
 *      trap is lethal. Any opponent overlap detonates the trap dealing
 *      `trapDamage` and applying `trapKnockback`. Detonation despawns
 *      the trap.
 *
 *   3. Expired — at `trapLifetimeFrames` the trap auto-despawns even
 *      if no opponent triggered it. Cleanup is handled by the runtime;
 *      the move record itself is purely descriptive.
 *
 * Limit: `maxActiveTraps` controls how many simultaneous traps a
 * fighter can have in the world. Placing the (limit+1)-th trap
 * despawns the OLDEST trap (FIFO), so a player can refresh trap
 * positioning without paying a "you already have a trap" penalty.
 *
 * Determinism: integer frame counters + frozen geometry + FIFO ordering.
 * Identical press positions and frames always produce identical trap
 * placements and detonation results.
 */
export interface DownSpecialTrapSpec {
  /** Trap sensor width in design pixels. */
  readonly trapWidth: number;
  /** Trap sensor height in design pixels. */
  readonly trapHeight: number;
  /** Spawn-offset X in design pixels (centre of trap relative to fighter centre). */
  readonly spawnOffsetX: number;
  /**
   * Spawn-offset Y in design pixels. POSITIVE = below the fighter
   * centre — the trap is placed at the fighter's feet, not at her
   * torso.
   */
  readonly spawnOffsetY: number;
  /**
   * Frames the trap is inert before arming. During this window the
   * trap deals no damage on contact. Non-negative integer.
   */
  readonly armDelayFrames: number;
  /**
   * Total frames the trap exists in the world before auto-despawn,
   * counted from the spawn frame. Must be > `armDelayFrames` so the
   * trap has at least one armed frame.
   */
  readonly trapLifetimeFrames: number;
  /**
   * Damage dealt on detonation. The damage is one-shot — the trap
   * despawns on the same frame, so it can't tick or multi-hit.
   */
  readonly trapDamage: number;
  /** Knockback applied on detonation. */
  readonly trapKnockback: KnockbackSpec;
  /**
   * Maximum simultaneous traps this fighter can have placed. Placing
   * the `(maxActiveTraps + 1)`-th trap despawns the oldest. Must be
   * a positive integer.
   */
  readonly maxActiveTraps: number;
  /**
   * Optional TIMED-BOMB fuse. When set, the trap behaves like a thrown bomb
   * instead of a contact mine: it stays inert until this many frames after
   * spawn, then DETONATES — its blast hitbox spawns for a few frames (dealing
   * `trapDamage` / `trapKnockback` to anyone in range) and the trap despawns.
   * Overrides `armDelayFrames` / `trapLifetimeFrames`. Omit for the classic
   * place-and-arm contact mine (Cat). This is Samus's morph-ball bomb.
   */
  readonly fuseDetonateFrames?: number;
  /**
   * Optional BOMB-JUMP self-bounce. When a fused bomb detonates, if the PLACER
   * is within blast range their vertical velocity is set to this value
   * (NEGATIVE = upward) — Samus's morph-ball bomb-jump recovery. Omit for no
   * self-bounce. Ignored unless `fuseDetonateFrames` is set.
   */
  readonly selfBounceVelocity?: number;
}

/**
 * Configuration for the stallAndFall sub-kind.
 *
 * Brief-stall-then-plunge mechanic:
 *
 *   1. Stall phase — for the first `stallFrames` frames of the active
 *      window the fighter's vertical velocity is set to `stallVelocity`
 *      (typically a small negative value for a slight upward hover, or
 *      0 for a true stall). Gravity is suppressed during this window
 *      so the fighter holds altitude.
 *
 *   2. Fall phase — at `stallFrames` the fighter's vertical velocity is
 *      snapped to `fallVelocity` (POSITIVE = downward) and held until
 *      ground contact. The body acts as a meteor hitbox during the
 *      fall — same idiom as `groundPound`'s descent.
 *
 *   3. Landing — on ground contact a shockwave hitbox spawns at the
 *      fighter's feet (same idiom as `groundPound`).
 *
 *   4. Helpless (optional) — if `helplessAfterFall` is `true`, the
 *      fighter is locked out of any input until the next ground
 *      contact, mirroring the canonical Smash "down-B as a recovery"
 *      lockout. Default `false` — Owl's stallAndFall is meant to be a
 *      neutral-game tool, not a recovery, so the fighter can act after
 *      the move's recovery phase ends.
 *
 * Determinism: integer frame counters + frozen velocities. Identical
 * press positions always produce identical fall trajectories.
 */
export interface DownSpecialStallAndFallSpec {
  /**
   * Frames the stall phase lasts at the start of the active window.
   * Must be a positive integer and must be < `activeFrames` so the fall
   * phase is non-empty. Typical: 5-10 — short, just long enough for
   * the player to register the wind-up visually.
   */
  readonly stallFrames: number;
  /**
   * Vertical velocity during the stall, in Matter px-per-step units.
   * NEGATIVE = upward, 0 = true hover, POSITIVE = slow descent. Typical:
   * -2 to 0 (slight rise / hover).
   */
  readonly stallVelocity: number;
  /**
   * Vertical velocity during the fall phase, in Matter px-per-step
   * units. POSITIVE = downward. Typical: 24-30 — fast plunge for a
   * meteor archetype.
   */
  readonly fallVelocity: number;
  /**
   * Damage dealt by the shockwave hitbox spawned on ground contact.
   * Non-negative.
   */
  readonly shockwaveDamage: number;
  /**
   * Knockback applied by the shockwave hitbox. Typically outward +
   * slightly upward — same idiom as `groundPound`.
   */
  readonly shockwaveKnockback: KnockbackSpec;
  /**
   * Geometry for the shockwave hitbox spawned on ground contact.
   * Authored same way as `groundPound`'s `shockwaveHitbox`.
   */
  readonly shockwaveHitbox: {
    readonly offsetX: number;
    readonly offsetY: number;
    readonly width: number;
    readonly height: number;
  };
  /**
   * If `true`, the fighter is helpless after the fall ends (canonical
   * "down-B as a recovery" lockout). Default `false` — stallAndFall is
   * meant to be a neutral-game tool. The flag is here for tuning.
   */
  readonly helplessAfterFall: boolean;
}

/**
 * Configuration for the counter sub-kind.
 *
 * Parry-and-retaliate mechanic — same shape as
 * `NeutralSpecialCounterSpec` (see `specialSchema.ts`) so the runtime
 * can reuse the existing counter-handler logic. The down-special
 * counter is tuned differently: typically a higher damage multiplier
 * and a vertical-launch knockback (vs the neutral counter's horizontal
 * launch), giving the down-counter a distinct flavour.
 *
 * The schema mirrors `NeutralSpecialCounterSpec` field-for-field so a
 * future runtime helper can accept either shape behind a structural
 * type. We intentionally do NOT re-export the neutral type here — the
 * fields are duplicated so each schema stays self-contained and a
 * tuning pass on one doesn't surprise the other.
 *
 * Determinism: integer windows, frozen multipliers + clamps.
 * `accumulateDamage` (called by the damage handler) clamps the
 * realised damage at `MAX_DAMAGE_PERCENT` so the counter math never
 * overflows.
 */
export interface DownSpecialCounterSpec {
  /** First frame of the parry window (inclusive). */
  readonly counterWindowStart: number;
  /** First frame past the parry window (exclusive). */
  readonly counterWindowEnd: number;
  /**
   * Multiplier applied to the absorbed move's damage to derive the
   * retaliation damage. Down counters typically use 1.4-1.6× — heavier
   * than neutral counters since the move is more committal.
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

// ---------------------------------------------------------------------------
// DownSpecialMove discriminated union
// ---------------------------------------------------------------------------

/**
 * Common fields every down-special record carries — extends the base
 * `AttackMoveWithAnimation` contract and pins `type: 'downSpecial'`.
 */
interface DownSpecialMoveBase extends AttackMoveWithAnimation {
  readonly type: 'downSpecial';
  readonly downSpecialKind: DownSpecialKind;
}

/** Ground-pound down-special. */
export interface GroundPoundDownSpecialMove extends DownSpecialMoveBase {
  readonly downSpecialKind: 'groundPound';
  readonly groundPound: DownSpecialGroundPoundSpec;
}

/** Trap-placement down-special. */
export interface TrapDownSpecialMove extends DownSpecialMoveBase {
  readonly downSpecialKind: 'trap';
  readonly trap: DownSpecialTrapSpec;
}

/** Stall-and-fall down-special. */
export interface StallAndFallDownSpecialMove extends DownSpecialMoveBase {
  readonly downSpecialKind: 'stallAndFall';
  readonly stallAndFall: DownSpecialStallAndFallSpec;
}

/** Counter down-special. */
export interface CounterDownSpecialMove extends DownSpecialMoveBase {
  readonly downSpecialKind: 'counter';
  readonly counter: DownSpecialCounterSpec;
}

/**
 * Discriminated union of every down-special record. Use
 * `DownSpecialMove['downSpecialKind']` to switch on the variant; the
 * compiler narrows to the matching detail record automatically.
 */
export type DownSpecialMove =
  | GroundPoundDownSpecialMove
  | TrapDownSpecialMove
  | StallAndFallDownSpecialMove
  | CounterDownSpecialMove;

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

/** True iff `move` is typed `'downSpecial'` AND carries a `downSpecialKind` tag. */
export function isDownSpecialMove(move: AttackMove): move is DownSpecialMove {
  if (move.type !== 'downSpecial') return false;
  const kind = (move as Partial<DownSpecialMoveBase>).downSpecialKind;
  return (
    kind === 'groundPound' ||
    kind === 'trap' ||
    kind === 'stallAndFall' ||
    kind === 'counter'
  );
}

/** True iff `move` is a ground-pound-kind down-special. */
export function isGroundPoundDownSpecial(
  move: AttackMove,
): move is GroundPoundDownSpecialMove {
  return isDownSpecialMove(move) && move.downSpecialKind === 'groundPound';
}

/** True iff `move` is a trap-kind down-special. */
export function isTrapDownSpecial(
  move: AttackMove,
): move is TrapDownSpecialMove {
  return isDownSpecialMove(move) && move.downSpecialKind === 'trap';
}

/** True iff `move` is a stall-and-fall-kind down-special. */
export function isStallAndFallDownSpecial(
  move: AttackMove,
): move is StallAndFallDownSpecialMove {
  return isDownSpecialMove(move) && move.downSpecialKind === 'stallAndFall';
}

/** True iff `move` is a counter-kind down-special. */
export function isCounterDownSpecial(
  move: AttackMove,
): move is CounterDownSpecialMove {
  return isDownSpecialMove(move) && move.downSpecialKind === 'counter';
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Pure predicate: is `framesIntoActive` inside the ground-pound HOP
 * phase? The hop runs for `[0, hopFrames)` of the active window; from
 * `hopFrames` onward the slam phase takes over.
 */
export function isInGroundPoundHopPhase(
  move: GroundPoundDownSpecialMove,
  framesIntoActive: number,
): boolean {
  return framesIntoActive >= 0 && framesIntoActive < move.groundPound.hopFrames;
}

/**
 * Pure predicate: is `framesIntoActive` inside the ground-pound SLAM
 * phase? The slam runs from `hopFrames` to the end of the active window.
 */
export function isInGroundPoundSlamPhase(
  move: GroundPoundDownSpecialMove,
  framesIntoActive: number,
): boolean {
  return (
    framesIntoActive >= move.groundPound.hopFrames &&
    framesIntoActive < move.activeFrames
  );
}

/**
 * Pure predicate: is `framesIntoActive` inside the stall-and-fall STALL
 * phase? Stall runs for `[0, stallFrames)`.
 */
export function isInStallAndFallStallPhase(
  move: StallAndFallDownSpecialMove,
  framesIntoActive: number,
): boolean {
  return (
    framesIntoActive >= 0 && framesIntoActive < move.stallAndFall.stallFrames
  );
}

/**
 * Pure predicate: is `framesIntoActive` inside the stall-and-fall FALL
 * phase? Fall runs from `stallFrames` to the end of the active window.
 */
export function isInStallAndFallFallPhase(
  move: StallAndFallDownSpecialMove,
  framesIntoActive: number,
): boolean {
  return (
    framesIntoActive >= move.stallAndFall.stallFrames &&
    framesIntoActive < move.activeFrames
  );
}

/**
 * Pure predicate: is the trap ARMED at `framesSinceSpawn`? The arming
 * window is `[armDelayFrames, trapLifetimeFrames)`; before that the trap
 * is inert, after that it has expired.
 */
export function isTrapArmed(
  move: TrapDownSpecialMove,
  framesSinceSpawn: number,
): boolean {
  return (
    framesSinceSpawn >= move.trap.armDelayFrames &&
    framesSinceSpawn < move.trap.trapLifetimeFrames
  );
}

/**
 * Pure predicate: has the trap EXPIRED at `framesSinceSpawn`? Returns
 * true once the trap has lived past its `trapLifetimeFrames`.
 */
export function isTrapExpired(
  move: TrapDownSpecialMove,
  framesSinceSpawn: number,
): boolean {
  return framesSinceSpawn >= move.trap.trapLifetimeFrames;
}

/**
 * Pure predicate: is `framesElapsed` inside the down-counter's parry
 * window? Mirrors `isInCounterWindow` from `specialSchema.ts`.
 */
export function isInDownCounterWindow(
  move: CounterDownSpecialMove,
  framesElapsed: number,
): boolean {
  return (
    framesElapsed >= move.counter.counterWindowStart &&
    framesElapsed < move.counter.counterWindowEnd
  );
}

/**
 * Compute the realised retaliation damage for a down-counter that
 * absorbed `absorbedDamage`. Multiplies by `damageMultiplier` then
 * clamps between `minCounterDamage` and `maxCounterDamage`. Pure.
 *
 * Mirrors `computeCounterDamage` from `specialSchema.ts` so a runtime
 * helper can route either neutral or down counters through the same
 * damage-calculation path.
 */
export function computeDownCounterDamage(
  move: CounterDownSpecialMove,
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
 * Validate a down-special move record satisfies the schema's invariants:
 *
 *   1. `type === 'downSpecial'` and `downSpecialKind` is one of the
 *      four kinds.
 *   2. Per-kind detail record is present and well-formed:
 *        - groundPound: `hopFrames` positive integer < `activeFrames`,
 *                       `hopImpulse < 0` (upward), `slamVelocity > 0`
 *                       (downward), shockwave damage non-negative,
 *                       shockwave dimensions positive.
 *        - trap: `trapWidth/trapHeight > 0`, `armDelayFrames >= 0`
 *                integer, `trapLifetimeFrames > armDelayFrames` integer,
 *                `trapDamage >= 0`, `maxActiveTraps >= 1` integer.
 *        - stallAndFall: `stallFrames` positive integer < `activeFrames`,
 *                        `fallVelocity > 0`, shockwave damage
 *                        non-negative, shockwave dimensions positive.
 *        - counter: `counterWindowStart < counterWindowEnd`, both
 *                   non-negative integers and within the move's busy
 *                   frames; `damageMultiplier > 0`;
 *                   `minCounterDamage <= maxCounterDamage`; counter
 *                   hitbox dimensions positive.
 *
 * Returns the move unchanged on success; throws on the first invariant
 * violation.
 */
export function validateDownSpecialMove(
  move: DownSpecialMove,
): DownSpecialMove {
  if (move.type !== 'downSpecial') {
    throw new Error(
      `DownSpecialMove '${move.id}': type must be 'downSpecial', got '${move.type}'`,
    );
  }
  const busyTotal = getMoveBusyFrames(move);

  switch (move.downSpecialKind) {
    case 'groundPound': {
      const g = move.groundPound;
      if (!Number.isInteger(g.hopFrames) || g.hopFrames < 1) {
        throw new Error(
          `DownSpecialMove '${move.id}': groundPound.hopFrames must be a positive integer, got ${g.hopFrames}`,
        );
      }
      if (g.hopFrames >= move.activeFrames) {
        throw new Error(
          `DownSpecialMove '${move.id}': groundPound.hopFrames=${g.hopFrames} must be < activeFrames=${move.activeFrames} (slam phase non-empty)`,
        );
      }
      if (!Number.isFinite(g.hopImpulse) || g.hopImpulse >= 0) {
        throw new Error(
          `DownSpecialMove '${move.id}': groundPound.hopImpulse must be negative (upward), got ${g.hopImpulse}`,
        );
      }
      if (!Number.isFinite(g.slamVelocity) || g.slamVelocity <= 0) {
        throw new Error(
          `DownSpecialMove '${move.id}': groundPound.slamVelocity must be positive (downward), got ${g.slamVelocity}`,
        );
      }
      if (g.shockwaveDamage < 0) {
        throw new Error(
          `DownSpecialMove '${move.id}': groundPound.shockwaveDamage must be >= 0, got ${g.shockwaveDamage}`,
        );
      }
      if (g.shockwaveHitbox.width <= 0 || g.shockwaveHitbox.height <= 0) {
        throw new Error(
          `DownSpecialMove '${move.id}': groundPound.shockwaveHitbox dimensions must be positive (got ${g.shockwaveHitbox.width}x${g.shockwaveHitbox.height})`,
        );
      }
      break;
    }
    case 'trap': {
      const t = move.trap;
      if (t.trapWidth <= 0 || t.trapHeight <= 0) {
        throw new Error(
          `DownSpecialMove '${move.id}': trap dimensions must be positive (got ${t.trapWidth}x${t.trapHeight})`,
        );
      }
      if (!Number.isInteger(t.armDelayFrames) || t.armDelayFrames < 0) {
        throw new Error(
          `DownSpecialMove '${move.id}': trap.armDelayFrames must be a non-negative integer, got ${t.armDelayFrames}`,
        );
      }
      if (
        !Number.isInteger(t.trapLifetimeFrames) ||
        t.trapLifetimeFrames <= t.armDelayFrames
      ) {
        throw new Error(
          `DownSpecialMove '${move.id}': trap.trapLifetimeFrames (${t.trapLifetimeFrames}) must be > armDelayFrames (${t.armDelayFrames})`,
        );
      }
      if (t.trapDamage < 0) {
        throw new Error(
          `DownSpecialMove '${move.id}': trap.trapDamage must be >= 0, got ${t.trapDamage}`,
        );
      }
      if (!Number.isInteger(t.maxActiveTraps) || t.maxActiveTraps < 1) {
        throw new Error(
          `DownSpecialMove '${move.id}': trap.maxActiveTraps must be a positive integer, got ${t.maxActiveTraps}`,
        );
      }
      break;
    }
    case 'stallAndFall': {
      const s = move.stallAndFall;
      if (!Number.isInteger(s.stallFrames) || s.stallFrames < 1) {
        throw new Error(
          `DownSpecialMove '${move.id}': stallAndFall.stallFrames must be a positive integer, got ${s.stallFrames}`,
        );
      }
      if (s.stallFrames >= move.activeFrames) {
        throw new Error(
          `DownSpecialMove '${move.id}': stallAndFall.stallFrames=${s.stallFrames} must be < activeFrames=${move.activeFrames} (fall phase non-empty)`,
        );
      }
      if (!Number.isFinite(s.stallVelocity)) {
        throw new Error(
          `DownSpecialMove '${move.id}': stallAndFall.stallVelocity must be finite, got ${s.stallVelocity}`,
        );
      }
      if (!Number.isFinite(s.fallVelocity) || s.fallVelocity <= 0) {
        throw new Error(
          `DownSpecialMove '${move.id}': stallAndFall.fallVelocity must be positive (downward), got ${s.fallVelocity}`,
        );
      }
      if (s.shockwaveDamage < 0) {
        throw new Error(
          `DownSpecialMove '${move.id}': stallAndFall.shockwaveDamage must be >= 0, got ${s.shockwaveDamage}`,
        );
      }
      if (s.shockwaveHitbox.width <= 0 || s.shockwaveHitbox.height <= 0) {
        throw new Error(
          `DownSpecialMove '${move.id}': stallAndFall.shockwaveHitbox dimensions must be positive (got ${s.shockwaveHitbox.width}x${s.shockwaveHitbox.height})`,
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
          `DownSpecialMove '${move.id}': counter window [${cnt.counterWindowStart}, ${cnt.counterWindowEnd}) malformed`,
        );
      }
      if (cnt.counterWindowEnd > busyTotal) {
        throw new Error(
          `DownSpecialMove '${move.id}': counter window endFrame=${cnt.counterWindowEnd} exceeds busyTotal=${busyTotal}`,
        );
      }
      if (cnt.damageMultiplier <= 0) {
        throw new Error(
          `DownSpecialMove '${move.id}': counter.damageMultiplier must be > 0, got ${cnt.damageMultiplier}`,
        );
      }
      if (cnt.minCounterDamage < 0 || cnt.maxCounterDamage < cnt.minCounterDamage) {
        throw new Error(
          `DownSpecialMove '${move.id}': counter damage clamp invalid (min=${cnt.minCounterDamage}, max=${cnt.maxCounterDamage})`,
        );
      }
      if (cnt.counterHitbox.width <= 0 || cnt.counterHitbox.height <= 0) {
        throw new Error(
          `DownSpecialMove '${move.id}': counter.counterHitbox dimensions must be positive (got ${cnt.counterHitbox.width}x${cnt.counterHitbox.height})`,
        );
      }
      break;
    }
    default: {
      // Exhaustiveness: TypeScript sees `move` narrowed to `never` here.
      const _exhaustive: never = move;
      throw new Error(
        `DownSpecialMove: unknown downSpecialKind on ${(_exhaustive as { id?: string }).id ?? '<unknown>'}`,
      );
    }
  }

  // Sanity: animation counts must each be >= 1 if present.
  const anim = move.animation;
  if (anim) {
    if (anim.startupFrames < 1 || anim.activeFrames < 1 || anim.recoveryFrames < 1) {
      throw new Error(
        `DownSpecialMove '${move.id}': animation phase counts must each be >= 1`,
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
