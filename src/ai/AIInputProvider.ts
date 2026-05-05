/**
 * AIInputProvider — abstract base class for AI-driven players. AC 10201
 * Sub-AC 1.
 *
 * Why this class exists
 * ---------------------
 *
 * The Hard-tier behavior tree (Sub-AC 18) emits *intent verbs* into a
 * tick-scoped {@link OffensiveActionWriter} / {@link RecoveryActionWriter}
 * sink — `'jab'`, `'moveLeft'`, `'jump'`, `'upSpecial'`, etc. The match
 * scene, however, drives every fighter through the deterministic
 * {@link CharacterInput} record (`{ moveX, jump, attack, ... }`) consumed
 * by `Character.applyInput`. Some adapter has to:
 *
 *   1. Run the AI's per-tick decision logic.
 *   2. Translate the resulting verbs into the same `CharacterInput`
 *      shape a {@link LocalInputHandler} produces.
 *   3. Conform to the {@link PlayerInputProvider} contract so the
 *      match scene's provider array can hold a mix of human and AI
 *      players without branching on slot kind.
 *
 * `AIInputProvider` is that adapter. It is a *thin* abstract class —
 * everything specific to a difficulty tier (which behavior tree, which
 * reaction window, which world snapshot) lives in subclasses. The base
 * class owns three orthogonal concerns:
 *
 *   • The {@link PlayerInputProvider} adapter — including the
 *     `sample(frame)` entrypoint, the `reset()` hook, and the
 *     slot-index field every consumer needs.
 *
 *   • The verb-to-`CharacterInput` translator — a pure function the
 *     subclass calls (or that the base calls automatically) to turn an
 *     emitted intent batch into the cross-cutting input record the
 *     gameplay layer consumes. This is the "drives the same input
 *     commands as human players" half of the AC.
 *
 *   • The held / press / release accumulator — the engine's
 *     `Character.applyInput` does its own rising-edge detection on
 *     `jump` / `attack` / `shield` / `dodge`, so AI providers must
 *     *hold* a button across multiple frames if they want a single
 *     press to register, then release it. The base class manages the
 *     hold counter so subclasses can simply emit "press jump" and the
 *     adapter decides which subsequent frames keep the bit set.
 *
 * Determinism contract
 * --------------------
 *
 *   • Subclasses never read `Math.random()`. Any randomness flows
 *     through the {@link Rng} the constructor stashes (and that the
 *     subclass typically forwards into its behavior tree's per-tick
 *     context).
 *   • `sample(frame)` is the only read path. Calling it twice with the
 *     same `frame` is a programming error (the match scene only ever
 *     samples once per fixed step) but the base class tolerates it
 *     gracefully — the second call returns the same record without
 *     re-ticking the subclass.
 *   • All state mutations live inside the base class's
 *     `pressHoldRemaining` / `lastSampledFrame` fields. Subclasses are
 *     stateless from the adapter's perspective; their own behavior-
 *     tree blackboards are independent.
 *   • `reset()` snaps the adapter back to a pristine state — counters
 *     cleared, last-frame forgotten, last sample wiped — and cascades
 *     into the subclass's optional `onReset()` hook for behavior-tree
 *     reset / blackboard reseed.
 *
 * Subclassing pattern
 * -------------------
 *
 * The minimal subclass implements `decide(frame): AIInputCommand[]`
 * which returns one or more {@link AIInputCommand} verbs the base
 * class then translates. Most production subclasses (HardTierAI,
 * MediumTierAI, EasyTierAI) layer in their own world snapshot and
 * behavior tree; they all share this base.
 *
 * Example (ultra-thin "always run right" bot used in unit tests):
 *
 * ```ts
 * class AlwaysRightBot extends AIInputProvider {
 *   protected decide(_frame: number): AIInputCommand[] {
 *     return [{ kind: 'moveRight' }];
 *   }
 * }
 *
 * const bot = new AlwaysRightBot({ slotIndex: 2, rng: new Rng(seed) });
 * scene.providers[2] = bot;
 * ```
 *
 * Perception wiring (AC 10201 Sub-AC 1)
 * -------------------------------------
 *
 * Sub-AC 1 mandates the controller "include perception of game state
 * (player positions, stage geometry, current move state)". The base
 * class supplies a thin perception step that subclasses opt in to:
 *
 *   • {@link AIInputProvider.perceive} is an optional protected hook
 *     called once per `sample()` *before* `decide()`. The default
 *     implementation returns `null` — subclasses that don't snapshot
 *     world state (smoke-test bots, scripted bots) pay nothing.
 *   • Subclasses that want perception override `perceive()` to return
 *     a {@link WorldSnapshot} (the unified per-tick record covering
 *     self position / opponent positions, stage geometry, and current
 *     move state on both self and every opponent).
 *   • The snapshot is forwarded into `decide(frame, snapshot)` as the
 *     second argument. Existing subclasses that ignore the second arg
 *     (the canonical `decide(frame)` signature) keep working unchanged
 *     because TypeScript permits narrower override signatures.
 *   • The base class also caches the latest snapshot under
 *     {@link AIInputProvider.getLatestSnapshot} so debug overlays /
 *     replay tooling can read the bot's perception without re-ticking.
 *
 * The base class still does not *read* the simulation directly — it
 * only forwards whatever the subclass's `perceive()` produces. The
 * controller pattern (perception → decide → emit) lives end-to-end on
 * the base class; subclasses author the perception side and the
 * decision side.
 *
 * What this class deliberately is NOT
 * -----------------------------------
 *
 *   • A behavior tree. Subclasses *use* a `BehaviorTree` if they want
 *     one; the base class doesn't depend on `behaviorTree/`.
 *   • A reaction window. Subclasses *use* a {@link ReactionWindow}
 *     if their tier mandates a perception delay; the base class
 *     doesn't impose one.
 *   • A simulation observer. The base class never reaches into the
 *     match scene — its `perceive()` hook is a *pull* from the
 *     subclass's existing snapshot pipeline, not a Phaser/Matter peek.
 */

