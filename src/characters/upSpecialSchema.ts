/**
 * Up-special move data schema — AC 60202 Sub-AC 2.
 *
 * Fifth move family in the per-character kit (after the grounded
 * triplet jab / tilt / smash, the aerial triplet nair / fair / bair,
 * and the neutral special). Each of the four roster slots ships
 * exactly ONE up special, and each one uses a *different* mechanic so
 * the four characters feel meaningfully different on the up-special
 * button press AND solve the "I just got knocked off the stage, get me
 * back" recovery problem in their own way.
 *
 * The Seed mandates four distinct recovery mechanics for the four
 * roster slots. We pick one canonical Smash-Bros up-B archetype per
 * character, mapped to the character's existing role:
 *
 *   • Wolf  (bruiser) → multiHitRising — a vertical multi-hit attack
 *                                         that lifts the fighter as it
 *                                         deals a damage ladder. The
 *                                         "tornado / blade dance"
 *                                         recovery (Marth's Dolphin
 *                                         Slash, Ike's Aether). Strong
 *                                         vertical recovery + offensive
 *                                         option in one move.
 *
 *   • Cat   (ninja)   → teleport       — Cat vanishes for a brief
 *                                         invincibility window then
 *                                         reappears at a fixed offset
 *                                         from the press position. Pure
 *                                         mobility recovery (no damage
 *                                         on the teleport itself), but
 *                                         the invincible vanish is the
 *                                         hardest-to-edge-guard recovery
 *                                         in the cast. Mirrors
 *                                         Mewtwo's Teleport / Sheik's
 *                                         Vanish.
 *
 *   • Owl   (mage)    → directionalJump — Owl picks an angle from the
 *                                         stick at press time and
 *                                         bursts in that direction at
 *                                         a fixed velocity for a fixed
 *                                         duration. A hitbox sticks to
 *                                         his body during the burst
 *                                         dealing one solid hit on
 *                                         contact. Mirrors Pikachu's
 *                                         Quick Attack / Fox's Fire
 *                                         Fox: long horizontal AND
 *                                         vertical recovery with an
 *                                         attack option built in.
 *
 *   • Bear  (grappler)→ tether         — Bear extends a hookshot/grapple
 *                                         line in his facing direction.
 *                                         If the line touches a ledge
 *                                         (or a fighter) during its
 *                                         active window the line locks
 *                                         on and Bear is reeled toward
 *                                         the contact point. Mirrors
 *                                         Olimar's Up-B / Link's
 *                                         hookshot / Samus's grapple
 *                                         beam: unique recovery vector
 *                                         that requires the line to
 *                                         catch *something* — pure
 *                                         airdodge against an empty sky
 *                                         leaves Bear stuck mid-air,
 *                                         the grappler trade-off.
 *
 * This module is the data contract those records share. Like
 * `aerialSchema.ts` and `specialSchema.ts` it sits OUTSIDE the base
 * `attacks.ts` / `moveSchema.ts` so the four shared kinds can declare
 * kind-specific fields without polluting the grounded / aerial /
 * neutral-special schemas. Every `UpSpecialMove` is also a structural
 * `AttackMoveWithAnimation`, so:
 *
 *   • The runtime attack state machine (startup → active → recovery →
 *     done) drives them through `Character.tickAttack` unchanged. The
 *     four kinds layer additional behaviour on top of the canonical
 *     hitbox-spawn-during-active mechanic without re-implementing it.
 *
 *   • The animation state machine
 *     (`computeAttackPhase` / `selectAnimationFrame`) keeps working —
 *     each up-special declares the same `animation` block other moves
 *     do.
 *
 *   • The roster tooling (`CHARACTER_ROSTER`, `findMoveByType`) sees
 *     up-specials as plain `AttackMove`s with `type: 'upSpecial'`, so a
 *     consumer that asks "does Wolf have an up-special?" via
 *     `findMoveByType(spec, 'upSpecial')` gets the right record.
 *
 * The four kinds are a *discriminated union* on `upSpecialKind` so a
 * caller iterating a moveset can narrow type-safely:
 *
 *     for (const m of spec.moves) {
 *       if (m.type !== 'upSpecial') continue;
 *       const up = m as UpSpecialMove;
 *       switch (up.upSpecialKind) {
 *         case 'multiHitRising':  handleMultiHitRise(up); break;
 *         case 'teleport':        handleTeleport(up);     break;
 *         case 'directionalJump': handleDirectional(up);  break;
 *         case 'tether':          handleTether(up);       break;
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
 * working unchanged. The new `UpSpecialMove` records are APPENDED to
 * each character's moveset and registered through the existing
 * `Character.registerAttack` pipeline (with a small extension that
 * auto-fills an `upSpecialId` slot when an `'upSpecial'`-typed move is
 * registered — mirroring the `neutralSpecialId` wiring from
 * `specialSchema.ts`).
 */

