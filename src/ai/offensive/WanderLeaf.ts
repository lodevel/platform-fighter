/**
 * WanderLeaf — emits aimless walking-around movement for the Easy tier
 * (AC 20203 Sub-AC 3 — "frequent idle/wandering behavior").
 *
 * Why this leaf exists
 * --------------------
 *
 * The Easy difficulty tier is the AC-mandated *believably weaker*
 * opponent. The companion {@link IdleChanceLeaf} handles "stand still"
 * hesitation — but a pure idle gate makes the bot feel *frozen* rather
 * than *novice*. A real beginner doesn't park themselves in one spot;
 * they amble around the stage, occasionally wander toward the opponent,
 * occasionally backpedal for no reason. That ambling beat is what
 * separates "AI off" from "AI new player".
 *
 * `WanderLeaf` injects that beat directly into the Easy-tier offensive
 * tree as a *probabilistic side-step*: every tick the leaf rolls the
 * seeded RNG and — with `wanderChance` probability — emits a *random
 * directional movement* (left or right) and returns `Success`. The
 * enclosing Selector terminates and the bot drifts in that direction
 * for one tick. No idle, no attack — just movement. Subsequent ticks
 * each re-roll, so over a 60-frame window the bot randomly walks left
 * and right rather than committing to a long stretch.
 *
 * Design contrast with `IdleChanceLeaf`
 * -------------------------------------
 *
 *   • {@link IdleChanceLeaf}  → "novice freezes". Emits `idle`.
 *   • `WanderLeaf`            → "novice ambles". Emits `moveLeft` /
 *                                `moveRight` *uncorrelated* with the
 *                                opponent's position (the random walk
 *                                doesn't aim).
 *
 * Used together (as Sub-AC 3 prescribes), the two leaves produce the
 * "stands still some of the time, wanders aimlessly some of the time,
 * actually engages the rest of the time" pattern that reads
 * unmistakably as a beginner.
 *
 * Behaviour
 * ---------
 *
 *   1. The leaf always burns one RNG draw on tick so its consumption
 *      pattern is stable regardless of branch outcome — any caller
 *      threading the same RNG into other systems can rely on this.
 *      (Same convention as {@link IdleChanceLeaf}.)
 *
 *   2. If the wander-chance roll passes (`roll < wanderChance`):
 *
 *        a. Burn a *second* RNG draw to pick a direction (50/50 left or
 *           right). The direction is *not* biased toward the opponent —
 *           that bias would defeat the "wandering" feel and overlap with
 *           {@link MoveTowardOpponentLeaf}'s purposeful gap-close.
 *
 *        b. Emit `moveLeft` or `moveRight` and return `Success`. The
 *           Selector terminates; the rest of the tree (basic-jab branch)
 *           is skipped this tick.
 *
 *   3. Otherwise (roll fails) → return `Failure` *without emitting*.
 *      The Selector falls through to the next branch.
 *
 *   4. No opponent / no canAttack — neither is consulted. A novice
 *      wanders during the opponent's startup, during their own respawn
 *      i-frames, while airborne — none of those should suppress the
 *      "ambling" behaviour. The branch below this one (purposeful gap-
 *      close + jab) reads those gates separately.
 *
 * Tunables
 * --------
 *
 *   • `wanderChance` — probability the leaf emits a random-direction
 *     movement on a given tick. Defaults to {@link
 *     DEFAULT_EASY_WANDER_CHANCE} (0.25). Combined with the 0.40 idle
 *     gate, the bot spends about 40% idle + 25% wandering = 65% of
 *     ticks in "novice noise" beats, with the remaining 35% on
 *     purposeful jab attempts. Higher tiers can override (Medium
 *     might disable the leaf; Hard wouldn't use it at all). Must fall
 *     in `[0, 1]`.
 *
 * Why a probabilistic gate over a fixed cadence
 * ---------------------------------------------
 *
 * Same reasoning as {@link IdleChanceLeaf}: a clockwork pattern
 * (e.g. "wander 30 frames out of every 90") is gameable — players time
 * their attacks to the predictable lulls. A probabilistic gate makes
 * each individual tick unpredictable while the long-run *fraction*
 * remains exact.
 *
 * Determinism contract
 * --------------------
 *
 * Every randomness call goes through `ctx.rng`, never `Math.random`.
 * The leaf consumes exactly one `next()` value per tick when the
 * wander-roll fails, exactly two `next()` values per tick when it
 * succeeds (one for the wander roll, one for the direction pick).
 * The varying consumption is deliberate and matches the two-step
 * decision: replay logs that record per-tick RNG state can verify the
 * decision flow by counting consumed values.
 *
 * Why this leaf stays inside `offensive/` rather than its own folder
 * ------------------------------------------------------------------
 *
 * The leaf emits {@link OffensiveAction}s and consumes the
 * {@link OffensiveContext} the rest of the offensive tree uses. Sub-AC
 * 3 wires it as *part of* the Easy offensive tree (alongside the idle
 * gate and the basic-jab branch) so the entire Easy tier is one
 * Selector with three children. Splitting it into a separate folder
 * would force two imports for what is conceptually one tier.
 */

