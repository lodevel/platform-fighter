/**
 * Throw spec schema — post-M2 grab/throw subsystem.
 *
 * A throw is the launch released from a successful grab → hold
 * sequence. Unlike a regular attack, a throw has NO startup hitbox —
 * the target is already locked in the grabber's grip. The throw
 * record carries:
 *
 *   • damage      — % added to the target on release
 *   • knockback   — base launch vector (mirrored by attacker facing
 *                   for forward / back; rotated for up / down). Same
 *                   shape as `KnockbackSpec` so the existing
 *                   `combat.ts:computeKnockback` pipeline applies
 *                   percent / mass scaling identically.
 *   • animationFrames — the throw animation length; release fires on
 *                       the last frame so the visual reads as
 *                       "wind-up → launch."
 *
 * Determinism: every field is a frozen finite number. Identical
 * specs always produce identical launches under
 * `combat.ts:computeKnockback`.
 */

import type { KnockbackSpec } from './moveSchema';

/**
 * The four throw directions a grabber can release into. Smash-canonical
 * fwd/back/up/down — each character authors a separate `ThrowSpec`
 * for each.
 */
export type ThrowDirection = 'forward' | 'back' | 'up' | 'down';

/** Frozen, ordered list of throw directions for iteration. */
export const THROW_DIRECTIONS: ReadonlyArray<ThrowDirection> = Object.freeze([
  'forward',
  'back',
  'up',
  'down',
]);

/**
 * Per-direction throw record. Thin compared to a full `AttackMove`
 * because a throw bypasses the startup → active → recovery hitbox
 * state machine entirely (the "hit" was the grab connect).
 */
export interface ThrowSpec {
  /** Native absolute angle can already encode rearward launch. The default
   * retains historical direction-based facing for existing fighter data. */
  readonly launchFacing?: 'actor' | 'opposite';
  readonly reverseFacingAtRelease?:boolean;
  readonly releaseVelocity?: {readonly x:number;readonly y:number;readonly situation?:'ground'|'air'};
  /** Source-guided authored horizontal body trajectory, in design pixels and
   * latched entry-facing basis. One normalized sample for each existing action
   * age, including recovery; sample0 must be0. Consecutive deltas become Matter
   * velocity so solids may block motion. Omitted preserves legacy movement.
   * This adapter does not establish native motion-energy/status playback parity. */
  readonly rootMotionX?: readonly number[];
  /** Release hit-stop factor. Omitted preserves the shared legacy default;
   * explicit zero is a sourced no-freeze release, independently of prehits. */
  readonly hitlagMultiplier?: number;
  readonly electricCollision?: boolean;
  /** True invincible contact on elapsed [0,n), including a sourced release
   * frame when n = animationFrames + 1. Unlike legacy intangible suppression,
   * only the incoming attacker freezes. Optional to preserve older fighters. */
  readonly invincibilityFrames?: number;
  /** Knockback-based armor while the throw runs up to release: incoming hits whose
   * reference knockback is at most this many units are resisted (damage only). */
  readonly knockbackArmor?: number;
  /** Catch-only damage before release. Each event hits the captured target once,
   * keeps the grab intact and does not launch. This does not model collateral
   * throw hitboxes. Frames use the throw's zero-based elapsed gameplay clock. */
  readonly heldTargetHits?: readonly ThrowHeldTargetHit[];
  readonly recoveryFrames?: number;
  /** % added to the target on the release frame. */
  readonly damage: number;
  /**
   * Base knockback vector at 0% target percent. The runtime applies
   * the existing percent + mass scaling (`combat.ts:computeKnockback`)
   * identically to a regular hit, so a back-throw at 100% lands as
   * hard as a back-air at 100%.
   *
   * Convention matches `AttackMove.knockback`:
   *   - `x` is mirrored by attacker facing for `forward` and `back`.
   *   - `y` is taken as-is (negative = upward in Phaser screen-space).
   */
  readonly knockback: KnockbackSpec;
  /**
   * Frames the throw animation runs before release. Smash-canonical
   * is ~20–30f for forward/back, ~12–18f for up/down. The release
   * (damage + knockback application + grabber → cooldown transition)
   * fires on frame `animationFrames`.
   */
  readonly animationFrames: number;
}

export interface ThrowHeldTargetHit {
  readonly electricCollision?: boolean;
  /** Elapsed throw frame; source game frame n converts to n - 1. */
  readonly frame: number;
  readonly damage: number;
  /** Damage used only by the hit-stop formula. Allows a source stop-only
   * event with damage0 without adding fictitious percent or hit effects. */
  readonly hitlagDamage?: number;
  /** Source hit-stop factor; zero disables the freeze. */
  readonly hitlagMultiplier?: number;
}

/** True iff `dir` is a recognised {@link ThrowDirection}. */
export function isThrowDirection(dir: unknown): dir is ThrowDirection {
  return (
    dir === 'forward' || dir === 'back' || dir === 'up' || dir === 'down'
  );
}

/**
 * Validate a {@link ThrowSpec} satisfies the schema invariants:
 *
 *   1. `damage >= 0`
 *   2. `animationFrames` is a positive integer
 *   3. Knockback vector components are finite
 *
 * Returns the spec unchanged on success; throws on the first violation.
 * `contextLabel` is embedded in the error so a per-character validator
 * can pinpoint the failing throw direction.
 */