import type { AttackMove } from './attacks';
import type {
  AttackMoveWithAnimation,
  KnockbackSpec,
} from './moveSchema';
import { computeAttackPhase, getMoveBusyFrames } from './moveSchema';

// ---------------------------------------------------------------------------
// Up-special-kind discriminator
// ---------------------------------------------------------------------------

/**
 * Which mechanic the up-special implements. Each character ships
 * exactly one of these, and the four are deliberately distinct so the
 * "press up-special to recover" button feels different on every
 * character AND offers four genuinely different gameplay textures.
 *
 *   - `'multiHitRising'` : a vertical-rising attack that hits the
 *                          opponent multiple times during the ascent.
 *                          The fighter gains a fixed upward velocity on
 *                          the press frame; a `hitCount` ladder of
 *                          smaller hits fires during the active phase
 *                          (each hit `hitInterval` frames apart) before
 *                          a final launching hit on the last active
 *                          frame. Recovery doubles as offence.
 *
 *   - `'teleport'`       : a *vanish-and-reappear* mechanic. The
 *                          fighter becomes invincible for the duration
 *                          of the active phase (during which the body
 *                          is "off-stage" — the runtime hides the
 *                          rectangle and disables collisions). On the
 *                          reappear frame the fighter teleports to a
 *                          fixed offset from the press position
 *                          (direction read from the input stick at
 *                          press time, rotated through 8 cardinal
 *                          directions). No hitbox, no damage — pure
 *                          mobility / safety recovery.
 *
 *   - `'directionalJump'`: a *fixed-distance angled burst* mechanic. On
 *                          the press frame the fighter latches the
 *                          input stick angle (snapped to one of 8
 *                          cardinal / diagonal directions) and bursts
 *                          along that vector at `burstSpeed` for
 *                          `burstFrames` consecutive frames. A single
 *                          body-centred hitbox is live for the duration
 *                          of the burst, dealing one solid hit on
 *                          contact (the burst body acts as the hitbox).
 *
 *   - `'tether'`         : a *line-extends, line-retracts* mechanic.
 *                          The fighter extends a tether line in the
 *                          facing direction at `extensionSpeed` for
 *                          `extensionFrames`, reaching `maxRange` away
 *                          from the body at full extension. On contact
 *                          with a tetherable target (a stage ledge or
 *                          another fighter — runtime concern) the line
 *                          latches and the fighter is reeled toward the
 *                          contact point at `reelSpeed`. A whiffed
 *                          tether retracts harmlessly. The line itself
 *                          carries a small contact-damage value
 *                          (`tetherTipDamage`) for the rare cases where
 *                          it *catches* a fighter rather than a ledge.
 */
export type UpSpecialKind =
  | 'multiHitRising'
  | 'teleport'
  | 'directionalJump'
  | 'tether';

// ---------------------------------------------------------------------------
// Per-kind detail records
// ---------------------------------------------------------------------------

/**
 * Configuration for the multi-hit-rising sub-kind.
 *
 * The fighter gains an instantaneous upward velocity on the press frame
 * (`riseImpulse`, in Matter px-per-step units — sign-convention is
 * NEGATIVE for upward, matching the Phaser screen-space convention used
 * everywhere else in the engine). A horizontal velocity component
 * (`driftImpulse`) lets a fighter drift in the facing direction during
 * the rise; set to 0 for a pure vertical rise.
 *
 * During the active phase the move spawns a damage hit every
 * `hitInterval` frames. The first `hitCount - 1` are "link" hits —
 * small damage / small knockback designed to keep the opponent locked
 * in place above the rising fighter. The final hit (last active frame)
 * is the launcher — heavy knockback that sends the target up and away.
 *
 * Hitbox geometry is the move's own `hitbox` field — typically a tall
 * vertical sensor that covers the rising arc.
 *
 * Determinism: integer frame counters + frozen geometry. The runtime
 * advances the rise velocity on the press frame; identical press
 * frames always produce identical trajectories.
 */
