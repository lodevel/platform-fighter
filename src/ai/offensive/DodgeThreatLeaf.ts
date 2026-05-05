/**
 * DodgeThreatLeaf — emits a `dodge` press as the *evasive* counterpart
 * to {@link import('./ShieldThreatLeaf').ShieldThreatLeaf}.
 *
 * Authored for AC 10203 Sub-AC 3 — the Medium-tier difficulty's
 * **basic defensive behavior (shielding/dodging)**. Where shield is a
 * sustained block that absorbs hits but trades the bot's punish window,
 * dodge is a brief i-frame burst that lets the bot side-step an attack
 * and emerge in position to retaliate. A Medium bot that *only* shields
 * reads as one-dimensional; mixing in occasional dodges produces the
 * "blocks reliably but also evades sometimes" feel the AC calls for.
 *
 * Why a separate leaf
 * -------------------
 *
 *   1. Shield and dodge gate on the same opponent state (`'attacking'`
 *      within reach) but emit different verbs and have different
 *      tunings. Pulling them into independent leaves keeps each one
 *      composable and individually testable — the Medium tree can mix
 *      both at chosen probabilities, and a future "evasive Medium"
 *      variant could swap in a third leaf without forking the tree.
 *
 *   2. The evasion decision is *probabilistic* on Medium and tuned much
 *      lower than block (default 0.20 vs shield's 0.70). A dedicated
 *      leaf encapsulates the roll, keeping the determinism contract
 *      explicit (one `Rng.next()` consumed per gate-open tick).
 *
 *   3. Reuse — the forthcoming defensive sub-tree (out-of-shield attack,
 *      perfect parry, dodge) will compose this leaf alongside
 *      `DropShieldLeaf` and a `PunishLeaf`. Establishing the API shape
 *      now avoids a refactor when the larger defence tree lands.
 *
 * Behaviour
 * ---------
 *
 *   1. No opponent (`ctx.opponent == null`)        → `Failure`. Lets
 *      the enclosing Selector fall through to whatever neutral /
 *      offensive branch comes next.
 *   2. Opponent outside `dodgeRangePx`             → `Failure`. A
 *      smash startup from across the screen is not a threat *yet* —
 *      the bot should keep approaching / retreating instead of
 *      static-dodging.
 *   3. Opponent's `stateLabel` not in
 *      `threatStateLabels`                         → `Failure`. The
 *      bot only dodges against an *imminent* hitbox; dodging against
 *      a `recovering` opponent wastes the punish window.
 *   4. RNG roll lands above `dodgeChance`          → `Failure`. The
 *      gate is open but the bot "chose" not to dodge this tick —
 *      makes Medium readable but not perfect. The roll consumes
 *      exactly one `Rng.next()`.
 *   5. All gates clear                             → emit a
 *      `{ kind: 'dodge' }` action and return `Success`.
 *
 * Tunables
 * --------
 *
 *   - `dodgeRangePx` defaults to 70 px — slightly tighter than shield's
 *     90 px because the i-frame window of a dodge is short; the bot
 *     wants the attacker close enough that the dodge actually lines up
 *     with the active frames. Tighter for short-range characters;
 *     looser for projectile-heavy ones.
 *
 *   - `threatStateLabels` defaults to `['attacking']` — the canonical
 *     incoming-hit window. Callers can widen to `['attacking',
 *     'shielding']` for an aggressive shield-poke variant, but the
 *     Medium baseline stays narrow so dodge fires only against real
 *     threats.
 *
 *   - `dodgeChance` defaults to 0.20 — Medium tier's "occasional dodge"
 *     rate. The bot dodges ~20 % of the threats it can see. With shield
 *     at 0.70 and dodge at 0.20, the combined coverage is ~76 %
 *     (1 - (1-0.20)(1-0.70)) when both leaves run sequentially in a
 *     Selector — roughly four out of five attacks get countered, which
 *     reads as "competent but beatable".
 *
 * Determinism
 * -----------
 *
 * Every roll goes through `ctx.rng.next()`. The leaf consumes exactly
 * one RNG value per tick **iff** the in-range / threatening-state
 * gates are open. Outside that gate, the leaf does not touch the RNG
 * — so two replays with the same seed and the same opponent timeline
 * produce byte-identical dodge decisions. Documented here so a
 * controller fanning the same RNG into other systems can reason about
 * consumption.
 */

import { LeafNode, NodeStatus } from '../behaviorTree/Node';
import type {
  OffensiveContext,
  OpponentStateLabel,
} from './types';

