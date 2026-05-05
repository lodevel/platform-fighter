/**
 * hardRecovery — Hard-tier off-stage recovery behaviors authored as
 * behavior-tree subtrees (AC 170301).
 *
 * Scope (this file)
 * -----------------
 *
 * The companion module `recovery/HardRecoveryTree.ts` already wires up
 * the four recovery leaves (first-jump, double-jump, up-special,
 * ledge-return) into a flat priority Selector. That tree solves the
 * "press the cheapest jump first, escalate to up-special last"
 * pattern, but it intentionally has no opinion about *whether* the
 * bot is in an off-stage situation that warrants recovery — every
 * leaf decides for itself by re-running the `isOffStage` predicate.
 *
 * This file owns the *named combat patterns* that wrap the recovery
 * primitives in higher-level decision logic. The first such pattern,
 * authored in Sub-AC 1, is:
 *
 *   • **OffStageDecision** — a single dispatcher subtree that:
 *
 *       1. *Detects* off-stage state at the subtree root via a
 *          Conditional gate (so on-stage situations short-circuit
 *          without ticking the inner Selector at all — saves work
 *          when 80% of frames are spent on stage).
 *       2. *Evaluates* the distance and angle from the bot to the
 *          nearest grabbable ledge corner, classifying the
 *          situation into a small enum of strategies.
 *       3. *Selects* the appropriate recovery leaf based on the
 *          classification, rather than letting four leaves race for
 *          ownership of the tick.
 *
 * Why a dispatcher rather than the existing flat Selector?
 * --------------------------------------------------------
 *
 *   1. The flat Selector picks the first non-Failure branch. With
 *      the conservation gates baked into each leaf, that ends up
 *      mostly correct — but it has two failure modes the dispatcher
 *      avoids:
 *
 *      a. **Lost context** — when the bot is already at-or-above
 *         the ledge but slightly off horizontally, the flat tree
 *         passes through every jump branch ("still need more
 *         height" → Failure) before reaching the ledge-return leaf.
 *         The dispatcher classifies "have height, need horizontal
 *         drift" once at the root and routes directly to ledge-
 *         return without paying the leaf-by-leaf evaluation cost.
 *
 *      b. **Hidden ordering bugs** — adding a new strategy (e.g.
 *         airdodge from above) to the flat Selector requires
 *         re-deriving where it sits in the priority list, and a
 *         mis-ordered insert silently changes recovery behaviour
 *         under specific conditions. The dispatcher makes the
 *         classification explicit, so a new strategy is added by
 *         extending the {@link OffStageStrategy} enum and the
 *         dispatch table — out-of-order classification surfaces
 *         as a unit-test failure rather than a runtime regression.
 *
 *   2. The dispatcher composes cleanly with future combat patterns
 *      (e.g. ledge-trap chains, edge-guard interception): each
 *      pattern is a sibling subtree under a top-level Selector, and
 *      the OffStageDecision returns Failure when the bot is on
 *      stage so the offensive / defensive patterns still get their
 *      tick.
 *
 *   3. The classification function itself
 *      ({@link classifyOffStageStrategy}) is pure on its inputs and
 *      deterministic, so it can be unit-tested independently of the
 *      tree shape — every strategy boundary is covered by direct
 *      assertions on the helper rather than by indirect tree-tick
 *      observation.
 *
 * Determinism
 * -----------
 *
 * Every leaf, decorator, and conditional used here is deterministic
 * on its inputs. The factory itself reads no Rng, no wall-clock —
 * the same options always produce an isomorphic tree, so the replay
 * system can rebuild the controller from a snapshot.
 *
 * Snapshot-friendliness
 * ---------------------
 *
 * All in-flight recovery state lives on the existing recovery
 * Blackboard partition ({@link
 * import('../recovery/types').RecoveryBlackboardSchema}). No new
 * fields are introduced, so the 300-frame replay snapshot already
 * captures the post-decision state without further plumbing.
 */

import { SelectorNode } from '../behaviorTree/composites';
import { ConditionalNode } from '../behaviorTree/decorators';
import { LeafNode, NodeStatus, type IBehaviorNode } from '../behaviorTree/Node';

import {
  DoubleJumpRecoveryLeaf,
  type DoubleJumpRecoveryOptions,
} from '../recovery/DoubleJumpRecoveryLeaf';
import {
  JumpRecoveryLeaf,
  type JumpRecoveryOptions,
} from '../recovery/JumpRecoveryLeaf';
import {
  LedgeReturnLeaf,
  type LedgeReturnOptions,
} from '../recovery/LedgeReturnLeaf';
import {
  RecoveryMoveLeaf,
  type RecoveryMoveOptions,
} from '../recovery/RecoveryMoveLeaf';
import {
  isApproachingBlastZone,
  isOffStage,
  ledgeXOffset,
  ledgeYOffset,
  type LedgeMixupGetUpOption,
  type RecoveryContext,
  type RecoverySelfSnapshot,
  type RecoveryStageGeometry,
} from '../recovery/types';

// ===========================================================================
// OffStageDecision — Sub-AC 1
// ===========================================================================

// ---------------------------------------------------------------------------
// Strategy classification
// ---------------------------------------------------------------------------

/**
 * Discrete recovery strategy chosen by {@link classifyOffStageStrategy}.
 *
 * Each value pins which recovery leaf is the right press for the
 * current frame. Mutually exclusive — exactly one is the "correct"
 * answer for any given (self, stage, bb) tuple.
 *
 *   - `'none'`         — bot is on stage, nothing to do. The
 *                        dispatcher returns Failure so an enclosing
 *                        Selector can fall through to offensive /
 *                        neutral patterns.
 *
 *   - `'ledgeReturn'`  — bot already has the height to grab the
 *                        ledge; only horizontal drift is needed.
 *                        Routes to the {@link LedgeReturnLeaf}.
 *                        Avoids burning a jump on a recovery that
 *                        would only slightly overshoot.
 *
 *   - `'jump'`         — bot has dropped off the edge but still has
 *                        every jump in its budget (grounded jump
 *                        plus full air-jump count). Cheapest press
 *                        first. Routes to {@link JumpRecoveryLeaf}.
 *
 *   - `'doubleJump'`   — bot has spent its grounded jump (or has
 *                        not, but a single jump won't reach) AND
 *                        the ledge is below by less than the
 *                        double-jump threshold. Routes to
 *                        {@link DoubleJumpRecoveryLeaf}.
 *
 *   - `'upSpecial'`    — bot has no jumps left OR is in imminent
 *                        blast-zone danger OR the ledge is below
 *                        further than a double-jump can reach.
 *                        Routes to {@link RecoveryMoveLeaf}.
 *
 *   - `'givenUp'`      — bot is off-stage but the stage has no
 *                        registered nearest ledge (e.g. the flat
 *                        tutorial stage); no productive recovery
 *                        press exists. Dispatcher returns Failure
 *                        and lets the controller emit `idle` via
 *                        the default neutral branch.
 */
export type OffStageStrategy =
  | 'none'
  | 'ledgeReturn'
  | 'jump'
  | 'doubleJump'
  | 'upSpecial'
  | 'givenUp';

/**
 * Tunables for {@link classifyOffStageStrategy}. Every threshold
 * has a default tuned to the M2 roster's average jump heights and
 * up-special hangtimes; per-character controllers can override
 * via {@link OffStageDecisionOptions}.
 */
export interface OffStageClassificationOptions {
  /**
   * Vertical slack added to the off-stage check so a bot teetering
   * exactly on the stage top isn't flagged as off-stage by floating-
   * point fuzz. Default `0`. Must be ≥ 0.
   */
  readonly verticalSlackPx?: number;
  /**
   * Frames-ahead used by the imminent-blast-zone projection. When
   * the projected position falls past any blast wall the strategy
   * escalates straight to `'upSpecial'`. Default `60` (one second
   * of lookahead — same as {@link RecoveryMoveLeaf}'s default).
   */
  readonly blastZoneLookaheadFrames?: number;
  /**
   * Vertical Y-magnitude (in design pixels, ledge below bot ⇒ +Y)
   * at-or-below which a single double-jump is judged sufficient to
   * reach the ledge. Above this threshold the strategy escalates
   * to `'upSpecial'`. Default `40 px` — mirrors
   * {@link DoubleJumpRecoveryLeaf}'s default `ledgeBelowThresholdPx`.
   */
  readonly doubleJumpReachPx?: number;
  /**
   * X-magnitude (in design pixels) at-or-below which the bot is
   * considered "horizontally aligned with the ledge" for the
   * purposes of the ledge-return classification. Slightly larger
   * than {@link LedgeReturnLeaf}'s `arrivalToleranceXPx` because
   * the classification only needs a coarse "close enough to drift"
   * judgement; the leaf itself owns the precise ledge-grab tolerance.
   * Default `48 px`.
   */
  readonly ledgeReturnHorizontalRangePx?: number;
  /**
   * Vertical tolerance below the ledge corner. When `dy <= -verticalSlackPx`
   * (i.e. the bot is at-or-above the ledge corner with this much
   * headroom) the strategy resolves to `'ledgeReturn'`. Default
   * `8 px` — mirrors {@link LedgeReturnLeaf}'s
   * `overshootToleranceYPx` so the dispatcher and the leaf agree
   * on what "above the ledge" means.
   */
  readonly ledgeReturnVerticalTolerancePx?: number;
}

/** Resolved option set with defaults filled in. */
export interface ResolvedOffStageClassificationOptions {
  readonly verticalSlackPx: number;
  readonly blastZoneLookaheadFrames: number;
  readonly doubleJumpReachPx: number;
  readonly ledgeReturnHorizontalRangePx: number;
  readonly ledgeReturnVerticalTolerancePx: number;
}

const DEFAULT_VERTICAL_SLACK_PX = 0;
const DEFAULT_BLAST_ZONE_LOOKAHEAD_FRAMES = 60;
const DEFAULT_DOUBLE_JUMP_REACH_PX = 40;
const DEFAULT_LEDGE_RETURN_HORIZONTAL_RANGE_PX = 48;
const DEFAULT_LEDGE_RETURN_VERTICAL_TOLERANCE_PX = 8;

/** Apply defaults to the user-supplied classification options. */
export function resolveOffStageClassificationOptions(
  options: OffStageClassificationOptions = {},
): ResolvedOffStageClassificationOptions {
  const verticalSlackPx =
    options.verticalSlackPx ?? DEFAULT_VERTICAL_SLACK_PX;
  if (!Number.isFinite(verticalSlackPx) || verticalSlackPx < 0) {
    throw new Error(
      `OffStageDecision: verticalSlackPx must be ≥ 0, got ` +
        String(verticalSlackPx),
    );
  }

  const blastZoneLookaheadFrames =
    options.blastZoneLookaheadFrames ?? DEFAULT_BLAST_ZONE_LOOKAHEAD_FRAMES;
  if (
    !Number.isFinite(blastZoneLookaheadFrames) ||
    blastZoneLookaheadFrames < 0 ||
    !Number.isInteger(blastZoneLookaheadFrames)
  ) {
    throw new Error(
      `OffStageDecision: blastZoneLookaheadFrames must be a non-negative integer, got ` +
        String(blastZoneLookaheadFrames),
    );
  }

  const doubleJumpReachPx =
    options.doubleJumpReachPx ?? DEFAULT_DOUBLE_JUMP_REACH_PX;
  if (!Number.isFinite(doubleJumpReachPx) || doubleJumpReachPx < 0) {
    throw new Error(
      `OffStageDecision: doubleJumpReachPx must be ≥ 0, got ` +
        String(doubleJumpReachPx),
    );
  }

  const ledgeReturnHorizontalRangePx =
    options.ledgeReturnHorizontalRangePx ??
    DEFAULT_LEDGE_RETURN_HORIZONTAL_RANGE_PX;
  if (
    !Number.isFinite(ledgeReturnHorizontalRangePx) ||
    ledgeReturnHorizontalRangePx < 0
  ) {
    throw new Error(
      `OffStageDecision: ledgeReturnHorizontalRangePx must be ≥ 0, got ` +
        String(ledgeReturnHorizontalRangePx),
    );
  }

  const ledgeReturnVerticalTolerancePx =
    options.ledgeReturnVerticalTolerancePx ??
    DEFAULT_LEDGE_RETURN_VERTICAL_TOLERANCE_PX;
  if (
    !Number.isFinite(ledgeReturnVerticalTolerancePx) ||
    ledgeReturnVerticalTolerancePx < 0
  ) {
    throw new Error(
      `OffStageDecision: ledgeReturnVerticalTolerancePx must be ≥ 0, got ` +
        String(ledgeReturnVerticalTolerancePx),
    );
  }

  return {
    verticalSlackPx,
    blastZoneLookaheadFrames,
    doubleJumpReachPx,
    ledgeReturnHorizontalRangePx,
    ledgeReturnVerticalTolerancePx,
  };
}

