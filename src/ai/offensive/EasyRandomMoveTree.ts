/**
 * EasyRandomMoveTree — Easy-tier behavior tree for AC 10202 Sub-AC 2.
 *
 * The Easy tier is the AC's "noticeably weaker but believably so"
 * opponent. The Sub-AC enumerates *three* required pieces:
 *
 *   1. **Slow reaction times** — wired at the controller layer via the
 *      {@link REACTION_WINDOW_PRESETS.easy} 28-36 frame band.
 *      Re-exported here as {@link EASY_REACTION_WINDOW_RANGE} so
 *      consumers wiring this tree alongside a {@link
 *      import('../perception/ReactionWindow').ReactionWindow} import
 *      both pieces from one place.
 *
 *   2. **Basic movement toward opponent** — composed from the same
 *      {@link MoveTowardOpponentLeaf} every tier uses, so the Easy
 *      tier's gap-close behaviour stays consistent with the rest of
 *      the AI codebase.
 *
 *   3. **Random move selection with long cooldowns** — the
 *      distinguishing piece. Authored as {@link RandomMoveSelectLeaf}
 *      and wired directly into the offensive sequence.
 *
 * The companion {@link buildEasyOffensiveTree} (AC 10203 Sub-AC 3)
 * builds a *jab-only* Easy tree. This module's tree is the broader
 * AC 10202 implementation: a random pool plus long cooldown. The two
 * coexist because the AC ladder gives the Easy tier two
 * complementary slants — the jab-only tree is the "novice mashes one
 * button" model, the random-move tree is the "novice picks anything
 * and waits forever" model. A controller can pick whichever
 * personality fits the slot.
 *
 * Tree shape
 * ----------
 *
 *   Selector("easyRandom")
 *     ├── IdleChanceLeaf                  — frequent hesitation
 *     └── Sequence("easyRandom.attack")   — close + random press
 *           ├── MoveTowardOpponentLeaf    — walk toward opponent
 *           └── RandomMoveSelectLeaf      — random press w/ cooldown
 *
 * Why this shape
 * --------------
 *
 *   1. The Selector ticks branches in priority order and short-circuits
 *      on the first non-Failure. With idle returning Success on a
 *      successful roll, that beat dominates — the rest of the tree is
 *      skipped and the bot stands still. Same rationale as
 *      {@link buildEasyOffensiveTree}.
 *
 *   2. When idle fails through, the random-attack sequence runs.
 *      MoveTowardOpponent drives the bot into reach, then
 *      RandomMoveSelectLeaf picks one of the four grounded attacks at
 *      random. The leaf's internal cooldown gate keeps re-presses
 *      slow even when the bot is parked in range — exactly the AC's
 *      "long cooldowns" feel.
 *
 *   3. RandomMoveSelectLeaf naturally returns Failure while its
 *      cooldown is active, so a parked-in-range bot mid-cooldown
 *      simply emits a movement intent (from MoveTowardOpponent) but
 *      no attack. That reads in-game as "the novice is standing next
 *      to the opponent doing nothing yet" — perfect for the tier.
 *
 * Determinism
 * -----------
 *
 *   • IdleChanceLeaf consumes one RNG value per tick for stable
 *     replay-friendly RNG consumption (see its module docs).
 *   • RandomMoveSelectLeaf consumes one RNG value per *successful
 *     press* (zero RNG when any gate fails). The two leaves operate
 *     on the same RNG handle but at different cadences, so the
 *     overall consumption is a deterministic function of the tick
 *     stream + opponent snapshots.
 *   • The factory itself reads no Rng / no wall-clock — the same
 *     options always produce an isomorphic tree.
 */

import { SelectorNode, SequenceNode } from '../behaviorTree/composites';
import type { IBehaviorNode } from '../behaviorTree/Node';

import { IdleChanceLeaf, DEFAULT_EASY_IDLE_CHANCE } from './IdleChanceLeaf';
import { MoveTowardOpponentLeaf } from './MoveTowardOpponentLeaf';
import {
  DEFAULT_RANDOM_MOVE_COOLDOWN_FRAMES,
  DEFAULT_RANDOM_MOVE_POOL,
  DEFAULT_RANDOM_MOVE_RANGE_PX,
  RandomMoveSelectLeaf,
} from './RandomMoveSelectLeaf';
import type { AttackKind, OffensiveContext } from './types';

import { REACTION_WINDOW_PRESETS } from '../perception/reactionWindowPresets';
import type { ReactionWindowRange } from '../perception/ReactionWindow';

/**
 * Re-export of the Easy tier's reaction-window range from the central
 * preset table. Surfaced from this module so a controller wiring
 * `buildEasyRandomMoveTree` together with a {@link
 * import('../perception/ReactionWindow').ReactionWindow} imports both
 * pieces from one place.
 *
 * Mirrors {@link REACTION_WINDOW_PRESETS.easy} — 28-36 frames. If the
 * preset table is ever retuned, this re-export tracks it automatically
 * (the underlying object is deep-frozen).
 *
 * The constant is intentionally identical to the one re-exported from
 * `EasyOffensiveTree` so both Easy variants observe the same slow
 * reaction band; the Easy tier's "feel" is consistent regardless of
 * which sub-tree the controller picks.
 */
