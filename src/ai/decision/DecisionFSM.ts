/**
 * DecisionFSM — strategic finite state machine driving a bot's
 * approach / attack / defend / recover / retreat behaviour
 * (AC 20202 Sub-AC 2).
 *
 * The five-state FSM is the strategic counterpart to the per-tier
 * tactical behavior trees authored in AC 18 / AC 19. Where a tactical
 * leaf answers "given this micro-situation, what is the next press?",
 * the FSM answers "given the current world state, what is the bot
 * trying to do this moment?" — a higher-level intent label whose
 * gate predicates produce a stable, named state transition surface.
 *
 * Why a class on top of pure functions
 * ------------------------------------
 *
 * The transition resolver ({@link resolveDecisionState}) and the per-
 * state heuristics ({@link selectActionsForState}) are pure functions
 * — fully testable on their own. The class adds three pieces of
 * controller plumbing that pure functions can't model on their own:
 *
 *   1. **Last-state cache** — debug overlays / diagnostic HUDs want
 *      to read the bot's current strategic intent without re-ticking
 *      the FSM. The class exposes `getCurrentState()` for that.
 *
 *   2. **Transition observer** — controller code may want to fire a
 *      side effect when the bot transitions between states (e.g. log
 *      "approach → attack" for the replay debug log, reset a defend
 *      cooldown when entering `defend` for the first time after an
 *      `attack`, etc.). The class accepts an optional `onTransition`
 *      callback that fires only when the *previous* and *current*
 *      tick states differ.
 *
 *   3. **Resolved option caching** — the policy options are resolved
 *      once at construction so per-tick `resolveDecisionState` calls
 *      skip the resolution pass. Important because the FSM is hot-
 *      path: it ticks 60 times per second per bot.
 *
 * Determinism contract
 * --------------------
 *
 *   • The class never reads `Math.random()` or wall-clock time. Every
 *     non-deterministic input flows through `ctx.rng` (the seeded
 *     PRNG the controller threads in) — `defend` is the only state
 *     that consumes the Rng (single `next()` per tick). All other
 *     states are pure on their inputs.
 *   • `tick(ctx, out)` is idempotent on `(ctx, rng-state-at-tick)` —
 *     ticking twice with the same context and a re-seeded Rng yields
 *     the same emit batch and the same final state.
 *   • `reset()` snaps the FSM back to the post-construction state
 *     (current state cleared to `null`, transition observer not
 *     re-fired). Replay scrub / match restart use this.
 */

import {
  resolveDecisionPolicyOptions,
  resolveDecisionState,
  type DecisionPolicyOptions,
  type ResolvedDecisionPolicyOptions,
} from './decisionPolicy';
import {
  resolveMoveSelectionOptions,
  selectActionsForState,
  type MoveSelectionOptions,
  type ResolvedMoveSelectionOptions,
} from './moveSelectionHeuristics';
import type {
  DecisionAction,
  DecisionActionWriter,
  DecisionContext,
  DecisionState,
} from './types';

// ---------------------------------------------------------------------------
// Construction options
// ---------------------------------------------------------------------------

/**
 * Construction options for {@link DecisionFSM}.
 *
 *   - `policy`        — partial policy options, see
 *                       {@link DecisionPolicyOptions}. Defaults are
 *                       applied via
 *                       {@link resolveDecisionPolicyOptions}.
 *   - `moveSelection` — partial move-selection options, see
 *                       {@link MoveSelectionOptions}. The FSM
 *                       internally resolves these once and caches the
 *                       result.
 *   - `onTransition`  — optional callback fired on every state change.
 *                       The callback receives the previous and new
 *                       state plus the tick index of the transition.
 *                       Not fired on the very first tick (when there
 *                       is no previous state).
 *   - `name`          — optional human-readable label (debug output).
 */
export interface DecisionFSMOptions {
  readonly policy?: DecisionPolicyOptions;
  readonly moveSelection?: MoveSelectionOptions;
  readonly onTransition?: DecisionFSMTransitionCallback;
  readonly name?: string;
}

/**
 * Callback signature for FSM state transitions.
 *
 *   - `from`      — the previous tick's state.
 *   - `to`        — the current tick's state (always different from `from`).
 *   - `tickIndex` — the tick index on which the transition fired.
 */
export type DecisionFSMTransitionCallback = (
  from: DecisionState,
  to: DecisionState,
  tickIndex: number,
) => void;

/**
 * Snapshot of the FSM's current state, returned by
 * {@link DecisionFSM.snapshot} for debug overlays / replay tooling.
 *
 *   - `currentState`   — the last resolved state, or `null` before
 *                        the first tick.
 *   - `lastEmitCount`  — number of actions the last `tick()` emitted.
 *   - `tickCount`      — number of ticks since construction or
 *                        `reset()`.
 */
export interface DecisionFSMSnapshot {
  readonly currentState: DecisionState | null;
  readonly lastEmitCount: number;
  readonly tickCount: number;
}

// ---------------------------------------------------------------------------
// Public class
// ---------------------------------------------------------------------------