/**
 * Pure helper: classify the recovery strategy that best fits the
 * current (self, stage) tuple. Returns one of {@link OffStageStrategy}.
 *
 * Decision order (tested boundary-by-boundary in
 * `hardRecovery.test.ts`):
 *
 *   1. **Hitstun / on-ledge / grounded / on-stage** ⇒ `'none'`.
 *      The bot is not in a recovery situation; the dispatcher
 *      returns Failure and lets sibling subtrees take the tick.
 *      Hitstun in particular short-circuits *before* off-stage
 *      classification because pressing inputs while the engine is
 *      processing knockback breaks the recovery loop.
 *
 *   2. **No registered ledge** ⇒ `'givenUp'`. The stage has no
 *      grabbable ledge (e.g. flat tutorial); no recovery press
 *      exists, so the dispatcher returns Failure and the
 *      controller's neutral branch emits `idle`.
 *
 *   3. **Bot already at-or-above the ledge AND horizontally close**
 *      ⇒ `'ledgeReturn'`. The "I have height" classification:
 *      `dy <= ledgeReturnVerticalTolerancePx`-ish (above the ledge)
 *      AND `|dx| <= ledgeReturnHorizontalRangePx`. Avoids burning a
 *      jump when simple drift will land the ledge grab.
 *
 *   4. **Imminent blast-zone danger** ⇒ `'upSpecial'`. The bot
 *      will cross a KO wall within `blastZoneLookaheadFrames`;
 *      escalate immediately to the most-vertical recovery vector.
 *      Gated on `upSpecialAvailable` — if the up-special is also
 *      consumed, the bot is dead anyway and the strategy falls
 *      through to whichever press is still available (or `'givenUp'`
 *      if nothing is).
 *
 *   5. **No jumps remaining** ⇒ `'upSpecial'` (when available) or
 *      `'givenUp'`. Air-jumps are the natural pre-up-special
 *      fallback; with none left and no up-special either, the bot
 *      is going to die regardless of the press.
 *
 *   6. **Ledge below the bot by more than `doubleJumpReachPx`** ⇒
 *      `'upSpecial'`. A double-jump alone won't get the bot back —
 *      commit the up-special.
 *
 *   7. **Bot has every jump still in its budget** ⇒ `'jump'`. The
 *      grounded-jump press is the cheapest first move; the
 *      JumpRecoveryLeaf's own gate enforces the off-stage condition
 *      and the re-press cooldown.
 *
 *   8. **Default fallback** ⇒ `'doubleJump'`. The bot has at least
 *      one air-jump and the ledge is within reach.
 *
 * Determinism: pure function of its inputs. No Rng, no wall-clock.
 */
export function classifyOffStageStrategy(
  self: RecoverySelfSnapshot,
  stage: RecoveryStageGeometry,
  options: OffStageClassificationOptions = {},
  /**
   * Maximum jump count from the controller's perspective — used to
   * tell "every jump still available" (route to `'jump'`) from
   * "grounded jump spent, air-jump still available" (route to
   * `'doubleJump'`). Defaults to whatever the snapshot reports as
   * `jumpsRemaining` so callers without the controller-level limit
   * still produce sensible output, but in practice the controller
   * passes its character's `getMaxJumps()` here.
   */
  jumpBudget?: number,
): OffStageStrategy {
  const resolved = resolveOffStageClassificationOptions(options);

  // 1. Lockout / non-recovery states — no recovery work to do.
  if (self.isInHitstun) return 'none';
  if (self.isOnLedge) return 'none';
  if (!self.isAirborne) return 'none';
  if (!isOffStage(self, stage, resolved.verticalSlackPx)) return 'none';

  // 2. Stage has no ledge — give up classification cleanly.
  const dx = ledgeXOffset(self, stage);
  const dy = ledgeYOffset(self, stage);
  if (dx === null || dy === null || stage.nearestLedge === null) {
    return 'givenUp';
  }

  // 3. Bot already at-or-above the ledge corner AND horizontally
  //    close enough that simple drift will hit the ledge magnetism.
  //    `dy` is "ledge.y - self.y", and Y grows down — so dy <= 0
  //    means the bot is at or above the ledge corner. The slack
  //    pulls the threshold just past the corner so a bot exactly
  //    on the ledge column-line still routes to ledge-return rather
  //    than a hairline-below jump press.
  if (
    dy <= resolved.ledgeReturnVerticalTolerancePx &&
    Math.abs(dx) <= resolved.ledgeReturnHorizontalRangePx
  ) {
    return 'ledgeReturn';
  }

  // 4. Imminent blast-zone danger — escalate to up-special when
  //    available; if the up-special is also consumed fall through to
  //    whichever jump press is still open. The escalation is "use
  //    the highest-priority press the bot still has", not "panic into
  //    a press that's already been spent".
  const approaching = isApproachingBlastZone(
    self,
    stage,
    resolved.blastZoneLookaheadFrames,
  );
  if (approaching && self.upSpecialAvailable) {
    return 'upSpecial';
  }

  // 5. No jumps left — only the up-special is still available.
  if (self.jumpsRemaining <= 0) {
    if (self.upSpecialAvailable) return 'upSpecial';
    return 'givenUp';
  }

  // 6. Ledge is below the bot further than a double-jump can reach
  //    — commit the up-special.
  //
  //    Sign convention: dy > 0 means the ledge is BELOW the bot
  //    (Y grows down). When the ledge is *above* the bot we want
  //    the bot to climb; the doubleJumpReachPx gate compares the
  //    *upward* travel needed (i.e. how far below the ledge the bot
  //    sits, which is -dy when the ledge is above). For ledges
  //    *below* the bot, the bot will descend naturally — but if
  //    the ledge is so far below that we're below-stage and need
  //    horizontal travel back, the up-special's longer hangtime is
  //    the right call.
  const upwardTravelNeededPx = -dy;
  if (
    upwardTravelNeededPx > resolved.doubleJumpReachPx &&
    self.upSpecialAvailable
  ) {
    return 'upSpecial';
  }

  // 7. Bot has every jump in its budget still — first-jump press.
  //    `jumpBudget ?? self.jumpsRemaining` makes the helper pass
  //    cleanly when the caller doesn't know the character's max
  //    jump count: the comparison degenerates to "jumpsRemaining ===
  //    jumpsRemaining" which is always true, biasing toward the
  //    cheaper first-jump press. The controller passes the real
  //    max so the boundary is sharp.
  const maxJumps = jumpBudget ?? self.jumpsRemaining;
  if (self.jumpsRemaining >= maxJumps) {
    return 'jump';
  }

  // 8. Default fallback — at least one air-jump, ledge within reach.
  return 'doubleJump';
}

// ---------------------------------------------------------------------------
// OffStageDecision subtree
// ---------------------------------------------------------------------------

/** Construction options for {@link buildOffStageDecisionSubtree}. */
export interface OffStageDecisionOptions {
  /** Tunables forwarded to the classification helper. */
  readonly classify?: OffStageClassificationOptions;
  /** Tunables forwarded to the first-jump leaf. */
  readonly jump?: JumpRecoveryOptions;
  /** Tunables forwarded to the air-jump (double-jump) leaf. */
  readonly doubleJump?: DoubleJumpRecoveryOptions;
  /** Tunables forwarded to the up-special leaf. */
  readonly upSpecial?: RecoveryMoveOptions;
  /** Tunables forwarded to the ledge-return leaf. */
  readonly ledgeReturn?: LedgeReturnOptions;
  /**
   * Optional jump-budget supplier. Lets the controller inject the
   * character's max-jump count so the classification's
   * "every jump still available" boundary is sharp. When omitted the
   * classifier falls back to the snapshot's `jumpsRemaining`, which
   * biases toward the cheaper first-jump press but never picks the
   * *wrong* leaf (the leaf gates always run after the dispatch).
   */
  readonly getJumpBudget?: (context: RecoveryContext) => number;
}

/**
 * Resolved option set with defaults filled in. Useful for tests that
 * want to assert the exact tunables in play and for controller
 * integration code that wants to log the active configuration.
 */
export interface ResolvedOffStageDecisionOptions {
  readonly classify: ResolvedOffStageClassificationOptions;
}

/**
 * Apply defaults to the user-supplied options. Mirrors
 * `resolveHardRecoveryTreeOptions` so the two factories share the
 * same shape for controller introspection / debug-overlay code.
 */
export function resolveOffStageDecisionOptions(
  options: OffStageDecisionOptions = {},
): ResolvedOffStageDecisionOptions {
  return {
    classify: resolveOffStageClassificationOptions(options.classify),
  };
}

/**
 * Build the OffStageDecision dispatcher subtree.
 *
 * Tree shape:
 *
 *   ConditionalNode("hardRecovery.offStageDecision", isOffStageGate)
 *     └── Selector("hardRecovery.offStageDecision.dispatch")
 *           ├── ConditionalNode (strategy === 'ledgeReturn') → LedgeReturnLeaf
 *           ├── ConditionalNode (strategy === 'upSpecial')   → RecoveryMoveLeaf
 *           ├── ConditionalNode (strategy === 'doubleJump')  → DoubleJumpRecoveryLeaf
 *           ├── ConditionalNode (strategy === 'jump')        → JumpRecoveryLeaf
 *           └── (no `'givenUp'` branch — falls through to Failure
 *                so the controller's neutral / idle branch can emit)
 *
 * Behaviour:
 *
 *   - Returns `Failure` when the bot is on-stage / grounded / in
 *     hitstun / on a ledge — every guard returns Failure and the
 *     outer Conditional reports Failure to the parent Selector.
 *   - Returns `Running` while a leaf is mid-press (e.g. ledge-return
 *     drifting toward the ledge column).
 *   - Returns `Success` when a recovery press fires this tick, or
 *     when the ledge-return leaf observes a successful ledge grab.
 *
 * Dispatch ordering note
 * ----------------------
 *
 * The inner Selector is structured "highest priority first" — once
 * the classifier returns `'upSpecial'` we want that branch to
 * always win, not for a stray fall-through to fire a jump press
 * during the up-special's startup frames. The Conditional guards
 * are mutually exclusive on `strategy === X`, so only one branch
 * ever ticks per frame, but the order still matters as documentation
 * of the priority hierarchy.
 *
 * The four sibling leaves *also* run their own internal gates
 * (off-stage, hitstun, jump-budget, etc.). The dispatcher is an
 * additive correctness layer, not a replacement: a leaf that picks
 * up a half-classified situation due to a snapshot-blackboard skew
 * still returns Failure cleanly rather than mis-pressing.
 */
export function buildOffStageDecisionSubtree(
  options: OffStageDecisionOptions = {},
): IBehaviorNode<RecoveryContext> {
  const resolved = resolveOffStageDecisionOptions(options);

  // Bind a stable reference to the resolved classify options so the
  // predicate closures below don't allocate per tick.
  const classifyOpts = resolved.classify;
  const jumpBudget = options.getJumpBudget;

  // Helper — compute the strategy with the same options and budget
  // every predicate sees. Defining once and reusing keeps the
  // per-tick cost O(1) per predicate evaluation regardless of how
  // many sibling guards the Selector has.
  const strategyOf = (ctx: RecoveryContext): OffStageStrategy =>
    classifyOffStageStrategy(
      ctx.self,
      ctx.stage,
      classifyOpts,
      jumpBudget !== undefined ? jumpBudget(ctx) : undefined,
    );

  // ---- Strategy → leaf branches ------------------------------------------
  // Each branch wraps the corresponding leaf in a Conditional so the
  // leaf only ticks when the classifier elected its strategy. The
  // Conditional defaults `whenFalse` to `Failure`, so a non-matching
  // tick falls through cleanly to the next sibling.
  const ledgeReturnBranch = new ConditionalNode<RecoveryContext>(
    new LedgeReturnLeaf(
      options.ledgeReturn ?? {},
      'hardRecovery.offStageDecision.ledgeReturn.leaf',
    ),
    {
      predicate: (ctx) => strategyOf(ctx) === 'ledgeReturn',
    },
    'hardRecovery.offStageDecision.ledgeReturn',
  );

  const upSpecialBranch = new ConditionalNode<RecoveryContext>(
    new RecoveryMoveLeaf(
      options.upSpecial ?? {},
      'hardRecovery.offStageDecision.upSpecial.leaf',
    ),
    {
      predicate: (ctx) => strategyOf(ctx) === 'upSpecial',
    },
    'hardRecovery.offStageDecision.upSpecial',
  );

  const doubleJumpBranch = new ConditionalNode<RecoveryContext>(
    new DoubleJumpRecoveryLeaf(
      options.doubleJump ?? {},
      'hardRecovery.offStageDecision.doubleJump.leaf',
    ),
    {
      predicate: (ctx) => strategyOf(ctx) === 'doubleJump',
    },
    'hardRecovery.offStageDecision.doubleJump',
  );

  const jumpBranch = new ConditionalNode<RecoveryContext>(
    new JumpRecoveryLeaf(
      options.jump ?? {},
      'hardRecovery.offStageDecision.jump.leaf',
    ),
    {
      predicate: (ctx) => strategyOf(ctx) === 'jump',
    },
    'hardRecovery.offStageDecision.jump',
  );

  // ---- Inner dispatch Selector -------------------------------------------
  // Order matters as documentation of the priority hierarchy even
  // though the predicates are mutually exclusive.
  const dispatch = new SelectorNode<RecoveryContext>(
    [ledgeReturnBranch, upSpecialBranch, doubleJumpBranch, jumpBranch],
    'hardRecovery.offStageDecision.dispatch',
  );

  // ---- Outer off-stage gate ----------------------------------------------
  // Short-circuits the whole subtree to Failure when the bot is on
  // stage / grounded / on a ledge / in hitstun. Saves the four
  // predicate evaluations the inner dispatch would otherwise run
  // every frame the bot spends in neutral.
  return new ConditionalNode<RecoveryContext>(
    dispatch,
    {
      predicate: (ctx) => {
        const s = ctx.self;
        if (s.isInHitstun) return false;
        if (s.isOnLedge) return false;
        if (!s.isAirborne) return false;
        return isOffStage(s, ctx.stage, classifyOpts.verticalSlackPx);
      },
    },
    'hardRecovery.offStageDecision',
  );
}

