/**
 * hardCombos — Hard-tier combo execution behaviors authored as
 * behavior-tree subtrees (AC 18 Sub-AC 3).
 *
 * Scope
 * -----
 *
 * This module focuses on the two combat patterns a Hard-tier bot needs
 * to feel "competent":
 *
 *   1. **Hit-confirm follow-ups** — after the bot lands an attack, the
 *      Blackboard records the connecting hit and the next tick the bot
 *      recognises a chain (jab → tilt, jab → smash, tilt → smash) and
 *      presses the planned attack inside its frame window.
 *
 *   2. **Basic punish combos** — opportunistically capitalising on the
 *      opponent's recovery / shield-drop / hitstun / dodge frames. The
 *      bot detects an "opening" state on the opponent's snapshot,
 *      closes the gap, and emits the strongest grounded attack that
 *      will land before the punish window closes.
 *
 * Both patterns ship as standalone subtrees plus a composed Selector
 * that prefers the hit-confirm chain when one is in flight. The
 * subtrees are exported individually so a forthcoming controller can
 * fold them into a larger top-level Selector alongside recovery /
 * defensive branches without duplicating the leaf wiring.
 *
 * Why a separate `behaviors/` directory rather than appending to
 * `offensive/`?
 *
 *   • The `offensive/` module owns the *primitives* (the leaf nodes,
 *     the recognition policy, the Blackboard schema) and a couple of
 *     reference compositions (`HardOffensiveTree`, `HardOffensiveTreeV2`).
 *     This module owns the *named combat patterns* a controller can
 *     plug in without re-deriving the wiring each time.
 *
 *   • Future combat patterns (defensive bait-and-punish, ledge-trap
 *     combos, aerial juggle chains) will be additional files inside
 *     `behaviors/`. Keeping the directory boundary clean now means the
 *     forthcoming sub-ACs do not have to reorganise the tree.
 *
 *   • `offensive/` already has 30+ files; appending more would blur the
 *     "primitives vs. compositions" distinction and make it harder for
 *     reviewers to locate the high-level combo entry points.
 *
 * Tree shape (`buildHardCombosTree`)
 * ----------------------------------
 *
 *   Selector("hardCombos")
 *     ├── Sequence("hardCombos.hitConfirm")
 *     │     ├── ConditionalNode (opponent alive)
 *     │     ├── MoveTowardOpponentLeaf       — close to follow-up reach
 *     │     ├── RecognizeFollowUpLeaf        — stage plan from blackboard
 *     │     └── ExecuteFollowUpLeaf          — press the planned attack
 *     │
 *     └── Sequence("hardCombos.punish")
 *           ├── ConditionalNode (opponent in punishable state)
 *           ├── MoveTowardOpponentLeaf       — close to punish reach
 *           └── FireAttackLeaf (smash|tilt)  — press the punish opener
 *
 * The hit-confirm subtree fires only when an in-flight chain is staged
 * on the Blackboard (the `RecognizeFollowUpLeaf` returns Failure when
 * `comboStage === 'idle'`), so the Selector cleanly falls through to
 * the punish subtree when no chain exists. Combined with the punish
 * gate (`opponent.stateLabel ∈ {recovering, dodging, shielding, hitstun}`)
 * the Selector returns Failure when there's no work to do, allowing an
 * enclosing top-level Selector to consider the neutral / defensive
 * branches instead.
 *
 * Reach numbers
 * -------------
 *
 *   hit-confirm close-the-gap   60 px   — matches `comboFollowUpRangePx`
 *                                          on the existing offensive tree.
 *   punish close-the-gap        70 px   — average of tilt + smash reach
 *                                          so either follow-up press
 *                                          inside the sequence has a
 *                                          chance of connecting.
 *   punish opener (smash)       72 px   — same as koSmashRangePx —
 *                                          the punish branch will fire a
 *                                          smash when the opponent is at
 *                                          KO percent or trapped in a
 *                                          long recovery animation.
 *   punish opener (tilt)        60 px   — fallback when the opponent is
 *                                          below KO percent — tilt out-
 *                                          ranges jab and pre-stages the
 *                                          tilt → smash chain on a hit.
 *
 * Determinism
 * -----------
 *
 * Every leaf, decorator, and conditional used here is deterministic on
 * its inputs. The factory itself reads no Rng, no wall-clock — the
 * same options always produce an isomorphic tree, so the replay system
 * can rebuild the controller from a snapshot.
 *
 * Snapshot-friendliness
 * ---------------------
 *
 * All chain state lives on the existing offensive Blackboard partition
 * (`OffensiveBlackboardSchema`). No new fields are introduced, so the
 * 300-frame replay snapshot already captures the post-combo state
 * without further plumbing.
 */