import type { CharacterInput } from '../characters/Character';
import type { LedgeReleaseAction } from '../characters/ledgeHangState';
import {
  type PlayerInputProvider,
  type PlayerSlotIndex,
  closeCharacterInput,
  NEUTRAL_INPUT_SNAPSHOT,
} from '../input/InputProvider';
import type { WorldSnapshot } from './perception/WorldSnapshot';
import { type Rng } from '../utils/Rng';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Movement-stick direction the AI wants this frame. Mirrors the
 * keyboard `moveX` value the human input handler synthesises:
 *
 *   • `moveLeft`     — `moveX = -1`.
 *   • `moveRight`    — `moveX = +1`.
 *   • `moveUp`       — `moveX = 0`, sticks the up-axis intent (used by
 *                      `ledgeRelease` mapping and recovery moves).
 *   • `moveDown`     — `moveX = 0`, sticks the down-axis intent (used
 *                      by drop-through-platform mapping).
 *   • `moveAxis`     — analog `moveX` value. Mainly used by smoke-test
 *                      / replay providers; production AI tiers stick
 *                      to `-1 / 0 / +1` so their decisions are
 *                      bit-identical across replays.
 *
 * Press verbs (jump / attack / etc.) are separate from movement so a
 * single tick can emit "moveRight" + "attack" simultaneously — the
 * standard Smash forward-tilt pattern. The translator combines them
 * into one `CharacterInput` record.
 */
export type AIMoveCommand =
  | { readonly kind: 'moveLeft' }
  | { readonly kind: 'moveRight' }
  | { readonly kind: 'moveUp' }
  | { readonly kind: 'moveDown' }
  | { readonly kind: 'moveAxis'; readonly value: number };