export interface UpSpecialMultiHitRisingSpec {
  /**
   * Upward velocity impulse applied on the press frame, in Matter
   * px-per-step units. NEGATIVE means upward (Phaser screen-space).
   * Typical values: -16 to -22 (taller than a regular jump impulse so
   * the recovery actually saves the stock).
   */
  readonly riseImpulse: number;
  /**
   * Horizontal drift velocity applied alongside `riseImpulse`. Authored
   * facing-right (positive); the runtime mirrors by `facing` on press.
   * 0 = pure vertical rise; non-zero = the fighter drifts in the facing
   * direction during the ascent.
   */
  readonly driftImpulse: number;
  /**
   * Total number of damage hits the move emits during its active
   * phase. Includes both the link hits AND the final launcher.
   * Must be >= 1; for hitCount=1 the move is effectively a single-hit
   * rising attack with no link ladder.
   */
  readonly hitCount: number;
  /**
   * Frames between consecutive hits in the ladder. The first hit fires
   * on the first active frame; subsequent hits fire every
   * `hitInterval` frames. Must be a positive integer.
   * `(hitCount - 1) * hitInterval` must be < `activeFrames` so the
   * final hit fires inside the active window.
   */
  readonly hitInterval: number;
  /**
   * Damage per link hit (every hit EXCEPT the final launcher).
   */
  readonly linkDamage: number;
  /**
   * Knockback per link hit. Designed to keep the target locked in
   * place — typically very low x, modest negative y to keep them above
   * the rising fighter, low scaling so high-percent targets aren't
   * launched out of the combo.
   */
  readonly linkKnockback: KnockbackSpec;
  /**
   * Damage of the final launching hit (the last hit in the ladder).
   */
  readonly launcherDamage: number;
  /**
   * Knockback of the final launching hit. The KO trajectory — high
   * scaling so the move actually ends stocks at high percent.
   */
  readonly launcherKnockback: KnockbackSpec;
}

/**
 * Configuration for the teleport sub-kind.
 *
 * The teleport mechanic is a *vanish + reappear* sequence:
 *
 *   • On the press frame the fighter latches the input stick direction
 *     (snapped to one of 8 cardinals / diagonals), transitions into the
 *     "vanish" state for the active phase, and becomes invincible.
 *     During the vanish the runtime hides the body and skips collision
 *     resolution.
 *
 *   • On the reappear frame (last active frame) the fighter teleports
 *     to `(pressX + dirX * teleportDistance, pressY + dirY *
 *     teleportDistance)` and re-enters normal play.
 *
 * The active phase IS the invincibility window. There is NO hitbox and
 * NO damage on the teleport — this is a pure mobility move that trades
 * its "no-attack" cost for the invulnerable vanish being the hardest-
 * to-edge-guard recovery in the cast.
 *
 * Determinism: integer frame counter for the vanish window + frozen
 * teleport distance. The 8-direction snap is a pure function of the
 * stick coordinates at the press frame; identical inputs always
 * produce identical destinations.
 */
export interface UpSpecialTeleportSpec {
  /**
   * Distance teleported on reappear, in design pixels. Applied along
   * the snapped 8-direction unit vector latched at press time.
   * Typical values: 220-320 (longer than a jump arc so the recovery
   * meaningfully covers ground).
   */
  readonly teleportDistance: number;
  /**
   * Frames of invincibility starting on the press frame. Must be
   * <= the move's `activeFrames` — the invincibility window is the
   * vanish window, and they must align so the fighter doesn't reappear
   * vulnerable mid-active.
   */
  readonly invincibilityFrames: number;
  /**
   * If `true`, the runtime snaps the stick angle into the 8 cardinal
   * + diagonal directions (N, NE, E, SE, S, SW, W, NW). If `false`,
   * the runtime uses the raw stick angle (analog teleport). Default
   * `true` for the canonical Smash up-B feel; `false` is reserved for
   * gamepad-only fighters that want analog precision.
   */
  readonly snapToOctant: boolean;
}

/**
 * Configuration for the directionalJump sub-kind.
 *
 * The mechanic is a *fixed-distance angled burst*:
 *
 *   • On the press frame the fighter latches the stick direction
 *     (snapped to 8 cardinals / diagonals).
 *
 *   • For `burstFrames` consecutive frames starting at the active phase
 *     start, the fighter's velocity is set to `(dirX * burstSpeed,
 *     dirY * burstSpeed)` overriding gravity / friction. The fighter
 *     traces a straight-line burst in the chosen direction.
 *
 *   • The body acts as a hitbox during the burst: the move's `hitbox`
 *     field is centred on the body each frame and deals one solid hit
 *     on contact (subsequent contacts are suppressed by the standard
 *     hitbox-already-hit logic).
 *
 *   • On burst-end the fighter enters a "helpless" state until they
 *     touch ground (recovery phase + standard helpless-after-up-B rule;
 *     enforced by the runtime).
 *
 * Determinism: integer frame counter for the burst window + frozen
 * speed. The 8-direction snap is pure; identical sticks at press time
 * always produce identical burst trajectories.
 */
