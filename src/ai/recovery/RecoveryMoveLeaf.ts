/**
 * RecoveryMoveLeaf — fires the up-special recovery move when the
 * jump-budget alone won't get the bot back to a ledge.
 *
 * The up-special is the most valuable recovery resource each
 * character has — once consumed in an airborne period it doesn't
 * refresh until the bot lands or grabs a ledge. The Hard-tier
 * policy this leaf encodes is "burn the up-special exactly once,
 * exactly when it's needed":
 *
 *   1. Don't press if the bot is on stage / grounded / on a ledge —
 *      these states make the up-special a wasted offensive option.
 *
 *   2. Don't press until air-jumps are spent OR the bot is in
 *      *imminent* blast-zone danger. The double-jump leaf already
 *      conserves the air-jump for "useful" moments; this leaf
 *      complements that policy by waiting for the moment after the
 *      air-jump has been spent (or the trajectory is too dangerous
 *      to wait).
 *
 *   3. Press exactly once per airborne period. Once
 *      `recoveryLastUpSpecialTick` is non-negative we refuse to
 *      re-press until the controller resets the recovery partition
 *      (on landing / ledge grab — see {@link clearRecoveryState}).
 *      This avoids the classic AI bug where a Running tick chain
 *      double-fires the up-special and the second press cancels
 *      the first one's hangtime.
 *
 *   4. Optionally bias the up-special angle by emitting `moveUp`
 *      and/or a horizontal nudge on the same tick. Owl's
 *      directional jump and Wolf's multiHitRising both read the
 *      stick at press time; emitting `moveUp` + a horizontal nudge
 *      toward the nearest ledge selects a recovery vector that
 *      actually points home.
 *
 * Behaviour
 * ---------
 *   1. Bot is in hitstun                  → `Failure`.
 *   2. Bot is on a ledge already          → `Failure`.
 *   3. Bot is grounded                    → `Failure`.
 *   4. Bot is airborne but ON-stage       → `Failure`.
 *   5. Up-special is unavailable (already
 *      consumed this air-time)            → `Failure`.
 *   6. We've already pressed up-special
 *      this airborne period (Blackboard
 *      latch)                             → `Failure`.
 *   7. Air-jumps still available AND the
 *      bot is not approaching a blast wall
 *      → `Failure`. Defer to the
 *      double-jump leaf — air-jumps first.
 *   8. All gates open → emit `upSpecial` (with optional `moveUp`
 *      + horizontal directional nudge), stamp the press tick into
 *      `recoveryLastUpSpecialTick`, advance phase to `'upSpecial'`,
 *      return `Success`.
 *
 * Determinism
 * -----------
 * Pure read-of-snapshot, write-of-action + Blackboard. No
 * `Math.random`, no wall-clock. Identical inputs always produce
 * identical outputs and Blackboard transitions.
 */

import { LeafNode, NodeStatus } from '../behaviorTree/Node';
import {
  isApproachingBlastZone,
  isOffStage,
  ledgeXOffset,
  type RecoveryContext,
} from './types';

/** Construction options for {@link RecoveryMoveLeaf}. */
export interface RecoveryMoveOptions {
  /**
   * Frames-ahead used by the blast-zone projection check. Default
   * `60` (one second). Higher than the double-jump leaf so the
   * up-special fires *before* the bot is locked into a death; the
   * up-special is the last line of defence and triggering early
   * is preferable to triggering on the wrong frame.
   */
  readonly blastZoneLookaheadFrames?: number;
  /**
   * Vertical slack added to the off-stage check. Default `0`.
   */
  readonly verticalSlackPx?: number;
  /**
   * If `true` (default), emit `moveUp` on the same tick as the
   * `upSpecial` press so directional / multi-hit up-specials read
   * a vertical stick and select the most-vertical recovery vector.
   */
  readonly emitMoveUp?: boolean;
  /**
   * If `true` (default), emit a horizontal nudge (`moveLeft` /
   * `moveRight`) toward the nearest ledge on the same tick as the
   * `upSpecial` press, biasing directional up-specials toward the
   * closest ledge corner. Disabled when there is no nearest ledge.
   */
  readonly emitDirectionalNudge?: boolean;
}

const DEFAULT_BLAST_ZONE_LOOKAHEAD_FRAMES = 60;
const DEFAULT_VERTICAL_SLACK_PX = 0;
const DEFAULT_EMIT_MOVE_UP = true;
const DEFAULT_EMIT_DIRECTIONAL_NUDGE = true;

/**
 * Leaf that fires the up-special recovery press once the
 * conservation policy decides the air-jump alone won't get the bot
 * back home.
 */
