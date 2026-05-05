/**
 * Dodge / roll state machine — AC 60302 Sub-AC 2.
 *
 * Implements the Smash-style defensive dodge (a.k.a. *spot dodge* /
 * *air dodge*) and lateral *roll* actions as a pure, deterministic data-
 * and-functions module. It models the three discrete dodge variants
 * called out by the project Seed (`character.moveset.dodge`):
 *
 *   • **spot**     — grounded in-place dodge. Fighter freezes in
 *                    horizontal position and gains a generous i-frame
 *                    window. Short total duration.
 *   • **roll**     — grounded lateral dodge. Fighter slides a fixed
 *                    distance in the rolled direction. Held inputs
 *                    (`dodge` + `moveX !== 0`) trigger this variant.
 *                    Slightly shorter i-frame window than the spot
 *                    dodge because the roll covers ground.
 *   • **air**      — airborne dodge. Fighter freezes in-place mid-air
 *                    (a "stall" dodge) with a tight i-frame window. After
 *                    the dodge resolves the fighter falls into a brief
 *                    landing-lag if they were still airborne.
 *
 * Why a separate file
 * -------------------
 *
 *   • Pure-function, no `Math.random`, no wall-clock — the replay layer
 *     can re-run a recorded match through these helpers and confirm
 *     identical dodge trajectories. Determinism is the M4 hard contract;
 *     this module sits inside it.
 *   • Easy unit tests with no scene fixtures, no Matter, no Phaser. The
 *     state is a tiny readonly record mirroring `shieldState.ts`.
 *   • Mirrors the structure of `shieldState.ts` (AC 60301 Sub-AC 1) and
 *     `hurtState.ts` (AC 8) — the engine pattern is "state machines live
 *     in pure modules; the Character class wires them into the per-frame
 *     tick".
 *
 * Relationship to the existing invincibility timer
 * -------------------------------------------------
 *
 * `Character` already owns a one-scalar `invincibilityRemaining` field
 * used by the respawn-grace flow. The dodge i-frame window is *separate
 * state* — driven by the dodge state machine — but the runtime composes
 * the two with an OR: a fighter is invincible iff respawn grace is
 * active OR the dodge i-frame window is open. This keeps each subsystem
 * self-contained:
 *
 *   • Respawn grace is a wall-clock timer set on stock loss (90 frames
 *     by default). It does NOT lock movement / attacks — the fighter is
 *     just immune to incoming hits.
 *   • Dodge i-frames are scoped inside an `'active' | 'recovery'` dodge
 *     state where MOVEMENT and ATTACKS are also locked out. Releasing
 *     the dodge does not touch respawn grace, and a hit during respawn
 *     grace does not extend the dodge timer.
 *
 * The two timers run independently and the runtime reads
 * `dodgeState.iframesRemaining > 0 || invincibilityRemaining > 0` for a
 * single "is this fighter immune?" check.
 *
 * Boundaries
 * ----------
 *
 * Out of scope for this sub-AC (lands later in M-future passes):
 *   • Tech rolls / get-up rolls (those happen after a hard knockdown
 *     and have their own state machine).
 *   • Perfect-shield → spotdodge cancel timing (a frame-perfect
 *     shield-release into spotdodge has unique i-frame stacking; the
 *     base spotdodge still works the same way as this module models).
 *   • Smash-style "stale dodge" penalty (consecutive dodges shorten the
 *     i-frame window). The schema reserves the field for that pass but
 *     the runtime always reads the full window for now.
 *
 * Determinism note: every state mutation is a pure function of
 * `(state, input, defaults)`. Identical inputs produce identical state
 * trajectories — verified by the unit tests in `dodgeState.test.ts`.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Dodge variant, picked at the press frame from the fighter's grounded
 * state and stick input:
 *
 *   • grounded + |moveX| < threshold → `'spot'` (in-place).
 *   • grounded + |moveX| ≥ threshold → `'roll'` (lateral slide).
 *   • airborne                       → `'air'`.
 *
 * Carried on `ActiveDodge.kind` so the runtime can:
 *   • Apply the correct movement override (zero velocity for spot/air,
 *     directional impulse for roll).
 *   • Read the per-variant i-frame / total-duration tuning.
 *   • Render the right animation / SFX cue (later-AC visual layer).
 */