import { SelectorNode, SequenceNode } from '../behaviorTree/composites';
import { ConditionalNode } from '../behaviorTree/decorators';
import type { IBehaviorNode } from '../behaviorTree/Node';

import { KO_PERCENT_THRESHOLD } from '../offensive/comboRecognition';
import { ExecuteFollowUpLeaf } from '../offensive/ExecuteFollowUpLeaf';
import { FireAttackLeaf } from '../offensive/FireAttackLeaf';
import { MoveTowardOpponentLeaf } from '../offensive/MoveTowardOpponentLeaf';
import { RecognizeFollowUpLeaf } from '../offensive/RecognizeFollowUpLeaf';
import type {
  OffensiveContext,
  OpponentStateLabel,
} from '../offensive/types';

// ---------------------------------------------------------------------------
// Punishable-state set
// ---------------------------------------------------------------------------

/**
 * Opponent state labels that constitute a "punish opening" for the
 * Hard-tier punish-combo branch.
 *
 * Rationale per label:
 *
 *   - `recovering` — the opponent is locked in their own move's
 *      recovery frames; they cannot block, dodge, or counterattack.
 *      The textbook punish window in Smash-style games.
 *   - `dodging`    — the opponent's i-frames have just expired (the
 *      coarse `dodging` label spans the whole dodge animation, but the
 *      reaction-window delay biases the bot's perception toward the
 *      tail end). Pressing into the post-dodge end-lag punishes whiff
 *      dodges.
 *   - `shielding`  — sustained shielding can be punished with a grab
 *      or a tilt that pokes through shield decay; the Hard-tier
 *      controller does not yet model shield grabs (forthcoming
 *      sub-AC), so the punish is a tilt that leaves the bot at an
 *      advantageous spacing.
 *   - `hitstun`    — locked into hurt state from the bot's own (or
 *      another player's) recent hit. Nominally already covered by the
 *      hit-confirm subtree when the *bot* landed it, but the punish
 *      subtree extends the pressure when an opponent's whiffed
 *      exchange leaves them vulnerable to a third party.
 *
 * `attacking` (startup / active frames) is **not** in the set: walking
 * into an active hitbox trades stocks rather than punishing. The
 * defensive sub-tree's shield-threat branch handles that scenario.
 */
export const DEFAULT_PUNISHABLE_STATE_LABELS: ReadonlySet<OpponentStateLabel> =
  Object.freeze(
    new Set<OpponentStateLabel>([
      'recovering',
      'dodging',
      'shielding',
      'hitstun',
    ]),
  ) as ReadonlySet<OpponentStateLabel>;

// ---------------------------------------------------------------------------
// Reach defaults
// ---------------------------------------------------------------------------

/** Default close-the-gap reach for the hit-confirm subtree. Mirrors
 *  the offensive tree's `comboFollowUpRangePx`. */
export const DEFAULT_HIT_CONFIRM_RANGE_PX = 60;

/** Default close-the-gap reach for the punish subtree. Average of
 *  tilt + smash reach so either follow-up press has a chance of
 *  connecting once the bot arrives. */
export const DEFAULT_PUNISH_CLOSE_RANGE_PX = 70;

/** Default reach for the punish smash opener. Mirrors `koSmashRangePx`
 *  on the offensive tree. */
export const DEFAULT_PUNISH_SMASH_RANGE_PX = 72;

/** Default reach for the punish tilt opener. Mirrors `comboFollowUpRangePx`
 *  on the offensive tree. */
