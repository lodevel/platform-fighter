/**
 * FireAttackLeaf — emits an attack press for one of the four
 * grounded {@link AttackKind}s (`jab`, `tilt`, `smash`, `special`).
 *
 * Behaviour
 * ---------
 *   1. No opponent (`ctx.opponent == null`)        → `Failure`.
 *   2. Bot can't attack right now (`self.canAttack === false`) →
 *      `Failure`. The startup/active/recovery state machine in
 *      `Character.attemptAttack` already gates re-presses; the leaf
 *      mirrors that gate so an enclosing Selector can fall through
 *      to a defensive/neutral branch instead of repeatedly pressing
 *      a press the runtime would just drop.
 *   3. Opponent outside the per-attack range → `Failure`. The bot
 *      must close the distance first (the offensive sequences put
 *      `MoveTowardOpponentLeaf` before this leaf, so this is a
 *      defensive guard for tickers that wire FireAttackLeaf
 *      stand-alone).
 *   4. All gates open → emit the attack, return `Success`.
 *
 * Determinism
 * -----------
 * Pure snapshot-in / emit-out. No randomness, no Blackboard mutation
 * — recognising that the attack actually *landed* is the controller
 * layer's job (see {@link
 * import('./registerLandedHit').registerLandedHit}). The leaf only
 * presses the button; the world tells us later whether the hit
 * connected.
 *
 * Why a single leaf parameterised by `attackKind` rather than four
 * separate classes?
 *
 *   • The press payload is the only behaviour that varies — the
 *     gating logic (alive opponent, can-attack, in-range) is
 *     identical for every attack. Parameterising keeps the four
 *     branches in lockstep and avoids the "I added jab but forgot to
 *     also gate tilt" class of bug.
 *
 *   • The forthcoming "execute follow-up" leaf reads the planned
 *     attack from the Blackboard at runtime, so it cannot pre-bake
 *     a class per attack kind anyway.
 */

import { LeafNode, NodeStatus } from '../behaviorTree/Node';
import type { AttackKind, OffensiveContext } from './types';

/** Construction options for {@link FireAttackLeaf}. */
export interface FireAttackOptions {
  /** Which grounded attack to press. */
  readonly attackKind: AttackKind;
  /**
   * Maximum opponent distance (absolute, design px) for the press
   * to fire. Beyond this range the leaf returns `Failure`. Tuned to
   * the underlying move's hitbox reach + a small slack buffer.
   * Must be positive.
   */
  readonly maxRangePx: number;
  /**
   * Optional debug label tagged onto the emit's `comboStepId`.
   * Defaults to `'neutral'` — used by the recognition leaf to set
   * the actual combo identifier (`'jab→tilt'` etc.) when a
   * follow-up fires.
   */
  readonly comboStepId?: string;
}

/**
 * Leaf that presses one of the four grounded {@link AttackKind}s
 * when the gates clear.
 */
export class FireAttackLeaf extends LeafNode<OffensiveContext> {
  private readonly attackKind: AttackKind;
  private readonly maxRangePx: number;
  private readonly comboStepId: string;

  /**
   * @param options Required — see {@link FireAttackOptions}.
   * @param name Optional debug label.
   */
  constructor(options: FireAttackOptions, name?: string) {
    super(name);
    if (!Number.isFinite(options.maxRangePx) || options.maxRangePx <= 0) {
      throw new Error(
        `FireAttackLeaf: maxRangePx must be > 0, got ` +
          String(options.maxRangePx),
      );
    }
    this.attackKind = options.attackKind;
    this.maxRangePx = options.maxRangePx;
    this.comboStepId = options.comboStepId ?? 'neutral';
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

    context.out.emit({
      kind: this.attackKind,
      comboStepId: this.comboStepId,
    });
    return NodeStatus.Success;
  }

  /** Inspector for tests / debug overlays. */
  getAttackKind(): AttackKind {
    return this.attackKind;
  }

  /** Inspector for tests / debug overlays. */
  getMaxRangePx(): number {
    return this.maxRangePx;
  }

  /** Inspector for tests / debug overlays. */
  getComboStepId(): string {
    return this.comboStepId;
  }
}
