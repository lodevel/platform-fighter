/**
 * Generalized charge spec — extracted from `specialSchema.ts` so any
 * move (not just neutral specials) can opt into a "hold to power up"
 * mechanic.
 *
 * Originally `NeutralSpecialChargeSpec` was the only charged-attack
 * shape in the codebase: only Owl's neutral special used it. The
 * post-M2 character architecture pass collapses tilt vs smash into a
 * single chargeable slot per direction (tap = old tilt, hold = old
 * smash), so the same interpolation math now needs to be reachable
 * from any `AttackMoveWithAnimation`-shaped move.
 *
 * This module owns the canonical {@link ChargeSpec} type and the three
 * pure interpolation helpers. `specialSchema.ts` keeps a back-compat
 * re-export under the old name (`NeutralSpecialChargeSpec`) and its
 * existing move-taking helpers (`computeChargedDamage(move, ...)`)
 * just delegate here.
 *
 * # Mechanic recap
 *
 *     damage(t)    = lerp(minDamage,    maxDamage,    t)
 *     knockback(t) = lerp(minKnockback, maxKnockback, t)
 *     t            = clamp((heldFrames - minChargeFrames) /
 *                          (maxChargeFrames - minChargeFrames), 0, 1)
 *
 * Releasing before `minChargeFrames` is a runtime decision (the
 * runtime can either cancel the swing or fire it at `t = 0`); this
 * module just clamps the math to `[0, 1]`. Holding past
 * `maxChargeFrames` caps `t` at 1 — extra hold frames don't add
 * power, but they do delay the release.
 *
 * # Determinism
 *
 * Pure interpolation of integer-counted frames against frozen min /
 * max values. Identical hold durations always yield identical
 * realised damage and knockback. No `Math.random()`, no `Date.now()`,
 * no Phaser / Matter side effects.
 */

import type { KnockbackSpec } from './moveSchema';

/**
 * Configuration for a chargeable attack move. The realised damage and
 * knockback at release time are linearly interpolated between the
 * `min*` and `max*` endpoints based on the held-frames `t` parameter.
 *
 * This is the renamed-and-generalized successor to
 * `NeutralSpecialChargeSpec`. The shape is identical — only the home
 * module and the documentation generality have changed.
 */
export interface ChargeSpec {
  /**
   * Minimum hold duration before a release produces ANY swing. A
   * release before this many frames is treated as a cancel by most
   * runtime callers (no swing). Set to 0 if you want a tap-press to
   * fire the move at minimum power (the canonical "tap = tilt"
   * behaviour for chargeable lights).
   */
  readonly minChargeFrames: number;
  /**
   * Hold duration that produces the full-charge variant. Holding past
   * this frame caps the realised damage / knockback at the max
   * values. Must be > `minChargeFrames`.
   */
  readonly maxChargeFrames: number;
  /** Damage at `t = 0` (released exactly at `minChargeFrames`). */
  readonly minDamage: number;
  /** Damage at `t = 1` (released at or after `maxChargeFrames`). */
  readonly maxDamage: number;
  /** Knockback vector at `t = 0`. */
  readonly minKnockback: KnockbackSpec;
  /** Knockback vector at `t = 1`. */
  readonly maxKnockback: KnockbackSpec;
}

/**
 * Compute the charge interpolation parameter `t ∈ [0, 1]` for a given
 * hold duration. Returns 0 below `minChargeFrames` (the runtime should
 * cancel the swing entirely on early release; this helper just clamps
 * the math). Returns 1 at or above `maxChargeFrames`. Linearly
 * interpolates in between.
 *
 * Pure — same `(spec, heldFrames)` always returns the same `t`.
 */
export function computeChargeTFromSpec(
  spec: ChargeSpec,
  heldFrames: number,
): number {
  if (heldFrames <= spec.minChargeFrames) return 0;
  if (heldFrames >= spec.maxChargeFrames) return 1;
  const span = spec.maxChargeFrames - spec.minChargeFrames;
  if (span <= 0) return 1; // defensive: malformed spec
  return (heldFrames - spec.minChargeFrames) / span;
}

/**
 * Linear interpolation of the realised damage at hold duration
 * `heldFrames`. Returns `minDamage` for early-release / no-charge,
 * `maxDamage` for full-charge, and a linear blend in between.
 */
export function computeChargedDamageFromSpec(
  spec: ChargeSpec,
  heldFrames: number,
): number {
  const t = computeChargeTFromSpec(spec, heldFrames);
  return spec.minDamage + (spec.maxDamage - spec.minDamage) * t;
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
export function computeChargedKnockbackFromSpec(
  spec: ChargeSpec,
  heldFrames: number,
): KnockbackSpec {
  const t = computeChargeTFromSpec(spec, heldFrames);
  const a = spec.minKnockback;
  const b = spec.maxKnockback;
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    scaling: a.scaling + (b.scaling - a.scaling) * t,
  };
}

/**
 * Validate a {@link ChargeSpec} satisfies the schema invariants:
 *
 *   1. `minChargeFrames` is a non-negative integer.
 *   2. `maxChargeFrames` is an integer strictly greater than
 *      `minChargeFrames`.
 *   3. `minDamage >= 0` and `maxDamage >= minDamage`.
 *
 * Throws on the first violation; returns the spec unchanged on
 * success. `contextLabel` is embedded in the error so the caller
 * (a per-move validator) can identify which move owns the bad spec.
 *
 * Knockback vectors are not validated here — they are arbitrary
 * floats and the caller's per-move validator typically checks them
 * alongside other authored fields.
 */
export function validateChargeSpec(
  spec: ChargeSpec,
  contextLabel: string,
): ChargeSpec {
  if (!Number.isInteger(spec.minChargeFrames) || spec.minChargeFrames < 0) {
    throw new Error(
      `${contextLabel}: charge.minChargeFrames must be non-negative integer, got ${spec.minChargeFrames}`,
    );
  }
  if (
    !Number.isInteger(spec.maxChargeFrames) ||
    spec.maxChargeFrames <= spec.minChargeFrames
  ) {
    throw new Error(
      `${contextLabel}: charge.maxChargeFrames (${spec.maxChargeFrames}) must be > minChargeFrames (${spec.minChargeFrames})`,
    );
  }
  if (spec.minDamage < 0 || spec.maxDamage < spec.minDamage) {
    throw new Error(
      `${contextLabel}: charge damage range invalid (min=${spec.minDamage}, max=${spec.maxDamage})`,
    );
  }
  return spec;
}
