/**
 * Central InputResolver / ActionMap — AC 50201 Sub-AC 1.
 *
 * Purpose
 * -------
 *
 * The Seed promises a single named "input source of truth" that gameplay
 * code (the match scene, fighter controllers, AI overrides, the lobby
 * confirm logic, replay capture / playback) can read every frame to know
 * "is player N currently holding action X?" — *without* any consumer
 * referencing a hardcoded `KEY_CODE`, a Phaser cursor key, a
 * `navigator.getGamepads()` call, or a per-device branch.
 *
 * Earlier sub-ACs landed the supporting layers:
 *
 *   • {@link DeviceInputDispatcher} — stateless per-frame poll that
 *     resolves the active {@link PlayerBindings} table against live
 *     keyboard / gamepad state into a per-action held bitmap.
 *   • {@link InputBindingsStore} / {@link BindingsStore} — the four-slot
 *     persistent profile facade over `localStorage` + the in-memory data
 *     model, mutated mid-match by the rebinding UI.
 *   • {@link InputBindingManager} — event-driven press / release diffing
 *     for menu / pause / replay-tagger consumers.
 *   • {@link InputService} — per-slot {@link UnifiedActionState} resolver
 *     used by the gameplay scene's per-step read.
 *   • {@link PlayerInputController} — single-slot adapter exposing
 *     `isActionDown` / `justPressed` / `justReleased` to a fighter's
 *     inline `update()` hook.
 *
 * What was missing was a *single, central, multi-player* read surface
 * that exposes the canonical seed-named action vocabulary
 * (`move{Left,Right,Up,Down}` / `jump` / `attack` / `special` / `shield`
 * / `grab` / `dodge`) under the AC-named `getAction(playerIndex,
 * actionName)` API. The surrounding modules each cover a slice of that
 * surface, but no one of them is the AC's named "central" object:
 *
 *   • The dispatcher exposes per-action booleans but only over the
 *     legacy `LogicalAction` vocabulary (`taunt` instead of `dodge`,
 *     `left` instead of `moveLeft`, …) and has no edge detection.
 *   • The manager exposes events, not a poll-style read.
 *   • The service resolves *one slot at a time* and holds no edge state.
 *   • The controller is *single-slot* — gameplay code that wants a
 *     mid-frame "is P3 holding shield?" check would have to thread four
 *     separate controller references.
 *
 * `InputResolver` (also exported as `ActionMap`) is the AC's central
 * surface. It composes the existing pieces and exposes the unified
 * read API the rest of the engine consumes:
 *
 *   • `getAction(playerIndex, actionName)` — returns a frozen
 *     {@link ActionState} `{ held, justPressed, justReleased }` for one
 *     player + one action. The AC-named single-call read every gameplay
 *     consumer flows through.
 *   • `isActionHeld(playerIndex, actionName)` — convenience boolean
 *     accessor when only the held bit matters.
 *   • `wasJustPressed` / `wasJustReleased` — convenience edge accessors.
 *   • `getMoveVector(playerIndex)` — analog 2D vector folded from the
 *     four directional half-axes (digital `-1 | 0 | +1` on keyboard,
 *     analog stick magnitude on gamepad).
 *   • `update(frame)` — the *only* mutator. Samples the dispatcher for
 *     every tracked slot and rotates the per-slot prev/curr snapshot
 *     pair so the next round of edge queries reads off the diff.
 *
 * No call site of `InputResolver` ever references `KEY_CODE` or any
 * device-specific lookup — the resolver owns the single bridge from
 * "binding profile + raw device state" → "per-player action state",
 * satisfying the AC's "replacing direct key/button polling as the
 * single source of truth for action state" promise.
 *
 * Architecture
 * ------------
 *
 *     raw keyboard / gamepad state
 *             │
 *     DeviceInputDispatcher  ◄── BindingsStore / PlayerBindingsProvider
 *             │  per-frame ActionHeldMap + sampleMoveX / sampleMoveY
 *             ▼
 *     InputResolver  (this module — owns per-slot prev/curr snapshots)
 *             │
 *             ▼ getAction(player, action) → ActionState
 *     gameplay (match scene, fighter controllers, AI overrides, replay)
 *
 * The dispatcher remains the only thing that knows about device
 * specifics. The resolver is a pure shape-translator + edge-detector:
 * it asks the dispatcher for the held bitmap once per `update()`,
 * folds the legacy `LogicalAction` vocabulary into the canonical
 * seed-named {@link ActionName} vocabulary, runs the configured
 * {@link DodgeResolver} for the derived `dodge` bit, and exposes the
 * resulting per-player action state through the `getAction` API.
 *
 * Determinism
 * -----------
 *
 *   • `update(frame)` is the *only* mutator. Outside `update()` the
 *     resolver is a pure read surface — `getAction` /
 *     `isActionHeld` / `wasJustPressed` / `wasJustReleased` /
 *     `getMoveVector` are pure functions of the cached prev + curr maps.
 *     Two calls between updates return byte-identical results.
 *   • `update()` rotates the curr → prev buffer in place; the resolver
 *     allocates a fixed amount of memory after construction. Frozen
 *     {@link ActionState} records are short-lived but allocated lazily —
 *     callers that don't need the full struct can use the boolean
 *     accessors and avoid the allocation entirely.
 *   • The order of slots iterated inside `update()` is the order
 *     supplied to the constructor (defaults to `[1, 2, 3, 4]`); within
 *     a slot, actions iterate in {@link BINDING_ACTIONS} declaration
 *     order. A unit test that records a per-frame state dump gets the
 *     same sequence on every machine and every replay run.
 *   • No `Math.random()`, no wall-clock reads, no Phaser. The optional
 *     `frame` argument on `update()` is recorded for diagnostic use and
 *     never participates in edge detection.
 *
 * Why a separate module instead of folding into `InputService` /
 * `PlayerInputController`
 * --------------------------------------------------------------------
 *
 *   1. **Multi-player ergonomics.** The controller is single-slot;
 *      `InputService.resolve(slot)` is single-slot and holds no edge
 *      state. A central `getAction(player, action)` call site that
 *      asks "is P3 holding shield?" while drawing P1's HUD would
 *      otherwise need a service + four controllers wired together.
 *      The resolver keeps the single source of truth in one named
 *      object.
 *   2. **Canonical action vocabulary.** The dispatcher and manager
 *      speak the legacy `LogicalAction` set (`left | right | up | down
 *      | jump | attack | special | shield | grab | taunt`); the seed's
 *      action API is `move{Left,Right,Up,Down} / jump / attack /
 *      special / shield / grab / dodge` (note: `dodge`, not `taunt`).
 *      The resolver translates between the two so a downstream rename
 *      of `LogicalAction` doesn't ripple through gameplay code, and so
 *      gameplay code never has to remember which schema name is which.
 *   3. **Edge detection without a poll-listener loop.** Gameplay code
 *      reads inputs *inline* during the physics step and does not want
 *      a subscription model with re-entrancy concerns. The resolver
 *      caches per-slot prev/curr snapshots so every slot gets the same
 *      `justPressed` / `justReleased` semantics the controller offers
 *      to a single slot.
 *
 * Strict TypeScript
 * -----------------
 *
 * Compiled under `noUncheckedIndexedAccess + strict`. The exhaustive
 * iteration over {@link BINDING_ACTIONS} plus the {@link ActionName}
 * union keeps gameplay code from forgetting an action when the
 * resolver learns one.
 */

