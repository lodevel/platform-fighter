/**
 * recoveryBehavior — reliable recovery subtree (AC 19 Sub-AC 4).
 *
 * Single, named entry point that composes the recovery primitives —
 * off-stage detection, the four recovery leaves (first-jump, double-
 * jump, up-special, ledge-return) — into one root
 * {@link IBehaviorNode}. The {@link HardTierAI} controller class
 * (and any future tier variant that wires recovery presses) plugs the
 * subtree returned by this file into its top-level Selector ahead of
 * the offensive surface.
 *
 * The companion module `recovery/HardRecoveryTree.ts` already wires up
 * the four recovery leaves into a flat priority Selector. That tree
 * solves the per-leaf gating cleanly, but it has *no outer off-stage
 * gate* — every tick the bot spends in neutral evaluates four leaves
 * in turn just to confirm "still on stage, nothing to do". This module
 * pairs the same priority order with an explicit
 * {@link ConditionalNode} guard so on-stage frames short-circuit at a
 * single predicate evaluation, and so the composition convention is
 * surfaced *at the tree-shape level* rather than baked into every
 * leaf's docstring.
 *
 * Why a dedicated `recoveryBehavior.ts` rather than re-exporting
 * `buildHardRecoveryTree`?
 * --------------------------------------------------------
 *
 *   • Symmetry with the offensive surface. {@link buildHardTierTree}
 *     (Sub-AC 3) owns the *named* offensive root used by the
 *     controller, the replay snapshot, and the diagnostic HUD. The
 *     recovery surface needs the same kind of named root so a
 *     controller author has *one* import to drop into the top-level
 *     Selector and replay tooling has *one* factory to call when
 *     rebuilding the controller from a snapshot.
 *
 *   • Explicit off-stage gate. Wrapping the priority Selector in a
 *     ConditionalNode at the *root* of the subtree means an enclosing
 *     controller-level Selector receives a clean Failure on every
 *     on-stage tick — saving four leaf evaluations and making the
 *     "recovery never blocks offensive on stage" composition convention
 *     a structural property of the subtree rather than an emergent one.
 *
 *   • Per-character tunable bag. The full recovery subtree carries
 *     non-trivial tunables (re-press cooldowns, ledge thresholds,
 *     blast-zone lookahead frames, …). Centralising the option types
 *     and the resolver helper here keeps the controller class free of
 *     forward-knowledge of every leaf's tuning surface.
 *
 *   • A named root tree is the natural unit of authoring. When future
 *     work tunes the "burn the up-special at 30 frames before the
 *     blast zone" pattern, it edits this file rather than threading
 *     additional options through the controller class.
 *
 * Tree shape
 * ----------
 *
 *   ConditionalNode("recoveryBehavior.offStageGate")
 *     gate: !isInHitstun && !isOnLedge && isAirborne && isOffStage
 *     └── Selector("recoveryBehavior.dispatch")
 *           ├── JumpRecoveryLeaf         — first-jump press while a
 *           │                              grounded jump is still in
 *           │                              the budget.
 *           ├── DoubleJumpRecoveryLeaf   — air-jump when conservation
 *           │                              policy says it's worth
 *           │                              burning the resource.
 *           ├── RecoveryMoveLeaf         — up-special when air-jumps
 *           │                              are spent OR the bot is on a
 *           │                              death trajectory.
 *           └── LedgeReturnLeaf          — once airborne and aligned
 *                                          with the stage, push
 *                                          horizontally onto the
 *                                          nearest ledge corner.
 *
 * Why this priority order?
 * ------------------------
 *
 *   1. The Selector ticks branches in declaration order and returns
 *      the first non-Failure. The four leaves are *mutually exclusive
 *      guards* — exactly one of them owns the situation on any given
 *      tick.
 *
 *   2. Jump first (cheapest resource), then double-jump (more
 *      valuable), then up-special (most valuable, once-per-air-time).
 *      This matches the canonical Smash recovery hierarchy and makes
 *      the "burn the cheapest resource that still works" policy
 *      legible at the tree-shape level.
 *
 *   3. Ledge-return sits last because it's the ONLY branch that runs
 *      after the bot has the height — every earlier branch gates on
 *      "still need more height" and falls through once the bot is
 *      at-or-above the ledge.
 *
 *   4. The {@link JumpRecoveryLeaf} and {@link DoubleJumpRecoveryLeaf}
 *      differ only in their re-press cooldowns and conservation
 *      gates; we ship both rather than collapse them so the tree
 *      shape makes the "use grounded jump THEN air-jump THEN up-
 *      special" sequencing explicit.
 *
 * Why the outer ConditionalNode (and not the bare flat Selector)?
 * --------------------------------------------------------------
 *
 *   • Performance. ~80% of frames are spent on stage during a typical
 *     match — short-circuiting the whole subtree to Failure at one
 *     predicate evaluation costs less than four leaf evaluations.
 *
 *   • Reliability. Each leaf already self-gates on `isInHitstun /
 *     isOnLedge / !isAirborne / !isOffStage`, but those gates live in
 *     four different files and could drift out of agreement under
 *     future edits. The outer gate makes the precondition a single
 *     authoritative predicate that always agrees with itself.
 *
 *   • Composition convention. The subtree returned here is meant to
 *     sit *above* the offensive subtree in the controller's top-level
 *     Selector. With the outer Conditional in place, the offensive
 *     subtree gets a clean Failure on every on-stage tick — recovery
 *     never blocks edge-guarding / neutral jab / KO smash because
 *     it returns Failure structurally, not via leaf-by-leaf falls.
 *
 * Composition convention
 * ----------------------
 *
 * The recovery subtree this file owns sits *above* the offensive
 * subtree in the controller's top-level Selector (see
 * {@link HardTierAI}). Recovery branches all return Failure when the
 * bot is on stage (the outer gate enforces this) so they never block
 * edge-guarding; when the bot is off-stage they take priority and the
 * offensive surface never fires.
 *
 * Determinism
 * -----------
 *
 * Every leaf and decorator used here is deterministic on its inputs.
 * The factory itself reads no Rng, no wall-clock —
 * `buildReliableRecoverySubtree` always returns an isomorphic tree
 * given the same options, so the replay system can rebuild the
 * controller from a snapshot by calling the factory and replaying the
 * recorded inputs.
 *
 * Snapshot-friendliness
 * ---------------------
 *
 * All in-flight recovery state lives on the existing recovery
 * Blackboard partition ({@link RecoveryBlackboardSchema}). No new
 * fields are introduced, so the 300-frame replay snapshot already
 * captures the post-recovery state without further plumbing.
 *
 * @example Standalone usage (e.g. a Hard-tier diagnostic harness)
 * ```ts
 * import { BehaviorTree } from './behaviorTree/BehaviorTree';
 * import { Rng } from '../utils/Rng';
 * import { buildReliableRecoverySubtree } from './recoveryBehavior';
 * import {
 *   DEFAULT_RECOVERY_BLACKBOARD,
 *   type RecoveryBlackboardSchema,
 *   type RecoveryContext,
 * } from './recovery/types';
 *
 * const root = buildReliableRecoverySubtree();
 * const tree = new BehaviorTree<RecoveryContext, RecoveryBlackboardSchema>(root, {
 *   initialBlackboard: { ...DEFAULT_RECOVERY_BLACKBOARD },
 * });
 *
 * function onAiFrame(ctx: RecoveryContext): void {
 *   tree.tick(ctx);
 * }
 * ```
 */

