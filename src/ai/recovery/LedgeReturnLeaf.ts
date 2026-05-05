/**
 * LedgeReturnLeaf — drives the bot toward the nearest grabbable
 * ledge corner once it has the height to reach it.
 *
 * The "last mile" of recovery: jump and up-special leaves get the
 * bot vertically aligned with the stage; this leaf nudges them
 * horizontally onto the ledge corner so the engine's ledge-grab
 * detection latches them. The actual ledge grab is handled by
 * {@link import('../../characters/ledgeDetection').detectLedgeGrab}
 * in the engine — this leaf's job is just to keep the bot moving
 * toward the ledge column.
 *
 * Behaviour
 * ---------
 *   1. Bot is in hitstun                  → `Failure`.
 *   2. Bot is on a ledge already          → `Success`. Recovery
 *      complete; consume the tick so the enclosing Selector
 *      doesn't fall through to the offensive sub-tree mid-grab.
 *   3. Bot is grounded                    → `Failure`.
 *   4. Bot is airborne but ON-stage       → `Failure`. The bot has
 *      already landed back on the safe stage X range — recovery
 *      branches step out of the way.
 *   5. No registered nearest ledge        → `Failure`. Stages
 *      without grabbable ledges (e.g. the flat tutorial stage)
 *      can't return-to-ledge; let the controller fall through.
 *   6. Bot is *above* the ledge corner    → `Failure`. The bot
 *      has overshot vertically; the next tick the up-special's
 *      hangtime decay will lower it into range. Returning Failure
 *      lets the Selector fall through to a (future) airdodge
 *      branch or back to neutral.
 *   7. Bot is roughly aligned with the ledge column (within
 *      `arrivalToleranceXPx`) → emit `idle`, return `Running`.
 *      The ledge grab is imminent; don't push the bot past the
 *      corner.
 *   8. Otherwise → emit `moveLeft`/`moveRight` toward the ledge,
 *      and on the *first* tick of the ledgeReturn phase advance
 *      the Blackboard's `recoveryPhase` to `'ledgeReturn'`.
 *      Return `Running`.
 *
 * Determinism
 * -----------
 * Pure read-of-snapshot, write-of-action + Blackboard. No
 * `Math.random`, no wall-clock — given identical inputs the leaf
 * produces identical status + emits + Blackboard transitions every
 * time.
 */

import { LeafNode, NodeStatus } from '../behaviorTree/Node';
import {
  ledgeXOffset,
  ledgeYOffset,
  type RecoveryContext,
} from './types';

/** Construction options for {@link LedgeReturnLeaf}. */
export interface LedgeReturnOptions {
  /**
   * Horizontal alignment tolerance in design pixels. Once the bot
   * is within this many px of the ledge X column the leaf stops
   * pushing horizontal input and returns `Running` so the engine's
   * ledge-grab magnetism takes over. Default `12 px` — slightly
   * tighter than the engine's default ledge-grab horizontal range.
   * Must be ≥ 0.
   */
  readonly arrivalToleranceXPx?: number;
  /**
   * Vertical tolerance below the ledge corner. Bot positionY values
   * `<= ledge.y - overshootToleranceYPx` are considered "above the
   * ledge" and the leaf returns `Failure` so the up-special's
   * hangtime decay can lower the bot into range. Default `8 px`.
   * Must be ≥ 0.
   */
  readonly overshootToleranceYPx?: number;
}

const DEFAULT_ARRIVAL_TOLERANCE_X_PX = 12;
const DEFAULT_OVERSHOOT_TOLERANCE_Y_PX = 8;

/**
 * Leaf that nudges the bot horizontally onto the nearest ledge
 * corner during the last phase of recovery.
 */
export class LedgeReturnLeaf extends LeafNode<RecoveryContext> {
  private readonly arrivalToleranceXPx: number;
  private readonly overshootToleranceYPx: number;