// ===========================================================================
// RecoveryMoveSelection — Sub-AC 2
// ===========================================================================
//
// Where {@link buildOffStageDecisionSubtree} is the *wide-net* dispatcher
// that picks among four leaves (ledgeReturn / jump / doubleJump /
// upSpecial), this subtree zooms into the harder of the four decisions:
// when the cheap presses (grounded jump, ledge-return) won't suffice,
// which combination of the air-jump and the up-special should fire,
// and in what order?
//
// The three concerns Sub-AC 2 owns:
//
//   1. **Resource tracking** — explicitly considers BOTH
//      `jumpsRemaining` (air-jump budget) AND `upSpecialAvailable`
//      (once-per-air-time recovery move). Reads the
//      `recoveryLastAirJumpTick` / `recoveryLastUpSpecialTick`
//      Blackboard latches so a press that already fired this airborne
//      period isn't re-armed by the classifier.
//
//   2. **Optimal move choice based on position AND velocity** —
//      computes a *reach* estimate for each combination of resources
//      using both the bot's vertical deficit to the nearest ledge AND
//      the kinematic coast (`velocityY < 0` ⇒ the bot is still rising,
//      banking some height for free under gravity). The cheapest
//      combination that closes the deficit wins; valuable resources
//      are saved when a cheaper press alone reaches.
//
//   3. **Execution sequencing** — when the chosen plan needs BOTH
//      presses (`'doubleJumpThenUpSpecial'`), the subtree owns the
//      multi-frame execution: fire DJ first, optionally hold for
//      `apexHoldFrames` so the DJ's vertical impulse banks before the
//      US starts, then fire US. The inter-press hold short-circuits
//      to immediate US press when blast-zone urgency overrides the
//      apex-hold optimization.
//
// Composition
// -----------
//
// Cleanly orthogonal to {@link buildOffStageDecisionSubtree}: an
// integrating controller can use either factory standalone or stack
// them — the wide-net dispatcher routes the broad situations and
// delegates the DJ↔US choice to this subtree. Both are gated by the
// outer "off-stage" predicate so neither fires while the bot is on
// stage / grounded / on a ledge / in hitstun.
//
// Determinism
// -----------
//
// All classification and sequencing logic is deterministic on its
// inputs (snapshots + Blackboard latches + tickIndex). No `Math.random`,
// no wall-clock; identical inputs always produce identical outputs and
// Blackboard transitions. The factory itself reads no Rng — the same
// options always produce an isomorphic tree, so a replay system can
// rebuild the controller from a snapshot.

// ---------------------------------------------------------------------------
// Recovery move tier — output of the resource-aware reach calculator
// ---------------------------------------------------------------------------

/**
 * Discrete plan selected by {@link selectRecoveryMoveTier}. Each value
 * names the cheapest combination of (air-jump, up-special) that gets
 * the bot back to ledge altitude given current position, velocity, and
 * resource availability.
 *
 *   - `'none'`                       — no recovery move needed
 *                                      (on stage / grounded / on a
 *                                      ledge / in hitstun, or simply
 *                                      already going to coast back to
 *                                      ledge altitude under residual
 *                                      upward velocity).
 *
 *   - `'doubleJumpOnly'`             — air-jump alone closes the
 *                                      deficit. Save the up-special
 *                                      for next time. Routes to
 *                                      {@link DoubleJumpRecoveryLeaf}.
 *
 *   - `'upSpecialOnly'`              — air-jump is unavailable (already
 *                                      spent / consumed by knockback)
 *                                      OR the up-special alone reaches
 *                                      and the air-jump would not.
 *                                      Routes to {@link RecoveryMoveLeaf}.
 *
 *   - `'doubleJumpThenUpSpecial'`    — both presses are needed; the
 *                                      subtree fires DJ first, holds
 *                                      for `apexHoldFrames` (or short-
 *                                      circuits on blast-zone urgency),
 *                                      then fires US.
 *
 *   - `'unrecoverable'`              — neither resource combination
 *                                      reaches the nearest ledge. The
 *                                      subtree returns Failure and lets
 *                                      the controller's neutral / idle
 *                                      branch emit. (The OffStageDecision
 *                                      dispatcher would reach the same
 *                                      conclusion via its `'givenUp'`
 *                                      branch; we name the value
 *                                      separately here so callers that
 *                                      use this subtree standalone can
 *                                      surface the diagnosis.)
 */
export type RecoveryMoveTier =
  | 'none'
  | 'doubleJumpOnly'
  | 'upSpecialOnly'
  | 'doubleJumpThenUpSpecial'
  | 'unrecoverable';

/**
 * Tunables for {@link selectRecoveryMoveTier} and
 * {@link buildRecoveryMoveSelectionSubtree}. Every threshold has a
 * default tuned to the M2 roster's average jump heights and up-special
 * arcs; per-character controllers can override via
 * {@link RecoveryMoveSelectionOptions}.
 */
export interface RecoveryMoveSelectionClassifyOptions {
  /**
   * Approximate vertical reach (in design pixels) added by a single
   * air-jump press from a standing-air state. Default `40 px` —
   * mirrors {@link DoubleJumpRecoveryLeaf}'s `ledgeBelowThresholdPx`.
   * Must be ≥ 0.
   */
  readonly doubleJumpReachPx?: number;
  /**
   * Approximate vertical reach (in design pixels) added by the
   * up-special press from a standing-air state. Default `120 px` —
   * empirically the median of the M2 roster's up-special arcs (Wolf's
   * multi-hit rising covers ~140; Owl's directional jump covers ~110).
   * Must be ≥ 0.
   */
  readonly upSpecialReachPx?: number;
  /**
   * Approximate per-frame gravity acceleration in design pixels. Used
   * to compute the kinematic coast — how much extra height the bot
   * banks for free if its current velocity is upward (`velocityY < 0`).
   * Default `0.5 px/frame²` — the engine's tuned platform-fighter
   * gravity. Must be > 0.
   */
  readonly gravityPxPerFrame2?: number;
  /**
   * Extra vertical headroom (in design pixels) the classifier requires
   * over the bare deficit to count a plan as "reaches". Pads against
   * imprecise reach estimates and floating-point fuzz; matches the
   * leaves' arrival-tolerance bands. Default `8 px`. Must be ≥ 0.
   */
  readonly recoverySafetyMarginPx?: number;
  /**
   * Frames-ahead used by the imminent-blast-zone projection. When the
   * projected position falls past any blast wall the subtree
   * short-circuits the apex-hold during a `'doubleJumpThenUpSpecial'`
   * sequence and fires US immediately. Default `60`.
   */
  readonly blastZoneLookaheadFrames?: number;
  /**
   * Vertical slack added to the off-stage check (matches the leaves'
   * options). Default `0`.
   */
  readonly verticalSlackPx?: number;
}

/** Resolved option set with defaults filled in. */
export interface ResolvedRecoveryMoveSelectionClassifyOptions {
  readonly doubleJumpReachPx: number;
  readonly upSpecialReachPx: number;
  readonly gravityPxPerFrame2: number;
  readonly recoverySafetyMarginPx: number;
  readonly blastZoneLookaheadFrames: number;
  readonly verticalSlackPx: number;
}

const DEFAULT_RMS_DOUBLE_JUMP_REACH_PX = 40;
const DEFAULT_RMS_UP_SPECIAL_REACH_PX = 120;
const DEFAULT_RMS_GRAVITY_PX_PER_FRAME2 = 0.5;
const DEFAULT_RMS_SAFETY_MARGIN_PX = 8;
const DEFAULT_RMS_BLAST_ZONE_LOOKAHEAD_FRAMES = 60;
const DEFAULT_RMS_VERTICAL_SLACK_PX = 0;

/** Apply defaults to user-supplied classification options. */
export function resolveRecoveryMoveSelectionClassifyOptions(
  options: RecoveryMoveSelectionClassifyOptions = {},
): ResolvedRecoveryMoveSelectionClassifyOptions {
  const doubleJumpReachPx =
    options.doubleJumpReachPx ?? DEFAULT_RMS_DOUBLE_JUMP_REACH_PX;
  if (!Number.isFinite(doubleJumpReachPx) || doubleJumpReachPx < 0) {
    throw new Error(
      `RecoveryMoveSelection: doubleJumpReachPx must be ≥ 0, got ` +
        String(doubleJumpReachPx),
    );
  }

  const upSpecialReachPx =
    options.upSpecialReachPx ?? DEFAULT_RMS_UP_SPECIAL_REACH_PX;
  if (!Number.isFinite(upSpecialReachPx) || upSpecialReachPx < 0) {
    throw new Error(
      `RecoveryMoveSelection: upSpecialReachPx must be ≥ 0, got ` +
        String(upSpecialReachPx),
    );
  }

  const gravityPxPerFrame2 =
    options.gravityPxPerFrame2 ?? DEFAULT_RMS_GRAVITY_PX_PER_FRAME2;
  if (
    !Number.isFinite(gravityPxPerFrame2) ||
    gravityPxPerFrame2 <= 0
  ) {
    throw new Error(
      `RecoveryMoveSelection: gravityPxPerFrame2 must be > 0, got ` +
        String(gravityPxPerFrame2),
    );
  }

  const recoverySafetyMarginPx =
    options.recoverySafetyMarginPx ?? DEFAULT_RMS_SAFETY_MARGIN_PX;
  if (
    !Number.isFinite(recoverySafetyMarginPx) ||
    recoverySafetyMarginPx < 0
  ) {
    throw new Error(
      `RecoveryMoveSelection: recoverySafetyMarginPx must be ≥ 0, got ` +
        String(recoverySafetyMarginPx),
    );
  }

  const blastZoneLookaheadFrames =
    options.blastZoneLookaheadFrames ??
    DEFAULT_RMS_BLAST_ZONE_LOOKAHEAD_FRAMES;
  if (
    !Number.isFinite(blastZoneLookaheadFrames) ||
    blastZoneLookaheadFrames < 0 ||
    !Number.isInteger(blastZoneLookaheadFrames)
  ) {
    throw new Error(
      `RecoveryMoveSelection: blastZoneLookaheadFrames must be a non-negative integer, got ` +
        String(blastZoneLookaheadFrames),
    );
  }

  const verticalSlackPx =
    options.verticalSlackPx ?? DEFAULT_RMS_VERTICAL_SLACK_PX;
  if (!Number.isFinite(verticalSlackPx) || verticalSlackPx < 0) {
    throw new Error(
      `RecoveryMoveSelection: verticalSlackPx must be ≥ 0, got ` +
        String(verticalSlackPx),
    );
  }

  return {
    doubleJumpReachPx,
    upSpecialReachPx,
    gravityPxPerFrame2,
    recoverySafetyMarginPx,
    blastZoneLookaheadFrames,
    verticalSlackPx,
  };
}

// ---------------------------------------------------------------------------
// Resource view — what's still actually available, after Blackboard latches
// ---------------------------------------------------------------------------

/**
 * Effective resource availability after applying the Blackboard
 * latches. The snapshot's `jumpsRemaining` and `upSpecialAvailable`
 * are the engine's *physical* state, but the recovery sub-tree owns
 * additional latches (`recoveryLastAirJumpTick`,
 * `recoveryLastUpSpecialTick`) that pin "already pressed this
 * airborne period" so a multi-tick Running chain can't double-fire.
 *
 * The classifier consults *both* — a press is only counted as
 * available when both the engine permits it AND the sub-tree hasn't
 * latched it.
 */
export interface RecoveryResourceView {
  /**
   * True iff an air-jump press is still available (engine has air-jump
   * budget AND no latched air-jump press in this airborne period
   * within the optional cooldown window — the leaf's own cooldown
   * gate handles the within-frame replay).
   */
  readonly doubleJumpAvailable: boolean;
  /**
   * True iff the up-special press is still available (engine flag set
   * AND no latched up-special press this airborne period).
   */
  readonly upSpecialAvailable: boolean;
  /** True iff the Blackboard records a DJ press already fired this air-time. */
  readonly doubleJumpAlreadyFired: boolean;
  /** True iff the Blackboard records a US press already fired this air-time. */
  readonly upSpecialAlreadyFired: boolean;
}

/**
 * Pure helper: compute the effective resource view from the snapshot
 * and the Blackboard latches.
 *
 * `recoveryLastAirJumpTick >= 0` ⇒ the sub-tree latched an air-jump
 * press this airborne period; `recoveryLastUpSpecialTick >= 0` ⇒
 * same for the up-special. Both reset to `-1` on landing / ledge
 * grab via {@link clearRecoveryState}.
 *
 * Determinism: pure function of its inputs.
 */
export function computeRecoveryResourceView(
  self: RecoverySelfSnapshot,
  blackboard: RecoveryContext['blackboard'],
): RecoveryResourceView {
  const lastAirJumpTick = blackboard.get('recoveryLastAirJumpTick') ?? -1;
  const lastUpSpecialTick = blackboard.get('recoveryLastUpSpecialTick') ?? -1;
  const doubleJumpAlreadyFired = lastAirJumpTick >= 0;
  const upSpecialAlreadyFired = lastUpSpecialTick >= 0;
  return {
    doubleJumpAvailable:
      self.jumpsRemaining > 0 && !doubleJumpAlreadyFired,
    upSpecialAvailable:
      self.upSpecialAvailable && !upSpecialAlreadyFired,
    doubleJumpAlreadyFired,
    upSpecialAlreadyFired,
  };
}