/**
 * Press verbs the AI can emit. Each maps onto exactly one bit of the
 * `CharacterInput` record. Hold semantics are managed by the base
 * class — emit a press once and the adapter holds it for
 * {@link AIInputProviderOptions.pressHoldFrames} frames so the engine
 * registers a single rising edge.
 *
 *   • `jump`         — held jump button (also covers the "tap up to
 *                      jump" shorthand on its own).
 *   • `attack`       — held neutral-attack button. Combined with a
 *                      simultaneous `moveLeft` / `moveRight` movement
 *                      verb to produce tilts; combined with
 *                      `attackHeavy` for smashes.
 *   • `attackHeavy`  — held smash / heavy-attack button.
 *   • `special`      — neutral special. Currently routed through the
 *                      `attackHeavy` slot in the engine until a
 *                      dedicated `special` field lands; subclasses
 *                      that don't want this collapse should override
 *                      `translateCommands`.
 *   • `shield`       — held shield button (the "block" verb in the AC
 *                      brief).
 *   • `dodge`        — held dodge button (rolls / spot-dodge / air-
 *                      dodge picked by stick direction at press time).
 *   • `dropThrough`  — explicit pass-through-platform intent. Mirrors
 *                      the keyboard's `down + jump` shortcut so AI
 *                      can drop through without having to split the
 *                      verb across two physical buttons.
 *   • `idle`         — explicit "no press this frame". Distinct from
 *                      omitting an emit so a debug overlay can render
 *                      the bot's "deliberately doing nothing" beat.
 *   • `ledgeRelease` — directly populate the `ledgeRelease` field on
 *                      the `CharacterInput`. The behavior tree's
 *                      ledge handler emits this when the bot is
 *                      hanging and wants to climb / jump / attack /
 *                      drop off.
 */
export type AIPressCommand =
  | { readonly kind: 'idle' }
  | { readonly kind: 'jump' }
  | { readonly kind: 'attack' }
  | { readonly kind: 'attackHeavy' }
  | { readonly kind: 'special' }
  | { readonly kind: 'shield' }
  | { readonly kind: 'dodge' }
  | { readonly kind: 'dropThrough' }
  | { readonly kind: 'ledgeRelease'; readonly action: LedgeReleaseAction };

/**
 * The unified emit verb. Subclasses return zero or more of these from
 * their `decide(frame)` method on every tick. Multiple emits per tick
 * are explicitly allowed and routinely used:
 *
 *   `[{ kind: 'moveRight' }, { kind: 'attack' }]`  → forward tilt
 *   `[{ kind: 'moveLeft'  }, { kind: 'jump'   }]`  → reverse jump
 *   `[{ kind: 'shield'    }]`                      → block (held)
 *   `[{ kind: 'idle'      }]`                      → bait pause
 *   `[]`                                           → also valid; the
 *                                                    adapter folds an
 *                                                    empty batch into
 *                                                    NEUTRAL_INPUT.
 */
export type AIInputCommand = AIMoveCommand | AIPressCommand;

/**
 * Constructor options shared by every `AIInputProvider` subclass.
 *
 *   • `slotIndex`         — required. Which match slot this bot
 *                           occupies (0..3). Forwarded as the
 *                           {@link PlayerInputProvider.slotIndex}.
 *   • `rng`               — required. Seeded PRNG used by the
 *                           subclass's behavior tree / decision
 *                           logic. Owned by the controller; the base
 *                           class never touches it directly but
 *                           exposes it via `protected getRng()` for
 *                           subclasses that want frame-stable jitter.
 *   • `label`             — optional debug label. Defaults to
 *                           `"ai.bot.slot{n}"`.
 *   • `pressHoldFrames`   — how many fixed steps the adapter keeps a
 *                           press bit set after a single emit.
 *                           Defaults to `1` — i.e. the press is
 *                           visible only on the frame it was emitted,
 *                           which is enough for the engine's
 *                           rising-edge detector to fire one
 *                           single-button press. Subclasses that emit
 *                           sustained holds (e.g. shield) override
 *                           via the per-emit `holdFrames`
 *                           field on the verb (planned in a follow-
 *                           up sub-AC) or set this to a higher value
 *                           globally.
 *   • `defaultMoveAxis`   — fallback `moveX` when no movement verb is
 *                           emitted on a tick. Defaults to `0`. Some
 *                           subclasses pin movement during recovery
 *                           and want `0` even with movement verbs
 *                           absent.
 */
export interface AIInputProviderOptions {
  readonly slotIndex: PlayerSlotIndex;
  readonly rng: Rng;
  readonly label?: string;
  readonly pressHoldFrames?: number;
  readonly defaultMoveAxis?: number;
}

