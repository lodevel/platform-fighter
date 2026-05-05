/**
 * hardTierTree — Hard-tier behavior tree definition (AC 19 Sub-AC 3).
 *
 * Single, named entry point that composes the Hard-tier offensive
 * decision-making and combo-execution primitives into one root
 * {@link IBehaviorNode}. The {@link HardTierAI} controller class
 * (Sub-AC 4) wires the perception / reaction / recovery layers around
 * the tree this module defines; this file owns the *tree shape* so a
 * unit test (or a future tier variant — Medium, Champion, …) can build
 * an isomorphic tree with one factory call rather than re-deriving the
 * Selector wiring each time.
 *
 * Composition note — chain-in-flight gate
 * ---------------------------------------
 *
 * The {@link buildHardCombosTree} hit-confirm sub-tree's first inner
 * step is a {@link MoveTowardOpponentLeaf} that returns `Running` when
 * the bot is outside follow-up reach. Without an outer guard the
 * sub-tree would *always* report Running whenever an opponent is far
 * away, even when no chain is staged on the blackboard — that would
 * pre-empt the V2 offensive tree's edge-guard / KO / neutral-jab
 * branches and leave the bot endlessly walking toward the opponent
 * without ever pressing an attack. To keep the composition correct,
 * this module gates the hit-confirm sub-tree behind a `comboStage !==
 * 'idle'` predicate so it only contributes work when an actual chain
 * is in flight. The punish sub-tree already carries its own outer
 * predicate (opponent in punishable state) so no extra wrapper is
 * required there.
 *
 * Why a dedicated `hardTierTree.ts` rather than re-exporting the V2
 * offensive tree?
 *
 *   • The V2 offensive tree is one *layer* of Hard-tier intent
 *     (edge-guard → predictive combo follow-up → KO smash → neutral
 *     jab). The combos module owns a *separate* layer (hit-confirm
 *     follow-up + opportunistic punish chains). Until now those two
 *     layers were composed implicitly inside the `HardTierAI`
 *     constructor — only the V2 tree was wired in, with the combos
 *     subtree available as a sibling import. Sub-AC 3 makes the
 *     composition *explicit*: a single tree file the controller, the
 *     replay snapshot, and the diagnostic HUD all reference by name.
 *
 *   • A named root tree is the natural unit of authoring. When future
 *     work tunes the "punish after a missed grab → tilt → smash"
 *     pattern, it edits this file rather than threading additional
 *     options through the controller class. Tier authors keep the
 *     decision-making here; controller authors keep the perception /
 *     reaction / recovery / replay glue in {@link HardTierAI}.
 *
 *   • The replay system can rebuild a Hard-tier brain by calling
 *     {@link buildHardTierTree} with the persisted options and ticking
 *     it against the snapshot — no hidden dependencies, no shared
 *     state outside the {@link OffensiveContext.blackboard}. Sub-AC 4's
 *     `HardTierAISnapshot` round-trips the offensive blackboard
 *     verbatim, so this tree's mutable state is fully captured by the
 *     existing snapshot pipeline.
 *
 * Tree shape
 * ----------
 *
 *   Selector("hardTier")
 *     ├── ConditionalNode("hardTier.hitConfirm.gated")
 *     │     gate: comboStage !== 'idle'                  ← chain-in-flight
 *     │     └── hardCombos.hitConfirm                    — reach + recognise
 *     │                                                    + execute the
 *     │                                                    staged chain
 *     │
 *     ├── hardCombos.punish                              — capitalise on the
 *     │                                                    opponent's recovery
 *     │                                                    / shield / hitstun
 *     │                                                    / dodge frames
 *     │                                                    (own opponent-state
 *     │                                                    gate inside)
 *     │
 *     └── hardOffensiveV2                                — state-conditioned
 *           ├── EdgeGuardLeaf                              decision tree
 *           ├── comboFollowUp.predictive                   (Sub-AC 5)
 *           ├── koSmash.predictive
 *           └── neutralJab.predictive
 *
 * Why combos *first* and offensive *second*?
 *
 *   • A recognised chain in flight is the highest-value action on the
 *     tick — dropping it back to the neutral game would waste the
 *     damage already invested by the prior hit. The chain-in-flight
 *     gate keeps the hit-confirm branch dormant in neutral so it only
 *     pre-empts the V2 surface when there is *real* combo work to do.
 *
 *   • A confirmed opponent opening (recovering / shielding / hitstun /
 *     dodging) is the second-highest-value action — the punish branch
 *     fires a tilt or smash before the V2 surface has a chance to
 *     fish for an opening with a neutral jab.
 *
 *   • Otherwise the state-conditioned V2 surface owns the tick:
 *     edge-guard off-stage opponents, fish for KO smashes at high %,
 *     and fall back to a predictive neutral-jab approach. The V2
 *     surface contains its *own* combo follow-up branch (with
 *     predictive movement) so even when the chain-in-flight gate
 *     above is open in a future tick the V2 tree still executes the
 *     follow-up correctly — the gated hit-confirm at the top is a
 *     superset that uses the simpler {@link MoveTowardOpponentLeaf}
 *     for tighter control during a confirmed exchange.
 *
 *   Conceptually:
 *
 *   • combos = "what to do *because* of the previous tick's outcome"
 *   • offensive = "what to do given the *current* world state"
 *
 *   Outcome-conditioned actions take priority over state-conditioned
 *   actions when both are available — this matches the way human
 *   players reflexively follow up a confirmed hit before re-assessing
 *   the neutral game.
 *
 * Composition convention
 * ----------------------
 *
 * The forthcoming Hard-tier *recovery* sub-tree sits *above* the tree
 * defined here in the controller's pipeline (see {@link HardTierAI})
 * — recovery branches all return Failure when the bot is on stage so
 * they never block edge-guarding; when the bot is off-stage they take
 * priority and the offensive surface this file authors never fires.
 *
 * Determinism
 * -----------
 *
 * Every leaf, decorator, and conditional used here is deterministic on
 * its inputs. The factory itself reads no Rng, no wall-clock — the
 * same options always produce an isomorphic tree, so the replay system
 * can rebuild the controller from a snapshot by calling the factory
 * and replaying the recorded inputs.
 *
 * Snapshot-friendliness
 * ---------------------
 *
 * All chain state lives on the existing offensive Blackboard partition
 * ({@link OffensiveBlackboardSchema}). No new fields are introduced,
 * so the 300-frame replay snapshot already captures the post-combo
 * state without further plumbing.
 *
 * @example Standalone usage (e.g. a Hard-tier diagnostic harness)
 * ```ts
 * import { BehaviorTree } from './behaviorTree/BehaviorTree';
 * import { Blackboard } from './behaviorTree/Blackboard';
 * import { Rng } from '../utils/Rng';
 * import { buildHardTierTree } from './hardTierTree';
 * import {
 *   DEFAULT_OFFENSIVE_BLACKBOARD,
 *   type OffensiveBlackboardSchema,
 *   type OffensiveContext,
 * } from './offensive/types';
 *
 * const root = buildHardTierTree();
 * const blackboard = new Blackboard<OffensiveBlackboardSchema>({
 *   ...DEFAULT_OFFENSIVE_BLACKBOARD,
 * });
 * const tree = new BehaviorTree<OffensiveContext, OffensiveBlackboardSchema>(root, {
 *   name: 'hard-tier-diagnostic',
 *   initialBlackboard: { ...DEFAULT_OFFENSIVE_BLACKBOARD },
 * });
 *
 * function onAiFrame(ctx: OffensiveContext): void {
 *   tree.tick(ctx);
 * }
 * ```
 */

