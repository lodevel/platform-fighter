/**
 * Per-player input controller — AC 50201 Sub-AC 1.
 *
 * Purpose
 * -------
 *
 * The earlier M5 work landed three orthogonal pieces:
 *
 *   • {@link InputBindingsStore} / {@link BindingsStore} — the four-slot
 *     persistent profile facade over `localStorage` + the in-memory data
 *     model.
 *   • {@link DeviceInputDispatcher} — stateless polling layer that resolves
 *     a {@link PlayerBindings} table against live keyboard / gamepad
 *     state into a per-action held bitmap.
 *   • {@link InputBindingManager} — event-driven press / release diffing
 *     for menus, the rebinding capture screen, and replay tagging. Owns
 *     the *single* per-player previous-frame snapshot — the canonical
 *     "what was held last poll, what is held this poll" record the
 *     edge-detection logic relies on.
 *
 * What was missing was a *single, named* per-player surface that gameplay
 * code (a fighter's per-step controller, the AI override path, the lobby
 * confirm logic) can grab once and read every frame *without referencing
 * any hardcoded {@link KEY_CODE} constant or device-specific lookup*. The
 * legacy {@link LocalInputHandler} had hardcoded `KEY_CODE.W` / `KEY_CODE.A`
 * etc. baked into its default tables and only exposed `isActionDown(player,
 * action)` — no rising / falling edge query, no awareness that a player
 * might be using a gamepad, and no path back through the rebinding store.
 *
 * `PlayerInputController` is that surface. It:
 *
 *   1. **Queries the `InputBindingManager` for the active mapping every
 *      frame.** All key/button lookups go through the manager (which in
 *      turn reads the live binding profile through its
 *      {@link DeviceInputDispatcher}). There are zero references to
 *      {@link KEY_CODE} in this file. A rebind committed mid-match is
 *      visible on the very next `update()`.
 *   2. **Exposes a unified action-state API.** `isActionDown`,
 *      `justPressed`, `justReleased` over the action set the Seed
 *      describes word-for-word: `move{Left,Right,Up,Down}` (plus the
 *      `move` vector convenience), `jump`, `attack`, `special`,
 *      `shield`, `grab`, `dodge`. No legacy `LogicalAction` / `taunt`
 *      pollution leaks into gameplay code.
 *   3. **Handles edge detection internally.** Every controller owns its
 *      own previous-frame snapshot (one per slot), so a single
 *      `update(frame)` call captures the manager's polled state and the
 *      controller's queries are pure functions of that snapshot pair
 *      (previous, current). No hidden mutation between queries — the
 *      state is frozen between updates.
 *
 * Architecture
 * ------------
 *
 *     raw keyboard / gamepad state
 *             │
 *     DeviceInputDispatcher  ◄── BindingsStore  (the live binding profile)
 *             │  per-frame ActionHeldMap
 *             ▼
 *     InputBindingManager   (owns slot snapshots; emits press/release events)
 *             │
 *             ▼ per-frame poll() + isActionHeld()
 *     PlayerInputController (one per slot — owns its own prev/curr snapshot)
 *             │
 *     gameplay code (Character controller, AI override, menus)
 *
 * The manager remains the *single named service* that translates raw
 * device events into per-action booleans through the active binding
 * profile. The controller is a thin per-slot adapter:
 *
 *   • It does NOT poll the manager itself by default — the gameplay scene
 *     polls the manager once per fixed step and the controller reads from
 *     the manager's live state on `update()`. This keeps a single source
 *     of truth and avoids two diff loops fighting over the same snapshot.
 *   • It owns the *per-controller* previous-frame snapshot used to derive
 *     `justPressed` / `justReleased`. The manager's own previous-frame
 *     snapshot fires events at slot-level granularity; the controller
 *     fields a slot-specific boolean query API a Character class can use
 *     inline (no listener wiring needed for the per-step input read).
 *
 * Determinism
 * -----------
 *
 *   • `update(frame)` is the *only* mutator. It samples the manager's
 *     dispatcher in one batched call, copies the result into the
 *     controller's `current` map, and rotates the previous map.
 *   • Outside `update()` the controller is a pure read surface:
 *     `isActionDown` / `justPressed` / `justReleased` / `getMoveVector`
 *     are pure functions of the held current + previous maps. Two reads
 *     of the same query on the same frame return identical results
 *     byte-for-byte.
 *   • No `Math.random()`, no wall-clock reads, no Phaser. The optional
 *     `frame` argument is forwarded to the manager only for diagnostic
 *     logging — the controller's edge detection works without it.
 *
 * Why a separate module instead of folding into `InputService` /
 * `InputBindingManager`
 * ---------------------------------------------------------------------
 *
 *   1. **Single-slot ergonomics.** `InputBindingManager.poll()` returns
 *      events for *every* tracked slot; `InputService.resolve(slot)`
 *      returns held state for *one* slot but has no edge query. A
 *      fighter's per-step controller needs a one-line "did this slot
 *      just press jump" check, not a four-slot diff loop or a
 *      held-only resolver — the controller is that single-line API.
 *   2. **Stable consumer vocabulary.** The controller's action set
 *      mirrors the Seed's word-for-word (`move/jump/attack/special/
 *      shield/grab/dodge`), shielding gameplay code from the legacy
 *      {@link LogicalAction} schema (which still carries `taunt`).
 *   3. **Edge detection without listeners.** The manager's event API is
 *      ideal for menus and the rebinding capture screen; gameplay code
 *      reads inputs *inline* during physics step and does not want a
 *      subscription model with re-entrancy concerns. The controller
 *      caches the previous-frame snapshot so a Character's `update()`
 *      can compute `justPressed('attack')` without a listener.
 *
 * Strict TypeScript
 * -----------------
 *
 * Compiled under `noUncheckedIndexedAccess + strict`. The exhaustive
 * `ACTION_NAMES` iteration plus the `UnifiedActionName` discriminated
 * union keep gameplay code from forgetting to handle a new action when
 * the controller learns one.
 */

