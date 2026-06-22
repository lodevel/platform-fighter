/**
 * Ledge-hang state machine — AC 60403 Sub-AC 3.
 *
 * Implements the Smash-style "edge-grab → hang → release / get-up /
 * roll-up" state machine as a pure deterministic module. The runtime
 * `Character` class composes this with {@link detectLedgeGrab} (the
 * geometric ledge-sensor pass) to produce the full edge-grab feature:
 *
 *   1. Each fixed step the runtime computes the geometric detection
 *      (the fighter's body bounding box vs. each ledge corner).
 *   2. The state machine reads the detection result + the player's
 *      input and advances one frame.
 *   3. A `'hanging'` state reads as "fighter is locked to the ledge —
 *      suppress motion / attacks, hold position at the latch point,
 *      grant a fixed-duration invulnerability window."
 *   4. The hang resolves into one of four outcomes the player chooses:
 *        • `getUp`     — climb onto the platform.
 *        • `jump`      — release with an upward jump impulse.
 *        • `attack`    — release with a small ledge-attack.
 *        • `dropDown`  — release with normal physics (let go).
 *   5. After release, the fighter enters a brief `tether` (re-grab
 *      cooldown) lockout — they can't immediately re-latch onto the
 *      same ledge. This is the canonical "tether timing" mechanic
 *      that prevents infinite ledge-stalling.
 *
 * The module is *pure*: every helper is a deterministic function of
 * `(state, input, tuning)`. No `Math.random()`, no wall-clock reads, no
 * Matter / Phaser side effects. Replays drive identical inputs through
 * the helpers and produce identical state trajectories.
 *
 * Tether timing semantics
 * -----------------------
 *
 * The "tether" in ledge-hang context is the *post-release re-grab
 * lockout* (not the up-special tether, which is a separate concept
 * also called "tether" in `upSpecialSchema.ts`). Both ideas share the
 * name because both describe a "you can't endlessly latch onto a
 * ledge" timing: the up-special tether reaches a ledge from a distance,
 * while the ledge-hang tether prevents an infinite hang/release loop
 * by gating consecutive grabs.
 *
 *   • Default `tetherCooldownFrames` = 30 (≈ 0.5 s at 60 Hz).
 *   • While `tetherCooldownRemaining > 0` the runtime ignores positive
 *     ledge detections — the fighter passes through the corner instead
 *     of grabbing.
 *   • The cooldown drains once per fixed step. Reaching 0 reopens the
 *     fighter to ledge grabs.
 *
 * Mirrors the structure of `dodgeState.ts` and `shieldState.ts` — pure
 * frozen state records, a `tickLedgeHang` step function, helpers for
 * the runtime queries, and a `resetLedgeHangState` for respawn / replay-
 * seek flows.
 */

import type { LedgeCandidate } from './ledgeDetection';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Discrete states of the ledge-hang machine.
 *
 *   • `'idle'`     — no hang in flight, no re-grab cooldown active.
 *                    The fighter can edge-grab on the next eligible
 *                    frame.
 *   • `'hanging'`  — fighter is locked to a ledge corner. Movement /
 *                    attacks suppressed. The runtime applies the
 *                    `latch{X,Y}` snap each step. The hang grants a
 *                    fixed-duration invulnerability window
 *                    (`hangIframesRemaining > 0`).
 *   • `'climbing'` — ledge-getup animation playing. Brief lockout where
 *                    the fighter is being lifted onto the platform;
 *                    movement / attacks remain suppressed. Per canonical
 *                    Smash, the climb startup is intangible
 *                    (`getupIframes` frames from frame 0) but the tail of
 *                    the animation is vulnerable — an opponent who reads a
 *                    late get-up can still punish the recovery's back half
 *                    (the canonical "punish a slow getup" outcome).
 *   • `'rolling'`  — ledge-roll animation playing (AC 60404 Sub-AC 4).
 *                    The fighter rolls onto the platform with i-frames
 *                    armed during the roll. Movement / attacks
 *                    suppressed. Distinct from `'climbing'` because the
 *                    roll travels horizontally onto the stage and grants
 *                    invulnerability (canonical Smash ledge-roll).
 *   • `'cooldown'` — post-release tether window. Movement / attacks
 *                    are free again, but a fresh ledge grab is rejected
 *                    until `cooldownRemaining` drains to 0. May also
 *                    carry residual i-frames from the just-released
 *                    `'jump'` or `'attack'` action (AC 60404 Sub-AC 4).
 */
export type LedgeHangStateName =
  | 'idle'
  | 'hanging'
  | 'climbing'
  | 'rolling'
  | 'cooldown';

