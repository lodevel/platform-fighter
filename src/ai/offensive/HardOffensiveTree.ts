/**
 * HardOffensiveTree — composes the leaf nodes from this module into
 * the Hard-tier offensive sub-tree authored for AC 18 Sub-AC 3.
 *
 * Tree shape
 * ----------
 *
 *   Selector("hardOffensive")
 *     ├── Sequence("comboFollowUp")          — chain off the prior hit
 *     │     ├── MoveTowardOpponentLeaf       — close to follow-up reach
 *     │     ├── RecognizeFollowUpLeaf        — stage plan from blackboard
 *     │     └── ExecuteFollowUpLeaf          — press the planned attack
 *     │
 *     ├── Sequence("koSmash")                — fish for a finisher at high %
 *     │     ├── ConditionalNode (KO percent and in-range, gates branch)
 *     │     ├── MoveTowardOpponentLeaf       — slide into smash reach
 *     │     └── FireAttackLeaf (smash)       — press the smash
 *     │
 *     └── Sequence("neutralJab")             — default chain entry
 *           ├── MoveTowardOpponentLeaf       — close to jab reach
 *           └── FireAttackLeaf (jab)         — press the jab
 *
 * Why this shape
 * --------------
 *
 *   1. The Selector ticks branches in priority order and returns the
 *      first non-Failure status. Combo follow-up sits *first* because
 *      a recognised chain is the highest-value action available on
 *      the tick — dropping it back to neutral would waste damage the
 *      bot has already invested.
 *
 *   2. A "fish for KO smash at high %" branch sits second so the bot
 *      will reliably smash an already-staggered opponent rather than
 *      jab-loop them past 100 %. The conditional decorator keeps the
 *      branch dormant in normal exchanges and only opens it up when
 *      the opponent is at KO percent and within smash reach.
 *
 *   3. The neutral-jab branch is the fallback: close to jab range
 *      and press jab. Jab is the safest opener — fast startup, low
 *      cooldown, and (per `advanceComboStage`) a successful jab
 *      transitions the Blackboard into `'jabConnected'` so the
 *      *next* tick will pick the combo branch instead.
 *
 * Reach numbers
 * -------------
 *
 * The default per-step reaches are pulled from the M2 roster's
 * hitbox geometry plus a small slack buffer. They mirror
 * {@link DEFAULT_FOLLOW_UP_RANGE_PX} so the recognition policy and
 * the press leaves stay in sync.
 *
 *   neutral jab        50 px   — matches `jab` slot of the default map
 *   ko smash           72 px   — matches `smash` slot
 *   combo close (jab)  60 px   — pre-position for tilt or smash
 *                                 follow-up; tilt reach is the median
 *                                 so we use that.
 *
 * Tunables can be passed via {@link HardOffensiveTreeOptions} so the
 * forthcoming controller layer can swap per-character reach without
 * forking the tree shape.
 *
 * Determinism
 * -----------
 *
 * Every leaf and decorator used here is deterministic on its inputs.
 * The factory itself reads no Rng, no wall-clock — `buildHardOffensiveTree`
 * always returns an isomorphic tree given the same options, so the
 * replay system can rebuild the controller from a snapshot by
 * calling the factory and replaying the recorded inputs.
 */

import { SelectorNode, SequenceNode } from '../behaviorTree/composites';
import { ConditionalNode } from '../behaviorTree/decorators';
import type { IBehaviorNode } from '../behaviorTree/Node';

import { ExecuteFollowUpLeaf } from './ExecuteFollowUpLeaf';
import { FireAttackLeaf } from './FireAttackLeaf';
import { MoveTowardOpponentLeaf } from './MoveTowardOpponentLeaf';
import { RecognizeFollowUpLeaf } from './RecognizeFollowUpLeaf';
import {
  KO_PERCENT_THRESHOLD,
} from './comboRecognition';
import type { OffensiveContext } from './types';

/** Construction options for {@link buildHardOffensiveTree}. */
export interface HardOffensiveTreeOptions {
  /** Reach for the default neutral jab branch. Default 50 px. */
  readonly neutralJabRangePx?: number;
  /** Reach for the KO smash branch. Default 72 px. */
  readonly koSmashRangePx?: number;
  /** Reach for the combo follow-up close-the-gap step. Default 60 px. */
  readonly comboFollowUpRangePx?: number;
  /**
   * Damage % at and above which the KO smash branch unlocks. Default
   * matches {@link KO_PERCENT_THRESHOLD} so recognition and the
   * smash branch agree on the KO band.
   */
  readonly koPercentThreshold?: number;
}