import {
  type LogicalAction,
  type PlayerBindingsIndex,
} from '../types/inputBindings';
import {
  DODGE_DIRECTIONAL_THRESHOLD,
  defaultDodgeResolver,
  type DodgeResolver,
  type MoveVector,
  MOVE_NEUTRAL,
} from './InputService';
import type { ActionHeldMap } from './DeviceInputDispatcher';
import type { InputBindingManager } from './InputBindingManager';
import type { CharacterInput } from '../characters/Character';

// ---------------------------------------------------------------------------
// Public action vocabulary
// ---------------------------------------------------------------------------

/**
 * Frozen, ordered list of every *button-style* action the per-player
 * controller exposes. The order is the canonical iteration order the
 * Seed declares: movement directional half-axes first (left / right /
 * up / down — used by both the digital `isActionDown` query and the
 * analog {@link MoveVector} resolver), then jump, then offensive
 * (attack / special / grab), then defensive (shield / dodge).
 *
 * Why a `const` array instead of an `enum`:
 *
 *   • Determinism — a literal-typed `as const` array gives both the
 *     runtime iteration validators / debug overlays need *and* the union
 *     type {@link UnifiedActionName}. No reverse-lookup map, no
 *     auto-incrementing numeric ids that would couple wire formats to
 *     declaration order.
 *   • Replay payloads serialise the *string* identifier; reordering or
 *     extending this array can never invalidate an older replay as long
 *     as the action names are preserved.
 *
 * Coverage matches the Seed's action API word-for-word
 * (`move/jump/attack/special/shield/grab/dodge`). `taunt` is
 * deliberately omitted — it is a legacy {@link LogicalAction} entry the
 * Seed treats as gameplay-irrelevant for the M5 rebinding surface.
 */
export const ACTION_NAMES = [
  'moveLeft',
  'moveRight',
  'moveUp',
  'moveDown',
  'jump',
  'attack',
  'special',
  'grab',
  'shield',
  'dodge',
] as const;

/**
 * Discriminator for every button-style action the controller exposes.
 * The `move{Left,Right,Up,Down}` slots cover the digital "is this
 * direction held" reads; the {@link PlayerInputController.getMoveVector}
 * helper folds them into the analog 2D vector for stick-aware gameplay.
 */
