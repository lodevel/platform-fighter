/**
 * RandomMoveSelectLeaf — random attack-pick with a long inter-attack
 * cooldown. Authored for AC 10202 Sub-AC 2 (Easy difficulty tier with
 * "random move selection with long cooldowns").
 *
 * Why this leaf exists
 * --------------------
 *
 * Easy-tier feel target: a beginner who *occasionally* picks an attack,
 * doesn't really care which one, and waits a long time between
 * attempts. The Easy *idle* gate ({@link IdleChanceLeaf}) handles
 * "frequent hesitation"; this leaf handles the orthogonal "when the
 * bot does decide to attack, it picks one at random and then needs a
 * long beat before the next attempt."
 *
 * The design contrasts deliberately with Hard tier:
 *
 *   • Hard picks the *best* attack for the situation (jab → tilt at
 *     low %, smash at KO %, edge-guard when opponent is off-stage).
 *   • Medium picks the appropriate attack from a smaller policy.
 *   • Easy uniformly samples a small attack pool and ignores context —
 *     a smash at 0 % opponent damage is just as likely as a jab. This
 *     is the "novice mashes whatever" beat the AC calls for.
 *
 * Behaviour
 * ---------
 *
 *   1. No opponent (`ctx.opponent == null`)              → `Failure`.
 *   2. Bot can't attack right now (`canAttack === false`) → `Failure`.
 *   3. Opponent outside `maxRangePx`                      → `Failure`.
 *   4. Cooldown still active                              → `Failure`,
 *      no RNG burn (cooldown is a *commit-time* gate; the leaf doesn't
 *      bias future random rolls just because it was rate-limited).
 *   5. All gates open → roll one RNG value, pick `attackPool[index]`,
 *      emit the press, set `lastAttackTick = ctx.tickIndex`, return
 *      `Success`.
 *
 * Long-cooldown rationale
 * -----------------------
 *
 * The Easy reaction window already gives the bot a 28-36 frame
 * perception delay (~0.5 s). Layering a 90-frame inter-attack cooldown
 * (1.5 s) on top means the bot fires roughly once every two seconds in
 * the worst case (reaction + cooldown + idle hesitation). That cadence
 * matches the AC's "long cooldowns" language and produces the visible
 * "novice waits forever between presses" feel.
 *
 * The cooldown is configurable per construction so:
 *
 *   • Tests can use a small value (e.g. 5 frames) to exercise the
 *     cooldown logic without burning a 5_000-tick simulation.
 *   • A future Medium-tier-with-cooldown variant could reuse the leaf
 *     with a tighter band (e.g. 30 frames).
 *
 * Determinism
 * -----------
 *
 *   • One RNG draw per *successful* attack press; zero RNG draws when
 *     any gate fails (including the cooldown gate). That keeps the
 *     RNG sequence aligned with the *attempt* cadence — easier to
 *     reason about than "burn one per tick" because the cadence is
 *     observable in tests via `lastAttackTick`.
 *   • `lastAttackTick` is the only piece of mutable state. `reset()`
 *     wipes it back to the sentinel so a match restart, replay scrub,
 *     or controller swap cannot leak prior cooldown progress into the
 *     new timeline.
 *   • The attack pool is captured as a frozen array on construction;
 *     the same `(rng-seed, tick sequence, opponent snapshots)` triple
 *     always produces the same emit sequence.
 *
 * Why a leaf, not a decorator?
 * ----------------------------
 *
 * A decorator would gate an inner `FireAttackLeaf<jab>` (or similar) on
 * a cooldown — but the Easy AC needs *random selection across a pool*,
 * which is leaf-shaped state, not a wrapper around one fixed attack.
 * Bundling selection + emit into a single leaf also keeps the cooldown
 * book-keeping co-located with the press: there's exactly one place
 * `lastAttackTick` is read and written.
 */

import { LeafNode, NodeStatus } from '../behaviorTree/Node';
import type { AttackKind, OffensiveContext } from './types';

/**
 * Default attack pool — every grounded attack the offensive layer
 * understands. Easy tier samples uniformly from this set; the user can
 * override the pool in construction options to narrow it (e.g. drop
 * `'special'` for a melee-only Easy bot).
 *
 * Frozen so the default reference is safe to hand back to inspectors
 * without defensive copies.
 */
export const DEFAULT_RANDOM_MOVE_POOL: ReadonlyArray<AttackKind> =
  Object.freeze(['jab', 'tilt', 'smash', 'special']);

/**
 * Default inter-attack cooldown for the Easy tier. 90 frames at 60 FPS
 * = 1.5 s — long enough to feel novice ("the bot waits forever between
 * pokes") but short enough that combat still flows. Tunable via the
 * `cooldownFrames` option for tighter or looser pacing.
 */
