/**
 * Platform-behavior helpers — Sub-AC 1 of AC 90301.
 *
 * The M2 schema extension adds a third platform behavior type
 * (`'moving'`) alongside the existing `'solid'` and `'pass-through'`
 * variants. To keep the change non-breaking for code that already
 * reads `platform.passThrough`, the canonical {@link StagePlatform}
 * record now carries:
 *
 *   - `passThrough: boolean` (legacy required field — always present)
 *   - `behavior?: PlatformBehavior`  (explicit, recommended for new code)
 *   - `motion?: MovingPlatformMotion` (required when behavior is `'moving'`)
 *
 * This module is the single source of truth for *interpreting* and
 * *validating* those fields together. Renderers, the stage builder,
 * replay tooling, and AI navigation all import {@link getPlatformBehavior}
 * so the precedence rule lives in exactly one place.
 *
 * The module is Phaser-free so it can be unit-tested under plain Node.
 */

import type {
  MovingPlatformMotion,
  PlatformBehavior,
  StagePlatform,
} from '../types';

// ---------------------------------------------------------------------------
// Behavior resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the canonical {@link PlatformBehavior} for a platform record.
 *
 * Precedence rules:
 *
 *   1. If `platform.behavior` is set, that value wins. (Lets the
 *      stage builder author moving / pass-through platforms even on
 *      records where `passThrough` is `false`.)
 *   2. Otherwise, fall back to the legacy `passThrough` flag —
 *      `true ⇒ 'pass-through'`, `false ⇒ 'solid'`.
 *
 * This precedence is what makes the schema extension non-breaking:
 * the existing M1 stages (which only set `passThrough`) keep
 * resolving to `'solid'` / `'pass-through'` exactly as before.
 */
export function getPlatformBehavior(platform: StagePlatform): PlatformBehavior {
  if (platform.behavior) return platform.behavior;
  return platform.passThrough ? 'pass-through' : 'solid';
}

/**
 * `true` iff the platform should expose a drop-through top edge
 * (i.e. characters can ascend through it from below). Encapsulates
 * the "either explicit `'pass-through'` behavior or legacy
 * `passThrough: true`" rule so callers don't have to remember it.
 */
export function isPassThroughPlatform(platform: StagePlatform): boolean {
  return getPlatformBehavior(platform) === 'pass-through';
}

/** `true` iff the platform is a moving platform (requires `motion`). */
export function isMovingPlatform(platform: StagePlatform): boolean {
  return getPlatformBehavior(platform) === 'moving';
}

// ---------------------------------------------------------------------------
// Motion config defaults
// ---------------------------------------------------------------------------

/**
 * Defaults for optional fields on {@link MovingPlatformMotion}. Exposed
 * so the renderer, stage builder UI, and tests share a single source
 * for the canonical defaults.
 */
export const MOVING_PLATFORM_MOTION_DEFAULTS = {
  /** Default mode is ping-pong (Smash-style "moving platform" behavior). */
  mode: 'ping-pong' as const,
  /** Default easing is linear (constant velocity between waypoints). */
  easing: 'linear' as const,
  /** Default initial phase offset is `0` frames. */
  phaseFrames: 0,
} as const;

/**
 * Return a fully-resolved view of a {@link MovingPlatformMotion},
 * filling in defaults for the optional fields. Callers (renderer,
 * stage builder, replay export) get a non-optional record so they
 * can stop juggling `?? default` everywhere.
 */
