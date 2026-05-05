/**
 * EdgeGuardLeaf — the Hard-tier offensive leaf that pursues an
 * off-stage opponent and presses the appropriate finisher (smash or
 * special) once the bot is anchored at the threatened ledge corner.
 *
 * Behaviour
 * ---------
 *
 *   1. No opponent (`ctx.opponent == null`)             → `Failure`.
 *   2. Missing kinematic data on the snapshot            → `Failure`.
 *      The leaf is *only* used by the Hard tier, which always ships
 *      `position` + `velocity`; failing fast keeps a misconfigured
 *      controller from silently spinning.
 *   3. Missing stage geometry (`ctx.stage == null`)      → `Failure`.
 *   4. Bot is itself airborne or in hitstun              → `Failure`.
 *      Hard-tier edge-guarding stays grounded; the recovery sub-tree
 *      handles airborne bot priorities.
 *   5. {@link shouldCommitEdgeGuard} returns `false`     → `Failure`.
 *      Lets the enclosing Selector fall through to the offensive
 *      neutral / combo branches.
 *   6. Bot is *not yet anchored* at the ledge corner     → emit the
 *      appropriate `moveLeft` / `moveRight` and return `Running`.
 *   7. Bot is anchored AND `self.canAttack` AND the attack picker
 *      yields a non-null verb                           → emit the
 *      attack and return `Success`.
 *   8. Bot is anchored but `self.canAttack === false`    → idle emit
 *      and `Running` (waiting for the previous move to clear).
 *
 * Why a leaf rather than another sequence?
 * ----------------------------------------
 *
 * Edge-guarding is a *single coherent intent* on the bot's side: walk
 * to the corner, then throw an attack. Encoding it as one leaf lets
 * the Hard offensive tree express it as a single Selector child:
 *
 *     Selector("hardOffensive")
 *       ├── EdgeGuardLeaf      ← this leaf
 *       ├── … combo / KO / neutral branches …
 *
 * Splitting the "walk + press" across a Sequence + sub-leaves would
 * require the conditional-commit predicate to run twice per tick
 * (once to gate the Sequence, again inside the press leaf). A single
 * leaf evaluates the predicate once per tick, which is both cheaper
 * and simpler to reason about for the replay system.
 *
 * Determinism
 * -----------
 *
 * Pure read-of-snapshot, write-of-action. No `Math.random`, no
 * wall-clock. The same `(opponent, stage, self)` inputs always
 * produce the same status + emit sequence.
 */

import { LeafNode, NodeStatus } from '../behaviorTree/Node';
import {
  DEFAULT_LEDGE_ANCHOR_TOLERANCE_PX,
  DEFAULT_OFFSTAGE_HORIZONTAL_SLACK_PX,
  DEFAULT_OFFSTAGE_VERTICAL_SLACK_PX,
  DEFAULT_SMASH_VERTICAL_REACH_PX,
  chooseEdgeGuardAttack,
  edgeGuardAnchorX,
  nearestStageEdge,
  shouldCommitEdgeGuard,
} from './edgeGuardPolicy';
import {
  DEFAULT_DI_BIAS_MAGNITUDE,
  DEFAULT_DI_LOOKAHEAD_FRAMES,
  predictedRecoveryEdge,
} from './diPrediction';
import type { OffensiveContext } from './types';

