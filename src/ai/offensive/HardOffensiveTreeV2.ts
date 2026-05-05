/**
 * HardOffensiveTreeV2 — Sub-AC 5 extension of {@link
 * import('./HardOffensiveTree').buildHardOffensiveTree}. Layers
 * **edge-guarding** and **predictive movement** onto the existing
 * combo-aware offensive Selector.
 *
 * Tree shape
 * ----------
 *
 *   Selector("hardOffensiveV2")
 *     ├── EdgeGuardLeaf                    — pursue off-stage opponents
 *     │
 *     ├── Sequence("comboFollowUp.predictive")
 *     │     ├── PredictiveMoveLeaf         — close to follow-up reach
 *     │     │                                using opponent velocity
 *     │     ├── RecognizeFollowUpLeaf      — stage plan from blackboard
 *     │     └── ExecuteFollowUpLeaf        — press the planned attack
 *     │
 *     ├── Sequence("koSmash.predictive")   — fish for finisher at high %
 *     │     ├── ConditionalNode (KO percent and in-range, gates branch)
 *     │     ├── PredictiveMoveLeaf         — slide into smash reach
 *     │     └── FireAttackLeaf (smash)     — press the smash
 *     │
 *     └── Sequence("neutralJab.predictive") — default chain entry
 *           ├── PredictiveMoveLeaf         — close to jab reach
 *           └── FireAttackLeaf (jab)       — press the jab
 *
 * Why "V2" rather than mutating `buildHardOffensiveTree`?
 * -------------------------------------------------------
 *
 *   1. The original factory is exercised by the existing AC 18
 *      regression tests; mutating it in-place would force every test
 *      to grow a `stage` field they currently don't supply.
 *
 *   2. Edge-guarding and predictive movement *require* the new
 *      optional `OpponentSnapshot.velocity` / `OpponentSnapshot.position`
 *      / `OffensiveContext.stage` fields. A controller that hasn't
 *      been upgraded to populate them should continue to use the
 *      original tree; opting into V2 is an explicit signal that the
 *      perception pipeline is feeding the richer snapshot.
 *
 *   3. Determinism is preserved: the V2 factory is a pure function of
 *      its options just like V1, with no shared mutable state.
 *
 * Reach numbers
 * -------------
 *
 * Inherits the V1 defaults (50 / 60 / 72 px) for the predictive
 * movement sequences. The edge-guard branch uses its own anchor
 * tolerance (default 16 px) — see {@link
 * import('./edgeGuardPolicy').DEFAULT_LEDGE_ANCHOR_TOLERANCE_PX}.
 *
 * Determinism
 * -----------
 *
 * Every leaf and decorator is deterministic on its inputs. The
 * factory itself reads no Rng, no wall-clock — the same options
 * always produce an isomorphic tree, so the replay system can
 * rebuild the controller from a snapshot.
 */

import { SelectorNode, SequenceNode } from '../behaviorTree/composites';
import { ConditionalNode } from '../behaviorTree/decorators';
import type { IBehaviorNode } from '../behaviorTree/Node';

import {
  KO_PERCENT_THRESHOLD,
} from './comboRecognition';
import { EdgeGuardLeaf, type EdgeGuardOptions } from './EdgeGuardLeaf';
import { ExecuteFollowUpLeaf } from './ExecuteFollowUpLeaf';
import { FireAttackLeaf } from './FireAttackLeaf';
import {
  DEFAULT_PREDICTIVE_LOOKAHEAD_FRAMES,
  clampLookaheadFrames,
} from './predictiveMovement';
import { PredictiveMoveLeaf } from './PredictiveMoveLeaf';
import { RecognizeFollowUpLeaf } from './RecognizeFollowUpLeaf';
import type { OffensiveContext } from './types';

/** Construction options for {@link buildHardOffensiveTreeV2}. */
export interface HardOffensiveTreeV2Options {
  /** Reach for the default neutral jab branch. Default 50 px. */
  readonly neutralJabRangePx?: number;
  /** Reach for the KO smash branch. Default 72 px. */
  readonly koSmashRangePx?: number;
  /** Reach for the combo follow-up close-the-gap step. Default 60 px. */
  readonly comboFollowUpRangePx?: number;
  /**
   * Damage % at and above which the KO smash branch unlocks. Default
   * matches {@link KO_PERCENT_THRESHOLD}.
   */
  readonly koPercentThreshold?: number;
  /**
   * How many fixed steps the predictive movement leaves project the
   * opponent's trajectory ahead. Defaults to {@link
   * DEFAULT_PREDICTIVE_LOOKAHEAD_FRAMES}.
   */
  readonly predictiveLookaheadFrames?: number;
  /**
   * Tunables forwarded to the {@link EdgeGuardLeaf}. Optional — the
   * leaf's own defaults cover the M2 stage cast.
   */
  readonly edgeGuard?: EdgeGuardOptions;
}