export const DEFAULT_RANDOM_MOVE_COOLDOWN_FRAMES = 90;

/**
 * Default reach for the random-move leaf. 50 px matches Hard's
 * neutral-jab range and Easy's `EasyOffensiveTree` jab range so the
 * Easy tier's "close, then attack" pacing stays consistent across the
 * jab-only and random-move variants.
 */
export const DEFAULT_RANDOM_MOVE_RANGE_PX = 50;

/** Construction options for {@link RandomMoveSelectLeaf}. */
export interface RandomMoveSelectOptions {
  /**
   * Pool of attacks to sample from. Each tick that clears the gates
   * picks one entry uniformly at random via the seeded RNG. Defaults
   * to {@link DEFAULT_RANDOM_MOVE_POOL} (jab / tilt / smash / special).
   * Must contain at least one entry — an empty pool would deadlock the
   * leaf in a permanent Failure.
   */
  readonly attackPool?: ReadonlyArray<AttackKind>;
  /**
   * Minimum frames between two consecutive successful presses. The
   * leaf returns `Failure` (without emitting) while the cooldown is
   * active, so an enclosing Selector falls through to whatever neutral
   * branch comes next. Defaults to
   * {@link DEFAULT_RANDOM_MOVE_COOLDOWN_FRAMES} (90 frames ≈ 1.5 s at
   * 60 FPS). Must be a non-negative integer; `0` disables the
   * cooldown entirely (useful for tests).
   */
  readonly cooldownFrames?: number;
  /**
   * Maximum opponent distance (absolute, design px) for the press to
   * fire. Beyond this range the leaf returns `Failure` without rolling
   * RNG or burning the cooldown. Defaults to
   * {@link DEFAULT_RANDOM_MOVE_RANGE_PX}. Must be positive.
   */
  readonly maxRangePx?: number;
  /**
   * Optional debug label tagged onto the emit's `comboStepId`. Defaults
   * to `'easy.random'` so replay overlays can distinguish a deliberate
   * Easy-tier random press from a planned combo follow-up.
   */
  readonly comboStepId?: string;
}

/**
 * Resolved option set — defaults filled in. Useful for tests asserting
 * the actual tunables in play and for controller integration code that
 * wants to log the configuration.
 */
export interface ResolvedRandomMoveSelectOptions {
  readonly attackPool: ReadonlyArray<AttackKind>;
  readonly cooldownFrames: number;
  readonly maxRangePx: number;
  readonly comboStepId: string;
}

/** Apply defaults to user-supplied options and validate the result. */
export function resolveRandomMoveSelectOptions(
  options: RandomMoveSelectOptions = {},
): ResolvedRandomMoveSelectOptions {
  const pool = options.attackPool ?? DEFAULT_RANDOM_MOVE_POOL;
  if (!Array.isArray(pool) && !(pool as ReadonlyArray<AttackKind>).length) {
    throw new Error(
      `RandomMoveSelectLeaf: attackPool must be an array, got ${String(pool)}`,
    );
  }
  if (pool.length === 0) {
    throw new Error(
      'RandomMoveSelectLeaf: attackPool must contain at least one entry',
    );
  }
  const cooldown = options.cooldownFrames ?? DEFAULT_RANDOM_MOVE_COOLDOWN_FRAMES;
  if (!Number.isInteger(cooldown) || cooldown < 0) {
    throw new Error(
      `RandomMoveSelectLeaf: cooldownFrames must be a non-negative integer, ` +
        `got ${String(cooldown)}`,
    );
  }
  const range = options.maxRangePx ?? DEFAULT_RANDOM_MOVE_RANGE_PX;
  if (!Number.isFinite(range) || range <= 0) {
    throw new Error(
      `RandomMoveSelectLeaf: maxRangePx must be > 0, got ${String(range)}`,
    );
  }
  return {
    attackPool: Object.freeze([...pool]) as ReadonlyArray<AttackKind>,
    cooldownFrames: cooldown,
    maxRangePx: range,
    comboStepId: options.comboStepId ?? 'easy.random',
  };
}

/**
 * Sentinel for "no attack has fired yet". Chosen as a large negative
 * number so the cooldown check (`tickIndex - lastAttackTick >=
 * cooldownFrames`) is trivially true on the first eligible tick
 * regardless of the configured cooldown. Specifically picked as
 * `Number.MIN_SAFE_INTEGER` — well below any realistic
 * `tickIndex - cooldownFrames` value — so even a misconfigured
 * cooldown can't trip the gate before the first press.
 */
const NEVER_FIRED_SENTINEL = Number.MIN_SAFE_INTEGER;

