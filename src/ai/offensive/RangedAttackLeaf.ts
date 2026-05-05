/**
 * RangedAttackLeaf — fires the bot's `special` projectile when the
 * opponent is in the *mid-range* distance band (too far for a melee
 * jab/tilt, too close to ignore).
 *
 * Authored for AC 10203 Sub-AC 3 — the Medium-tier difficulty's
 * **contextual move selection (close-range vs ranged)**. Where Easy
 * tier presses random attacks irrespective of distance and Hard tier
 * uses predictive movement to chase smashes, Medium picks the
 * appropriate verb for the current distance band:
 *
 *   • In melee reach (≤ 50 px) → jab / tilt / smash chain.
 *   • In mid-range (between
 *     {@link RangedAttackOptions.minRangePx} and
 *     {@link RangedAttackOptions.maxRangePx}) → press `special`
 *     (projectile / poke).
 *   • Out of mid-range (> `maxRangePx`) → walk closer instead of
 *     pressing.
 *
 * Why a separate leaf
 * -------------------
 *
 *   1. The existing {@link import('./FireAttackLeaf').FireAttackLeaf}
 *      gates on a *maximum* range — perfect for "press jab when within
 *      50 px". The ranged-attack decision needs both a *minimum* and a
 *      *maximum* — the bot must NOT fire its projectile when point-
 *      blank (the projectile would whiff over the opponent's head /
 *      collide before activating) and must NOT fire it from across the
 *      stage (opponent would walk out of the line). A purpose-built
 *      leaf encodes the band cleanly and stays composable in tree
 *      tests.
 *
 *   2. Different gating contract — the ranged leaf checks
 *      `self.canAttack` (same as melee presses) but ALSO refuses to
 *      fire while the opponent is in a state where the projectile
 *      would be wasted (e.g. `'shielding'` or `'dodging'` already).
 *      Encapsulating that policy here keeps the offensive Selector
 *      readable: the tree shape says "if there's a ranged opportunity,
 *      take it; otherwise fall through", and the leaf decides what
 *      counts as an opportunity.
 *
 *   3. Determinism — the leaf is pure snapshot-in / emit-out, no RNG,
 *      no Blackboard mutation. Replays reproduce exactly given the
 *      same opponent timeline. Documented here so a controller
 *      reasoning about RNG consumption can confirm this leaf is "safe"
 *      to compose in any order.
 *
 * Behaviour
 * ---------
 *
 *   1. No opponent (`ctx.opponent == null`)              → `Failure`.
 *   2. Bot can't attack right now (`self.canAttack === false`) →
 *      `Failure`. Mirrors the melee leaf's gate so the enclosing
 *      Selector can fall through to a defensive/neutral branch.
 *   3. Opponent inside `minRangePx` (too close)          → `Failure`.
 *      The melee branches downstream of this leaf will pick up the
 *      hit. This is the *contextual* part: at point-blank, the bot
 *      jabs; at mid-range, the bot specials.
 *   4. Opponent outside `maxRangePx` (too far)           → `Failure`.
 *      Walk closer first; firing a projectile that the opponent will
 *      walk out of wastes the bot's recovery frames.
 *   5. Opponent in a `skipStateLabels` state             → `Failure`.
 *      Pre-emptive shield / dodge means the projectile would just
 *      dissipate — the bot keeps its committed-press budget for a
 *      better opportunity.
 *   6. All gates open                                    → emit
 *      `{ kind: 'special' }` and return `Success`.
 *
 * Tunables
 * --------
 *
 *   - `minRangePx` defaults to {@link DEFAULT_RANGED_MIN_RANGE_PX}
 *     (60 px) — just past the longest grounded melee reach so the
 *     ranged branch and the close-range branches partition the
 *     distance space cleanly.
 *
 *   - `maxRangePx` defaults to {@link DEFAULT_RANGED_MAX_RANGE_PX}
 *     (180 px) — far enough that the projectile has time to travel
 *     and connect, but close enough that the opponent can't trivially
 *     walk out before the active frames. Beyond this the bot prefers
 *     to close the gap instead.
 *
 *   - `skipStateLabels` defaults to `['shielding', 'dodging']` — the
 *     two states where a projectile is wasted. Add `'attacking'` if
 *     the engine ever supports parry, or `'recovering'` if a future
 *     character has a projectile fast enough to interrupt recovery.
 *
 *   - `comboStepId` defaults to `'medium.ranged'` — replay overlays
 *     can disambiguate ranged emits from neutral specials.
 *
 * Design discussion: why `special` and not a generic "ranged attack"?
 * -------------------------------------------------------------------
 *
 * The Medium tier's grounded moveset is jab / tilt / smash / special;
 * `special` is the canonical projectile / zone tool. Hard-coding the
 * verb here (rather than parameterising `attackKind`) makes the
 * intent explicit at the call site — composers building a Medium
 * tree should not need to think "which verb is the ranged one for
 * this character" because the answer is always `special`. Per-
 * character variants (e.g. a melee character whose `special` is a
 * grappling charge) override the leaf with a different `attackKind`
 * by reaching into a `FireAttackLeaf` directly instead.
 */

import { LeafNode, NodeStatus } from '../behaviorTree/Node';
import type {
  OffensiveContext,
  OpponentStateLabel,
} from './types';