/** Construction options for {@link EdgeGuardLeaf}. */
export interface EdgeGuardOptions {
  /**
   * Horizontal slack (design pixels) added to the stage edges before
   * an opponent counts as off-stage. Defaults to
   * {@link DEFAULT_OFFSTAGE_HORIZONTAL_SLACK_PX}.
   */
  readonly horizontalSlackPx?: number;
  /**
   * Vertical slack below the stage top before an opponent counts as
   * off-stage. Defaults to {@link DEFAULT_OFFSTAGE_VERTICAL_SLACK_PX}.
   */
  readonly verticalSlackPx?: number;
  /**
   * Tolerance band around the ledge anchor X inside which the bot is
   * considered "anchored" and ready to throw the attack. Defaults to
   * {@link DEFAULT_LEDGE_ANCHOR_TOLERANCE_PX}.
   */
  readonly anchorTolerancePx?: number;
  /**
   * Vertical reach of the smash hitbox below the stage top. Beyond
   * this band the leaf falls through to the special (or returns
   * Failure when {@link enableSpecial} is `false`). Defaults to
   * {@link DEFAULT_SMASH_VERTICAL_REACH_PX}.
   */
  readonly smashVerticalReachPx?: number;
  /**
   * When `false` the leaf will not press a special as a fallback for
   * an opponent below the smash band — it returns `Running` (still
   * anchored but unable to land a hit). Defaults to `true`.
   */
  readonly enableSpecial?: boolean;
  /**
   * When `true` the leaf picks the anchor ledge using the DI-aware
   * {@link predictedRecoveryEdge} predicate (Sub-AC 5: "DI
   * prediction"). When `false` (default for backward compatibility)
   * the leaf uses the simpler {@link nearestStageEdge} which reads
   * the opponent's *current* X.
   *
   * Hard-tier callers should opt in to enjoy the upgraded edge-guard
   * accuracy against competent recovery DI; Easy / Medium tiers leave
   * it `false`.
   */
  readonly useDIPrediction?: boolean;
  /**
   * Lookahead horizon (fixed steps) the DI projection uses when
   * {@link useDIPrediction} is enabled. Defaults to
   * {@link DEFAULT_DI_LOOKAHEAD_FRAMES}.
   */
  readonly diLookaheadFrames?: number;
  /**
   * Per-frame DI bias magnitude (design pixels) the projection
   * applies when {@link useDIPrediction} is enabled. Defaults to
   * {@link DEFAULT_DI_BIAS_MAGNITUDE}.
   */
  readonly diBiasMagnitude?: number;
}

/**
 * Leaf that anchors the bot at the threatened ledge corner and
 * presses the appropriate finisher. Used as the first child of the
 * Hard-tier offensive Selector so it overrides the neutral/combo
 * branches whenever an off-stage opponent is in reach.
 */
export class EdgeGuardLeaf extends LeafNode<OffensiveContext> {
  private readonly horizontalSlackPx: number;
  private readonly verticalSlackPx: number;
  private readonly anchorTolerancePx: number;
  private readonly smashVerticalReachPx: number;
  private readonly enableSpecial: boolean;
  private readonly useDIPrediction: boolean;
  private readonly diLookaheadFrames: number;
  private readonly diBiasMagnitude: number;

  /**
   * @param options Optional — see {@link EdgeGuardOptions}. All fields
   *                default to the documented Hard-tier tunables.
   * @param name Optional debug label.
   */
  constructor(options: EdgeGuardOptions = {}, name?: string) {
    super(name);
    this.horizontalSlackPx =
      options.horizontalSlackPx ?? DEFAULT_OFFSTAGE_HORIZONTAL_SLACK_PX;
    this.verticalSlackPx =
      options.verticalSlackPx ?? DEFAULT_OFFSTAGE_VERTICAL_SLACK_PX;
    this.anchorTolerancePx =
      options.anchorTolerancePx ?? DEFAULT_LEDGE_ANCHOR_TOLERANCE_PX;
    this.smashVerticalReachPx =
      options.smashVerticalReachPx ?? DEFAULT_SMASH_VERTICAL_REACH_PX;
    this.enableSpecial = options.enableSpecial !== false;
    this.useDIPrediction = options.useDIPrediction === true;
    this.diLookaheadFrames =
      options.diLookaheadFrames ?? DEFAULT_DI_LOOKAHEAD_FRAMES;
    this.diBiasMagnitude =
      options.diBiasMagnitude ?? DEFAULT_DI_BIAS_MAGNITUDE;
  }

