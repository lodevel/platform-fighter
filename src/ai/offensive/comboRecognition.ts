/**
 * Combo recognition — pure decision functions used by the Hard-tier
 * offensive sub-tree (AC 18 Sub-AC 3).
 *
 * Why a separate module
 * ---------------------
 * The behavior-tree leaves that *act on* a recognised combo and the
 * controller-level helpers that *register* a landed hit on the
 * Blackboard both share the same recognition policy. Centralising it
 * here keeps the policy in one place — change the combo windows or
 * the KO-percent threshold once and every consumer (recognition
 * leaf, debug HUD, replay assertions) sees the new value.
 *
 * Design choices
 * --------------
 *   1. Pure functions only. No reads from `Math.random()`, no
 *      wall-clock access, no Blackboard mutation. This is the
 *      determinism contract every gameplay-path module follows: same
 *      inputs → byte-identical outputs across the whole replay
 *      pipeline.
 *
 *   2. No side effects on the schema — `recognizeFollowUp` returns
 *      `null` when no chain is available rather than mutating the
 *      Blackboard. The corresponding leaf node is the single place
 *      that writes back into the Blackboard partition, so the data
 *      flow stays one-way (recognition → leaf → blackboard).
 *
 *   3. Frame windows are conservative on purpose. The bot can react
 *      within ~15-20 frames (Hard-tier reaction-window AC), and most
 *      Smash-style chains need to fire within ~12-16 frames after
 *      the previous hit lands. We pick the upper end of those
 *      ranges so the bot rarely tries (and fails) a combo it can't
 *      execute given its own perception latency. Tuning numbers here
 *      is the single source of truth for the chain timings.
 *
 *   4. `KO_PERCENT_THRESHOLD` is the percent at which the bot
 *      switches to a smash finisher. Tuned to match the Cat / Wolf
 *      smash kill-percents from the M2 roster — at 60 % from
 *      centre-stage Cat's `f-smash` already KOs at the blast zone
 *      with our 0.30-scaling formula, and Wolf's smash kills
 *      slightly later but still inside the same general band. A
 *      single threshold keeps the logic simple; per-character
 *      thresholds can layer on top in a later sub-AC without
 *      breaking the recognition surface.
 *
 * Public API
 * ----------
 * Two pure helpers:
 *
 *   - {@link recognizeFollowUp} — given the current combo stage and
 *     opponent percent, return a planned follow-up or `null`.
 *   - {@link advanceComboStage} — given the attack the bot just
 *     successfully landed, return the new {@link ComboStage}.
 *
 * Both are pure data-in / data-out so they unit-test trivially with
 * literal inputs and compose easily into any future controller
 * layer.
 */

import type {
  AttackKind,
  ComboStage,
  PlannedFollowUp,
} from './types';

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/**
 * Damage % at and above which the bot prefers a smash finisher to a
 * tilt continuation. Tuned to the M2 roster's smash kill-percents
 * from centre-stage; see module docstring for rationale.
 */
export const KO_PERCENT_THRESHOLD = 60;

/**
 * Frame budget for the `jab → tilt` follow-up. Tilt's startup is in
 * the 5-7 frame band across the M2 roster; a 12-frame window leaves
 * 5-7 frames of slack for the bot's reaction window plus jab
 * recovery to overlap with the target's hitstun.
 */
export const JAB_TO_TILT_FRAMES = 12;

/**
 * Frame budget for the `jab → smash` follow-up at KO percent. Smash
 * has 8-12 frame startups in the M2 cut; we widen the window by two
 * frames vs. tilt because a missed smash is much more costly (long
 * recovery), so we want to reject the chain rather than fire late.
 */
export const JAB_TO_SMASH_FRAMES = 14;

/**
 * Frame budget for the `tilt → smash` finisher. Tilt produces longer
 * hitstun than jab because of its higher knockback magnitude
 * (HITSTUN_FRAMES_PER_KNOCKBACK_UNIT in `combat.ts`), so the
 * follow-up window is widened to 16 frames to match.
 */
export const TILT_TO_SMASH_FRAMES = 16;

// ---------------------------------------------------------------------------
// recognizeFollowUp
// ---------------------------------------------------------------------------

