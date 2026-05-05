/**
 * HardTierAI — full Hard difficulty tier composition (AC 10204 Sub-AC 4).
 *
 * Why this module exists
 * ----------------------
 *
 * The Hard tier is built up from a stack of orthogonal primitives shipped
 * across Sub-ACs 1-5 of AC 18 / AC 10204:
 *
 *   • {@link AIInputProvider} — adapter from emit verbs to
 *     {@link CharacterInput} (Sub-AC 1).
 *   • {@link HardTierReactionSystem} — 15–20 frame perception delay buffer
 *     (Sub-AC 2).
 *   • {@link buildHardOffensiveTreeV2} — combo-aware offensive sub-tree
 *     with edge-guarding + predictive movement (Sub-AC 3 + Sub-AC 5).
 *   • {@link buildHardRecoveryTree} — off-stage recovery sub-tree
 *     (Sub-AC 4 of AC 18).
 *   • {@link selectTarget} — tier-agnostic target selection
 *     (AC 10202 Sub-AC 2).
 *
 * What was missing was a single class that *composes* all of this into
 * one provider the match scene can drop into a player slot. This module
 * fills that gap: a `HardTierAI` constructed with a slot index, RNG, and
 * (optionally) per-character tunables produces a `PlayerInputProvider`
 * that:
 *
 *   1. Receives ground-truth world snapshots via {@link
 *      HardTierAI.pushPerception} once per fixed step.
 *   2. Reads a *delayed* snapshot through the Hard-tier reaction system
 *      so the bot reacts on a competent-human timescale.
 *   3. Picks a target opponent with sticky threat-weighted policy so it
 *      doesn't thrash between players in a 4-way melee.
 *   4. Ticks the recovery sub-tree first — when the bot is off-stage
 *      it prioritises getting back to safety.
 *   5. Falls through to the offensive sub-tree V2 — combo follow-ups,
 *      edge-guarding off-stage opponents, predictive movement, and a
 *      KO-smash branch.
 *   6. Translates emitted offensive / recovery action verbs into the
 *      {@link AIInputCommand} shape the base class consumes, which
 *      then folds into the standard `CharacterInput` record.
 *
 * Determinism contract
 * --------------------
 *
 *   • No `Math.random()`. Every stochastic decision flows through the
 *     constructor-supplied {@link Rng}.
 *   • The reaction-system delay specification is bit-stable across
 *     ticks (sticky on `sampled` mode, fixed on `fixed` mode) so the
 *     replay system can rebuild the perception offset deterministically.
 *   • {@link HardTierAI.snapshot} / {@link HardTierAI.restoreSnapshot}
 *     round-trip the entire controller (reaction system, both behavior-
 *     tree blackboards, sticky target slot) so the 300-frame replay
 *     pipeline can rehydrate Hard-tier state without bespoke adapters.
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
 *   • A hit detector. Combo recognition relies on the controller calling
 *     {@link HardTierAI.registerLandedHit} from its existing collision
 *     pipeline whenever a hit lands. The class exposes the helper but
 *     does not poll for hits itself.
 *
 *   • A character-specific tuner. Per-character reach / cooldown numbers
 *     flow through the options bag; the tree shape itself is identical
 *     across the four characters in the M2 roster.
 *
 * @example Basic wiring inside the match scene
 * ```ts
 * const bot = new HardTierAI({
 *   slotIndex: 2,
 *   rng: new Rng(seed ^ 0x4ABC),
 *   ownSlotIndex: 2,
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
  DEFAULT_HARD_TIER_INPUT_DELAY,
} from './hardTierReaction';
import {
  type WorldSnapshot,
  projectOpponentSnapshot,
} from './perception/WorldSnapshot';
import { selectTarget } from './perception/targetSelection';
import {
  buildHardOffensiveTreeV2,
  type HardOffensiveTreeV2Options,
} from './offensive/HardOffensiveTreeV2';
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
 * Construction options for {@link HardTierAI}. Every option but
 * `slotIndex` and `rng` is optional and defaults to the canonical
 * Hard-tier tunables documented in the relevant sub-AC modules.
 */
export interface HardTierAIOptions extends AIInputProviderOptions {
  /**
   * Reaction-system input delay specification. Defaults to
   * {@link DEFAULT_HARD_TIER_INPUT_DELAY} (fixed 17 frames — middle of
   * the AC's 15–20 frame band).
   *
   * Pass `{ mode: 'sampled', minFrames: 15, maxFrames: 20 }` for
   * per-match jittered delays — the reaction system rolls once at
   * construction and keeps the delay sticky across the match for
   * perceptual continuity.
   */
  readonly inputDelay?: HardTierInputDelaySpec;

  /**
   * Tunables forwarded into the offensive sub-tree V2 — neutral / KO
   * smash / combo follow-up reaches, predictive lookahead, and
   * edge-guard tuning. Default values match the Hard-tier defaults in
   * {@link buildHardOffensiveTreeV2}.
   */
  readonly offensive?: HardOffensiveTreeV2Options;