import { SelectorNode } from './behaviorTree/composites';
import { ConditionalNode } from './behaviorTree/decorators';
import type { IBehaviorNode } from './behaviorTree/Node';

import {
  buildHitConfirmComboSubtree,
  buildPunishComboSubtree,
  resolveHardCombosTreeOptions,
  type HardCombosTreeOptions,
  type ResolvedHardCombosTreeOptions,
} from './behaviors/hardCombos';
import {
  buildHardOffensiveTreeV2,
  resolveHardOffensiveTreeV2Options,
  type HardOffensiveTreeV2Options,
  type ResolvedHardOffensiveTreeV2Options,
} from './offensive/HardOffensiveTreeV2';
import type { OffensiveContext } from './offensive/types';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Construction options for {@link buildHardTierTree}.
 *
 * Every option is forwarded verbatim into the corresponding sub-tree
 * factory. Pass partial values to override individual tunables; pass
 * `{}` (or omit the argument entirely) to accept the documented
 * Hard-tier defaults.
 */
export interface HardTierTreeOptions {
  /**
   * Per-subtree tunables for the combo-execution layer
   * (hit-confirm + punish). Forwarded to {@link buildHardCombosTree}.
   *
   * Useful overrides:
   *
   *   - `combos.hitConfirm.closeRangePx` — hit-confirm follow-up reach.
   *   - `combos.punish.punishableStates` — set of opponent state
   *     labels that constitute a punish opening. Override for a
   *     stricter / looser punish gate (e.g. only `recovering`).
   */
  readonly combos?: HardCombosTreeOptions;
  /**
   * Per-subtree tunables for the offensive decision-making layer
   * (edge-guard + predictive combo + KO smash + neutral jab).
   * Forwarded to {@link buildHardOffensiveTreeV2}.
   *
   * Useful overrides:
   *
   *   - `offensive.neutralJabRangePx` / `offensive.koSmashRangePx` —
   *     per-character reach tuning.
   *   - `offensive.predictiveLookaheadFrames` — how many fixed steps
   *     the predictive movement leaves project ahead.
   *   - `offensive.edgeGuard` — edge-guard tuning bag (anchor
   *     tolerance, off-stage commit threshold, …).
   */
  readonly offensive?: HardOffensiveTreeV2Options;
}

/**
 * Resolved option bag with defaults filled in for both sub-trees.
 * Returned by {@link resolveHardTierTreeOptions} so tests / debug HUDs
 * can inspect the exact tunables in play without re-deriving them.
 */
