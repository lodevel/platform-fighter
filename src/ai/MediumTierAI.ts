/**
 * MediumTierAI — full Medium difficulty tier composition (AC 20204 Sub-AC 4).
 *
 * Why this module exists
 * ----------------------
 *
 * The Medium tier sits between Easy ("noticeably weaker, frequently
 * idles, jab-only, no recovery") and Hard ("competent human, full combo +
 * KO smash recognition + edge-guarding + predictive movement"). The AC
 * calls out four properties for Medium:
 *
 *   1. **Moderate reaction times** — uses the 22-28 frame Medium preset
 *      via {@link import('./perception/reactionWindowPresets').REACTION_WINDOW_PRESETS},
 *      sampled-sticky on construction (so the bot's reaction has match-
 *      to-match variance but stays stable inside any one match).
 *   2. **Combo awareness** — recognises `jab → tilt`, `jab → smash`,
 *      `tilt → smash` chains via the same {@link RecognizeFollowUpLeaf}
 *      / {@link ExecuteFollowUpLeaf} pair the Hard tier uses. Combo
 *      recognition is "competent" behaviour that Medium needs.
 *   3. **Situational defense** — probabilistic shield (~70 %) + dodge
 *      (~20 %) branches at the head of the Medium offensive tree react
 *      to incoming threats with i-frames or block. Reads as "blocks
 *      reliably and occasionally evades, but not perfectly".
 *   4. **Balanced offensive/defensive behavior** — the Medium offensive
 *      tree picks the contextually correct verb at every distance band:
 *      jab in melee reach, ranged special at mid-range, walk-in at
 *      long range. No edge-guarding, no KO smash fishing — those are
 *      Hard-only competencies.
 *
 * The Medium tier ships its own recovery sub-tree (the same {@link
 * buildHardRecoveryTree} the Hard tier uses) because *recovering from
 * off-stage is binary* — a bot either makes it back or it dies. The
 * believable Medium-vs-Hard weakness comes from the slower reaction
 * window and the absence of edge-guarding / KO fishing, not from a
 * worse recovery. A Medium bot that died every time it left the stage
 * would feel broken, not "intermediate".
 *
 * What was missing was a single class that *composes* those primitives
 * into a drop-in {@link PlayerInputProvider} the match scene can plug
 * into a player slot. This module fills that gap, mirroring the
 * `HardTierAI` and `EasyTierAI` design so the match scene can switch
 * between difficulty tiers with a one-line constructor swap.
 *
 * Determinism contract
 * --------------------
 *
 *   • No `Math.random()`. Every stochastic decision flows through the
 *     constructor-supplied {@link Rng}.
 *   • The reaction-system delay specification is bit-stable across
 *     ticks (sticky on `sampled` mode, fixed on `fixed` mode) so the
 *     replay system can rebuild the perception offset deterministically.
 *   • {@link MediumTierAI.snapshot} / {@link MediumTierAI.restoreSnapshot}
 *     round-trip the entire controller (reaction system, both behavior-
 *     tree blackboards, sticky target slot, RNG state) so the 300-frame
 *     replay pipeline can rehydrate Medium-tier state without bespoke
 *     adapters.
 *   • The offensive + recovery trees are constructed once per provider
 *     (in the constructor) and reused — the factory functions are pure
 *     and the trees themselves carry no per-tick state outside the
 *     blackboard.
 *
 * What this class deliberately is NOT
 * -----------------------------------
 *
 *   • A scene observer. The match scene assembles the world snapshot
 *     once per fixed step from live `Character` / stage state and pushes
 *     it in. The provider never reads Phaser / Matter.
 *
 *   • A character-specific tuner. Per-character reach numbers flow
 *     through the options bag; the tree shape itself is identical
 *     across the four characters in the M2 roster.
 *
 *   • A KO-fishing controller. The Hard tier's "I see they're at KO
 *     percent, let me dash in for a smash" Selector slot is intentionally
 *     absent. Medium will still smash *as a combo follow-up* (jab→smash
 *     at KO%), because that's the recognised chain shape, but it won't
 *     dash across the screen at 90 % to fish for a smash. This is the
 *     single biggest behavioural delta between Medium and Hard.
 *
 * @example Basic wiring inside the match scene
 * ```ts
 * const bot = new MediumTierAI({
 *   slotIndex: 2,
 *   rng: new Rng(seed ^ 0x4ABC),
 * });
 * scene.providers[2] = bot;
 *
 * function onFixedStep(frame: number, world: WorldSnapshot): void {
 *   bot.pushPerception(frame, world);
 *   const input = bot.sample(frame);
 *   match.applyInput(2, input);
 * }
 *
 * // From the existing collision callback when slot 2 lands a hit:
 * bot.registerLandedHit({ landed: 'jab', landedTick: frame, opponentPercent: 27 });
 * ```
 */