export interface UpSpecialDirectionalJumpSpec {
  /**
   * Burst speed along the chosen direction, in Matter px-per-step
   * units. The fighter's velocity is set to this magnitude × the
   * unit-vector direction each frame of the burst.
   */
  readonly burstSpeed: number;
  /**
   * Frames the burst lasts. Must be <= `activeFrames` so the burst
   * ends inside the active window (the runtime restores normal physics
   * on the burst-end frame).
   */
  readonly burstFrames: number;
  /**
   * If `true`, the stick angle snaps to the 8 cardinal / diagonal
   * directions. If `false`, the burst follows the raw stick angle.
   * Default `true` — same rationale as `UpSpecialTeleportSpec`.
   */
  readonly snapToOctant: boolean;
  /**
   * If `true`, the move enters a helpless / no-input state after the
   * burst until the fighter touches ground. Canonical for fixed-
   * distance recovery moves so they can't be repeated mid-air.
   * Default `true`.
   */
  readonly helplessAfterBurst: boolean;
}

/**
 * Configuration for the tether sub-kind.
 *
 * The tether mechanic is a *line-extends, line-retracts*:
 *
 *   • On the press frame the fighter starts extending a line from his
 *     body centre. The line extends by `extensionSpeed` px each frame
 *     for `extensionFrames` frames, reaching a max length of
 *     `extensionSpeed * extensionFrames` (which must equal `maxRange`
 *     — validated by the schema).
 *
 *   • During extension the line is collidable. On contact with a
 *     tetherable target (a stage ledge body or another fighter — the
 *     runtime decides) the line latches at the contact point.
 *
 *   • On a successful latch the fighter is reeled toward the contact
 *     point at `reelSpeed` px-per-step until the body reaches the
 *     contact point or `reelFrames` elapses.
 *
 *   • On a whiffed extension (no contact) the line retracts harmlessly
 *     during the recovery phase and the fighter falls back into normal
 *     physics. Canonically a whiffed tether off-stage is a stock loss —
 *     the price of the "long reach" recovery.
 *
 *   • The tether *tip* carries a small `tetherTipDamage` value for the
 *     rare case where the line catches an opponent fighter mid-air
 *     rather than a ledge.
 *
 * Determinism: integer frame counters for extension / reel windows +
 * frozen speeds. The contact frame is a pure consequence of physics
 * positions; identical positions always produce identical latch
 * frames.
 */
export interface UpSpecialTetherSpec {
  /**
   * Maximum tether reach, in design pixels — the distance from the
   * fighter's body centre at which the line is fully extended.
   * Must equal `extensionSpeed * extensionFrames` (validated).
   */
  readonly maxRange: number;
  /**
   * Per-frame extension speed in design pixels. The line grows by this
   * many pixels each frame during the extension window.
   */
  readonly extensionSpeed: number;
  /**
   * Frames the extension takes to reach `maxRange`. Must equal
   * `maxRange / extensionSpeed`. Must be <= `activeFrames` so the
   * extension completes inside the active window (recovery handles the
   * retract / reel).
   */
  readonly extensionFrames: number;
  /**
   * Per-frame reel speed in design pixels. After a successful latch the
   * fighter is moved toward the contact point at this speed each
   * frame.
   */
  readonly reelSpeed: number;
  /**
   * Maximum frames the reel can take. Cap protects against a degenerate
   * latch into a moving target where the body never quite reaches the
   * contact point. After `reelFrames` the runtime drops the latch.
   */
  readonly reelFrames: number;
  /**
   * Damage dealt if the tether tip catches an opponent fighter mid-
   * extension (rather than a ledge). Small — the move is a recovery
   * tool, not a damage tool.
   */
  readonly tetherTipDamage: number;
  /**
   * Knockback applied to a fighter caught by the tether tip. Designed
   * to push the target into the same trajectory the fighter is being
   * pulled toward — typically forward + slightly up.
   */
  readonly tetherTipKnockback: KnockbackSpec;
  /**
   * Tether line width in design pixels — the collidable body's
   * thickness during extension. Used by the runtime to spawn the
   * extension sensor body.
   */
  readonly lineWidth: number;
}

// ---------------------------------------------------------------------------
// UpSpecialMove discriminated union
// ---------------------------------------------------------------------------