export interface ResolvedHardTierTreeOptions {
  readonly combos: ResolvedHardCombosTreeOptions;
  readonly offensive: ResolvedHardOffensiveTreeV2Options;
}

// ---------------------------------------------------------------------------
// Option resolution
// ---------------------------------------------------------------------------

/**
 * Apply documented defaults to the user-supplied {@link
 * HardTierTreeOptions}. Returns a fully-populated record so callers can
 * round-trip the resolved values through the replay snapshot or a
 * debug HUD.
 *
 * The function is pure on its inputs — it allocates a new record on
 * every call and never reads shared mutable state. Calling it twice
 * with the same input produces structurally-equal output, a property
 * the determinism contract above relies on.
 */
export function resolveHardTierTreeOptions(
  options: HardTierTreeOptions = {},
): ResolvedHardTierTreeOptions {
  return {
    combos: resolveHardCombosTreeOptions(options.combos),
    offensive: resolveHardOffensiveTreeV2Options(options.offensive),
  };
}

// ---------------------------------------------------------------------------
// Tree builder
// ---------------------------------------------------------------------------

/**
 * Build the Hard-tier behavior tree root.
 *
 * Composes the {@link buildHardCombosTree} combo-execution layer with
 * the {@link buildHardOffensiveTreeV2} offensive decision-making layer
 * under a single Selector. The Selector ticks the combos sub-tree
 * first; when it returns Failure (no in-flight chain and no
 * punishable opening) the offensive sub-tree takes over and runs the
 * standard edge-guard → predictive combo → KO smash → neutral-jab
 * priority chain.
 *
 * Returns the root {@link IBehaviorNode} so a controller can plug it
 * straight into a {@link BehaviorTree} runner — the {@link
 * HardTierAI} class wires the perception / reaction / recovery layers
 * around it. Standalone diagnostic harnesses can also tick the
 * returned root directly with a hand-rolled {@link OffensiveContext}.
 *
 * @param options Per-subtree tunables. Defaults documented on each
 *                forwarded factory ({@link buildHardCombosTree},
 *                {@link buildHardOffensiveTreeV2}).
 * @returns The composed Hard-tier tree root.
 *
 * @example Default Hard-tier tree
 * ```ts
 * const root = buildHardTierTree();
 * const tree = new BehaviorTree<OffensiveContext, OffensiveBlackboardSchema>(root);
 * tree.tick(ctx);
 * ```
 *
 * @example Per-character tuning (Cat — fast jab, short smash reach)
 * ```ts
 * const root = buildHardTierTree({
 *   offensive: {
 *     neutralJabRangePx: 44,
 *     koSmashRangePx: 64,
 *     comboFollowUpRangePx: 54,
 *   },
 *   combos: {
 *     hitConfirm: { closeRangePx: 54 },
 *     punish: { closeRangePx: 64 },
 *   },
 * });
 * ```
 */
export function buildHardTierTree(
  options: HardTierTreeOptions = {},
): IBehaviorNode<OffensiveContext> {
  // We pass the *original* sub-option records (rather than the
  // resolved ones) into each factory — the factories own their own
  // resolution + clamping logic, and re-resolving inside them keeps
  // the contract that any factory can be called in isolation with
  // partial options.
  const combosOptions = options.combos ?? {};

  // ---- Combos hit-confirm: chain-in-flight gate --------------------------
  // The hit-confirm sub-tree's MoveTowardOpponentLeaf returns Running
  // (and emits movement) whenever the bot is outside follow-up reach,
  // even when no chain is staged. Wrapping it in a `comboStage !==
  // 'idle'` predicate ensures the sub-tree only contributes work when
  // a real chain is in flight — otherwise it returns Failure and the
  // parent Selector falls through to the punish + offensive branches.
  const hitConfirm = new ConditionalNode<OffensiveContext>(
    buildHitConfirmComboSubtree(combosOptions.hitConfirm),
    {
      predicate: (ctx) =>
        (ctx.blackboard.get('comboStage') ?? 'idle') !== 'idle',
    },
    'hardTier.hitConfirm.gated',
  );

  // ---- Combos punish: already gated by opponent state inside the subtree.
  const punish = buildPunishComboSubtree(combosOptions.punish);

  // ---- Offensive V2: full edge-guard / KO / neutral / predictive surface.
  const offensive = buildHardOffensiveTreeV2(options.offensive);

  // ---- Composed root -----------------------------------------------------
  // Priority order:
  //   1. hit-confirm (chain-in-flight) — outcome-conditioned, wins over
  //      everything else when a real chain is ready to be executed.
  //   2. punish (opponent in punishable state) — exploit a confirmed
  //      opening even before the V2 surface has a chance to fish for
  //      one with a neutral jab.
  //   3. offensive V2 — the full state-conditioned decision tree
  //      (edge-guard → predictive combo follow-up → KO smash →
  //      neutral jab) takes over when neither combo path applies.
  //
  // See module docstring for the full rationale (outcome-conditioned
  // > state-conditioned, with the chain-in-flight gate preventing
  // hit-confirm from monopolising movement during neutral exchanges).
  return new SelectorNode<OffensiveContext>(
    [hitConfirm, punish, offensive],
    'hardTier',
  );
}