// ---------------------------------------------------------------------------
// AIInputProvider — abstract base class
// ---------------------------------------------------------------------------

/**
 * Abstract base for every AI-driven `PlayerInputProvider`. Subclasses
 * provide their own `decide(frame)` implementation; this class handles
 * the surrounding adapter mechanics (slot index plumbing, command
 * translation, hold counters, reset cascade).
 *
 * Why abstract instead of a thin function: subclasses commonly hold
 * non-trivial state (behavior-tree runner, perception window, combo
 * blackboard) that must respond to `reset()`. A class gives us a
 * stable hook point (`onReset()`) and a clear typed contract for
 * subclass fields without bolting on a "controller-as-data" pattern.
 */
export abstract class AIInputProvider implements PlayerInputProvider {
  public readonly slotIndex: PlayerSlotIndex;
  public readonly label: string;

  /**
   * Subclass-accessible RNG handle. The base class never *consumes*
   * this — subclasses are free to thread it into their own behavior-
   * tree contexts. Exposed as `protected` rather than via a getter so
   * subclasses don't pay an extra accessor call on every tick.
   */
  protected readonly rng: Rng;

  /** Number of frames a press verb stays held after a single emit. */
  private readonly pressHoldFrames: number;

  /** Default `moveX` value when no movement verb is emitted. */
  private readonly defaultMoveAxis: number;

  /**
   * Per-press hold countdowns, keyed by the press verb's `kind`. Each
   * tick the adapter decrements every entry; a `decide()` emit resets
   * its entry to `pressHoldFrames`. This is what lets a one-shot emit
   * register as a single-frame press in the engine's rising-edge
   * detector.
   */
  private readonly pressHold: Map<AIPressCommand['kind'], number>;

  /** Frame index of the last `sample()` call, or `-1` before first sample. */
  private lastSampledFrame: number;

  /** Cached result of the last `sample()` call — returned if the same frame is queried twice. */
  private lastSampledInput: CharacterInput;

  /** Latched ledge-release action (consumed on the same frame, then cleared). */
  private pendingLedgeRelease: LedgeReleaseAction | null;

  /**
   * Cached perception snapshot from the most recent `sample()` call.
   * Populated by the protected `perceive()` hook before `decide()`
   * runs. `null` until a snapshot is produced (e.g. before the first
   * sample, after `reset()`, or for subclasses that never override
   * `perceive()`).
   */
  private latestSnapshot: WorldSnapshot | null;

  constructor(options: AIInputProviderOptions) {
    this.slotIndex = options.slotIndex;
    this.label = options.label ?? `ai.bot.slot${options.slotIndex}`;
    this.rng = options.rng;
    this.pressHoldFrames = Math.max(1, options.pressHoldFrames ?? 1);
    this.defaultMoveAxis = options.defaultMoveAxis ?? 0;
    this.pressHold = new Map();
    this.lastSampledFrame = -1;
    this.lastSampledInput = NEUTRAL_INPUT_SNAPSHOT;
    this.pendingLedgeRelease = null;
    this.latestSnapshot = null;
  }

  // -------------------------------------------------------------------------
  // PlayerInputProvider implementation
  // -------------------------------------------------------------------------