import type { CharacterInput } from '../characters/Character';
import {
  BINDING_ACTIONS,
  type BindingAction,
  type PlayerBindingIndex,
} from '../types/bindings';
import type { PlayerBindingsIndex } from '../types/inputBindings';
import {
  type ActionHeldMap,
  type DeviceInputDispatcher,
} from './DeviceInputDispatcher';
import {
  DODGE_DIRECTIONAL_THRESHOLD,
  defaultDodgeResolver,
  MOVE_NEUTRAL,
  type DodgeResolver,
  type MoveVector,
} from './InputService';

// ---------------------------------------------------------------------------
// Public action vocabulary
// ---------------------------------------------------------------------------

/**
 * Canonical, seed-named action vocabulary the resolver exposes.
 *
 * Ordered exactly as {@link BINDING_ACTIONS} — directional half-axes
 * first (`moveLeft` / `moveRight` / `moveUp` / `moveDown`), then jump,
 * then offensive (`attack` / `special` / `grab`), then defensive
 * (`shield` / `dodge`). The order is the canonical iteration order
 * for replay logging / debug overlays / unit tests.
 */
export const ACTION_NAMES: ReadonlyArray<BindingAction> = BINDING_ACTIONS;

/**
 * Discriminator for every action the resolver exposes. Aliased to
 * {@link BindingAction} so `getAction(player, action)` accepts the
 * exact same string identifiers the rebinding UI / persistent profile
 * envelope already use.
 */
export type ActionName = BindingAction;

/**
 * Player slot the resolver indexes by. Aliased to the canonical
 * {@link PlayerBindingIndex} (1..4) so the public surface speaks the
 * same vocabulary as the rest of the M5 binding stack.
 */
export type PlayerIndex = PlayerBindingIndex;

// ---------------------------------------------------------------------------
// Action state
// ---------------------------------------------------------------------------

/**
 * Frozen per-action state record returned by
 * {@link InputResolver.getAction}. Carries everything a gameplay
 * consumer needs to make a per-frame decision about one action:
 *
 *   • `held` — the action is held *right now* (as of the most recent
 *     {@link InputResolver.update}).
 *   • `justPressed` — the action transitioned released → held between
 *     the previous and current updates (a rising edge). `false` until
 *     the second `update()` (no prev baseline before then).
 *   • `justReleased` — the action transitioned held → released between
 *     the previous and current updates (a falling edge). Same baseline
 *     rule.
 *
 * The record is frozen on the way out so callers can keep references
 * across frames without worrying about a future `update()` mutating
 * their copy. A neutral all-released record is exposed as
 * {@link NEUTRAL_ACTION_STATE} so the resolver doesn't allocate when a
 * caller asks for an action that had no transitions this frame.
 */
export interface ActionState {
  readonly held: boolean;
  readonly justPressed: boolean;
  readonly justReleased: boolean;
}

/**
 * Frozen "all released, no edges" {@link ActionState} singleton.
 * Returned by the resolver before the first `update()` and whenever a
 * per-action read produces an all-false struct, so the steady-state
 * read path doesn't allocate.
 */
export const NEUTRAL_ACTION_STATE: ActionState = Object.freeze({
  held: false,
  justPressed: false,
  justReleased: false,
});

/**
 * Per-frame state of the `smash` action, returned by
 * {@link InputResolver.getSmash}. `smash` is not part of the canonical
 * {@link ActionName} vocabulary (that list also drives the dead
 * BINDING_ACTIONS profile stack), so the resolver carries it beside the
 * action records.
 *
 * `held` / `justPressed` / `justReleased` describe the action as a whole
 * (any smash binding). The key / button source and the stick source are
 * also tracked on their own, because they feed the fighter differently
 * (see {@link buildCharacterInputFromResolver}) and can be held together:
 *
 *   • `buttonHeld` — a smash key / button is held.
 *   • `fromStick` — a smash stick binding is held; `stickJustPressed` is
 *     its own rising edge (stick-held history only, so a key held across
 *     it neither masks nor fakes it). `x` / `y` are this frame's 4-way
 *     stick direction (see `DeviceInputDispatcher.sampleSmash`).
 */