export type DodgeKind = 'spot' | 'roll' | 'air';

/**
 * Discrete dodge-machine status:
 *
 *   • `'idle'`     — no dodge in progress. Fighter is free to move /
 *                    attack / shield. The press input transitions the
 *                    machine into `'active'` if the cooldown is clear.
 *   • `'active'`   — i-frame window is open. The fighter is immune to
 *                    incoming hits (the runtime reads
 *                    `iframesRemaining > 0` to short-circuit `applyHit`).
 *                    Movement and attacks are suppressed. For roll
 *                    variants, horizontal velocity is forced to the
 *                    roll-slide vector each step.
 *   • `'recovery'` — i-frame window has closed but the dodge action is
 *                    not yet over. The fighter is now vulnerable but
 *                    still cannot attack / move freely. This is the
 *                    "punish window" — a Smash convention where dodging
 *                    too predictably lets the opponent hit the recovery
 *                    tail.
 *   • `'cooldown'` — dodge fully resolved; a brief lockout before
 *                    another dodge can start. Movement / attacks are
 *                    free. The cooldown ticks down once per
 *                    {@link tickDodge} call.
 */
export type DodgeStateName = 'idle' | 'active' | 'recovery' | 'cooldown';

/**
 * Per-variant tuning bundle. All durations are in fixed-step frames
 * (60 Hz canonical). `iframeFrames` is the count of *active* frames
 * during which incoming hits are absorbed — it MUST be `<= activeFrames`
 * (the schema validator clamps it on
 * {@link resolveDodgeTuning}). `slideSpeed` only applies to the roll
 * variant; the spot / air variants ignore it.
 *
 * Sensible defaults (matched to `DODGE_DEFAULTS` below):
 *
 *   variant │ active │ iframes │ recovery │ slide
 *   ────────┼────────┼─────────┼──────────┼──────
 *   spot    │   16   │    14   │    8     │   0
 *   roll    │   20   │    14   │   10     │  10
 *   air     │   24   │    20   │   12     │   0
 *
 * Intuition:
 *   • Spot dodge is the fastest "get out of jail" option but covers
 *     no distance; high i-frame ratio (14/16 ≈ 87%) so the punish
 *     window is tight.
 *   • Roll trades a few i-frames for movement — the fighter slides
 *     (slideSpeed · facing-direction) for each active frame.
 *   • Air dodge is the longest because the fighter loses control of
 *     their fall; the long i-frame window compensates.
 */
export interface DodgeVariantTuning {
  /**
   * Total length of the `'active'` phase in fixed-step frames. The
   * fighter is locked out of movement / attacks for this whole window,
   * but i-frames only open during the first `iframeFrames` of it.
   * Must be a positive integer.
   */
  readonly activeFrames: number;
  /**
   * Number of active-phase frames during which the fighter is immune to
   * incoming hits. Must be a non-negative integer `<= activeFrames`.
   * Authoring this slightly shorter than `activeFrames` produces the
   * canonical "tail-end of the dodge can be hit" punish window.
   */
  readonly iframeFrames: number;
  /**
   * Length of the `'recovery'` phase in fixed-step frames. Movement /
   * attacks remain locked but i-frames are CLOSED — incoming hits land
   * normally. Must be a non-negative integer.
   */
  readonly recoveryFrames: number;
  /**
   * Length of the `'cooldown'` phase in fixed-step frames. Movement /
   * attacks are free again but a fresh dodge press is rejected for
   * this many frames. Must be a non-negative integer.
   */
  readonly cooldownFrames: number;
  /**
   * Per-frame horizontal slide speed during the `'active'` phase of a
   * roll variant. In Matter px-per-step units (matches
   * `CharacterTuning.maxRunSpeed` units). Spot / air variants ignore
   * this field — it only fires when `kind === 'roll'`. Must be a
   * non-negative finite number.
   */
  readonly slideSpeed: number;
}

