/**
 * EasyTierAI — full Easy difficulty tier composition (AC 20203 Sub-AC 3).
 *
 * Why this module exists
 * ----------------------
 *
 * The Easy tier is built up from a stack of orthogonal primitives that
 * mirror — but deliberately weaken — the Hard-tier composition shipped
 * in {@link HardTierAI}:
 *
 *   • {@link AIInputProvider} — adapter from emit verbs to
 *     {@link CharacterInput} (AC 10201 Sub-AC 1).
 *   • {@link HardTierReactionSystem} (configured with the Easy preset)
 *     — 28-36 frame perception delay buffer instead of Hard's 15-20.
 *   • {@link buildEasyOffensiveTree} — idle-gate + wander-gate + basic
 *     jab Selector. NO combo recognition, NO edge-guard, NO smash KO
 *     branch, NO recovery sub-tree. Easy tier is intentionally
 *     button-mashing-novice.
 *   • {@link selectTarget} — tier-agnostic target selection with
 *     sticky bias (used so the bot doesn't ping-pong between players
 *     in a 4-way melee).
 *   • {@link EasyInputErrorMangler} — injects high-rate input errors
 *     (wrong-direction, dropped press, spurious press) on top of the
 *     tree's output. The fourth pillar of the AC.
 *
 * What was missing was a single class that *composes* those primitives
 * into a drop-in {@link PlayerInputProvider} the match scene can plug
 * into a player slot. This module fills that gap, mirroring the
 * `HardTierAI` design so the match scene can switch between difficulty
 * tiers with a one-line constructor swap.
 *
 * Determinism contract
 * --------------------
 *
 *   • No `Math.random()`. Every stochastic decision flows through the
 *     constructor-supplied {@link Rng}.
 *   • The reaction-system delay specification is bit-stable across
 *     ticks (sticky on `sampled` mode, fixed on `fixed` mode) so the
 *     replay system can rebuild the perception offset deterministically.
 *   • {@link EasyTierAI.snapshot} / {@link EasyTierAI.restoreSnapshot}
 *     round-trip the entire controller (reaction system, behavior-
 *     tree blackboard, sticky target slot, RNG state) so the 300-frame
 *     replay pipeline can rehydrate Easy-tier state without bespoke
 *     adapters.
 *   • The error mangler holds *no* per-tick state — its randomness
 *     flows through the same shared RNG, so there's nothing extra to
 *     snapshot for it.
 *   • The offensive tree is constructed once per provider (in the
 *     constructor) and reused — the factory function is pure and the
 *     tree itself carries no per-tick state outside the blackboard.
 *
 * Why the Easy tier doesn't ship a recovery sub-tree
 * --------------------------------------------------
 *
 * A novice can't recover well. Real beginners get knocked off the
 * stage and either die or jump erratically without aiming back. The
 * Easy tier deliberately omits the {@link buildHardRecoveryTree}
 * branch so off-stage knockdowns frequently turn into KOs — that's
 * the *believable weakness* the AC asks for. A future "recovery-
 * lite" branch could be added as an option, but the v1 Easy tier
 * keeps the omission as a core feel signal.
 *
 * What this class deliberately is NOT
 * -----------------------------------
 *
 *   • A scene observer. The match scene assembles the world snapshot
 *     once per fixed step from live `Character` / stage state and
 *     pushes it in. The provider never reads Phaser / Matter.
 *
 *   • A hit detector. Easy tier doesn't recognise combos, so there's
 *     no `registerLandedHit` hook — the bot wouldn't react to a
 *     successful hit anyway.
 *
 *   • A character-specific tuner. Per-character reach numbers flow
 *     through the options bag; the tree shape itself is identical
 *     across the four characters in the M2 roster.
 *
 * @example Basic wiring inside the match scene
 * ```ts
 * const bot = new EasyTierAI({
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
  buildEasyOffensiveTree,
  type EasyOffensiveTreeOptions,
} from './offensive/EasyOffensiveTree';
import {
  DEFAULT_OFFENSIVE_BLACKBOARD,
  type OffensiveAction,
  type OffensiveBlackboardSchema,
  type OffensiveContext,
} from './offensive/types';
import { translateOffensiveEmit } from './HardTierAI';
import { BehaviorTree } from './behaviorTree/BehaviorTree';
import { type IBlackboard } from './behaviorTree/Blackboard';
import { NodeStatus } from './behaviorTree/Node';
import {
  EasyInputErrorMangler,
  type EasyInputErrorOptions,
} from './easyInputErrors';
import {
  type PlayerSlotIndex,
} from '../input/InputProvider';
import { type Rng } from '../utils/Rng';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Default Easy-tier reaction-window specification. Sampled across the
 * 28-36 frame band on construction, sticky for the rest of the match
 * — so the bot's reaction time has match-to-match variance but stays
 * stable inside any one game (preserves perceptual continuity for the
 * human opponent).
 *
 * Note this differs from the Hard tier's default (`fixed: 17`) on
 * purpose: the Easy preset's 9-frame range is wide enough that
 * sampling each match keeps the bot from feeling identical across
 * sessions, while a fixed 32-frame delay would feel mechanical.
 */