export interface SmashState extends ActionState {
  readonly buttonHeld: boolean;
  readonly fromStick: boolean;
  readonly stickJustPressed: boolean;
  readonly x: number;
  readonly y: number;
}

/** Frozen "smash released, no edges" {@link SmashState}. */
export const NEUTRAL_SMASH_STATE: SmashState = Object.freeze({
  held: false,
  justPressed: false,
  justReleased: false,
  buttonHeld: false,
  fromStick: false,
  stickJustPressed: false,
  x: 0,
  y: 0,
});

// ---------------------------------------------------------------------------
// Construction options
// ---------------------------------------------------------------------------

/** Constructor options for {@link InputResolver}. */
export interface InputResolverOptions {
  /**
   * The {@link DeviceInputDispatcher} the resolver queries each frame.
   * Required. The dispatcher is the only thing that knows about device
   * specifics — the resolver is a pure shape-translator + edge-detector
   * over its output. There are zero references to `KEY_CODE` or any
   * device-specific lookup in this module — all key/button mapping
   * flows through the dispatcher and the active binding profile it
   * reads.
   */
  readonly dispatcher: DeviceInputDispatcher;

  /**
   * Player slots to track. Defaults to all four (`[1, 2, 3, 4]`).
   * Restricting to a subset (e.g. `[1, 2]` during a 2P match) skips
   * sample work for empty slots — purely a performance hint, the
   * dispatcher itself remains slot-agnostic.
   *
   * Reading {@link InputResolver.getAction} for a slot the resolver is
   * not tracking returns {@link NEUTRAL_ACTION_STATE} (every action
   * released, no edges) — calling code can confidently iterate every
   * slot without per-slot guards.
   */
  readonly slots?: ReadonlyArray<PlayerIndex>;

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

const DEFAULT_SLOTS: ReadonlyArray<PlayerIndex> = Object.freeze([1, 2, 3, 4]);

/** All four canonical slots; used by {@link InputResolver}'s defaults. */
export const ALL_PLAYER_INDICES: ReadonlyArray<PlayerIndex> = DEFAULT_SLOTS;

/**
 * Per-action held bitmap the resolver caches between `update()` calls.
 * Mutable internally — the resolver writes into one of two preallocated
 * records each frame; never exposed to consumers without a freeze.
 */
type ActionHeldRecord = Record<ActionName, boolean>;

/** Build a fresh, all-released held record. */
function makeNeutralHeldRecord(): ActionHeldRecord {
  return {
    moveLeft: false,
    moveRight: false,
    moveUp: false,
    moveDown: false,
    jump: false,
    attack: false,
    special: false,
    shield: false,
    grab: false,
    dodge: false,
  };
}

/**
 * Per-slot record the resolver keeps in its tracking map. Holds the
 * previous-frame and current-frame held bitmaps and a `hasUpdated`
 * flag so the first `update()` produces no phantom edges.
 */
interface SlotState {
  appealHeld: boolean;
  current: ActionHeldRecord;
  previous: ActionHeldRecord;
  hasUpdated: boolean;
  /** Cached analog X axis from the most recent update. */
  moveX: number;
  /** Cached analog Y axis from the most recent update. */
  moveY: number;
  /** Smash key / button held this update / the previous one. */
  smashButtonHeld: boolean;
  prevSmashButtonHeld: boolean;
  /** Smash stick binding held this update / the previous one. */
  smashStickHeld: boolean;
  prevSmashStickHeld: boolean;
  /** Stick direction of this update's smash sample (0, 0 when no stick is held). */
  smashX: number;
  smashY: number;
  /**
   * The `attackHeavy` value {@link buildCharacterInputFromResolver} sends
   * this update / the previous one (key held, or a fresh stick push). Its
   * rising edge is the fighter's heavy press; the dodge resolver reads it.
   */
  heavy: boolean;
  prevHeavy: boolean;
}

function makeNeutralSlotState(): SlotState {
  return {
    appealHeld: false,
    current: makeNeutralHeldRecord(),
    previous: makeNeutralHeldRecord(),
    hasUpdated: false,
    moveX: 0,
    moveY: 0,
    smashButtonHeld: false,
    prevSmashButtonHeld: false,
    smashStickHeld: false,
    prevSmashStickHeld: false,
    smashX: 0,
    smashY: 0,
    heavy: false,
    prevHeavy: false,
  };
}

// ---------------------------------------------------------------------------
// InputResolver
// ---------------------------------------------------------------------------

/**
 * Central per-player input resolver / action map.
 *
 * The single named service every gameplay consumer reads through —
 * fighters, AI overrides, the match HUD, the replay tagger, the lobby
 * confirm logic. Wraps the existing {@link DeviceInputDispatcher} +
 * binding-store stack and exposes the AC-named
 * `getAction(playerIndex, actionName)` API over the canonical seed
 * action vocabulary.
 *
 * Lifecycle:
 *
 *     // Construct against the existing dispatcher (which already reads
 *     // from the BindingsStore — the resolver doesn't poll devices on
 *     // its own, it composes the existing pieces):
 *     const resolver = new InputResolver({ dispatcher, slots: [1, 2, 3, 4] });
 *
 *     // Per fixed step: refresh the resolver's snapshots, then read.
 *     resolver.update(currentFrame);
 *
 *     const p1Jump = resolver.getAction(1, 'jump');
 *     if (p1Jump.justPressed) wolf.startJump();
 *
 *     if (resolver.isActionHeld(2, 'shield')) cat.holdShield();
 *
 *     const p3Move = resolver.getMoveVector(3);
 *     bear.applyMovement(p3Move.x, p3Move.y);
 *
 *     // Match teardown — release every cached action so the next scene
 *     // starts from a clean baseline.
 *     resolver.reset();
 *
 * Mutation of the underlying bindings store is fully supported
 * mid-session: because the dispatcher reads the store on every
 * sample, the very next `update()` will pick up the new bindings —
 * `justPressed` will fire if the new binding is held but the old one
 * was released. There is no explicit reload step.
 *
 * Determinism: the resolver holds exactly one mutable map per tracked
 * slot and rotates them inside `update()`. Outside `update()` the
 * resolver is a pure read surface; two queries with no `update()`
 * between them return identical results.
 */
export class InputResolver {
  private readonly dispatcher: DeviceInputDispatcher;
  private readonly slots: ReadonlyArray<PlayerIndex>;
  private readonly dodgeResolver: DodgeResolver;
  private readonly state: Map<PlayerIndex, SlotState>;
  private lastFrame = -1;

