/**
 * DecisionFSMLeaf — behavior-tree leaf adapter for {@link DecisionFSM}
 * (AC 20202 Sub-AC 2).
 *
 * The decision FSM is normally driven directly by a controller — call
 * `tick(ctx, out)` once per fixed step, collect emits, fold them into
 * a `CharacterInput` record. That works for a standalone "FSM as the
 * full brain" wiring.
 *
 * However the existing tier infrastructure (Easy / Medium / Hard) is
 * built on the `behaviorTree/` primitives. Composing the FSM into one
 * of those trees — for example, slotting it as a fallback branch under
 * a tier's top-level Selector when no tactical leaf has work to do —
 * requires presenting the FSM as a `LeafNode<TContext>`.
 *
 * `DecisionFSMLeaf` is that adapter. It:
 *
 *   • Wraps a `DecisionFSM` and a context-projection callback so the
 *     leaf can extract a {@link DecisionContext} from whatever
 *     tier-specific BT context the surrounding tree threads through.
 *
 *   • Forwards the FSM's emits into a tier-specific writer — by
 *     default, the leaf calls `ctx.out.emit({ kind, comboStepId })`
 *     after translating the {@link DecisionAction} into the
 *     {@link import('../offensive/types').OffensiveAction} verb set.
 *     The `jump` / `dropThrough` / `upSpecial` verbs that don't have
 *     an offensive-action equivalent are simply dropped — composers
 *     wanting to wire those need to supply a custom translator.
 *
 *   • Returns `Success` when the FSM resolved to anything other than
 *     the neutral `approach` state (signalling "I had work to do this
 *     tick"). When the FSM resolves to `approach` — the catch-all
 *     fallthrough — the leaf returns `Failure` so an enclosing
 *     Selector can fall through to whatever branch comes next. This
 *     is the standard behavior-tree convention: a fallback branch
 *     should yield `Failure` when no decision was made.
 *
 *   • Cascades `reset()` into the FSM so a tree-level reset (replay
 *     scrub / match restart) returns the FSM to a pristine state.
 */

import { LeafNode, NodeStatus } from '../behaviorTree/Node';
import type { OffensiveAction, OffensiveContext } from '../offensive/types';

import { DecisionFSM } from './DecisionFSM';
import type {
  DecisionAction,
  DecisionActionWriter,
  DecisionContext,
  DecisionState,
} from './types';

/**
 * Translate a {@link DecisionAction} into an {@link OffensiveAction}.
 *
 * Returns `null` for verbs that don't have an offensive-action
 * equivalent (`jump`, `upSpecial`, `dropThrough`); the default
 * forwarder drops `null` returns. Custom translators can map them to
 * a tier-specific writer (e.g. one that also feeds a recovery
 * action writer).
 */
export type DecisionToOffensiveTranslator = (
  action: DecisionAction,
) => OffensiveAction | null;

/**
 * Default {@link DecisionToOffensiveTranslator} — maps the verbs that
 * exist in both vocabularies one-to-one and returns `null` for the
 * recovery-only verbs.
 */
export const defaultDecisionToOffensiveTranslator: DecisionToOffensiveTranslator =
  (action) => {
    switch (action.kind) {
      case 'idle':
      case 'moveLeft':
      case 'moveRight':
      case 'jab':
      case 'tilt':
      case 'smash':
      case 'special':
      case 'shield':
      case 'dodge':
        return { kind: action.kind, comboStepId: action.note ?? action.state };
      // Verbs the OffensiveAction set doesn't model — drop them.
      // Composers needing them route through a custom translator.
      case 'jump':
      case 'upSpecial':
      case 'dropThrough':
        return null;
    }
  };

/**
 * Construction options for {@link DecisionFSMLeaf}.
 *
 *   - `fsm`         — required. The {@link DecisionFSM} instance to
 *                     wrap. The leaf takes ownership of `reset()`
 *                     cascading into the FSM.
 *   - `project`     — required. Callback that extracts a
 *                     {@link DecisionContext} from the surrounding
 *                     BT context. Tier-specific because the surrounding
 *                     context shape (`OffensiveContext`,
 *                     `RecoveryContext`, …) carries the perceived self
 *                     and stage in different places.
 *   - `translate`   — optional. {@link DecisionToOffensiveTranslator}
 *                     used by the default OffensiveContext writer to
 *                     map decision verbs into offensive verbs.
 *                     Defaults to {@link defaultDecisionToOffensiveTranslator}.
 *   - `successWhenStates` — optional. The set of strategic states for
 *                           which the leaf should return `Success`.
 *                           Defaults to "every state except `approach`"
 *                           — the canonical "fallback if I had nothing
 *                           else to do" convention.
 */