  /**
   * Drive the AI for one fixed step and return the resulting
   * `CharacterInput`. Calls the subclass's `decide(frame)` exactly
   * once per *new* frame — re-sampling the same frame returns the
   * cached input without re-ticking the subclass (defensive against
   * accidental double-sampling during a stutter step).
   */
  sample(frame: number): CharacterInput {
    // Validate first — a negative / non-integer frame must surface
    // as an error even if it happens to equal the initial sentinel
    // (`-1`) used for the cache check below.
    if (
      typeof frame !== 'number' ||
      !Number.isFinite(frame) ||
      !Number.isInteger(frame) ||
      frame < 0
    ) {
      throw new Error(
        `AIInputProvider(${this.label}): sample() requires a non-negative ` +
          `integer frame index, got ${String(frame)}`,
      );
    }
    if (frame === this.lastSampledFrame) {
      return this.lastSampledInput;
    }
    if (this.lastSampledFrame !== -1 && frame < this.lastSampledFrame) {
      // Frame went backwards — usually a replay scrub. The provider
      // is supposed to have been reset() before scrubbing; refuse to
      // silently re-tick stale state, since that could push the bot
      // into a different decision branch than the original record.
      throw new Error(
        `AIInputProvider(${this.label}): sample(${frame}) called after ` +
          `sample(${this.lastSampledFrame}); reset() the provider before ` +
          `replaying earlier frames`,
      );
    }

    // Decay press holds *before* the subclass decides — a single-frame
    // hold (the default) was set on the previous tick and should be
    // gone before the new emit batch arrives.
    this.decayPressHolds();

    // Perception step (AC 10201 Sub-AC 1). Subclasses opt in by
    // overriding `perceive()` to produce a `WorldSnapshot`; the
    // default returns `null` so adapter-style bots (scripted /
    // smoke-test) pay no overhead. The result is cached so debug
    // tooling can read the bot's view post-sample, and forwarded to
    // `decide()` as the second arg.
    const snapshot = this.perceive(frame);
    this.latestSnapshot = snapshot;

    // Run the subclass.
    const commands = this.decide(frame, snapshot);

    // Apply press emits to the hold map.
    let movement: AIMoveCommand | null = null;
    for (const cmd of commands) {
      if (isMoveCommand(cmd)) {
        // Last-emit-wins on movement: a tick that emits both
        // `moveLeft` and `moveRight` lands on whichever was last in
        // the batch. Subclasses that want explicit cancellation can
        // emit `moveAxis: 0`.
        movement = cmd;
        continue;
      }
      if (cmd.kind === 'idle') {
        // Explicit idle clears the hold map (cancel any held press
        // mid-flight). Useful as a "panic release shield" beat.
        this.pressHold.clear();
        this.pendingLedgeRelease = null;
        continue;
      }
      if (cmd.kind === 'ledgeRelease') {
        this.pendingLedgeRelease = cmd.action;
        continue;
      }
      this.pressHold.set(cmd.kind, this.pressHoldFrames);
    }

    const moveX = movement === null
      ? this.defaultMoveAxis
      : resolveMoveAxis(movement);

    const input = closeCharacterInput({
      moveX,
      jump: this.isHeld('jump'),
      attack: this.isHeld('attack'),
      attackHeavy: this.isHeld('attackHeavy') || this.isHeld('special'),
      shield: this.isHeld('shield'),
      dodge: this.isHeld('dodge'),
      dropThrough: this.isHeld('dropThrough'),
      ledgeRelease: this.pendingLedgeRelease,
    });

    // Ledge release is a one-shot intent — consume it after baking
    // it into the input record so the *next* frame doesn't keep
    // requesting the same release.
    this.pendingLedgeRelease = null;

    this.lastSampledFrame = frame;
    this.lastSampledInput = input;
    return input;
  }

  /**
   * Wipe the adapter's transient state (press holds, last-frame
   * cache, cached perception snapshot) and cascade into the
   * subclass's `onReset()` hook so its behavior tree / perception
   * window can return to a pristine starting condition.
   */
  reset(): void {
    this.pressHold.clear();
    this.lastSampledFrame = -1;
    this.lastSampledInput = NEUTRAL_INPUT_SNAPSHOT;
    this.pendingLedgeRelease = null;
    this.latestSnapshot = null;
    this.onReset();
  }

  /**
   * Read the most recently produced perception {@link WorldSnapshot},
   * or `null` if no snapshot has been produced yet (before the first
   * sample, after `reset()`, or for subclasses that never override
   * `perceive()`).
   *
   * Provided so debug overlays, replay tooling, and unit tests can
   * inspect what the bot perceived without re-ticking the controller.
   * The returned snapshot is the same `readonly` value `decide()` saw
   * — callers must not mutate it.
   */
  getLatestSnapshot(): WorldSnapshot | null {
    return this.latestSnapshot;
  }

  // -------------------------------------------------------------------------
  // Subclass surface
  // -------------------------------------------------------------------------