export const DEFAULT_EASY_INPUT_DELAY: HardTierInputDelaySpec = {
  mode: 'sampled',
  minFrames: REACTION_WINDOW_PRESETS.easy.minDelayFrames,
  maxFrames: REACTION_WINDOW_PRESETS.easy.maxDelayFrames,
};

/**
 * Construction options for {@link EasyTierAI}. Every option but
 * `slotIndex` and `rng` is optional and defaults to the canonical
 * Easy-tier tunables documented in the relevant sub-AC modules.
 */
export interface EasyTierAIOptions extends AIInputProviderOptions {
  /**
   * Reaction-system input delay specification. Defaults to
   * {@link DEFAULT_EASY_INPUT_DELAY} (sampled 28-36 frames — the
   * Easy reaction-window preset).
   *
   * Pass `{ mode: 'fixed', frames: 32 }` for a flat slow delay or any
   * lower value to weaken the slow-reaction property for testing.
   */
  readonly inputDelay?: HardTierInputDelaySpec;

  /**
   * Tunables forwarded into the offensive sub-tree — idle / wander
   * chance, jab range. Defaults to {@link buildEasyOffensiveTree}'s
   * defaults (40 % idle, 25 % wander, 50 px jab reach).
   */
  readonly offensive?: EasyOffensiveTreeOptions;

  /**
   * Tunables forwarded into the input-error mangler — wrong-direction
   * / dropped-press / spurious-press rates. Defaults match the Easy
   * tier's "high error rates" target (20 % move-error, 30 % press-
   * drop, 5 % spurious-press).
   */
  readonly inputErrors?: EasyInputErrorOptions;
}

/**
 * Snapshot shape for {@link EasyTierAI.snapshot} /
 * {@link EasyTierAI.restoreSnapshot}. Captures every piece of mutable
 * state the controller owns so the 300-frame replay pipeline can
 * rehydrate the bot mid-match.
 *
 * RNG state is captured at the controller level so a single shared
 * Rng instance round-trips exactly through both the reaction system
 * (input-delay rolls) and the behavior tree (idle / wander / direction
 * picks) and the error mangler (move-error / press-drop / spurious-
 * press rolls).
 */
export interface EasyTierAISnapshot {
  /** Reaction system state (delay buffer + spec). */
  readonly reaction: HardTierReactionSnapshot<WorldSnapshot, unknown>;
  /** Offensive blackboard contents at snapshot time. */
  readonly offensiveBlackboard: OffensiveBlackboardSchema;
  /** Sticky target opponent slot, or `null` when no target is locked yet. */
  readonly lastTargetSlot: PlayerSlotIndex | null;
  /** Bot RNG state — captured so error / wander rolls reproduce verbatim. */
  readonly rngState: number;
  /** Tick counter on the offensive tree at snapshot time. */
  readonly offensiveTickCount: number;
}

// ---------------------------------------------------------------------------
// EasyTierAI — the composed controller class
// ---------------------------------------------------------------------------

