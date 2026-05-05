/**
 * ShieldThreatLeaf — emits a `shield` press when the opponent is in a
 * threatening state (typically `'attacking'`) and within shield reach.
 *
 * Authored for AC 10204 Sub-AC 4 — the Medium-tier difficulty's
 * **defensive blocking logic**. Easy bots have no defence (they
 * hesitate but never block); Hard bots emphasise punish-game over
 * raw blocking. Medium tier sits in the middle: a bot that *reacts*
 * to the opponent's attack startup with a held shield, then drops it
 * to take the resulting punish window.
 *
 * Why a dedicated leaf
 * --------------------
 *
 *   1. Block decisions condition on the *opponent's* state label —
 *      something the existing offensive leaves (movement, attack
 *      press) deliberately do not read. Putting block in its own leaf
 *      keeps the Medium tier's defensive branch composable: tests can
 *      poke just the block leaf without spinning up the whole tree.
 *
 *   2. The block decision is *probabilistic* on Medium — the bot
 *      blocks reliably but not perfectly so it can still be punished
 *      by a player who mixes up grabs / delayed attacks. A separate
 *      leaf encapsulates the roll, keeping the determinism contract
 *      explicit (one `Rng.next()` consumed per gate-open tick).
 *
 *   3. Reuse — the forthcoming defensive sub-tree (out-of-shield
 *      attack, perfect parry, dodge) will compose this leaf alongside
 *      a `DropShieldLeaf` and a `PunishLeaf`. Establishing the API
 *      shape now avoids a refactor when the larger defence tree
 *      lands.
 *
 * Behaviour
 * ---------
 *
 *   1. No opponent (`ctx.opponent == null`)        → `Failure`. Lets
 *      the enclosing Selector fall through to whatever neutral /
 *      offensive branch comes next.
 *   2. Opponent outside `shieldRangePx`            → `Failure`. A
 *      smash startup from across the screen is not a threat *yet* —
 *      the bot should keep approaching / retreating instead of
 *      static-blocking.
 *   3. Opponent's `stateLabel` not in
 *      `threatStateLabels`                         → `Failure`. The
 *      bot only blocks against an *imminent* hitbox; blocking against
 *      a `recovering` opponent wastes the punish window.
 *   4. RNG roll lands above `shieldChance`         → `Failure`. The
 *      gate is open but the bot "chose" not to block this tick —
 *      makes Medium readable but not perfect. The roll consumes
 *      exactly one `Rng.next()`.
 *   5. All gates clear                             → emit a
 *      `{ kind: 'shield' }` action and return `Success`.
 *
 * Tunables
 * --------
 *
 *   - `shieldRangePx` defaults to 90 px — slightly wider than the
 *     longest grounded smash hitbox so the bot starts blocking before
 *     the smash can connect, accounting for the bot's own reaction
 *     latency (Medium's 22-28 frame perception window). Tighter for
 *     short-range characters; looser for projectile-heavy ones.
 *
 *   - `threatStateLabels` defaults to `['attacking']` — the canonical
 *     incoming-hit window. Callers can widen to `['attacking',
 *     'dodging']` to also block against frame-perfect rolls, or to
 *     `['attacking', 'airborne']` for an aerial-aware tier.
 *
 *   - `shieldChance` defaults to 0.7 — Medium tier's "balanced" block
 *     rate. The bot blocks ~70 % of the threats it can see; the
 *     remaining 30 % slip through because the bot mistimed or simply
 *     didn't pick the block branch. Hard tier (forthcoming) might run
 *     at 0.95; Easy tier omits the leaf entirely.
 *
 * Determinism
 * -----------
 *
 * Every roll goes through `ctx.rng.next()`. The leaf consumes exactly
 * one RNG value per tick **iff** the in-range / threatening-state
 * gates are open. Outside that gate, the leaf does not touch the RNG
 * — so two replays with the same seed and the same opponent timeline
 * produce byte-identical block decisions. Documented here so a
 * controller fanning the same RNG into other systems can reason
 * about consumption.
 */

import { LeafNode, NodeStatus } from '../behaviorTree/Node';
import type {
  OffensiveContext,
  OpponentStateLabel,
} from './types';