/**
 * Outcome the player chose to leave the `'hanging'` state. Emitted by
 * {@link tickLedgeHang} via the `release` field on the result so the
 * runtime can apply the appropriate physics impulse / state transition.
 *
 * AC 60404 Sub-AC 4 — every ledge option carries its own recovery
 * frames + i-frame budget (defaults below). The state machine wires the
 * i-frames into `hangIframesRemaining` so the runtime's
 * `isLedgeHangInvincible` check transparently covers all four options.
 *
 *   • `'getUp'`     — climb onto the platform. Transitions
 *                     `'hanging' → 'climbing'`. The runtime translates
 *                     the body up onto the platform top once `'climbing'`
 *                     resolves. Recovery: `climbFrames`. I-frames:
 *                     `getupIframes` (default 12) protect the climb
 *                     STARTUP; the tail is vulnerable (canonical "slow
 *                     getup is punishable").
 *   • `'roll'`      — roll onto the platform (AC 60404 Sub-AC 4).
 *                     Transitions `'hanging' → 'rolling'`. Recovery:
 *                     `rollFrames`. I-frames: `rollIframes` (the
 *                     canonical "evasive roll" — invulnerable mid-roll
 *                     but punishable on landing if telegraphed).
 *   • `'jump'`      — release with an upward jump impulse. The runtime
 *                     sets velocity to `(0, -jumpImpulse)`. Transitions
 *                     `'hanging' → 'cooldown'`. Recovery: 0 (fighter is
 *                     immediately airborne and free). I-frames:
 *                     `jumpIframes` (brief carryover so the jump itself
 *                     can't be intercepted on frame 0).
 *   • `'attack'`    — release with a ledge-attack. The runtime triggers
 *                     the fighter's registered ledge-attack move.
 *                     Transitions `'hanging' → 'cooldown'`. Recovery: 0
 *                     (the attack move's own startup/active/recovery
 *                     drives the lockout). I-frames: `attackIframes`
 *                     (the canonical "ledge-attack startup invuln"
 *                     window).
 *   • `'dropDown'`  — let go and fall. The runtime restores normal
 *                     physics with no impulse. Recovery: 0. I-frames: 0.
 */
export type LedgeReleaseAction =
  | 'getUp'
  | 'roll'
  | 'jump'
  | 'attack'
  | 'dropDown';

/**
 * Live ledge-hang snapshot embedded inside {@link LedgeHangState} when
 * the machine is in `'hanging'` or `'climbing'`. Carries:
 *
 *   • `candidate`: the matched ledge record.
 *   • `latchX` / `latchY`: where the fighter's body centre is locked.
 *   • `framesElapsed`: how long we've been hanging (or climbing) — used
 *     by the runtime to track the hang's invulnerability window draining
 *     and the climb animation timing.
 *   • `facing`: the fighter's facing at the moment of grab. Locked-in
 *     so a player who turns the stick during the hang doesn't visually
 *     flip mid-hang.
 */
export interface ActiveLedgeHang {
  readonly candidate: LedgeCandidate;
  readonly latchX: number;
  readonly latchY: number;
  readonly framesElapsed: number;
  readonly facing: 1 | -1;
}

/**
 * Read-only state record. Carried per-fighter; advanced by
 * {@link tickLedgeHang} once per fixed step.
 *
 *   • `name`: discriminator.
 *   • `active`: snapshot during `'hanging'` / `'climbing'`; null otherwise.
 *   • `hangIframesRemaining`: invulnerability frames left in the
 *     current hang. > 0 only during `'hanging'`. The runtime composes
 *     this with respawn-grace and dodge i-frames via OR.
 *   • `cooldownRemaining`: tether re-grab cooldown frames left. > 0
 *     only during `'cooldown'`.
 */
export interface LedgeHangState {
  readonly name: LedgeHangStateName;
  readonly active: ActiveLedgeHang | null;
  readonly hangIframesRemaining: number;
  readonly cooldownRemaining: number;
  /**
   * SMASH-PARITY (2-frame punish) — frames of *vulnerability* remaining
   * at the START of a fresh hang. While `> 0` the fighter is NOT
   * invincible even though `hangIframesRemaining` is already seeded — the
   * canonical Smash "ledge grab is punishable on frames 1-2" window. The
   * hang's i-frame budget only begins protecting (and draining) once this
   * counter reaches 0. Carried only during `'hanging'`.
   */
  readonly grabVulnerableRemaining: number;
  /**
   * SMASH-PARITY (ledge-stall fix) — number of ledge grabs this fighter
   * has made WITHOUT touching the ground in between. Incremented on every
   * fresh latch; reset to 0 the moment the runtime reports the fighter is
   * grounded (see {@link LedgeHangInput.airborne}). Past
   * `regrabIframeThreshold` the fresh-grab i-frame budget is shortened by
   * `regrabIframePenalty` per extra grab (clamped to 0), so a recovering
   * fighter who repeatedly regrabs the same ledge to stall eventually
   * latches with NO intangibility — closing the classic infinite
   * ledge-stall loop.
   */
  readonly ledgeGrabsSinceGround: number;
}

/**
 * Tunable parameters. All optional with defaults from
 * {@link LEDGE_HANG_DEFAULTS}; per-character roster overrides are
 * reserved for a balance pass.
 */
