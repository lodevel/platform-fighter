/**
 * Grab spec schema — post-M2 grab/throw subsystem.
 *
 * Declarative shape every grabbing character authors: the grab's
 * range hitbox geometry, the frame windows that drive the
 * startup/active/recovery → holding/throwing state machine, the
 * mash-out cap, the optional pummel, and the 4-throw set.
 *
 * The grab subsystem is fundamentally:
 *
 *   1. **Range hitbox** spawns during the grab's `active` window.
 *      Distinct from a regular attack hitbox because:
 *        - It bypasses shield (Smash-canonical "grab beats shield").
 *        - On connect, it does NOT apply damage / knockback — instead
 *          it transitions both fighters into a hold/grabbed pair.
 *
 *   2. **Hold** — both fighters lock at a fixed offset; the target
 *      cannot input; the grabber can pummel (a tiny tap-attack that
 *      does small damage) or release into one of four throws by
 *      pressing a stick direction. The hold drains
 *      `holdFramesMax` frames; if neither happens before drain
 *      completes, the target auto-releases (mash-out).
 *
 *   3. **Throw** — selected throw spec's animation runs to its
 *      release frame, at which point damage + knockback apply to
 *      the target via the standard `combat.ts:computeKnockback`
 *      pipeline.
 *
 *   4. **Whiff recovery** — if the active hitbox window closes
 *      without a connect, the grabber stays locked in a long
 *      committal recovery. This is the canonical Smash "missed grab
 *      = punish window" risk/reward.
 *
 * This module owns ONLY the data contract. The pure step function
 * lives in `grabState.ts`; the runtime wiring (Matter sensor body
 * spawn, target-side `'grabbed'` state) is in `Character.ts`.
 *
 * Determinism: every field is a frozen finite number. The state
 * machine that consumes this spec is also pure — replay-safe.
 */

import { type ThrowSet, validateThrowSet } from './throwSchema';

/**
 * Geometry of the grab's range hitbox. Same shape as
 * `AttackMove.hitbox` for consistency with the existing hitbox
 * spawning helpers in `attacks.ts`. The runtime spawns a Matter
 * sensor body using these dimensions during the grab's
 * `[startupFrames, startupFrames + activeFrames)` window.
 */
export interface GrabHitbox {
  /** X offset from grabber's body centre, mirrored by facing. */
  readonly offsetX: number;
  /** Y offset from grabber's body centre (negative = above). */
  readonly offsetY: number;
  /** Hitbox width in design pixels. */
  readonly width: number;
  /** Hitbox height in design pixels. */
  readonly height: number;
}

/**
 * Optional pummel — a tiny tap-attack the grabber can fire while
 * holding the target. Each pummel adds `damage` to the target's
 * percent and resets the pummel cooldown. `cooldownFrames` enforces
 * the gap between successive pummels so a player can't mash a
 * 100%-from-grab loop.
 */
export interface PummelSpec {
  /** % added to the held target on each pummel. */
  readonly damage: number;
  /** Frames after a pummel before the next can fire. */
  readonly cooldownFrames: number;
}

/**
 * Optional DASH GRAB modifier — a grab pressed while running carries
 * forward dash momentum and reaches further. Present → the fighter can
 * dash-grab; absent → grabbing while running just does a standing grab.
 */
export interface DashGrabSpec {
  /**
   * Forward px added to the grab hitbox's `offsetX` when dash-grabbing —
   * the canonical "dash grab reaches further than a standing grab".
   * Non-negative.
   */
  readonly rangeBonusX: number;
  /**
   * Fraction (`[0, 1]`) of the run-entry horizontal velocity preserved
   * through the dash-grab whiff, so the grabber slides forward into the
   * grab instead of rooting. 0 = stops dead (standing-grab feel); 1 =
   * keeps full run speed.
   */
  readonly momentumRetain: number;
}

/**
 * Validate a {@link DashGrabSpec} — non-negative finite `rangeBonusX`,
 * `momentumRetain` a finite fraction in `[0, 1]`.
 */
export function validateDashGrabSpec(
  spec: DashGrabSpec,
  contextLabel: string,
): DashGrabSpec {
  if (!Number.isFinite(spec.rangeBonusX) || spec.rangeBonusX < 0) {
    throw new Error(
      `${contextLabel}.dashGrab: rangeBonusX must be a non-negative finite number, got ${spec.rangeBonusX}`,
    );
  }
  if (
    !Number.isFinite(spec.momentumRetain) ||
    spec.momentumRetain < 0 ||
    spec.momentumRetain > 1
  ) {
    throw new Error(
      `${contextLabel}.dashGrab: momentumRetain must be a finite number in [0, 1], got ${spec.momentumRetain}`,
    );
  }
  return spec;
}

/**
 * Validate a {@link PummelSpec} — non-negative damage, non-negative
 * integer cooldown.
 */