export interface DecisionFSMLeafOptions<TContext = OffensiveContext> {
  readonly fsm: DecisionFSM;
  readonly project: (ctx: TContext) => DecisionContext;
  readonly translate?: DecisionToOffensiveTranslator;
  readonly successWhenStates?: ReadonlySet<DecisionState>;
}

/**
 * Default success states: anything other than `approach`. The
 * `approach` state is the resolver's catch-all fallthrough — when
 * the FSM lands on it the leaf yields `Failure` so a parent Selector
 * can fall through to a different branch.
 */
export const DEFAULT_DECISION_FSM_LEAF_SUCCESS_STATES: ReadonlySet<DecisionState> =
  Object.freeze(new Set<DecisionState>(['attack', 'defend', 'recover', 'retreat']));

/**
 * Behavior-tree leaf wrapper around a {@link DecisionFSM}.
 *
 * The default specialisation targets `OffensiveContext`; tiers using
 * a different per-tick context type can pass their own type
 * parameter and supply matching `project` / `translate` callbacks.
 */
export class DecisionFSMLeaf<TContext = OffensiveContext> extends LeafNode<TContext> {
  private readonly fsm: DecisionFSM;
  private readonly project: (ctx: TContext) => DecisionContext;
  private readonly translate: DecisionToOffensiveTranslator;
  private readonly successStates: ReadonlySet<DecisionState>;

  constructor(
    options: DecisionFSMLeafOptions<TContext>,
    name = 'decisionFsm',
  ) {
    super(name);
    this.fsm = options.fsm;
    this.project = options.project;
    this.translate =
      options.translate ?? defaultDecisionToOffensiveTranslator;
    this.successStates =
      options.successWhenStates ?? DEFAULT_DECISION_FSM_LEAF_SUCCESS_STATES;
  }

  protected onTick(context: TContext): NodeStatus {
    const decisionCtx = this.project(context);
    // Build a writer that translates each emit and forwards to the
    // surrounding context's `out` writer when the host is an
    // OffensiveContext. Hosts wiring DecisionFSMLeaf into a different
    // surrounding context can pass a custom translator that returns
    // null and instead emit through their own side channel.
    const writer = makeForwardingWriter(context, this.translate);
    const state = this.fsm.tick(decisionCtx, writer);
    return this.successStates.has(state) ? NodeStatus.Success : NodeStatus.Failure;
  }

  reset(): void {
    super.reset();
    this.fsm.reset();
  }

  /** Read the wrapped FSM — useful for diagnostic harnesses / tests. */
  getFsm(): DecisionFSM {
    return this.fsm;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build a {@link DecisionActionWriter} that forwards translated emits
 * into the surrounding context's `out`. Falls back to a no-op when
 * the context doesn't expose an `out` field — protects against
 * composers wiring the leaf into a context type that doesn't have an
 * action writer (those composers should pass a custom writer via a
 * subclass override or by ticking the FSM directly).
 */
function makeForwardingWriter<TContext>(
  ctx: TContext,
  translate: DecisionToOffensiveTranslator,
): DecisionActionWriter {
  // Heuristic: if the host context has an `out` property with an
  // `emit` function, treat it as an OffensiveContext-style writer.
  const maybeHost = ctx as { out?: { emit?: (a: OffensiveAction) => void } };
  const hostEmit = maybeHost.out?.emit;
  if (typeof hostEmit !== 'function') {
    // No writer on the host context — silently drop emits. Composers
    // who want to capture them should pass a custom translator that
    // routes through a side channel they control.
    return { emit: () => {} };
  }
  return {
    emit(action: DecisionAction): void {
      const offensive = translate(action);
      if (offensive !== null) {
        hostEmit.call(maybeHost.out, offensive);
      }
    },
  };
}