/**
 * Leaf that picks a random attack from a configured pool and presses
 * it, gated on a long inter-attack cooldown.
 */
export class RandomMoveSelectLeaf extends LeafNode<OffensiveContext> {
  private readonly attackPool: ReadonlyArray<AttackKind>;
  private readonly cooldownFrames: number;
  private readonly maxRangePx: number;
  private readonly comboStepId: string;

  /**
   * Tick index of the most recent successful press, or
   * {@link NEVER_FIRED_SENTINEL} before the first press / after a
   * `reset()`. The cooldown gate consults this value via
   * `ctx.tickIndex - lastAttackTick >= cooldownFrames`.
   *
   * Stored as a numeric field rather than on the Blackboard because
   * the cooldown is leaf-private state — no other leaf reads or writes
   * it. Keeping it local also avoids extending
   * {@link OffensiveBlackboardSchema} for a single Easy-tier-only
   * concern.
   */
  private lastAttackTick: number = NEVER_FIRED_SENTINEL;

  /**
   * @param options Optional — see {@link RandomMoveSelectOptions}.
   *                Throws on misconfiguration (empty pool, negative
   *                cooldown, non-positive range).
   * @param name Optional debug label, surfaced in tree dumps.
   */
  constructor(options: RandomMoveSelectOptions = {}, name?: string) {
    super(name);
    const resolved = resolveRandomMoveSelectOptions(options);
    this.attackPool = resolved.attackPool;
    this.cooldownFrames = resolved.cooldownFrames;
    this.maxRangePx = resolved.maxRangePx;
    this.comboStepId = resolved.comboStepId;
  }

  protected override onTick(context: OffensiveContext): NodeStatus {
    const opponent = context.opponent;
    if (opponent === null) {
      return NodeStatus.Failure;
    }
    if (!context.self.canAttack) {
      return NodeStatus.Failure;
    }
    if (Math.abs(opponent.distance) > this.maxRangePx) {
      return NodeStatus.Failure;
    }

    // Cooldown gate. Compared with `<` because the very first eligible
    // press should fire on the same tick as the controller starts the
    // bot — `tickIndex - NEVER_FIRED_SENTINEL` overflows positive but
    // is still correctly >= cooldownFrames for any realistic
    // cooldownFrames value.
    const sinceLast = context.tickIndex - this.lastAttackTick;
    if (sinceLast < this.cooldownFrames) {
      return NodeStatus.Failure;
    }

    // Pool of length 1 — no need to consume RNG; the choice is forced.
    // Skipping the roll keeps the consumption pattern stable across
    // configurations: a single-attack pool behaves identically to a
    // hard-coded press leaf, and a multi-attack pool burns exactly one
    // RNG value per successful press.
    let attack: AttackKind;
    if (this.attackPool.length === 1) {
      attack = this.attackPool[0]!;
    } else {
      const roll = context.rng.range(0, this.attackPool.length - 1);
      attack = this.attackPool[roll]!;
    }

    context.out.emit({ kind: attack, comboStepId: this.comboStepId });
    this.lastAttackTick = context.tickIndex;
    return NodeStatus.Success;
  }

  /** Wipes the cooldown back to "never fired" so the next eligible tick fires. */
  override reset(): void {
    super.reset();
    this.lastAttackTick = NEVER_FIRED_SENTINEL;
  }

  // ---- Inspectors --------------------------------------------------------

  /** Pool the leaf samples from. Read-only — do not mutate. */
  getAttackPool(): ReadonlyArray<AttackKind> {
    return this.attackPool;
  }

  /** Configured inter-attack cooldown in frames. */
  getCooldownFrames(): number {
    return this.cooldownFrames;
  }

  /** Configured maximum reach in design pixels. */
  getMaxRangePx(): number {
    return this.maxRangePx;
  }

  /** Combo-step label tagged onto every emit. */
  getComboStepId(): string {
    return this.comboStepId;
  }

  /**
   * Last tick on which the leaf successfully fired, or
   * {@link Number.MIN_SAFE_INTEGER} before the first press / after a
   * `reset()`. Surfaced for debug overlays and unit tests; the
   * runtime gameplay layer doesn't need to read it.
   */
  getLastAttackTick(): number {
    return this.lastAttackTick;
  }

  /**
   * True iff the cooldown gate would pass for the supplied
   * `tickIndex`. Pure inspection — does not mutate state, does not
   * roll RNG. Useful for telemetry and for trees that want to compose
   * the leaf with an external "attack ready" indicator.
   */
  isCooldownReady(tickIndex: number): boolean {
    return tickIndex - this.lastAttackTick >= this.cooldownFrames;
  }
}