/**
 * Resolved option set with defaults filled in. Useful for tests that
 * want to assert the actual tunables in play.
 */
export interface ResolvedHardOffensiveTreeV2Options {
  readonly neutralJabRangePx: number;
  readonly koSmashRangePx: number;
  readonly comboFollowUpRangePx: number;
  readonly koPercentThreshold: number;
  readonly predictiveLookaheadFrames: number;
  readonly edgeGuard: EdgeGuardOptions;
}

/** Apply defaults to the user-supplied options. */
export function resolveHardOffensiveTreeV2Options(
  options: HardOffensiveTreeV2Options = {},
): ResolvedHardOffensiveTreeV2Options {
  return {
    neutralJabRangePx: options.neutralJabRangePx ?? 50,
    koSmashRangePx: options.koSmashRangePx ?? 72,
    comboFollowUpRangePx: options.comboFollowUpRangePx ?? 60,
    koPercentThreshold:
      options.koPercentThreshold ?? KO_PERCENT_THRESHOLD,
    predictiveLookaheadFrames: clampLookaheadFrames(
      options.predictiveLookaheadFrames ?? DEFAULT_PREDICTIVE_LOOKAHEAD_FRAMES,
    ),
    edgeGuard: options.edgeGuard ?? {},
  };
}

/**
 * Build the Hard-tier offensive sub-tree V2. Returns the root
 * `IBehaviorNode` so a controller can plug it into a larger tree.
 *
 * Composition convention: this tree should be ticked *after* the
 * Hard recovery sub-tree in the top-level Selector — recovery
 * branches all return `Failure` when the bot is on stage so they
 * never block edge-guarding; when the bot is off-stage they take
 * priority and the offensive branches never fire.
 */
export function buildHardOffensiveTreeV2(
  options: HardOffensiveTreeV2Options = {},
): IBehaviorNode<OffensiveContext> {
  const resolved = resolveHardOffensiveTreeV2Options(options);

  // ---- Edge-guard branch (top priority) -----------------------------------
  // Pursues off-stage opponents and presses the appropriate finisher.
  // Returns Failure when the bot or opponent isn't in an edge-guard
  // configuration so the Selector cleanly falls through to the
  // grounded combo branches.
  const edgeGuard = new EdgeGuardLeaf(resolved.edgeGuard, 'edgeGuard');

  // ---- Combo follow-up branch (predictive movement) -----------------------
  const comboFollowUp = new SequenceNode<OffensiveContext>(
    [
      new PredictiveMoveLeaf(
        {
          preferredRangePx: resolved.comboFollowUpRangePx,
          lookaheadFrames: resolved.predictiveLookaheadFrames,
        },
        'comboFollowUp.predictiveMove',
      ),
      new RecognizeFollowUpLeaf('comboFollowUp.recognize'),
      new ExecuteFollowUpLeaf({}, 'comboFollowUp.execute'),
    ],
    'comboFollowUp.predictive',
  );

  // ---- KO-smash branch (predictive movement) ------------------------------
  const koSmashCore = new SequenceNode<OffensiveContext>(
    [
      new PredictiveMoveLeaf(
        {
          preferredRangePx: resolved.koSmashRangePx,
          lookaheadFrames: resolved.predictiveLookaheadFrames,
        },
        'koSmash.predictiveMove',
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
        return Math.abs(ctx.opponent.distance) <= resolved.koSmashRangePx * 2;
      },
    },
    'koSmash.predictive',
  );

  // ---- Neutral jab branch (predictive movement) ---------------------------
  const neutralJab = new SequenceNode<OffensiveContext>(
    [
      new PredictiveMoveLeaf(
        {
          preferredRangePx: resolved.neutralJabRangePx,
          lookaheadFrames: resolved.predictiveLookaheadFrames,
        },
        'neutralJab.predictiveMove',
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
    'neutralJab.predictive',
  );

  return new SelectorNode<OffensiveContext>(
    [edgeGuard, comboFollowUp, koSmash, neutralJab],
    'hardOffensiveV2',
  );
}