export const EASY_RANDOM_REACTION_WINDOW_RANGE: ReactionWindowRange =
  REACTION_WINDOW_PRESETS.easy;

/** Construction options for {@link buildEasyRandomMoveTree}. */
export interface EasyRandomMoveTreeOptions {
  /**
   * Probability in `[0, 1]` the bot hesitates on a given tick.
   * Defaults to {@link DEFAULT_EASY_IDLE_CHANCE} (0.4 — the AC's
   * "frequent" idle target).
   */
  readonly idleChance?: number;
  /**
   * Pool of attacks the random-move leaf samples from. Defaults to
   * {@link DEFAULT_RANDOM_MOVE_POOL} (jab / tilt / smash / special).
   */
  readonly attackPool?: ReadonlyArray<AttackKind>;
  /**
   * Minimum frames between two consecutive successful presses.
   * Defaults to {@link DEFAULT_RANDOM_MOVE_COOLDOWN_FRAMES} (90 frames
   * ≈ 1.5 s at 60 FPS — the AC's "long cooldowns" target).
   */
  readonly cooldownFrames?: number;
  /**
   * Reach for the basic-attack branch. Default
   * {@link DEFAULT_RANDOM_MOVE_RANGE_PX} (50 px) so movement and
   * press leaves agree on threshold.
   */
  readonly attackRangePx?: number;
}

/**
 * Resolved option set with defaults filled in. Useful for tests that
 * want to assert the actual tunables in play and for controller
 * integration code that wants to log the configuration.
 */
export interface ResolvedEasyRandomMoveTreeOptions {
  readonly idleChance: number;
  readonly attackPool: ReadonlyArray<AttackKind>;
  readonly cooldownFrames: number;
  readonly attackRangePx: number;
}

/** Apply defaults to user-supplied options. Validation runs in the leaves. */
export function resolveEasyRandomMoveTreeOptions(
  options: EasyRandomMoveTreeOptions = {},
): ResolvedEasyRandomMoveTreeOptions {
  return {
    idleChance: options.idleChance ?? DEFAULT_EASY_IDLE_CHANCE,
    attackPool: options.attackPool ?? DEFAULT_RANDOM_MOVE_POOL,
    cooldownFrames:
      options.cooldownFrames ?? DEFAULT_RANDOM_MOVE_COOLDOWN_FRAMES,
    attackRangePx: options.attackRangePx ?? DEFAULT_RANDOM_MOVE_RANGE_PX,
  };
}

/**
 * Build the AC 10202 Sub-AC 2 Easy-tier offensive sub-tree. Returns
 * the root `IBehaviorNode` so a controller can plug it into a larger
 * tree (e.g. as a child of a top-level Selector that sits alongside
 * defensive / recovery branches).
 *
 * @example
 * ```ts
 * const root = buildEasyRandomMoveTree();
 * const tree = new BehaviorTree<OffensiveContext, OffensiveBlackboardSchema>(
 *   root,
 *   { initialBlackboard: { ...DEFAULT_OFFENSIVE_BLACKBOARD } },
 * );
 * tree.tick(ctx); // emits idle ~40 % of ticks; otherwise random
 *                 // attack press gated by 90-frame cooldown.
 * ```
 */
export function buildEasyRandomMoveTree(
  options: EasyRandomMoveTreeOptions = {},
): IBehaviorNode<OffensiveContext> {
  const resolved = resolveEasyRandomMoveTreeOptions(options);

  // ---- Idle hesitation branch --------------------------------------------
  // Sits FIRST so a successful idle roll terminates the Selector before
  // any movement or attack intent is emitted. ~40 % of ticks the bot
  // does nothing — the AC's "frequent idle behaviour".
  const idle = new IdleChanceLeaf(
    { idleChance: resolved.idleChance, comboStepId: 'easyRandom.idle' },
    'easyRandom.idle',
  );

  // ---- Random-attack branch ----------------------------------------------
  // Walk toward the opponent until in range, then press a random attack
  // (gated by a long cooldown). The attack leaf returns Failure while
  // the cooldown is active, so an in-range parked bot just stands
  // there until the cooldown elapses — the visible "novice waits
  // forever between presses" beat.
  const attack = new SequenceNode<OffensiveContext>(
    [
      new MoveTowardOpponentLeaf(
        { preferredRangePx: resolved.attackRangePx },
        'easyRandom.move',
      ),
      new RandomMoveSelectLeaf(
        {
          attackPool: resolved.attackPool,
          cooldownFrames: resolved.cooldownFrames,
          maxRangePx: resolved.attackRangePx,
          comboStepId: 'easyRandom.press',
        },
        'easyRandom.press',
      ),
    ],
    'easyRandom.attack',
  );

  return new SelectorNode<OffensiveContext>(
    [idle, attack],
    'easyRandom',
  );
}
