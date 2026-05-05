/**
 * Hurt-state helpers — AC 8 "Hitstun locks hit player in hurt state briefly".
 *
 * The hitstun lockout is the *mechanism* (a frame counter that suppresses
 * input on the underlying `Character`); the "hurt state" is the
 * *observable abstraction* — a discrete classification of the fighter's
 * current action posture used by the HUD ("paint the body red while
 * stunned"), the AI ("don't keep swinging at a hurt fighter, capitalise
 * on the launch instead"), and the replay debug overlay ("frame 412:
 * P2 entered HURT for 18 frames").
 *
 * Why a separate file:
 *
 *   • Pure math / classification — easy to unit-test with no scene
 *     fixtures, no Matter, no Phaser. The classifier is a function of a
 *     `FighterStateSnapshot` shape, so callers compose it with the
 *     entity layer (`fighter.getState()`) or feed it from a replay's
 *     state snapshot during scrub playback without owning a Fighter.
 *   • Determinism gate — like every other primitive in the engine,
 *     `deriveHurtState` is a pure function of its inputs. Identical
 *     snapshots produce identical classifications; the replay system
 *     relies on that property when it cross-references HUD state with
 *     the simulation's runtime state.
 *   • Keeps the AC 8 language concrete — the Seed's "hurt state" maps
 *     to a real, named concept callers can branch on, not just an
 *     implicit `inHitstun: true` flag scattered across consumers.
 *
 * Boundary: this module deliberately does NOT include `'attacking'`,
 * `'invincible'`, or `'eliminated'` as states — those are orthogonal
 * concerns covered by their own ACs (attack state machine, respawn
 * grace, stock loss). The classifier here answers *only* the AC 8
 * question: "is this fighter locked out by hitstun right now?"
 *
 * Determinism note: no `Math.random()`, no wall-clock reads — the
 * function is referentially transparent, so the replay system gets
 * byte-equivalent classifications across runs.
 */

import type { FighterStateSnapshot } from '../entities/Fighter';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Discrete classification of a fighter's hurt-state posture.
 *
 *   • `'neutral'` — fighter is free to act (no active hitstun lockout).
 *     Includes attacking, invincible-on-respawn, mid-jump, etc. — none
 *     of those are "hurt"; they are orthogonal states the AC 8 helper
 *     deliberately does not classify.
 *   • `'hurt'`    — fighter is currently locked out by hitstun. Input
 *     is suppressed, velocity damping is paused, knockback carries.
 */
export type HurtStateName = 'neutral' | 'hurt';

/**
 * Pure descriptor of a fighter's AC 8 hurt-state. Shaped so callers
 * (HUD, AI, replay debug) can render / branch / log without recomputing
 * the classification.
 */
export interface HurtStateInfo {
  /** Discrete state name. */
  readonly name: HurtStateName;
  /**
   * Frames of hitstun remaining at the moment the snapshot was taken.
   * Zero in the neutral state. While `name === 'hurt'` this is always
   * > 0; that invariant is enforced by `deriveHurtState`.
   */
  readonly hitstunRemaining: number;
  /**
   * Boolean shorthand for the common branching case ("paint the
   * fighter red if hurt"). Equivalent to `name === 'hurt'`; carried as
   * a field so consumers don't have to reach for the string compare.
   */
  readonly isHurt: boolean;
}

// ---------------------------------------------------------------------------
// Subset of FighterStateSnapshot we read
// ---------------------------------------------------------------------------

/**
 * Minimum input the classifier needs. Defined as a structural subset of
 * `FighterStateSnapshot` so:
 *
 *   1. The classifier accepts a real `Fighter.getState()` result without
 *      a cast.
 *   2. Tests can build tiny one-field fixtures without populating the
 *      full snapshot shape.
 *   3. Replay-system callers can hand a snapshot reconstructed from
 *      stored frames (which carries the same `inHitstun` field) without
 *      a wrapper layer.
 */
export interface HurtStateSnapshotInput {
  /** True while the fighter is locked out by hitstun. */
  readonly inHitstun: boolean;
}

// ---------------------------------------------------------------------------
// Classifier
// ---------------------------------------------------------------------------

/**
 * Derive the hurt-state classification from a fighter snapshot.
 *
 * AC 8 contract:
 *
 *   • A fighter that has just been hit has `inHitstun: true` (set by
 *     `Character.applyHit` from the realised `KnockbackResult.hitstunFrames`)
 *     → `name: 'hurt'`, `isHurt: true`.
 *   • While in hurt state, the player's input is suppressed (enforced by
 *     `Character.applyInput`). The classifier only reports the state;
 *     the lockout is the runtime layer's job.
 *   • After the hitstun timer drains (one decrement per `applyInput`),
 *     the snapshot reads `inHitstun: false` → `name: 'neutral'`,
 *     `isHurt: false`.
 *
 * Optionally pass `hitstunRemaining` for the field on the result. When
 * the helper is fed a `FighterStateSnapshot` directly the field isn't
 * present, so callers that want the precise frame count can pass it
 * explicitly via the second argument (typically
 * `fighter.getHitstunRemaining()`).
 *
 * Determinism: pure function of inputs.
 */
export function deriveHurtState(
  snapshot: HurtStateSnapshotInput,
  hitstunRemaining = snapshot.inHitstun ? 1 : 0,
): HurtStateInfo {
  // Defensive: if the caller hands `inHitstun: true` but `hitstunRemaining: 0`
  // (shouldn't happen — the snapshot fields move in lockstep), prefer the
  // boolean. Mirrors the underlying Character contract: `isInHitstun()`
  // is `hitstunRemaining > 0`, never the other way around.
  if (snapshot.inHitstun) {
    const remaining = hitstunRemaining > 0 ? hitstunRemaining : 1;
    return { name: 'hurt', hitstunRemaining: remaining, isHurt: true };
  }
  return { name: 'neutral', hitstunRemaining: 0, isHurt: false };
}

/**
 * Convenience overload: classify directly from a full `FighterStateSnapshot`,
 * which carries `inHitstun` but not `hitstunRemaining`. The frame count
 * defaults to 1 frame when hurt (the snapshot doesn't track the timer
 * directly — pull it from `Fighter.getHitstunRemaining()` if you need
 * the precise number).
 */
export function deriveHurtStateFromFighterSnapshot(
  snapshot: FighterStateSnapshot,
  hitstunRemaining?: number,
): HurtStateInfo {
  return deriveHurtState({ inHitstun: snapshot.inHitstun }, hitstunRemaining);
}

/**
 * Boolean shorthand for callers that only need the yes/no question
 * ("is this fighter locked into hurt state right now?"). Reads cleaner
 * at HUD / AI call sites than `deriveHurtState(snap).isHurt`.
 */
export function isInHurtState(snapshot: HurtStateSnapshotInput): boolean {
  return snapshot.inHitstun === true;
}