/** Construction options for {@link ShieldThreatLeaf}. */
export interface ShieldThreatOptions {
  /**
   * Maximum opponent distance (absolute, design pixels) at which the
   * bot considers an attacking opponent a real threat. Beyond this
   * the leaf returns `Failure`. Must be positive.
   */
  readonly shieldRangePx?: number;
  /**
   * Opponent state labels that trigger the block decision. Defaults
   * to `['attacking']` — the canonical "imminent hitbox" window.
   * Pass a wider list to react to dodges or aerials too.
   */
  readonly threatStateLabels?: readonly OpponentStateLabel[];
  /**
   * Probability in `[0, 1]` the bot blocks when the threat gate is
   * open. Defaults to {@link DEFAULT_MEDIUM_SHIELD_CHANCE}.
   * Validated at construction so misconfigured tiers fail loudly.
   */
  readonly shieldChance?: number;
  /**
   * Optional debug label tagged onto the emit's `comboStepId`.
   * Defaults to `'medium.shield'` — matches the Easy tier's
   * `'easy.idle'` naming so replay overlays can disambiguate
   * defensive emits from offensive ones.
   */
  readonly comboStepId?: string;
}

/** Default shield reach: 90 px — see module docstring. */
export const DEFAULT_SHIELD_RANGE_PX = 90;

/**
 * Default block rate for the Medium tier. ~70 % of detected threats
 * get blocked; the rest slip through, keeping the bot beatable and
 * making block reads feel earned.
 */
export const DEFAULT_MEDIUM_SHIELD_CHANCE = 0.7;

/**
 * Default threatening state labels — the opponent is in startup or
 * active frames of an attack. A frozen tuple so consumers can rely
 * on identity equality / immutability.
 */
export const DEFAULT_THREAT_STATE_LABELS: readonly OpponentStateLabel[] =
  Object.freeze<OpponentStateLabel[]>(['attacking']);

/**
 * Leaf that probabilistically emits a `shield` action when the
 * opponent is mid-attack within reach.
 */
export class ShieldThreatLeaf extends LeafNode<OffensiveContext> {
  private readonly shieldRangePx: number;
  private readonly threatStateLabels: ReadonlySet<OpponentStateLabel>;
  private readonly shieldChance: number;
  private readonly comboStepId: string;

  /**
   * @param options Optional — see {@link ShieldThreatOptions}. Throws
   *                on out-of-range `shieldChance` / non-positive
   *                `shieldRangePx`.
   * @param name Optional debug label, surfaced in tree dumps.
   */
  constructor(options: ShieldThreatOptions = {}, name?: string) {
    super(name);

    const range = options.shieldRangePx ?? DEFAULT_SHIELD_RANGE_PX;
    if (!Number.isFinite(range) || range <= 0) {
      throw new Error(
        `ShieldThreatLeaf: shieldRangePx must be > 0, got ` + String(range),
      );
    }

    const chance = options.shieldChance ?? DEFAULT_MEDIUM_SHIELD_CHANCE;
    if (!Number.isFinite(chance) || chance < 0 || chance > 1) {
      throw new Error(
        `ShieldThreatLeaf: shieldChance must be in [0, 1], got ` +
          String(chance),
      );
    }

    const labels = options.threatStateLabels ?? DEFAULT_THREAT_STATE_LABELS;
    if (labels.length === 0) {
      throw new Error(
        `ShieldThreatLeaf: threatStateLabels must include at least one label`,
      );
    }

    this.shieldRangePx = range;
    this.threatStateLabels = new Set(labels);
    this.shieldChance = chance;
    this.comboStepId = options.comboStepId ?? 'medium.shield';
  }

  protected override onTick(context: OffensiveContext): NodeStatus {
    const opponent = context.opponent;
    if (opponent === null) {
      return NodeStatus.Failure;
    }

    if (Math.abs(opponent.distance) > this.shieldRangePx) {
      return NodeStatus.Failure;
    }

    if (!this.threatStateLabels.has(opponent.stateLabel)) {
      return NodeStatus.Failure;
    }

    // Gates open — consume one RNG value to decide whether to block
    // *this* tick. Documented in the module-level doc so any caller
    // fanning the same RNG into other systems can reason about
    // consumption.
    const roll = context.rng.next();

    // `shieldChance === 0` short-circuits to a guaranteed Failure
    // (the strict `<` test below would already give that result, but
    // the explicit branch documents the "leaf disabled" contract).
    if (this.shieldChance === 0) {
      return NodeStatus.Failure;
    }

    if (roll < this.shieldChance) {
      context.out.emit({ kind: 'shield', comboStepId: this.comboStepId });
      return NodeStatus.Success;
    }
    return NodeStatus.Failure;
  }

  /** Inspector for tests / debug overlays. */
  getShieldRangePx(): number {
    return this.shieldRangePx;
  }

  /** Inspector for tests / debug overlays. */
  getShieldChance(): number {
    return this.shieldChance;
  }

  /** Inspector for tests / debug overlays. */
  getComboStepId(): string {
    return this.comboStepId;
  }

  /** Inspector for tests / debug overlays — returns a fresh array. */
  getThreatStateLabels(): readonly OpponentStateLabel[] {
    return Array.from(this.threatStateLabels);
  }
}