/**
 * Default minimum reach. 60 px sits just past the longest grounded
 * melee reach (the smash hitbox tops out at ~50 px), so the ranged
 * branch and the close-range branches partition the distance space
 * with a small overlap-free buffer.
 */
export const DEFAULT_RANGED_MIN_RANGE_PX = 60;

/**
 * Default maximum reach. 180 px is empirically the band where a
 * projectile has time to travel and connect against a stationary or
 * slowly-moving opponent without the opponent simply walking out of
 * the line. Beyond this, the bot prefers to close the gap.
 */
export const DEFAULT_RANGED_MAX_RANGE_PX = 180;

/**
 * Default opponent states that *skip* a ranged press — the projectile
 * would dissipate against a shield or whiff through a dodge's
 * i-frames. Frozen so consumers can rely on identity equality.
 */
export const DEFAULT_RANGED_SKIP_STATE_LABELS: readonly OpponentStateLabel[] =
  Object.freeze<OpponentStateLabel[]>(['shielding', 'dodging']);

/** Construction options for {@link RangedAttackLeaf}. */
export interface RangedAttackOptions {
  /**
   * Minimum opponent distance (absolute, design pixels) for the press
   * to fire. Closer than this the leaf returns `Failure` so the
   * downstream melee branches can pick up the hit. Defaults to
   * {@link DEFAULT_RANGED_MIN_RANGE_PX}.
   */
  readonly minRangePx?: number;
  /**
   * Maximum opponent distance for the press to fire. Beyond this the
   * leaf returns `Failure` so the bot walks closer instead. Defaults
   * to {@link DEFAULT_RANGED_MAX_RANGE_PX}.
   */
  readonly maxRangePx?: number;
  /**
   * Opponent state labels that *skip* the press. Defaults to
   * {@link DEFAULT_RANGED_SKIP_STATE_LABELS} (`['shielding',
   * 'dodging']`). Pass an empty array to fire regardless of opponent
   * state (useful for a "spam projectile" Easy variant).
   */
  readonly skipStateLabels?: readonly OpponentStateLabel[];
  /**
   * Optional debug label tagged onto the emit's `comboStepId`.
   * Defaults to `'medium.ranged'`.
   */
  readonly comboStepId?: string;
}

/**
 * Leaf that emits a `special` press when the opponent is in the
 * mid-range distance band. See module docstring for the full gating
 * contract.
 */
export class RangedAttackLeaf extends LeafNode<OffensiveContext> {
  private readonly minRangePx: number;
  private readonly maxRangePx: number;
  private readonly skipStateLabels: ReadonlySet<OpponentStateLabel>;
  private readonly comboStepId: string;

  /**
   * @param options Optional — see {@link RangedAttackOptions}. Throws
   *                on `minRangePx >= maxRangePx`, non-positive ranges,
   *                or invalid state labels.
   * @param name Optional debug label, surfaced in tree dumps.
   */
  constructor(options: RangedAttackOptions = {}, name?: string) {
    super(name);

    const minRange = options.minRangePx ?? DEFAULT_RANGED_MIN_RANGE_PX;
    if (!Number.isFinite(minRange) || minRange <= 0) {
      throw new Error(
        `RangedAttackLeaf: minRangePx must be > 0, got ` + String(minRange),
      );
    }

    const maxRange = options.maxRangePx ?? DEFAULT_RANGED_MAX_RANGE_PX;
    if (!Number.isFinite(maxRange) || maxRange <= 0) {
      throw new Error(
        `RangedAttackLeaf: maxRangePx must be > 0, got ` + String(maxRange),
      );
    }

    if (minRange >= maxRange) {
      throw new Error(
        `RangedAttackLeaf: minRangePx (${minRange}) must be < maxRangePx ` +
          `(${maxRange}) — empty band would never fire`,
      );
    }

    const skipLabels =
      options.skipStateLabels ?? DEFAULT_RANGED_SKIP_STATE_LABELS;
    // Empty list is allowed — it means "never skip due to state".

    this.minRangePx = minRange;
    this.maxRangePx = maxRange;
    this.skipStateLabels = new Set(skipLabels);
    this.comboStepId = options.comboStepId ?? 'medium.ranged';
  }

  protected override onTick(context: OffensiveContext): NodeStatus {
    const opponent = context.opponent;
    if (opponent === null) {
      return NodeStatus.Failure;
    }

    if (!context.self.canAttack) {
      return NodeStatus.Failure;
    }

    const distance = Math.abs(opponent.distance);
    if (distance < this.minRangePx) {
      return NodeStatus.Failure; // too close — let melee branches handle it
    }
    if (distance > this.maxRangePx) {
      return NodeStatus.Failure; // too far — walk closer first
    }

    if (this.skipStateLabels.has(opponent.stateLabel)) {
      return NodeStatus.Failure; // projectile would be wasted
    }

    context.out.emit({ kind: 'special', comboStepId: this.comboStepId });
    return NodeStatus.Success;
  }

  /** Inspector for tests / debug overlays. */
  getMinRangePx(): number {
    return this.minRangePx;
  }

  /** Inspector for tests / debug overlays. */
  getMaxRangePx(): number {
    return this.maxRangePx;
  }

  /** Inspector for tests / debug overlays. */
  getComboStepId(): string {
    return this.comboStepId;
  }

  /** Inspector for tests / debug overlays — returns a fresh array. */
  getSkipStateLabels(): readonly OpponentStateLabel[] {
    return Array.from(this.skipStateLabels);
  }
}