/**
 * Pure decision function — given the current combo stage and the
 * opponent's percent at the time of the last hit, return the planned
 * follow-up or `null` (no chain available).
 *
 * Flow
 * ----
 *
 *   `idle`            → null (no in-flight chain to extend)
 *   `jabConnected`    → opponent < KO%  → tilt follow-up
 *                     → opponent ≥ KO%  → smash finisher
 *   `tiltConnected`   → opponent ≥ KO%  → smash finisher
 *                     → opponent < KO%  → null (drop chain, return to neutral)
 *
 * The `null` cases on `tiltConnected` are deliberate: after a tilt
 * the bot has already racked decent damage; firing another tilt
 * loops back into the chain table and risks spamming the same
 * exchange. Returning `null` lets the offensive Selector fall back
 * to neutral spacing where the bot picks a fresh entry.
 *
 * @param stage Current combo stage from the Blackboard.
 * @param opponentPercent Damage % the opponent had at the moment of
 *                        the last hit (NOT the live percent — the
 *                        percent is captured at hit-landed time so
 *                        the recognition policy is stable across
 *                        the recognition leaf's reaction-window
 *                        latency).
 *
 * @returns Planned follow-up, or `null` if the chain should drop.
 */
export function recognizeFollowUp(
  stage: ComboStage,
  opponentPercent: number,
): PlannedFollowUp | null {
  if (stage === 'idle') {
    return null;
  }

  if (stage === 'jabConnected') {
    if (opponentPercent >= KO_PERCENT_THRESHOLD) {
      return {
        nextAttack: 'smash',
        maxFollowUpFrames: JAB_TO_SMASH_FRAMES,
        comboStepId: 'jab→smash',
      };
    }
    return {
      nextAttack: 'tilt',
      maxFollowUpFrames: JAB_TO_TILT_FRAMES,
      comboStepId: 'jab→tilt',
    };
  }

  // stage === 'tiltConnected'
  if (opponentPercent >= KO_PERCENT_THRESHOLD) {
    return {
      nextAttack: 'smash',
      maxFollowUpFrames: TILT_TO_SMASH_FRAMES,
      comboStepId: 'tilt→smash',
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// advanceComboStage
// ---------------------------------------------------------------------------

/**
 * Pure transition function — given the attack the bot just *landed*
 * (i.e. the hitbox connected and damage was applied), return the new
 * combo stage. Used by the controller-level "register landed hit"
 * helper to update the Blackboard.
 *
 * Transitions
 * -----------
 *
 *   landed `jab`     → `jabConnected`  (bot may chain into tilt/smash)
 *   landed `tilt`    → `tiltConnected` (bot may chain into smash)
 *   landed `smash`   → `idle`          (smash ends the chain — long recovery)
 *   landed `special` → `idle`          (specials are not chain links in M2)
 *
 * The function does NOT consult the previous stage. A jab that lands
 * during an in-flight `tiltConnected` chain *resets* the stage to
 * `jabConnected` — the most-recent hit is the canonical chain link
 * and the fresh window starts from this hit. This is also the
 * behaviour a human player would expect: "I jabbed them mid-combo,
 * now I get to chain off the jab".
 */
export function advanceComboStage(landed: AttackKind): ComboStage {
  switch (landed) {
    case 'jab':
      return 'jabConnected';
    case 'tilt':
      return 'tiltConnected';
    case 'smash':
    case 'special':
      return 'idle';
  }
}

// ---------------------------------------------------------------------------
// isComboWindowExpired
// ---------------------------------------------------------------------------

/**
 * True iff the follow-up window for the in-flight combo has elapsed.
 *
 *   `currentTick - lastLandedTick > maxFollowUpFrames` → expired.
 *
 * Equality counts as still-valid (the bot can fire on the boundary
 * frame). Pulled into a helper so both the recognition leaf and the
 * controller-side housekeeping use identical comparison semantics —
 * "off by one" mismatches between the two would silently desync
 * replays.
 *
 * Returns `false` when `lastLandedTick < 0` (no chain in flight): a
 * sentinel value of `-1` is reserved by
 * {@link DEFAULT_OFFENSIVE_BLACKBOARD} for the "no hit recorded"
 * state, and we want callers to interpret that as "window not
 * applicable".
 */
export function isComboWindowExpired(
  currentTick: number,
  lastLandedTick: number,
  maxFollowUpFrames: number,
): boolean {
  if (lastLandedTick < 0) {
    return false;
  }
  return currentTick - lastLandedTick > maxFollowUpFrames;
}