// ---------------------------------------------------------------------------
// Reach math — position + velocity → upward-travel estimate
// ---------------------------------------------------------------------------

/**
 * Pure helper: kinematic coast in design pixels. How much extra
 * upward travel the bot will bank for free under the engine's
 * gravity if it presses no inputs from the current state.
 *
 * Sign convention: returns a non-negative number. When
 * `velocityY >= 0` (bot already falling or stationary) the coast is
 * `0` — the bot won't gain any height without a press. When
 * `velocityY < 0` (bot rising) the coast is `velocityY² / (2·g)` —
 * the textbook ballistic-apex formula.
 */
export function kinematicUpwardCoastPx(
  self: RecoverySelfSnapshot,
  gravityPxPerFrame2: number,
): number {
  if (self.velocityY >= 0) return 0;
  return (self.velocityY * self.velocityY) / (2 * gravityPxPerFrame2);
}

/**
 * Pure helper: the upward travel (in design pixels) the bot still
 * needs to cover to be at-or-above the nearest ledge corner.
 *
 * Returns `null` when the stage has no nearest ledge (no recovery
 * goal). Returns `0` or a negative number when the bot is already
 * at-or-above the ledge — the move-selection caller uses this to
 * short-circuit to `'none'`.
 */
export function upwardTravelNeededPx(
  self: RecoverySelfSnapshot,
  stage: RecoveryStageGeometry,
): number | null {
  const dy = ledgeYOffset(self, stage);
  if (dy === null) return null;
  // dy > 0 ⇒ ledge is BELOW the bot (Y grows down); upward travel needed = -dy.
  return -dy;
}

// ---------------------------------------------------------------------------
// Tier classifier — the optimal-move-choice decision
// ---------------------------------------------------------------------------

/**
 * Pure helper: classify the cheapest plan that closes the recovery
 * deficit, given the current (self, stage, blackboard) tuple.
 *
 * Decision order (tested boundary-by-boundary in `hardRecovery.test.ts`):
 *
 *   1. **Lockout / non-recovery state** ⇒ `'none'`. Hitstun, on a
 *      ledge, grounded, or on stage — the subtree has no work.
 *
 *   2. **No registered ledge** ⇒ `'unrecoverable'`. A stage with no
 *      grabbable ledge has no goal to plan toward.
 *
 *   3. **Already going to make it** ⇒ `'none'`. The bot's existing
 *      upward velocity (kinematic coast) covers the deficit plus the
 *      safety margin. Don't burn a recovery resource for a non-issue.
 *
 *   4. **DJ alone reaches** ⇒ `'doubleJumpOnly'`. Cheapest sufficient
 *      plan. Consumes one air-jump and saves the up-special for the
 *      next airborne period.
 *
 *   5. **DJ + US together reach (and DJ alone doesn't)** ⇒
 *      `'doubleJumpThenUpSpecial'`. Multi-step plan; the sequencing
 *      runtime fires DJ first, holds for the apex window, then US.
 *
 *   6. **US alone reaches (and DJ + US wasn't picked above)** ⇒
 *      `'upSpecialOnly'`. Reached when the air-jump is unavailable
 *      (already spent / consumed) — typical for late-recovery
 *      situations where the bot has eaten a knockback combo before
 *      the DJ could fire.
 *
 *   7. **Default** ⇒ `'unrecoverable'`. No combination reaches; the
 *      bot is dead.
 *
 * Determinism: pure function of its inputs.
 */
export function selectRecoveryMoveTier(
  self: RecoverySelfSnapshot,
  stage: RecoveryStageGeometry,
  resources: RecoveryResourceView,
  options: RecoveryMoveSelectionClassifyOptions = {},
): RecoveryMoveTier {
  const resolved = resolveRecoveryMoveSelectionClassifyOptions(options);

  // 1. Lockout / non-recovery states — same gating as OffStageDecision.
  if (self.isInHitstun) return 'none';
  if (self.isOnLedge) return 'none';
  if (!self.isAirborne) return 'none';
  if (!isOffStage(self, stage, resolved.verticalSlackPx)) return 'none';

  // 2. Stage has no grabbable ledge — no goal to plan toward.
  const upwardNeeded = upwardTravelNeededPx(self, stage);
  if (upwardNeeded === null) return 'unrecoverable';

  // 3. Bot is already at-or-above the ledge OR going to coast there
  //    under residual upward velocity. No recovery press needed; the
  //    ledge-return leaf (in the parent dispatcher) handles drift.
  const coastPx = kinematicUpwardCoastPx(self, resolved.gravityPxPerFrame2);
  const deficit = upwardNeeded + resolved.recoverySafetyMarginPx;
  if (deficit <= coastPx) return 'none';

  // 3.5. **Mid-sequence stickiness** — once a DJ press has been
  //      latched on the Blackboard but the US press hasn't, the bot
  //      is committed to the DJ→US plan: even if the now-reduced
  //      resource view (DJ unavailable, US still available) would
  //      otherwise classify as `'upSpecialOnly'`, we must stay in
  //      `'doubleJumpThenUpSpecial'` so the sequencing subtree's
  //      apex-hold runs to completion before US fires. Without this
  //      stickiness the post-DJ tick would route to the immediate
  //      US press, eliminating the apex-hold timing entirely.
  //
  //      The stickiness is gated on `upSpecialAvailable` — if the US
  //      has *also* been spent the bot is past the sequence and we
  //      fall through to the regular reach math (which will report
  //      `'unrecoverable'` if neither resource is left).
  if (
    resources.doubleJumpAlreadyFired &&
    !resources.upSpecialAlreadyFired &&
    resources.upSpecialAvailable
  ) {
    return 'doubleJumpThenUpSpecial';
  }

  // 4-7. Resource-aware reach planning. Compute reach for each
  // combination and pick the cheapest sufficient one. Cheapest =
  // "DJ alone" (one resource) over "DJ + US" (two resources).
  const reachWithDJ = resources.doubleJumpAvailable
    ? coastPx + resolved.doubleJumpReachPx
    : -Infinity;
  const reachWithUS = resources.upSpecialAvailable
    ? coastPx + resolved.upSpecialReachPx
    : -Infinity;
  const reachWithBoth =
    resources.doubleJumpAvailable && resources.upSpecialAvailable
      ? coastPx + resolved.doubleJumpReachPx + resolved.upSpecialReachPx
      : -Infinity;

  // 4. DJ alone closes the deficit — cheapest single-resource plan.
  if (reachWithDJ >= deficit) return 'doubleJumpOnly';

  // 5. DJ + US together close the deficit (and DJ alone didn't).
  //    Multi-step plan; the subtree owns the sequencing.
  if (reachWithBoth >= deficit) return 'doubleJumpThenUpSpecial';

  // 6. US alone closes the deficit (only reachable here when the DJ
  //    is unavailable — DJ-available-and-DJ+US-reaches was caught
  //    by branch 5 already).
  if (reachWithUS >= deficit) return 'upSpecialOnly';

  // 7. Nothing reaches. The bot is going to die.
  return 'unrecoverable';
}

// ---------------------------------------------------------------------------
// Apex-hold leaf — execution-sequencing helper for DJ → US plans
// ---------------------------------------------------------------------------

/**
 * Construction options for the apex-hold leaf. The leaf is package-
 * private (only ever instantiated by
 * {@link buildRecoveryMoveSelectionSubtree}) but the option type is
 * exported so test code can override the hold for boundary checks.
 */
export interface RecoveryApexHoldOptions {
  /**
   * Number of frames to hold after the air-jump press before pressing
   * the up-special. Default `8` — empirically, the M2 roster's air-
   * jump impulse banks roughly 30 px of vertical travel in the first
   * 8 frames, which is the sweet spot before gravity starts eating
   * the impulse back. Must be a non-negative integer.
   */
  readonly apexHoldFrames?: number;
  /**
   * Frames-ahead used by the blast-zone projection short-circuit.
   * When the projected position falls past any blast wall during the
   * hold, the leaf returns Failure immediately so the next sibling
   * (US press) fires this tick rather than waiting out the hold.
   * Default `60` (one second).
   */
  readonly blastZoneLookaheadFrames?: number;
  /**
   * Vertical slack added to the off-stage check. Default `0`.
   */
  readonly verticalSlackPx?: number;
  /**
   * If `true` (default), emit `moveUp` while holding so directional
   * up-specials see a vertical stick when they fire on the next tick.
   * Mirrors {@link RecoveryMoveLeaf}'s `emitMoveUp` default.
   */
  readonly emitMoveUp?: boolean;
}

const DEFAULT_RMS_APEX_HOLD_FRAMES = 8;

/**
 * Leaf that holds the sequence between the air-jump press and the
 * up-special press. Reads `recoveryLastAirJumpTick` to discover when
 * the DJ fired and returns:
 *
 *   - `Failure` when no DJ has fired yet (no hold to apply — the
 *     parent Selector falls through to the DJ press).
 *   - `Failure` when the hold has elapsed (`tickIndex - lastAirJumpTick
 *     >= apexHoldFrames`) — the parent Selector falls through to the
 *     US press.
 *   - `Failure` when blast-zone urgency overrides the hold — same
 *     fall-through, US fires this tick.
 *   - `Running` (with optional `moveUp` emit) while the hold is
 *     active — pins the parent Selector at this branch so no other
 *     press fires.
 *
 * The leaf does not consult / set `recoveryLastUpSpecialTick`; the
 * up-special leaf owns that latch in its own onTick.
 */
class RecoveryApexHoldLeaf extends LeafNode<RecoveryContext> {
  private readonly apexHoldFrames: number;
  private readonly blastZoneLookaheadFrames: number;
  private readonly verticalSlackPx: number;
  private readonly emitMoveUp: boolean;

  constructor(options: RecoveryApexHoldOptions = {}, name?: string) {
    super(name);
    const hold = options.apexHoldFrames ?? DEFAULT_RMS_APEX_HOLD_FRAMES;
    if (!Number.isFinite(hold) || hold < 0 || !Number.isInteger(hold)) {
      throw new Error(
        `RecoveryApexHoldLeaf: apexHoldFrames must be a non-negative integer, got ` +
          String(hold),
      );
    }
    const lookahead =
      options.blastZoneLookaheadFrames ??
      DEFAULT_RMS_BLAST_ZONE_LOOKAHEAD_FRAMES;
    if (
      !Number.isFinite(lookahead) ||
      lookahead < 0 ||
      !Number.isInteger(lookahead)
    ) {
      throw new Error(
        `RecoveryApexHoldLeaf: blastZoneLookaheadFrames must be a non-negative integer, got ` +
          String(lookahead),
      );
    }
    const slack = options.verticalSlackPx ?? DEFAULT_RMS_VERTICAL_SLACK_PX;
    if (!Number.isFinite(slack) || slack < 0) {
      throw new Error(
        `RecoveryApexHoldLeaf: verticalSlackPx must be ≥ 0, got ` +
          String(slack),
      );
    }
    this.apexHoldFrames = hold;
    this.blastZoneLookaheadFrames = lookahead;
    this.verticalSlackPx = slack;
    this.emitMoveUp = options.emitMoveUp ?? true;
  }

  protected override onTick(context: RecoveryContext): NodeStatus {
    const self = context.self;
    const stage = context.stage;
    const bb = context.blackboard;

    // Outer state-guards — any of these means "no hold to apply".
    // Keeping them here in addition to the parent ConditionalNode
    // makes the leaf safe to use standalone.
    if (self.isInHitstun) return NodeStatus.Failure;
    if (self.isOnLedge) return NodeStatus.Failure;
    if (!self.isAirborne) return NodeStatus.Failure;
    if (!isOffStage(self, stage, this.verticalSlackPx)) return NodeStatus.Failure;

    const lastAirJumpTick = bb.get('recoveryLastAirJumpTick') ?? -1;
    if (lastAirJumpTick < 0) {
      // DJ hasn't fired yet — nothing to hold around.
      return NodeStatus.Failure;
    }

    const lastUpSpecialTick = bb.get('recoveryLastUpSpecialTick') ?? -1;
    if (lastUpSpecialTick >= 0) {
      // US already fired — sequence is past the hold; fall through.
      return NodeStatus.Failure;
    }

    // Blast-zone urgency short-circuits the hold so US fires NOW.
    if (
      isApproachingBlastZone(self, stage, this.blastZoneLookaheadFrames)
    ) {
      return NodeStatus.Failure;
    }

    // Hold elapsed → fall through so the next Selector sibling fires US.
    if (context.tickIndex - lastAirJumpTick >= this.apexHoldFrames) {
      return NodeStatus.Failure;
    }

    // Still holding — emit moveUp so the directional bias is held
    // through the wait, return Running to pin the parent Selector.
    if (this.emitMoveUp) {
      context.out.emit({
        kind: 'moveUp',
        recoveryStep: 'recoveryMoveSelection.apexHold',
      });
    }
    return NodeStatus.Running;
  }