export interface LedgeHangTuning {
  /**
   * Maximum frames a fighter can hang on a ledge before the game
   * forcibly drops them off. The canonical "ledge-stall protection"
   * timer. Default 360 (≈ 6 s at 60 Hz) — long enough for a deliberate
   * stalling tactic, short enough that "ledge-hog forever" isn't a
   * winning strategy. Set to a non-positive value to disable the auto-
   * drop entirely.
   */
  readonly maxHangFrames?: number;
  /**
   * Frames of invulnerability granted on a fresh ledge grab. The
   * fighter is immune to incoming hits while these tick down — the
   * canonical "ledge-snap i-frame" window that prevents an opponent
   * from spiking a recovering fighter the instant they latch on.
   *
   * Default 24 (≈ 0.4 s at 60 Hz).
   */
  readonly hangIframeFrames?: number;
  /**
   * Frames the climb-up animation takes to play before the runtime
   * translates the body onto the platform. Default 28 (≈ 0.47 s at
   * 60 Hz). The fighter is locked out of input for this whole window
   * but does not have i-frames during the climb (an opponent can
   * intercept the climb-up — the canonical Smash punish).
   */
  readonly climbFrames?: number;
  /**
   * Re-grab cooldown frames after a release. Prevents the infinite
   * hang/release loop. Default 30 (≈ 0.5 s at 60 Hz). Set to 0 to
   * disable the cooldown — a fighter can immediately re-latch.
   */
  readonly tetherCooldownFrames?: number;
  /**
   * Vertical drop distance applied on `'dropDown'` release so the
   * fighter clearly separates from the ledge. Default 20 px (a body's
   * worth of vertical clearance).
   */
  readonly dropDownClearance?: number;
  /**
   * AC 60404 Sub-AC 4 — recovery frames for the ledge-roll option.
   * The fighter is locked out of input while the roll plays. Default 36
   * (≈ 0.6 s at 60 Hz) — a hair longer than getup since the roll travels
   * horizontally and the runtime needs the extra frames to apply the
   * roll's translation. Set to 0 to disable the roll's lockout entirely.
   */
  readonly rollFrames?: number;
  /**
   * AC 60404 Sub-AC 4 — i-frame budget granted during the ledge-roll
   * recovery. Default 24 (≈ 0.4 s at 60 Hz) — covers the roll's
   * traversal phase but ends before the recovery completes, so a
   * roll-into-attack can still be punished. Set to 0 to disable
   * roll i-frames.
   */
  readonly rollIframes?: number;
  /**
   * AC 60404 Sub-AC 4 — i-frame budget granted during the ledge-attack
   * recovery. The attack's own move animation drives the recovery
   * lockout; this carries i-frames into the cooldown phase so the
   * attack's startup can't be cleanly stuffed. Default 16 (≈ 0.27 s at
   * 60 Hz). Set to 0 to disable.
   */
  readonly attackIframes?: number;
  /**
   * AC 60404 Sub-AC 4 — i-frame budget granted during the ledge-jump
   * release. The fighter is immediately airborne, so there is no
   * recovery animation — but a brief invuln window prevents an opponent
   * from spiking the jump on frame 0. Default 8 (≈ 0.13 s at 60 Hz).
   * Set to 0 to disable.
   */
  readonly jumpIframes?: number;
  /**
   * SMASH-PARITY (ledge-getup intangibility) — i-frame budget granted at
   * the START of the ledge-getup climb. Default 12 (≈ 0.2 s at 60 Hz):
   * canonical Smash protects the *startup* of the get-up climb with a
   * short intangibility window, then leaves the tail vulnerable (an
   * opponent who reads a late climb can still punish the recovery's back
   * half). The climbing tick drains this from frame 0, so the protection
   * covers the climb's opening and ends well before `climbFrames`
   * completes. Set to 0 to restore the old "fully vulnerable getup".
   */
  readonly getupIframes?: number;
  /**
   * AC 60404 Sub-AC 4 — horizontal travel distance applied across the
   * ledge-roll recovery, in pixels. The runtime translates the body
   * inward by this amount evenly across `rollFrames`. Default 96 px
   * (~1.5 body widths — far enough to clearly leave the ledge corner).
   */
  readonly rollDistance?: number;
  /**
   * SMASH-PARITY (2-frame punish) — frames of vulnerability at the start
   * of a fresh hang during which the fighter is NOT yet protected by the
   * hang i-frame window. Default 2 — the canonical Smash "ledge grab can
   * be hit on frames 1-2" rule. Set to 0 to grant i-frames from frame 0
   * (the old behaviour).
   */
  readonly grabVulnerableFrames?: number;
  /**
   * SMASH-PARITY (ledge-stall fix) — number of consecutive ledge grabs
   * (without touching the ground in between) the fighter may make at FULL
   * fresh-grab intangibility. Default 2. The first
   * `regrabIframeThreshold` grabs latch with the full `hangIframeFrames`
   * budget; each grab beyond it loses `regrabIframePenalty` i-frames.
   */
  readonly regrabIframeThreshold?: number;
  /**
   * SMASH-PARITY (ledge-stall fix) — i-frames removed from the fresh-grab
   * budget for each regrab beyond `regrabIframeThreshold`, clamped so the
   * budget never goes negative. Default 8 — with the default 24-frame
   * window and threshold 2, grab #3 latches with 16 i-frames, #4 with 8,
   * and #5+ with 0 (no intangibility at all), closing the infinite
   * ledge-stall loop. Set to 0 to disable depletion entirely.
   */
  readonly regrabIframePenalty?: number;
}

/**
 * Fully-defaulted tuning record. Mirrors `Required<LedgeHangTuning>`
 * so call sites that read tuning don't have to optional-chain.
 */
export interface ResolvedLedgeHangTuning {
  readonly maxHangFrames: number;
  readonly hangIframeFrames: number;
  readonly climbFrames: number;
  readonly tetherCooldownFrames: number;
  readonly dropDownClearance: number;
  readonly rollFrames: number;
  readonly rollIframes: number;
  readonly attackIframes: number;
  readonly jumpIframes: number;
  readonly getupIframes: number;
  readonly rollDistance: number;
  readonly grabVulnerableFrames: number;
  readonly regrabIframeThreshold: number;
  readonly regrabIframePenalty: number;
}

/**
 * Per-frame input that drives the state machine. Authored as a flat
 * record so AI predictors / replay re-runners can synthesise these
 * directly without going through the full `Character` controller.
 *
 *   • `detection`: result of the geometric detection pass for THIS
 *     frame (or `null` if no ledge in range). The state machine treats
 *     `null` as "no grab attempt this frame."
 *   • `release`: which release action the player wants. Optional; the
 *     state machine consumes this only while in `'hanging'`. Pass
 *     `null` to keep hanging.
 *   • `forceRelease`: hard-stop signal — set by the runtime when the
 *     fighter takes a hit through the i-frame window or when the
 *     hang's `maxHangFrames` clock runs out. Forces the state machine
 *     out of `'hanging'` immediately, with no release impulse.
 *   • `airborne`: true iff the fighter is currently airborne. The
 *     state machine refuses fresh grabs while grounded — the canonical
 *     "you're already on the ground; you can't grab a ledge from a
 *     standing position" rule.
 */