  constructor(options: InputResolverOptions) {
    if (options.dispatcher === null || options.dispatcher === undefined) {
      throw new Error(
        'InputResolver: options.dispatcher is required — the resolver cannot read inputs without a DeviceInputDispatcher.',
      );
    }
    this.dispatcher = options.dispatcher;
    this.slots = options.slots !== undefined ? Object.freeze([...options.slots]) : DEFAULT_SLOTS;
    this.dodgeResolver = options.dodgeResolver ?? defaultDodgeResolver;
    this.state = new Map<PlayerIndex, SlotState>();
    for (const slot of this.slots) {
      this.state.set(slot, makeNeutralSlotState());
    }
  }

  // -------------------------------------------------------------------------
  // Per-frame mutation
  // -------------------------------------------------------------------------

  /**
   * Refresh every tracked slot's held / edge state by sampling the
   * dispatcher once per slot. Should be called exactly once per fixed
   * step before any `getAction` / `isActionHeld` / `getMoveVector` read.
   *
   * The optional `frame` argument is recorded for debug / replay
   * diagnostics and forwarded onto {@link getLastFrame}; it does NOT
   * participate in edge detection (which is a pure diff between the
   * cached previous and current snapshots).
   *
   * Mid-match rebind handling: because the dispatcher always reads the
   * live binding profile when it samples actions, a rebind committed
   * before this call is fully visible — `justPressed` will fire if the
   * new binding is held but the old one was released.
   */
  update(frame: number = -1): void {
    for (const slot of this.slots) {
      const slotState = this.state.get(slot);
      /* istanbul ignore next — guaranteed by constructor seeding. */
      if (slotState === undefined) continue;

      // Rotate the maps: current → previous, reuse the previous buffer
      // for the new sample. Two-buffer rotation keeps allocations to
      // zero on the steady-state path.
      const buffer = slotState.previous;
      slotState.previous = slotState.current;
      slotState.current = buffer;

      // Sample every binding action through the dispatcher's legacy
      // schema. The dispatcher's `sampleActions(slot)` returns the
      // legacy {@link LogicalAction} bitmap; we fold it into the
      // canonical seed-named {@link ActionName} record.
      const held: ActionHeldMap = this.dispatcher.sampleActions(slot);
      slotState.current.moveLeft = held.left;
      slotState.current.moveRight = held.right;
      slotState.current.moveUp = held.up;
      slotState.current.moveDown = held.down;
      slotState.current.jump = held.jump;
      slotState.current.attack = held.attack;
      slotState.current.special = held.special;
      slotState.current.shield = held.shield;
      slotState.current.grab = held.grab;
      slotState.appealHeld = held.appeal === true;

      // Cache the analog axes for `getMoveVector`. The dispatcher
      // produces digital `-1 | 0 | +1` for keyboard slots and analog
      // stick magnitude for gamepad slots; either way the cached value
      // is what {@link getMoveVector} returns this frame.
      const moveX = this.dispatcher.sampleMoveX(slot);
      const moveY = this.dispatcher.sampleMoveY(slot);
      slotState.moveX = moveX;
      slotState.moveY = moveY;

      // Smash: key / button and stick tracked apart (the first update
      // is its own baseline, so nothing already held reads as a press).
      const smash = this.dispatcher.sampleSmash(slot);
      const baseline = !slotState.hasUpdated;
      slotState.prevSmashButtonHeld = baseline ? smash.buttonHeld : slotState.smashButtonHeld;
      slotState.prevSmashStickHeld = baseline ? smash.fromStick : slotState.smashStickHeld;
      slotState.smashButtonHeld = smash.buttonHeld;
      slotState.smashStickHeld = smash.fromStick;
      slotState.smashX = smash.x;
      slotState.smashY = smash.y;
      const heavy = smash.buttonHeld || (smash.fromStick && !slotState.prevSmashStickHeld);
      slotState.prevHeavy = baseline ? heavy : slotState.heavy;
      slotState.heavy = heavy;

      // Resolve dodge through the configured resolver, using the
      // freshly-sampled directional + shield state. The resolver
      // receives the same {@link DodgeResolverContext} shape the
      // unified {@link InputService} produces so a custom resolver
      // written for one consumer drops in here unchanged.
      const move: MoveVector =
        moveX === 0 && moveY === 0 ? MOVE_NEUTRAL : Object.freeze({ x: moveX, y: moveY });
      // The smash split the fighter sees: a key / button held, and the
      // stick direction only on the stick's own press frame (the frame
      // `attackStickX / Y` carry it; see buildCharacterInputFromResolver).
      const smashStickPressed = slotState.smashStickHeld && !slotState.prevSmashStickHeld;
      slotState.current.dodge = this.dodgeResolver({
        slot,
        move,
        jump: slotState.current.jump,
        attack: slotState.current.attack,
        special: slotState.current.special,
        shield: slotState.current.shield,
        grab: slotState.current.grab,
        held,
        smashPressed: slotState.heavy && !slotState.prevHeavy,
        smashButtonHeld: slotState.smashButtonHeld,
        smashStick: smashStickPressed ? Object.freeze({ x: smash.x, y: smash.y }) : MOVE_NEUTRAL,
      });

      // First update establishes the baseline: copy the freshly-sampled
      // `current` into `previous` so the next round of edge-detection
      // queries reads the diff cleanly. Without this, a fighter spawned
      // with shield held would fire a phantom `justPressed('shield')`
      // on the very first read (because the released → held diff sees
      // the initial all-false `previous` map). Same convention the
      // {@link InputBindingManager} follows when its slot snapshots are
      // first seeded at construction.
      if (!slotState.hasUpdated) {
        for (const action of ACTION_NAMES) {
          slotState.previous[action] = slotState.current[action];
        }
        slotState.hasUpdated = true;
      }
    }

    this.lastFrame = frame;
  }