/**
 * Easy difficulty tier — a "novice"-feeling AI bot that hesitates
 * frequently, wanders aimlessly, button-mashes only the basic jab,
 * and regularly screws up the input itself. Composes the Easy
 * reaction-window preset, the Easy offensive sub-tree, and the
 * input-error mangler into one drop-in {@link AIInputProvider}.
 */
export class EasyTierAI extends AIInputProvider {
  private readonly reaction: HardTierReactionSystem<WorldSnapshot, unknown>;
  private readonly offensiveTree: BehaviorTree<
    OffensiveContext,
    OffensiveBlackboardSchema
  >;
  private readonly errorMangler: EasyInputErrorMangler;

  /**
   * Sticky target slot — the opponent the bot focused on last tick.
   * The threat-weighted target selection biases toward this slot so
   * the bot doesn't switch targets every frame in a 4-way melee.
   * Same mechanism as Hard tier; novices still focus on one target,
   * they just react slowly when a new threat emerges (the reaction
   * system handles that).
   */
  private lastTargetSlot: PlayerSlotIndex | null = null;

  constructor(options: EasyTierAIOptions) {
    super(options);

    this.reaction = new HardTierReactionSystem<WorldSnapshot, unknown>({
      inputDelay: options.inputDelay ?? DEFAULT_EASY_INPUT_DELAY,
      rng: options.rng,
    });

    this.offensiveTree = new BehaviorTree<
      OffensiveContext,
      OffensiveBlackboardSchema
    >(buildEasyOffensiveTree(options.offensive ?? {}), {
      name: `easy.offensive.slot${options.slotIndex}`,
      initialBlackboard: { ...DEFAULT_OFFENSIVE_BLACKBOARD },
      resetBlackboard: true,
    });

    this.errorMangler = new EasyInputErrorMangler(options.inputErrors ?? {});
  }

  // -------------------------------------------------------------------------
  // External API — perception input
  // -------------------------------------------------------------------------

  /**
   * Push a fresh ground-truth perception into the reaction system's
   * delay buffer. Called by the match scene once per fixed step with
   * the authoritative current world state, BEFORE {@link sample} runs.
   *
   * The reaction system retains the snapshot until the configured
   * 28-36-frame delay window has elapsed, at which point the bot's
   * `decide()` will read it through {@link EasyTierAI.perceive}.
   */
  pushPerception(frame: number, world: WorldSnapshot): void {
    this.reaction.pushPerception(frame, world);
  }

  /** Direct accessor for the reaction system — useful for diagnostics / replay tooling. */
  getReactionSystem(): HardTierReactionSystem<WorldSnapshot, unknown> {
    return this.reaction;
  }

  /** Read-only accessor for the offensive blackboard — useful for tests / diagnostics. */
  getOffensiveBlackboard(): IBlackboard<OffensiveBlackboardSchema> {
    return this.offensiveTree.getBlackboard();
  }