  /** Inspector for tests / debug overlays. */
  getApexHoldFrames(): number {
    return this.apexHoldFrames;
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
}

// ---------------------------------------------------------------------------
// Subtree builder
// ---------------------------------------------------------------------------

/** Construction options for {@link buildRecoveryMoveSelectionSubtree}. */
export interface RecoveryMoveSelectionOptions {
  /** Tunables forwarded to the tier classifier. */
  readonly classify?: RecoveryMoveSelectionClassifyOptions;
  /** Tunables forwarded to the air-jump (double-jump) leaf. */
  readonly doubleJump?: DoubleJumpRecoveryOptions;
  /** Tunables forwarded to the up-special leaf. */
  readonly upSpecial?: RecoveryMoveOptions;
  /** Tunables forwarded to the apex-hold leaf (sequencing). */
  readonly apexHold?: RecoveryApexHoldOptions;
}

/** Resolved option set with defaults filled in. */
export interface ResolvedRecoveryMoveSelectionOptions {
  readonly classify: ResolvedRecoveryMoveSelectionClassifyOptions;
  readonly apexHoldFrames: number;
}

/**
 * Apply defaults to user-supplied options. Mirrors
 * {@link resolveOffStageDecisionOptions} so the two factories share
 * the same shape for controller introspection / debug-overlay code.
 */
export function resolveRecoveryMoveSelectionOptions(
  options: RecoveryMoveSelectionOptions = {},
): ResolvedRecoveryMoveSelectionOptions {
  return {
    classify: resolveRecoveryMoveSelectionClassifyOptions(options.classify),
    apexHoldFrames:
      options.apexHold?.apexHoldFrames ?? DEFAULT_RMS_APEX_HOLD_FRAMES,
  };
}

/**
 * Build the RecoveryMoveSelection sequencing subtree.
 *
 * Tree shape:
 *
 *   ConditionalNode("recoveryMoveSelection", isInVerticalRecoveryMode)
 *     └── Selector("recoveryMoveSelection.dispatch")
 *           ├── ConditionalNode (tier === 'doubleJumpOnly')
 *           │     └── DoubleJumpRecoveryLeaf
 *           ├── ConditionalNode (tier === 'doubleJumpThenUpSpecial')
 *           │     └── Selector("recoveryMoveSelection.djToUs")
 *           │           ├── ConditionalNode (DJ not yet fired)
 *           │           │     └── DoubleJumpRecoveryLeaf
 *           │           ├── ConditionalNode (DJ fired, US not yet fired)
 *           │           │     └── RecoveryApexHoldLeaf  // Running until hold elapses
 *           │           └── ConditionalNode (DJ fired, US not yet fired)
 *           │                 └── RecoveryMoveLeaf
 *           ├── ConditionalNode (tier === 'upSpecialOnly')
 *           │     └── RecoveryMoveLeaf
 *           └── (no branch for 'unrecoverable' / 'none' — falls through to
 *                Failure so the parent Selector can route to ledge-return /
 *                neutral)
 *
 * Behaviour:
 *
 *   - Returns `Failure` when the bot is on stage / grounded / on a
 *     ledge / in hitstun, OR when the chosen plan is `'none'` /
 *     `'unrecoverable'`.
 *   - Returns `Running` while the apex-hold is active inside a
 *     `'doubleJumpThenUpSpecial'` plan.
 *   - Returns `Success` when a recovery press fires (DJ on the
 *     planning frame, US on the post-hold frame, US on the urgency
 *     short-circuit frame, etc.).
 *
 * Determinism: every leaf, decorator, and conditional used here is
 * deterministic on its inputs. The factory itself reads no Rng — the
 * same options always produce an isomorphic tree, so a replay can
 * rebuild the controller from a snapshot by calling the factory.
 */
export function buildRecoveryMoveSelectionSubtree(
  options: RecoveryMoveSelectionOptions = {},
): IBehaviorNode<RecoveryContext> {
  const resolved = resolveRecoveryMoveSelectionOptions(options);
  const classifyOpts = resolved.classify;

  // Helper — resource view + tier in one place so all predicates
  // produce consistent answers within a single tick.
  const tierOf = (ctx: RecoveryContext): RecoveryMoveTier => {
    const resources = computeRecoveryResourceView(ctx.self, ctx.blackboard);
    return selectRecoveryMoveTier(
      ctx.self,
      ctx.stage,
      resources,
      classifyOpts,
    );
  };

  // ---- 'doubleJumpOnly' branch -------------------------------------------
  const doubleJumpOnlyBranch = new ConditionalNode<RecoveryContext>(
    new DoubleJumpRecoveryLeaf(
      options.doubleJump ?? {},
      'recoveryMoveSelection.doubleJumpOnly.leaf',
    ),
    {
      predicate: (ctx) => tierOf(ctx) === 'doubleJumpOnly',
    },
    'recoveryMoveSelection.doubleJumpOnly',
  );

  // ---- 'doubleJumpThenUpSpecial' sequencing branch -----------------------
  // The inner Selector picks the right phase based on which presses
  // have already been latched on the Blackboard.
  //
  //   Phase 1: DJ has not yet fired → fire DJ. Latches
  //            recoveryLastAirJumpTick.
  //
  //   Phase 2: DJ has fired, US has not, hold not elapsed and no
  //            urgency → ApexHoldLeaf returns Running (with optional
  //            moveUp emit). Pins the Selector here for the hold
  //            duration without firing anything else.
  //
  //   Phase 3: DJ has fired, US has not, hold elapsed OR urgency →
  //            ApexHoldLeaf returns Failure, this Conditional fires
  //            US. Latches recoveryLastUpSpecialTick.
  //
  // After both presses, every phase predicate is false and the
  // Selector falls through to Failure, returning the tick to
  // siblings (typically a ledge-return leaf in the integrating
  // controller's outer Selector).
  const djNotYetFired = (ctx: RecoveryContext): boolean => {
    const lastDJ = ctx.blackboard.get('recoveryLastAirJumpTick') ?? -1;
    return lastDJ < 0;
  };
  const djFiredUsNotYet = (ctx: RecoveryContext): boolean => {
    const lastDJ = ctx.blackboard.get('recoveryLastAirJumpTick') ?? -1;
    const lastUS = ctx.blackboard.get('recoveryLastUpSpecialTick') ?? -1;
    return lastDJ >= 0 && lastUS < 0;
  };

  const djToUsSequence = new SelectorNode<RecoveryContext>(
    [
      // Phase 1 — DJ press.
      new ConditionalNode<RecoveryContext>(
        new DoubleJumpRecoveryLeaf(
          options.doubleJump ?? {},
          'recoveryMoveSelection.djToUs.dj.leaf',
        ),
        { predicate: djNotYetFired },
        'recoveryMoveSelection.djToUs.dj',
      ),
      // Phase 2 — apex-hold wait. Returns Running when the hold is
      // active; Failure when the hold elapses or urgency triggers.
      new ConditionalNode<RecoveryContext>(
        new RecoveryApexHoldLeaf(
          {
            apexHoldFrames: options.apexHold?.apexHoldFrames,
            blastZoneLookaheadFrames:
              options.apexHold?.blastZoneLookaheadFrames ??
              classifyOpts.blastZoneLookaheadFrames,
            verticalSlackPx:
              options.apexHold?.verticalSlackPx ??
              classifyOpts.verticalSlackPx,
            emitMoveUp: options.apexHold?.emitMoveUp,
          },
          'recoveryMoveSelection.djToUs.apexHold.leaf',
        ),
        { predicate: djFiredUsNotYet },
        'recoveryMoveSelection.djToUs.apexHold',
      ),
      // Phase 3 — US press.
      new ConditionalNode<RecoveryContext>(
        new RecoveryMoveLeaf(
          options.upSpecial ?? {},
          'recoveryMoveSelection.djToUs.us.leaf',
        ),
        { predicate: djFiredUsNotYet },
        'recoveryMoveSelection.djToUs.us',
      ),
    ],
    'recoveryMoveSelection.djToUs',
  );

  const doubleJumpThenUpSpecialBranch = new ConditionalNode<RecoveryContext>(
    djToUsSequence,
    {
      predicate: (ctx) => tierOf(ctx) === 'doubleJumpThenUpSpecial',
    },
    'recoveryMoveSelection.doubleJumpThenUpSpecial',
  );

  // ---- 'upSpecialOnly' branch --------------------------------------------
  const upSpecialOnlyBranch = new ConditionalNode<RecoveryContext>(
    new RecoveryMoveLeaf(
      options.upSpecial ?? {},
      'recoveryMoveSelection.upSpecialOnly.leaf',
    ),
    {
      predicate: (ctx) => tierOf(ctx) === 'upSpecialOnly',
    },
    'recoveryMoveSelection.upSpecialOnly',
  );

  // ---- Inner dispatch Selector -------------------------------------------
  // Order is "cheapest single-resource → multi-step → US-only fallback".
  // Predicates are mutually exclusive on tier, so only one branch ticks
  // per frame, but the order documents the priority hierarchy.
  const dispatch = new SelectorNode<RecoveryContext>(
    [
      doubleJumpOnlyBranch,
      doubleJumpThenUpSpecialBranch,
      upSpecialOnlyBranch,
    ],
    'recoveryMoveSelection.dispatch',
  );

  // ---- Outer state gate --------------------------------------------------
  // Same gate as OffStageDecision — short-circuits to Failure when the
  // bot is on stage / grounded / on a ledge / in hitstun. Saves the
  // tier evaluation (and resource-view computation) every frame the
  // bot spends in neutral.
  return new ConditionalNode<RecoveryContext>(
    dispatch,
    {
      predicate: (ctx) => {
        const s = ctx.self;
        if (s.isInHitstun) return false;
        if (s.isOnLedge) return false;
        if (!s.isAirborne) return false;
        return isOffStage(s, ctx.stage, classifyOpts.verticalSlackPx);
      },
    },
    'recoveryMoveSelection',
  );
}

// ===========================================================================
// LedgeMixup — Sub-AC 3
// ===========================================================================
//
// Where {@link buildOffStageDecisionSubtree} solved "press the cheapest
// recovery resource" and {@link buildRecoveryMoveSelectionSubtree} solved
// "what combination of jump+up-special closes the deficit", this subtree
// owns the *next* problem in the pipeline:
//
//   the bot has just successfully reached the ledge — what does it do now?
//
// In Smash-style platform fighters, the "ledge mix-up" is the most heavily
// theory-crafted sequence of the whole game: the recovering player has a
// short window of i-frames on the ledge and a small handful of escape
// options (neutral get-up, attack get-up, jump up, roll). The opponent's
// "ledge cover" reads one of those options and punishes. A predictable
// recovering player loses every interaction; a *random* recovering player
// — drawing from a seeded Rng so replays stay deterministic — flips the
// matchup back to roughly 50/50.
//
// The three concerns Sub-AC 3 owns:
//
//   1. **Ledge-grab timing** — when the bot is one drift away from the
//      ledge and an opponent is anti-airing the corner, sometimes the
//      best play is to *stall briefly below the ledge* so the opponent's
//      coverage attack whiffs before the bot commits. The
//      {@link LedgePreGrabStallLeaf} owns this — it returns Running with
//      a small (rng-seeded) hold count when an opponent is positioned
//      *directly above* the target ledge, then bails to Failure so the
//      regular ledge-return path takes over.
//
//   2. **Get-up option randomization** — once the bot is on the ledge,
//      pick a get-up option from {@link LedgeMixupGetUpOption} using the
//      seeded Rng with weights tuned to the opponent's position +
//      damage. Stable across the hang frames (the choice is committed to
//      the Blackboard on the first on-ledge tick), then fired on a
//      jittered emit tick so neither the *choice* nor the *timing* is
//      readable. The {@link LedgeGetUpLeaf} owns this.
//
//   3. **Opponent-aware ledge trump / regrab** — two related behaviours:
//
//        a. *Ledge trump* — when the bot is approaching the ledge AND
//           the opponent is already hanging on it, the bot commits to
//           the grab anyway. The engine's grab detection awards the
//           ledge to the *newest* grabber, "trumping" the opponent off
//           and into hitstun-ish ledge-release. The
//           {@link LedgeTrumpLeaf} fires the explicit drift even when
//           the regular ledge-return would conservatively hold off.
//
//        b. *Regrab* — when the bot has been hanging on the ledge long
//           enough that its i-frames are about to expire, the optimal
//           defensive play is to drop off and re-grab to refresh the
//           invincibility window. The {@link LedgeRegrabLeaf} fires
//           `moveDown` once when the staleness threshold is hit, then
//           lets the regular recovery dispatcher rise back to the
//           ledge for the next mix-up cycle.
//
// Composition
// -----------
//
// The subtree composes cleanly with both Sub-AC 1 and Sub-AC 2: callers
// stack it as a sibling under a top-level Selector. The outer gate
// activates only when the bot is *either* on a ledge *or* approaching
// the ledge with an opponent within reach — every other tick falls
// through to Failure so unrelated branches still get their chance to
// fire. None of the leaves modify the recovery latches owned by the
// other two subtrees (`recoveryLastAirJumpTick`,
// `recoveryLastUpSpecialTick`); they coordinate through three new
// fields (`ledgeMixupGrabTick`, `ledgeMixupGetUpOption`,
// `ledgeMixupGetUpEmitTick`) declared in
// {@link import('../recovery/types').RecoveryBlackboardSchema}.
//
// Determinism
// -----------
//
// The single source of randomness is `context.rng`. Each rng draw is
// stamped onto the Blackboard so subsequent ticks during the same
// hang reproduce the same plan; replay scrubs that rebuild the
// Blackboard from a snapshot recover the exact mix-up the original
// match played out. Tests construct two independent harnesses with
// the same seed and assert byte-identical emits + Blackboard state.

// ---------------------------------------------------------------------------
// Opponent snapshot — what the LedgeMixup branches need from the foe
// ---------------------------------------------------------------------------

/**
 * Slice of opponent state the LedgeMixup branches consult each tick.
 * Distinct from the offensive sub-tree's full
 * {@link import('../offensive/types').OpponentSnapshot} because the
 * recovery context is engine-agnostic and intentionally narrower —
 * we only need *position* + *on-ledge* + *damage* to make ledge-trump
 * and get-up choices.
 *
 *   - `positionX` / `positionY` — world-space (design pixels).
 *   - `isOnLedge`               — true iff the opponent is currently
 *                                 latched on a stage ledge corner.
 *                                 Drives the ledge-trump branch.
 *   - `damagePercent`           — opponent's current damage. Hard-tier
 *                                 get-up weighting biases toward the
 *                                 attack get-up at high opponent %
 *                                 (a stale opponent at 120% can be
 *                                 KO'd by the get-up swing).
 */
export interface LedgeMixupOpponentSnapshot {
  readonly positionX: number;
  readonly positionY: number;
  readonly isOnLedge: boolean;
  readonly damagePercent: number;
}

/**
 * Optional callback the controller wires into
 * {@link buildLedgeMixupSubtree} to surface the opponent snapshot. The
 * recovery {@link RecoveryContext} is intentionally opponent-agnostic
 * (offensive/recovery decoupling); this getter lets the LedgeMixup
 * subtree pull opponent data through a controller-owned closure
 * without coupling the base recovery types to the offensive module.
 *
 * Returning `null` means "no opponent in scope this tick" — the
 * mix-up subtree falls back to opponent-blind defaults (random get-up
 * with even weights, no ledge trump, no regrab pressure).
 */
export type LedgeMixupOpponentGetter = (
  context: RecoveryContext,
) => LedgeMixupOpponentSnapshot | null;

// ---------------------------------------------------------------------------
// Get-up option weighting
// ---------------------------------------------------------------------------

/**
 * Discrete weights (non-negative reals — they don't need to sum to
 * `1`, the chooser normalises) for each get-up option. Higher weight
 * → higher draw probability.
 *
 * Defaults reflect the empirically-tuned Hard-tier mix:
 *   - even base spread across the four options
 *   - the chooser additionally biases by opponent state (close/far,
 *     low/high %), so these are the *cold* baseline.
 */
export interface LedgeGetUpWeights {
  readonly normal?: number;
  readonly attack?: number;
  readonly jump?: number;
  readonly roll?: number;
}

/** Resolved weights with defaults filled in. */
export interface ResolvedLedgeGetUpWeights {
  readonly normal: number;
  readonly attack: number;
  readonly jump: number;
  readonly roll: number;
}

const DEFAULT_LEDGE_GET_UP_WEIGHTS: ResolvedLedgeGetUpWeights = Object.freeze({
  normal: 1,
  attack: 1,
  jump: 1,
  roll: 1,
});

/** Apply defaults to the user-supplied weights. */
export function resolveLedgeGetUpWeights(
  weights: LedgeGetUpWeights = {},
): ResolvedLedgeGetUpWeights {
  const normal = weights.normal ?? DEFAULT_LEDGE_GET_UP_WEIGHTS.normal;
  const attack = weights.attack ?? DEFAULT_LEDGE_GET_UP_WEIGHTS.attack;
  const jump = weights.jump ?? DEFAULT_LEDGE_GET_UP_WEIGHTS.jump;
  const roll = weights.roll ?? DEFAULT_LEDGE_GET_UP_WEIGHTS.roll;
  for (const [name, value] of [
    ['normal', normal],
    ['attack', attack],
    ['jump', jump],
    ['roll', roll],
  ] as const) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(
        `LedgeMixup: get-up weight "${name}" must be ≥ 0 and finite, got ` +
          String(value),
      );
    }
  }
  if (normal + attack + jump + roll <= 0) {
    throw new Error(
      `LedgeMixup: at least one get-up weight must be positive (got all-zero)`,
    );
  }
  return { normal, attack, jump, roll };
}