  /**
   * Force-release every cached action for every tracked slot and
   * reset the previous-frame snapshots to neutral. After `reset()`,
   * every `justPressed` / `justReleased` query returns `false` until
   * the *second* post-reset `update()` (the first establishes a
   * previous-frame baseline). Used by:
   *
   *   • Match teardown — a fighter walking away mid-press shouldn't
   *     leak their held state into the next match.
   *   • Replay scrubbing — the VCR layer calls this when the playhead
   *     jumps so the resolver's edge detection re-establishes from
   *     the destination frame.
   *   • Controller-disconnect pause — disconnecting clears every
   *     cached held action; reconnecting lets the next `update()`
   *     re-press whatever's actually held on the resumed pad.
   */
  reset(): void {
    for (const slotState of this.state.values()) {
      for (const action of ACTION_NAMES) {
        slotState.current[action] = false;
        slotState.previous[action] = false;
      }
      slotState.hasUpdated = false;
      slotState.appealHeld = false;
      slotState.moveX = 0;
      slotState.moveY = 0;
      slotState.smashButtonHeld = false;
      slotState.prevSmashButtonHeld = false;
      slotState.smashStickHeld = false;
      slotState.prevSmashStickHeld = false;
      slotState.smashX = 0;
      slotState.smashY = 0;
      slotState.heavy = false;
      slotState.prevHeavy = false;
    }
    this.lastFrame = -1;
    resolverDropThroughLatches.delete(this);
  }

  /** Actual cached device edges at an authoritative checkpoint. Rebuilding
   * resolved fighter inputs alone cannot reconstruct C-stick/down-tap edges. */
  captureHistoryState(): InputResolverHistoryState {
    const latches = resolverDropThroughLatches.get(this);
    return parseInputResolverHistoryState({schema:'input-resolver-history/1',lastFrame:this.lastFrame,
      slots:[...this.state].map(([slot,state])=>({slot,state:{...state,current:{...state.current},previous:{...state.previous}},
        dropThrough:latches?.has(slot)?{...latches.get(slot)!,lastDownPressFrame:
          Number.isFinite(latches.get(slot)!.lastDownPressFrame)?latches.get(slot)!.lastDownPressFrame:null}:null}))});
  }

  restoreHistoryState(value:unknown):void {
    const snapshot=parseInputResolverHistoryState(value);
    if(snapshot.slots.length!==this.slots.length||snapshot.slots.some((row,index)=>row.slot!==this.slots[index]))
      throw new TypeError('Input history must match the actual resolver slot order');
    const latches=new Map<PlayerIndex,ResolverDropThroughLatch>();
    for(const row of snapshot.slots){this.state.set(row.slot,{...row.state,current:{...row.state.current},previous:{...row.state.previous}});
      if(row.dropThrough)latches.set(row.slot,{...row.dropThrough,lastDownPressFrame:row.dropThrough.lastDownPressFrame??-Infinity});}
    resolverDropThroughLatches.set(this,latches);this.lastFrame=snapshot.lastFrame;
  }

  // -------------------------------------------------------------------------
  // Read API — the AC-named entry points
  // -------------------------------------------------------------------------

  /**
   * **The AC-named entry point.** Read the per-action state for a
   * single player slot and action. Returns a frozen
   * {@link ActionState} carrying the full picture (`held`,
   * `justPressed`, `justReleased`) so a single call covers the
   * gameplay-side per-frame decision (start move on press, hold on
   * held, release on falling edge).
   *
   * Reading a slot the resolver is not tracking returns
   * {@link NEUTRAL_ACTION_STATE} — calling code can iterate every
   * possible slot without per-slot guards. Likewise, before the first
   * `update()`, every slot returns the neutral record (no live state
   * sampled yet).
   *
   * The resolver caches per-slot prev/curr snapshots, so repeated
   * `getAction(player, action)` calls within the same frame return
   * byte-identical records — a fighter's per-step controller can
   * branch on `getAction(...).held` and an AI override can branch on
   * `getAction(...).justPressed` without two separate samples
   * disagreeing.
   */
  getAction(playerIndex: PlayerIndex, actionName: ActionName): ActionState {
    const slotState = this.state.get(playerIndex);
    if (slotState === undefined || !slotState.hasUpdated) {
      return NEUTRAL_ACTION_STATE;
    }
    const held = slotState.current[actionName];
    const wasHeld = slotState.previous[actionName];
    const justPressed = held && !wasHeld;
    const justReleased = !held && wasHeld;
    if (!held && !justPressed && !justReleased) {
      // Steady-state released path — return the shared singleton so
      // the steady-state read doesn't allocate.
      return NEUTRAL_ACTION_STATE;
    }
    return Object.freeze({ held, justPressed, justReleased });
  }

  /**
   * Convenience boolean accessor — `getAction(player, action).held`
   * without the struct allocation. Use this when only the held bit
   * matters (e.g. a fighter's `isShielding()` predicate).
   */
  isActionHeld(playerIndex: PlayerIndex, actionName: ActionName): boolean {
    const slotState = this.state.get(playerIndex);
    if (slotState === undefined || !slotState.hasUpdated) return false;
    return slotState.current[actionName];
  }

