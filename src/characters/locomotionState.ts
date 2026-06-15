/**
 * Ground-locomotion state machine — Tier 5 (Smash-parity roadmap).
 *
 * A pure, deterministic data-and-functions module (mirroring
 * {@link ./dodgeState} and {@link ./grabState}) modelling Smash's grounded
 * movement modes:
 *
 *   • **standing**    — grounded, stick below the walk threshold. Idle; the
 *                       runtime damps residual velocity toward rest.
 *   • **walk**        — partial tilt (`[walkStickThreshold, dashStickThreshold)`).
 *                       Slow, proportional movement capped at `walkMaxSpeed`.
 *   • **initialDash** — a FLICK from rest/walk to full tilt. A short burst
 *                       (target `initialDashSpeed`) held for
 *                       `dashDanceWindowFrames`; the only window in which a
 *                       clean direction reversal (DASH-DANCE) is allowed.
 *   • **run**         — sustained full tilt after the dash window. Accelerates
 *                       to `runMaxSpeed` (defaults to the fighter's
 *                       `maxRunSpeed`).
 *   • **pivot**       — an opposite-direction flick WHILE running. A brief
 *                       skid-stop (`pivotStopFrames`) with facing flipped
 *                       immediately, then resolves to the held stick.
 *   • **crouch**      — stick held DOWN with no lateral intent. Rooted; the
 *                       gate state for crouch-tilts / down-smash-from-crouch.
 *
 * Why a separate module: pure functions (no `Math.random`, no wall-clock,
 * no Phaser/Matter) → trivially unit-testable and replay-safe, exactly like
 * the dodge / grab / shield machines. The `Character` class owns the
 * integrator (accel toward the target, damping to rest); this module owns
 * only the STATE, the per-frame TARGET velocity, and the FACING — so wiring
 * it in changes *what* the fighter aims for, never *how* the velocity is
 * integrated. That keeps the existing first-frame-`groundAccel` /
 * terminal-`maxRunSpeed` contracts intact.
 *
 * Determinism: every transition is a pure function of `(state, input,
 * tuning)`; identical input streams yield identical state trajectories.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type LocomotionStateName =
  | 'standing'
  | 'walk'
  | 'initialDash'
  | 'run'
  | 'pivot'
  | 'crouch';

/**
 * Read-only locomotion record. Carried per-fighter; advanced by
 * {@link tickLocomotion} once per fixed step.
 *
 *   • `facing`      — the direction the fighter visually faces (authoritative
 *                     for grounded facing). Flips on a directional press; held
 *                     across neutral. During a `pivot` it has ALREADY flipped
 *                     to the new (post-skid) direction.
 *   • `framesElapsed` — frames spent in the current phase. Gates the
 *                     initial-dash → run window and the pivot skid length.
 *   • `dashFacing`  — the direction the active/last dash committed to. Used to
 *                     detect a DASH-DANCE (opposite flick still inside the
 *                     window) vs a same-direction hold (→ run).
 */
export interface LocomotionState {
  readonly name: LocomotionStateName;
  readonly facing: 1 | -1;
  readonly framesElapsed: number;
  readonly dashFacing: 1 | -1;
}

/** Per-frame input driving the locomotion machine. */
export interface LocomotionInput {
  /**
   * Horizontal stick this frame, clamped `[-1, 1]`. The caller passes the
   * POST-lockout value (shield / dodge / charge / grab already zeroed it), so
   * those lockouts naturally resolve to `standing` (no motion, no flick).
   */
  readonly moveX: number;
  /** Vertical stick this frame, `[-1, 1]`, positive = DOWN (screen-space). For crouch. */
  readonly moveY: number;
  /** Previous frame's `moveX` (same post-lockout value) — for flick-edge detection. */
  readonly prevMoveX: number;
  /** True iff grounded this frame. Airborne forces `standing` (air drift is the caller's path). */
  readonly grounded: boolean;
  /** Fallback facing (carried while airborne / neutral). `1` = right, `-1` = left. */
  readonly facing: 1 | -1;
}