export interface LedgeHangInput {
  readonly detection: { readonly candidate: LedgeCandidate; readonly latchX: number; readonly latchY: number } | null;
  readonly release: LedgeReleaseAction | null;
  readonly forceRelease?: boolean;
  readonly airborne: boolean;
  readonly facing: 1 | -1;
}

/**
 * Result of one tick. Carries the new state PLUS any release outcome
 * the runtime needs to apply this frame (jump impulse, get-up
 * translation, drop clearance). The `released` field is `null` outside
 * the `'hanging' → ?` transitions.
 */
export interface LedgeHangTickResult {
  readonly state: LedgeHangState;
  readonly released: LedgeReleaseAction | null;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/**
 * Canonical tuning — Smash-ish numbers tuned for the 60 Hz fixed-step
 * engine. Per-character roster overrides land via `LedgeHangTuning` on
 * `CharacterTuning` (a follow-up sub-AC plumbs them through the
 * character class).
 */
export const LEDGE_HANG_DEFAULTS: ResolvedLedgeHangTuning = Object.freeze({
  maxHangFrames: 360,
  hangIframeFrames: 24,
  climbFrames: 28,
  tetherCooldownFrames: 30,
  dropDownClearance: 20,
  // AC 60404 Sub-AC 4 — per-option recovery + i-frame budgets.
  rollFrames: 36,
  rollIframes: 24,
  attackIframes: 16,
  jumpIframes: 8,
  // SMASH-PARITY (ledge-getup intangibility) — protect the climb startup.
  getupIframes: 12,
  rollDistance: 96,
  // SMASH-PARITY (2-frame punish + ledge-stall fix).
  grabVulnerableFrames: 2,
  regrabIframeThreshold: 2,
  regrabIframePenalty: 8,
});

// ---------------------------------------------------------------------------
// Constructors / queries
// ---------------------------------------------------------------------------

/** Initial state for a fresh fighter — idle, no hang in flight. */
export function createLedgeHangState(): LedgeHangState {
  return Object.freeze({
    name: 'idle',
    active: null,
    hangIframesRemaining: 0,
    cooldownRemaining: 0,
    grabVulnerableRemaining: 0,
    ledgeGrabsSinceGround: 0,
  });
}

/**
 * Reset the state to a fresh idle. Used by respawn / replay-seek so a
 * fighter dropped back into the world isn't carrying a stale hang
 * snapshot or re-grab cooldown.
 */
export function resetLedgeHangState(): LedgeHangState {
  return createLedgeHangState();
}

/**
 * Resolve a partial tuning record into a fully-defaulted one. Negative
 * frame counts are clamped to 0 so a tuning typo can't produce an
 * "infinite cooldown" runtime state.
 */
export function resolveLedgeHangTuning(
  overrides?: LedgeHangTuning,
): ResolvedLedgeHangTuning {
  if (!overrides) return LEDGE_HANG_DEFAULTS;
  return Object.freeze({
    maxHangFrames: nonNegativeInt(
      overrides.maxHangFrames,
      LEDGE_HANG_DEFAULTS.maxHangFrames,
    ),
    hangIframeFrames: nonNegativeInt(
      overrides.hangIframeFrames,
      LEDGE_HANG_DEFAULTS.hangIframeFrames,
    ),
    climbFrames: nonNegativeInt(
      overrides.climbFrames,
      LEDGE_HANG_DEFAULTS.climbFrames,
    ),
    tetherCooldownFrames: nonNegativeInt(
      overrides.tetherCooldownFrames,
      LEDGE_HANG_DEFAULTS.tetherCooldownFrames,
    ),
    dropDownClearance: nonNegativeFinite(
      overrides.dropDownClearance,
      LEDGE_HANG_DEFAULTS.dropDownClearance,
    ),
    // AC 60404 Sub-AC 4 — per-option recovery + i-frame budgets.
    rollFrames: nonNegativeInt(
      overrides.rollFrames,
      LEDGE_HANG_DEFAULTS.rollFrames,
    ),
    rollIframes: nonNegativeInt(
      overrides.rollIframes,
      LEDGE_HANG_DEFAULTS.rollIframes,
    ),
    attackIframes: nonNegativeInt(
      overrides.attackIframes,
      LEDGE_HANG_DEFAULTS.attackIframes,
    ),
    jumpIframes: nonNegativeInt(
      overrides.jumpIframes,
      LEDGE_HANG_DEFAULTS.jumpIframes,
    ),
    getupIframes: nonNegativeInt(
      overrides.getupIframes,
      LEDGE_HANG_DEFAULTS.getupIframes,
    ),
    rollDistance: nonNegativeFinite(
      overrides.rollDistance,
      LEDGE_HANG_DEFAULTS.rollDistance,
    ),
    // SMASH-PARITY (2-frame punish + ledge-stall fix).
    grabVulnerableFrames: nonNegativeInt(
      overrides.grabVulnerableFrames,
      LEDGE_HANG_DEFAULTS.grabVulnerableFrames,
    ),
    regrabIframeThreshold: nonNegativeInt(
      overrides.regrabIframeThreshold,
      LEDGE_HANG_DEFAULTS.regrabIframeThreshold,
    ),
    regrabIframePenalty: nonNegativeInt(
      overrides.regrabIframePenalty,
      LEDGE_HANG_DEFAULTS.regrabIframePenalty,
    ),
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

/** True iff the fighter is currently hanging (locked to a ledge corner). */
export function isHangingOnLedge(state: LedgeHangState): boolean {
  return state.name === 'hanging';
}

/** True iff the fighter's get-up climb is playing. */
export function isClimbingFromLedge(state: LedgeHangState): boolean {
  return state.name === 'climbing';
}

/** Per-fighter ledge-occupancy snapshot fed to {@link resolveLedgeTrumps}. */
export interface LedgeTrumpSnapshot {
  /** Stable fighter id (e.g. player index). */
  readonly id: number;
  /** Was this fighter hanging on a ledge LAST frame? */
  readonly wasHanging: boolean;
  /** The ledge key (`platformId:side`) it was on last frame, or null. */
  readonly wasKey: string | null;
  /** Is it hanging NOW? */
  readonly nowHanging: boolean;
  /** The ledge key it is on now, or null. */
  readonly nowKey: string | null;
}

/**
 * Pure ledge-TRUMP resolver (Ultimate ledge-occupancy rule). A fighter that
 * JUST grabbed a ledge this frame (was not hanging, now is) TRUMPS any OTHER
 * fighter who was already hanging on that same ledge last frame and still is —
 * stealing the ledge and knocking the prior occupant off. Returns the ids of
 * the fighters to trump. Deterministic, no side effects. A simultaneous
 * double-grab (neither was the prior occupant) trumps no-one.
 */
export function resolveLedgeTrumps(
  snaps: ReadonlyArray<LedgeTrumpSnapshot>,
): number[] {
  const victims: number[] = [];
  for (const grabber of snaps) {
    // A FRESH grab this frame.
    if (!grabber.nowHanging || grabber.wasHanging || grabber.nowKey === null) {
      continue;
    }
    for (const occ of snaps) {
      if (occ.id === grabber.id) continue;
      // A prior occupant of the SAME ledge, still hanging.
      if (occ.wasHanging && occ.nowHanging && occ.wasKey === grabber.nowKey) {
        victims.push(occ.id);
      }
    }
  }
  return victims;
}

/**
 * AC 60404 Sub-AC 4 — true iff the fighter's ledge-roll recovery is
 * playing. The runtime composes this with `isClimbingFromLedge` to
 * decide which post-release animation to render and whether to apply
 * the roll's horizontal translation.
 */
export function isLedgeRolling(state: LedgeHangState): boolean {
  return state.name === 'rolling';
}

/**
 * True iff the runtime should suppress movement / attack input. The
 * `'hanging'`, `'climbing'`, and `'rolling'` states all lock the player
 * out — the `'cooldown'` state does NOT (movement is free, only fresh
 * ledge grabs are blocked).
 *
 * AC 60404 Sub-AC 4 — `'rolling'` is included so the player can't
 * cancel the roll mid-traversal with attack / movement input.
 */
export function isLedgeLockingInput(state: LedgeHangState): boolean {
  return (
    state.name === 'hanging' ||
    state.name === 'climbing' ||
    state.name === 'rolling'
  );
}

/**
 * Pure cubic smoothstep on the integer-frame recovery ratio. Drives the
 * smooth ledge climb-up / roll-up interpolation that replaces the old
 * freeze-then-teleport. Deterministic: no wall-clock, no randomness, no
 * delta-time — only integer frame counts from the fixed 60Hz step.
 * Clamped to [0,1]; divide-by-zero guarded.
 *
 *   ledgeRecoverySmoothstep(0, 28)  === 0
 *   ledgeRecoverySmoothstep(14, 28) === 0.5
 *   ledgeRecoverySmoothstep(28, 28) === 1
 */
export function ledgeRecoverySmoothstep(
  framesElapsed: number,
  durationFrames: number,
): number {
  if (durationFrames <= 0) {
    return 1;
  }
  const raw = framesElapsed / durationFrames;
  const t = raw < 0 ? 0 : raw > 1 ? 1 : raw;
  return t * t * (3 - 2 * t);
}

/**
 * Single source of truth for the on-platform standing centre a ledge
 * recovery eases toward (and snaps to on completion). `mode` `'climb'`
 * lands inward by half-width; `'roll'` lands further inward by an extra
 * `rollDistance`. `y` seats the body centre half-a-height above the
 * platform-top corner so the feet rest on the stage. Pure arithmetic —
 * replay-safe, no clock/random.
 */
export function computeLedgeStandingTarget(
  cornerX: number,
  cornerY: number,
  side: 'left' | 'right',
  mode: 'climb' | 'roll',
  width: number,
  height: number,
  rollDistance: number,
): { x: number; y: number } {
  const inward = mode === 'roll' ? width / 2 + rollDistance : width / 2;
  const x = side === 'left' ? cornerX + inward : cornerX - inward;
  const y = cornerY - height / 2;
  return { x, y };
}

/**
 * True iff the hang grants i-frame protection this frame. Composed with
 * respawn-grace / dodge i-frames via OR for the single "is this fighter
 * immune?" check. Drains over the hang's `hangIframeFrames` window.
 *
 * SMASH-PARITY (2-frame punish) — the fighter is NOT invincible while the
 * fresh-grab vulnerability window (`grabVulnerableRemaining > 0`) is
 * still open, even though the hang i-frame budget has already been
 * seeded. This is the canonical "ledge grab is punishable on frames 1-2"
 * rule: an opponent who hits inside the window lands a clean hit (the
 * runtime's `applyHit` falls through to the normal-hit / force-release
 * path because this query reads false).
 */
export function isLedgeHangInvincible(state: LedgeHangState): boolean {
  return state.hangIframesRemaining > 0 && state.grabVulnerableRemaining <= 0;
}

/**
 * SMASH-PARITY (2-frame punish) — true iff the fighter is inside the
 * fresh-grab vulnerability window. Exposed so the runtime / tests can
 * assert the "punishable on frames 1-2" window directly. Distinct from
 * {@link isLedgeHangInvincible}, which already factors this in.
 */
export function isLedgeGrabVulnerable(state: LedgeHangState): boolean {
  return state.name === 'hanging' && state.grabVulnerableRemaining > 0;
}

/**
 * True iff the re-grab cooldown is currently locking out fresh ledge
 * grabs. Movement / attacks are unaffected.
 */
export function isLedgeTetherCooldown(state: LedgeHangState): boolean {
  return state.cooldownRemaining > 0;
}

// ---------------------------------------------------------------------------
// Pure step function
// ---------------------------------------------------------------------------

/**
 * Advance the ledge-hang state machine by one fixed step.
 *
 * Order of operations (deterministic):
 *
 *   1. **Force-release** (any state) — if `forceRelease` is set, the
 *      machine drops to `'cooldown'` (with the standard re-grab cooldown
 *      armed) and clears any active hang snapshot. Used by the runtime
 *      when a hit punches through the i-frame window or the
 *      `maxHangFrames` clock expires.
 *
 *   2. **Idle** — if no hang in flight and the cooldown is clear, a
 *      positive detection latches into `'hanging'` (with the hang's
 *      i-frame window armed). A null detection or an active cooldown
 *      keeps the state at idle (or drains the cooldown).
 *
 *   3. **Hanging** — increment `framesElapsed`, drain
 *      `hangIframesRemaining`. If the player chose a release action,
 *      transition out (`getUp` → `'climbing'`, others → `'cooldown'`).
 *      If `framesElapsed >= maxHangFrames`, force-release.
 *
 *   4. **Climbing** — increment `framesElapsed`. When `framesElapsed`
 *      reaches `climbFrames` the climb completes and the machine rolls
 *      to `'cooldown'`.
 *
 *   5. **Cooldown** — drain `cooldownRemaining`. When it hits 0, return
 *      to `'idle'`.
 *
 * The function returns BOTH the new state AND a `released` field
 * carrying any release action that fired this frame (so the runtime
 * can apply the corresponding impulse / animation cue without
 * re-deriving from before/after states).
 */
export function tickLedgeHang(
  state: LedgeHangState,
  input: LedgeHangInput,
  tuning: ResolvedLedgeHangTuning = LEDGE_HANG_DEFAULTS,
): LedgeHangTickResult {
  // ---- 1. Force-release short-circuit -----------------------------------
  if (input.forceRelease) {
    if (
      state.name === 'hanging' ||
      state.name === 'climbing' ||
      // AC 60404 Sub-AC 4 — also drop the ledge-roll recovery on a
      // force-release so a hit punching through the roll's i-frame
      // window still cleanly exits the recovery state.
      state.name === 'rolling'
    ) {
      return {
        state: Object.freeze({
          name: tuning.tetherCooldownFrames > 0 ? 'cooldown' : 'idle',
          active: null,
          hangIframesRemaining: 0,
          cooldownRemaining:
            tuning.tetherCooldownFrames > 0 ? tuning.tetherCooldownFrames : 0,
          grabVulnerableRemaining: 0,
          // Preserve the regrab counter: a force-release (hit / trump /
          // max-hang) is NOT a clean ground-touch, so it must not refresh
          // the depletion. Only landing resets it.
          ledgeGrabsSinceGround: state.ledgeGrabsSinceGround,
        }),
        released: null,
      };
    }
    // Force-release while idle or already cooling down is a no-op.
  }

  // ---- 2. Idle / cooldown branch ----------------------------------------
  if (state.name === 'idle') {
    // SMASH-PARITY (ledge-stall fix) — touching the ground resets the
    // consecutive-regrab counter. The runtime ticks this machine every
    // frame with `airborne: !grounded`, so a grounded idle frame is the
    // canonical "they made it back to the stage" signal that refreshes
    // full fresh-grab intangibility for the next recovery.
    const groundedReset =
      !input.airborne && state.ledgeGrabsSinceGround > 0
        ? 0
        : state.ledgeGrabsSinceGround;

    // Detection produces a fresh grab only if the fighter is airborne
    // (the canonical "you must be in the air to ledge-grab" rule).
    if (input.detection !== null && input.airborne) {
      // SMASH-PARITY (ledge-stall fix) — the first `regrabIframeThreshold`
      // grabs latch with the FULL i-frame budget; each grab beyond it
      // loses `regrabIframePenalty` i-frames (clamped to 0). The counter
      // is `groundedReset` (which is the live count since `airborne` is
      // true here, so no reset happened) so the new grab is grab number
      // `groundedReset + 1`.
      const grabIndex = groundedReset + 1;
      const excessGrabs = Math.max(0, grabIndex - tuning.regrabIframeThreshold);
      const depletedIframes = Math.max(
        0,
        tuning.hangIframeFrames - excessGrabs * tuning.regrabIframePenalty,
      );
      const armed = Object.freeze({
        name: 'hanging' as const,
        active: Object.freeze({
          candidate: input.detection.candidate,
          latchX: input.detection.latchX,
          latchY: input.detection.latchY,
          framesElapsed: 0,
          facing: input.facing,
        }),
        hangIframesRemaining: depletedIframes,
        cooldownRemaining: 0,
        // SMASH-PARITY (2-frame punish) — open the vulnerability window
        // so the hang's i-frames don't protect frames 1-2 of the grab.
        grabVulnerableRemaining: tuning.grabVulnerableFrames,
        ledgeGrabsSinceGround: grabIndex,
      });
      return { state: armed, released: null };
    }
    if (groundedReset !== state.ledgeGrabsSinceGround) {
      return {
        state: Object.freeze({
          name: 'idle',
          active: null,
          hangIframesRemaining: 0,
          cooldownRemaining: 0,
          grabVulnerableRemaining: 0,
          ledgeGrabsSinceGround: groundedReset,
        }),
        released: null,
      };
    }
    return { state, released: null };
  }

  if (state.name === 'cooldown') {
    const next = state.cooldownRemaining - 1;
    // AC 60404 Sub-AC 4 — drain any residual i-frames that the
    // just-released `'jump'` / `'attack'` action seeded into cooldown.
    // The runtime composes `hangIframesRemaining > 0` for the
    // invincibility check, so this transparently grants the per-option
    // i-frame window without a separate state machine branch.
    const nextIframes =
      state.hangIframesRemaining > 0 ? state.hangIframesRemaining - 1 : 0;
    // SMASH-PARITY (ledge-stall fix) — a landing during the cooldown
    // window resets the consecutive-regrab counter (the fighter touched
    // the stage, so the next grab is "fresh" again).
    const grabsSinceGround = input.airborne ? state.ledgeGrabsSinceGround : 0;
    if (next <= 0) {
      // Cooldown ended — return to idle. Any leftover i-frame budget is
      // also cleared (per-option i-frames are capped to fit within the
      // cooldown window by tuning convention).
      return {
        state: Object.freeze({
          name: 'idle',
          active: null,
          hangIframesRemaining: 0,
          cooldownRemaining: 0,
          grabVulnerableRemaining: 0,
          ledgeGrabsSinceGround: grabsSinceGround,
        }),
        released: null,
      };
    }
    return {
      state: Object.freeze({
        name: 'cooldown',
        active: null,
        hangIframesRemaining: nextIframes,
        cooldownRemaining: next,
        grabVulnerableRemaining: 0,
        ledgeGrabsSinceGround: grabsSinceGround,
      }),
      released: null,
    };
  }

  // ---- 3. Hanging --------------------------------------------------------
  if (state.name === 'hanging' && state.active !== null) {
    // Player-initiated release.
    if (input.release !== null) {
      return resolveRelease(state.active, input.release, tuning, state);
    }
    const nextFrames = state.active.framesElapsed + 1;
    // SMASH-PARITY (2-frame punish) — drain the vulnerability window
    // FIRST. The hang's i-frame budget only begins protecting (and
    // draining) once the window has fully closed, so the seeded i-frames
    // are spent on the protected phase rather than burned during the
    // punishable frames 1-2.
    const stillVulnerable = state.grabVulnerableRemaining > 0;
    const nextVulnerable = stillVulnerable
      ? state.grabVulnerableRemaining - 1
      : 0;
    const nextIframes = stillVulnerable
      ? state.hangIframesRemaining
      : state.hangIframesRemaining > 0
        ? state.hangIframesRemaining - 1
        : 0;
    // Auto-drop on max-hang clock expiry — protect against ledge-stall
    // strategies. The runtime treats this exactly like a forceRelease.
    if (tuning.maxHangFrames > 0 && nextFrames >= tuning.maxHangFrames) {
      return {
        state: Object.freeze({
          name: tuning.tetherCooldownFrames > 0 ? 'cooldown' : 'idle',
          active: null,
          hangIframesRemaining: 0,
          cooldownRemaining:
            tuning.tetherCooldownFrames > 0 ? tuning.tetherCooldownFrames : 0,
          grabVulnerableRemaining: 0,
          ledgeGrabsSinceGround: state.ledgeGrabsSinceGround,
        }),
        released: null,
      };
    }
    return {
      state: Object.freeze({
        name: 'hanging',
        active: Object.freeze({
          candidate: state.active.candidate,
          latchX: state.active.latchX,
          latchY: state.active.latchY,
          framesElapsed: nextFrames,
          facing: state.active.facing,
        }),
        hangIframesRemaining: nextIframes,
        cooldownRemaining: 0,
        grabVulnerableRemaining: nextVulnerable,
        ledgeGrabsSinceGround: state.ledgeGrabsSinceGround,
      }),
      released: null,
    };
  }

  // ---- 4. Climbing (ledge-getup recovery) -------------------------------
  if (state.name === 'climbing' && state.active !== null) {
    const nextFrames = state.active.framesElapsed + 1;
    // AC 60404 Sub-AC 4 — drain any getup-iframes (default 0; canonical
    // Smash leaves the slow-getup vulnerable, but a roster override
    // could enable a small protection budget).
    const nextIframes =
      state.hangIframesRemaining > 0 ? state.hangIframesRemaining - 1 : 0;
    if (nextFrames >= tuning.climbFrames) {
      return {
        state: Object.freeze({
          name: tuning.tetherCooldownFrames > 0 ? 'cooldown' : 'idle',
          active: null,
          hangIframesRemaining: 0,
          cooldownRemaining:
            tuning.tetherCooldownFrames > 0 ? tuning.tetherCooldownFrames : 0,
          grabVulnerableRemaining: 0,
          ledgeGrabsSinceGround: state.ledgeGrabsSinceGround,
        }),
        released: null,
      };
    }
    return {
      state: Object.freeze({
        name: 'climbing',
        active: Object.freeze({
          candidate: state.active.candidate,
          latchX: state.active.latchX,
          latchY: state.active.latchY,
          framesElapsed: nextFrames,
          facing: state.active.facing,
        }),
        hangIframesRemaining: nextIframes,
        cooldownRemaining: 0,
        grabVulnerableRemaining: 0,
        ledgeGrabsSinceGround: state.ledgeGrabsSinceGround,
      }),
      released: null,
    };
  }

  // ---- 5. Rolling (ledge-roll recovery, AC 60404 Sub-AC 4) --------------
  // The ledge-roll recovery mirrors `'climbing'` but armed with i-frames
  // (the canonical "evasive roll" behaviour). The runtime reads
  // `state.active.framesElapsed` + `tuning.rollFrames` to drive the
  // horizontal translation across the recovery; this state machine just
  // ticks the timer and drains the i-frame budget.
  if (state.name === 'rolling' && state.active !== null) {
    const nextFrames = state.active.framesElapsed + 1;
    const nextIframes =
      state.hangIframesRemaining > 0 ? state.hangIframesRemaining - 1 : 0;
    if (nextFrames >= tuning.rollFrames) {
      return {
        state: Object.freeze({
          name: tuning.tetherCooldownFrames > 0 ? 'cooldown' : 'idle',
          active: null,
          hangIframesRemaining: 0,
          cooldownRemaining:
            tuning.tetherCooldownFrames > 0 ? tuning.tetherCooldownFrames : 0,
          grabVulnerableRemaining: 0,
          ledgeGrabsSinceGround: state.ledgeGrabsSinceGround,
        }),
        released: null,
      };
    }
    return {
      state: Object.freeze({
        name: 'rolling',
        active: Object.freeze({
          candidate: state.active.candidate,
          latchX: state.active.latchX,
          latchY: state.active.latchY,
          framesElapsed: nextFrames,
          facing: state.active.facing,
        }),
        hangIframesRemaining: nextIframes,
        cooldownRemaining: 0,
        grabVulnerableRemaining: 0,
        ledgeGrabsSinceGround: state.ledgeGrabsSinceGround,
      }),
      released: null,
    };
  }

  // Defensive — unreachable under normal use; identity-return so the
  // runtime's "did anything change?" check still works.
  return { state, released: null };
}

/**
 * Apply a player-chosen release action to an active hang. Pure helper —
 * separated from {@link tickLedgeHang} so the runtime / tests can call
 * it directly without re-feeding the full input record.
 *
 * AC 60404 Sub-AC 4 — each option arms its own i-frame budget on
 * release:
 *
 *   • `'getUp'`    → `'climbing'`  with `getupIframes` (default 0).
 *   • `'roll'`     → `'rolling'`   with `rollIframes`  (default 24).
 *   • `'jump'`     → `'cooldown'`  with `jumpIframes`  (default 8).
 *   • `'attack'`   → `'cooldown'`  with `attackIframes`(default 16).
 *   • `'dropDown'` → `'cooldown'`  with no i-frames    (clean drop).
 */
function resolveRelease(
  active: ActiveLedgeHang,
  action: LedgeReleaseAction,
  tuning: ResolvedLedgeHangTuning,
  prev: LedgeHangState,
): LedgeHangTickResult {
  // SMASH-PARITY (ledge-stall fix) — carry the consecutive-regrab counter
  // through the release: leaving the hang via a player option is NOT a
  // ground touch, so the depletion persists until the fighter actually
  // lands (handled in the idle / cooldown branches).
  const grabsSinceGround = prev.ledgeGrabsSinceGround;
  if (action === 'getUp') {
    // Climb begins on the next tick; we transition the state but do
    // NOT count the current frame against `climbFrames` (the player
    // pressed "get up" THIS frame; the climb animation starts NEXT
    // frame). Setting `framesElapsed = 0` mirrors the active-attack
    // contract for press-frame-zero.
    return {
      state: Object.freeze({
        name: 'climbing',
        active: Object.freeze({
          candidate: active.candidate,
          latchX: active.latchX,
          latchY: active.latchY,
          framesElapsed: 0,
          facing: active.facing,
        }),
        hangIframesRemaining: tuning.getupIframes,
        cooldownRemaining: 0,
        grabVulnerableRemaining: 0,
        ledgeGrabsSinceGround: grabsSinceGround,
      }),
      released: action,
    };
  }
  if (action === 'roll') {
    // AC 60404 Sub-AC 4 — ledge-roll: enter the `'rolling'` recovery
    // state with the canonical "evasive roll" i-frame budget armed.
    return {
      state: Object.freeze({
        name: 'rolling',
        active: Object.freeze({
          candidate: active.candidate,
          latchX: active.latchX,
          latchY: active.latchY,
          framesElapsed: 0,
          facing: active.facing,
        }),
        hangIframesRemaining: tuning.rollIframes,
        cooldownRemaining: 0,
        grabVulnerableRemaining: 0,
        ledgeGrabsSinceGround: grabsSinceGround,
      }),
      released: action,
    };
  }
  // jump / attack / dropDown — leave the hang into the re-grab cooldown
  // window. The runtime applies the per-action physics impulse off the
  // `released` field of the result. AC 60404 Sub-AC 4: jump and attack
  // seed `hangIframesRemaining` with their per-option i-frame budget so
  // the runtime's `isLedgeHangInvincible` query covers the brief
  // post-release invuln window without a separate state branch.
  let releaseIframes = 0;
  if (action === 'jump') releaseIframes = tuning.jumpIframes;
  else if (action === 'attack') releaseIframes = tuning.attackIframes;
  // 'dropDown' has no i-frames — a clean drop is intentionally vulnerable.
  return {
    state: Object.freeze({
      name: tuning.tetherCooldownFrames > 0 ? 'cooldown' : 'idle',
      active: null,
      hangIframesRemaining: releaseIframes,
      cooldownRemaining:
        tuning.tetherCooldownFrames > 0 ? tuning.tetherCooldownFrames : 0,
      grabVulnerableRemaining: 0,
      ledgeGrabsSinceGround: grabsSinceGround,
    }),
    released: action,
  };
}