/**
 * Common fields every up-special record carries — extends the base
 * `AttackMoveWithAnimation` contract and pins `type: 'upSpecial'`.
 */
interface UpSpecialMoveBase extends AttackMoveWithAnimation {
  readonly type: 'upSpecial';
  readonly upSpecialKind: UpSpecialKind;
}

/** Multi-hit rising attack up-special. */
export interface MultiHitRisingUpSpecialMove extends UpSpecialMoveBase {
  readonly upSpecialKind: 'multiHitRising';
  readonly multiHitRising: UpSpecialMultiHitRisingSpec;
}

/** Teleport up-special. */
export interface TeleportUpSpecialMove extends UpSpecialMoveBase {
  readonly upSpecialKind: 'teleport';
  readonly teleport: UpSpecialTeleportSpec;
}

/** Directional-jump up-special. */
export interface DirectionalJumpUpSpecialMove extends UpSpecialMoveBase {
  readonly upSpecialKind: 'directionalJump';
  readonly directionalJump: UpSpecialDirectionalJumpSpec;
}

/** Tether up-special. */
export interface TetherUpSpecialMove extends UpSpecialMoveBase {
  readonly upSpecialKind: 'tether';
  readonly tether: UpSpecialTetherSpec;
}

/**
 * Discriminated union of every up-special record. Use
 * `UpSpecialMove['upSpecialKind']` to switch on the variant; the
 * compiler narrows to the matching detail record automatically.
 */
export type UpSpecialMove =
  | MultiHitRisingUpSpecialMove
  | TeleportUpSpecialMove
  | DirectionalJumpUpSpecialMove
  | TetherUpSpecialMove;

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

/** True iff `move` is typed `'upSpecial'` AND carries an `upSpecialKind` tag. */
export function isUpSpecialMove(move: AttackMove): move is UpSpecialMove {
  if (move.type !== 'upSpecial') return false;
  const kind = (move as Partial<UpSpecialMoveBase>).upSpecialKind;
  return (
    kind === 'multiHitRising' ||
    kind === 'teleport' ||
    kind === 'directionalJump' ||
    kind === 'tether'
  );
}

/** True iff `move` is a multi-hit-rising-kind up-special. */
export function isMultiHitRisingUpSpecial(
  move: AttackMove,
): move is MultiHitRisingUpSpecialMove {
  return isUpSpecialMove(move) && move.upSpecialKind === 'multiHitRising';
}

/** True iff `move` is a teleport-kind up-special. */
export function isTeleportUpSpecial(
  move: AttackMove,
): move is TeleportUpSpecialMove {
  return isUpSpecialMove(move) && move.upSpecialKind === 'teleport';
}

/** True iff `move` is a directional-jump-kind up-special. */
export function isDirectionalJumpUpSpecial(
  move: AttackMove,
): move is DirectionalJumpUpSpecialMove {
  return isUpSpecialMove(move) && move.upSpecialKind === 'directionalJump';
}

/** True iff `move` is a tether-kind up-special. */
export function isTetherUpSpecial(
  move: AttackMove,
): move is TetherUpSpecialMove {
  return isUpSpecialMove(move) && move.upSpecialKind === 'tether';
}

// ---------------------------------------------------------------------------
// Pure helpers: 8-direction snap (shared by teleport + directionalJump)
// ---------------------------------------------------------------------------

/**
 * Unit vector for one of the 8 cardinal / diagonal directions. The Y
 * axis follows the Phaser screen-space convention (positive Y =
 * downward).
 */
export interface OctantDirection {
  readonly x: number;
  readonly y: number;
}

/**
 * Snap an analog stick `(stickX, stickY)` to the closest of the 8
 * cardinal / diagonal directions. Returns the unit vector.
 *
 *   • A neutral stick (`(0, 0)`) defaults to "up" `(0, -1)` — up-B
 *     pressed with no stick input is the canonical "straight up
 *     recovery" behaviour.
 *   • The Y axis follows Phaser screen-space (positive = down), so
 *     "up" = `(0, -1)`.
 *
 * Pure function of the stick coordinates; identical inputs always
 * return identical unit vectors. The 8 outputs are:
 *
 *     E  = ( 1,  0)        N  = ( 0, -1)        W  = (-1,  0)
 *     NE = ( √½, -√½)      S  = ( 0,  1)        NW = (-√½, -√½)
 *     SE = ( √½,  √½)                            SW = (-√½,  √½)
 */
