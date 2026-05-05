/**
 * JumpRecoveryLeaf — the *first-jump* recovery press.
 *
 * Distinct from {@link DoubleJumpRecoveryLeaf} in that this leaf
 * fires the *grounded* jump press: the bot has slipped off the edge
 * of the stage but the engine has not yet processed enough frames to
 * leave the "still has grounded jump" window. In practice this is
 * the leaf that triggers when the bot dashes off a platform during a
 * combo — the controller still has its grounded jump plus its full
 * air-jump budget, and the cheapest recovery is to just press jump
 * before the air-jump counter starts decrementing.
 *
 * Behaviour
 * ---------
 *   1. Bot is in hitstun                 → `Failure`. Recovery
 *      branches must not press inputs while the engine is still
 *      processing knockback.
 *   2. Bot is on a ledge already         → `Failure`. The controller's
 *      ledge-release / get-up handler owns this state.
 *   3. Bot is grounded                   → `Failure`. No recovery
 *      work needed; the offensive sub-tree should run.
 *   4. Bot is airborne but ON-stage      → `Failure`. Skipping
 *      neutral air-jumping conserves the air-jump budget for an
 *      actual emergency. The *only* time this leaf consumes a press
 *      is when the bot is genuinely off the safe stage X range.
 *   5. Bot has zero air-jumps remaining  → `Failure`. The up-special
 *      leaf is the only press still available.
 *   6. The leaf has *already* emitted an air-jump within the last
 *      {@link JumpRecoveryOptions.repressCooldownFrames}            → `Failure`.
 *      Without this gate the leaf would emit `jump` on every Running
 *      tick the BT spent in this branch, burning every air-jump on
 *      consecutive frames.
 *   7. All gates open → emit `jump` (with `recoveryStep:
 *      'jumpRecovery'`), stamp the press tick into
 *      `recoveryLastAirJumpTick`, advance phase to `'airJumping'`,
 *      return `Success`.
 *
 * Why a separate leaf rather than one big "use any jump" leaf?
 *
 *   • Splitting the *grounded* press from the *air-jump* press gives
 *     the composer a place to insert the up-special re-press logic
 *     between them: a Hard-tier bot that has used its grounded jump
 *     but still has its air-jump should run *this* leaf again next
 *     tick, not skip straight to up-special. The split makes that
 *     composition explicit at the tree-shape level rather than
 *     hidden inside a single leaf's branching.
 *
 *   • The off-stage gate is identical for both leaves, but the
 *     re-press cooldown differs (`8` frames for the first jump press,
 *     `12` for double jump — air-jumps want a slightly longer hold
 *     so the bot's vertical momentum builds before the next press).
 *     Two leaves, two configurations.
 *
 * Determinism
 * -----------
 * Pure read-of-snapshot, write-of-action + Blackboard. No
 * `Math.random`, no wall-clock — given identical inputs the leaf
 * produces identical status + emit + Blackboard transitions every
 * time. Reset / replay-friendly because all latched state lives on
 * the Blackboard.
 */

import { LeafNode, NodeStatus } from '../behaviorTree/Node';
import {
  isOffStage,
  type RecoveryContext,
} from './types';

/** Construction options for {@link JumpRecoveryLeaf}. */
export interface JumpRecoveryOptions {
  /**
   * Minimum number of frames between consecutive `jump` presses.
   * Default `8` — short enough that the bot can chain a grounded
   * jump straight into an air-jump, long enough that a single
   * Running tick doesn't burn two jumps. Must be a non-negative
   * integer.
   */
  readonly repressCooldownFrames?: number;
  /**
   * Vertical slack added to the off-stage check so a bot teetering
   * exactly on the stage top isn't flagged as "off-stage" by
   * floating-point fuzz. Default `0`. Must be non-negative.
   */
  readonly verticalSlackPx?: number;
}

const DEFAULT_REPRESS_COOLDOWN_FRAMES = 8;
const DEFAULT_VERTICAL_SLACK_PX = 0;

/**
 * Leaf that emits the *first* jump press of a recovery sequence.
 */
export class JumpRecoveryLeaf extends LeafNode<RecoveryContext> {
  private readonly repressCooldownFrames: number;
  private readonly verticalSlackPx: number;

  /**
   * @param options Optional — see {@link JumpRecoveryOptions}.
   * @param name Optional debug label.
   */
  constructor(options: JumpRecoveryOptions = {}, name?: string) {
    super(name);
    const repress =
      options.repressCooldownFrames ?? DEFAULT_REPRESS_COOLDOWN_FRAMES;
    if (!Number.isFinite(repress) || repress < 0 || !Number.isInteger(repress)) {
      throw new Error(
        `JumpRecoveryLeaf: repressCooldownFrames must be a non-negative integer, got ` +
          String(repress),
      );
    }
    const slack = options.verticalSlackPx ?? DEFAULT_VERTICAL_SLACK_PX;
    if (!Number.isFinite(slack) || slack < 0) {
      throw new Error(
        `JumpRecoveryLeaf: verticalSlackPx must be ≥ 0, got ` + String(slack),
      );
    }
    this.repressCooldownFrames = repress;
    this.verticalSlackPx = slack;
  }

  protected override onTick(context: RecoveryContext): NodeStatus {
    const self = context.self;

    // 1. Hitstun lockout — let the engine resolve knockback first.
    if (self.isInHitstun) return NodeStatus.Failure;

    // 2. Already latched on a ledge — the ledge handler runs the show.
    if (self.isOnLedge) return NodeStatus.Failure;

    // 3. Grounded — no recovery needed; let the offensive sub-tree run.
    if (!self.isAirborne) return NodeStatus.Failure;

    // 4. Airborne but on-stage — conserve the air-jump.
    if (!isOffStage(self, context.stage, this.verticalSlackPx)) {
      return NodeStatus.Failure;
    }

    // 5. No jumps left — the up-special leaf is the only option now.
    if (self.jumpsRemaining <= 0) {
      return NodeStatus.Failure;
    }

    // 6. Re-press cooldown — don't machine-gun jumps across ticks.
    const blackboard = context.blackboard;
    const lastTick = blackboard.get('recoveryLastAirJumpTick') ?? -1;
    if (
      lastTick >= 0 &&
      context.tickIndex - lastTick < this.repressCooldownFrames
    ) {
      // Cooldown active — return Failure so the enclosing Selector
      // can drop down to the double-jump or up-special branch.
      return NodeStatus.Failure;
    }

    // 7. All gates open — emit the press, stamp the tick, advance phase.
    context.out.emit({
      kind: 'jump',
      recoveryStep: 'jumpRecovery',
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
  getVerticalSlackPx(): number {
    return this.verticalSlackPx;
  }
}
