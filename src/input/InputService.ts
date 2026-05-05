/**
 * Unified input service / action resolver — AC 40101 Sub-AC 1.
 *
 * Purpose
 * -------
 *
 * Earlier sub-ACs of the M5 rebinding stack landed:
 *
 *   • The {@link BindingsStore} (the four-slot persistent profile facade
 *     over `localStorage` + the in-memory data model).
 *   • The {@link DeviceInputDispatcher} (stateless polling that resolves a
 *     {@link PlayerBindings} table against live keyboard / gamepad
 *     state).
 *   • The {@link InputBindingManager} (event-driven press/release diffing
 *     for menus, the rebinding capture screen, and replay tagging).
 *
 * What was missing was a *single, named* per-frame read surface that the
 * gameplay scene, AI runtime, and replay capture all use to read the
 * **same vocabulary** the Seed describes — `move / jump / attack / special
 * / shield / grab / dodge` — without each consumer needing to know:
 *
 *   1. Which device family the slot is using (keyboard vs. gamepad).
 *   2. How to combine `moveLeft`/`moveRight`/`moveUp`/`moveDown` into a
 *      single `move` vector with analog magnitude on a stick.
 *   3. How to derive a defensive `dodge` press from the active bindings
 *      while the rebinding-screen migration to the canonical
 *      `dodge` action is still in flight.
 *
 * `InputService` is that surface. It composes the existing pieces (it
 * does **not** re-implement device polling or binding lookup) and resolves
 * a per-slot {@link UnifiedActionState} record on demand. The match scene
 * can swap its existing `LocalInputHandler.sample(slot)` call site for a
 * single `inputService.resolve(slot)` and get a richer, device-agnostic
 * record back — keyboard slots produce digital -1/0/+1 movement; gamepad
 * slots produce analog stick magnitude; the rest of the action surface is
 * identical.
 *
 * Architecture
 * ------------
 *
 *   raw keyboard / gamepad state
 *           │
 *   DeviceInputDispatcher  ◄── BindingsStore / PlayerBindingsProvider
 *           │  per-frame ActionHeldMap / sampleMoveX / sampleMoveY
 *           ▼
 *   InputService          ──── per-slot UnifiedActionState
 *           │
 *   gameplay scene • AI runtime • replay capture
 *
 * The dispatcher remains the only thing that knows about device
 * specifics. The service is a pure shape-translator: it asks the
 * dispatcher for the held bitmap, asks for the analog `moveX`/`moveY`,
 * then produces a unified record whose vocabulary matches the Seed's
 * action API word-for-word.
 *
 * Determinism
 * -----------
 *
 *   • Stateless by design — the service holds no internal frame
 *     bookkeeping. Two `resolve(slot)` calls with the same source state
 *     return identical records, byte-for-byte. The replay capture layer
 *     can record the resolved record and feed it back through a
 *     replay-driven provider without drift.
 *   • No `Math.random()`, no wall-clock reads, no Phaser. All clamping
 *     and chord-detection is pure arithmetic on the dispatcher's output.
 *   • The default `dodge` resolver is a deterministic chord function
 *     (`shield + (move !== zero)`) — the same input bitmap always
 *     resolves to the same `dodge` boolean.
 *
 * Why a *separate* module instead of folding into the dispatcher
 * --------------------------------------------------------------
 *
 *   1. **Stable consumer vocabulary.** The dispatcher's output uses the
 *      legacy {@link LogicalAction} set (`left | right | up | down |
 *      jump | attack | special | shield | grab | taunt`) which mirrors
 *      the rebinding-store schema. The Seed's action API is
 *      `move / jump / attack / special / shield / grab / dodge` — the
 *      service translates between the two so a downstream rename of
 *      `LogicalAction` doesn't ripple through the entire game.
 *   2. **Pluggable dodge derivation.** While the canonical bindings
 *      schema (`src/types/bindings.ts`) already includes `dodge` as a
 *      first-class action, the active runtime store still uses the
 *      legacy schema. The {@link InputServiceOptions.dodgeResolver}
 *      hook lets a future sub-AC migrate dodge to a real binding lookup
 *      without changing every consumer of {@link UnifiedActionState}.
 *   3. **Test seam.** Decoupling the unified API from the dispatcher
 *      lets the unit suite hand the service a synthetic dispatcher and
 *      assert the shape contract independently of device polling.
 *
 * Strict TypeScript
 * -----------------
 *
 * Compiled under `noUncheckedIndexedAccess + strict`. The exhaustive
 * switch on the {@link UnifiedActionName} union and the `as const`
 * action lists keep subscribers from forgetting an action when they
 * branch on the action name.
 */