/**
 * Resolved option set with defaults filled in. Useful for tests that
 * want to assert the actual tunables in play.
 */
export interface ResolvedHardOffensiveTreeOptions {
  readonly neutralJabRangePx: number;
  readonly koSmashRangePx: number;
  readonly comboFollowUpRangePx: number;
  readonly koPercentThreshold: number;
}

/** Apply defaults to the user-supplied options. */
export function resolveHardOffensiveTreeOptions(
  options: HardOffensiveTreeOptions = {},
): ResolvedHardOffensiveTreeOptions {
  return {
    neutralJabRangePx: options.neutralJabRangePx ?? 50,
    koSmashRangePx: options.koSmashRangePx ?? 72,
    comboFollowUpRangePx: options.comboFollowUpRangePx ?? 60,
    koPercentThreshold:
      options.koPercentThreshold ?? KO_PERCENT_THRESHOLD,
  };
}

/**
 * Build the Hard-tier offensive sub-tree. Returns the root
 * `IBehaviorNode` so a controller can plug it into a larger tree
 * (e.g. as a child of a top-level Selector that sits alongside
 * defensive / recovery branches).
 */
export function buildHardOffensiveTree(
  options: HardOffensiveTreeOptions = {},
): IBehaviorNode<OffensiveContext> {
  const resolved = resolveHardOffensiveTreeOptions(options);

  // ---- Combo follow-up branch ---------------------------------------------
  // Closes to combo range, recognises the planned next attack, then
  // executes it. The execute leaf consumes the plan and presses the
  // planned attack with the right reach gating.
  const comboFollowUp = new SequenceNode<OffensiveContext>(
    [
      new MoveTowardOpponentLeaf(
        { preferredRangePx: resolved.comboFollowUpRangePx },
        'comboFollowUp.move',
      ),
      new RecognizeFollowUpLeaf('comboFollowUp.recognize'),
      new ExecuteFollowUpLeaf({}, 'comboFollowUp.execute'),
    ],
    'comboFollowUp',
  );

  // ---- KO-smash branch ----------------------------------------------------
  // Conditional gate: opponent at KO percent AND within smash reach.
  // Inside the gate we still re-run a movement leaf so the bot can
  // shimmy in tightly; the FireAttackLeaf has its own reach gate to
  // avoid pressing whiff smash if the opponent dashes back.
  const koSmashCore = new SequenceNode<OffensiveContext>(
    [
      new MoveTowardOpponentLeaf(
        { preferredRangePx: resolved.koSmashRangePx },
        'koSmash.move',
      ),
      new FireAttackLeaf(
        {
          attackKind: 'smash',
          maxRangePx: resolved.koSmashRangePx,
          comboStepId: 'koFinisher',
        },
        'koSmash.press',
      ),
    ],
    'koSmash.core',
  );

  const koSmash = new ConditionalNode<OffensiveContext>(
    koSmashCore,
    {
      predicate: (ctx) => {
        if (ctx.opponent === null) return false;
        if (ctx.opponent.damagePercent < resolved.koPercentThreshold) {
          return false;
        }
        // Pre-filter the smash branch to opponents that are
        // *catchable* — within ~2× smash reach. Beyond that, the
        // bot is committing a long approach to a smash whiff; the
        // jab branch's gentler approach is safer.
        return Math.abs(ctx.opponent.distance) <= resolved.koSmashRangePx * 2;
      },
    },
    'koSmash',
  );

  // ---- Neutral jab branch -------------------------------------------------
  // Default: close to jab range and press jab. A landed jab will
  // transition `comboStage` to `jabConnected` (via the controller's
  // registerLandedHit), so the *next* tick the Selector will pick
  // the combo follow-up branch and chain into tilt or smash.
  const neutralJab = new SequenceNode<OffensiveContext>(
    [
      new MoveTowardOpponentLeaf(
        { preferredRangePx: resolved.neutralJabRangePx },
        'neutralJab.move',
      ),
      new FireAttackLeaf(
        {
          attackKind: 'jab',
          maxRangePx: resolved.neutralJabRangePx,
          comboStepId: 'neutral',
        },
        'neutralJab.press',
      ),
    ],
    'neutralJab',
  );

  return new SelectorNode<OffensiveContext>(
    [comboFollowUp, koSmash, neutralJab],
    'hardOffensive',
  );
}