  /**
   * Convenience edge accessor — `true` iff the action transitioned
   * released → held between the previous and current updates.
   * Equivalent to `getAction(player, action).justPressed` without the
   * struct allocation.
   *
   * Returns `false` before the second `update()` — there is no
   * previous-frame baseline to diff against.
   */
  wasJustPressed(playerIndex: PlayerIndex, actionName: ActionName): boolean {
    const slotState = this.state.get(playerIndex);
    if (slotState === undefined || !slotState.hasUpdated) return false;
    return slotState.current[actionName] && !slotState.previous[actionName];
  }

  /**
   * Convenience edge accessor — `true` iff the action transitioned
   * held → released between the previous and current updates.
   * Equivalent to `getAction(player, action).justReleased` without
   * the struct allocation.
   *
   * Returns `false` before the second `update()` — there is no
   * previous-frame baseline.
   */
  wasJustReleased(playerIndex: PlayerIndex, actionName: ActionName): boolean {
    const slotState = this.state.get(playerIndex);
    if (slotState === undefined || !slotState.hasUpdated) return false;
    return !slotState.current[actionName] && slotState.previous[actionName];
  }

  /**
   * Read the slot's analog 2D move vector — the same vector the
   * unified {@link InputService.sampleMove} produces. Keyboard slots
   * report digital `-1 | 0 | +1` per axis; gamepad slots report the
   * analog stick magnitude. Returns the {@link MOVE_NEUTRAL}
   * singleton when both axes are zero so a stationary slot doesn't
   * allocate a fresh record every frame.
   *
   * Reading a slot the resolver is not tracking returns
   * {@link MOVE_NEUTRAL}; before the first `update()`, every tracked
   * slot returns {@link MOVE_NEUTRAL}.
   */
  getMoveVector(playerIndex: PlayerIndex): MoveVector {
    const slotState = this.state.get(playerIndex);
    if (slotState === undefined || !slotState.hasUpdated) return MOVE_NEUTRAL;
    if (slotState.moveX === 0 && slotState.moveY === 0) return MOVE_NEUTRAL;
    return Object.freeze({ x: slotState.moveX, y: slotState.moveY });
  }

  /**
   * Read the slot's `smash` action: held / edge state like
   * {@link getAction}, plus the key / button and stick sources on their
   * own and the 4-way stick direction (see {@link SmashState}). Same
   * baseline rule — no edges before the second `update()`, neutral for
   * untracked slots.
   */
  getAppeal(playerIndex: PlayerIndex): boolean {
    return this.state.get(playerIndex)?.appealHeld ?? false;
  }

  getSmash(playerIndex: PlayerIndex): SmashState {
    const slotState = this.state.get(playerIndex);
    if (slotState === undefined || !slotState.hasUpdated) return NEUTRAL_SMASH_STATE;
    const held = slotState.smashButtonHeld || slotState.smashStickHeld;
    const wasHeld = slotState.prevSmashButtonHeld || slotState.prevSmashStickHeld;
    if (!held && !wasHeld) return NEUTRAL_SMASH_STATE;
    return Object.freeze({
      held,
      justPressed: held && !wasHeld,
      justReleased: !held && wasHeld,
      buttonHeld: slotState.smashButtonHeld,
      fromStick: slotState.smashStickHeld,
      stickJustPressed: slotState.smashStickHeld && !slotState.prevSmashStickHeld,
      x: slotState.smashX,
      y: slotState.smashY,
    });
  }

  // -------------------------------------------------------------------------
  // Introspection
  // -------------------------------------------------------------------------

  /**
   * The dispatcher this resolver queries. Exposed so production wiring
   * can share one dispatcher across the resolver and the
   * {@link InputBindingManager} subscriber path — a single device poll
   * per fixed step feeds both.
   */
  getDispatcher(): DeviceInputDispatcher {
    return this.dispatcher;
  }