import { SelectorNode } from './behaviorTree/composites';
import { ConditionalNode } from './behaviorTree/decorators';
import type { IBehaviorNode } from './behaviorTree/Node';

import {
  DoubleJumpRecoveryLeaf,
  type DoubleJumpRecoveryOptions,
} from './recovery/DoubleJumpRecoveryLeaf';
import {
  JumpRecoveryLeaf,
  type JumpRecoveryOptions,
} from './recovery/JumpRecoveryLeaf';
import {
  LedgeReturnLeaf,
  type LedgeReturnOptions,
} from './recovery/LedgeReturnLeaf';
import {
  RecoveryMoveLeaf,
  type RecoveryMoveOptions,
} from './recovery/RecoveryMoveLeaf';
import {
  isOffStage,
  type RecoveryContext,
} from './recovery/types';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Construction options for {@link buildReliableRecoverySubtree}.
 *
 * Every option is forwarded verbatim into the corresponding leaf's
 * constructor. Pass partial values to override individual tunables;
 * pass `{}` (or omit the argument entirely) to accept the documented
 * Hard-tier defaults.
 */
export interface ReliableRecoverySubtreeOptions {
  /**
   * Tunables forwarded to the first-jump leaf. Useful overrides:
   *
   *   - `jump.repressCooldownFrames` — minimum frames between
   *     consecutive `jump` presses. Default `8`.
   *   - `jump.verticalSlackPx` — vertical fuzz on the off-stage check.
   *     Default `0`.
   */
  readonly jump?: JumpRecoveryOptions;
  /**
   * Tunables forwarded to the air-jump (double-jump) leaf. Useful
   * overrides:
   *
   *   - `doubleJump.repressCooldownFrames` — default `12`.
   *   - `doubleJump.ledgeBelowThresholdPx` — minimum ledge height
   *     deficit before the leaf will burn the air-jump. Default `40`.
   *   - `doubleJump.blastZoneLookaheadFrames` — frames-ahead the leaf
   *     projects when classifying imminent danger. Default `30`.
   */
  readonly doubleJump?: DoubleJumpRecoveryOptions;
  /**
   * Tunables forwarded to the up-special recovery leaf. Useful
   * overrides:
   *
   *   - `upSpecial.blastZoneLookaheadFrames` — default `60` (one
   *     second at 60 Hz fixed step).
   *   - `upSpecial.emitMoveUp` — whether to emit `moveUp` on the same
   *     tick as the up-special press. Default `true`.
   *   - `upSpecial.emitDirectionalNudge` — whether to emit a
   *     horizontal nudge toward the nearest ledge. Default `true`.
   */
  readonly upSpecial?: RecoveryMoveOptions;
  /**
   * Tunables forwarded to the ledge-return leaf. Useful overrides:
   *
   *   - `ledgeReturn.arrivalToleranceXPx` — px tolerance for the
   *     "arrived horizontally over the ledge column" check. Default
   *     `12`.
   *   - `ledgeReturn.overshootToleranceYPx` — px headroom above the
   *     ledge corner before the leaf bails so the up-special's
   *     hangtime can decay. Default `8`.
   */
  readonly ledgeReturn?: LedgeReturnOptions;
  /**
   * Vertical slack added to the OUTER off-stage gate's
   * {@link isOffStage} check, in design pixels. Defaults to `0`. Must
   * be ≥ 0. The same value should be passed into the per-leaf
   * `verticalSlackPx` options when present so the outer gate and the
   * leaf-internal gates agree on what "off-stage" means.
   *
   * Tuning above the default is rarely needed — the only motivation
   * is to match an engine that reports the bot as airborne while it
   * is still nominally on the stage's top surface (e.g. a one-frame
   * gap between platform-leave and the ground-state flag).
   */
  readonly outerVerticalSlackPx?: number;
}