export function snapStickToOctant(
  stickX: number,
  stickY: number,
): OctantDirection {
  // Neutral stick → "up" (default recovery direction).
  if (stickX === 0 && stickY === 0) return { x: 0, y: -1 };
  const angle = Math.atan2(stickY, stickX);
  // Snap to nearest π/4 (45°).
  const snapped = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
  // Clean unit-circle values: cos/sin of snapped multiples of π/4 are
  // either 0, ±1, or ±√½ — round small floating-point noise so equality
  // tests in the suite are exact.
  const x = Math.cos(snapped);
  const y = Math.sin(snapped);
  const clean = (n: number): number => {
    if (Math.abs(n) < 1e-10) return 0;
    if (Math.abs(n - 1) < 1e-10) return 1;
    if (Math.abs(n + 1) < 1e-10) return -1;
    return n;
  };
  return { x: clean(x), y: clean(y) };
}

// ---------------------------------------------------------------------------
// Multi-hit-rising helpers (pure)
// ---------------------------------------------------------------------------

/**
 * Compute the frame indices (relative to the active phase start) at
 * which each hit in the ladder fires. Returns an array of length
 * `hitCount`, with the first entry at frame 0 (active-phase start)
 * and subsequent entries at `hitInterval` increments.
 *
 * Pure — same `(spec)` always returns the same array.
 */
