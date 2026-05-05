/**
 * DoubleJumpRecoveryLeaf — the *air-jump* recovery press.
 *
 * The companion to {@link
 * import('./JumpRecoveryLeaf').JumpRecoveryLeaf}. While that leaf
 * fires the *first* jump press, this leaf is responsible for the
 * second (and any subsequent) air-jump in the recovery sequence: the
 * bot has consumed its initial jump, is still off-stage, and the
 * trajectory needs another vertical impulse before the up-special
 * has to commit.
 *
 * The Hard-tier policy this leaf encodes:
 *
 *   1. Conserve the air-jump until it actually helps. A bot that
 *      panic-double-jumps the moment it leaves the stage burns its
 *      single most valuable recovery resource. So this leaf only
 *      fires when:
 *
 *        a. the bot is already airborne *and* off-stage, AND
 *        b. the bot is *below* the nearest ledge by at least
 *           {@link DoubleJumpRecoveryOptions.ledgeBelowThresholdPx}
 *           — i.e. it actually needs the height — OR
 *        c. the bot is approaching a blast wall on its current
 *           trajectory (`isApproachingBlastZone`), in which case
 *           any vertical reset helps reduce the projection.
 *
 *   2. Save the up-special when the air-jump would suffice. The
 *      up-special is more valuable (longer rise, often invincible)
 *      so the policy prefers a double-jump first whenever possible.
 *      The up-special leaf only fires when this leaf has already
 *      been spent or the height deficit is too great for a jump.
 *
 *   3. Don't double-press. Like the first-jump leaf, this leaf
 *      enforces a re-press cooldown so a Running tick chain doesn't
 *      burn every air-jump on consecutive frames.
 *
 * Behaviour
 * ---------
 *   1. Bot is in hitstun                 → `Failure`.
 *   2. Bot is on a ledge already         → `Failure`.
 *   3. Bot is grounded                   → `Failure`.
 *   4. Bot is airborne but ON-stage      → `Failure`. Conserve the
 *                                          air-jump.
 *   5. Bot has zero air-jumps remaining  → `Failure`. Up-special
 *                                          must take over.
 *   6. Air-jump *would not help*         → `Failure`. Specifically,
 *      the bot is not below the nearest ledge by the required
 *      threshold AND is not approaching a blast wall. Lets the
 *      Selector fall through to up-special / ledge-return.
 *   7. Re-press cooldown still active    → `Failure`.
 *   8. All gates open → emit `jump` (with `recoveryStep:
 *      'doubleJumpRecovery'`), stamp the press tick into
 *      `recoveryLastAirJumpTick`, advance phase to `'airJumping'`,
 *      return `Success`.
 *
 * Determinism
 * -----------
 * Pure read-of-snapshot, write-of-action + Blackboard. No
 * `Math.random`, no wall-clock. Identical inputs always yield
 * identical outputs and Blackboard transitions.
 */

import { LeafNode, NodeStatus } from '../behaviorTree/Node';
import {
  isApproachingBlastZone,
  isOffStage,
  ledgeYOffset,
  type RecoveryContext,
} from './types';

/** Construction options for {@link DoubleJumpRecoveryLeaf}. */
export interface DoubleJumpRecoveryOptions {
  /**
   * Minimum number of frames between consecutive air-jump presses.
   * Default `12` — a touch longer than the first-jump leaf so the
   * bot's vertical momentum has time to build before the next press.
   * Must be a non-negative integer.
   */
  readonly repressCooldownFrames?: number;
  /**
   * Minimum vertical deficit (positive Y, ledge below bot is
   * negative; we test `ledgeYOffset > -threshold`) at which the
   * leaf considers the air-jump *useful*. Default `40 px` — roughly
   * one fighter-height of deficit before we burn the air-jump.
   * Must be ≥ 0.
   */
  readonly ledgeBelowThresholdPx?: number;
  /**
   * Frames-ahead used by the blast-zone projection check. Default
   * `30` (half a second). Lower than the up-special leaf's
   * lookahead because the air-jump is the *first* response — the
   * bot wants a slightly tighter trigger so it isn't constantly
   * burning air-jumps on borderline trajectories.
   */
  readonly blastZoneLookaheadFrames?: number;
  /**
   * Vertical slack added to the off-stage check (matches the
   * first-jump leaf's option). Default `0`.
   */
  readonly verticalSlackPx?: number;
}

const DEFAULT_REPRESS_COOLDOWN_FRAMES = 12;
const DEFAULT_LEDGE_BELOW_THRESHOLD_PX = 40;
const DEFAULT_BLAST_ZONE_LOOKAHEAD_FRAMES = 30;
const DEFAULT_VERTICAL_SLACK_PX = 0;

/**
 * Leaf that fires an air-jump recovery press once the conservation
 * policy decides it's worth burning the resource.
 */