/**
 * Pure helper: deterministically pick a get-up option from
 * {@link LedgeMixupGetUpOption} using the provided weights and a
 * single rng draw. The opponent snapshot tilts the weights:
 *
 *   - Opponent close to the ledge corner (within
 *     `attackBonusRangePx`) ⇒ bump `attack` (catch the cover).
 *   - Opponent far from the ledge corner (beyond `rollBonusRangePx`)
 *     ⇒ bump `roll` (close the gap with i-frames).
 *   - Opponent at high damage (≥ `attackKoPercent`) ⇒ further bump
 *     `attack` (KO threat).
 *
 * The weights map back to the four options' *bias* — the rng draw
 * is the only source of randomness. Determinism: pure on its inputs.
 */
export function chooseLedgeGetUpOption(
  rng: { next(): number },
  opponent: LedgeMixupOpponentSnapshot | null,
  ledgeX: number | null,
  baseWeights: ResolvedLedgeGetUpWeights = DEFAULT_LEDGE_GET_UP_WEIGHTS,
  options: {
    readonly attackBonusRangePx?: number;
    readonly rollBonusRangePx?: number;
    readonly attackKoPercent?: number;
    readonly attackCloseBonus?: number;
    readonly rollFarBonus?: number;
    readonly attackKoBonus?: number;
  } = {},
): LedgeMixupGetUpOption {
  const attackBonusRangePx = options.attackBonusRangePx ?? 80;
  const rollBonusRangePx = options.rollBonusRangePx ?? 200;
  const attackKoPercent = options.attackKoPercent ?? 100;
  const attackCloseBonus = options.attackCloseBonus ?? 1.5;
  const rollFarBonus = options.rollFarBonus ?? 1.5;
  const attackKoBonus = options.attackKoBonus ?? 1.0;

  let normal = baseWeights.normal;
  let attack = baseWeights.attack;
  let jump = baseWeights.jump;
  let roll = baseWeights.roll;

  if (opponent !== null && ledgeX !== null) {
    const horizontalGap = Math.abs(opponent.positionX - ledgeX);
    if (horizontalGap <= attackBonusRangePx) {
      attack += attackCloseBonus;
    } else if (horizontalGap >= rollBonusRangePx) {
      roll += rollFarBonus;
    }
    if (opponent.damagePercent >= attackKoPercent) {
      attack += attackKoBonus;
    }
  }

  // Single rng draw, weighted bucket pick. Weighted bucket sum cannot
  // be zero — `resolveLedgeGetUpWeights` enforced ≥ 1 positive weight
  // and bonuses are non-negative.
  const total = normal + attack + jump + roll;
  const draw = rng.next() * total;
  if (draw < normal) return 'normal';
  if (draw < normal + attack) return 'attack';
  if (draw < normal + attack + jump) return 'jump';
  return 'roll';
}

// ---------------------------------------------------------------------------
// LedgePreGrabStallLeaf — vary the timing of the actual ledge press
// ---------------------------------------------------------------------------

/** Construction options for {@link LedgePreGrabStallLeaf}. */
export interface LedgePreGrabStallOptions {
  /**
   * Min number of frames the leaf will hold before letting the
   * regular ledge-return path commit. Must be a non-negative integer.
   * Default `0` (no minimum hold — only kicks in when the conditions
   * call for it).
   */
  readonly minStallFrames?: number;
  /**
   * Max number of frames the leaf will hold. Must be a non-negative
   * integer ≥ `minStallFrames`. Default `12`.
   */
  readonly maxStallFrames?: number;
  /**
   * Vertical distance below the ledge corner (in design pixels)
   * within which the leaf considers stalling — outside this range
   * the bot is too far for the stall to matter and the leaf bails.
   * Default `48`. Must be ≥ 0.
   */
  readonly proximityYPx?: number;
  /**
   * Horizontal distance from the ledge column within which the leaf
   * considers stalling. Default `120`. Must be ≥ 0.
   */
  readonly proximityXPx?: number;
  /**
   * Vertical band above the ledge (in design pixels) where an
   * opponent counts as "covering" the ledge corner. The stall only
   * fires when an opponent is in this band. Default `80`.
   */
  readonly opponentCoverYPx?: number;
  /**
   * Horizontal band around the ledge column where an opponent counts
   * as "covering" the ledge corner. Default `120`.
   */
  readonly opponentCoverXPx?: number;
  /**
   * If `true` (default), emit `idle` while stalling so the controller
   * sees an explicit "do nothing" rather than no emit at all.
   */
  readonly emitIdle?: boolean;
}

const DEFAULT_LEDGE_STALL_MIN_FRAMES = 0;
const DEFAULT_LEDGE_STALL_MAX_FRAMES = 12;
const DEFAULT_LEDGE_STALL_PROXIMITY_Y_PX = 48;
const DEFAULT_LEDGE_STALL_PROXIMITY_X_PX = 120;
const DEFAULT_LEDGE_OPPONENT_COVER_Y_PX = 80;
const DEFAULT_LEDGE_OPPONENT_COVER_X_PX = 120;

/**
 * Leaf that injects a randomised hold *before* the ledge grab so the
 * bot's ledge-grab timing isn't readable. Conditions:
 *
 *   - Bot is airborne, off-stage, near the ledge corner, AND
 *   - An opponent is positioned *directly above* the ledge (the
 *     classic ledge-cover stance).
 *
 * On the first matching tick the leaf draws an rng-seeded stall
 * count in `[minStallFrames, maxStallFrames]` and persists the start
 * tick on the Blackboard via `recoveryPhaseStartTick` (with phase
 * forced to `'idle'` so the LedgeReturnLeaf doesn't double-stamp).
 * While the stall is active the leaf returns Running with an `idle`
 * emit; once the count elapses or the conditions break, returns
 * Failure so the parent Selector falls through to the next branch
 * (typically the regular ledge-return).
 */
export class LedgePreGrabStallLeaf extends LeafNode<RecoveryContext> {
  private readonly minStallFrames: number;
  private readonly maxStallFrames: number;
  private readonly proximityYPx: number;
  private readonly proximityXPx: number;
  private readonly opponentCoverYPx: number;
  private readonly opponentCoverXPx: number;
  private readonly emitIdle: boolean;
  private readonly getOpponent: LedgeMixupOpponentGetter | undefined;

  /**
   * Local plan: the chosen end tick for the active stall, or `-1`
   * when no stall is in flight. Stored on the leaf instance because
   * a *random* hold count is transient and recomputable from the
   * same rng state if the BT is rebuilt mid-stall — keeping it off
   * the Blackboard avoids polluting the snapshot schema with
   * one-off scratch state.
   */
  private stallEndTick: number = -1;

  constructor(
    options: LedgePreGrabStallOptions = {},
    getOpponent?: LedgeMixupOpponentGetter,
    name?: string,
  ) {
    super(name);
    const minStall =
      options.minStallFrames ?? DEFAULT_LEDGE_STALL_MIN_FRAMES;
    const maxStall =
      options.maxStallFrames ?? DEFAULT_LEDGE_STALL_MAX_FRAMES;
    if (
      !Number.isFinite(minStall) ||
      minStall < 0 ||
      !Number.isInteger(minStall)
    ) {
      throw new Error(
        `LedgePreGrabStallLeaf: minStallFrames must be a non-negative integer, got ` +
          String(minStall),
      );
    }
    if (
      !Number.isFinite(maxStall) ||
      maxStall < 0 ||
      !Number.isInteger(maxStall)
    ) {
      throw new Error(
        `LedgePreGrabStallLeaf: maxStallFrames must be a non-negative integer, got ` +
          String(maxStall),
      );
    }
    if (maxStall < minStall) {
      throw new Error(
        `LedgePreGrabStallLeaf: maxStallFrames (${maxStall}) must be ≥ minStallFrames (${minStall})`,
      );
    }
    const proximityY =
      options.proximityYPx ?? DEFAULT_LEDGE_STALL_PROXIMITY_Y_PX;
    const proximityX =
      options.proximityXPx ?? DEFAULT_LEDGE_STALL_PROXIMITY_X_PX;
    const coverY =
      options.opponentCoverYPx ?? DEFAULT_LEDGE_OPPONENT_COVER_Y_PX;
    const coverX =
      options.opponentCoverXPx ?? DEFAULT_LEDGE_OPPONENT_COVER_X_PX;
    for (const [name, value] of [
      ['proximityYPx', proximityY],
      ['proximityXPx', proximityX],
      ['opponentCoverYPx', coverY],
      ['opponentCoverXPx', coverX],
    ] as const) {
      if (!Number.isFinite(value) || value < 0) {
        throw new Error(
          `LedgePreGrabStallLeaf: ${name} must be ≥ 0, got ` + String(value),
        );
      }
    }
    this.minStallFrames = minStall;
    this.maxStallFrames = maxStall;
    this.proximityYPx = proximityY;
    this.proximityXPx = proximityX;
    this.opponentCoverYPx = coverY;
    this.opponentCoverXPx = coverX;
    this.emitIdle = options.emitIdle ?? true;
    this.getOpponent = getOpponent;
  }

  override reset(): void {
    super.reset();
    this.stallEndTick = -1;
  }

