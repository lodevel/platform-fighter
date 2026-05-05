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