import {
  AIInputProvider,
  type AIInputCommand,
  type AIInputProviderOptions,
} from './AIInputProvider';
import {
  HardTierReactionSystem,
  type HardTierInputDelaySpec,
  type HardTierReactionSnapshot,
} from './hardTierReaction';
import {
  type WorldSnapshot,
  projectOpponentSnapshot,
} from './perception/WorldSnapshot';
import { selectTarget } from './perception/targetSelection';
import { REACTION_WINDOW_PRESETS } from './perception/reactionWindowPresets';
import {
  buildMediumOffensiveTree,
  type MediumOffensiveTreeOptions,
} from './offensive/MediumOffensiveTree';
import {
  buildHardRecoveryTree,
  type HardRecoveryTreeOptions,
} from './recovery/HardRecoveryTree';
import {
  registerLandedHit as registerLandedHitOnBlackboard,
  clearOffensiveCombo,
  type RegisterLandedHitInput,
} from './offensive/registerLandedHit';
import { clearRecoveryState } from './recovery/RecoveryMoveLeaf';
import {
  DEFAULT_OFFENSIVE_BLACKBOARD,
  type OffensiveAction,
  type OffensiveBlackboardSchema,
  type OffensiveContext,
} from './offensive/types';
import {
  DEFAULT_RECOVERY_BLACKBOARD,
  type RecoveryAction,
  type RecoveryBlackboardSchema,
  type RecoveryContext,
  type RecoveryLedge,
} from './recovery/types';
import { translateOffensiveEmit, translateRecoveryEmit } from './HardTierAI';
import { BehaviorTree } from './behaviorTree/BehaviorTree';
import { type IBlackboard } from './behaviorTree/Blackboard';
import { NodeStatus } from './behaviorTree/Node';
import {
  type PlayerSlotIndex,
} from '../input/InputProvider';
import { type Rng } from '../utils/Rng';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Default Medium-tier reaction-window specification. Sampled across the
 * 22-28 frame band on construction, sticky for the rest of the match —
 * so the bot's reaction time has match-to-match variance but stays
 * stable inside any one game (preserves perceptual continuity for the
 * human opponent).
 *
 * Note this differs from the Hard tier's default (`fixed: 17`) on
 * purpose: the Medium preset's 6-frame range is narrow enough that a
 * sampled value still feels "intermediate" while keeping the bot from
 * feeling identical across sessions. A fixed 25-frame delay would feel
 * mechanical in repeated matches.
 */
export const DEFAULT_MEDIUM_INPUT_DELAY: HardTierInputDelaySpec = {
  mode: 'sampled',
  minFrames: REACTION_WINDOW_PRESETS.medium.minDelayFrames,
  maxFrames: REACTION_WINDOW_PRESETS.medium.maxDelayFrames,
};

/**
 * Construction options for {@link MediumTierAI}. Every option but
 * `slotIndex` and `rng` is optional and defaults to the canonical
 * Medium-tier tunables documented in the relevant sub-AC modules.
 */