/** Tunable locomotion parameters. All optional; resolved against {@link LOCOMOTION_DEFAULTS}. */
export interface LocomotionTuning {
  /** Burst target speed during the initial dash. Default `0.9 × runMaxSpeed`. */
  readonly initialDashSpeed?: number;
  /** Top speed while walking (partial tilt). Default `0.45 × runMaxSpeed`. */
  readonly walkMaxSpeed?: number;
  /** Top run speed. Default = the fighter's `maxRunSpeed` (passed to resolve). */
  readonly runMaxSpeed?: number;
  /** Frames the initial-dash window lasts (dash-dance only reversible inside it). Default 12. */
  readonly dashDanceWindowFrames?: number;
  /** Frames the pivot skid-stop lasts. Default 6. */
  readonly pivotStopFrames?: number;
  /** Velocity multiplier applied per frame during a pivot skid (hard decel). Default 0.55. */
  readonly pivotDamping?: number;
  /** `|moveX|` at/above which the fighter walks (below = standing). Default 0.30. */
  readonly walkStickThreshold?: number;
  /** `|moveX|` at/above which a flick dashes (below = walk). Default 0.75. */
  readonly dashStickThreshold?: number;
  /** `moveY` (down) at/above which the fighter crouches. Default 0.50. */
  readonly crouchStickThreshold?: number;
  /** Whether crouch is enabled. Default true. */
  readonly crouchEnabled?: boolean;
}