export const DEFAULT_PUNISH_TILT_RANGE_PX = 60;

// ---------------------------------------------------------------------------
// Hit-confirm subtree
// ---------------------------------------------------------------------------

/** Construction options for {@link buildHitConfirmComboSubtree}. */
export interface HitConfirmComboOptions {
  /**
   * Reach at which the bot stops closing and lets the execute leaf
   * decide whether to press. Defaults to {@link
   * DEFAULT_HIT_CONFIRM_RANGE_PX}.
   */
  readonly closeRangePx?: number;
}

/**
 * Resolved option set with defaults filled in. Returned by
 * {@link resolveHitConfirmComboOptions} so tests / debug HUDs can
 * inspect the actual tunables in play.
 */
export interface ResolvedHitConfirmComboOptions {
  readonly closeRangePx: number;
}

/** Apply defaults to the user-supplied options. */
export function resolveHitConfirmComboOptions(
  options: HitConfirmComboOptions = {},
): ResolvedHitConfirmComboOptions {
  return {
    closeRangePx: options.closeRangePx ?? DEFAULT_HIT_CONFIRM_RANGE_PX,
  };
}

/**
 * Build the hit-confirm follow-up subtree.
 *
 * Tree shape:
 *
 *   Sequence("hardCombos.hitConfirm")
 *     ├── ConditionalNode (opponent alive)
 *     ├── MoveTowardOpponentLeaf       — close to follow-up reach
 *     ├── RecognizeFollowUpLeaf        — stage plan from blackboard
 *     └── ExecuteFollowUpLeaf          — press the planned attack
 *
 * Behaviour:
 *
 *   - Returns `Failure` when no opponent is alive (Conditional).
 *   - Returns `Failure` when no chain is in flight (the recognise leaf
 *     drops to Failure on `comboStage === 'idle'` or window-expired).
 *   - Returns `Running` while the bot is still closing distance, while
 *     `canAttack` is false, or while the planned attack is out of reach.
 *   - Returns `Success` when the planned follow-up press fires.
 *
 * The subtree intentionally re-uses {@link RecognizeFollowUpLeaf} +
 * {@link ExecuteFollowUpLeaf} from the existing `offensive/` module so
 * the recognition policy and the press gate stay in lockstep with the
 * reference tree. Replacing the recognise leaf with a stub that
 * returns `Failure` would short-circuit this subtree without affecting
 * the rest of the controller.
 */
export function buildHitConfirmComboSubtree(
  options: HitConfirmComboOptions = {},
): IBehaviorNode<OffensiveContext> {
  const resolved = resolveHitConfirmComboOptions(options);

  // Inner Sequence — close, recognise, execute. Wrapped in the
  // Conditional so the entire chain short-circuits cleanly when no
  // opponent is alive (e.g. between stocks).
  const inner = new SequenceNode<OffensiveContext>(
    [
      new MoveTowardOpponentLeaf(
        { preferredRangePx: resolved.closeRangePx },
        'hardCombos.hitConfirm.move',
      ),
      new RecognizeFollowUpLeaf('hardCombos.hitConfirm.recognize'),
      new ExecuteFollowUpLeaf({}, 'hardCombos.hitConfirm.execute'),
    ],
    'hardCombos.hitConfirm.core',
  );

  return new ConditionalNode<OffensiveContext>(
    inner,
    {
      predicate: (ctx) => ctx.opponent !== null,
    },
    'hardCombos.hitConfirm',
  );
}

// ---------------------------------------------------------------------------
// Punish subtree
// ---------------------------------------------------------------------------