/**
 * Tunable parameters for the dodge state machine. All fields are
 * optional with reasonable defaults from {@link DODGE_DEFAULTS}; the
 * `Character` layer can override per-character (e.g. a heavyweight Bear
 * could carry a slower / longer-cooldown dodge).
 */
export interface DodgeTuning {
  /** Spot-dodge tuning. Defaults to `DODGE_DEFAULTS.spot`. */
  readonly spot?: Partial<DodgeVariantTuning>;
  /** Roll tuning. Defaults to `DODGE_DEFAULTS.roll`. */
  readonly roll?: Partial<DodgeVariantTuning>;
  /** Air-dodge tuning. Defaults to `DODGE_DEFAULTS.air`. */
  readonly air?: Partial<DodgeVariantTuning>;
  /**
   * Stick-deflection magnitude required for a grounded dodge press to
   * pick the `'roll'` variant rather than `'spot'`. Mirrors the
   * `AERIAL_STICK_THRESHOLD` constant in `Character.ts` so the dodge
   * classifier matches the rest of the engine's dead-zone policy.
   *
   * Default `DODGE_DEFAULTS_STICK_THRESHOLD` (0.3) — same value the
   * aerial-attack classifier uses, so a player who clearly intends "left
   * + dodge" gets a roll while a relaxed thumb on the analog stick
   * resolves cleanly to a spot dodge.
   */
  readonly stickThreshold?: number;
}

/**
 * Fully-defaulted dodge tuning. Shape mirrors `Required<DodgeTuning>`
 * (with the per-variant slots resolved to `DodgeVariantTuning`) so call
 * sites that read tuning don't have to optional-chain.
 */
export interface ResolvedDodgeTuning {
  readonly spot: DodgeVariantTuning;
  readonly roll: DodgeVariantTuning;
  readonly air: DodgeVariantTuning;
  readonly stickThreshold: number;
}

/**
 * Live dodge action snapshot. Embedded inside {@link DodgeState} when
 * `name === 'active' | 'recovery'`. Carries the fields the runtime
 * needs to apply the per-variant motion override (slideSpeed × facing)
 * and to track how far the dodge has progressed without consulting the
 * tuning record on every read.
 */
export interface ActiveDodge {
  /** Which variant this dodge resolved to. Picked at the press frame. */
  readonly kind: DodgeKind;
  /**
   * Locked-in facing at the dodge press. The roll-slide vector is
   * `slideSpeed × facing` regardless of stick deflection during the
   * active window — once a roll starts, the player can't redirect.
   * `1` = right, `-1` = left.
   */
  readonly facing: 1 | -1;
  /**
   * Frames elapsed since the dodge press. Increments by 1 each
   * {@link tickDodge} call. Compared against the variant's
   * `activeFrames` / `iframeFrames` to drive phase transitions.
   */
  readonly framesElapsed: number;
}

/**
 * Read-only dodge state record. Carried per-fighter; advanced by
 * {@link tickDodge} once per fixed step.
 *
 * `iframesRemaining` is the canonical "is this fighter currently
 * immune?" signal. It is `> 0` for exactly the first `iframeFrames` of
 * the `'active'` phase and zero everywhere else — including during
 * `'recovery'` (the punish window). Decoupling i-frames from the phase
 * name lets the runtime compose with `Character.invincibilityRemaining`
 * (respawn grace) via a single OR-check.
 *
 * `cooldownRemaining` is the count of `'cooldown'`-phase frames left.
 * Always 0 outside that phase.
 *
 * `active` carries the live `ActiveDodge` snapshot during `'active'` /
 * `'recovery'` and is `null` during `'idle'` / `'cooldown'` so the
 * runtime can null-check before applying the motion override.
 */