/**
 * Resolved option bag with defaults filled in for every leaf and the
 * outer off-stage gate. Returned by
 * {@link resolveReliableRecoverySubtreeOptions} so tests / debug HUDs
 * can inspect the exact tunables in play without re-deriving them.
 */
export interface ResolvedReliableRecoverySubtreeOptions {
  readonly jump: Required<
    Pick<JumpRecoveryOptions, 'repressCooldownFrames' | 'verticalSlackPx'>
  >;
  readonly doubleJump: Required<
    Pick<
      DoubleJumpRecoveryOptions,
      | 'repressCooldownFrames'
      | 'ledgeBelowThresholdPx'
      | 'blastZoneLookaheadFrames'
      | 'verticalSlackPx'
    >
  >;
  readonly upSpecial: Required<
    Pick<
      RecoveryMoveOptions,
      | 'blastZoneLookaheadFrames'
      | 'verticalSlackPx'
      | 'emitMoveUp'
      | 'emitDirectionalNudge'
    >
  >;
  readonly ledgeReturn: Required<
    Pick<
      LedgeReturnOptions,
      'arrivalToleranceXPx' | 'overshootToleranceYPx'
    >
  >;
  readonly outerVerticalSlackPx: number;
}

// Mirrored from the per-leaf modules — kept inline so this file can be
// read end-to-end without bouncing between five files. Updates to the
// canonical defaults must be reflected in both places (tested).
const DEFAULT_JUMP_REPRESS_COOLDOWN_FRAMES = 8;
const DEFAULT_DOUBLE_JUMP_REPRESS_COOLDOWN_FRAMES = 12;
const DEFAULT_DOUBLE_JUMP_LEDGE_BELOW_THRESHOLD_PX = 40;
const DEFAULT_DOUBLE_JUMP_BLAST_ZONE_LOOKAHEAD_FRAMES = 30;
const DEFAULT_UP_SPECIAL_BLAST_ZONE_LOOKAHEAD_FRAMES = 60;
const DEFAULT_UP_SPECIAL_EMIT_MOVE_UP = true;
const DEFAULT_UP_SPECIAL_EMIT_DIRECTIONAL_NUDGE = true;
const DEFAULT_LEDGE_RETURN_ARRIVAL_TOLERANCE_X_PX = 12;
const DEFAULT_LEDGE_RETURN_OVERSHOOT_TOLERANCE_Y_PX = 8;
const DEFAULT_VERTICAL_SLACK_PX = 0;
const DEFAULT_OUTER_VERTICAL_SLACK_PX = 0;