/**
 * Strategic decision-making FSM. Construct once per bot, tick once
 * per fixed step, reset on match restart / replay scrub.
 *
 * @example Standalone usage
 * ```ts
 * const fsm = new DecisionFSM({ name: 'bot.slot1' });
 * const emits: DecisionAction[] = [];
 * const out: DecisionActionWriter = { emit: (a) => emits.push(a) };
 *
 * function onAiFrame(ctx: DecisionContext): void {
 *   fsm.tick(ctx, out);
 * }
 * ```
 *
 * @example With transition observer
 * ```ts
 * const fsm = new DecisionFSM({
 *   onTransition: (from, to, tick) => {
 *     console.log(`[ai] tick ${tick}: ${from} → ${to}`);
 *   },
 * });
 * ```
 */
export class DecisionFSM {
  /** Optional debug label, never read by the runtime. */
  public readonly name: string | undefined;

  private readonly resolvedPolicy: ResolvedDecisionPolicyOptions;
  private readonly resolvedMoveSelection: ResolvedMoveSelectionOptions;
  private readonly onTransition: DecisionFSMTransitionCallback | null;

  private currentState: DecisionState | null = null;
  private lastEmitCount = 0;
  private tickCount = 0;

  constructor(options: DecisionFSMOptions = {}) {
    this.name = options.name;
    this.resolvedPolicy = resolveDecisionPolicyOptions(options.policy);
    // Forward the resolved policy so the move-selection layer agrees
    // on the same engagement radii / KO percent / retreat thresholds
    // as the policy resolver. Callers that supplied a partial
    // moveSelection.policy are honoured via the resolveMoveSelection
    // pass — the explicit ?? below preserves a caller-supplied policy
    // override over our forwarded resolved bag.
    this.resolvedMoveSelection = resolveMoveSelectionOptions({
      dodgeChance: options.moveSelection?.dodgeChance,
      attackVocabulary: options.moveSelection?.attackVocabulary,
      policy: options.moveSelection?.policy ?? this.resolvedPolicy,
    });
    this.onTransition = options.onTransition ?? null;
  }

  /**
   * Advance the FSM by one tick. Resolves the strategic state for
   * the supplied context, fires the transition callback if the state
   * changed since the last tick, runs the per-state move-selection
   * heuristic, and emits each resulting verb into `out`.
   *
   * Returns the resolved state so callers that want to inspect it
   * inline (without going through `getCurrentState()`) can do so.
   */
  tick(ctx: DecisionContext, out: DecisionActionWriter): DecisionState {
    const next = resolveDecisionState(ctx, this.resolvedPolicy);
    if (
      this.currentState !== null &&
      this.currentState !== next &&
      this.onTransition !== null
    ) {
      this.onTransition(this.currentState, next, ctx.tickIndex);
    }
    this.currentState = next;

    const actions = selectActionsForState(
      next,
      ctx,
      this.resolvedMoveSelection,
    );
    let count = 0;
    for (const action of actions) {
      out.emit(action);
      count += 1;
    }
    this.lastEmitCount = count;
    this.tickCount += 1;
    return next;
  }

  /** Restore the FSM to the post-construction state. */
  reset(): void {
    this.currentState = null;
    this.lastEmitCount = 0;
    this.tickCount = 0;
  }

  /**
   * Read the last resolved strategic state, or `null` before the
   * first tick / after `reset()`.
   */
  getCurrentState(): DecisionState | null {
    return this.currentState;
  }

  /** Read the number of actions emitted by the most recent tick. */
  getLastEmitCount(): number {
    return this.lastEmitCount;
  }

  /** Read the number of ticks since construction or last `reset()`. */
  getTickCount(): number {
    return this.tickCount;
  }

  /**
   * Capture a debug-friendly snapshot of the FSM's current state.
   *
   * Allocates a new record — callers needing to retain the snapshot
   * across multiple ticks should retain the returned object directly
   * (the FSM does not hold a reference).
   */
  snapshot(): DecisionFSMSnapshot {
    return {
      currentState: this.currentState,
      lastEmitCount: this.lastEmitCount,
      tickCount: this.tickCount,
    };
  }

  /**
   * Read the resolved policy options bag. Useful for tests that want
   * to assert the effective tunables without re-resolving them.
   */
  getResolvedPolicy(): ResolvedDecisionPolicyOptions {
    return this.resolvedPolicy;
  }

  /** Read the resolved move-selection options bag. */
  getResolvedMoveSelection(): ResolvedMoveSelectionOptions {
    return this.resolvedMoveSelection;
  }
}

// ---------------------------------------------------------------------------
// Helper writers — small utilities for tests / controllers
// ---------------------------------------------------------------------------

/**
 * Convenience: a {@link DecisionActionWriter} that records every
 * emit into the supplied array. Used by tests; controllers usually
 * wrap a translator that maps `DecisionAction` into the engine's
 * `CharacterInput` record instead.
 */
export function recordingDecisionWriter(
  sink: DecisionAction[],
): DecisionActionWriter {
  return {
    emit(action: DecisionAction): void {
      sink.push(action);
    },
  };
}