import {
  LOGICAL_ACTIONS,
  type LogicalAction,
  type PlayerBindingsIndex,
} from '../types/inputBindings';
import {
  DeviceInputDispatcher,
  type ActionHeldMap,
  type GamepadSource,
  type PlayerBindingsProvider,
} from './DeviceInputDispatcher';
import type { InputBindingsStore } from './InputBindingsStore';
import type { KeyboardSource } from './LocalInputHandler';
import type { BindingsStore } from './BindingsStore';
import type { CharacterInput } from '../characters/Character';

// ---------------------------------------------------------------------------
// Public action vocabulary
// ---------------------------------------------------------------------------

/**
 * Frozen, ordered list of every *button-style* action the unified API
 * exposes. Movement is *not* in this list — it is a vector, not a
 * boolean — and is exposed separately on {@link UnifiedActionState.move}.
 * The order is the canonical iteration order: jump first (every fighter
 * needs to jump before they can do anything else), then offensive
 * (attack / special / grab), then defensive (shield / dodge).
 *
 * Why a `const` array instead of an `enum`:
 *
 *   • The Seed forbids non-deterministic state in the gameplay path. A
 *     literal-typed `as const` array gives both the runtime iteration
 *     UIs / validators need *and* the union type
 *     {@link UnifiedActionName} derived from `(typeof
 *     UNIFIED_ACTION_NAMES)[number]`. No reverse-lookup map, no
 *     auto-incrementing numeric ids that would couple wire formats to
 *     declaration order.
 *   • Replay payloads serialise the *string* identifier; reordering or
 *     extending this array can never invalidate an older replay as long
 *     as the action names are preserved.
 */
export const UNIFIED_ACTION_NAMES = [
  'jump',
  'attack',
  'special',
  'grab',
  'shield',
  'dodge',
] as const;

/**
 * Discriminator for every button-style action the unified API exposes.
 * Movement (`move`) is not in this union — it is a vector, queried via
 * {@link InputService.resolve} or {@link InputService.sampleMove}.
 */
export type UnifiedActionName = (typeof UNIFIED_ACTION_NAMES)[number];

/**
 * Two-axis movement vector. Both components live in `[-1, 1]`:
 *
 *   • Keyboard slots produce digital `-1 | 0 | +1` per axis (left and
 *     right cancel out, up and down cancel out — the simplest and most
 *     predictable behaviour for a digital input).
 *   • Gamepad slots produce the analog stick magnitude (`x` derived
 *     from the larger-magnitude `moveLeft`/`moveRight` half-axis,
 *     `y` from `moveUp`/`moveDown`). A half-pushed stick produces
 *     `~ 0.6`; full deflection produces `1`.
 *
 * Sign convention matches the rest of the engine and the W3C Gamepad
 * API: `y < 0` is up (matching the canvas Y axis), `y > 0` is down.
 *
 * `Object.freeze`-ed on the way out so consumers can keep references
 * without worrying about a future poll mutating the same record. The
 * {@link MOVE_NEUTRAL} constant is reused when both axes are zero so a
 * stationary fighter doesn't allocate a fresh vector every frame.
 */