  protected override onTick(context: OffensiveContext): NodeStatus {
    const opponent = context.opponent;
    if (opponent === null) return NodeStatus.Failure;

    // Hard requirements — the leaf is Hard-tier only and explicitly
    // refuses to operate without the kinematic + stage data the
    // Hard-tier perception pipeline ships.
    const stage = context.stage;
    if (!stage) return NodeStatus.Failure;
    if (!opponent.position) return NodeStatus.Failure;

    // The bot must be on stage to commit; airborne bots defer to the
    // recovery sub-tree.
    if (context.self.isAirborne) return NodeStatus.Failure;

    const selfX =
      context.selfPosition?.x ??
      (opponent.position.x - opponent.distance);
    if (!Number.isFinite(selfX)) return NodeStatus.Failure;

    const commit = shouldCommitEdgeGuard({
      opponent,
      selfX,
      selfIsAirborne: context.self.isAirborne,
      stage,
      horizontalSlackPx: this.horizontalSlackPx,
      verticalSlackPx: this.verticalSlackPx,
    });
    if (!commit) return NodeStatus.Failure;

    // DI-aware ledge selection (Sub-AC 5). When enabled, the leaf
    // projects the opponent's hitstun trajectory accounting for
    // their predicted DI input and picks the side they are most
    // likely to recover *to* — not the side they are *currently*
    // on. When disabled, the simpler "nearest current side"
    // predicate runs (back-compat behaviour for non-Hard tiers).
    const side = this.useDIPrediction
      ? predictedRecoveryEdge({
          opponent,
          stage,
          lookaheadFrames: this.diLookaheadFrames,
          diBiasMagnitude: this.diBiasMagnitude,
        })
      : nearestStageEdge(opponent.position.x, stage);
    const anchor = edgeGuardAnchorX(side, stage, this.anchorTolerancePx);
    const distanceToAnchor = anchor - selfX;

    if (Math.abs(distanceToAnchor) > this.anchorTolerancePx) {
      // Still walking to the anchor — emit the appropriate movement
      // verb and stay Running. The next tick re-evaluates the
      // commit predicate from scratch (so a sudden opponent recovery
      // back onto the stage drops us out of the branch cleanly).
      context.out.emit({
        kind: distanceToAnchor > 0 ? 'moveRight' : 'moveLeft',
      });
      return NodeStatus.Running;
    }

    // Anchored. If the bot can't attack yet (cooldown / recovery
    // frames from a prior move) we hold position and wait —
    // emitting `idle` keeps the replay overlay tidy and prevents the
    // outer Selector from falling through to a different branch
    // mid-anchor.
    if (!context.self.canAttack) {
      context.out.emit({ kind: 'idle', comboStepId: 'edgeGuard.wait' });
      return NodeStatus.Running;
    }

    const attack = chooseEdgeGuardAttack(opponent.position.y, stage.stageTop, {
      smashVerticalReachPx: this.smashVerticalReachPx,
      enableSpecial: this.enableSpecial,
    });
    if (attack.kind === null) {
      // Anchored but no viable attack this tick. Hold position
      // (idle) so we don't accidentally walk off the stage chasing
      // the opponent further down. Returning Running is correct —
      // the bot is still committed; the next tick may either find a
      // viable attack window or drop the commit when the opponent
      // recovers.
      context.out.emit({ kind: 'idle', comboStepId: 'edgeGuard.hold' });
      return NodeStatus.Running;
    }

    context.out.emit({ kind: attack.kind, comboStepId: attack.comboStepId });
    return NodeStatus.Success;
  }

  /** Inspector for tests / debug overlays. */
  getAnchorTolerancePx(): number {
    return this.anchorTolerancePx;
  }

  /** Inspector for tests / debug overlays. */
  getSmashVerticalReachPx(): number {
    return this.smashVerticalReachPx;
  }

  /** Inspector for tests / debug overlays. */
  isSpecialEnabled(): boolean {
    return this.enableSpecial;
  }

  /** Inspector for tests / debug overlays — DI prediction enabled? */
  isDIPredictionEnabled(): boolean {
    return this.useDIPrediction;
  }
}