/** Fully-defaulted locomotion tuning. */
export interface ResolvedLocomotionTuning {
  readonly initialDashSpeed: number;
  readonly walkMaxSpeed: number;
  readonly runMaxSpeed: number;
  readonly dashDanceWindowFrames: number;
  readonly pivotStopFrames: number;
  readonly pivotDamping: number;
  readonly walkStickThreshold: number;
  readonly dashStickThreshold: number;
  readonly crouchStickThreshold: number;
  readonly crouchEnabled: boolean;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** Reference run speed used to derive the relative defaults when none is supplied. */
const DEFAULT_RUN_MAX_SPEED = 8;
const DEFAULT_DASH_DANCE_WINDOW_FRAMES = 12;
const DEFAULT_PIVOT_STOP_FRAMES = 6;
const DEFAULT_PIVOT_DAMPING = 0.55;
const DEFAULT_WALK_STICK_THRESHOLD = 0.3;
const DEFAULT_DASH_STICK_THRESHOLD = 0.75;
const DEFAULT_CROUCH_STICK_THRESHOLD = 0.5;
/** Initial-dash burst as a fraction of run speed (a hair under run). */
const INITIAL_DASH_SPEED_FRACTION = 0.9;
/** Walk top speed as a fraction of run speed (clearly slower). */
const WALK_MAX_SPEED_FRACTION = 0.45;

export const LOCOMOTION_DEFAULTS: ResolvedLocomotionTuning = Object.freeze({
  runMaxSpeed: DEFAULT_RUN_MAX_SPEED,
  initialDashSpeed: DEFAULT_RUN_MAX_SPEED * INITIAL_DASH_SPEED_FRACTION,
  walkMaxSpeed: DEFAULT_RUN_MAX_SPEED * WALK_MAX_SPEED_FRACTION,
  dashDanceWindowFrames: DEFAULT_DASH_DANCE_WINDOW_FRAMES,
  pivotStopFrames: DEFAULT_PIVOT_STOP_FRAMES,
  pivotDamping: DEFAULT_PIVOT_DAMPING,
  walkStickThreshold: DEFAULT_WALK_STICK_THRESHOLD,
  dashStickThreshold: DEFAULT_DASH_STICK_THRESHOLD,
  crouchStickThreshold: DEFAULT_CROUCH_STICK_THRESHOLD,
  crouchEnabled: true,
});

// ---------------------------------------------------------------------------
// Constructors / resolve
// ---------------------------------------------------------------------------

/** Initial state for a freshly-spawned fighter — standing, facing right by default. */
export function createLocomotionState(facing: 1 | -1 = 1): LocomotionState {
  return Object.freeze({
    name: 'standing',
    facing,
    framesElapsed: 0,
    dashFacing: facing,
  });
}

/** Reset to a fresh standing state (respawn / replay-seek). */
export function resetLocomotionState(facing: 1 | -1 = 1): LocomotionState {
  return createLocomotionState(facing);
}

/**
 * Resolve a partial tuning into a fully-defaulted record. `maxRunSpeed`
 * (the fighter's run cap) seeds the relative speed defaults so a slow
 * fighter's initial-dash / walk stay proportional to its run speed.
 */
export function resolveLocomotionTuning(
  overrides?: LocomotionTuning,
  maxRunSpeed?: number,
): ResolvedLocomotionTuning {
  const runMaxSpeed = nonNegativeFinite(
    overrides?.runMaxSpeed,
    nonNegativeFinite(maxRunSpeed, DEFAULT_RUN_MAX_SPEED),
  );
  return Object.freeze({
    runMaxSpeed,
    initialDashSpeed: nonNegativeFinite(
      overrides?.initialDashSpeed,
      runMaxSpeed * INITIAL_DASH_SPEED_FRACTION,
    ),
    walkMaxSpeed: nonNegativeFinite(
      overrides?.walkMaxSpeed,
      runMaxSpeed * WALK_MAX_SPEED_FRACTION,
    ),
    dashDanceWindowFrames: nonNegativeInt(
      overrides?.dashDanceWindowFrames,
      DEFAULT_DASH_DANCE_WINDOW_FRAMES,
    ),
    pivotStopFrames: nonNegativeInt(
      overrides?.pivotStopFrames,
      DEFAULT_PIVOT_STOP_FRAMES,
    ),
    pivotDamping: clamp01(
      overrides?.pivotDamping ?? DEFAULT_PIVOT_DAMPING,
    ),
    walkStickThreshold: clamp01(
      overrides?.walkStickThreshold ?? DEFAULT_WALK_STICK_THRESHOLD,
    ),
    dashStickThreshold: clamp01(
      overrides?.dashStickThreshold ?? DEFAULT_DASH_STICK_THRESHOLD,
    ),
    crouchStickThreshold: clamp01(
      overrides?.crouchStickThreshold ?? DEFAULT_CROUCH_STICK_THRESHOLD,
    ),
    crouchEnabled: overrides?.crouchEnabled ?? true,
  });
}

function nonNegativeInt(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

function nonNegativeFinite(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < 0) return 0;
  return value;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** True while dashing (initial-dash burst OR sustained run) — the "running" signal. */
export function isDashing(state: LocomotionState): boolean {
  return state.name === 'initialDash' || state.name === 'run';
}

/** True while crouching. */
export function isCrouching(state: LocomotionState): boolean {
  return state.name === 'crouch';
}

/** True during the pivot skid-stop. */
export function isPivoting(state: LocomotionState): boolean {
  return state.name === 'pivot';
}

/** The authoritative grounded facing. */
export function getLocomotionFacing(state: LocomotionState): 1 | -1 {
  return state.facing;
}

// ---------------------------------------------------------------------------
// Pure step function
// ---------------------------------------------------------------------------

function make(
  name: LocomotionStateName,
  facing: 1 | -1,
  framesElapsed: number,
  dashFacing: 1 | -1,
): LocomotionState {
  return Object.freeze({ name, facing, framesElapsed, dashFacing });
}

/**
 * Advance the locomotion machine by one fixed step. Pure: identical
 * `(state, input, tuning)` always yields the same next state.
 *
 * Transition priority (deterministic): airborne-reset → crouch (no lateral
 * intent + stick down) → per-state lateral logic (dash-dance inside the
 * window, pivot from run, run after the window, initial-dash on a fresh
 * flick, walk on partial tilt, standing otherwise).
 */
export function tickLocomotion(
  state: LocomotionState,
  input: LocomotionInput,
  tuning: ResolvedLocomotionTuning = LOCOMOTION_DEFAULTS,
): LocomotionState {
  const mag = Math.abs(input.moveX);
  const dir: 1 | -1 | 0 =
    input.moveX > 0 ? 1 : input.moveX < 0 ? -1 : 0;
  const prevMag = Math.abs(input.prevMoveX);
  const isDashMag = mag >= tuning.dashStickThreshold;
  const isWalkMag =
    mag >= tuning.walkStickThreshold && mag < tuning.dashStickThreshold;
  // A flick INTO a dash from a non-dash position (rest or walk).
  const dashFlick = prevMag < tuning.dashStickThreshold && isDashMag;

  // 1. Airborne — no ground locomotion. Reset to standing, carry facing.
  if (!input.grounded) {
    return make('standing', input.facing, 0, state.dashFacing);
  }

  // 2. Crouch — stick down with no clear lateral intent (lateral wins ties).
  if (
    tuning.crouchEnabled &&
    mag < tuning.walkStickThreshold &&
    input.moveY >= tuning.crouchStickThreshold
  ) {
    const frames = state.name === 'crouch' ? state.framesElapsed + 1 : 0;
    return make('crouch', input.facing, frames, state.dashFacing);
  }

  // 3. Per-state lateral transitions.
  switch (state.name) {
    case 'initialDash': {
      if (state.framesElapsed < tuning.dashDanceWindowFrames) {
        if (isDashMag && dir !== 0 && dir === state.dashFacing) {
          // Same direction held — keep dashing, advancing the window clock.
          // Promote to RUN exactly AT the boundary so the machine never
          // dwells in an initialDash frame with framesElapsed == window
          // (that off-by-one frame would dash-dance an opposite flick where
          // one frame later it pivots). The dash-dance window is therefore
          // exactly `dashDanceWindowFrames` ticks long.
          if (state.framesElapsed + 1 >= tuning.dashDanceWindowFrames) {
            return make('run', dir, 0, dir);
          }
          return make('initialDash', dir, state.framesElapsed + 1, dir);
        }
        if (isDashMag && dir !== 0 && dir !== state.dashFacing) {
          // DASH-DANCE — opposite flick inside the window cleanly reverses.
          return make('initialDash', dir, 0, dir);
        }
        // Stick dropped below the dash threshold.
        if (isWalkMag && dir !== 0) return make('walk', dir, 0, state.dashFacing);
        return make('standing', input.facing, 0, state.dashFacing);
      }
      // Window elapsed.
      if (isDashMag && dir !== 0 && dir === state.dashFacing) {
        return make('run', dir, 0, dir);
      }
      if (isDashMag && dir !== 0) {
        // Opposite full-tilt past the window: a fresh dash the other way.
        return make('initialDash', dir, 0, dir);
      }
      if (isWalkMag && dir !== 0) return make('walk', dir, 0, state.dashFacing);
      return make('standing', input.facing, 0, state.dashFacing);
    }

    case 'run': {
      if (isDashMag && dir !== 0 && dir === state.facing) {
        return make('run', dir, state.framesElapsed + 1, dir);
      }
      if (isDashMag && dir !== 0 && dir !== state.facing) {
        // PIVOT — opposite flick while running. Facing flips immediately;
        // the run window has closed so this is a skid, NOT a dash-dance.
        return make('pivot', dir, 0, dir);
      }
      if (isWalkMag && dir !== 0) return make('walk', dir, 0, state.dashFacing);
      return make('standing', input.facing, 0, state.dashFacing);
    }

    case 'pivot': {
      const next = state.framesElapsed + 1;
      if (next < tuning.pivotStopFrames) {
        return make('pivot', state.facing, next, state.dashFacing);
      }
      // Skid done — resolve the held stick.
      if (isDashMag && dir !== 0) return make('initialDash', dir, 0, dir);
      if (isWalkMag && dir !== 0) return make('walk', dir, 0, dir);
      return make('standing', input.facing, 0, state.dashFacing);
    }

    // standing / walk / crouch → re-evaluate from the raw stick.
    default: {
      if (dashFlick && dir !== 0) {
        return make('initialDash', dir, 0, dir);
      }
      if (isDashMag && dir !== 0) {
        // Full tilt held without a fresh flick edge (e.g. just landed holding
        // a direction) — go straight to a sustained run, no burst window.
        return make('run', dir, 0, dir);
      }
      if (isWalkMag && dir !== 0) {
        return make('walk', dir, 0, state.dashFacing);
      }
      return make('standing', input.facing, 0, state.dashFacing);
    }
  }
}

/**
 * The signed horizontal TARGET velocity the runtime should accelerate
 * toward this frame, or `null` when the fighter should instead damp toward
 * rest (standing / crouch / pivot — the caller picks the damping factor,
 * using {@link ResolvedLocomotionTuning.pivotDamping} while
 * {@link isPivoting}). Airborne also returns `null` (the caller owns the
 * air-drift path).
 */
export function getLocomotionTargetVx(
  state: LocomotionState,
  input: LocomotionInput,
  tuning: ResolvedLocomotionTuning = LOCOMOTION_DEFAULTS,
): number | null {
  if (!input.grounded) return null;
  switch (state.name) {
    case 'walk': {
      // Proportional within [walkStickThreshold, dashStickThreshold] → [0, walkMaxSpeed].
      const mag = Math.abs(input.moveX);
      const span = tuning.dashStickThreshold - tuning.walkStickThreshold;
      const t =
        span > 0
          ? clamp01((mag - tuning.walkStickThreshold) / span)
          : 1;
      return state.facing * tuning.walkMaxSpeed * t;
    }
    case 'initialDash':
      return state.dashFacing * tuning.initialDashSpeed;
    case 'run':
      return state.facing * tuning.runMaxSpeed;
    // standing / crouch / pivot → damp (no positive target).
    default:
      return null;
  }
}