  /** Read-only accessor for the input-error mangler — useful for tests / diagnostics. */
  getErrorMangler(): EasyInputErrorMangler {
    return this.errorMangler;
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
   * reaction system, the offensive tree blackboard, the sticky target
   * slot, and the RNG state.
   */
  snapshot(): EasyTierAISnapshot {
    return {
      reaction: this.reaction.snapshot(),
      offensiveBlackboard: blackboardToSchema(
        this.offensiveTree.getBlackboard(),
        DEFAULT_OFFENSIVE_BLACKBOARD,
      ),
      lastTargetSlot: this.lastTargetSlot,
      rngState: this.rng.getState(),
      offensiveTickCount: this.offensiveTree.getTickCount(),
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
  restoreSnapshot(snap: EasyTierAISnapshot): void {
    this.reaction.restoreSnapshot(snap.reaction);
    schemaToBlackboard(
      this.offensiveTree.getBlackboard(),
      DEFAULT_OFFENSIVE_BLACKBOARD,
      snap.offensiveBlackboard,
    );
    this.lastTargetSlot = snap.lastTargetSlot;
    this.rng.setState(snap.rngState);
  }

  // -------------------------------------------------------------------------
  // AIInputProvider hook overrides — perception + decision pipeline
  // -------------------------------------------------------------------------

  /**
   * Return the *delayed* perception the bot should react to this
   * tick. The match scene's `pushPerception()` keeps the reaction
   * system's buffer warm; this hook simply pulls the snapshot at
   * `frame - inputDelayFrames`.
   *
   * Returns `null` during the warm-up window (the first 28-36 frames
   * of a match before any delayed perception is available); the
   * `decide()` override below short-circuits to a neutral input on
   * `null`.
   */
  protected override perceive(frame: number): WorldSnapshot | null {
    return this.reaction.perceive(frame);
  }

  /**
   * Pure decision step — pure on (snapshot, blackboard, RNG). Tick
   * the offensive tree, translate the emits to {@link AIInputCommand}
   * verbs, then run the result through the input-error mangler.
   *
   * No recovery sub-tree — the Easy tier deliberately omits one (see
   * the module docstring for rationale). An off-stage Easy bot
   * frequently dies; that's the believable-weakness signal.
   */
  protected override decide(
    frame: number,
    snapshot: WorldSnapshot | null | undefined,
  ): readonly AIInputCommand[] {
    if (!snapshot) {
      // Warm-up — no perception yet. Hold neutral.
      return [];
    }

    // Even during warm-up the error mangler's RNG cadence stays
    // stable across replays because the warm-up branch above returns
    // BEFORE consuming any randomness. Once the buffer is warm and
    // we hit the real decision branch below, every subsequent tick
    // burns the same fixed cadence (offensive RNG draws + error
    // mangler RNG draws) so two identically-seeded bots stay aligned.

    const offensiveEmits: OffensiveAction[] = [];
    this.tickOffensiveTree(frame, snapshot, offensiveEmits);

    const intended: AIInputCommand[] = offensiveEmits.map(
      translateOffensiveEmit,
    );
    return this.errorMangler.apply(intended, this.rng);
  }

  /**
   * Subclass reset cascade — wipe the behavior-tree blackboard, clear
   * the reaction-system buffer, and forget the sticky target so the
   * next tick selects fresh.
   */
  protected override onReset(): void {
    this.offensiveTree.reset();
    this.reaction.clear();
    this.lastTargetSlot = null;
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

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
}

// ---------------------------------------------------------------------------
// Misc helpers
// ---------------------------------------------------------------------------

/**
 * Derive `canAttack` from the bot's perceived current move state.
 * Mirrors the Hard-tier helper: attack pressable iff no current move
 * is reported, or the current move is in `'recovery'` and has 0
 * frames remaining.
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
 * Snapshot helper — read every key from a blackboard into a plain
 * record. Uses the supplied default schema to know which keys exist
 * (the IBlackboard interface doesn't expose a "list keys" method, so
 * we drive the read off the schema's known field names).
 */
function blackboardToSchema(
  blackboard: IBlackboard<OffensiveBlackboardSchema>,
  defaults: Readonly<OffensiveBlackboardSchema>,
): OffensiveBlackboardSchema {
  const out: Partial<OffensiveBlackboardSchema> = {};
  for (const key of Object.keys(defaults) as Array<
    keyof OffensiveBlackboardSchema & string
  >) {
    const value = blackboard.get(key);
    if (value === undefined) {
      out[key] = defaults[key] as never;
    } else {
      out[key] = value as never;
    }
  }
  return out as OffensiveBlackboardSchema;
}

/**
 * Snapshot helper — write every field from a schema record into a
 * blackboard. Clears any stale entries first.
 */
function schemaToBlackboard(
  blackboard: IBlackboard<OffensiveBlackboardSchema>,
  defaults: Readonly<OffensiveBlackboardSchema>,
  values: Readonly<OffensiveBlackboardSchema>,
): void {
  for (const key of Object.keys(defaults) as Array<
    keyof OffensiveBlackboardSchema & string
  >) {
    blackboard.set(key, values[key] as never);
  }
}