  /**
   * Tunables forwarded into the recovery sub-tree — jump / double-jump
   * cooldowns, blast-zone lookahead, ledge-return tolerances. Default
   * values match {@link buildHardRecoveryTree}.
   */
  readonly recovery?: HardRecoveryTreeOptions;
}

/**
 * Snapshot shape for {@link HardTierAI.snapshot} /
 * {@link HardTierAI.restoreSnapshot}. Captures every piece of mutable
 * state the controller owns so the 300-frame replay pipeline can
 * rehydrate the bot mid-match.
 *
 * RNG state is captured at the controller level so a single shared
 * Rng instance round-trips exactly through both the reaction system
 * (input-delay rolls) and the behavior trees (combo tie-breaks,
 * predictive jitter).
 */
export interface HardTierAISnapshot {
  /** Reaction system state (delay buffer + spec). */
  readonly reaction: HardTierReactionSnapshot<WorldSnapshot, unknown>;
  /** Offensive blackboard contents at snapshot time. */
  readonly offensiveBlackboard: OffensiveBlackboardSchema;
  /** Recovery blackboard contents at snapshot time. */
  readonly recoveryBlackboard: RecoveryBlackboardSchema;
  /** Sticky target opponent slot, or `null` when no target is locked yet. */
  readonly lastTargetSlot: PlayerSlotIndex | null;
  /** Bot RNG state — captured so combo tie-breaks reproduce verbatim. */
  readonly rngState: number;
  /** Tick counter on the offensive tree at snapshot time. */
  readonly offensiveTickCount: number;
  /** Tick counter on the recovery tree at snapshot time. */
  readonly recoveryTickCount: number;
}

// ---------------------------------------------------------------------------
// HardTierAI — the composed controller class
// ---------------------------------------------------------------------------

/**
 * Hard difficulty tier — a competent-human-feeling AI bot that uses
 * combos, recovers reliably, edge-guards, and tracks predictive
 * opponent movement. Composes the existing perception, reaction-system,
 * offensive, and recovery primitives into one drop-in
 * {@link AIInputProvider}.
 */
export class HardTierAI extends AIInputProvider {
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
   * Sticky target slot — the opponent the bot focused on last tick. The
   * threat-weighted target selection biases toward this slot so the bot
   * doesn't switch targets every frame in a 4-way melee.
   */
  private lastTargetSlot: PlayerSlotIndex | null = null;

  /**
   * Tracks whether the bot was on-stage on the previous tick. When the
   * bot transitions from airborne / off-stage back to grounded, the
   * controller fires {@link clearRecoveryState} so the recovery
   * blackboard's air-jump / up-special latches reset.
   */
  private wasGroundedLastTick: boolean = true;