  /**
   * The frozen list of slots this resolver tracks. A consumer that
   * wants to render "every active player's HUD" can iterate this to
   * know which slots will produce non-neutral states, without
   * defaulting to all four.
   */
  getTrackedSlots(): ReadonlyArray<PlayerIndex> {
    return this.slots;
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
   * Per-action snapshot of one slot's current held state. Frozen on
   * the way out so a caller can compare two snapshots structurally
   * without worrying about a future `update()` mutating either.
   *
   * Allocates a fresh record per call; reserve for tests / debug
   * overlays / replay logging that want a wholesale dump of the
   * resolver's state at a specific frame. The per-action read methods
   * are zero-allocation on the steady-state released path.
   */
  snapshotSlot(playerIndex: PlayerIndex): Readonly<ActionHeldRecord> {
    const slotState = this.state.get(playerIndex);
    if (slotState === undefined) return Object.freeze(makeNeutralHeldRecord());
    return Object.freeze({ ...slotState.current });
  }
}

// ---------------------------------------------------------------------------
// Public alias — the AC's "ActionMap" name on the same class
// ---------------------------------------------------------------------------

/**
 * Public alias under the AC's other named identifier.
 *
 * AC 50201 Sub-AC 1 calls the central component "InputResolver /
 * ActionMap" — two names for the same object. The bare `ActionMap`
 * identifier is already taken by the per-action *binding-config* type
 * in `src/types/bindings.ts` (the per-action lookup of {@link
 * InputBinding}s the rebinding store mutates) — so we expose this
 * runtime entry point under {@link PlayerActionMap} to avoid the
 * collision while still surfacing the AC's named vocabulary. The
 * alias is the same class — no wrapping, no duplicate state.
 *
 * Pick the name that best describes the call-site's intent:
 *
 *   • {@link InputResolver} — runtime poll semantics ("resolve the
 *     active per-player action state from the live binding profile +
 *     device state").
 *   • {@link PlayerActionMap} — lookup semantics ("look up the state
 *     of (player, action) by key").
 */
export const PlayerActionMap = InputResolver;
/** Type alias mirroring the {@link PlayerActionMap} runtime alias. */
export type PlayerActionMap = InputResolver;

// ---------------------------------------------------------------------------
// Re-exports for ergonomics
// ---------------------------------------------------------------------------

/**
 * Re-export of the dodge directional threshold so callers iterating
 * through the resolver surface can reason about the resolver's
 * contract without also pulling in {@link InputService}. Same `0.5`
 * the dispatcher uses for its half-axis threshold.
 */
export { DODGE_DIRECTIONAL_THRESHOLD };

/**
 * Re-exported for ergonomics so a consumer that constructs a custom
 * dodge resolver only needs to import from the resolver module.
 */
export { defaultDodgeResolver };
export type { DodgeResolver, MoveVector };

// Re-export {@link PlayerBindingsIndex} as the legacy alias for
// callers (e.g. test fixtures) that still hold a reference under the
// older name. The two are identical types — pure re-export.
export type { PlayerBindingsIndex };

// ---------------------------------------------------------------------------
// CharacterInput translator (AC 50202 Sub-AC 2)
// ---------------------------------------------------------------------------

/**
 * Build the per-frame {@link CharacterInput} record the gameplay runtime
 * (`Character.applyInput`) consumes, sourcing every action from the
 * central {@link InputResolver} for the supplied `playerIndex`.
 *
 * AC 50202 Sub-AC 2 — every gameplay input consumer (player movement /
 * jump logic, attack and special triggers, shield / grab / dodge
 * handlers) reads inputs through this helper rather than touching raw
 * key codes, gamepad button indices, or the legacy
 * {@link InputService.sampleCharacterInput} adapter that bypassed the
 * unified resolver. All eight action categories the Seed names —
 *
 *   • `moveLeft` / `moveRight` / `moveUp` / `moveDown` (folded into
 *     `moveX` and `dropThrough` via the resolver's
 *     {@link InputResolver.getMoveVector} helper),
 *   • `jump`,
 *   • `attack`,
 *   • `special` (also exposed as its own field for the future
 *     dedicated heavy-press handler),
 *   • `shield`,
 *   • `grab`,
 *   • `dodge` (derived from the resolver's configured dodge resolver —
 *     default chord: shield + directional)
 *
 * — flow through the rebindable binding layer here. The runtime never
 * reads device state directly; every per-step gameplay decision is a
 * pure function of the resolver's snapshot, which is itself a pure
 * function of the dispatcher's per-frame poll, which reads the live
 * binding profile via the {@link DeviceInputDispatcher}.
 *
 * Sample lifecycle:
 *
 *     // Once per fixed step:
 *     resolver.update(frame);
 *     for (const slot of activeSlots) {
 *       const input = buildCharacterInputFromResolver(resolver, slot);
 *       fighter.applyInput(input);
 *     }
 *
 * Determinism: pure shape-translation over the resolver's snapshot. Two
 * calls on the same resolver without an intervening `update()` return
 * byte-identical records. The result is frozen on the way out so
 * consumers can stash references for replay capture without worrying
 * about a future poll mutating their copy.
 *
 * For an untracked slot the resolver returns the
 * {@link NEUTRAL_ACTION_STATE} for every query and {@link MOVE_NEUTRAL}
 * for the move vector — the helper consequently builds an all-released
 * neutral {@link CharacterInput}, matching the legacy behaviour where
 * an unconfigured slot produced a neutral record without crashing.
 */
/**
 * Per-slot edge-history for the double-tap-down drop-through detector.
 * Resolver-owned weak registry because the translator is a free function.
 * Reset and authoritative checkpoint transport retain the same ownership.
 *
 * Same window length as `DeviceInputDispatcher`'s detector so the two
 * input paths produce identical drop-through gestures.
 */
const DROP_THROUGH_DOUBLE_TAP_WINDOW_FRAMES = 12;
interface ResolverDropThroughLatch {
  prevDown: boolean;
  lastDownPressFrame: number;
  frameCounter: number;
}
const resolverDropThroughLatches = new WeakMap<InputResolver, Map<PlayerIndex, ResolverDropThroughLatch>>();

export interface InputResolverHistoryState {
  readonly schema:'input-resolver-history/1';readonly lastFrame:number;
  readonly slots:readonly {readonly slot:PlayerIndex;readonly state:SlotState;
    readonly dropThrough:{readonly prevDown:boolean;readonly lastDownPressFrame:number|null;readonly frameCounter:number}|null}[];
}
const historyBooleanFields=['appealHeld','hasUpdated','smashButtonHeld','prevSmashButtonHeld','smashStickHeld','prevSmashStickHeld','heavy','prevHeavy'] as const;
const historyAxisFields=['moveX','moveY','smashX','smashY'] as const;
function historyClosed(value:unknown,keys:readonly string[]):Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))
    throw new TypeError('Invalid closed actual input history');
  return value as Record<string,unknown>;
}
export function parseInputResolverHistoryState(value:unknown):InputResolverHistoryState {
  const root=historyClosed(value,['schema','lastFrame','slots']);
  if(root.schema!=='input-resolver-history/1'||typeof root.lastFrame!=='number'||!Number.isSafeInteger(root.lastFrame)||root.lastFrame< -1||
    !Array.isArray(root.slots)||!root.slots.length||root.slots.length>4)throw new TypeError('Invalid actual input frame/slots');
  const slots=root.slots.map(value=>{const row=historyClosed(value,['slot','state','dropThrough']);
    if(![1,2,3,4].includes(row.slot as number))throw new TypeError('Invalid actual input slot');
    const state=historyClosed(row.state,['current','previous',...historyBooleanFields,...historyAxisFields]);
    for(const key of historyBooleanFields)if(typeof state[key]!=='boolean')throw new TypeError('Invalid input held history');
    for(const key of historyAxisFields)if(typeof state[key]!=='number'||!Number.isFinite(state[key])||Math.abs(state[key] as number)>1)
      throw new TypeError('Invalid input axis history');
    const action=(value:unknown)=>{const r=historyClosed(value,ACTION_NAMES);for(const key of ACTION_NAMES)if(typeof r[key]!=='boolean')
      throw new TypeError('Invalid action edge history');return {...r} as ActionHeldRecord;};
    let dropThrough:InputResolverHistoryState['slots'][number]['dropThrough']=null;
    if(row.dropThrough!==null){const d=historyClosed(row.dropThrough,['prevDown','lastDownPressFrame','frameCounter']);
      if(typeof d.prevDown!=='boolean'||typeof d.frameCounter!=='number'||!Number.isSafeInteger(d.frameCounter)||d.frameCounter<1||
        (d.lastDownPressFrame!==null&&(typeof d.lastDownPressFrame!=='number'||!Number.isSafeInteger(d.lastDownPressFrame)||
          d.lastDownPressFrame<0||d.lastDownPressFrame>=d.frameCounter)))throw new TypeError('Invalid down-tap history');
      dropThrough={prevDown:d.prevDown,lastDownPressFrame:d.lastDownPressFrame as number|null,frameCounter:d.frameCounter};}
    const normalized={...state,current:action(state.current),previous:action(state.previous)} as unknown as SlotState;
    if(normalized.heavy!==(normalized.smashButtonHeld||(normalized.smashStickHeld&&!normalized.prevSmashStickHeld))||
      (!normalized.hasUpdated&&(historyBooleanFields.some(key=>key!=='hasUpdated'&&normalized[key])||
        historyAxisFields.some(key=>normalized[key]!==0)||ACTION_NAMES.some(key=>normalized.current[key]||normalized.previous[key])||dropThrough!==null)))
      throw new TypeError('Inconsistent actual input edge baseline');
    return {slot:row.slot as PlayerIndex,state:normalized,dropThrough};});
  if(new Set(slots.map(row=>row.slot)).size!==slots.length)throw new TypeError('Duplicate actual input history slot');
  return {schema:'input-resolver-history/1',lastFrame:root.lastFrame,slots};
}