  /**
   * @param options Optional — see {@link LedgeReturnOptions}.
   * @param name Optional debug label.
   */
  constructor(options: LedgeReturnOptions = {}, name?: string) {
    super(name);
    const arrival =
      options.arrivalToleranceXPx ?? DEFAULT_ARRIVAL_TOLERANCE_X_PX;
    if (!Number.isFinite(arrival) || arrival < 0) {
      throw new Error(
        `LedgeReturnLeaf: arrivalToleranceXPx must be ≥ 0, got ` +
          String(arrival),
      );
    }
    const overshoot =
      options.overshootToleranceYPx ?? DEFAULT_OVERSHOOT_TOLERANCE_Y_PX;
    if (!Number.isFinite(overshoot) || overshoot < 0) {
      throw new Error(
        `LedgeReturnLeaf: overshootToleranceYPx must be ≥ 0, got ` +
          String(overshoot),
      );
    }
    this.arrivalToleranceXPx = arrival;
    this.overshootToleranceYPx = overshoot;
  }

  protected override onTick(context: RecoveryContext): NodeStatus {
    const self = context.self;
    const stage = context.stage;

    if (self.isInHitstun) return NodeStatus.Failure;

    // Already grabbed a ledge — recovery succeeded; consume the
    // tick so the enclosing Selector doesn't immediately fall
    // through to the offensive sub-tree on the same frame.
    if (self.isOnLedge) {
      // Mark recovery complete in the Blackboard so the controller
      // can observe the transition (and clear via clearRecoveryState
      // on the engine's onLedgeGrab callback).
      context.blackboard.set('recoveryPhase', 'idle');
      return NodeStatus.Success;
    }

    if (!self.isAirborne) return NodeStatus.Failure;

    // Bot has drifted *clearly* back into the safe X range AND is
    // above the stage top — they're effectively recovered without
    // needing a ledge grab; let other branches handle the situation.
    //
    // The check uses `arrivalToleranceXPx` of headroom inside the
    // stage so a bot hovering exactly at the ledge corner (which
    // sits at `stageLeft` / `stageRight`) still drives this leaf's
    // ledge-grab logic. Without the buffer the leaf would bail right
    // when the bot most needs the final nudge.
    if (
      self.positionX > stage.stageLeft + this.arrivalToleranceXPx &&
      self.positionX < stage.stageRight - this.arrivalToleranceXPx &&
      self.positionY < stage.stageTop
    ) {
      return NodeStatus.Failure;
    }

    // No grabbable ledge registered — nothing to push toward.
    if (stage.nearestLedge === null) return NodeStatus.Failure;

    // Bot is *above* the ledge corner — overshot vertically. Let
    // the upSpecial / fall physics lower us into range.
    const dy = ledgeYOffset(self, stage);
    if (dy !== null && dy > this.overshootToleranceYPx) {
      // dy > 0 means ledge is below bot (Y grows down). Above the
      // ledge by more than the tolerance — wait for descent.
      return NodeStatus.Failure;
    }

    const dx = ledgeXOffset(self, stage);
    if (dx === null) return NodeStatus.Failure;

    const blackboard = context.blackboard;
    if (blackboard.get('recoveryPhase') !== 'ledgeReturn') {
      blackboard.set('recoveryPhase', 'ledgeReturn');
      blackboard.set('recoveryPhaseStartTick', context.tickIndex);
    }

    if (Math.abs(dx) <= this.arrivalToleranceXPx) {
      // Aligned with the ledge column — let the engine's ledge
      // magnetism finish the grab; emit idle so the controller
      // sees an explicit "do nothing" rather than no emit at all.
      context.out.emit({ kind: 'idle', recoveryStep: 'ledge.arrive' });
      return NodeStatus.Running;
    }

    context.out.emit({
      kind: dx > 0 ? 'moveRight' : 'moveLeft',
      recoveryStep: 'ledge.return',
    });
    return NodeStatus.Running;
  }

  /** Inspector for tests / debug overlays. */
  getArrivalToleranceXPx(): number {
    return this.arrivalToleranceXPx;
  }

  /** Inspector for tests / debug overlays. */
  getOvershootToleranceYPx(): number {
    return this.overshootToleranceYPx;
  }
}