export class RecoveryMoveLeaf extends LeafNode<RecoveryContext> {
  private readonly blastZoneLookaheadFrames: number;
  private readonly verticalSlackPx: number;
  private readonly emitMoveUp: boolean;
  private readonly emitDirectionalNudge: boolean;

  /**
   * @param options Optional — see {@link RecoveryMoveOptions}.
   * @param name Optional debug label.
   */
  constructor(options: RecoveryMoveOptions = {}, name?: string) {
    super(name);
    const lookahead =
      options.blastZoneLookaheadFrames ??
      DEFAULT_BLAST_ZONE_LOOKAHEAD_FRAMES;
    if (
      !Number.isFinite(lookahead) ||
      lookahead < 0 ||
      !Number.isInteger(lookahead)
    ) {
      throw new Error(
        `RecoveryMoveLeaf: blastZoneLookaheadFrames must be a non-negative integer, got ` +
          String(lookahead),
      );
    }
    const slack = options.verticalSlackPx ?? DEFAULT_VERTICAL_SLACK_PX;
    if (!Number.isFinite(slack) || slack < 0) {
      throw new Error(
        `RecoveryMoveLeaf: verticalSlackPx must be ≥ 0, got ` + String(slack),
      );
    }
    this.blastZoneLookaheadFrames = lookahead;
    this.verticalSlackPx = slack;
    this.emitMoveUp = options.emitMoveUp ?? DEFAULT_EMIT_MOVE_UP;
    this.emitDirectionalNudge =
      options.emitDirectionalNudge ?? DEFAULT_EMIT_DIRECTIONAL_NUDGE;
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
    if (!self.upSpecialAvailable) return NodeStatus.Failure;

    const blackboard = context.blackboard;
    const lastTick = blackboard.get('recoveryLastUpSpecialTick') ?? -1;
    if (lastTick >= 0) {
      // Already pressed once this airborne period — no re-press.
      return NodeStatus.Failure;
    }

    // Conservation gate — only commit when air-jumps are spent OR
    // we're on a death trajectory.
    const approaching = isApproachingBlastZone(
      self,
      stage,
      this.blastZoneLookaheadFrames,
    );
    if (self.jumpsRemaining > 0 && !approaching) {
      return NodeStatus.Failure;
    }

    // Optional directional bias — emit BEFORE the upSpecial press
    // so the controller's input dispatcher sees the stick state on
    // the press frame.
    if (this.emitDirectionalNudge) {
      const dx = ledgeXOffset(self, stage);
      if (dx !== null && dx !== 0) {
        context.out.emit({
          kind: dx > 0 ? 'moveRight' : 'moveLeft',
          recoveryStep: 'upSpecial.bias',
        });
      }
    }
    if (this.emitMoveUp) {
      context.out.emit({
        kind: 'moveUp',
        recoveryStep: 'upSpecial.bias',
      });
    }

    // Commit the press.
    context.out.emit({
      kind: 'upSpecial',
      recoveryStep: 'upSpecial.commit',
    });
    blackboard.set('recoveryLastUpSpecialTick', context.tickIndex);
    blackboard.set('recoveryPhase', 'upSpecial');
    blackboard.set('recoveryPhaseStartTick', context.tickIndex);
    return NodeStatus.Success;
  }

  /** Inspector for tests / debug overlays. */
  getBlastZoneLookaheadFrames(): number {
    return this.blastZoneLookaheadFrames;
  }

  /** Inspector for tests / debug overlays. */
  getVerticalSlackPx(): number {
    return this.verticalSlackPx;
  }

  /** Inspector for tests / debug overlays. */
  getEmitMoveUp(): boolean {
    return this.emitMoveUp;
  }

  /** Inspector for tests / debug overlays. */
  getEmitDirectionalNudge(): boolean {
    return this.emitDirectionalNudge;
  }
}

/**
 * Reset the recovery partition fields that govern in-flight
 * recovery state. Called by the controller from its
 * `onLand` / `onLedgeGrab` hooks so the up-special latch and
 * jump-press cooldown reset cleanly between airborne periods.
 *
 * Mirrors `clearOffensiveCombo` in spirit — keeping the writer
 * inline lets sibling modules import it without depending on the
 * full controller.
 */
export function clearRecoveryState(
  blackboard: RecoveryContext['blackboard'],
): void {
  blackboard.set('recoveryPhase', 'idle');
  blackboard.set('recoveryPhaseStartTick', -1);
  blackboard.set('recoveryLastAirJumpTick', -1);
  blackboard.set('recoveryLastUpSpecialTick', -1);
  blackboard.set('ledgeMixupGrabTick', -1);
  blackboard.set('ledgeMixupGetUpOption', null);
  blackboard.set('ledgeMixupGetUpEmitTick', -1);
}