/** Construction options for {@link buildPunishComboSubtree}. */
export interface PunishComboOptions {
  /**
   * Set of opponent state labels that count as a punish opening.
   * Defaults to {@link DEFAULT_PUNISHABLE_STATE_LABELS}. Override for
   * difficulty-tier tuning (e.g. the Medium-tier punish branch
   * accepts only `recovering`).
   */
  readonly punishableStates?: ReadonlySet<OpponentStateLabel>;
  /**
   * Reach at which the bot stops closing and lets the opener press
   * decide whether to fire. Defaults to {@link
   * DEFAULT_PUNISH_CLOSE_RANGE_PX}.
   */
  readonly closeRangePx?: number;
  /**
   * Reach for the punish smash opener. Defaults to {@link
   * DEFAULT_PUNISH_SMASH_RANGE_PX}.
   */
  readonly smashRangePx?: number;
  /**
   * Reach for the punish tilt opener. Defaults to {@link
   * DEFAULT_PUNISH_TILT_RANGE_PX}.
   */
  readonly tiltRangePx?: number;
  /**
   * Damage % at and above which the punish branch presses a smash
   * finisher rather than a tilt. Defaults to {@link
   * KO_PERCENT_THRESHOLD} so the policy stays coherent with the rest
   * of the offensive surface.
   */
  readonly koPercentThreshold?: number;
}

/**
 * Resolved option set with defaults filled in.
 */
export interface ResolvedPunishComboOptions {
  readonly punishableStates: ReadonlySet<OpponentStateLabel>;
  readonly closeRangePx: number;
  readonly smashRangePx: number;
  readonly tiltRangePx: number;
  readonly koPercentThreshold: number;
}

/** Apply defaults to the user-supplied options. */
export function resolvePunishComboOptions(
  options: PunishComboOptions = {},
): ResolvedPunishComboOptions {
  return {
    punishableStates:
      options.punishableStates ?? DEFAULT_PUNISHABLE_STATE_LABELS,
    closeRangePx: options.closeRangePx ?? DEFAULT_PUNISH_CLOSE_RANGE_PX,
    smashRangePx: options.smashRangePx ?? DEFAULT_PUNISH_SMASH_RANGE_PX,
    tiltRangePx: options.tiltRangePx ?? DEFAULT_PUNISH_TILT_RANGE_PX,
    koPercentThreshold:
      options.koPercentThreshold ?? KO_PERCENT_THRESHOLD,
  };
}

/**
 * Build the basic-punish combo subtree.
 *
 * Tree shape:
 *
 *   Sequence("hardCombos.punish")
 *     ├── ConditionalNode (opponent alive AND opponent in punish state)
 *     ├── MoveTowardOpponentLeaf       — close to punish reach
 *     └── Selector("hardCombos.punish.opener")
 *           ├── Conditional (KO%) → FireAttackLeaf (smash)
 *           └── FireAttackLeaf (tilt)
 *
 * Behaviour:
 *
 *   - Returns `Failure` when no opponent is alive, or when the
 *     opponent is not in a state belonging to {@link
 *     ResolvedPunishComboOptions.punishableStates}.
 *   - Returns `Running` while the bot is still closing distance.
 *   - Returns `Success` when either the smash or tilt opener fires.
 *
 * The smash opener is gated on the opponent's damage percent so the
 * bot doesn't waste a long-recovery smash on a low-percent target it
 * could keep in stun with a tilt instead. A successful tilt opener
 * registers as `tiltConnected` on the Blackboard via the controller's
 * `registerLandedHit` hook — the next tick the hit-confirm subtree
 * picks up the chain and presses the smash finisher when KO percent
 * is reached, letting the two subtrees compose into a longer
 * punish-then-finish exchange.
 *
 * Combo identifiers
 * -----------------
 *
 *   smash opener fires with `comboStepId: 'punishSmash'`
 *   tilt  opener fires with `comboStepId: 'punishTilt'`
 *
 * These tags surface in replay overlays and in unit-test assertions so
 * a missed punish (no emit, but the gate fired) is distinguishable
 * from a missed neutral entry.
 */