// ---------------------------------------------------------------------------
// Option resolution
// ---------------------------------------------------------------------------

/**
 * Apply documented defaults to the user-supplied
 * {@link ReliableRecoverySubtreeOptions}. Returns a fully-populated
 * record so callers can round-trip the resolved values through the
 * replay snapshot or a debug HUD.
 *
 * The function is pure on its inputs — it allocates a new record on
 * every call and never reads shared mutable state. Calling it twice
 * with the same input produces structurally-equal output, a property
 * the determinism contract above relies on.
 *
 * Validates the outer vertical slack so an invalid number surfaces
 * here rather than as a confusing leaf failure several frames later.
 */
export function resolveReliableRecoverySubtreeOptions(
  options: ReliableRecoverySubtreeOptions = {},
): ResolvedReliableRecoverySubtreeOptions {
  const outerVerticalSlackPx =
    options.outerVerticalSlackPx ?? DEFAULT_OUTER_VERTICAL_SLACK_PX;
  if (
    !Number.isFinite(outerVerticalSlackPx) ||
    outerVerticalSlackPx < 0
  ) {
    throw new Error(
      `buildReliableRecoverySubtree: outerVerticalSlackPx must be ≥ 0, got ` +
        String(outerVerticalSlackPx),
    );
  }

  return {
    jump: {
      repressCooldownFrames:
        options.jump?.repressCooldownFrames ??
        DEFAULT_JUMP_REPRESS_COOLDOWN_FRAMES,
      verticalSlackPx:
        options.jump?.verticalSlackPx ?? DEFAULT_VERTICAL_SLACK_PX,
    },
    doubleJump: {
      repressCooldownFrames:
        options.doubleJump?.repressCooldownFrames ??
        DEFAULT_DOUBLE_JUMP_REPRESS_COOLDOWN_FRAMES,
      ledgeBelowThresholdPx:
        options.doubleJump?.ledgeBelowThresholdPx ??
        DEFAULT_DOUBLE_JUMP_LEDGE_BELOW_THRESHOLD_PX,
      blastZoneLookaheadFrames:
        options.doubleJump?.blastZoneLookaheadFrames ??
        DEFAULT_DOUBLE_JUMP_BLAST_ZONE_LOOKAHEAD_FRAMES,
      verticalSlackPx:
        options.doubleJump?.verticalSlackPx ?? DEFAULT_VERTICAL_SLACK_PX,
    },
    upSpecial: {
      blastZoneLookaheadFrames:
        options.upSpecial?.blastZoneLookaheadFrames ??
        DEFAULT_UP_SPECIAL_BLAST_ZONE_LOOKAHEAD_FRAMES,
      verticalSlackPx:
        options.upSpecial?.verticalSlackPx ?? DEFAULT_VERTICAL_SLACK_PX,
      emitMoveUp:
        options.upSpecial?.emitMoveUp ?? DEFAULT_UP_SPECIAL_EMIT_MOVE_UP,
      emitDirectionalNudge:
        options.upSpecial?.emitDirectionalNudge ??
        DEFAULT_UP_SPECIAL_EMIT_DIRECTIONAL_NUDGE,
    },
    ledgeReturn: {
      arrivalToleranceXPx:
        options.ledgeReturn?.arrivalToleranceXPx ??
        DEFAULT_LEDGE_RETURN_ARRIVAL_TOLERANCE_X_PX,
      overshootToleranceYPx:
        options.ledgeReturn?.overshootToleranceYPx ??
        DEFAULT_LEDGE_RETURN_OVERSHOOT_TOLERANCE_Y_PX,
    },
    outerVerticalSlackPx,
  };
}

// ---------------------------------------------------------------------------
// Outer off-stage gate predicate
// ---------------------------------------------------------------------------

/**
 * Pure predicate evaluated by the outer Conditional. Returns `true`
 * when the bot is in a *recovery situation* — airborne, not in
 * hitstun, not latched on a ledge, AND off the safe stage X / Y
 * range — so the inner dispatch Selector should run.
 *
 * Exposed at module scope (rather than inlined into the factory) so
 * the unit test file can assert the gate's exact decision boundary
 * without ticking a full subtree.
 *
 * Determinism: pure function of its inputs. No Rng, no wall-clock.
 */