export interface MediumTierAIOptions extends AIInputProviderOptions {
  /**
   * Reaction-system input delay specification. Defaults to
   * {@link DEFAULT_MEDIUM_INPUT_DELAY} (sampled 22-28 frames — the
   * Medium reaction-window preset).
   *
   * Pass `{ mode: 'fixed', frames: 25 }` for a flat moderate delay or
   * any lower value to weaken the slow-reaction property for testing.
   */
  readonly inputDelay?: HardTierInputDelaySpec;

  /**
   * Tunables forwarded into the offensive sub-tree — neutral jab /
   * combo follow-up reaches, shield / dodge probabilities, ranged
   * attack band. Default values match {@link buildMediumOffensiveTree}.
   */
  readonly offensive?: MediumOffensiveTreeOptions;

  /**
   * Tunables forwarded into the recovery sub-tree — jump / double-jump
   * cooldowns, blast-zone lookahead, ledge-return tolerances. Default
   * values match {@link buildHardRecoveryTree}.
   *
   * Medium tier reuses the Hard recovery tree because successful
   * recovery is binary (you make it back or you die). The tier
   * believability gap between Medium and Hard comes from the reaction
   * window + absence of edge-guarding, NOT from a degraded recovery.
   */
  readonly recovery?: HardRecoveryTreeOptions;
}

/**
 * Snapshot shape for {@link MediumTierAI.snapshot} /
 * {@link MediumTierAI.restoreSnapshot}. Captures every piece of mutable
 * state the controller owns so the 300-frame replay pipeline can
 * rehydrate the bot mid-match.
 *
 * RNG state is captured at the controller level so a single shared
 * Rng instance round-trips exactly through the reaction system (input-
 * delay rolls), the offensive tree (shield / dodge probabilistic
 * gates, combo tie-breaks), and the recovery tree.
 */
export interface MediumTierAISnapshot {
  /** Reaction system state (delay buffer + spec). */
  readonly reaction: HardTierReactionSnapshot<WorldSnapshot, unknown>;
  /** Offensive blackboard contents at snapshot time. */
  readonly offensiveBlackboard: OffensiveBlackboardSchema;
  /** Recovery blackboard contents at snapshot time. */
  readonly recoveryBlackboard: RecoveryBlackboardSchema;
  /** Sticky target opponent slot, or `null` when no target is locked yet. */
  readonly lastTargetSlot: PlayerSlotIndex | null;
  /** Bot RNG state — captured so probabilistic gates reproduce verbatim. */
  readonly rngState: number;
  /** Tick counter on the offensive tree at snapshot time. */
  readonly offensiveTickCount: number;
  /** Tick counter on the recovery tree at snapshot time. */
  readonly recoveryTickCount: number;
}

// ---------------------------------------------------------------------------
// MediumTierAI — the composed controller class
// ---------------------------------------------------------------------------

/**
 * Medium difficulty tier — a "competent intermediate"-feeling AI bot
 * that combos, recovers reliably, situationally defends with shields
 * and dodges, and picks contextually appropriate moves at every
 * distance band — but doesn't edge-guard or fish for KO smashes.
 * Composes the Medium offensive sub-tree + the Hard recovery sub-tree
 * + the 22-28 frame reaction window into one drop-in
 * {@link AIInputProvider}.
 */
export class MediumTierAI extends AIInputProvider {
  private readonly reaction: HardTierReactionSystem<WorldSnapshot, unknown>;
  private readonly offensiveTree: BehaviorTree<
    OffensiveContext,
    OffensiveBlackboardSchema
  >;
  private readonly recoveryTree: BehaviorTree<
    RecoveryContext,
    RecoveryBlackboardSchema
  >;

  /**
   * Sticky target slot — the opponent the bot focused on last tick.
   * The threat-weighted target selection biases toward this slot so
   * the bot doesn't switch targets every frame in a 4-way melee.
   */
  private lastTargetSlot: PlayerSlotIndex | null = null;

  /**
   * Tracks whether the bot was on-stage on the previous tick. When the
   * bot transitions from airborne / off-stage back to grounded, the
   * controller fires {@link clearRecoveryState} so the recovery
   * blackboard's air-jump / up-special latches reset.
   */
  private wasGroundedLastTick: boolean = true;