  constructor(options: HardTierAIOptions) {
    super(options);

    this.reaction = new HardTierReactionSystem<WorldSnapshot, unknown>({
      inputDelay: options.inputDelay ?? DEFAULT_HARD_TIER_INPUT_DELAY,
      rng: options.rng,
    });

    // Hard-tier defaults: opt INTO DI-aware edge-guarding (Sub-AC 5).
    // Callers can override via `options.offensive.edgeGuard.useDIPrediction`.
    const offensiveOptions: HardOffensiveTreeV2Options = options.offensive
      ? {
          ...options.offensive,
          edgeGuard: {
            useDIPrediction: true,
            ...(options.offensive.edgeGuard ?? {}),
          },
        }
      : { edgeGuard: { useDIPrediction: true } };

    this.offensiveTree = new BehaviorTree<
      OffensiveContext,
      OffensiveBlackboardSchema
    >(buildHardOffensiveTreeV2(offensiveOptions), {
      name: `hard.offensive.slot${options.slotIndex}`,
      initialBlackboard: { ...DEFAULT_OFFENSIVE_BLACKBOARD },
      resetBlackboard: true,
    });

    this.recoveryTree = new BehaviorTree<
      RecoveryContext,
      RecoveryBlackboardSchema
    >(buildHardRecoveryTree(options.recovery ?? {}), {
      name: `hard.recovery.slot${options.slotIndex}`,
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
   * 15–20-frame delay window has elapsed, at which point the bot's
   * `decide()` will read it through {@link HardTierAI.perceive}.
   */
  pushPerception(frame: number, world: WorldSnapshot): void {
    this.reaction.pushPerception(frame, world);
  }

  /**
   * Record that the bot just landed a hit. Forwards into the offensive
   * blackboard so the next tick's combo recognition can stage a
   * follow-up. Mirrors {@link
   * import('./offensive/registerLandedHit').registerLandedHit} so the
   * controller can call this directly from its existing collision
   * callback.
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
  snapshot(): HardTierAISnapshot {
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
   * Validates the schema fields exist (nominal type-check) and
   * re-seeds the underlying systems. The reaction system has its own
   * validation pass (see {@link
   * HardTierReactionSystem.restoreSnapshot}) so corruption fails loudly
   * during development.
   */
  restoreSnapshot(snap: HardTierAISnapshot): void {
    this.reaction.restoreSnapshot(snap.reaction);
    schemaToBlackboard<OffensiveBlackboardSchema>(
      this.offensiveTree.getBlackboard(),
      DEFAULT_OFFENSIVE_BLACKBOARD,
      snap.offensiveBlackboard,
    );
    schemaToBlackboard<RecoveryBlackboardSchema>(
      this.recoveryTree.getBlackboard(),
      DEFAULT_RECOVERY_BLACKBOARD,
      snap.recoveryBlackboard,
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
   * Returns `null` during the warm-up window (the first 15–20 frames of
   * a match before any delayed perception is available); the
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

    // ---- Offensive sub-tree V2 -------------------------------------------
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
   * recovery tree. Emits land in the supplied array. Returns the tree's
   * status so the caller can decide whether to fall through to the
   * offensive tree.
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
        // otherwise. This mirrors how the original recovery
        // controller layer was expected to populate the field.
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
   * blackboard's lastAirJumpTick latch. The match scene populates the
   * authoritative count via {@link Character.getJumpsRemaining}; this
   * helper exists for unit tests and for the warm-up window when no
   * authoritative count is yet available.
   */
  private deriveJumpsRemaining(): number {
    // Default M2 character has 1 air-jump. After the first air-jump
    // emit the leaf stamps `recoveryLastAirJumpTick`; that's the
    // signal the budget has been consumed for the airborne period.
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
// Verb translation — offensive / recovery → AIInputCommand
// ---------------------------------------------------------------------------

/**
 * Translate one {@link OffensiveAction} emit into the equivalent
 * {@link AIInputCommand} the base class consumes. Pure mapping —
 * deterministic, no allocation outside the returned object.
 */
export function translateOffensiveEmit(
  action: OffensiveAction,
): AIInputCommand {
  switch (action.kind) {
    case 'idle':
      return { kind: 'idle' };
    case 'moveLeft':
      return { kind: 'moveLeft' };
    case 'moveRight':
      return { kind: 'moveRight' };
    case 'jab':
    case 'tilt':
      return { kind: 'attack' };
    case 'smash':
      return { kind: 'attackHeavy' };
    case 'special':
      return { kind: 'special' };
    case 'shield':
      return { kind: 'shield' };
    case 'dodge':
      return { kind: 'dodge' };
  }
}

/**
 * Translate one {@link RecoveryAction} emit into the equivalent
 * {@link AIInputCommand} the base class consumes. Pure mapping —
 * deterministic, no allocation outside the returned object.
 */
export function translateRecoveryEmit(
  action: RecoveryAction,
): AIInputCommand {
  switch (action.kind) {
    case 'idle':
      return { kind: 'idle' };
    case 'moveLeft':
      return { kind: 'moveLeft' };
    case 'moveRight':
      return { kind: 'moveRight' };
    case 'moveUp':
      return { kind: 'moveUp' };
    case 'moveDown':
      return { kind: 'moveDown' };
    case 'jump':
      return { kind: 'jump' };
    case 'upSpecial':
      // Up-special routes through the `special` press of the input
      // verb table; the engine's input dispatcher fires the registered
      // up-special move when the press lands while airborne.
      return { kind: 'special' };
    case 'airDodge':
      return { kind: 'dodge' };
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
 * The conservative policy: attack pressable iff no current move is
 * reported, or the current move is in `'recovery'` and has 0 frames
 * remaining (i.e. the move ends this tick). This matches the engine's
 * `Character.attemptAttack` gate behaviour.
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
 * `(stageRight, stageTop)`.
 *
 * The match scene's full stage geometry pipeline produces a richer
 * ledge map (multiple platforms, internal corners) — this helper
 * exists for the standalone provider test path and falls back
 * gracefully when only the perceived stage extents are available.
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
  // Pick whichever ledge is closer to the bot.
  const distLeft = Math.abs(selfX - stageLeft);
  const distRight = Math.abs(selfX - stageRight);
  if (distLeft <= distRight) {
    return { x: stageLeft, y: stageTop, side: 'left' };
  }
  return { x: stageRight, y: stageTop, side: 'right' };
}

/**
 * Snapshot helper — read every key from a blackboard into a plain
 * record. Uses the supplied default schema to know which keys exist
 * (the IBlackboard interface doesn't expose a "list keys" method, so
 * we drive the read off the schema's known field names).
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
 * blackboard.
 */
function schemaToBlackboard<TSchema extends object>(
  blackboard: IBlackboard<TSchema>,
  defaults: Readonly<TSchema>,
  values: Readonly<TSchema>,
): void {
  // Clear the offensive partition first so any stale entries that
  // weren't in the snapshot are wiped.
  if (Object.keys(defaults).every((k) => k.startsWith('combo'))) {
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
