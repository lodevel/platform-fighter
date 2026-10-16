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
 * Opt-in `knockbackMode: 'damage-only'` keeps the move's reference
 * base/growth/angle fixed until an optional fullChargeKnockback switches the
 * record at completion. Charged damage feeds the reference formula;
 * the legacy knockback endpoints are inactive in that mode.
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
/** SmashWiki Smash attack (Ultimate): a smash charges for 1 s (60 frames) and "can also be
 * held for an additional 2 seconds after that, not increasing their power any further". */
export const ULTIMATE_SMASH_MAX_HOLD_FRAMES = 180;

export interface ChargeSpec {
  /** Opt-in source-style automatic wind; another press fires instead of release. */
  readonly inputBehavior?:'press-wind-fire';
  /** Total permitted hold, including time spent at full power. Omitted preserves legacy cap-fire. */
  readonly maxHoldFrames?: number;
  readonly entryFrames?: number;
  readonly cancelFrames?: number;
  readonly airCharge?: boolean;
  /** Integer source power-add steps and separate incomplete-charge ceiling. */
  readonly partialMaxDamage?: number;
  readonly damageStep?: number;
  /** Preserve the move's reference launch; charged damage alone feeds its growth.
   * Omitted retains legacy endpoint interpolation. */
  readonly knockbackMode?: 'damage-only';
  /** Separate launch record at full charge; requires damage-only mode.
   * Partial charges retain the owning move's reference record. */
  readonly fullChargeKnockback?: KnockbackSpec;
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
  /** Knockback vector at `t = 0`; inactive in damage-only mode. */
  readonly minKnockback: KnockbackSpec;
  /** Knockback vector at `t = 1`; inactive in damage-only mode. */
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
  if (heldFrames >= spec.maxChargeFrames) return spec.maxDamage;
  const max = spec.partialMaxDamage ?? spec.maxDamage;
  const damage = spec.minDamage + (max - spec.minDamage + (spec.partialMaxDamage === undefined ? 0 : spec.damageStep ?? 0)) * t;
  return spec.damageStep ? Math.min(max, spec.minDamage + Math.floor((damage - spec.minDamage) / spec.damageStep) * spec.damageStep) : damage;
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
 *
 * The optional Smash-style components (`baseMagnitude`,
 * `damageGrowth`) lerp with absent-treated-as-0 semantics: when only
 * ONE endpoint authors the field, the other endpoint contributes 0,
 * so charging smoothly fades the component in (toward max) or out
 * (toward min). The field is omitted from the result only when BOTH
 * endpoints omit it — legacy 3-field charge specs keep producing
 * byte-identical results (no keys gained).
 *
   * Damage-only mode instead requires the owning move's uncharged reference
 * record as the third argument and returns it unchanged. Requiring it avoids
 * silently substituting an inactive legacy endpoint for the real launch.
 */
export function computeChargedKnockbackFromSpec(
  spec: ChargeSpec,
  heldFrames: number,
  unchargedKnockback?: KnockbackSpec,
): KnockbackSpec {
  if (spec.knockbackMode === 'damage-only') {
    if (!unchargedKnockback?.reference) {
      throw new Error('damage-only charge requires the move\'s reference knockback');
    }
    // Damage has already been charged separately; scaling BKB/KBG here would
    // apply charge twice and discard the distinct inner/tip launch records.
    return heldFrames >= spec.maxChargeFrames
      ? spec.fullChargeKnockback ?? unchargedKnockback : unchargedKnockback;
  }
  const t = computeChargeTFromSpec(spec, heldFrames);
  const a = spec.minKnockback;
  const b = spec.maxKnockback;
  // Optional-component lerp — see the one-endpoint-absent rule in the
  // JSDoc above. `undefined` here means "omit from the result".
  const lerpOpt = (av?: number, bv?: number): number | undefined =>
    av === undefined && bv === undefined
      ? undefined
      : (av ?? 0) + ((bv ?? 0) - (av ?? 0)) * t;
  const baseMagnitude = lerpOpt(a.baseMagnitude, b.baseMagnitude);
  const damageGrowth = lerpOpt(a.damageGrowth, b.damageGrowth);
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    scaling: a.scaling + (b.scaling - a.scaling) * t,
    ...(baseMagnitude !== undefined ? { baseMagnitude } : {}),
    ...(damageGrowth !== undefined ? { damageGrowth } : {}),
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
  if(spec.inputBehavior!==undefined&&spec.inputBehavior!=='press-wind-fire')throw new Error(`${contextLabel}: unsupported charge inputBehavior`);
  for (const key of ['entryFrames', 'cancelFrames'] as const) {
    if (spec[key] !== undefined && (!Number.isInteger(spec[key]) || spec[key]! < 0)) {
      throw new Error(`${contextLabel}: ${key} must be a nonnegative integer`);
    }
  }
  if (spec.airCharge !== undefined && typeof spec.airCharge !== 'boolean') throw new Error(`${contextLabel}: airCharge must be boolean`);
  if (spec.maxHoldFrames !== undefined && (!Number.isInteger(spec.maxHoldFrames) || spec.maxHoldFrames < spec.maxChargeFrames)) {
    throw new Error(`${contextLabel}: maxHoldFrames must be an integer at least maxChargeFrames`);
  }
  if (spec.partialMaxDamage !== undefined && (!Number.isFinite(spec.partialMaxDamage)
    || spec.partialMaxDamage < spec.minDamage || spec.partialMaxDamage > spec.maxDamage)) {
    throw new Error(`${contextLabel}: partialMaxDamage must lie between minDamage and maxDamage`);
  }
  if (spec.damageStep !== undefined && (!Number.isFinite(spec.damageStep) || spec.damageStep <= 0)) {
    throw new Error(`${contextLabel}: damageStep must be positive`);
  }
  if (spec.fullChargeKnockback !== undefined &&
    (spec.knockbackMode !== 'damage-only' || !spec.fullChargeKnockback.reference)) {
    throw new Error(`${contextLabel}: fullChargeKnockback requires damage-only mode and reference knockback`);
  }
  if (spec.knockbackMode !== undefined && spec.knockbackMode !== 'damage-only') {
    throw new Error(`${contextLabel}: charge.knockbackMode must be damage-only when present`);
  }
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
