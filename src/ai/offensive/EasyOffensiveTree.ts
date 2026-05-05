/**
 * EasyOffensiveTree — composes the Easy-tier offensive sub-tree authored
 * for AC 10203 Sub-AC 3 and extended for AC 20203 Sub-AC 3.
 *
 * The Easy tier is the "noticeably weaker but believably so" opponent the
 * AC explicitly calls for. Four properties together produce that feel:
 *
 *   1. **Slow reactions** — perception is gated by the
 *      {@link REACTION_WINDOW_PRESETS.easy} 28-36 frame band, configured
 *      at the controller layer. The behavior tree itself reads its
 *      already-delayed snapshot and need not re-implement the latency
 *      band; this factory therefore exposes the preset via
 *      {@link EASY_REACTION_WINDOW_RANGE} so the controller wiring is
 *      single-source-of-truth.
 *
 *   2. **Frequent idle behavior** — an {@link IdleChanceLeaf} sits at
 *      the head of the Selector. ~40 % of eligible ticks the bot
 *      hesitates, emitting an `idle` action and skipping the rest of
 *      the tree this frame. The probability is roll-based (seeded RNG)
 *      so it cannot be timed by the player.
 *
 *   3. **Frequent wandering behavior** — a {@link WanderLeaf} sits
 *      *below* the idle gate but *above* the basic-jab branch. ~25 %
 *      of remaining ticks the bot drifts in a random direction
 *      (uncorrelated with the opponent), emitting a single `moveLeft`
 *      or `moveRight` and skipping the basic-jab branch. Combined with
 *      the idle gate, the bot spends roughly 40 % idle + 25 % wandering
 *      ≈ 65 % of its ticks in "novice noise", with the remaining 35 %
 *      committing to purposeful gap-close + jab attempts.
 *
 *   4. **Basic move selection** — the tree only ever considers a single
 *      attack: jab. No combo recognition, no KO smash branch, no tilt
 *      follow-ups. A novice button-mashes the neutral attack; the Easy
 *      tier mirrors that.
 *
 * Note: high error rates — the fourth pillar of Sub-AC 3 — are
 * implemented at the *controller* level rather than inside the tree.
 * The Easy-tier provider mangles the emitted command stream after the
 * tree has decided, so a single mechanism covers wrong-direction,
 * missed-press, and dropped-input failures uniformly without baking
 * error logic into every leaf.
 *
 * Tree shape
 * ----------
 *
 *   Selector("easyOffensive")
 *     ├── IdleChanceLeaf                   — hesitate ~40 % of ticks
 *     ├── WanderLeaf                       — wander ~25 % of remaining
 *     └── Sequence("easyJab")              — close + press jab
 *           ├── MoveTowardOpponentLeaf     — walk toward opponent
 *           └── FireAttackLeaf (jab)       — press neutral attack
 *
 * Why this shape
 * --------------
 *
 *   1. The Selector ticks branches in priority order and short-circuits
 *      on the first non-Failure. With idle returning Success on a
 *      successful roll, that beat dominates — the rest of the tree is
 *      skipped and the bot stands still.
 *
 *   2. When idle Fails through, the basic-jab sequence runs. The
 *      MoveTowardOpponent → FireAttackLeaf pipeline is the same one
 *      Hard tier uses for its neutral entry (Sub-AC 18); reusing the
 *      same leaves keeps the Easy and Hard trees consistent with
 *      respect to gap-close behaviour, only the surrounding policy
 *      differs.
 *
 *   3. Smash is intentionally absent. Easy bots whiff smashes from
 *      across the screen feel cheating-bad; pinning Easy to jab keeps
 *      the bot recognisable as "low pressure" and makes its damage
 *      output significantly weaker than Hard's combo-driven game.
 *
 * Reach numbers
 * -------------
 *
 * The default jab reach (50 px) matches Hard's neutral-jab branch so
 * leaves can be reused without per-tier tuning. Override via
 * {@link EasyOffensiveTreeOptions} when a per-character controller
 * wants a tighter reach.
 *
 * Determinism
 * -----------
 *
 * Every leaf used here is deterministic on its inputs (the
 * {@link IdleChanceLeaf} consumes a single `ctx.rng.next()` per tick,
 * documented in its module). The factory itself reads no Rng / no
 * wall-clock — `buildEasyOffensiveTree` always returns an isomorphic
 * tree given the same options, so the replay system can rebuild the
 * controller from a snapshot by calling the factory and replaying
 * the recorded inputs.
 */

import { SelectorNode, SequenceNode } from '../behaviorTree/composites';
import type { IBehaviorNode } from '../behaviorTree/Node';

import { FireAttackLeaf } from './FireAttackLeaf';
import { IdleChanceLeaf, DEFAULT_EASY_IDLE_CHANCE } from './IdleChanceLeaf';
import { MoveTowardOpponentLeaf } from './MoveTowardOpponentLeaf';
import type { OffensiveContext } from './types';
import { WanderLeaf, DEFAULT_EASY_WANDER_CHANCE } from './WanderLeaf';

import { REACTION_WINDOW_PRESETS } from '../perception/reactionWindowPresets';
import type { ReactionWindowRange } from '../perception/ReactionWindow';