export class DoubleJumpRecoveryLeaf extends LeafNode<RecoveryContext> {
  private readonly repressCooldownFrames: number;
  private readonly ledgeBelowThresholdPx: number;
  private readonly blastZoneLookaheadFrames: number;
  private readonly verticalSlackPx: number;

  /**
   * @param options Optional — see {@link DoubleJumpRecoveryOptions}.
   * @param name Optional debug label.
   */
  constructor(options: DoubleJumpRecoveryOptions = {}, name?: string) {
    super(name);
    const repress =
      options.repressCooldownFrames ?? DEFAULT_REPRESS_COOLDOWN_FRAMES;
    if (!Number.isFinite(repress) || repress < 0 || !Number.isInteger(repress)) {
      throw new Error(
        `DoubleJumpRecoveryLeaf: repressCooldownFrames must be a non-negative integer, got ` +
          String(repress),
      );
    }
    const threshold =
      options.ledgeBelowThresholdPx ?? DEFAULT_LEDGE_BELOW_THRESHOLD_PX;
    if (!Number.isFinite(threshold) || threshold < 0) {
      throw new Error(
        `DoubleJumpRecoveryLeaf: ledgeBelowThresholdPx must be ≥ 0, got ` +
          String(threshold),
      );
    }
    const lookahead =
      options.blastZoneLookaheadFrames ??
      DEFAULT_BLAST_ZONE_LOOKAHEAD_FRAMES;
    if (
      !Number.isFinite(lookahead) ||
      lookahead < 0 ||
      !Number.isInteger(lookahead)
    ) {
      throw new Error(
        `DoubleJumpRecoveryLeaf: blastZoneLookaheadFrames must be a non-negative integer, got ` +
          String(lookahead),
      );
    }
    const slack = options.verticalSlackPx ?? DEFAULT_VERTICAL_SLACK_PX;
    if (!Number.isFinite(slack) || slack < 0) {
      throw new Error(
        `DoubleJumpRecoveryLeaf: verticalSlackPx must be ≥ 0, got ` +
          String(slack),
      );
    }
    this.repressCooldownFrames = repress;
    this.ledgeBelowThresholdPx = threshold;
    this.blastZoneLookaheadFrames = lookahead;
    this.verticalSlackPx = slack;
  }

  protected override onTick(context: RecoveryContext): NodeStatus {
    const self = context.self;
    const stage = context.stage;

    if (self.isInHitstun) return NodeStatus.Failure;
    if (self.isOnLedge) return NodeStatus.Failure;
    if (!self.isAirborne) return NodeStatus.Failure;
    if (!isOffStage(self, stage, this.verticalSlackPx)) {
      return NodeStatus.Failure;
    }
    if (self.jumpsRemaining <= 0) return NodeStatus.Failure;

    // Conservation gate — the air-jump is only spent when it
    // actually helps:
    //
    //   • the bot is below the ledge by at least the threshold,
    //     OR
    //   • the bot is approaching a blast wall on the current
    //     trajectory.
    const ledgeDy = ledgeYOffset(self, stage);
    const ledgeIsBelowThreshold =
      ledgeDy !== null && ledgeDy < -this.ledgeBelowThresholdPx;
    const approaching = isApproachingBlastZone(
      self,
      stage,
      this.blastZoneLookaheadFrames,
    );
    if (!ledgeIsBelowThreshold && !approaching) {
      return NodeStatus.Failure;
    }

    // Re-press cooldown — don't machine-gun air-jumps.
    const blackboard = context.blackboard;
    const lastTick = blackboard.get('recoveryLastAirJumpTick') ?? -1;
    if (
      lastTick >= 0 &&
      context.tickIndex - lastTick < this.repressCooldownFrames
    ) {
      return NodeStatus.Failure;
    }

    context.out.emit({
      kind: 'jump',
      recoveryStep: 'doubleJumpRecovery',
    });
    blackboard.set('recoveryLastAirJumpTick', context.tickIndex);
    blackboard.set('recoveryPhase', 'airJumping');
    blackboard.set('recoveryPhaseStartTick', context.tickIndex);
    return NodeStatus.Success;
  }

  /** Inspector for tests / debug overlays. */
  getRepressCooldownFrames(): number {
    return this.repressCooldownFrames;
  }

  /** Inspector for tests / debug overlays. */
  getLedgeBelowThresholdPx(): number {
    return this.ledgeBelowThresholdPx;
  }

  /** Inspector for tests / debug overlays. */
  getBlastZoneLookaheadFrames(): number {
    return this.blastZoneLookaheadFrames;
  }

  /** Inspector for tests / debug overlays. */
  getVerticalSlackPx(): number {
    return this.verticalSlackPx;
  }
}