export interface MoveVector {
  readonly x: number;
  readonly y: number;
}

/**
 * Frozen "stick at neutral" vector. Returned by the service when both
 * axes are zero so a stationary slot doesn't allocate a fresh record
 * every frame — handy for the gameplay loop's per-step churn budget.
 */
export const MOVE_NEUTRAL: MoveVector = Object.freeze({ x: 0, y: 0 });

/**
 * Per-slot resolved action record — the unified API surface the Seed
 * describes word-for-word. Every field is a deterministic function of
 * the current binding profile + live device state for the named slot.
 *
 * Field semantics:
 *
 *   • `slot` — the player slot the record describes (1–4). Carried in
 *     the record so consumers can pass a {@link UnifiedActionState}
 *     around as a self-contained unit (e.g. into a replay logger that
 *     doesn't separately track which slot it is).
 *
 *   • `move` — see {@link MoveVector}. Combines `moveLeft` /
 *     `moveRight` / `moveUp` / `moveDown` per the device family.
 *
 *   • `jump` / `attack` / `special` / `shield` / `grab` — held state of
 *     the corresponding binding for the slot. Multi-bind lists OR
 *     together (any binding held → action held); empty lists report
 *     released. Mirrors the dispatcher's contract.
 *
 *   • `dodge` — held state of the dodge gesture. Resolved by the
 *     configured {@link DodgeResolver} (default: shield + any
 *     directional held — the canonical Smash Bros spot/roll/air-dodge
 *     chord). Once the rebinding store migrates to the canonical
 *     `dodge` action, the default resolver will switch to a direct
 *     binding lookup; consumers do not have to change.
 */
export interface UnifiedActionState {
  readonly slot: PlayerBindingsIndex;
  readonly move: MoveVector;
  readonly jump: boolean;
  readonly attack: boolean;
  readonly special: boolean;
  readonly shield: boolean;
  readonly grab: boolean;
  readonly dodge: boolean;
}

// ---------------------------------------------------------------------------
// Dodge resolver
// ---------------------------------------------------------------------------

/**
 * Context handed to a {@link DodgeResolver} so it can compute a `dodge`
 * boolean from the rest of the resolved state. Carries everything the
 * resolver might want without forcing it to re-query the dispatcher
 * (which would be wasteful and would invite divergence).
 *
 * `held` is the raw legacy {@link ActionHeldMap} the dispatcher emits —
 * exposed so a future resolver can react to a real `dodge` action key
 * once the rebinding-store schema gains one.
 */
export interface DodgeResolverContext {
  readonly slot: PlayerBindingsIndex;
  readonly move: MoveVector;
  readonly jump: boolean;
  readonly attack: boolean;
  readonly special: boolean;
  readonly shield: boolean;
  readonly grab: boolean;
  /** Raw held bitmap from the dispatcher — for resolvers that need legacy actions. */
  readonly held: ActionHeldMap;
}

/**
 * Function that derives the `dodge` boolean from a partially-resolved
 * action record. Pure — must not read `Date.now()`, `Math.random()`,
 * or any global state. Same inputs → same outputs (the determinism
 * contract).
 *
 * The default resolver — {@link defaultDodgeResolver} — implements the
 * classic platform-fighter chord: dodge fires when the player is
 * holding shield AND any directional input. This produces:
 *
 *   • shield + neutral stick → standing shield (dodge = false)
 *   • shield + left/right    → roll-dodge          (dodge = true)
 *   • shield + down          → spot-dodge          (dodge = true)
 *   • shield + up            → wave/air-dodge      (dodge = true)
 *
 * A future sub-AC that adds a first-class `dodge` action to the
 * rebinding store will provide an alternative resolver that does a
 * direct binding lookup; the consumer-facing
 * {@link UnifiedActionState.dodge} field stays the same.
 */
export type DodgeResolver = (ctx: DodgeResolverContext) => boolean;