/** Construction options for {@link DodgeThreatLeaf}. */
export interface DodgeThreatOptions {
  /**
   * Maximum opponent distance (absolute, design pixels) at which the
   * bot considers an attacking opponent a real threat. Beyond this
   * the leaf returns `Failure`. Must be positive.
   */
  readonly dodgeRangePx?: number;
  /**
   * Opponent state labels that trigger the dodge decision. Defaults
   * to `['attacking']` — the canonical "imminent hitbox" window.
   * Pass a wider list to react to grabs (`'shielding'` adjacency) too.
   */
  readonly threatStateLabels?: readonly OpponentStateLabel[];
  /**
   * Probability in `[0, 1]` the bot dodges when the threat gate is
   * open. Defaults to {@link DEFAULT_MEDIUM_DODGE_CHANCE}.
   * Validated at construction so misconfigured tiers fail loudly.
   */
  readonly dodgeChance?: number;
  /**
   * Optional debug label tagged onto the emit's `comboStepId`.
   * Defaults to `'medium.dodge'` — matches the Easy tier's
   * `'easy.idle'` naming so replay overlays can disambiguate evasive
   * emits from defensive (shield) and offensive ones.
   */
  readonly comboStepId?: string;
}

/** Default dodge reach: 70 px — see module docstring. */
export const DEFAULT_DODGE_RANGE_PX = 70;

/**
 * Default dodge rate for the Medium tier. ~20 % of detected threats
 * get evaded; combined with shield's 70 % most threats get countered,
 * but a small fraction still slip through to keep the bot beatable.
 */
export const DEFAULT_MEDIUM_DODGE_CHANCE = 0.2;

/**
 * Default threatening state labels — the opponent is in startup or
 * active frames of an attack. A frozen tuple so consumers can rely
 * on identity equality / immutability.
 */
export const DEFAULT_DODGE_THREAT_STATE_LABELS: readonly OpponentStateLabel[] =
  Object.freeze<OpponentStateLabel[]>(['attacking']);

/**
 * Leaf that probabilistically emits a `dodge` action when the
 * opponent is mid-attack within reach.
 */
export class DodgeThreatLeaf extends LeafNode<OffensiveContext> {
  private readonly dodgeRangePx: number;
  private readonly threatStateLabels: ReadonlySet<OpponentStateLabel>;
  private readonly dodgeChance: number;
  private readonly comboStepId: string;

  /**
   * @param options Optional — see {@link DodgeThreatOptions}. Throws
   *                on out-of-range `dodgeChance` / non-positive
   *                `dodgeRangePx`.
   * @param name Optional debug label, surfaced in tree dumps.
   */
  constructor(options: DodgeThreatOptions = {}, name?: string) {
    super(name);

    const range = options.dodgeRangePx ?? DEFAULT_DODGE_RANGE_PX;
    if (!Number.isFinite(range) || range <= 0) {
      throw new Error(
        `DodgeThreatLeaf: dodgeRangePx must be > 0, got ` + String(range),
      );
    }

    const chance = options.dodgeChance ?? DEFAULT_MEDIUM_DODGE_CHANCE;
    if (!Number.isFinite(chance) || chance < 0 || chance > 1) {
      throw new Error(
        `DodgeThreatLeaf: dodgeChance must be in [0, 1], got ` +
          String(chance),
      );
    }

    const labels =
      options.threatStateLabels ?? DEFAULT_DODGE_THREAT_STATE_LABELS;
    if (labels.length === 0) {
      throw new Error(
        `DodgeThreatLeaf: threatStateLabels must include at least one label`,
      );
    }

    this.dodgeRangePx = range;
    this.threatStateLabels = new Set(labels);
    this.dodgeChance = chance;
    this.comboStepId = options.comboStepId ?? 'medium.dodge';
  }

  protected override onTick(context: OffensiveContext): NodeStatus {
    const opponent = context.opponent;
    if (opponent === null) {
      return NodeStatus.Failure;
    }

    if (Math.abs(opponent.distance) > this.dodgeRangePx) {
      return NodeStatus.Failure;
    }

    if (!this.threatStateLabels.has(opponent.stateLabel)) {
      return NodeStatus.Failure;
    }

    // `dodgeChance === 0` short-circuits to a guaranteed Failure
    // *without* burning RNG, so a `dodgeChance: 0` configuration is
    // truly a no-op (matches ShieldThreatLeaf's `shieldChance === 0`
    // contract).
    if (this.dodgeChance === 0) {
      return NodeStatus.Failure;
    }

    // Gates open — consume one RNG value to decide whether to dodge
    // *this* tick. Documented in the module-level doc so any caller
    // fanning the same RNG into other systems can reason about
    // consumption.
    const roll = context.rng.next();

    if (roll < this.dodgeChance) {
      context.out.emit({ kind: 'dodge', comboStepId: this.comboStepId });
      return NodeStatus.Success;
    }
    return NodeStatus.Failure;
  }

  /** Inspector for tests / debug overlays. */
  getDodgeRangePx(): number {
    return this.dodgeRangePx;
  }

  /** Inspector for tests / debug overlays. */
  getDodgeChance(): number {
    return this.dodgeChance;
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