export type UnifiedActionName = (typeof ACTION_NAMES)[number];

/**
 * Per-action held bitmap the controller caches between `update()` calls.
 * Mutable internally (the controller writes into one of two preallocated
 * records each frame); never exposed to consumers without a freeze.
 */
type ActionStateMap = Record<UnifiedActionName, boolean>;

// ---------------------------------------------------------------------------
// Construction options
// ---------------------------------------------------------------------------

/** Constructor options for {@link PlayerInputController}. */
export interface PlayerInputControllerOptions {
  /**
   * The {@link InputBindingManager} the controller queries each frame.
   * Required. The manager is the single named service that translates
   * raw keyboard / gamepad events into per-action booleans through the
   * active binding profile — the controller never touches the
   * dispatcher / bindings store directly, satisfying the AC's "no
   * hardcoded key constants" promise. The manager's
   * {@link InputBindingManager.isActionHeld} is used as the per-frame
   * "is this action held right now" oracle.
   */
  readonly manager: InputBindingManager;

  /**
   * Player slot the controller services. The controller is single-slot
   * by design — gameplay code instantiates one per active fighter so
   * each one's `isActionDown` / `justPressed` / `justReleased` reads
   * are scoped to that fighter without an extra slot argument.
   */
  readonly slot: PlayerBindingsIndex;