export function resolveMovingPlatformMotion(
  motion: MovingPlatformMotion,
): Required<MovingPlatformMotion> {
  return {
    waypoints: motion.waypoints,
    cycleFrames: motion.cycleFrames,
    phaseFrames: motion.phaseFrames ?? MOVING_PLATFORM_MOTION_DEFAULTS.phaseFrames,
    mode: motion.mode ?? MOVING_PLATFORM_MOTION_DEFAULTS.mode,
    easing: motion.easing ?? MOVING_PLATFORM_MOTION_DEFAULTS.easing,
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate a {@link MovingPlatformMotion} record. Throws a clear error
 * on the first invariant violation; returns silently on success.
 *
 * Invariants:
 *   - `waypoints` has at least 2 entries (a single-waypoint path is
 *     a static platform — author it as `'solid'` instead).
 *   - Every waypoint coordinate is finite.
 *   - `cycleFrames` is an integer ≥ 2 so it advances deterministically
 *     alongside the fixed-step engine.
 *   - `phaseFrames`, when present, is a finite integer.
 *   - `mode`, when present, is one of the two known values.
 *   - `easing`, when present, is one of the two known values.
 */
export function validateMovingPlatformMotion(
  motion: MovingPlatformMotion,
  context = 'moving platform',
): void {
  if (!Array.isArray(motion.waypoints) || motion.waypoints.length < 2) {
    throw new Error(
      `${context}: motion.waypoints must contain at least 2 entries, ` +
        `got ${motion.waypoints?.length ?? 0}.`,
    );
  }
  for (let i = 0; i < motion.waypoints.length; i += 1) {
    const w = motion.waypoints[i]!;
    if (!Number.isFinite(w.x) || !Number.isFinite(w.y)) {
      throw new Error(
        `${context}: motion.waypoints[${i}] has non-finite coordinates (${w.x}, ${w.y}).`,
      );
    }
  }
  if (!Number.isInteger(motion.cycleFrames) || motion.cycleFrames < 2) {
    throw new Error(
      `${context}: motion.cycleFrames must be an integer >= 2, got ${motion.cycleFrames}.`,
    );
  }
  if (motion.phaseFrames !== undefined) {
    if (!Number.isInteger(motion.phaseFrames)) {
      throw new Error(
        `${context}: motion.phaseFrames must be an integer when set, got ${motion.phaseFrames}.`,
      );
    }
  }
  if (motion.mode !== undefined && motion.mode !== 'ping-pong' && motion.mode !== 'loop') {
    throw new Error(
      `${context}: motion.mode must be 'ping-pong' or 'loop', got ${String(motion.mode)}.`,
    );
  }
  if (motion.easing !== undefined && motion.easing !== 'linear' && motion.easing !== 'sine') {
    throw new Error(
      `${context}: motion.easing must be 'linear' or 'sine', got ${String(motion.easing)}.`,
    );
  }
}

/**
 * Validate the schema invariants between {@link StagePlatform} fields:
 *
 *   - `behavior === 'moving'` ⇒ `motion` is present and valid.
 *   - `behavior !== 'moving'` ⇒ `motion` is NOT present.
 *   - `passThrough === true` ⇒ `behavior !== 'solid'` when both are set
 *     (would otherwise be a contradiction the renderer can't honour).
 *
 * Throws on the first violation. Used by the stage builder serializer
 * and in tests; runtime renderers are free to skip validation if they
 * trust their inputs.
 */
export function validateStagePlatform(
  platform: StagePlatform,
  context = 'platform',
): void {
  const behavior = getPlatformBehavior(platform);

  if (behavior === 'moving') {
    if (!platform.motion) {
      throw new Error(
        `${context}: behavior 'moving' requires a motion record, but motion is missing.`,
      );
    }
    validateMovingPlatformMotion(platform.motion, context);
  } else {
    if (platform.motion) {
      throw new Error(
        `${context}: motion is only valid for behavior 'moving', got behavior '${behavior}'.`,
      );
    }
  }

  if (
    platform.behavior === 'solid' &&
    platform.passThrough === true
  ) {
    throw new Error(
      `${context}: behavior 'solid' is inconsistent with passThrough: true.`,
    );
  }
  if (
    platform.behavior === 'pass-through' &&
    platform.passThrough === false
  ) {
    throw new Error(
      `${context}: behavior 'pass-through' is inconsistent with passThrough: false.`,
    );
  }
}

/** All three platform behavior values, in canonical order. */
export const PLATFORM_BEHAVIORS: ReadonlyArray<PlatformBehavior> = Object.freeze(
  ['solid', 'pass-through', 'moving'],
);