  constructor(options: MediumTierAIOptions) {
    super(options);

    this.reaction = new HardTierReactionSystem<WorldSnapshot, unknown>({
      inputDelay: options.inputDelay ?? DEFAULT_MEDIUM_INPUT_DELAY,
      rng: options.rng,
    });

    this.offensiveTree = new BehaviorTree<
      OffensiveContext,
      OffensiveBlackboardSchema
    >(buildMediumOffensiveTree(options.offensive ?? {}), {
      name: `medium.offensive.slot${options.slotIndex}`,
      initialBlackboard: { ...DEFAULT_OFFENSIVE_BLACKBOARD },
      resetBlackboard: true,
    });

    this.recoveryTree = new BehaviorTree<
      RecoveryContext,
      RecoveryBlackboardSchema
    >(buildHardRecoveryTree(options.recovery ?? {}), {
      name: `medium.recovery.slot${options.slotIndex}`,
      initialBlackboard: { ...DEFAULT_RECOVERY_BLACKBOARD },
      resetBlackboard: true,
    });
  }

  // -------------------------------------------------------------------------
  // External API — perception input + hit-detection hook
  // -------------------------------------------------------------------------

  /**
   * Push a fresh ground-truth perception into the reaction system's
   * delay buffer. Called by the match scene once per fixed step with
   * the authoritative current world state, BEFORE {@link sample} runs.
   *
   * The reaction system retains the snapshot until the configured
   * 22-28-frame delay window has elapsed, at which point the bot's
   * `decide()` will read it through {@link MediumTierAI.perceive}.
   */
  pushPerception(frame: number, world: WorldSnapshot): void {
    this.reaction.pushPerception(frame, world);
  }

  /**
   * Record that the bot just landed a hit. Forwards into the offensive
   * blackboard so the next tick's combo recognition can stage a
   * follow-up. Mirrors the Hard tier's hook so the controller can call
   * this directly from its existing collision callback regardless of
   * the bot's tier.
   */
  registerLandedHit(input: RegisterLandedHitInput): void {
    registerLandedHitOnBlackboard(this.offensiveTree.getBlackboard(), input);
  }

  /** Direct accessor for the reaction system — useful for diagnostics / replay tooling. */
  getReactionSystem(): HardTierReactionSystem<WorldSnapshot, unknown> {
    return this.reaction;
  }

  /** Read-only accessor for the offensive blackboard — useful for tests / diagnostics. */
  getOffensiveBlackboard(): IBlackboard<OffensiveBlackboardSchema> {
    return this.offensiveTree.getBlackboard();
  }

  /** Read-only accessor for the recovery blackboard — useful for tests / diagnostics. */
  getRecoveryBlackboard(): IBlackboard<RecoveryBlackboardSchema> {
    return this.recoveryTree.getBlackboard();
  }

  /** The sticky target slot the bot focused on at the last decision. `null` before the first decision. */
  getLastTargetSlot(): PlayerSlotIndex | null {
    return this.lastTargetSlot;
  }

  // -------------------------------------------------------------------------
  // Snapshot / restore — round-trip every piece of mutable state
  // -------------------------------------------------------------------------

  /**
   * Capture the controller's full mutable state for the replay
   * snapshot pipeline. Returns a deeply-immutable record covering the
   * reaction system, both behavior-tree blackboards, the sticky target
   * slot, and the RNG state.
   */
  snapshot(): MediumTierAISnapshot {
    return {
      reaction: this.reaction.snapshot(),
      offensiveBlackboard: blackboardToSchema<OffensiveBlackboardSchema>(
        this.offensiveTree.getBlackboard(),
        DEFAULT_OFFENSIVE_BLACKBOARD,
      ),
      recoveryBlackboard: blackboardToSchema<RecoveryBlackboardSchema>(
        this.recoveryTree.getBlackboard(),
        DEFAULT_RECOVERY_BLACKBOARD,
      ),
      lastTargetSlot: this.lastTargetSlot,
      rngState: this.rng.getState(),
      offensiveTickCount: this.offensiveTree.getTickCount(),
      recoveryTickCount: this.recoveryTree.getTickCount(),
    };
  }