export function validatePummelSpec(
  spec: PummelSpec,
  contextLabel: string,
): PummelSpec {
  if (!Number.isFinite(spec.damage) || spec.damage < 0) {
    throw new Error(
      `${contextLabel}.pummel: damage must be a non-negative finite number, got ${spec.damage}`,
    );
  }
  if (!Number.isInteger(spec.cooldownFrames) || spec.cooldownFrames < 0) {
    throw new Error(
      `${contextLabel}.pummel: cooldownFrames must be a non-negative integer, got ${spec.cooldownFrames}`,
    );
  }
  return spec;
}

/**
 * Full grab declaration for a character. Used by:
 *
 *   • `grabState.ts:tickGrab` — pure state-machine step that consumes
 *     this spec to drive transitions and frame counters.
 *   • `Character.ts` — spawns the Matter sensor body during the
 *     active window and wires the throw release into the existing
 *     hit-resolve path.
 *   • Tests / AI predictors — read the frame data to predict grab
 *     punish windows.
 */
export interface GrabSpec {
  /**
   * Stable id (e.g. `'wolf.grab'`). Lets the runtime tag spawned
   * sensor bodies for replay logging + AI prediction.
   */
  readonly id: string;
  /** Range hitbox geometry — driven by the active window. */
  readonly hitbox: GrabHitbox;
  /**
   * Frames the grabber spends winding up before the range hitbox
   * spawns. Smash-canonical 6-10f for standing grabs; 18-24f for
   * dash grabs (which would author a higher value).
   */
  readonly startupFrames: number;
  /**
   * Frames the range hitbox is live. Short (1-3f) — grabs are
   * sharp commitments; the hitbox's narrow window IS the risk.
   */
  readonly activeFrames: number;
  /**
   * Frames the grabber is locked in committal recovery if the
   * active window closed without a connect (i.e. the grab whiffed).
   * Smash-canonical 30-50f — long enough that a whiffed grab
   * means a punish.
   */
  readonly whiffRecoveryFrames: number;
  /**
   * Maximum frames the grabber can hold the target before the
   * target auto-releases. Smash uses a percent-scaled formula
   * (higher target % = shorter hold), but for the M0 cut we use a
   * flat per-character cap. Authors can tune per-character so a
   * grappler archetype (Bear) holds longer than a featherweight.
   */
  readonly holdFramesMax: number;
  /**
   * Frames the grabber sits in cooldown after a successful throw
   * release. Long enough that a throw isn't a free combo into
   * another grab.
   */
  readonly throwRecoveryFrames: number;
  /** Optional pummel mechanic. */
  readonly pummel?: PummelSpec;
  /** Optional dash-grab modifier (forward reach + momentum when grabbing out of a run). */
  readonly dashGrab?: DashGrabSpec;
  /** The 4-throw set. */
  readonly throws: ThrowSet;
}

/**
 * Validate a complete {@link GrabSpec}. Throws on the first invariant
 * violation. `contextLabel` defaults to the spec's `id` so error
 * messages identify the failing record by name.
 */
export function validateGrabSpec(
  spec: GrabSpec,
  contextLabel = `GrabSpec '${spec.id}'`,
): GrabSpec {
  if (typeof spec.id !== 'string' || spec.id.length === 0) {
    throw new Error(`${contextLabel}: id must be a non-empty string`);
  }

  // Hitbox geometry
  const h = spec.hitbox;
  if (
    !Number.isFinite(h.offsetX) ||
    !Number.isFinite(h.offsetY) ||
    !Number.isFinite(h.width) ||
    !Number.isFinite(h.height)
  ) {
    throw new Error(`${contextLabel}: hitbox components must be finite`);
  }
  if (h.width <= 0 || h.height <= 0) {
    throw new Error(
      `${contextLabel}: hitbox dimensions must be positive (got ${h.width}x${h.height})`,
    );
  }

  // Frame counts
  for (const [field, value] of [
    ['startupFrames', spec.startupFrames],
    ['activeFrames', spec.activeFrames],
    ['whiffRecoveryFrames', spec.whiffRecoveryFrames],
    ['holdFramesMax', spec.holdFramesMax],
    ['throwRecoveryFrames', spec.throwRecoveryFrames],
  ] as const) {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(
        `${contextLabel}: ${field} must be a non-negative integer, got ${value}`,
      );
    }
  }
  if (spec.activeFrames === 0) {
    throw new Error(
      `${contextLabel}: activeFrames must be > 0 — a 0-frame active window can never connect`,
    );
  }
  if (spec.holdFramesMax === 0) {
    throw new Error(
      `${contextLabel}: holdFramesMax must be > 0 — a 0-frame hold leaves no room for pummel/throw`,
    );
  }

  // Pummel
  if (spec.pummel !== undefined) {
    validatePummelSpec(spec.pummel, contextLabel);
  }

  // Dash grab
  if (spec.dashGrab !== undefined) {
    validateDashGrabSpec(spec.dashGrab, contextLabel);
  }

  // Throws
  validateThrowSet(spec.throws, `${contextLabel}.throws`);

  return spec;
}

/** Total frames a grab whiff costs (startup + active + whiffRecovery). */
export function getGrabWhiffTotalFrames(spec: GrabSpec): number {
  return spec.startupFrames + spec.activeFrames + spec.whiffRecoveryFrames;
}