export function buildCharacterInputFromResolver(
  resolver: InputResolver,
  playerIndex: PlayerIndex,
): CharacterInput {
  const move = resolver.getMoveVector(playerIndex);
  const jump = resolver.isActionHeld(playerIndex, 'jump');
  const attack = resolver.isActionHeld(playerIndex, 'attack');
  const special = resolver.isActionHeld(playerIndex, 'special');
  const grab = resolver.isActionHeld(playerIndex, 'grab');
  const shield = resolver.isActionHeld(playerIndex, 'shield');
  const dodge = resolver.isActionHeld(playerIndex, 'dodge');
  const moveDown = resolver.isActionHeld(playerIndex, 'moveDown');
  // Drop-through is now a rapid double-tap of the down action — the
  // prior `down + jump` chord clobbered ordinary fast-falls. A held-
  // down (no rising edge) never fires, so a player crouching can't
  // accidentally drop through.
  const latches=resolverDropThroughLatches.get(resolver)??new Map<PlayerIndex,ResolverDropThroughLatch>();
  resolverDropThroughLatches.set(resolver,latches);
  const dropLatch =
    latches.get(playerIndex) ??
    { prevDown: false, lastDownPressFrame: -Infinity, frameCounter: 0 };
  const downRisingEdge = moveDown && !dropLatch.prevDown;
  const sinceLastDownPress = dropLatch.frameCounter - dropLatch.lastDownPressFrame;
  const isDoubleTapDown =
    downRisingEdge && sinceLastDownPress <= DROP_THROUGH_DOUBLE_TAP_WINDOW_FRAMES;
  if (downRisingEdge) {
    dropLatch.lastDownPressFrame = isDoubleTapDown ? -Infinity : dropLatch.frameCounter;
  }
  dropLatch.prevDown = moveDown;
  dropLatch.frameCounter += 1;
  latches.set(playerIndex, dropLatch);
  // The dedicated `smash` action feeds `attackHeavy` (never `special`,
  // which has its own dispatch). A key / button smash is sent HELD so
  // holding it charges the smash like holding attack does. A stick
  // smash is Ultimate's C-stick: one press on the frame the stick
  // leaves neutral (the charge releases next frame, uncharged) with its
  // snapped direction in `attackStickX/Y`. The direction travels in its
  // own fields so moveX / moveY stay the left stick — writing the right
  // stick there would also drive dash, drift, fast-fall and DI.
  // The two sources combine as `buttonHeld || stickJustPressed`, the
  // stick edge coming from stick history alone: pushing the stick while
  // the key charges neither drops the held value (an early release) nor,
  // when the stick returns, re-raises it (a phantom second press).
  const smash = resolver.getSmash(playerIndex);
  const stickSmashStart = smash.stickJustPressed;
  const attackHeavy = smash.buttonHeld || stickSmashStart;
  return Object.freeze({
    moveX: move.x,
    // Vertical stick — consumed by the fast-fall latch, DI, and the
    // up/down item-throw direction. Same canvas-Y convention as the
    // resolver's move vector (down = positive).
    moveY: move.y,
    jump,
    attack,
    special,
    appeal: resolver.getAppeal(playerIndex),
    grab,
    shield,
    dodge,
    dropThrough: isDoubleTapDown,
    attackHeavy,
    attackStickX: stickSmashStart ? smash.x : 0,
    attackStickY: stickSmashStart ? smash.y : 0,
  });
}