/**
 * Re-export of the Easy tier's reaction-window range from the central
 * preset table. Surfaced from this module so a controller wiring
 * `buildEasyOffensiveTree` together with a {@link ReactionWindow}
 * imports both pieces from one place.
 *
 * Mirrors {@link REACTION_WINDOW_PRESETS.easy} — 28-36 frames. If the
 * preset table is ever retuned, this re-export tracks it automatically
 * (the object is deep-frozen so consumers can rely on identity
 * equality with the table entry).
 */
export const EASY_REACTION_WINDOW_RANGE: ReactionWindowRange =
  REACTION_WINDOW_PRESETS.easy;

/** Construction options for {@link buildEasyOffensiveTree}. */
export interface EasyOffensiveTreeOptions {
  /**
   * Probability in `[0, 1]` the bot hesitates on a given tick.
   * Defaults to {@link DEFAULT_EASY_IDLE_CHANCE}.
   */
  readonly idleChance?: number;
  /**
   * Probability in `[0, 1]` the bot wanders in a random direction on a
   * given tick (after the idle gate fails through). Defaults to
   * {@link DEFAULT_EASY_WANDER_CHANCE} (0.25). Set to `0` to disable
   * the wander branch — useful for unit tests that want a deterministic
   * gap-close path.
   */
  readonly wanderChance?: number;
  /**
   * Reach for the basic jab branch. Default 50 px to match the
   * Hard-tier neutral jab range so the two trees agree on jab
   * spacing.
   */
  readonly jabRangePx?: number;
}

/**
 * Resolved option set with defaults filled in. Useful for tests that
 * want to assert the actual tunables in play and for controller
 * integration code that wants to log the configuration.
 */
export interface ResolvedEasyOffensiveTreeOptions {
  readonly idleChance: number;
  readonly wanderChance: number;
  readonly jabRangePx: number;
}

/** Apply defaults to the user-supplied options. */
export function resolveEasyOffensiveTreeOptions(
  options: EasyOffensiveTreeOptions = {},
): ResolvedEasyOffensiveTreeOptions {
  return {
    idleChance: options.idleChance ?? DEFAULT_EASY_IDLE_CHANCE,
    wanderChance: options.wanderChance ?? DEFAULT_EASY_WANDER_CHANCE,
    jabRangePx: options.jabRangePx ?? 50,
  };
}

/**
 * Build the Easy-tier offensive sub-tree. Returns the root
 * `IBehaviorNode` so a controller can plug it into a larger tree
 * (e.g. as a child of a top-level Selector that sits alongside
 * defensive / recovery branches).
 *
 * @example
 * ```ts
 * const root = buildEasyOffensiveTree();
 * const tree = new BehaviorTree<OffensiveContext, OffensiveBlackboardSchema>(
 *   root,
 *   { initialBlackboard: { ...DEFAULT_OFFENSIVE_BLACKBOARD } },
 * );
 * tree.tick(ctx); // emits idle ~40 % of ticks, jab otherwise (when in range)
 * ```
 */
export function buildEasyOffensiveTree(
  options: EasyOffensiveTreeOptions = {},
): IBehaviorNode<OffensiveContext> {
  const resolved = resolveEasyOffensiveTreeOptions(options);

  // ---- Idle hesitation branch --------------------------------------------
  // Sits FIRST so a successful idle roll terminates the Selector before
  // any movement or attack intent is emitted. ~40 % of ticks the bot
  // does nothing — the AC's "frequent idle behavior".
  const idle = new IdleChanceLeaf(
    { idleChance: resolved.idleChance },
    'easyOffensive.idle',
  );

  // ---- Wander branch -----------------------------------------------------
  // Sits SECOND — after idle, before purposeful jab. ~25 % of remaining
  // (non-idle) ticks the bot drifts in a random direction (uncorrelated
  // with the opponent), reading as "novice ambling" rather than "novice
  // engaging". The wander emit is a single `moveLeft` / `moveRight`;
  // the basic-jab branch is skipped this tick. Honours the AC's
  // "frequent idle/wandering behavior" requirement.
  const wander = new WanderLeaf(
    { wanderChance: resolved.wanderChance },
    'easyOffensive.wander',
  );

  // ---- Basic-jab branch ---------------------------------------------------
  // Easy tier's *only* offensive option: walk toward the opponent and
  // press jab. No combo follow-up, no smash. Matches the AC's "basic
  // move selection" requirement — the bot picks the simplest, safest
  // press in the moveset and never escalates.
  const basicJab = new SequenceNode<OffensiveContext>(
    [
      new MoveTowardOpponentLeaf(
        { preferredRangePx: resolved.jabRangePx },
        'easyJab.move',
      ),
      new FireAttackLeaf(
        {
          attackKind: 'jab',
          maxRangePx: resolved.jabRangePx,
          comboStepId: 'easy.jab',
        },
        'easyJab.press',
      ),
    ],
    'easyJab',
  );

  return new SelectorNode<OffensiveContext>(
    [idle, wander, basicJab],
    'easyOffensive',
  );
}