/**
 * Magnitude (in absolute value) above which a {@link MoveVector}
 * component counts as "intentional movement" for the purpose of
 * dodge-chord detection. Matches the dispatcher's default 0.5 axis
 * threshold so a stick at the binding's threshold reads as "directional
 * input" exactly when the dispatcher reports any of the four `move*`
 * half-axes as held.
 *
 * Exposed as a constant so the unit test suite can assert against the
 * exact same value the production resolver uses.
 */
export const DODGE_DIRECTIONAL_THRESHOLD = 0.5;

/**
 * Default {@link DodgeResolver}. Returns `true` iff:
 *
 *   • The shield action is currently held, AND
 *   • Either component of the move vector exceeds
 *     {@link DODGE_DIRECTIONAL_THRESHOLD} in magnitude.
 *
 * The shield-held requirement preserves the "shield is the gateway to
 * defensive options" mental model from Smash Bros — players can hold
 * shield to safely position before committing to a roll/spot dodge by
 * tilting the stick.
 *
 * Pure function — exported standalone so consumers that want to compose
 * with a custom rule (e.g. "also fire dodge if a dedicated dodge
 * binding is held once that lands") can call this as the fallback.
 */
export function defaultDodgeResolver(ctx: DodgeResolverContext): boolean {
  if (!ctx.shield) return false;
  const xMag = ctx.move.x < 0 ? -ctx.move.x : ctx.move.x;
  const yMag = ctx.move.y < 0 ? -ctx.move.y : ctx.move.y;
  return xMag >= DODGE_DIRECTIONAL_THRESHOLD || yMag >= DODGE_DIRECTIONAL_THRESHOLD;
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

/**
 * Source of {@link PlayerBindings} the service should consult each
 * frame. The AC mandates "queries the per-player BindingsStore each
 * frame" — accepting any of the three concrete shapes lets callers wire
 * the service against:
 *
 *   • The persistent {@link BindingsStore} facade (the production path —
 *     the lobby + rebinding UI write through this so changes auto-save
 *     and the next service read picks them up immediately).
 *   • The bare {@link InputBindingsStore} data model (replay playback
 *     and tests skip persistence and want the lighter surface).
 *   • Any {@link PlayerBindingsProvider} (a transient preview store the
 *     rebinding screen uses to show "what would the slot's bindings
 *     look like if you applied this change").
 *
 * Internally normalised to a {@link PlayerBindingsProvider} so the
 * service holds a single read shape regardless of which one the caller
 * passed. The dispatcher's `bindings` field uses the same union for
 * the same reason.
 */
export type ServiceBindingsSource =
  | BindingsStore
  | InputBindingsStore
  | PlayerBindingsProvider;

/** Constructor options for {@link InputService}. */
export interface InputServiceOptions {
  /**
   * Source of the per-player binding profile. Required. See
   * {@link ServiceBindingsSource} for the accepted shapes.
   */
  readonly bindings: ServiceBindingsSource;

  /**
   * Live keyboard hardware abstraction. Required when the service has
   * to construct its own {@link DeviceInputDispatcher}; ignored when
   * {@link dispatcher} is supplied directly. The service exposes the
   * pluggable interface (rather than hardcoding a Phaser bridge) so
   * tests can inject a `Map`-backed mock without dragging in jsdom.
   */
  readonly keyboard?: KeyboardSource;

  /**
   * Live gamepad hardware abstraction. Same wiring contract as
   * {@link keyboard} — required when constructing a fresh dispatcher,
   * ignored when {@link dispatcher} is supplied.
   */
  readonly gamepad?: GamepadSource;

  /**
   * Optional pre-built dispatcher. When supplied, the service reuses
   * it verbatim and does not require {@link keyboard} / {@link gamepad}.
   * Used by:
   *
   *   • Production wiring that already constructed a dispatcher for
   *     the {@link InputBindingManager} subscriber path — the service
   *     and the manager share the same dispatcher so a single device
   *     poll feeds both.
   *   • Unit tests that want to assert against a hand-rolled
   *     dispatcher fixture.
   *
   * If both `dispatcher` and `keyboard`/`gamepad` are supplied, the
   * dispatcher wins (the service trusts the caller's wiring choice).
   * If neither is supplied, the constructor throws — the service
   * cannot read inputs without one or the other.
   */
  readonly dispatcher?: DeviceInputDispatcher;

  /**
   * Custom {@link DodgeResolver}. Defaults to
   * {@link defaultDodgeResolver} (shield + directional chord).
   * Override when:
   *
   *   • A future sub-AC adds a first-class `dodge` binding action to
   *     the rebinding store — the new resolver does a direct binding
   *     lookup and falls back to the default chord for back-compat.
   *   • A test or debug overlay wants to force `dodge = true` to
   *     drive a specific code path without faking input state.
   */
  readonly dodgeResolver?: DodgeResolver;
}

/**
 * Normalise the {@link ServiceBindingsSource} union to a uniform
 * {@link PlayerBindingsProvider}. The {@link BindingsStore} facade
 * exposes `getRawStore()` returning the inner data model; the data
 * model itself already implements `get(slot)`. Tests that pass a plain
 * provider object are accepted as-is.
 *
 * Defensive runtime check: a caller that passes `null` / `undefined`
 * gets a clear error rather than a generic "cannot read property" deep
 * inside the dispatcher.
 */
function normaliseBindings(source: ServiceBindingsSource): PlayerBindingsProvider {
  if (source === null || source === undefined) {
    throw new Error(
      'InputService: options.bindings must be a BindingsStore, InputBindingsStore, or PlayerBindingsProvider — got null/undefined.',
    );
  }
  // BindingsStore facade — unwrap to the inner store, which already
  // implements the provider shape.
  if (typeof (source as BindingsStore).getRawStore === 'function') {
    return (source as BindingsStore).getRawStore();
  }
  // Either an InputBindingsStore or a PlayerBindingsProvider — both
  // already implement `get(slot)`. The dispatcher accepts either via
  // the same union, so no further wrapping is needed.
  if (typeof (source as PlayerBindingsProvider).get === 'function') {
    return source as PlayerBindingsProvider;
  }
  throw new Error(
    'InputService: options.bindings does not implement get(slot) — supplied object is not a valid bindings source.',
  );
}

// ---------------------------------------------------------------------------
// InputService
// ---------------------------------------------------------------------------

/**
 * Per-frame action resolver bridging the per-player {@link BindingsStore}
 * to the unified {@link UnifiedActionState} surface every gameplay
 * consumer reads.
 *
 * Lifecycle:
 *
 *     // Construct against the persistent bindings + live hardware:
 *     const service = new InputService({
 *       bindings: createBindingsStore().store,
 *       keyboard: createPhaserKeyboardSource(scene),
 *       gamepad:  createBrowserGamepadSource(),
 *     });
 *
 *     // Per fixed step, per active slot:
 *     const p1 = service.resolve(1);
 *     wolf.applyInput({
 *       moveX: p1.move.x,
 *       jump:  p1.jump,
 *       attack: p1.attack,
 *       shield: p1.shield,
 *       dodge:  p1.dodge,
 *       dropThrough: p1.move.y > 0 && p1.jump,
 *     });
 *
 *     // Or sample one action at a time (rebinding UI / AI overrides):
 *     if (service.isActionHeld(3, 'jump')) ...
 *
 * The service is **stateless**: every call recomputes from the live
 * dispatcher state. A mid-match rebind committed to the underlying
 * store takes effect on the very next `resolve` / `isActionHeld` call,
 * with no explicit reload step.
 *
 * Multi-source composition: the service can be constructed against
 * either a fresh dispatcher (supplying `keyboard` + `gamepad`) or an
 * existing one (supplying `dispatcher` directly). The latter is the
 * production path — the gameplay scene wires one dispatcher, then
 * shares it across the {@link InputBindingManager} (event subscribers)
 * and {@link InputService} (per-frame readers) so a single per-step
 * device poll feeds both.
 */
export class InputService {
  private readonly dispatcher: DeviceInputDispatcher;
  private readonly bindings: PlayerBindingsProvider;
  private readonly dodgeResolver: DodgeResolver;

  constructor(options: InputServiceOptions) {
    this.bindings = normaliseBindings(options.bindings);
    this.dodgeResolver = options.dodgeResolver ?? defaultDodgeResolver;

    if (options.dispatcher !== undefined) {
      this.dispatcher = options.dispatcher;
    } else {
      if (options.keyboard === undefined || options.gamepad === undefined) {
        throw new Error(
          'InputService: must supply either `dispatcher` or both `keyboard` and `gamepad` — cannot read inputs otherwise.',
        );
      }
      this.dispatcher = new DeviceInputDispatcher({
        keyboard: options.keyboard,
        gamepad: options.gamepad,
        bindings: this.bindings,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Read API — unified action state
  // -------------------------------------------------------------------------

  /**
   * Resolve the unified action state for one slot. Always returns a
   * fully-closed, frozen {@link UnifiedActionState} — every field has a
   * concrete value (booleans default to `false`, `move` defaults to
   * {@link MOVE_NEUTRAL}). Consumers can keep the returned reference
   * across frames (it's immutable) or compare records by structural
   * equality (every field is primitive or frozen).
   *
   * The resolution path:
   *
   *   1. Sample the dispatcher's `ActionHeldMap` for the slot — this
   *      reads the per-player binding profile and the live device
   *      state in one batched call.
   *   2. Build the {@link MoveVector} from the dispatcher's
   *      analog-aware `sampleMoveX` / `sampleMoveY` so a half-pushed
   *      stick produces a fractional `move` magnitude on gamepad
   *      slots and a clean digital `-1 | 0 | +1` on keyboard slots.
   *   3. Run the {@link DodgeResolver} over the partial state to
   *      produce the final `dodge` boolean.
   *   4. Freeze the assembled record on the way out so callers cannot
   *      mutate a future poll's storage.
   */
  resolve(slot: PlayerBindingsIndex): UnifiedActionState {
    const held = this.dispatcher.sampleActions(slot);
    const move = this.sampleMove(slot);
    const partial = {
      slot,
      move,
      jump: held.jump,
      attack: held.attack,
      special: held.special,
      shield: held.shield,
      grab: held.grab,
    } as const;
    const dodge = this.dodgeResolver({
      slot: partial.slot,
      move: partial.move,
      jump: partial.jump,
      attack: partial.attack,
      special: partial.special,
      shield: partial.shield,
      grab: partial.grab,
      held,
    });
    return Object.freeze({
      ...partial,
      dodge,
    });
  }

  /**
   * Resolve all four slots in one call. Returns a frozen record keyed
   * by slot index. The replay capture layer uses this to log every
   * active slot's resolved state per fixed step in one batched read.
   *
   * Iterates slots in ascending index order so the resulting record's
   * own-key order is deterministic — required for hash-stable replay
   * checksums.
   */
  resolveAll(): Readonly<Record<PlayerBindingsIndex, UnifiedActionState>> {
    return Object.freeze({
      1: this.resolve(1),
      2: this.resolve(2),
      3: this.resolve(3),
      4: this.resolve(4),
    });
  }

  /**
   * Sample only the move vector for a slot. Convenience for callers
   * that only need movement (e.g. a debug HUD rendering the stick
   * position) without paying for a full {@link UnifiedActionState}
   * resolution. Returns the {@link MOVE_NEUTRAL} singleton when both
   * axes are zero so a stationary slot doesn't allocate.
   */
  sampleMove(slot: PlayerBindingsIndex): MoveVector {
    const x = this.dispatcher.sampleMoveX(slot);
    const y = this.dispatcher.sampleMoveY(slot);
    if (x === 0 && y === 0) {
      return MOVE_NEUTRAL;
    }
    return Object.freeze({ x, y });
  }

  /**
   * True iff the named button-style action is held this frame for the
   * slot. The single-action read path used by the rebinding UI ("is
   * the player pressing the button I'm waiting for?"), the AI override
   * paths, and per-action menu navigation.
   *
   * Exhaustively switches on the action name so adding a new
   * {@link UnifiedActionName} fails to compile here until the service
   * learns to resolve it.
   */
  isActionHeld(slot: PlayerBindingsIndex, action: UnifiedActionName): boolean {
    switch (action) {
      case 'jump':
        return this.dispatcher.isActionHeld(slot, 'jump');
      case 'attack':
        return this.dispatcher.isActionHeld(slot, 'attack');
      case 'special':
        return this.dispatcher.isActionHeld(slot, 'special');
      case 'shield':
        return this.dispatcher.isActionHeld(slot, 'shield');
      case 'grab':
        return this.dispatcher.isActionHeld(slot, 'grab');
      case 'dodge': {
        // Dodge has no direct binding in the legacy LOGICAL_ACTIONS
        // store — it is derived. Reuse the same resolver path
        // `resolve()` uses so the two read surfaces never diverge.
        return this.resolve(slot).dodge;
      }
      /* istanbul ignore next — exhaustiveness sentinel. */
      default: {
        const _exhaustive: never = action;
        return _exhaustive;
      }
    }
  }

  /**
   * Build the per-frame {@link CharacterInput} record consumed by
   * `Character.applyInput`. AC 40104 Sub-AC 4 — the gameplay scene,
   * AI runtime, and replay capture layer all read inputs through this
   * single named entry point so there is no "raw input" path left in
   * the player / character controllers.
   *
   * The translation is a thin shape-fold over {@link resolve}:
   *
   *   • `moveX`        ← `unified.move.x` (digital `-1 | 0 | +1` on
   *                     keyboard slots; analog magnitude on gamepad).
   *   • `jump`         ← `unified.jump`.
   *   • `attack`       ← `unified.attack`. Heavy-attack dispatch is the
   *                     {@link Character} class's call (it owns the
   *                     smash-flick predicate); the unified API exposes
   *                     `attack` as a single button.
   *   • `shield`       ← `unified.shield`.
   *   • `dodge`        ← `unified.dodge` — already resolved by the
   *                     configured {@link DodgeResolver} (default:
   *                     shield + directional chord). Replaces the
   *                     legacy "AND-the-stick-with-shield-in-the-scene"
   *                     manual derivation.
   *   • `dropThrough`  ← Smash-style `down + jump`. Read off the
   *                     unified move vector's Y component (`y > 0` is
   *                     down, matching the canvas convention).
   *
   * Why this lives on the service rather than in the gameplay scene:
   *
   *   1. **Single source of truth.** The dispatcher's legacy
   *      `sampleCharacterInput` produced an *incomplete* record (no
   *      dodge, no analog Y for `dropThrough` on gamepad). Folding the
   *      mapping into the service means every consumer — the match
   *      scene, the (later-AC) AI runtime, the replay-driven provider
   *      — sees the same shape with the same defaults.
   *   2. **Removes hardcoded device branches from the scene.** The
   *      match-scene call site collapses to a single
   *      `service.sampleCharacterInput(slot)`; there is no per-device
   *      reach-around through the dispatcher's legacy `LogicalAction`
   *      surface left in gameplay code.
   *   3. **Future-proofs `dropThrough`.** A future "press-down-on-air
   *      to fast-fall" tweak only needs to update the mapping here;
   *      the scene stays untouched.
   *
   * Determinism: pure shape-translation over the deterministic
   * {@link resolve} record. Two calls with identical source state
   * return byte-identical records (every field is primitive; the
   * record is frozen on the way out).
   */
  sampleCharacterInput(slot: PlayerBindingsIndex): CharacterInput {
    const unified = this.resolve(slot);
    // AC 50202 Sub-AC 2 — every action category the Seed names is
    // exposed verbatim through the binding-layer read so the
    // gameplay path's unified action-state API
    // (`PlayerInputController` / `buildCharacterInputFromController`)
    // and this legacy single-call adapter produce identical records.
    // `special` and `grab` flow through as their own fields so the
    // (later sub-AC) dedicated handlers branch on the unaliased
    // press; `attackHeavy` stays empty here because there is no
    // dedicated heavy-button binding yet (the smash dispatch latches
    // on `attack` + a fast stick flick today, and the future C-stick
    // / heavy-button binding will populate this slot directly).
    return Object.freeze({
      moveX: unified.move.x,
      jump: unified.jump,
      attack: unified.attack,
      special: unified.special,
      grab: unified.grab,
      shield: unified.shield,
      dodge: unified.dodge,
      dropThrough: unified.move.y > 0 && unified.jump,
    });
  }

  // -------------------------------------------------------------------------
  // Pass-throughs / introspection
  // -------------------------------------------------------------------------

  /**
   * Read the underlying dispatcher's full `ActionHeldMap` for a slot.
   * Escape hatch for code paths that need the raw legacy action set
   * (e.g. the {@link InputBindingManager}'s diff loop) without paying
   * for a unified resolution. The returned map is frozen.
   *
   * This is the *only* public surface where the service exposes the
   * legacy {@link LogicalAction} vocabulary. New consumer code should
   * prefer {@link resolve} or {@link isActionHeld} so a future schema
   * rename of the legacy actions does not ripple outward.
   */
  sampleHeldActions(slot: PlayerBindingsIndex): ActionHeldMap {
    return this.dispatcher.sampleActions(slot);
  }

  /**
   * Returns the dispatcher the service is wired to. Production wiring
   * uses this to share one dispatcher between the service and the
   * event-driven {@link InputBindingManager} so a single device poll
   * per fixed step feeds both subscribers and per-frame readers.
   */
  getDispatcher(): DeviceInputDispatcher {
    return this.dispatcher;
  }

  /**
   * Returns the bindings provider the service reads from. Useful for
   * debug overlays that want to render "the active binding for P3
   * jump is …" without having to thread the store reference
   * separately.
   */
  getBindingsProvider(): PlayerBindingsProvider {
    return this.bindings;
  }
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Build a frozen "all released, stick neutral" {@link UnifiedActionState}
 * for a slot. Useful for assertions that compare a service read against
 * a clean baseline, and for the gameplay loop's "no input this frame"
 * fallback when a slot is empty.
 *
 * The factory takes a slot index because {@link UnifiedActionState}
 * carries `slot` as a field — a frozen module-level singleton wouldn't
 * work for slots 2/3/4. Cheap to call (one allocation per call); use
 * sparingly outside of tests.
 */
export function neutralUnifiedActionState(slot: PlayerBindingsIndex): UnifiedActionState {
  return Object.freeze({
    slot,
    move: MOVE_NEUTRAL,
    jump: false,
    attack: false,
    special: false,
    shield: false,
    grab: false,
    dodge: false,
  });
}

/**
 * Re-export the {@link LOGICAL_ACTIONS} constant under a name local to
 * this module so consumers that only import from `InputService` for
 * iteration (e.g. a debug overlay rendering every action's held state)
 * don't have to also pull in `src/types/inputBindings`.
 */
export const LEGACY_LOGICAL_ACTIONS: ReadonlyArray<LogicalAction> = LOGICAL_ACTIONS;
