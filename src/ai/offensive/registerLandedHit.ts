/**
 * `registerLandedHit` — controller-side helper for recording a
 * successful hit into the offensive Blackboard partition.
 *
 * The Hard-tier offensive sub-tree (AC 18 Sub-AC 3) recognises a
 * combo by inspecting the Blackboard fields populated *outside* the
 * tick loop, in the controller layer that owns hit-detection. The
 * collision callback that already credits damage and knockback in
 * `combat.ts` is the natural place to also poke the Blackboard with
 * "this attack just landed". Centralising that update through a
 * single function keeps every consumer (recognition leaf, debug
 * HUD, replay assertions) in sync with the same write order.
 *
 * Why a helper instead of a behavior-tree leaf?
 *
 *   • Hit detection is event-driven, not tick-driven. The Matter
 *     collision pair fires the moment the hitbox sensor overlaps the
 *     hurtbox, which is *not* aligned with the AI tick. Modelling it
 *     as a leaf would mean writing a "did I just land a hit?"
 *     polling check, defeating the deterministic event source.
 *
 *   • The helper is pure — it reads the bot-supplied state and writes
 *     into the Blackboard via its existing `set` API. No Phaser or
 *     Matter imports, so the unit tests build a stub Blackboard with
 *     the offensive schema and assert the post-write state.
 *
 *   • Decoupling the writer from the reader is the standard
 *     Blackboard pattern: perception writes, decision reads.
 *
 * Snapshot-friendliness — the function only mutates the four
 * `combo*` fields on the schema, which all hold primitives (string,
 * number, or `null`), so the per-300-frame replay snapshot already
 * captures the post-write state without further plumbing.
 */

import type { IBlackboard } from '../behaviorTree/Blackboard';
import { advanceComboStage } from './comboRecognition';
import type {
  AttackKind,
  OffensiveBlackboardSchema,
} from './types';

/**
 * Arguments for {@link registerLandedHit}. Wrapped in an interface so
 * the call site reads as a "named-parameters" record — there are
 * already four fields and adding more (e.g. `wasGrabReleased`) in a
 * later sub-AC must not become a positional-argument scramble.
 */
export interface RegisterLandedHitInput {
  /** Attack kind the bot just landed. */
  readonly landed: AttackKind;
  /**
   * Tick on which the hit landed. The same fixed-step counter the
   * BehaviorTree threads as `tickIndex`, so chained ticks compare
   * cleanly with `currentTick - lastLandedTick`.
   */
  readonly landedTick: number;
  /**
   * Opponent's damage percent *at the moment of the hit* (i.e.
   * pre-accumulation of the hit's own damage). The recognition
   * policy uses this value to decide between tilt and smash
   * follow-ups; using post-accumulation percent would prematurely
   * push the bot into KO mode after a finisher.
   */
  readonly opponentPercent: number;
}

/**
 * Mutate the offensive Blackboard partition to record that the bot
 * just landed `input.landed` at tick `input.landedTick`. Idempotent
 * with respect to repeated calls on the same tick — the latest call
 * wins, mirroring the gameplay reality that the most recent hit
 * defines the active chain.
 *
 * Writes:
 *
 *   - `comboStage`                   ← {@link advanceComboStage}(landed)
 *   - `comboLastLandedMove`          ← landed
 *   - `comboLastLandedTick`          ← landedTick
 *   - `comboLastLandedOpponentPercent` ← opponentPercent
 *
 * Does NOT touch `comboPlannedFollowUp` — the recognition leaf
 * computes that on the *next* tick using the values written here.
 *
 * Validates `landedTick >= 0` because the schema reserves `-1` for
 * "no hit recorded yet"; passing a negative tick would silently
 * conflict with the `isComboWindowExpired` sentinel logic.
 */
export function registerLandedHit(
  blackboard: IBlackboard<OffensiveBlackboardSchema>,
  input: RegisterLandedHitInput,
): void {
  if (!Number.isInteger(input.landedTick) || input.landedTick < 0) {
    throw new Error(
      `registerLandedHit: landedTick must be a non-negative integer, ` +
        `got ${String(input.landedTick)}`,
    );
  }
  if (!Number.isFinite(input.opponentPercent) || input.opponentPercent < 0) {
    throw new Error(
      `registerLandedHit: opponentPercent must be a non-negative finite ` +
        `number, got ${String(input.opponentPercent)}`,
    );
  }

  blackboard.set('comboStage', advanceComboStage(input.landed));
  blackboard.set('comboLastLandedMove', input.landed);
  blackboard.set('comboLastLandedTick', input.landedTick);
  blackboard.set('comboLastLandedOpponentPercent', input.opponentPercent);
}

/**
 * Reset the offensive Blackboard partition back to the
 * "no chain in flight" state. Used by the controller on KO,
 * stock loss, match restart, or replay scrub-back.
 *
 * Equivalent to seeding the Blackboard with
 * {@link DEFAULT_OFFENSIVE_BLACKBOARD}, but without forcing the
 * caller to know the field names.
 */
export function clearOffensiveCombo(
  blackboard: IBlackboard<OffensiveBlackboardSchema>,
): void {
  blackboard.set('comboStage', 'idle');
  blackboard.set('comboLastLandedMove', null);
  blackboard.set('comboLastLandedTick', -1);
  blackboard.set('comboLastLandedOpponentPercent', 0);
  blackboard.set('comboPlannedFollowUp', null);
}