  /**
   * Replace the controller state from a snapshot.
   *
   * Validates the schema fields exist (nominal type-check) and re-
   * seeds the underlying systems. The reaction system has its own
   * validation pass (see {@link
   * HardTierReactionSystem.restoreSnapshot}) so corruption fails
   * loudly during development.
   */
  restoreSnapshot(snap: MediumTierAISnapshot): void {
    this.reaction.restoreSnapshot(snap.reaction);
    schemaToBlackboard<OffensiveBlackboardSchema>(
      this.offensiveTree.getBlackboard(),
      DEFAULT_OFFENSIVE_BLACKBOARD,
      snap.offensiveBlackboard,
      'offensive',
    );
    schemaToBlackboard<RecoveryBlackboardSchema>(
      this.recoveryTree.getBlackboard(),
      DEFAULT_RECOVERY_BLACKBOARD,
      snap.recoveryBlackboard,
      'recovery',
    );
    this.lastTargetSlot = snap.lastTargetSlot;
    this.rng.setState(snap.rngState);
  }

  // -------------------------------------------------------------------------
  // AIInputProvider hook overrides — perception + decision pipeline
  // -------------------------------------------------------------------------

  /**
   * Return the *delayed* perception the bot should react to this tick.
   * The match scene's `pushPerception()` keeps the reaction system's
   * buffer warm; this hook simply pulls the snapshot at
   * `frame - inputDelayFrames`.
   *
   * Returns `null` during the warm-up window (the first 22-28 frames
   * of a match before any delayed perception is available); the
   * `decide()` override below short-circuits to a neutral input on
   * `null`.
   */
  protected override perceive(frame: number): WorldSnapshot | null {
    return this.reaction.perceive(frame);
  }

  /**
   * Pure decision step — pure on (snapshot, blackboards, RNG). Tick
   * the recovery tree first; if it commits (Success / Running), use
   * its emits. Otherwise tick the offensive tree and translate its
   * emits.
   */
  protected override decide(
    frame: number,
    snapshot: WorldSnapshot | null | undefined,
  ): readonly AIInputCommand[] {
    if (!snapshot) {
      // Warm-up — no perception yet. Hold neutral.
      return [];
    }

    // Detect on-ground transition so the recovery blackboard latches
    // (lastAirJumpTick / lastUpSpecialTick) reset cleanly when the bot
    // touches down or grabs a ledge.
    this.maybeClearRecoveryLatches(snapshot);

    // ---- Recovery sub-tree first ------------------------------------------
    // The recovery branches all return Failure when the bot is on
    // stage / grounded, so off-stage situations here win priority.
    const recoveryEmits: RecoveryAction[] = [];
    const recoveryStatus = this.tickRecoveryTree(frame, snapshot, recoveryEmits);

    if (
      recoveryStatus !== NodeStatus.Failure &&
      recoveryEmits.length > 0
    ) {
      // Recovery committed — use its emits and skip offensive logic
      // this tick. The bot's airborne so offensive branches would
      // largely no-op anyway, but explicitly skipping keeps replays
      // cheaper and the emit set tidy.
      return recoveryEmits.map(translateRecoveryEmit);
    }

    // ---- Offensive sub-tree (Medium) -------------------------------------
    const offensiveEmits: OffensiveAction[] = [];
    this.tickOffensiveTree(frame, snapshot, offensiveEmits);
    return offensiveEmits.map(translateOffensiveEmit);
  }