  protected override onTick(context: RecoveryContext): NodeStatus {
    const self = context.self;
    const stage = context.stage;

    // Lockout / non-mixup states.
    if (self.isInHitstun) return this.bail();
    if (self.isOnLedge) return this.bail();
    if (!self.isAirborne) return this.bail();
    if (stage.nearestLedge === null) return this.bail();

    // Proximity gate — only stall when the bot is genuinely near the
    // grab. Sign convention: dy > 0 ⇒ ledge below bot (bot above the
    // corner, overshooting); dy < 0 ⇒ bot below ledge (the typical
    // pre-grab position). Either way, the absolute distance must be
    // within proximityYPx for the stall to be useful.
    const dx = ledgeXOffset(self, stage);
    const dy = ledgeYOffset(self, stage);
    if (dx === null || dy === null) return this.bail();
    if (Math.abs(dx) > this.proximityXPx) return this.bail();
    if (Math.abs(dy) > this.proximityYPx) return this.bail();

    // Opponent-cover gate — only stall when the opponent is parked
    // above the ledge corner. Without an opponent (or with no getter)
    // the stall doesn't fire — predictable timing is fine in solo
    // recovery.
    const opponent = this.getOpponent?.(context) ?? null;
    if (opponent === null) return this.bail();

    const opXGap = Math.abs(opponent.positionX - stage.nearestLedge.x);
    const opYAbove = stage.nearestLedge.y - opponent.positionY;
    if (opXGap > this.opponentCoverXPx) return this.bail();
    if (opYAbove < 0 || opYAbove > this.opponentCoverYPx) return this.bail();

    // Plan the stall on the first matching tick.
    if (this.stallEndTick < 0 || context.tickIndex > this.stallEndTick) {
      const range = this.maxStallFrames - this.minStallFrames;
      const draw =
        range > 0
          ? Math.floor(context.rng.next() * (range + 1))
          : 0;
      this.stallEndTick = context.tickIndex + this.minStallFrames + draw;
    }

    // Stall elapsed → fall through so the regular ledge-return takes over.
    if (context.tickIndex >= this.stallEndTick) {
      this.reset();
      return NodeStatus.Failure;
    }

    if (this.emitIdle) {
      context.out.emit({
        kind: 'idle',
        recoveryStep: 'ledgeMixup.preGrabStall',
      });
    }
    return NodeStatus.Running;
  }

  /** Resets the local plan and returns Failure. */
  private bail(): NodeStatus {
    this.stallEndTick = -1;
    return NodeStatus.Failure;
  }

  /** Inspector for tests / debug overlays. */
  getStallEndTick(): number {
    return this.stallEndTick;
  }
}

// ---------------------------------------------------------------------------
// LedgeTrumpLeaf — commit to the grab even when opponent has it
// ---------------------------------------------------------------------------

/** Construction options for {@link LedgeTrumpLeaf}. */
export interface LedgeTrumpOptions {
  /**
   * Horizontal alignment tolerance (px) — once within this many px of
   * the ledge column the leaf emits `idle` (no over-push) so the
   * engine's grab magnet finishes the trump. Default `12`.
   */
  readonly arrivalToleranceXPx?: number;
  /**
   * Vertical tolerance — bot must be at-or-above the ledge corner by
   * less than this many px to be a viable trump candidate. Above
   * this the bot is too high (overshooting) and lets the regular
   * dispatch route them via fall. Default `24`.
   */
  readonly overshootToleranceYPx?: number;
  /**
   * Maximum vertical distance below the ledge (px) at which a trump
   * is still attempted. Beyond this the bot has no business pressing
   * a trump — the regular jump/up-special path handles the climb
   * first. Default `40` (mirrors `doubleJumpReachPx`).
   */
  readonly trumpProximityYPx?: number;
}

const DEFAULT_TRUMP_ARRIVAL_TOLERANCE_X_PX = 12;
const DEFAULT_TRUMP_OVERSHOOT_TOLERANCE_Y_PX = 24;
const DEFAULT_TRUMP_PROXIMITY_Y_PX = 40;

/**
 * Leaf that drives the bot's horizontal drift onto the ledge column
 * even when the opponent is currently latched on it. The engine's
 * ledge-grab detection awards the corner to the *most recent* grabber,
 * so the bot's grab "trumps" the opponent into a brief release.
 *
 * Logic mirrors {@link LedgeReturnLeaf} but with priority: it does
 * not bail when "above the ledge", it commits the grab whenever the
 * bot is within proximity AND the opponent is the one currently
 * holding the ledge.
 */
export class LedgeTrumpLeaf extends LeafNode<RecoveryContext> {
  private readonly arrivalToleranceXPx: number;
  private readonly overshootToleranceYPx: number;
  private readonly trumpProximityYPx: number;
  private readonly getOpponent: LedgeMixupOpponentGetter | undefined;

  constructor(
    options: LedgeTrumpOptions = {},
    getOpponent?: LedgeMixupOpponentGetter,
    name?: string,
  ) {
    super(name);
    const arrival =
      options.arrivalToleranceXPx ?? DEFAULT_TRUMP_ARRIVAL_TOLERANCE_X_PX;
    const overshoot =
      options.overshootToleranceYPx ??
      DEFAULT_TRUMP_OVERSHOOT_TOLERANCE_Y_PX;
    const proximityY =
      options.trumpProximityYPx ?? DEFAULT_TRUMP_PROXIMITY_Y_PX;
    for (const [name, value] of [
      ['arrivalToleranceXPx', arrival],
      ['overshootToleranceYPx', overshoot],
      ['trumpProximityYPx', proximityY],
    ] as const) {
      if (!Number.isFinite(value) || value < 0) {
        throw new Error(
          `LedgeTrumpLeaf: ${name} must be ≥ 0, got ` + String(value),
        );
      }
    }
    this.arrivalToleranceXPx = arrival;
    this.overshootToleranceYPx = overshoot;
    this.trumpProximityYPx = proximityY;
    this.getOpponent = getOpponent;
  }

  protected override onTick(context: RecoveryContext): NodeStatus {
    const self = context.self;
    const stage = context.stage;

    if (self.isInHitstun) return NodeStatus.Failure;
    if (self.isOnLedge) return NodeStatus.Failure;
    if (!self.isAirborne) return NodeStatus.Failure;
    if (stage.nearestLedge === null) return NodeStatus.Failure;

    // Trump only makes sense if the OPPONENT currently holds the ledge.
    const opponent = this.getOpponent?.(context) ?? null;
    if (opponent === null || !opponent.isOnLedge) return NodeStatus.Failure;

    const dx = ledgeXOffset(self, stage);
    const dy = ledgeYOffset(self, stage);
    if (dx === null || dy === null) return NodeStatus.Failure;

    // Bot must be within proximity range of the ledge — too far below
    // and we should be climbing first; too far above and gravity will
    // settle us into the standard return path.
    if (dy > this.trumpProximityYPx) return NodeStatus.Failure;
    if (-dy > this.overshootToleranceYPx) return NodeStatus.Failure;

    if (Math.abs(dx) <= this.arrivalToleranceXPx) {
      context.out.emit({ kind: 'idle', recoveryStep: 'ledgeMixup.trump.arrive' });
      return NodeStatus.Running;
    }
    context.out.emit({
      kind: dx > 0 ? 'moveRight' : 'moveLeft',
      recoveryStep: 'ledgeMixup.trump.drift',
    });
    return NodeStatus.Running;
  }
}

// ---------------------------------------------------------------------------
// LedgeGetUpLeaf — randomise the get-up option after the hang
// ---------------------------------------------------------------------------

/** Construction options for {@link LedgeGetUpLeaf}. */
export interface LedgeGetUpOptions {
  /**
   * Mean number of frames to hang on the ledge before firing the
   * chosen get-up. Default `30` (~½ second). Must be a non-negative
   * integer.
   */
  readonly hangMeanFrames?: number;
  /**
   * Max +/- jitter applied to the hang duration via the rng. The
   * effective hang is `[hangMeanFrames - hangJitterFrames,
   * hangMeanFrames + hangJitterFrames]`. Default `12`.
   * Must be a non-negative integer ≤ `hangMeanFrames`.
   */
  readonly hangJitterFrames?: number;
  /**
   * Weights for the four get-up options. Defaults are even.
   */
  readonly weights?: LedgeGetUpWeights;
  /**
   * Tunables for the opponent-aware weight bumping. See
   * {@link chooseLedgeGetUpOption}.
   */
  readonly opponentWeighting?: {
    readonly attackBonusRangePx?: number;
    readonly rollBonusRangePx?: number;
    readonly attackKoPercent?: number;
    readonly attackCloseBonus?: number;
    readonly rollFarBonus?: number;
    readonly attackKoBonus?: number;
  };
}

const DEFAULT_HANG_MEAN_FRAMES = 30;
const DEFAULT_HANG_JITTER_FRAMES = 12;

/**
 * Leaf that randomises the get-up option after a (jittered) hang on
 * the ledge.
 *
 * Behaviour:
 *   1. Bot is not on a ledge (or is in hitstun) ⇒ Failure (and
 *      clear any in-flight plan).
 *   2. First on-ledge tick ⇒ commit a plan: rng-pick the option
 *      (via {@link chooseLedgeGetUpOption}) and the emit tick
 *      (mean ± jitter). Persist on the Blackboard.
 *   3. Hang in progress ⇒ emit `idle` (so controllers see an
 *      explicit "I'm hanging") and return Running.
 *   4. Emit tick reached ⇒ emit the action verb that maps to the
 *      chosen option, clear the plan, return Success.
 *
 * Action verbs:
 *   - `'normal'` ⇒ `moveUp` (release upward off the ledge).
 *   - `'attack'` ⇒ `airDodge` (closest available defensive verb;
 *     the controller's ledge-cancel handler maps this to a get-up
 *     attack at the engine layer).
 *   - `'jump'`   ⇒ `jump` (release upward with a jump press).
 *   - `'roll'`   ⇒ `moveDown` (drop-through trigger; the controller
 *     translates this into the engine's roll get-up at the ledge).
 *
 * The verb mapping is documented inline because the recovery action
 * union is intentionally small; the controller-side translation
 * layer interprets these as get-up options when `recoveryStep`
 * starts with `ledgeMixup.getUp.`.
 */
export class LedgeGetUpLeaf extends LeafNode<RecoveryContext> {
  private readonly hangMeanFrames: number;
  private readonly hangJitterFrames: number;
  private readonly weights: ResolvedLedgeGetUpWeights;
  private readonly opponentWeighting:
    | NonNullable<LedgeGetUpOptions['opponentWeighting']>
    | undefined;
  private readonly getOpponent: LedgeMixupOpponentGetter | undefined;

  constructor(
    options: LedgeGetUpOptions = {},
    getOpponent?: LedgeMixupOpponentGetter,
    name?: string,
  ) {
    super(name);
    const hangMean = options.hangMeanFrames ?? DEFAULT_HANG_MEAN_FRAMES;
    const hangJitter = options.hangJitterFrames ?? DEFAULT_HANG_JITTER_FRAMES;
    if (
      !Number.isFinite(hangMean) ||
      hangMean < 0 ||
      !Number.isInteger(hangMean)
    ) {
      throw new Error(
        `LedgeGetUpLeaf: hangMeanFrames must be a non-negative integer, got ` +
          String(hangMean),
      );
    }
    if (
      !Number.isFinite(hangJitter) ||
      hangJitter < 0 ||
      !Number.isInteger(hangJitter)
    ) {
      throw new Error(
        `LedgeGetUpLeaf: hangJitterFrames must be a non-negative integer, got ` +
          String(hangJitter),
      );
    }
    if (hangJitter > hangMean) {
      throw new Error(
        `LedgeGetUpLeaf: hangJitterFrames (${hangJitter}) must be ≤ hangMeanFrames (${hangMean})`,
      );
    }
    this.hangMeanFrames = hangMean;
    this.hangJitterFrames = hangJitter;
    this.weights = resolveLedgeGetUpWeights(options.weights);
    this.opponentWeighting = options.opponentWeighting;
    this.getOpponent = getOpponent;
  }

  protected override onTick(context: RecoveryContext): NodeStatus {
    const self = context.self;
    const bb = context.blackboard;

    if (self.isInHitstun) {
      this.clearPlan(bb);
      return NodeStatus.Failure;
    }
    if (!self.isOnLedge) {
      this.clearPlan(bb);
      return NodeStatus.Failure;
    }

    let grabTick = bb.get('ledgeMixupGrabTick') ?? -1;
    let chosen = bb.get('ledgeMixupGetUpOption') ?? null;
    let emitTick = bb.get('ledgeMixupGetUpEmitTick') ?? -1;

    // First on-ledge tick — commit the plan.
    if (grabTick < 0 || chosen === null || emitTick < 0) {
      const opponent = this.getOpponent?.(context) ?? null;
      const ledgeX = context.stage.nearestLedge?.x ?? null;
      const pickedOption = chooseLedgeGetUpOption(
        context.rng,
        opponent,
        ledgeX,
        this.weights,
        this.opponentWeighting,
      );
      // Second rng draw for the jitter — keeps the choice and timing
      // mutually independent.
      const jitterRange = 2 * this.hangJitterFrames + 1;
      const jitterDraw = Math.floor(context.rng.next() * jitterRange);
      const jitter = jitterDraw - this.hangJitterFrames;
      grabTick = context.tickIndex;
      emitTick = grabTick + this.hangMeanFrames + jitter;
      chosen = pickedOption;
      bb.set('ledgeMixupGrabTick', grabTick);
      bb.set('ledgeMixupGetUpOption', chosen);
      bb.set('ledgeMixupGetUpEmitTick', emitTick);
    }

    if (context.tickIndex < emitTick) {
      // Still hanging. Emit idle so controllers can observe the wait.
      context.out.emit({ kind: 'idle', recoveryStep: 'ledgeMixup.getUp.hang' });
      return NodeStatus.Running;
    }

    // Hang elapsed — emit the chosen verb and clear the plan.
    const kind = mapGetUpOptionToActionKind(chosen);
    context.out.emit({
      kind,
      recoveryStep: `ledgeMixup.getUp.${chosen}`,
    });
    this.clearPlan(bb);
    return NodeStatus.Success;
  }