import { LeafNode, NodeStatus } from '../behaviorTree/Node';
import type { OffensiveContext } from './types';

/** Construction options for {@link WanderLeaf}. */
export interface WanderLeafOptions {
  /**
   * Probability in `[0, 1]` that the leaf emits a random-direction
   * movement on a given tick. Defaults to
   * {@link DEFAULT_EASY_WANDER_CHANCE}. Validated at construction so a
   * misconfigured tier fails loudly during boot.
   */
  readonly wanderChance?: number;
  /**
   * Optional debug label tagged onto the emit's `comboStepId`. Defaults
   * to `'easy.wander'` so replay overlays can distinguish a deliberate
   * Easy-tier wander from a purposeful gap-close.
   */
  readonly comboStepId?: string;
}

/**
 * Default chance the Easy tier wanders on any given tick. 25 %
 * combined with the idle leaf's 40 % gives about 35 % of ticks
 * actually committing to gap-close + jab — the AC's "frequent idle/
 * wandering behavior" call. Tuned together with the 28-36 frame
 * reaction-window preset so combined hesitation (perception delay +
 * idle gate + wander gate) reads as novice without locking up.
 */
export const DEFAULT_EASY_WANDER_CHANCE = 0.25;

/**
 * Leaf that probabilistically emits a random-direction movement
 * (left or right) and short-circuits the enclosing Selector.
 */
export class WanderLeaf extends LeafNode<OffensiveContext> {
  private readonly wanderChance: number;
  private readonly comboStepId: string;

  /**
   * @param options Optional — see {@link WanderLeafOptions}. Throws on
   *                an out-of-range `wanderChance` or NaN/Infinity input.
   * @param name Optional debug label, surfaced in tree dumps.
   */
  constructor(options: WanderLeafOptions = {}, name?: string) {
    super(name);
    const chance = options.wanderChance ?? DEFAULT_EASY_WANDER_CHANCE;
    if (!Number.isFinite(chance) || chance < 0 || chance > 1) {
      throw new Error(
        `WanderLeaf: wanderChance must be in [0, 1], got ` + String(chance),
      );
    }
    this.wanderChance = chance;
    this.comboStepId = options.comboStepId ?? 'easy.wander';
  }

  protected override onTick(context: OffensiveContext): NodeStatus {
    // Always burn one RNG draw on tick so the consumption pattern is
    // stable across the gate decision — a downstream system that
    // shares the RNG can rely on this leaf having drawn at least one
    // value.
    const wanderRoll = context.rng.next();

    // `wanderChance === 0` short-circuits to a guaranteed Failure
    // (the strict `<` test below already gives that result, but the
    // explicit branch documents the "leaf disabled" contract).
    if (this.wanderChance === 0) {
      return NodeStatus.Failure;
    }

    if (wanderRoll < this.wanderChance) {
      // Wander triggered — pick a random direction. Burn a second
      // RNG draw rather than reusing the wander-roll value so the
      // direction pick is independent of the gate decision (the
      // wander roll is a fraction biased toward 0 by passing the
      // gate; reusing it would skew the direction toward `moveLeft`).
      const dirRoll = context.rng.next();
      if (dirRoll < 0.5) {
        context.out.emit({ kind: 'moveLeft', comboStepId: this.comboStepId });
      } else {
        context.out.emit({ kind: 'moveRight', comboStepId: this.comboStepId });
      }
      return NodeStatus.Success;
    }
    return NodeStatus.Failure;
  }

  /** Inspector for tests / debug overlays. */
  getWanderChance(): number {
    return this.wanderChance;
  }

  /** Inspector for tests / debug overlays. */
  getComboStepId(): string {
    return this.comboStepId;
  }
}