  /**
   * Subclass hook — produce the intent batch for the supplied frame.
   * Called once per new frame from `sample(frame)`; never called
   * twice for the same frame.
   *
   * Implementations must be deterministic: the only sources of
   * randomness should be the {@link Rng} stashed on this base class
   * (or whatever seeded RNGs the subclass holds itself), and the
   * subclass's own per-frame world snapshot. No `Math.random()`, no
   * wall-clock reads.
   *
   * The optional second argument is the perception snapshot produced
   * by the subclass's {@link AIInputProvider.perceive} hook this
   * tick (or `null` if the subclass did not override `perceive()`).
   * Subclasses that don't need perception simply omit the second
   * parameter — TypeScript permits the narrower signature because a
   * `(frame) => …` is assignable to `(frame, snapshot) => …`.
   *
   * Returning `[]` is valid and folds into a fully-neutral
   * `CharacterInput` (every press false, `moveX = defaultMoveAxis`).
   */
  protected abstract decide(
    frame: number,
    snapshot?: WorldSnapshot | null,
  ): readonly AIInputCommand[];

  /**
   * Optional subclass hook — produce a perception {@link WorldSnapshot}
   * for the supplied frame (AC 10201 Sub-AC 1). Called once per new
   * frame from `sample(frame)` *before* `decide()`; the result is
   * cached on the controller for `getLatestSnapshot()` and forwarded
   * into `decide()` as the second argument.
   *
   * Subclasses that observe the world (Hard / Medium / Easy tiers)
   * override this to assemble player positions, stage geometry, and
   * the bot's own current move state into a {@link WorldSnapshot}.
   * Adapter-style subclasses (scripted bots, smoke-test bots) leave
   * the default `null`-returning implementation in place — they pay
   * no perception overhead.
   *
   * Determinism: implementations must be a pure function of (subclass
   * state, supplied `frame`) the same way `decide()` is. No
   * `Math.random()`, no wall-clock reads. The match scene's per-tick
   * perception pipeline already enforces this on its inputs.
   */
  protected perceive(_frame: number): WorldSnapshot | null {
    return null;
  }

  /**
   * Optional subclass hook — invoked from `reset()` after the base
   * class has wiped its own state. Default implementation is a no-op
   * so subclasses with no per-match state don't have to override.
   */
  protected onReset(): void {
    // override me
  }

  /**
   * Internal: decrement every entry in the hold map, removing any
   * that hit zero. Called at the *top* of each new sample tick so a
   * one-frame press emitted on tick `T` is visible only on tick `T`
   * and gone by tick `T + 1`.
   */
  private decayPressHolds(): void {
    if (this.pressHold.size === 0) return;
    for (const [kind, remaining] of this.pressHold) {
      const next = remaining - 1;
      if (next <= 0) {
        this.pressHold.delete(kind);
      } else {
        this.pressHold.set(kind, next);
      }
    }
  }

  /** True iff a press verb of the given kind is still in its hold window. */
  private isHeld(kind: AIPressCommand['kind']): boolean {
    return (this.pressHold.get(kind) ?? 0) > 0;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers — kept module-private to avoid a noisy public surface
// ---------------------------------------------------------------------------

function isMoveCommand(cmd: AIInputCommand): cmd is AIMoveCommand {
  return (
    cmd.kind === 'moveLeft' ||
    cmd.kind === 'moveRight' ||
    cmd.kind === 'moveUp' ||
    cmd.kind === 'moveDown' ||
    cmd.kind === 'moveAxis'
  );
}

/**
 * Resolve the `moveX` value implied by a movement verb.
 *
 *   • `moveLeft`   → -1
 *   • `moveRight`  → +1
 *   • `moveUp`     →  0  (vertical-only stick has no `moveX` impact)
 *   • `moveDown`   →  0  (same — `dropThrough` carries the down intent)
 *   • `moveAxis`   →  clamped value, NaN/∞ → 0
 */
function resolveMoveAxis(cmd: AIMoveCommand): number {
  switch (cmd.kind) {
    case 'moveLeft':
      return -1;
    case 'moveRight':
      return 1;
    case 'moveUp':
    case 'moveDown':
      return 0;
    case 'moveAxis': {
      const v = cmd.value;
      if (typeof v !== 'number' || !Number.isFinite(v)) return 0;
      if (v < -1) return -1;
      if (v > 1) return 1;
      return v;
    }
  }
}