  private clearPlan(bb: RecoveryContext['blackboard']): void {
    bb.set('ledgeMixupGrabTick', -1);
    bb.set('ledgeMixupGetUpOption', null);
    bb.set('ledgeMixupGetUpEmitTick', -1);
  }

  /** Inspector for tests / debug overlays. */
  getHangMeanFrames(): number {
    return this.hangMeanFrames;
  }

  /** Inspector for tests / debug overlays. */
  getHangJitterFrames(): number {
    return this.hangJitterFrames;
  }
}

/**
 * Map a chosen get-up option to the action verb the leaf emits. The
 * controller's ledge translation layer interprets these by the
 * `recoveryStep` tag (`ledgeMixup.getUp.<option>`) — the verb itself
 * is the closest member of {@link RecoveryActionKind} so the action
 * dispatcher can route the press without bespoke handling.
 *
 * Exported so tests can assert the mapping verbatim.
 */
export function mapGetUpOptionToActionKind(
  option: LedgeMixupGetUpOption,
):
  | 'moveUp'
  | 'jump'
  | 'airDodge'
  | 'moveDown' {
  switch (option) {
    case 'normal':
      return 'moveUp';
    case 'jump':
      return 'jump';
    case 'attack':
      return 'airDodge';
    case 'roll':
      return 'moveDown';
  }
}

// ---------------------------------------------------------------------------
// LedgeRegrabLeaf — refresh i-frames once the hang is stale
// ---------------------------------------------------------------------------

/** Construction options for {@link LedgeRegrabLeaf}. */
export interface LedgeRegrabOptions {
  /**
   * Frame threshold past `ledgeMixupGrabTick` at which the bot's
   * ledge i-frames are considered stale enough to warrant a regrab
   * cycle. Default `45` — empirically just under the engine's ledge
   * intangibility window. Must be a non-negative integer.
   */
  readonly staleFrames?: number;
  /**
   * If `true` (default), the regrab also requires that an opponent
   * is *still pressuring* the ledge (within `pressureRangePx` of the
   * ledge corner). With no opponent in scope (or the opponent has
   * left), staying on the ledge is fine and the regrab doesn't fire.
   */
  readonly requireOpponentPressure?: boolean;
  /**
   * Horizontal range (px) within which the opponent counts as
   * pressuring the ledge. Default `200`.
   */
  readonly pressureRangePx?: number;
}

const DEFAULT_REGRAB_STALE_FRAMES = 45;
const DEFAULT_REGRAB_PRESSURE_RANGE_PX = 200;

/**
 * Leaf that fires a single `moveDown` press to drop the bot off the
 * ledge once the i-frames are stale and an opponent is still nearby.
 * The drop transitions the bot back into off-stage state, where the
 * regular recovery dispatcher (Sub-AC 1) takes over to rise back to
 * the ledge for a fresh mix-up.
 */
export class LedgeRegrabLeaf extends LeafNode<RecoveryContext> {
  private readonly staleFrames: number;
  private readonly requireOpponentPressure: boolean;
  private readonly pressureRangePx: number;
  private readonly getOpponent: LedgeMixupOpponentGetter | undefined;

  constructor(
    options: LedgeRegrabOptions = {},
    getOpponent?: LedgeMixupOpponentGetter,
    name?: string,
  ) {
    super(name);
    const stale = options.staleFrames ?? DEFAULT_REGRAB_STALE_FRAMES;
    if (!Number.isFinite(stale) || stale < 0 || !Number.isInteger(stale)) {
      throw new Error(
        `LedgeRegrabLeaf: staleFrames must be a non-negative integer, got ` +
          String(stale),
      );
    }
    const pressureRange =
      options.pressureRangePx ?? DEFAULT_REGRAB_PRESSURE_RANGE_PX;
    if (!Number.isFinite(pressureRange) || pressureRange < 0) {
      throw new Error(
        `LedgeRegrabLeaf: pressureRangePx must be ≥ 0, got ` +
          String(pressureRange),
      );
    }
    this.staleFrames = stale;
    this.requireOpponentPressure = options.requireOpponentPressure ?? true;
    this.pressureRangePx = pressureRange;
    this.getOpponent = getOpponent;
  }

  protected override onTick(context: RecoveryContext): NodeStatus {
    const self = context.self;
    const stage = context.stage;
    const bb = context.blackboard;

    if (self.isInHitstun) return NodeStatus.Failure;
    if (!self.isOnLedge) return NodeStatus.Failure;
    if (stage.nearestLedge === null) return NodeStatus.Failure;

    const grabTick = bb.get('ledgeMixupGrabTick') ?? -1;
    if (grabTick < 0) return NodeStatus.Failure; // not yet observed on ledge

    if (context.tickIndex - grabTick < this.staleFrames) {
      return NodeStatus.Failure;
    }

    if (this.requireOpponentPressure) {
      const opponent = this.getOpponent?.(context) ?? null;
      if (opponent === null) return NodeStatus.Failure;
      const opXGap = Math.abs(opponent.positionX - stage.nearestLedge.x);
      if (opXGap > this.pressureRangePx) return NodeStatus.Failure;
    }

    // Drop and clear the plan — the bot will fall off, the outer
    // recovery dispatcher will rise it back, and a fresh mix-up
    // cycle will reseed the get-up choice on the next grab.
    context.out.emit({ kind: 'moveDown', recoveryStep: 'ledgeMixup.regrab.drop' });
    bb.set('ledgeMixupGrabTick', -1);
    bb.set('ledgeMixupGetUpOption', null);
    bb.set('ledgeMixupGetUpEmitTick', -1);
    return NodeStatus.Success;
  }

  /** Inspector for tests / debug overlays. */
  getStaleFrames(): number {
    return this.staleFrames;
  }
}

// ---------------------------------------------------------------------------
// Subtree builder
// ---------------------------------------------------------------------------

/** Construction options for {@link buildLedgeMixupSubtree}. */
export interface LedgeMixupOptions {
  /** Pre-grab stall tunables. */
  readonly preGrabStall?: LedgePreGrabStallOptions;
  /** Ledge-trump tunables. */
  readonly trump?: LedgeTrumpOptions;
  /** Get-up randomisation tunables. */
  readonly getUp?: LedgeGetUpOptions;
  /** Regrab tunables. */
  readonly regrab?: LedgeRegrabOptions;
  /**
   * Opponent-snapshot getter — see {@link LedgeMixupOpponentGetter}.
   * When omitted, the trump and stall branches are no-ops (those
   * decisions are opponent-aware) and the get-up randomisation
   * falls back to its base weights.
   */
  readonly getOpponent?: LedgeMixupOpponentGetter;
}

/** Resolved options with defaults filled in. */
export interface ResolvedLedgeMixupOptions {
  readonly hangMeanFrames: number;
  readonly hangJitterFrames: number;
  readonly weights: ResolvedLedgeGetUpWeights;
  readonly staleFrames: number;
}

/**
 * Apply defaults to user-supplied LedgeMixup options. Mirrors the
 * shape used by Sub-AC 1 / Sub-AC 2 so controller introspection /
 * debug-overlay code can reason uniformly about active tunables.
 */
export function resolveLedgeMixupOptions(
  options: LedgeMixupOptions = {},
): ResolvedLedgeMixupOptions {
  const hangMeanFrames =
    options.getUp?.hangMeanFrames ?? DEFAULT_HANG_MEAN_FRAMES;
  const hangJitterFrames =
    options.getUp?.hangJitterFrames ?? DEFAULT_HANG_JITTER_FRAMES;
  const weights = resolveLedgeGetUpWeights(options.getUp?.weights);
  const staleFrames =
    options.regrab?.staleFrames ?? DEFAULT_REGRAB_STALE_FRAMES;
  return {
    hangMeanFrames,
    hangJitterFrames,
    weights,
    staleFrames,
  };
}

/**
 * Build the LedgeMixup subtree.
 *
 * Tree shape:
 *
 *   ConditionalNode("ledgeMixup", isMixupActive)
 *     └── Selector("ledgeMixup.dispatch")
 *           ├── ConditionalNode (bot off-stage near ledge AND opponent on ledge)
 *           │     └── LedgeTrumpLeaf
 *           ├── ConditionalNode (bot off-stage near ledge AND opponent covering)
 *           │     └── LedgePreGrabStallLeaf
 *           ├── ConditionalNode (bot on ledge AND stale)
 *           │     └── LedgeRegrabLeaf
 *           └── ConditionalNode (bot on ledge)
 *                 └── LedgeGetUpLeaf
 *
 * Behaviour:
 *
 *   - Returns `Failure` when the bot is on stage / grounded / in
 *     hitstun, OR when no mixup branch matches.
 *   - Returns `Running` while the get-up hang or pre-grab stall is
 *     active.
 *   - Returns `Success` when a mix-up press fires (trump arrival,
 *     get-up emit, or regrab drop).
 *
 * Determinism: every leaf and conditional is deterministic on its
 * inputs; the rng draws are stamped onto the Blackboard so a replay
 * scrub recovers the exact mix-up plan.
 */
export function buildLedgeMixupSubtree(
  options: LedgeMixupOptions = {},
): IBehaviorNode<RecoveryContext> {
  const getOpponent = options.getOpponent;

  const trumpBranch = new ConditionalNode<RecoveryContext>(
    new LedgeTrumpLeaf(
      options.trump ?? {},
      getOpponent,
      'ledgeMixup.trump.leaf',
    ),
    {
      predicate: (ctx) => {
        const s = ctx.self;
        if (s.isInHitstun) return false;
        if (s.isOnLedge) return false;
        if (!s.isAirborne) return false;
        if (ctx.stage.nearestLedge === null) return false;
        const opponent = getOpponent?.(ctx) ?? null;
        return opponent !== null && opponent.isOnLedge;
      },
    },
    'ledgeMixup.trump',
  );

  const stallBranch = new ConditionalNode<RecoveryContext>(
    new LedgePreGrabStallLeaf(
      options.preGrabStall ?? {},
      getOpponent,
      'ledgeMixup.preGrabStall.leaf',
    ),
    {
      predicate: (ctx) => {
        const s = ctx.self;
        if (s.isInHitstun) return false;
        if (s.isOnLedge) return false;
        if (!s.isAirborne) return false;
        return ctx.stage.nearestLedge !== null;
      },
    },
    'ledgeMixup.preGrabStall',
  );

  const regrabBranch = new ConditionalNode<RecoveryContext>(
    new LedgeRegrabLeaf(
      options.regrab ?? {},
      getOpponent,
      'ledgeMixup.regrab.leaf',
    ),
    {
      predicate: (ctx) => {
        const s = ctx.self;
        if (s.isInHitstun) return false;
        return s.isOnLedge;
      },
    },
    'ledgeMixup.regrab',
  );

  const getUpBranch = new ConditionalNode<RecoveryContext>(
    new LedgeGetUpLeaf(
      options.getUp ?? {},
      getOpponent,
      'ledgeMixup.getUp.leaf',
    ),
    {
      predicate: (ctx) => {
        const s = ctx.self;
        if (s.isInHitstun) return false;
        if (s.isOnLedge) return true;
        // Permit the leaf to tick when the bot has *left* the ledge
        // but a stale grab plan is still on the Blackboard — the
        // leaf's own onTick clears the plan in that case so the next
        // grab cycle re-rolls cleanly.
        return (ctx.blackboard.get('ledgeMixupGrabTick') ?? -1) >= 0;
      },
    },
    'ledgeMixup.getUp',
  );

  const dispatch = new SelectorNode<RecoveryContext>(
    [trumpBranch, stallBranch, regrabBranch, getUpBranch],
    'ledgeMixup.dispatch',
  );

  // Outer gate — the LedgeMixup subtree should be ticked only when the
  // bot is either on a ledge OR a viable mix-up candidate (off-stage,
  // airborne, near a ledge). Other states fall through to Failure so
  // sibling subtrees still get their tick.
  //
  // We additionally permit the gate to open when a *stale* grab plan
  // is still on the Blackboard — that lets the get-up branch tick to
  // clear the plan when the bot has dropped off the ledge between
  // ticks (e.g. a regrab cycle, or a knock-off). Without this, the
  // plan would linger across airborne periods and the next grab would
  // see "already-planned" stamps from the prior hang.
  return new ConditionalNode<RecoveryContext>(
    dispatch,
    {
      predicate: (ctx) => {
        const s = ctx.self;
        if (s.isInHitstun) return false;
        if (s.isOnLedge) return true;
        const hasStalePlan =
          (ctx.blackboard.get('ledgeMixupGrabTick') ?? -1) >= 0;
        if (hasStalePlan) return true;
        if (!s.isAirborne) return false;
        return ctx.stage.nearestLedge !== null;
      },
    },
    'ledgeMixup',
  );
}
