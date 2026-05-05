/**
 * Cooldown decorator — locks the wrapped child out of being ticked for a
 * configurable number of frames after a triggering result.
 *
 * Each behavior-tree tick corresponds to exactly one fixed-step engine
 * frame (the AI is ticked from the same deterministic loop that drives
 * physics), so "frames" and "cooldown ticks" are interchangeable units.
 *
 * Trigger model
 *
 *   - `triggerOn: 'success'` (default) — start the cooldown after the
 *     child returns `Success`. Idiomatic for moves that have a recovery
 *     window: the bot should not re-attempt the same special move every
 *     frame just because it's available.
 *   - `triggerOn: 'failure'` — cool down on a Failure, useful when the
 *     bot should back off after a missed read.
 *   - `triggerOn: 'terminal'` — cool down on either Success or Failure.
 *
 * While cooling down
 *
 *   - The decorator returns `Failure` (the child is **not** ticked).
 *     Failure was chosen rather than Success because a Selector is the
 *     natural composite to wrap a cooled-down branch in: when the special
 *     move is on cooldown, fall through to the next alternative.
 *   - The remaining-frames counter decrements by one per tick.
 *
 * Optional initial cooldown
 *
 *   `startActive: true` arms the cooldown immediately on construction
 *   (and after each `reset()`). Useful for one-shot opening guards
 *   ("don't let the bot use this move in the first second of the match")
 *   without having to seed the timer manually.
 *
 * Determinism contract
 *
 *   The cooldown counter is the only mutable state. `reset()` restores it
 *   to its initial value (`0` for normal use, `durationFrames` when
 *   `startActive` is set), so a replay scrub or match restart cannot
 *   leak prior cooldown progress.
 */

import {
  DecoratorNode,
  NodeStatus,
  isFailure,
  isSuccess,
  isTerminal,
  type IBehaviorNode,
} from '../Node';

/** Which child status (re)starts the cooldown. */
export type CooldownTrigger = 'success' | 'failure' | 'terminal';

/** Construction options for {@link CooldownNode}. */
export interface CooldownOptions {
  /**
   * Length of the cooldown in BT ticks (= one fixed engine frame each).
   * Must be a positive integer.
   */
  readonly durationFrames: number;
  /** Which child status (re)starts the cooldown. Defaults to `'success'`. */
  readonly triggerOn?: CooldownTrigger;
  /**
   * If true, the decorator begins (and reset()s back into) cooldown so
   * the very first ticks return `Failure` until the timer drains.
   */
  readonly startActive?: boolean;
}

/**
 * Cooldown: blocks the child for `durationFrames` ticks after a trigger.
 *
 * @typeParam TContext User-defined context shape, forwarded unchanged to
 *                     the wrapped child.
 */
export class CooldownNode<TContext> extends DecoratorNode<TContext> {
  private readonly durationFrames: number;
  private readonly triggerOn: CooldownTrigger;
  /** Counter snapshot used by `reset()` so startActive survives resets. */
  private readonly initialRemainingFrames: number;
  /** Frames left in the active cooldown. `0` means the gate is open. */
  private remainingFrames: number;

  /**
   * @param child Wrapped child node. Reset (via super) on `reset()` so
   *              no stale running state leaks across cooldowns.
   * @param options Cooldown configuration.
   * @param name Optional debug label.
   */
  constructor(
    child: IBehaviorNode<TContext>,
    options: CooldownOptions,
    name?: string,
  ) {
    super(child, name);
    if (
      !Number.isInteger(options.durationFrames) ||
      options.durationFrames < 1
    ) {
      throw new Error(
        `CooldownNode${name ? ` "${name}"` : ''} requires durationFrames >= 1, got ${options.durationFrames}`,
      );
    }
    this.durationFrames = options.durationFrames;
    this.triggerOn = options.triggerOn ?? 'success';
    this.initialRemainingFrames = options.startActive
      ? options.durationFrames
      : 0;
    this.remainingFrames = this.initialRemainingFrames;
  }

  protected override onTick(context: TContext): NodeStatus {
    // Cooldown active — burn one frame and short-circuit to Failure
    // without touching the child. Selectors can therefore fall through
    // to the next alternative while the move is unavailable.
    if (this.remainingFrames > 0) {
      this.remainingFrames -= 1;
      return NodeStatus.Failure;
    }

    const status = this.child.tick(context);

    // Re-arm the cooldown if the child's terminal result matches the
    // configured trigger. Running tunnels through unchanged so partway
    // executions don't accidentally lock the gate.
    if (this.shouldTrigger(status)) {
      this.remainingFrames = this.durationFrames;
    }
    return status;
  }

  private shouldTrigger(status: NodeStatus): boolean {
    switch (this.triggerOn) {
      case 'success':
        return isSuccess(status);
      case 'failure':
        return isFailure(status);
      case 'terminal':
        return isTerminal(status);
    }
  }

  /**
   * Cascade reset into the child (via super) and restore the counter
   * to its initial value — `durationFrames` when `startActive` was set,
   * `0` otherwise — so post-reset behaviour mirrors a fresh construction.
   */
  override reset(): void {
    super.reset();
    this.remainingFrames = this.initialRemainingFrames;
  }

  /** Inspector — frames remaining in the active cooldown (0 if open). */
  getRemainingFrames(): number {
    return this.remainingFrames;
  }

  /** Convenience predicate — true while the gate is closed. */
  isOnCooldown(): boolean {
    return this.remainingFrames > 0;
  }

  /** Inspector — configured cooldown length. */
  getDurationFrames(): number {
    return this.durationFrames;
  }

  /** Inspector — configured trigger condition. */
  getTriggerOn(): CooldownTrigger {
    return this.triggerOn;
  }
}