export interface DodgeState {
  readonly name: DodgeStateName;
  readonly active: ActiveDodge | null;
  /**
   * Frames of i-frame protection left in the current dodge. `0` when
   * idle / recovery / cooldown. Decreases by 1 per `tickDodge` call
   * during the active phase until it hits 0, after which the phase
   * rolls into `'recovery'`.
   */
  readonly iframesRemaining: number;
  /**
   * Frames of `'cooldown'`-phase remaining. `0` outside the cooldown
   * phase. Decreases by 1 per `tickDodge` call.
   */
  readonly cooldownRemaining: number;
}

/**
 * Per-frame input that drives the dodge state machine.
 */
export interface DodgeInput {
  /** True iff the dodge button is held this fixed step. */
  readonly held: boolean;
  /**
   * True iff the previous tick's `held` was false. The runtime pre-
   * computes this so the press-edge gate stays consistent with the rest
   * of the input handling (jump / attack / shield are all rising-edge).
   */
  readonly justPressed: boolean;
  /**
   * Horizontal stick value at the press frame. Range `[-1, +1]`. Drives
   * the spot-vs-roll classifier on grounded presses and the locked-in
   * facing of the resulting roll. Ignored on airborne presses (always
   * resolves to `'air'`).
   */
  readonly moveX: number;
  /**
   * True iff the fighter is grounded at the press frame. Drives the
   * spot/roll vs. air classifier.
   */
  readonly grounded: boolean;
  /**
   * Locked-in facing direction the fighter was last input-driven to.
   * Used as the fallback facing for spot / air dodges and for roll
   * dodges where the stick is exactly neutral (a rare keyboard edge
   * case). `1` = right, `-1` = left.
   */
  readonly facing: 1 | -1;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/**
 * Stick-deflection magnitude required for a grounded dodge press to
 * resolve to `'roll'`. Matches the {@link AERIAL_STICK_THRESHOLD} in
 * `Character.ts` so a player whose stick is "barely deflected" gets the
 * intuitive spot-dodge result on any defensive input system.
 */
export const DODGE_DEFAULTS_STICK_THRESHOLD = 0.3;

const SPOT_DEFAULTS: DodgeVariantTuning = Object.freeze({
  activeFrames: 16,
  iframeFrames: 14,
  recoveryFrames: 8,
  cooldownFrames: 14,
  slideSpeed: 0,
});

const ROLL_DEFAULTS: DodgeVariantTuning = Object.freeze({
  activeFrames: 20,
  iframeFrames: 14,
  recoveryFrames: 10,
  cooldownFrames: 18,
  slideSpeed: 10,
});

const AIR_DEFAULTS: DodgeVariantTuning = Object.freeze({
  activeFrames: 24,
  iframeFrames: 20,
  recoveryFrames: 12,
  cooldownFrames: 20,
  slideSpeed: 0,
});

/**
 * Canonical dodge tuning. Numbers chosen to feel Smash-ish:
 *   • Spot dodge is the fastest evasive option but covers no ground;
 *     ~87% of its active phase is i-frames so a clean read still
 *     punishes it.
 *   • Roll covers ~6.7 body-widths of distance during a 20-frame slide
 *     at slideSpeed=10 px/step. The 14-frame i-frame window means the
 *     last 6 frames are hit-able — exactly the "rolled into a smash"
 *     punish window.
 *   • Air dodge has the longest i-frame window (20 frames ≈ 0.33 s) to
 *     compensate for the loss of fall control during the cast.
 */
export const DODGE_DEFAULTS: ResolvedDodgeTuning = Object.freeze({
  spot: SPOT_DEFAULTS,
  roll: ROLL_DEFAULTS,
  air: AIR_DEFAULTS,
  stickThreshold: DODGE_DEFAULTS_STICK_THRESHOLD,
});

// ---------------------------------------------------------------------------
// Constructors / queries
// ---------------------------------------------------------------------------

/** Initial state for a freshly-spawned fighter — idle, no dodge in flight. */
export function createDodgeState(): DodgeState {
  return Object.freeze({
    name: 'idle',
    active: null,
    iframesRemaining: 0,
    cooldownRemaining: 0,
  });
}

/**
 * Resolve a partial tuning record into a fully-defaulted one. Each
 * variant slot is independently resolved so a caller that only wants
 * to bump roll's slideSpeed doesn't have to re-supply spot's frames.
 *
 * Validation:
 *   • Negative values for any frame field are clamped to 0.
 *   • `iframeFrames` is clamped to `[0, activeFrames]` so an authoring
 *     mistake never produces "i-frames extend past the active window"
 *     state at runtime.
 *   • `stickThreshold` is clamped to `[0, 1]` (anything outside that
 *     range collapses to a degenerate classifier).
 */
export function resolveDodgeTuning(overrides?: DodgeTuning): ResolvedDodgeTuning {
  const spot = resolveVariant(SPOT_DEFAULTS, overrides?.spot);
  const roll = resolveVariant(ROLL_DEFAULTS, overrides?.roll);
  const air = resolveVariant(AIR_DEFAULTS, overrides?.air);
  const rawThreshold = overrides?.stickThreshold ?? DODGE_DEFAULTS_STICK_THRESHOLD;
  const stickThreshold = clamp01(rawThreshold);
  return Object.freeze({ spot, roll, air, stickThreshold });
}

function resolveVariant(
  defaults: DodgeVariantTuning,
  overrides: Partial<DodgeVariantTuning> | undefined,
): DodgeVariantTuning {
  if (!overrides) return defaults;
  const activeFrames = nonNegativeInt(overrides.activeFrames, defaults.activeFrames);
  // Clamp i-frames to never exceed the active window — protects the
  // runtime from a tuning typo that would otherwise leave the fighter
  // permanently invincible until the recovery tail finished draining.
  const rawIframes = nonNegativeInt(overrides.iframeFrames, defaults.iframeFrames);
  const iframeFrames = rawIframes > activeFrames ? activeFrames : rawIframes;
  const recoveryFrames = nonNegativeInt(overrides.recoveryFrames, defaults.recoveryFrames);
  const cooldownFrames = nonNegativeInt(overrides.cooldownFrames, defaults.cooldownFrames);
  const slideSpeed = nonNegativeFinite(overrides.slideSpeed, defaults.slideSpeed);
  return Object.freeze({
    activeFrames,
    iframeFrames,
    recoveryFrames,
    cooldownFrames,
    slideSpeed,
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
  if (!Number.isFinite(value)) return DODGE_DEFAULTS_STICK_THRESHOLD;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * True iff the fighter currently has dodge i-frame protection. The
 * runtime composes this with respawn-grace invincibility for the
 * single "is this fighter immune?" check used by `applyHit`.
 */
export function isDodgeInvincible(state: DodgeState): boolean {
  return state.iframesRemaining > 0;
}

/**
 * True iff a dodge action is currently in flight (active + recovery
 * phases). During this window the runtime suppresses movement and
 * attacks regardless of i-frame status.
 */
export function isDodgeActing(state: DodgeState): boolean {
  return state.name === 'active' || state.name === 'recovery';
}

/**
 * True iff the dodge cooldown is currently locking out new presses.
 * Movement / attacks are free during this phase, but a fresh dodge
 * press is dropped.
 */
export function isDodgeOnCooldown(state: DodgeState): boolean {
  return state.name === 'cooldown';
}

/**
 * Pick the dodge variant that a press would resolve to given the
 * fighter's grounded state and stick deflection. Pure helper — used by
 * both {@link tickDodge} and the AI heuristic that wants to predict
 * "what would my next dodge be?" without actually firing it.
 */
export function classifyDodgeKind(
  grounded: boolean,
  moveX: number,
  stickThreshold: number,
): DodgeKind {
  if (!grounded) return 'air';
  return Math.abs(moveX) >= stickThreshold ? 'roll' : 'spot';
}

/**
 * Resolve the locked-in facing for a dodge press. For roll presses with
 * a clearly-deflected stick the facing snaps to the stick's sign; for
 * spot / air dodges (or rolls with a neutral stick) the fighter's
 * existing facing is preserved.
 */
export function classifyDodgeFacing(
  kind: DodgeKind,
  moveX: number,
  facing: 1 | -1,
  stickThreshold: number,
): 1 | -1 {
  if (kind === 'roll' && Math.abs(moveX) >= stickThreshold) {
    return moveX > 0 ? 1 : -1;
  }
  return facing;
}

// ---------------------------------------------------------------------------
// Pure step function
// ---------------------------------------------------------------------------

/**
 * Advance the dodge state machine by one fixed step.
 *
 * Order of operations (deterministic):
 *
 *   1. **Press handling** — if `justPressed` and the machine is in
 *      `'idle'` (no cooldown), classify the variant, snap the facing,
 *      and transition to `'active'` with the variant's
 *      `iframesRemaining` armed. The press-frame counts as elapsed
 *      frame `0` of the active window.
 *
 *   2. **Active tick** — if currently `'active'`:
 *        - Increment `framesElapsed`.
 *        - Decrement `iframesRemaining` (clamped at 0).
 *        - If `framesElapsed >= activeFrames` → roll into `'recovery'`
 *          (or `'cooldown'` if `recoveryFrames === 0`).
 *
 *   3. **Recovery tick** — if currently `'recovery'`:
 *        - Increment `framesElapsed`.
 *        - When `framesElapsed >= activeFrames + recoveryFrames` →
 *          roll into `'cooldown'` (or `'idle'` if `cooldownFrames === 0`).
 *
 *   4. **Cooldown tick** — if currently `'cooldown'`:
 *        - Decrement `cooldownRemaining`. When it reaches 0 → `'idle'`.
 *
 * Press handling runs FIRST so a press on a frame the cooldown drains
 * to zero (the same call) is rejected — the cooldown only opens on the
 * NEXT call. This matches the platform-fighter convention "you can't
 * spam dodge instantly" and keeps the cooldown lockout meaningful.
 */
export function tickDodge(
  state: DodgeState,
  input: DodgeInput,
  tuning: ResolvedDodgeTuning = DODGE_DEFAULTS,
): DodgeState {
  // ---- 1. Press handling -------------------------------------------------
  // A fresh press fires only if the machine is idle. Active / recovery /
  // cooldown all reject presses — the dodge has to fully resolve before
  // another can start.
  if (input.justPressed && input.held && state.name === 'idle') {
    const kind = classifyDodgeKind(input.grounded, input.moveX, tuning.stickThreshold);
    const facing = classifyDodgeFacing(kind, input.moveX, input.facing, tuning.stickThreshold);
    const variant = pickVariant(kind, tuning);
    // Edge case: a fully zeroed-out variant (activeFrames === 0) skips
    // straight to cooldown. Authoring mistake, but we handle it cleanly.
    if (variant.activeFrames <= 0) {
      return rollIntoCooldownOrIdle(variant);
    }
    return Object.freeze({
      name: 'active',
      active: Object.freeze({ kind, facing, framesElapsed: 0 }),
      iframesRemaining: variant.iframeFrames,
      cooldownRemaining: 0,
    });
  }

  // ---- 2. Active tick ----------------------------------------------------
  if (state.name === 'active' && state.active !== null) {
    const variant = pickVariant(state.active.kind, tuning);
    const nextFrames = state.active.framesElapsed + 1;
    const nextIframes = state.iframesRemaining > 0 ? state.iframesRemaining - 1 : 0;

    if (nextFrames >= variant.activeFrames) {
      // Active window has drained — transition to recovery (or skip
      // straight to cooldown / idle if recoveryFrames is zero).
      if (variant.recoveryFrames <= 0) {
        return rollIntoCooldownOrIdle(variant, state.active);
      }
      return Object.freeze({
        name: 'recovery',
        active: Object.freeze({
          kind: state.active.kind,
          facing: state.active.facing,
          framesElapsed: nextFrames,
        }),
        // i-frames are forced to 0 the moment we leave the active phase
        // even if the variant authored iframeFrames === activeFrames —
        // recovery is by definition the punish window.
        iframesRemaining: 0,
        cooldownRemaining: 0,
      });
    }
    return Object.freeze({
      name: 'active',
      active: Object.freeze({
        kind: state.active.kind,
        facing: state.active.facing,
        framesElapsed: nextFrames,
      }),
      iframesRemaining: nextIframes,
      cooldownRemaining: 0,
    });
  }

  // ---- 3. Recovery tick --------------------------------------------------
  if (state.name === 'recovery' && state.active !== null) {
    const variant = pickVariant(state.active.kind, tuning);
    const nextFrames = state.active.framesElapsed + 1;
    if (nextFrames >= variant.activeFrames + variant.recoveryFrames) {
      return rollIntoCooldownOrIdle(variant, state.active);
    }
    return Object.freeze({
      name: 'recovery',
      active: Object.freeze({
        kind: state.active.kind,
        facing: state.active.facing,
        framesElapsed: nextFrames,
      }),
      iframesRemaining: 0,
      cooldownRemaining: 0,
    });
  }

  // ---- 4. Cooldown tick --------------------------------------------------
  if (state.name === 'cooldown') {
    const next = state.cooldownRemaining - 1;
    if (next <= 0) {
      return Object.freeze({
        name: 'idle',
        active: null,
        iframesRemaining: 0,
        cooldownRemaining: 0,
      });
    }
    return Object.freeze({
      name: 'cooldown',
      active: null,
      iframesRemaining: 0,
      cooldownRemaining: next,
    });
  }

  // ---- Idle / no-op ------------------------------------------------------
  // Nothing to do — return the same state. Identity-equality is a
  // valuable signal for the runtime's "did anything change?" check, so
  // we deliberately return `state` rather than a fresh frozen record.
  return state;
}

/**
 * Reset the dodge state to a fresh idle. Used by respawn / replay-seek
 * flows so a fighter dropped back into the world isn't carrying a
 * stale dodge phase from before the seek.
 */
export function resetDodgeState(): DodgeState {
  return createDodgeState();
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function pickVariant(kind: DodgeKind, tuning: ResolvedDodgeTuning): DodgeVariantTuning {
  if (kind === 'spot') return tuning.spot;
  if (kind === 'roll') return tuning.roll;
  return tuning.air;
}

/**
 * Transition out of the active / recovery phases. If the variant
 * authored a positive cooldown, enter the `'cooldown'` state with the
 * counter primed; otherwise jump straight back to idle.
 */
function rollIntoCooldownOrIdle(
  variant: DodgeVariantTuning,
  /* istanbul ignore next */
  _active?: ActiveDodge,
): DodgeState {
  if (variant.cooldownFrames <= 0) {
    return Object.freeze({
      name: 'idle',
      active: null,
      iframesRemaining: 0,
      cooldownRemaining: 0,
    });
  }
  return Object.freeze({
    name: 'cooldown',
    active: null,
    iframesRemaining: 0,
    cooldownRemaining: variant.cooldownFrames,
  });
}

/**
 * Pull the slide-speed override the runtime should apply this frame.
 * Returns the signed horizontal velocity (slideSpeed × facing) when
 * the fighter is mid-roll-active; returns `null` for every other case
 * so the runtime can leave its own velocity intact.
 *
 * Why a separate function: the runtime composes dodge state with shield
 * / hitstun / movement; centralising the "should I override velocity?"
 * decision keeps the call site's branching tree shallow.
 */
export function getDodgeSlideVelocity(
  state: DodgeState,
  tuning: ResolvedDodgeTuning = DODGE_DEFAULTS,
): number | null {
  if (state.name !== 'active' || state.active === null) return null;
  if (state.active.kind !== 'roll') return null;
  const variant = pickVariant(state.active.kind, tuning);
  if (variant.slideSpeed <= 0) return null;
  return variant.slideSpeed * state.active.facing;
}

/**
 * True iff the dodge state machine is currently locking out movement /
 * attacks. The runtime suppresses horizontal-input acceleration, jump
 * presses, and attack presses for any frame this returns `true`.
 *
 * Mirrors `isShieldRaised`'s role for the shield system: a single
 * boolean that tells the controller "ignore directional / action input
 * this frame".
 */
export function isDodgeLockingInput(state: DodgeState): boolean {
  return isDodgeActing(state);
}