export function isRecoverySituation(
  context: RecoveryContext,
  verticalSlackPx = DEFAULT_OUTER_VERTICAL_SLACK_PX,
): boolean {
  const self = context.self;
  if (self.isInHitstun) return false;
  if (self.isOnLedge) return false;
  if (!self.isAirborne) return false;
  return isOffStage(self, context.stage, verticalSlackPx);
}

// ---------------------------------------------------------------------------
// Subtree builder
// ---------------------------------------------------------------------------

/**
 * Build the reliable recovery subtree root.
 *
 * Composes the four recovery leaves under a priority Selector and
 * wraps the whole thing in a single off-stage gate. Returns the root
 * {@link IBehaviorNode} so a controller can plug it straight into a
 * top-level Selector ahead of the offensive subtree.
 *
 * Returns `Failure` (without ticking the inner Selector) when the
 * bot is on stage / grounded / on a ledge / in hitstun. Returns
 * `Running` while a leaf is mid-press (e.g. ledge-return drifting
 * toward the ledge column). Returns `Success` when a recovery press
 * fires this tick or when the ledge-return leaf observes a successful
 * ledge grab.
 *
 * @param options Per-leaf tunables. Defaults documented on each
 *                forwarded factory ({@link JumpRecoveryLeaf},
 *                {@link DoubleJumpRecoveryLeaf},
 *                {@link RecoveryMoveLeaf}, {@link LedgeReturnLeaf}).
 * @returns The composed reliable recovery subtree root.
 *
 * @example Default subtree
 * ```ts
 * const root = buildReliableRecoverySubtree();
 * const tree = new BehaviorTree<RecoveryContext, RecoveryBlackboardSchema>(root, {
 *   initialBlackboard: { ...DEFAULT_RECOVERY_BLACKBOARD },
 * });
 * tree.tick(ctx);
 * ```
 *
 * @example Per-character tuning (Cat — short jumps, slow up-special)
 * ```ts
 * const root = buildReliableRecoverySubtree({
 *   jump: { repressCooldownFrames: 6 },
 *   doubleJump: { ledgeBelowThresholdPx: 32 },
 *   upSpecial: { blastZoneLookaheadFrames: 75 },
 *   ledgeReturn: { arrivalToleranceXPx: 10 },
 * });
 * ```
 */
export function buildReliableRecoverySubtree(
  options: ReliableRecoverySubtreeOptions = {},
): IBehaviorNode<RecoveryContext> {
  // Resolve once so we have validated defaults and a stable closure
  // capture for the outer gate's slack value. The factories below
  // handle their own internal resolution + clamping so we still pass
  // the *original* sub-option records (pass-through-default) into them.
  const resolved = resolveReliableRecoverySubtreeOptions(options);

  // ---- Inner priority Selector ------------------------------------------
  // Order matches the Smash recovery hierarchy:
  //   1. cheapest resource first (grounded jump),
  //   2. then the more valuable air-jump,
  //   3. then the most valuable up-special,
  //   4. then the no-resource-cost ledge-return drift.
  //
  // Each leaf carries its own gates as defense-in-depth — a leaf that
  // picks up a half-classified situation due to a snapshot/blackboard
  // skew still returns Failure cleanly rather than mis-pressing.
  const dispatch = new SelectorNode<RecoveryContext>(
    [
      new JumpRecoveryLeaf(
        options.jump ?? {},
        'recoveryBehavior.jump',
      ),
      new DoubleJumpRecoveryLeaf(
        options.doubleJump ?? {},
        'recoveryBehavior.doubleJump',
      ),
      new RecoveryMoveLeaf(
        options.upSpecial ?? {},
        'recoveryBehavior.upSpecial',
      ),
      new LedgeReturnLeaf(
        options.ledgeReturn ?? {},
        'recoveryBehavior.ledgeReturn',
      ),
    ],
    'recoveryBehavior.dispatch',
  );

  // ---- Outer off-stage gate ----------------------------------------------
  // Short-circuits the whole subtree to Failure when the bot is on
  // stage / grounded / on a ledge / in hitstun. Saves the four leaf
  // evaluations the inner Selector would otherwise run every frame the
  // bot spends in neutral, AND makes the "recovery never blocks
  // offensive" composition convention a structural property of the
  // subtree.
  const outerSlack = resolved.outerVerticalSlackPx;
  return new ConditionalNode<RecoveryContext>(
    dispatch,
    {
      predicate: (ctx) => isRecoverySituation(ctx, outerSlack),
    },
    'recoveryBehavior.offStageGate',
  );
}