  /**
   * Optional override for the dodge derivation. Defaults to
   * {@link defaultDodgeResolver} (shield + directional chord — the
   * canonical Smash Bros spot/roll/air-dodge gesture). Override for:
   *
   *   • Future migration to a first-class `dodge` binding action — pass
   *     a resolver that does a direct binding lookup with the chord as
   *     a fallback so existing setups keep working.
   *   • Tests / debug overlays that want to force `dodge = true` to
   *     drive a specific code path without faking input state.
   */
  readonly dodgeResolver?: DodgeResolver;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build a fresh, all-released {@link ActionStateMap}. Used for both the
 * `current` and `previous` slots inside the controller; allocated once
 * per controller instance and mutated in place each `update()`.
 */
function makeNeutralStateMap(): ActionStateMap {
  return {
    moveLeft: false,
    moveRight: false,
    moveUp: false,
    moveDown: false,
    jump: false,
    attack: false,
    special: false,
    grab: false,
    shield: false,
    dodge: false,
  };
}

/**
 * Translate a {@link UnifiedActionName} into the legacy
 * {@link LogicalAction} the manager still consumes. The `dodge` action
 * has no direct entry in the legacy schema — it is derived by the
 * configured {@link DodgeResolver} — so callers must guard `dodge`
 * before invoking this helper. (Internally, the controller's
 * `update()` short-circuits dodge through the resolver.)
 */
function unifiedToLogical(action: Exclude<UnifiedActionName, 'dodge'>): LogicalAction {
  switch (action) {
    case 'moveLeft':
      return 'left';
    case 'moveRight':
      return 'right';
    case 'moveUp':
      return 'up';
    case 'moveDown':
      return 'down';
    case 'jump':
      return 'jump';
    case 'attack':
      return 'attack';
    case 'special':
      return 'special';
    case 'grab':
      return 'grab';
    case 'shield':
      return 'shield';
    /* istanbul ignore next — exhaustiveness sentinel. */
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

// ---------------------------------------------------------------------------
// PlayerInputController
// ---------------------------------------------------------------------------

/**
 * Single-slot per-player input controller. Queries the
 * {@link InputBindingManager} for the active key/button mapping each
 * frame and exposes a unified action-state API
 * (`isActionDown`/`justPressed`/`justReleased`) for movement, jump,
 * attack, special, shield, grab, and dodge actions.
 *
 * Lifecycle:
 *
 *     // Construct against an existing manager + the slot the fighter occupies:
 *     const p1Controller = new PlayerInputController({ manager, slot: 1 });
 *
 *     // Per fixed step: refresh the controller's snapshots, then read.
 *     p1Controller.update(currentFrame);
 *     if (p1Controller.justPressed('jump'))   wolf.startJump();
 *     if (p1Controller.justPressed('attack')) wolf.fireJab();
 *     if (p1Controller.isActionDown('shield')) wolf.holdShield();
 *
 *     // The {@link MoveVector} convenience folds the four directional
 *     // half-axes into a single 2D vector so a Character's movement
 *     // controller doesn't have to recombine them.
 *     const move = p1Controller.getMoveVector();
 *
 *     // Match teardown — release every held action so the next scene
 *     // starts from a clean baseline.
 *     p1Controller.reset();
 *
 * Mutation of the underlying bindings store is fully supported
 * mid-session: because the manager reads the store on every poll and the
 * controller queries the manager on every `update()`, a rebind committed
 * mid-match is visible on the very next `update()` — `justPressed` will
 * fire if the new binding is held but the old one was released.
 *
 * Determinism: the controller holds exactly two pieces of state — the
 * `current` and `previous` action maps — and rotates them inside
 * `update()`. Outside `update()` the controller is a pure read surface;
 * two queries with no `update()` between them return identical results.
 */
export class PlayerInputController {
  private readonly manager: InputBindingManager;
  private readonly slot: PlayerBindingsIndex;
  private readonly dodgeResolver: DodgeResolver;
  /**
   * Held state from the most recent `update()`. Mutated in place each
   * frame so the controller allocates a fixed amount of memory after
   * construction.
   */
  private current: ActionStateMap;
  /**
   * Held state from the previous `update()`. Used to derive
   * `justPressed` / `justReleased` by comparing against `current`.
   */
  private previous: ActionStateMap;
  /**
   * Most recent frame index passed to `update()`. Defaults to `-1`
   * before the first update. Exposed via {@link getLastFrame} for debug
   * overlays / replay diagnostics — never used by the edge-detection
   * logic itself (which is a pure prev/curr diff).
   */
  private lastFrame: number;
  /**
   * `true` once the first `update()` has run. Before that, every
   * `justPressed` / `justReleased` query returns `false` regardless of
   * the manager's state — there is no "previous frame" to diff against
   * and a fighter spawned with shield held shouldn't fire a phantom
   * release on its first read.
   */
  private hasUpdated: boolean;

  constructor(options: PlayerInputControllerOptions) {
    this.manager = options.manager;
    this.slot = options.slot;
    this.dodgeResolver = options.dodgeResolver ?? defaultDodgeResolver;
    this.current = makeNeutralStateMap();
    this.previous = makeNeutralStateMap();
    this.lastFrame = -1;
    this.hasUpdated = false;
  }

  // -------------------------------------------------------------------------
  // Per-frame mutation
  // -------------------------------------------------------------------------

  /**
   * Refresh the controller's action snapshots by querying the
   * {@link InputBindingManager} for the active mapping at the current
   * frame. Should be called exactly once per fixed step before any
   * `isActionDown` / `justPressed` / `justReleased` read.
   *
   * The optional `frame` argument is recorded for debug / replay
   * diagnostics and forwarded onto the controller's internal
   * {@link getLastFrame} accessor; it does NOT participate in edge
   * detection (which is a pure diff between the previous and current
   * snapshots).
   *
   * Mid-match rebind handling: because the manager always reads the
   * live binding profile when its dispatcher samples actions, a rebind
   * committed before this call is fully visible — `justPressed` will
   * fire if the new binding is held but the old one was released.
   */
  update(frame: number = -1): void {
    // Rotate the maps: the current map becomes previous, the previous
    // becomes the buffer we write the new sample into. Two-buffer
    // rotation keeps allocations to zero on the steady-state path.
    const buffer = this.previous;
    this.previous = this.current;
    this.current = buffer;

    // Sample every button-style action through the manager. The
    // manager's `isActionHeld(slot, logical)` is a pure function of the
    // live device state + the current binding profile — exactly what
    // the AC asks for ("query InputBindingManager for the active
    // key/button mapping each frame").
    for (const action of ACTION_NAMES) {
      if (action === 'dodge') {
        // Dodge is derived (see the resolver call below) — placeholder
        // value here so the loop iteration order matches ACTION_NAMES;
        // overwritten before the function returns.
        this.current.dodge = false;
        continue;
      }
      const logical = unifiedToLogical(action);
      this.current[action] = this.manager.isActionHeld(this.slot, logical);
    }

    // Resolve dodge through the configured resolver, using the
    // freshly-sampled directional + shield state. The resolver receives
    // the same {@link DodgeResolverContext} shape the unified
    // {@link InputService} produces so a custom resolver written for
    // one consumer drops in here unchanged.
    const heldMap = this.buildHeldMap();
    const move = this.computeMoveVectorFromCurrent();
    this.current.dodge = this.dodgeResolver({
      slot: this.slot,
      move,
      jump: this.current.jump,
      attack: this.current.attack,
      special: this.current.special,
      shield: this.current.shield,
      grab: this.current.grab,
      held: heldMap,
    });

    // First update establishes the baseline: copy the freshly-sampled
    // `current` into `previous` so the next round of edge-detection
    // queries reads the diff cleanly. Without this, a fighter spawned
    // with shield held would fire a phantom `justPressed('shield')` on
    // the very first read (because the released → held diff sees the
    // initial all-false `previous` map). The Seed's gameplay layer
    // expects "no edge events on the first frame" — same convention
    // the {@link InputBindingManager} follows when its slot snapshots
    // are first seeded at construction.
    if (!this.hasUpdated) {
      for (const action of ACTION_NAMES) {
        this.previous[action] = this.current[action];
      }
    }

    this.lastFrame = frame;
    this.hasUpdated = true;
  }

  /**
   * Force-release every cached action and reset the previous-frame
   * snapshot to neutral. After `reset()`, every `justPressed` /
   * `justReleased` query returns `false` until the *second*
   * post-reset `update()` (the first establishes a previous-frame
   * baseline). Used by:
   *
   *   • Match teardown — a fighter walking away mid-press shouldn't
   *     leak their held state into the next match.
   *   • Replay scrubbing — the VCR layer calls this when the playhead
   *     jumps so the controller's edge detection re-establishes from
   *     the destination frame.
   *   • Controller-disconnect pause — disconnecting clears every cached
   *     held action; reconnecting lets the next `update()` re-press
   *     whatever's actually held on the resumed pad.
   */
  reset(): void {
    for (const action of ACTION_NAMES) {
      this.current[action] = false;
      this.previous[action] = false;
    }
    this.lastFrame = -1;
    this.hasUpdated = false;
  }

  // -------------------------------------------------------------------------
  // Read API — unified action state
  // -------------------------------------------------------------------------

  /**
   * True iff the named action is held *right now* (as of the most
   * recent {@link update}). Returns `false` for every action before the
   * first update — there is no live state to query yet.
   *
   * Exhaustively switches on the action name through the
   * {@link UnifiedActionName} union, so adding a new action that the
   * controller doesn't yet handle is a compile error.
   */
  isActionDown(action: UnifiedActionName): boolean {
    return this.current[action];
  }

  /**
   * True iff the action transitioned from released → held between the
   * previous and current updates (a rising edge). Equivalent to
   * `current && !previous`. Returns `false` before the second
   * `update()` — there is no previous-frame baseline to diff against.
   *
   * Used by:
   *
   *   • Fighter controllers — `justPressed('attack')` triggers the jab
   *     on the press frame and ignores subsequent held frames until the
   *     player releases and re-presses.
   *   • Menus — `justPressed('jump')` confirms a selection without
   *     re-firing while the player walks back to a different option.
   */
  justPressed(action: UnifiedActionName): boolean {
    if (!this.hasUpdated) return false;
    return this.current[action] && !this.previous[action];
  }

  /**
   * True iff the action transitioned from held → released between the
   * previous and current updates (a falling edge). Equivalent to
   * `!current && previous`. Returns `false` before the second
   * `update()` — there is no previous-frame baseline.
   *
   * Used by:
   *
   *   • Shield — `justReleased('shield')` triggers the shield-drop
   *     animation; the held state alone doesn't tell the runtime *when*
   *     to play the drop frame.
   *   • Charge moves — `justReleased('attack')` after a held charge
   *     fires the smash release.
   */
  justReleased(action: UnifiedActionName): boolean {
    if (!this.hasUpdated) return false;
    return !this.current[action] && this.previous[action];
  }

  /**
   * Convenience accessor — read the slot's analog 2D move vector
   * derived from the four directional held flags. Always returns
   * digital `-1 | 0 | +1` per axis: this controller works at the
   * action-event level (the manager only reports held bitmaps), so
   * gamepad analog magnitude is not preserved here. Callers that need
   * analog stick magnitude should read through
   * {@link InputService.sampleMove} instead — that path queries the
   * dispatcher's analog `sampleMoveX` / `sampleMoveY` directly.
   *
   * Returns the {@link MOVE_NEUTRAL} singleton when both axes are zero
   * so a stationary slot doesn't allocate a fresh record every frame.
   */
  getMoveVector(): MoveVector {
    return this.computeMoveVectorFromCurrent();
  }

  // -------------------------------------------------------------------------
  // Introspection
  // -------------------------------------------------------------------------

  /**
   * The slot this controller services. Exposed so a Character / AI
   * runtime that received a controller through dependency injection
   * can confirm it's wired to the right player without a separate
   * argument.
   */
  getSlot(): PlayerBindingsIndex {
    return this.slot;
  }

  /**
   * Most recent frame index passed to {@link update}. Defaults to `-1`
   * before the first update. Exposed for debug overlays / replay
   * diagnostics — never participates in edge detection.
   */
  getLastFrame(): number {
    return this.lastFrame;
  }

  /**
   * The {@link InputBindingManager} this controller queries. Exposed
   * for tests and for code paths that want to subscribe to the manager
   * for menu events while reading inline through the controller for
   * gameplay — both views share the same underlying device poll, so
   * there's no double-polling.
   */
  getManager(): InputBindingManager {
    return this.manager;
  }

  /**
   * Snapshot of the current held-state map. The returned record is
   * frozen — callers can compare two snapshots structurally without
   * worrying about a future `update()` mutating either.
   *
   * Allocates a fresh record per call; reserve for tests / debug
   * overlays / replay logging that want a wholesale dump of the
   * controller's state at a specific frame. The per-action read
   * methods ({@link isActionDown} et al.) are zero-allocation.
   */
  snapshotState(): Readonly<ActionStateMap> {
    return Object.freeze({ ...this.current });
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * Fold the controller's `current` map into a legacy
   * {@link ActionHeldMap} for the dodge resolver. The resolver only
   * reads the directional and shield slots (per
   * {@link defaultDodgeResolver}'s contract); other actions are
   * forwarded so a custom resolver that wants the full bitmap can use
   * it without a second query path.
   *
   * The `taunt` field is filled with `false` because the controller
   * does not expose a taunt action (it is omitted from the Seed's
   * action API for M5). Resolvers that care about taunt should read
   * through the manager directly.
   */
  private buildHeldMap(): ActionHeldMap {
    return Object.freeze({
      left: this.current.moveLeft,
      right: this.current.moveRight,
      up: this.current.moveUp,
      down: this.current.moveDown,
      jump: this.current.jump,
      attack: this.current.attack,
      special: this.current.special,
      shield: this.current.shield,
      grab: this.current.grab,
      taunt: false,
    });
  }

  /**
   * Build a {@link MoveVector} from the freshly-sampled directional
   * half-axis flags. Pure arithmetic on the `current` map; callable
   * from inside `update()` (after the half-axes are filled but before
   * the dodge resolver runs) without re-entering the manager.
   */
  private computeMoveVectorFromCurrent(): MoveVector {
    let x = 0;
    if (this.current.moveLeft) x -= 1;
    if (this.current.moveRight) x += 1;
    let y = 0;
    if (this.current.moveUp) y -= 1;
    if (this.current.moveDown) y += 1;
    if (x === 0 && y === 0) return MOVE_NEUTRAL;
    return Object.freeze({ x, y });
  }
}

// ---------------------------------------------------------------------------
// CharacterInput translator (AC 50202 Sub-AC 2)
// ---------------------------------------------------------------------------

/**
 * Build the per-frame {@link CharacterInput} record consumed by
 * `Character.applyInput` from the unified action-state API of a
 * {@link PlayerInputController}.
 *
 * AC 50202 Sub-AC 2 — every gameplay consumer (player movement / jump
 * logic, attack and special triggers, shield / grab / dodge handlers)
 * reads inputs through this helper rather than touching raw key codes
 * or the legacy {@link InputService.sampleCharacterInput} adapter that
 * went around the unified controller. All eight action categories the
 * Seed names —
 *
 *   • `moveLeft` / `moveRight` / `moveUp` / `moveDown` (folded into
 *     `moveX` and `dropThrough` via the controller's
 *     {@link PlayerInputController.getMoveVector} helper),
 *   • `jump`,
 *   • `attack`,
 *   • `special` (mirrored into the runtime's `attackHeavy` dispatch
 *     slot for the existing special-press dispatcher; also exposed as
 *     its own field for the future dedicated handler),
 *   • `shield`,
 *   • `grab`,
 *   • `dodge` (derived from the controller's configured dodge
 *     resolver — default chord: shield + directional)
 *
 * — flow through the rebindable binding layer here. The runtime never
 * reads device state directly; every per-step gameplay decision is a
 * pure function of the controller's snapshot, which is itself a pure
 * function of the manager's poll, which reads the live binding profile
 * via the dispatcher.
 *
 * Sample lifecycle:
 *
 *     // Once per fixed step, after manager.poll(frame):
 *     controller.update(frame);
 *     const input = buildCharacterInputFromController(controller);
 *     fighter.applyInput(input);
 *
 * Determinism: pure shape-translation over the controller's snapshot.
 * Two calls on the same controller without an intervening `update()`
 * return byte-identical records. The result is frozen on the way out
 * so consumers can stash references for replay capture without
 * worrying about a future poll mutating their copy.
 *
 * Why this lives next to {@link PlayerInputController} rather than on
 * the controller itself:
 *
 *   • The controller is the *unified action-state* surface — its API
 *     is `isActionDown` / `justPressed` / `justReleased` /
 *     `getMoveVector`. The {@link CharacterInput} record is one
 *     specific gameplay-side shape that *consumes* that surface.
 *     Keeping the translator separate lets a future renderer / debug
 *     overlay / AI consumer build *its* per-frame snapshot from the
 *     same controller without paying for the `CharacterInput` shape
 *     they don't need.
 *   • The same logic appears in {@link InputService.sampleCharacterInput}
 *     for the legacy single-call ergonomics; both helpers translate to
 *     the same field set so a consumer that switches between them
 *     produces identical records.
 */
export function buildCharacterInputFromController(
  controller: PlayerInputController,
): CharacterInput {
  const move = controller.getMoveVector();
  const jump = controller.isActionDown('jump');
  const attack = controller.isActionDown('attack');
  const special = controller.isActionDown('special');
  const grab = controller.isActionDown('grab');
  const shield = controller.isActionDown('shield');
  const dodge = controller.isActionDown('dodge');
  // AC 50202 Sub-AC 2 — every action category the Seed names is
  // exposed verbatim through the action-state API so gameplay
  // consumers branch on the unaliased press. The `attackHeavy`
  // smash-button slot stays separate from `special`: the existing
  // smash-flick detector latches on `attack` + a fast stick flick,
  // and a future sub-AC will wire a dedicated heavy-button binding
  // (e.g. C-stick) into this slot. Aliasing `special` → `attackHeavy`
  // here would mis-fire the smash dispatch on a special press for
  // movesets that ship a smash but no neutral special.
  return Object.freeze({
    moveX: move.x,
    jump,
    attack,
    special,
    grab,
    shield,
    dodge,
    dropThrough: controller.isActionDown('moveDown') && jump,
  });
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Re-export the dodge directional threshold so callers iterating
 * through the controller surface can reason about the resolver's
 * contract without also pulling in {@link InputService}. The value is
 * the same `0.5` the dispatcher uses for its half-axis threshold.
 */
export { DODGE_DIRECTIONAL_THRESHOLD };
