/**
 * IdleChanceLeaf — emits a probabilistic "stand still" beat for the
 * Easy-tier offensive sub-tree (AC 10203 Sub-AC 3).
 *
 * Why this leaf exists
 * --------------------
 *
 * The Easy difficulty tier targets a *believably weaker* opponent: a
 * beginner who frequently does nothing, lets openings slide by, and
 * commits only the most obvious attacks. The reaction-window AC
 * (Sub-AC 1 of AC 18) already gives Easy a 28-36 frame perception
 * delay, but slow perception alone makes the bot feel "laggy" rather
 * than "novice". A novice player also *hesitates* — they stand
 * around, mash buttons too late, and miss windows even when they see
 * the opening. This leaf bakes that hesitation into the behavior tree
 * directly.
 *
 * Design — probabilistic gate, not a fixed cadence
 * ------------------------------------------------
 *
 * A naive implementation might idle every Nth tick (e.g. "idle for 60
 * frames out of every 120"), but a clockwork pattern is easy to game
 * — players time their attacks to the predictable lulls. Instead the
 * leaf rolls the seeded {@link Rng} on each tick and idles whenever
 * the roll falls below `idleChance`. The expected long-run idle
 * fraction equals `idleChance` but the *individual* tick is
 * unpredictable to the human opponent.
 *
 * Determinism is preserved because the RNG is seeded and threaded
 * through the {@link OffensiveContext}; two replays with the same
 * seed produce byte-identical idle/non-idle decisions.
 *
 * Behaviour
 * ---------
 *
 *   1. `Rng.next()` rolls a value in `[0, 1)`. If the roll is `<
 *      idleChance`, the leaf emits an `'idle'` action and returns
 *      `Success` (the enclosing Selector terminates — no other
 *      branch fires this tick).
 *   2. Otherwise the leaf returns `Failure` *without emitting* so
 *      the Selector falls through to the next branch (the basic-
 *      move-select sequence).
 *   3. No opponent / no canAttack — the leaf doesn't gate on either.
 *      A novice frozen in place still occasionally taps a button
 *      mid-air; a defensive idle in the middle of an opponent's
 *      smash startup is a perfectly novice thing to do.
 *
 * Tunables
 * --------
 *
 *   - `idleChance` defaults to `0.4` — the bot stands around about
 *     40 % of its eligible ticks. With Easy's 28-36 frame perception
 *     delay this works out to 1-2 idle stretches per second on
 *     average. Higher tiers can override (Medium tier might pass
 *     `0.15`, Hard typically wouldn't use the leaf at all). Must
 *     fall in `[0, 1]`; `0` makes the leaf always Fail (effectively
 *     disabled) and `1` makes it always Idle (the bot never attacks,
 *     useful for sandbox tests).
 *
 * Determinism contract
 * --------------------
 *
 * Every randomness call goes through `ctx.rng`, never `Math.random`.
 * The leaf consumes exactly one `next()` value per tick. If the
 * controller fans the same RNG into other systems, the call
 * ordering matters: by convention this leaf sits *first* in the
 * Easy-tier Selector so its single roll is predictable in replay
 * logs.
 */

import { LeafNode, NodeStatus } from '../behaviorTree/Node';
import type { OffensiveContext } from './types';

/** Construction options for {@link IdleChanceLeaf}. */
export interface IdleChanceOptions {
  /**
   * Probability in `[0, 1]` that the leaf idles on a given tick.
   * Defaults to {@link DEFAULT_EASY_IDLE_CHANCE}. Validated at
   * construction so a misconfigured tier fails loudly during boot.
   */
  readonly idleChance?: number;
  /**
   * Optional debug label tagged onto the emitted `idle` action's
   * `comboStepId`. Defaults to `'easy.idle'` so replay overlays can
   * distinguish a deliberate Easy-tier hesitation from any other
   * `idle` emit (e.g. a panic-release).
   */
  readonly comboStepId?: string;
}

/**
 * Default chance the Easy tier idles on any given tick. 40 % is the
 * AC-mandated "frequent" idle behavior — the bot pauses often enough
 * to feel novice without locking up entirely. Tuned together with the
 * 28-36 frame reaction-window preset so combined hesitation
 * (perception delay + idle gate) matches a beginner's roughly
 * half-second response cadence.
 */
export const DEFAULT_EASY_IDLE_CHANCE = 0.4;

/**
 * Leaf that probabilistically emits an `idle` action and short-circuits
 * the enclosing Selector.
 */
export class IdleChanceLeaf extends LeafNode<OffensiveContext> {
  private readonly idleChance: number;
  private readonly comboStepId: string;

  /**
   * @param options Optional — see {@link IdleChanceOptions}. Throws on
   *                an out-of-range `idleChance` or NaN/Infinity input.
   * @param name Optional debug label, surfaced in tree dumps.
   */
  constructor(options: IdleChanceOptions = {}, name?: string) {
    super(name);
    const chance = options.idleChance ?? DEFAULT_EASY_IDLE_CHANCE;
    if (!Number.isFinite(chance) || chance < 0 || chance > 1) {
      throw new Error(
        `IdleChanceLeaf: idleChance must be in [0, 1], got ` + String(chance),
      );
    }
    this.idleChance = chance;
    this.comboStepId = options.comboStepId ?? 'easy.idle';
  }

  protected override onTick(context: OffensiveContext): NodeStatus {
    // Always burn one RNG call on tick so the consumption pattern is
    // stable regardless of whether the leaf idles or falls through —
    // any caller threading the same Rng into other systems can rely
    // on this leaf having drawn exactly one value.
    const roll = context.rng.next();

    // `idleChance === 0` short-circuits to a guaranteed Failure (the
    // strict `<` test below would already give that result, but the
    // explicit branch documents the "leaf disabled" contract).
    if (this.idleChance === 0) {
      return NodeStatus.Failure;
    }

    if (roll < this.idleChance) {
      context.out.emit({ kind: 'idle', comboStepId: this.comboStepId });
      return NodeStatus.Success;
    }
    return NodeStatus.Failure;
  }

  /** Inspector for tests / debug overlays. */
  getIdleChance(): number {
    return this.idleChance;
  }

  /** Inspector for tests / debug overlays. */
  getComboStepId(): string {
    return this.comboStepId;
  }
}