export function buildPunishComboSubtree(
  options: PunishComboOptions = {},
): IBehaviorNode<OffensiveContext> {
  const resolved = resolvePunishComboOptions(options);

  // ---- Punish opener Selector --------------------------------------------
  // Smash branch wrapped in a Conditional so it only fires when the
  // opponent is at KO percent. Tilt branch is the unconditional
  // fallback. FireAttackLeaf already gates on can-attack and reach.
  const smashOpener = new ConditionalNode<OffensiveContext>(
    new FireAttackLeaf(
      {
        attackKind: 'smash',
        maxRangePx: resolved.smashRangePx,
        comboStepId: 'punishSmash',
      },
      'hardCombos.punish.smash.press',
    ),
    {
      predicate: (ctx) => {
        if (ctx.opponent === null) return false;
        return ctx.opponent.damagePercent >= resolved.koPercentThreshold;
      },
    },
    'hardCombos.punish.smash',
  );

  const tiltOpener = new FireAttackLeaf(
    {
      attackKind: 'tilt',
      maxRangePx: resolved.tiltRangePx,
      comboStepId: 'punishTilt',
    },
    'hardCombos.punish.tilt.press',
  );

  const opener = new SelectorNode<OffensiveContext>(
    [smashOpener, tiltOpener],
    'hardCombos.punish.opener',
  );

  // ---- Inner Sequence ----------------------------------------------------
  // Close the gap, then run the opener Selector. The Sequence parks on
  // the movement leaf (Running) until the bot arrives, then ticks the
  // opener.
  const inner = new SequenceNode<OffensiveContext>(
    [
      new MoveTowardOpponentLeaf(
        { preferredRangePx: resolved.closeRangePx },
        'hardCombos.punish.move',
      ),
      opener,
    ],
    'hardCombos.punish.core',
  );

  // ---- Outer guard -------------------------------------------------------
  // Predicate gates the whole subtree on (opponent alive) AND
  // (opponent.stateLabel ∈ punishableStates). The Conditional resets
  // the inner Sequence on guard-flip so a half-closed approach doesn't
  // resume on the next opening.
  return new ConditionalNode<OffensiveContext>(
    inner,
    {
      predicate: (ctx) => {
        const opp = ctx.opponent;
        if (opp === null) return false;
        return resolved.punishableStates.has(opp.stateLabel);
      },
    },
    'hardCombos.punish',
  );
}

// ---------------------------------------------------------------------------
// Composed root
// ---------------------------------------------------------------------------

/** Construction options for {@link buildHardCombosTree}. */
export interface HardCombosTreeOptions {
  /** Per-subtree tunables for the hit-confirm branch. */
  readonly hitConfirm?: HitConfirmComboOptions;
  /** Per-subtree tunables for the punish branch. */
  readonly punish?: PunishComboOptions;
}

/**
 * Resolved option set with defaults filled in.
 */
export interface ResolvedHardCombosTreeOptions {
  readonly hitConfirm: ResolvedHitConfirmComboOptions;
  readonly punish: ResolvedPunishComboOptions;
}

/** Apply defaults to the user-supplied options. */
export function resolveHardCombosTreeOptions(
  options: HardCombosTreeOptions = {},
): ResolvedHardCombosTreeOptions {
  return {
    hitConfirm: resolveHitConfirmComboOptions(options.hitConfirm),
    punish: resolvePunishComboOptions(options.punish),
  };
}

/**
 * Build the composed Hard-tier combo execution tree.
 *
 *   Selector("hardCombos")
 *     ├── hardCombos.hitConfirm subtree   (highest priority)
 *     └── hardCombos.punish subtree       (fallback)
 *
 * Why hit-confirm first?
 *
 *   The hit-confirm subtree only ticks Success when an in-flight
 *   chain is staged on the Blackboard; in any other state it returns
 *   Failure so the Selector falls through to punish. Putting it first
 *   means a recognised chain is never pre-empted by a stray punish
 *   opportunity — dropping the chain to chase a punish would waste
 *   the damage already invested by the prior hit.
 *
 * Composition convention
 * ----------------------
 *
 * This tree is intended to sit *underneath* a top-level Selector that
 * also hosts recovery, defensive, and movement subtrees. When neither
 * combo subtree wants to act this Selector returns `Failure`, allowing
 * the parent to consider the next branch.
 */
export function buildHardCombosTree(
  options: HardCombosTreeOptions = {},
): IBehaviorNode<OffensiveContext> {
  const hitConfirm = buildHitConfirmComboSubtree(options.hitConfirm);
  const punish = buildPunishComboSubtree(options.punish);

  return new SelectorNode<OffensiveContext>(
    [hitConfirm, punish],
    'hardCombos',
  );
}