  /**
   * Subclass reset cascade — wipe both behavior-tree blackboards, clear
   * the reaction-system buffer, and forget the sticky target so the
   * next tick selects fresh.
   */
  protected override onReset(): void {
    this.offensiveTree.reset();
    this.recoveryTree.reset();
    this.reaction.clear();
    this.lastTargetSlot = null;
    this.wasGroundedLastTick = true;
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /**
   * Detect the airborne→grounded transition and reset the recovery
   * partition so the air-jump / up-special latches don't bleed across
   * airborne periods. Mirrors the controller-side `onLand` /
   * `onLedgeGrab` hook the recovery module documents.
   */
  private maybeClearRecoveryLatches(snapshot: WorldSnapshot): void {
    const groundedNow =
      !snapshot.self.isAirborne || snapshot.self.isOnLedge;
    if (groundedNow && !this.wasGroundedLastTick) {
      clearRecoveryState(this.recoveryTree.getBlackboard());
    }
    this.wasGroundedLastTick = groundedNow;
  }

  /**
   * Build the recovery context from the delayed snapshot and tick the
   * recovery tree. Emits land in the supplied array. Returns the
   * tree's status so the caller can decide whether to fall through to
   * the offensive tree.
   */
  private tickRecoveryTree(
    _frame: number,
    snapshot: WorldSnapshot,
    emits: RecoveryAction[],
  ): NodeStatus {
    const stage = snapshot.stage;
    const ctx: RecoveryContext = {
      blackboard: this.recoveryTree.getBlackboard(),
      tickIndex: this.recoveryTree.getTickCount(),
      self: {
        positionX: snapshot.self.position.x,
        positionY: snapshot.self.position.y,
        velocityX: snapshot.self.velocity.vx,
        velocityY: snapshot.self.velocity.vy,
        facing: snapshot.self.facing,
        isAirborne: snapshot.self.isAirborne,
        // The reaction system's snapshot doesn't carry per-character
        // jump-budget directly, so we synthesise sensible defaults: a
        // healthy off-stage bot has its full air-jump budget unless
        // the recovery blackboard's lastAirJumpTick latch indicates
        // otherwise. This mirrors how the Hard tier derives the field.
        jumpsRemaining: this.deriveJumpsRemaining(),
        upSpecialAvailable: this.deriveUpSpecialAvailable(),
        isInHitstun: snapshot.self.isInHitstun,
        isOnLedge: snapshot.self.isOnLedge,
      },
      stage: {
        stageLeft: stage.stageLeft,
        stageRight: stage.stageRight,
        stageTop: stage.stageTop,
        blastZone: stage.blastZone,
        nearestLedge: deriveNearestLedge(
          snapshot.self.position.x,
          stage.stageLeft,
          stage.stageRight,
          stage.stageTop,
        ),
      },
      out: { emit: (action) => emits.push(action) },
      rng: this.rng,
    };
    return this.recoveryTree.tick(ctx);
  }

  /**
   * Build the offensive context (with target selection, position,
   * stage geometry) from the delayed snapshot and tick the offensive
   * tree. Emits land in the supplied array.
   */
  private tickOffensiveTree(
    _frame: number,
    snapshot: WorldSnapshot,
    emits: OffensiveAction[],
  ): NodeStatus {
    // Sticky threat-weighted target selection — keeps the bot focused
    // on the same opponent in a 4-way melee unless another opponent
    // becomes meaningfully more threatening / appealing.
    const selection = selectTarget(snapshot, {
      policy: 'threatWeighted',
      sticky: { previousSlotIndex: this.lastTargetSlot },
    });
    this.lastTargetSlot = selection.slotIndex;

    const opponent = selection.opponent
      ? projectOpponentSnapshot(snapshot.self.position, selection.opponent)
      : null;

    const ctx: OffensiveContext = {
      blackboard: this.offensiveTree.getBlackboard(),
      tickIndex: this.offensiveTree.getTickCount(),
      opponent,
      self: {
        facing: snapshot.self.facing,
        canAttack: deriveCanAttack(snapshot.self.currentMove ?? null),
        isAirborne: snapshot.self.isAirborne,
        damagePercent: snapshot.self.damagePercent,
      },
      out: { emit: (action) => emits.push(action) },
      rng: this.rng,
      selfPosition: { x: snapshot.self.position.x, y: snapshot.self.position.y },
      stage: snapshot.stage,
    };
    return this.offensiveTree.tick(ctx);
  }

  /**
   * Estimate the bot's remaining air-jump budget from the recovery
   * blackboard's lastAirJumpTick latch. Mirrors the Hard tier helper.
   */
  private deriveJumpsRemaining(): number {
    const lastTick = this.recoveryTree
      .getBlackboard()
      .get('recoveryLastAirJumpTick') ?? -1;
    return lastTick >= 0 ? 0 : 1;
  }

  /**
   * Estimate the bot's up-special availability — same logic as the
   * jump derivation but conditioned on `recoveryLastUpSpecialTick`.
   */
  private deriveUpSpecialAvailable(): boolean {
    const lastTick = this.recoveryTree
      .getBlackboard()
      .get('recoveryLastUpSpecialTick') ?? -1;
    return lastTick < 0;
  }
}

// ---------------------------------------------------------------------------
// Misc helpers
// ---------------------------------------------------------------------------

/**
 * Derive `canAttack` from the bot's perceived current move state. The
 * offensive sub-tree gates every attack press on this flag — true when
 * the bot is in neutral (no move in flight or only in recovery
 * cancellable by attack), false during startup / active / recovery
 * frames.
 *
 * Conservative policy: attack pressable iff no current move is reported,
 * or the current move is in `'recovery'` and has 0 frames remaining
 * (i.e. the move ends this tick). Matches the engine's
 * `Character.attemptAttack` gate behaviour and the Hard tier's helper.
 */
function deriveCanAttack(
  currentMove: WorldSnapshot['self']['currentMove'] | null,
): boolean {
  if (!currentMove) return true;
  if (currentMove.phase === 'recovery' && currentMove.framesRemaining <= 0) {
    return true;
  }
  return false;
}

/**
 * Synthesise a "nearest ledge" for the recovery sub-tree from coarse
 * stage extents. Picks whichever side of the stage the bot is closest
 * to — left ledge is at `(stageLeft, stageTop)`, right at
 * `(stageRight, stageTop)`. Mirrors the Hard tier helper.
 */
function deriveNearestLedge(
  selfX: number,
  stageLeft: number,
  stageRight: number,
  stageTop: number,
): RecoveryLedge | null {
  if (!Number.isFinite(stageLeft) || !Number.isFinite(stageRight)) {
    return null;
  }
  if (!Number.isFinite(stageTop)) return null;
  if (stageLeft >= stageRight) return null;
  const distLeft = Math.abs(selfX - stageLeft);
  const distRight = Math.abs(selfX - stageRight);
  if (distLeft <= distRight) {
    return { x: stageLeft, y: stageTop, side: 'left' };
  }
  return { x: stageRight, y: stageTop, side: 'right' };
}

/**
 * Snapshot helper — read every key from a blackboard into a plain
 * record. Uses the supplied default schema to know which keys exist.
 */
function blackboardToSchema<TSchema extends object>(
  blackboard: IBlackboard<TSchema>,
  defaults: Readonly<TSchema>,
): TSchema {
  const out: Partial<TSchema> = {};
  for (const key of Object.keys(defaults) as Array<keyof TSchema & string>) {
    const value = blackboard.get(key);
    if (value === undefined) {
      out[key] = defaults[key];
    } else {
      out[key] = value;
    }
  }
  return out as TSchema;
}

/**
 * Snapshot helper — write every field from a schema record into a
 * blackboard. Clears any stale entries first via the appropriate
 * partition-clear helper for the partition kind.
 */
function schemaToBlackboard<TSchema extends object>(
  blackboard: IBlackboard<TSchema>,
  defaults: Readonly<TSchema>,
  values: Readonly<TSchema>,
  partition: 'offensive' | 'recovery',
): void {
  if (partition === 'offensive') {
    clearOffensiveCombo(
      blackboard as unknown as IBlackboard<OffensiveBlackboardSchema>,
    );
  } else {
    clearRecoveryState(
      blackboard as unknown as IBlackboard<RecoveryBlackboardSchema>,
    );
  }
  for (const key of Object.keys(defaults) as Array<keyof TSchema & string>) {
    blackboard.set(key, values[key]);
  }
}