export function validateThrowSpec(
  spec: ThrowSpec,
  contextLabel: string,
): ThrowSpec {
  if(spec.launchFacing!==undefined&&!['actor','opposite'].includes(spec.launchFacing))throw new Error(`${contextLabel}: launchFacing must be actor or opposite`);
  if(spec.releaseVelocity&&(!Number.isFinite(spec.releaseVelocity.x)||!Number.isFinite(spec.releaseVelocity.y)||
    spec.releaseVelocity.situation!==undefined&&!['ground','air'].includes(spec.releaseVelocity.situation)))
    throw new Error(`${contextLabel}: releaseVelocity requires finite coordinates and optional ground/air situation`);
  if (spec.rootMotionX !== undefined) {
    const total = spec.animationFrames + (spec.recoveryFrames ?? 0);
    if (spec.recoveryFrames === undefined || !Array.isArray(spec.rootMotionX) || spec.rootMotionX.length !== total ||
        spec.rootMotionX[0] !== 0 || spec.rootMotionX.some(value => !Number.isFinite(value))) {
      throw new Error(`${contextLabel}: rootMotionX must contain finite normalized samples for every action age`);
    }
  }
  if (spec.hitlagMultiplier !== undefined && (!Number.isFinite(spec.hitlagMultiplier) || spec.hitlagMultiplier < 0)) {
    throw new Error(`${contextLabel}: hitlagMultiplier must be a non-negative finite number`);
  }
  if (spec.electricCollision !== undefined && typeof spec.electricCollision !== 'boolean') {
    throw new Error(`${contextLabel}: electricCollision must be a boolean`);
  }
  if (spec.invincibilityFrames !== undefined && (!Number.isInteger(spec.invincibilityFrames) ||
    spec.invincibilityFrames < 0 || spec.invincibilityFrames > spec.animationFrames + 1)) {
    throw new Error(`${contextLabel}: invincibilityFrames must be an integer fitting the action through release`);
  }
  if (spec.knockbackArmor !== undefined && (!Number.isFinite(spec.knockbackArmor) || spec.knockbackArmor < 0)) {
    throw new Error(`${contextLabel}: knockbackArmor must be a non-negative finite number`);
  }
  if (!Number.isFinite(spec.damage) || spec.damage < 0) {
    throw new Error(
      `${contextLabel}: damage must be a non-negative finite number, got ${spec.damage}`,
    );
  }
  if (!Number.isInteger(spec.animationFrames) || spec.animationFrames <= 0) {
    throw new Error(
      `${contextLabel}: animationFrames must be a positive integer, got ${spec.animationFrames}`,
    );
  }
  const kb = spec.knockback;
  if (
    !Number.isFinite(kb.x) ||
    !Number.isFinite(kb.y) ||
    !Number.isFinite(kb.scaling)
  ) {
    throw new Error(
      `${contextLabel}: knockback components must be finite, got (${kb.x}, ${kb.y}, ${kb.scaling})`,
    );
  }
  if (kb.scaling < 0) {
    throw new Error(
      `${contextLabel}: knockback.scaling must be >= 0, got ${kb.scaling}`,
    );
  }
  if (spec.heldTargetHits !== undefined) {
    if (!Array.isArray(spec.heldTargetHits) || spec.heldTargetHits.length === 0) {
      throw new Error(`${contextLabel}: heldTargetHits must be a nonempty array`);
    }
    let previousFrame = -1;
    for (const [index, hit] of spec.heldTargetHits.entries()) {
      const label = `${contextLabel}.heldTargetHits[${index}]`;
      if (hit.electricCollision !== undefined && typeof hit.electricCollision !== 'boolean') {
        throw new Error(`${label}.electricCollision must be a boolean`);
      }
      if (!Number.isInteger(hit.frame) || hit.frame < 0 || hit.frame >= spec.animationFrames || hit.frame <= previousFrame) {
        throw new Error(`${label}: frame must be strictly ordered and before release`);
      }
      if (!Number.isFinite(hit.damage) || hit.damage < 0) {
        throw new Error(`${label}: damage must be a non-negative finite number`);
      }
      if (hit.hitlagDamage !== undefined && (!Number.isFinite(hit.hitlagDamage) || hit.hitlagDamage < 0)) {
        throw new Error(`${label}: hitlagDamage must be a non-negative finite number`);
      }
      if (hit.hitlagMultiplier !== undefined && (!Number.isFinite(hit.hitlagMultiplier) || hit.hitlagMultiplier < 0)) {
        throw new Error(`${label}: hitlagMultiplier must be a non-negative finite number`);
      }
      previousFrame = hit.frame;
    }
  }
  return spec;
}

/**
 * The complete 4-throw set every grabbing character must declare.
 * Mirrors Smash's "fthrow / bthrow / uthrow / dthrow" convention.
 */
export interface ThrowSet {
  readonly forward: ThrowSpec;
  readonly back: ThrowSpec;
  readonly up: ThrowSpec;
  readonly down: ThrowSpec;
}

/**
 * Validate a complete {@link ThrowSet} — calls
 * {@link validateThrowSpec} on each direction with a labelled context.
 */
export function validateThrowSet(
  set: ThrowSet,
  contextLabel: string,
): ThrowSet {
  validateThrowSpec(set.forward, `${contextLabel}.forward`);
  validateThrowSpec(set.back, `${contextLabel}.back`);
  validateThrowSpec(set.up, `${contextLabel}.up`);
  validateThrowSpec(set.down, `${contextLabel}.down`);
  return set;
}

/**
 * Look up a throw spec by direction. Pure indexed lookup — no defaults,
 * no fallback. Every direction is mandatory on a {@link ThrowSet}.
 */
export function getThrowByDirection(
  set: ThrowSet,
  direction: ThrowDirection,
): ThrowSpec {
  return set[direction];
}