export function computeMultiHitFrames(
  spec: UpSpecialMultiHitRisingSpec,
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
export function isMultiHitFrame(
  spec: UpSpecialMultiHitRisingSpec,
  framesIntoActive: number,
): boolean {
  if (framesIntoActive < 0) return false;
  if (framesIntoActive % spec.hitInterval !== 0) return false;
  const hitIndex = framesIntoActive / spec.hitInterval;
  return hitIndex < spec.hitCount;
}

/**
 * True iff the given `framesIntoActive` is the FINAL launcher hit
 * (the last entry in the ladder). Used by the runtime to swap the
 * link-hit damage / knockback for the launcher values.
 */
export function isFinalLauncherFrame(
  spec: UpSpecialMultiHitRisingSpec,
  framesIntoActive: number,
): boolean {
  if (!isMultiHitFrame(spec, framesIntoActive)) return false;
  const hitIndex = framesIntoActive / spec.hitInterval;
  return hitIndex === spec.hitCount - 1;
}

// ---------------------------------------------------------------------------
// Teleport helpers (pure)
// ---------------------------------------------------------------------------

/**
 * Compute the destination position for a teleport: the press position
 * `(pressX, pressY)` plus the snapped (or raw) direction × the move's
 * `teleportDistance`.
 *
 * Pure — same `(spec, pressX, pressY, dir)` always returns the same
 * destination.
 */
export function computeTeleportDestination(
  spec: UpSpecialTeleportSpec,
  pressX: number,
  pressY: number,
  dir: OctantDirection,
): { x: number; y: number } {
  return {
    x: pressX + dir.x * spec.teleportDistance,
    y: pressY + dir.y * spec.teleportDistance,
  };
}

/**
 * Pure predicate: is `framesElapsed` inside the teleport's
 * invincibility window? The window starts on the press frame
 * (frame 0) and runs for `invincibilityFrames` frames inclusive.
 */
export function isInTeleportInvincibilityWindow(
  move: TeleportUpSpecialMove,
  framesElapsed: number,
): boolean {
  return framesElapsed >= 0 && framesElapsed < move.teleport.invincibilityFrames;
}

// ---------------------------------------------------------------------------
// Directional-jump helpers (pure)
// ---------------------------------------------------------------------------

/**
 * Compute the burst velocity vector for a directional-jump up-special:
 * the snapped (or raw) direction × `burstSpeed`.
 *
 * Pure — same `(spec, dir)` always returns the same velocity.
 */
export function computeBurstVelocity(
  spec: UpSpecialDirectionalJumpSpec,
  dir: OctantDirection,
): { x: number; y: number } {
  return {
    x: dir.x * spec.burstSpeed,
    y: dir.y * spec.burstSpeed,
  };
}

/**
 * Pure predicate: is `framesIntoActive` inside the burst window? The
 * burst starts at active-phase frame 0 and runs for `burstFrames`
 * frames inclusive.
 */
export function isInBurstWindow(
  move: DirectionalJumpUpSpecialMove,
  framesIntoActive: number,
): boolean {
  return (
    framesIntoActive >= 0 &&
    framesIntoActive < move.directionalJump.burstFrames
  );
}

// ---------------------------------------------------------------------------
// Tether helpers (pure)
// ---------------------------------------------------------------------------

/**
 * Compute the tether tip position at `framesIntoExtension` (0 on the
 * extension start frame). Returns the absolute world-space position
 * of the tip given the fighter's body centre at press time and the
 * facing direction.
 *
 * Pure — identical inputs always produce identical positions.
 */
export function computeTetherTipPosition(
  spec: UpSpecialTetherSpec,
  bodyX: number,
  bodyY: number,
  facing: 1 | -1,
  framesIntoExtension: number,
): { x: number; y: number } {
  const clamped = Math.max(0, Math.min(framesIntoExtension, spec.extensionFrames));
  const extension = clamped * spec.extensionSpeed;
  return {
    x: bodyX + extension * facing,
    y: bodyY,
  };
}

/**
 * True iff the tether is fully extended (reached `maxRange`) at the
 * given `framesIntoExtension`. The runtime uses this to flip the line
 * from "extending" to "retracting" if no contact was made.
 */
export function isTetherFullyExtended(
  spec: UpSpecialTetherSpec,
  framesIntoExtension: number,
): boolean {
  return framesIntoExtension >= spec.extensionFrames;
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

/**
 * Validate an up-special move record satisfies the schema's
 * invariants:
 *
 *   1. `type === 'upSpecial'` and `upSpecialKind` is one of the four
 *      kinds.
 *   2. Per-kind detail record is present and well-formed:
 *        - multiHitRising: `riseImpulse` < 0 (upward), `hitCount >= 1`,
 *                          `hitInterval > 0`, the final hit fires
 *                          inside `activeFrames`,
 *                          `linkDamage`/`launcherDamage` non-negative.
 *        - teleport: `teleportDistance > 0`,
 *                    `invincibilityFrames` non-negative integer
 *                    `<= activeFrames`.
 *        - directionalJump: `burstSpeed > 0`,
 *                           `burstFrames` positive integer
 *                           `<= activeFrames`.
 *        - tether: `maxRange > 0`, `extensionSpeed > 0`,
 *                  `extensionFrames > 0`,
 *                  `extensionFrames * extensionSpeed === maxRange`,
 *                  `extensionFrames <= activeFrames`,
 *                  `reelSpeed > 0`, `reelFrames > 0`,
 *                  `tetherTipDamage >= 0`, `lineWidth > 0`.
 *
 * Returns the move unchanged on success; throws on the first invariant
 * violation. Tests call this on every per-character up-special record
 * so a future tuning pass can't accidentally publish a broken record.
 */
export function validateUpSpecialMove(move: UpSpecialMove): UpSpecialMove {
  if (move.type !== 'upSpecial') {
    throw new Error(
      `UpSpecialMove '${move.id}': type must be 'upSpecial', got '${move.type}'`,
    );
  }
  const busyTotal = getMoveBusyFrames(move);

  switch (move.upSpecialKind) {
    case 'multiHitRising': {
      const r = move.multiHitRising;
      if (!Number.isFinite(r.riseImpulse) || r.riseImpulse >= 0) {
        throw new Error(
          `UpSpecialMove '${move.id}': multiHitRising.riseImpulse must be negative (upward), got ${r.riseImpulse}`,
        );
      }
      if (!Number.isFinite(r.driftImpulse)) {
        throw new Error(
          `UpSpecialMove '${move.id}': multiHitRising.driftImpulse must be finite, got ${r.driftImpulse}`,
        );
      }
      if (!Number.isInteger(r.hitCount) || r.hitCount < 1) {
        throw new Error(
          `UpSpecialMove '${move.id}': multiHitRising.hitCount must be a positive integer, got ${r.hitCount}`,
        );
      }
      if (!Number.isInteger(r.hitInterval) || r.hitInterval < 1) {
        throw new Error(
          `UpSpecialMove '${move.id}': multiHitRising.hitInterval must be a positive integer, got ${r.hitInterval}`,
        );
      }
      // Final hit must fire inside activeFrames so the launcher actually
      // happens during the active window.
      const finalHitOffset = (r.hitCount - 1) * r.hitInterval;
      if (finalHitOffset >= move.activeFrames) {
        throw new Error(
          `UpSpecialMove '${move.id}': multiHitRising final hit at active-frame ${finalHitOffset} exceeds activeFrames=${move.activeFrames}`,
        );
      }
      if (r.linkDamage < 0 || r.launcherDamage < 0) {
        throw new Error(
          `UpSpecialMove '${move.id}': multiHitRising damage values must be non-negative (link=${r.linkDamage}, launcher=${r.launcherDamage})`,
        );
      }
      break;
    }
    case 'teleport': {
      const t = move.teleport;
      if (!Number.isFinite(t.teleportDistance) || t.teleportDistance <= 0) {
        throw new Error(
          `UpSpecialMove '${move.id}': teleport.teleportDistance must be > 0, got ${t.teleportDistance}`,
        );
      }
      if (
        !Number.isInteger(t.invincibilityFrames) ||
        t.invincibilityFrames < 0
      ) {
        throw new Error(
          `UpSpecialMove '${move.id}': teleport.invincibilityFrames must be non-negative integer, got ${t.invincibilityFrames}`,
        );
      }
      if (t.invincibilityFrames > move.activeFrames) {
        throw new Error(
          `UpSpecialMove '${move.id}': teleport.invincibilityFrames=${t.invincibilityFrames} exceeds activeFrames=${move.activeFrames}`,
        );
      }
      break;
    }
    case 'directionalJump': {
      const d = move.directionalJump;
      if (!Number.isFinite(d.burstSpeed) || d.burstSpeed <= 0) {
        throw new Error(
          `UpSpecialMove '${move.id}': directionalJump.burstSpeed must be > 0, got ${d.burstSpeed}`,
        );
      }
      if (!Number.isInteger(d.burstFrames) || d.burstFrames < 1) {
        throw new Error(
          `UpSpecialMove '${move.id}': directionalJump.burstFrames must be a positive integer, got ${d.burstFrames}`,
        );
      }
      if (d.burstFrames > move.activeFrames) {
        throw new Error(
          `UpSpecialMove '${move.id}': directionalJump.burstFrames=${d.burstFrames} exceeds activeFrames=${move.activeFrames}`,
        );
      }
      break;
    }
    case 'tether': {
      const t = move.tether;
      if (!Number.isFinite(t.maxRange) || t.maxRange <= 0) {
        throw new Error(
          `UpSpecialMove '${move.id}': tether.maxRange must be > 0, got ${t.maxRange}`,
        );
      }
      if (!Number.isFinite(t.extensionSpeed) || t.extensionSpeed <= 0) {
        throw new Error(
          `UpSpecialMove '${move.id}': tether.extensionSpeed must be > 0, got ${t.extensionSpeed}`,
        );
      }
      if (!Number.isInteger(t.extensionFrames) || t.extensionFrames < 1) {
        throw new Error(
          `UpSpecialMove '${move.id}': tether.extensionFrames must be a positive integer, got ${t.extensionFrames}`,
        );
      }
      // maxRange must equal extensionSpeed * extensionFrames so the
      // tip-position math stays consistent across the runtime.
      const computedRange = t.extensionSpeed * t.extensionFrames;
      if (Math.abs(computedRange - t.maxRange) > 1e-9) {
        throw new Error(
          `UpSpecialMove '${move.id}': tether.maxRange=${t.maxRange} must equal extensionSpeed*extensionFrames=${computedRange}`,
        );
      }
      if (t.extensionFrames > move.activeFrames) {
        throw new Error(
          `UpSpecialMove '${move.id}': tether.extensionFrames=${t.extensionFrames} exceeds activeFrames=${move.activeFrames}`,
        );
      }
      if (!Number.isFinite(t.reelSpeed) || t.reelSpeed <= 0) {
        throw new Error(
          `UpSpecialMove '${move.id}': tether.reelSpeed must be > 0, got ${t.reelSpeed}`,
        );
      }
      if (!Number.isInteger(t.reelFrames) || t.reelFrames < 1) {
        throw new Error(
          `UpSpecialMove '${move.id}': tether.reelFrames must be a positive integer, got ${t.reelFrames}`,
        );
      }
      if (t.tetherTipDamage < 0) {
        throw new Error(
          `UpSpecialMove '${move.id}': tether.tetherTipDamage must be non-negative, got ${t.tetherTipDamage}`,
        );
      }
      if (!Number.isFinite(t.lineWidth) || t.lineWidth <= 0) {
        throw new Error(
          `UpSpecialMove '${move.id}': tether.lineWidth must be > 0, got ${t.lineWidth}`,
        );
      }
      break;
    }
    default: {
      // Exhaustiveness: TypeScript sees `move` narrowed to `never` here.
      const _exhaustive: never = move;
      throw new Error(
        `UpSpecialMove: unknown upSpecialKind on ${(_exhaustive as { id?: string }).id ?? '<unknown>'}`,
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
        `UpSpecialMove '${move.id}': animation phase counts must each be >= 1`,
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
