/**
 * Shared input-provider abstraction — AC 10201 Sub-AC 1.
 *
 * Why this module exists
 * ----------------------
 *
 * Up to this point the engine has had two distinct paths producing the
 * deterministic {@link CharacterInput} record consumed by
 * `Character.applyInput`:
 *
 *   • Human players       → {@link LocalInputHandler.sample} (keyboard) /
 *                           {@link DeviceInputDispatcher.sample}    (gamepad).
 *   • Hard-tier AI bots   → behavior-tree branches (`offensive/`,
 *                           `recovery/`) that emit `OffensiveAction` /
 *                           `RecoveryAction` records into a per-tick
 *                           {@link ActionWriter} sink.
 *
 * The behavior tree's writer-style emit pattern lives entirely inside the
 * AI module — gameplay code (the match scene, the fighter dispatcher, the
 * replay capture buffer) only knows how to consume `CharacterInput`. Some
 * adapter has to translate "AI emitted `jab` and `moveRight` this tick"
 * into the same `{ moveX, jump, attack, ... }` shape a keyboard handler
 * produces, *without* the gameplay layer having to know which kind of
 * player is in slot 3.
 *
 * That adapter is the `PlayerInputProvider` interface declared here. The
 * match scene holds an array of providers (one per active slot) and on
 * every fixed step calls `provider.sample(frame)` for each — keyboard
 * players, gamepad players, AI bots, and replay-playback all conform.
 * The replay buffer captures the resulting `CharacterInput` records
 * verbatim, so a recorded match plays back identically regardless of the
 * mix of human / AI sources that produced it.
 *
 * Determinism contract
 * --------------------
 *
 *   • `sample(frame)` is the *only* read path. Implementations must be a
 *     pure function of (current source state, internal deterministic
 *     state, supplied `frame`).
 *   • No `Math.random()`. Any AI implementation that needs randomness
 *     pulls from an injected {@link Rng} (see `AIInputProvider`).
 *   • No wall-clock reads. The supplied `frame` index is the only time
 *     reference; if a provider needs to "wait N frames before pressing
 *     again" it computes against `frame`, not `Date.now()`.
 *   • `sample` returns a fully-closed record — every optional field on
 *     `CharacterInput` resolves to a concrete value (booleans default to
 *     `false`, `moveX` to `0`). This mirrors {@link NEUTRAL_INPUT} and
 *     keeps the replay capture path free of normalisation forks.
 *
 * Player-slot orientation
 * -----------------------
 *
 * Providers are slot-scoped — the match wires one provider per
 * `PlayerIndex` (`0..3`, mirroring the replay buffer's
 * {@link import('../replay/InputCaptureBuffer').PlayerIndex}). A
 * `LocalInputHandler` services two keyboard slots through one instance
 * (P1 + P2) so we expose a thin {@link createKeyboardInputProvider}
 * adapter that closes over the desired keyboard player index and exposes
 * the slot-scoped `sample(frame)` shape every other provider implements.
 *
 * What this module deliberately is NOT
 * -------------------------------------
 *
 *   • A controller composer. Routing offensive emits + recovery emits
 *     into a single writer is a {@link AIInputProvider} concern; this
 *     module only declares the read-side abstraction.
 *   • A binding store. `LocalInputHandler` and `DeviceInputDispatcher`
 *     own keyboard/gamepad bindings; `AIInputProvider` does not consult
 *     a binding table because AI presses are virtual buttons, not key
 *     codes. The replay system records the resulting `CharacterInput`
 *     either way, so the rebinding screen has no effect on AI replay.
 *   • A frame stepper. The match scene owns the fixed-step loop and
 *     calls `provider.sample(frame)` once per step. Providers do not
 *     drive their own frame counter.
 */

import type { CharacterInput } from '../characters/Character';
import type {
  KeyboardPlayerIndex,
  KeyboardSource,
  LocalInputHandler,
} from './LocalInputHandler';
import type {
  GamepadBinding,
  InputBinding,
  LogicalAction,
  PlayerBindings,
  PlayerBindingsIndex,
} from '../types/inputBindings';
import type { GamepadSource, PlayerBindingsProvider } from './DeviceInputDispatcher';
import type { InputBindingsStore } from './InputBindingsStore';
import type { BindingsStore } from './BindingsStore';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Slot identity for a single player. Mirrors the replay buffer's
 * `PlayerIndex` — `0` is P1, `1` is P2, `2` is P3, `3` is P4. Kept
 * literal so a provider that doesn't care about its own slot still
 * compiles, while a provider that *does* care (e.g. an AI bot that
 * needs to look up its opponent in the world snapshot) gets a
 * compiler-checked enumeration.
 */
export type PlayerSlotIndex = 0 | 1 | 2 | 3;

/**
 * Shape every per-slot input source must implement.
 *
 * The match scene calls `sample(frame)` exactly once per fixed step
 * before forwarding the result into `Character.applyInput` (and the
 * replay capture buffer). The interface is intentionally minimal: a
 * single read method plus an optional `reset()` so the controller can
 * be wiped on match restart / replay scrub.
 *
 * Implementations include:
 *
 *   • The keyboard adapter from {@link createKeyboardInputProvider}
 *     (closes over a `LocalInputHandler` + a keyboard player index).
 *   • The forthcoming gamepad adapter (wraps `DeviceInputDispatcher`).
 *   • {@link AIInputProvider} subclasses (Hard / Medium / Easy bots).
 *   • Replay playback — the M4 replay player constructs an array of
 *     providers backed by `InputCaptureBuffer.getPlayerInput`.
 */
export interface PlayerInputProvider {
  /**
   * The slot this provider drives. Read-only; the scene wires it once
   * at match start and never reassigns. Exposed (rather than implicit)
   * so AI implementations can self-identify when consulting a shared
   * world snapshot keyed by slot index.
   */
  readonly slotIndex: PlayerSlotIndex;

  /**
   * Optional debug label — surfaced in error messages, replay overlays,
   * and the rebinding screen's slot summary. Free-form; the runtime
   * never branches on it.
   */
  readonly label?: string;

  /**
   * Produce the per-frame input snapshot for this slot.
   *
   * Must be a pure function of the provider's internal state plus the
   * supplied `frame` index — no `Math.random()`, no wall-clock reads.
   * Returning the *same* object reference across consecutive frames is
   * permitted (e.g. a "neutral" provider that hands back
   * `NEUTRAL_INPUT_SNAPSHOT` every tick), but the caller MUST treat the
   * returned record as immutable.
   *
   * @param frame Deterministic 60 Hz frame index — matches the value
   *              the replay capture buffer stores. Provided so AI
   *              implementations can implement frame-relative timing
   *              ("re-press jump every 4 frames") without reading the
   *              wall clock.
   */
  sample(frame: number): CharacterInput;

  /**
   * Optional lifecycle hook. The match scene calls `reset()` on
   * provider arrays at:
   *
   *   • Match restart  (lobby → new match with the same providers).
   *   • Replay scrub   (rewind to a snapshot frame).
   *   • Stock respawn  (some AI implementations want to drop combo /
   *                     follow-up state when their fighter dies).
   *
   * Implementations that hold no state can omit this method —
   * `LocalInputHandler` is intentionally stateless, for example.
   */
  reset?(): void;
}

/**
 * Convenience neutral snapshot. Mirrors the replay buffer's
 * {@link import('../replay/InputCaptureBuffer').NEUTRAL_INPUT}, but
 * declared here so the input module doesn't have to depend on
 * `replay/`. A provider that has no decision to make on a given frame
 * (e.g. a freshly-respawned fighter waiting out invuln frames) can
 * simply return this constant.
 *
 * Frozen so the reference is safe to share across slots and frames.
 */
export const NEUTRAL_INPUT_SNAPSHOT: Readonly<Required<Pick<CharacterInput,
  'moveX' | 'moveY' | 'jump' | 'attack' | 'dropThrough'
>>> &
  Readonly<CharacterInput> = Object.freeze({
  moveX: 0,
  moveY: 0,
  jump: false,
  attack: false,
  dropThrough: false,
});

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/**
 * Coerce a (possibly partial) `CharacterInput` into a fully-closed
 * record where every flag has a concrete `false` default and `moveX`
 * is clamped to `[-1, 1]`. The match scene never has to special-case
 * an `undefined` shield press, and the replay buffer can hash
 * canonical records.
 *
 * Mirrors `normaliseInput` in `replay/InputCaptureBuffer.ts` — kept
 * separate so the input module doesn't depend on the replay module.
 * Both produce byte-identical outputs for any well-formed
 * `CharacterInput`; the replay buffer reapplies its own normalisation
 * defensively because it accepts inputs from arbitrary providers.
 */
export function closeCharacterInput(input: CharacterInput): CharacterInput {
  let moveX = input.moveX;
  if (typeof moveX !== 'number' || !Number.isFinite(moveX)) {
    moveX = 0;
  } else if (moveX < -1) {
    moveX = -1;
  } else if (moveX > 1) {
    moveX = 1;
  }
  // Vertical stick — same clamp as moveX. Consumed by the fast-fall
  // latch, DI, and the item-throw direction; closed to 0 so the sim
  // never branches on `undefined`.
  let moveY = input.moveY ?? 0;
  if (typeof moveY !== 'number' || !Number.isFinite(moveY)) {
    moveY = 0;
  } else if (moveY < -1) {
    moveY = -1;
  } else if (moveY > 1) {
    moveY = 1;
  }
  return Object.freeze({
    moveX,
    moveY,
    jump: input.jump === true,
    attack: input.attack === true,
    attackHeavy: input.attackHeavy === true,
    // T1 (AC 5-9) — pass `special` through to the runtime so a G press
    // (or rebound special key) reaches Character.tickAttack's special-
    // dispatch branch. Pre-fix the field was stripped here, which is
    // the G-binding bug AC 5 names: input never reached per-character
    // findMoveByType / executeNeutralSpecial.
    special: input.special === true,
    // T3 (AC 12) — pass `grab` through so the throw controller can
    // detect a rising-edge throw press while a fighter is holding an
    // item. The `grab` binding doubles as the throw key (canonical
    // Smash idiom — Z presses while holding throw the item).
    grab: input.grab === true,
    shield: input.shield === true,
    dodge: input.dodge === true,
    dropThrough: input.dropThrough === true,
    ledgeRelease: input.ledgeRelease ?? null,
  });
}

// ---------------------------------------------------------------------------
// Keyboard adapter
// ---------------------------------------------------------------------------

/**
 * Slot-scoped wrapper around an existing {@link LocalInputHandler}
 * instance. Two keyboard players share one handler (P1 + P2 reading
 * the same physical keyboard); calling this twice with the same
 * handler yields two independent providers — one per slot — so the
 * match scene's provider array stays uniform across human and AI
 * sources.
 *
 * Slot-index translation: the keyboard handler indexes players from
 * `1` (`KeyboardPlayerIndex = 1 | 2`); the provider interface uses the
 * 0-based `PlayerSlotIndex`. The mapping is fixed at adapter
 * construction time so the scene can wire keyboard players into any
 * pair of slot indices (e.g. P1 in slot 0, P2 in slot 2 with bots in
 * slots 1 and 3).
 *
 * @param handler        The shared `LocalInputHandler` instance.
 * @param keyboardPlayer Which keyboard player (`1` or `2`) this
 *                       provider is bound to.
 * @param slotIndex      The match-level slot the keyboard player
 *                       occupies. Defaults to `keyboardPlayer - 1`
 *                       (P1 → slot 0, P2 → slot 1) which is the
 *                       common case; pass an explicit value for
 *                       custom slot layouts.
 * @param label          Optional debug label. Defaults to
 *                       `"keyboard.P{n}"`.
 */
export function createKeyboardInputProvider(
  handler: LocalInputHandler,
  keyboardPlayer: KeyboardPlayerIndex,
  slotIndex: PlayerSlotIndex = (keyboardPlayer - 1) as PlayerSlotIndex,
  label?: string,
): PlayerInputProvider {
  return {
    slotIndex,
    label: label ?? `keyboard.P${keyboardPlayer}`,
    sample(_frame: number): CharacterInput {
      // The keyboard handler is itself stateless w.r.t. frame index —
      // it reads the live key state — but we pass `_frame` through the
      // signature for shape uniformity with AI / replay providers.
      return handler.sample(keyboardPlayer);
    },
    // No reset() — `LocalInputHandler` holds no per-match state.
  };
}

/**
 * Shorthand: build providers for both keyboard players against a
 * single `LocalInputHandler` instance. The returned tuple is
 * `[p1Provider, p2Provider]` so the caller can spread it into a
 * mixed-source provider array.
 *
 * Use this from match boot when both keyboard slots are filled by
 * humans; if only one keyboard player is active, prefer the explicit
 * single-player `createKeyboardInputProvider` call so the inactive
 * slot can be filled with an `AIInputProvider`.
 */
export function createBothKeyboardInputProviders(
  handler: LocalInputHandler,
  options: {
    readonly p1Slot?: PlayerSlotIndex;
    readonly p2Slot?: PlayerSlotIndex;
  } = {},
): readonly [PlayerInputProvider, PlayerInputProvider] {
  return [
    createKeyboardInputProvider(handler, 1, options.p1Slot ?? 0),
    createKeyboardInputProvider(handler, 2, options.p2Slot ?? 1),
  ];
}

// ---------------------------------------------------------------------------
// Bindings-aware keyboard device adapter — AC 40102 Sub-AC 2
// ---------------------------------------------------------------------------
//
// Why a second keyboard adapter
// -----------------------------
//
// The legacy {@link createKeyboardInputProvider} above wraps a
// `LocalInputHandler`, which keeps its own per-player binding tables
// seeded from the hardcoded {@link DEFAULT_P1_BINDINGS} /
// {@link DEFAULT_P2_BINDINGS} constants. That path never observes a
// rebind committed through the M5 settings flow — once the handler is
// constructed, its keyboard layout is fixed unless someone manually
// calls `handler.setBindings()`.
//
// AC 40102 Sub-AC 2 closes that gap: the keyboard device adapter must
// resolve raw key events through the {@link BindingsStore} per player,
// removing every hardcoded key constant from the hot loop. The adapter
// declared below is the slot-scoped {@link PlayerInputProvider} that
// the gameplay scene wires for keyboard players when it wants live
// rebind behaviour without going through the higher-level
// {@link DeviceInputDispatcher}. It composes:
//
//   • A {@link KeyboardSource} — the same minimal `isDown(keyCode)`
//     hardware abstraction the polling layer uses (Phaser bridge in
//     production, `Map`-backed mock in tests).
//   • A {@link KeyboardBindingsProvider} — anything that can resolve a
//     {@link PlayerBindingsIndex} to a live {@link PlayerBindings}
//     profile. The {@link BindingsStore} facade, the inner
//     {@link InputBindingsStore} data model, and any
//     {@link PlayerBindingsProvider} fixture all qualify (mirrors the
//     dispatcher's `bindings` source contract — one shape, many
//     concrete inputs).
//
// Determinism
// -----------
//
//   • Stateless by design — every `sample()` re-reads the bindings
//     provider and the keyboard source. A rebind committed mid-match
//     takes effect on the very next sample with no explicit reload.
//   • No `Math.random()`, no wall-clock reads, no Phaser. The adapter
//     ignores its `_frame` argument (kept for shape uniformity with AI
//     / replay providers).
//   • Multi-bind OR semantics: each {@link LogicalAction} carries an
//     array of {@link InputBinding}s; the adapter treats the action as
//     held iff *any* of its keyboard bindings reports held this frame.
//     Empty arrays read as "deliberately unbound" — the action stays
//     released — which matches the schema doc's "empty arrays are
//     legal" promise.
//   • Gamepad bindings on the same action are silently ignored here —
//     the keyboard device adapter only resolves keyboard sources. A
//     gamepad-backed slot uses {@link DeviceInputDispatcher} (or a
//     future gamepad-only adapter) instead. Mixing both in one slot
//     stays the dispatcher's job.

/**
 * Pluggable bindings reader for the keyboard device adapter. The
 * adapter does not need the full mutation surface of
 * {@link BindingsStore} — only the per-slot read. Accepting a narrow
 * shape lets the test suite hand in a frozen `PlayerBindings` map
 * directly while production wires either the {@link BindingsStore}
 * facade (auto-persisting) or the bare {@link InputBindingsStore}
 * data model (replay playback).
 *
 * Re-uses the same alias the {@link DeviceInputDispatcher} accepts on
 * its `bindings` field so the two layers stay interchangeable — a
 * caller that already holds a `BindingsStore` for the dispatcher can
 * pass it straight to this adapter without unwrapping.
 */
export type KeyboardBindingsProvider =
  | BindingsStore
  | InputBindingsStore
  | PlayerBindingsProvider;

/**
 * Internal: collapse the {@link KeyboardBindingsProvider} union to a
 * uniform {@link PlayerBindingsProvider}. Mirrors the
 * `normaliseBindings` helper in `InputService.ts`. The
 * {@link BindingsStore} facade exposes `getRawStore()` returning the
 * inner data model; the data model itself already implements
 * `get(slot)`. Any other object that implements `get(slot)` is
 * accepted as-is.
 */
function normaliseKeyboardBindings(
  source: KeyboardBindingsProvider,
): PlayerBindingsProvider {
  if (source === null || source === undefined) {
    throw new Error(
      'createBindingsKeyboardInputProvider: bindings must be a BindingsStore, InputBindingsStore, or PlayerBindingsProvider — got null/undefined.',
    );
  }
  // BindingsStore facade — unwrap to the inner store.
  if (typeof (source as BindingsStore).getRawStore === 'function') {
    return (source as BindingsStore).getRawStore();
  }
  if (typeof (source as PlayerBindingsProvider).get === 'function') {
    return source as PlayerBindingsProvider;
  }
  throw new Error(
    'createBindingsKeyboardInputProvider: bindings does not implement get(slot) — supplied object is not a valid bindings source.',
  );
}

/**
 * Internal: read the held-state of a single {@link LogicalAction} for a
 * slot by OR-ing its keyboard bindings against the live
 * {@link KeyboardSource}. Gamepad bindings under the same action are
 * skipped — the keyboard adapter is intentionally device-scoped.
 *
 * The lookup is **per-call**: the bindings list is re-read from the
 * provider every invocation so a mid-session rebind takes effect on
 * the very next sample. No keyCode is ever cached or hardcoded inside
 * the adapter — the `binding.keyCode` integer is the only thing the
 * adapter forwards to `keyboard.isDown(...)`, and it comes from the
 * live profile.
 */
function isKeyboardActionHeld(
  bindings: ReadonlyArray<InputBinding>,
  keyboard: KeyboardSource,
): boolean {
  for (let i = 0; i < bindings.length; i += 1) {
    const binding = bindings[i];
    if (binding === undefined) continue;
    if (binding.kind !== 'keyboard') continue;
    if (keyboard.isDown(binding.keyCode)) return true;
  }
  return false;
}

/** Constructor options for {@link createBindingsKeyboardInputProvider}. */
export interface BindingsKeyboardInputProviderOptions {
  /**
   * Live keyboard hardware abstraction — the same minimal
   * `isDown(keyCode)` shape the polling layer accepts. Production
   * passes {@link createPhaserKeyboardSource}; tests pass a
   * `Map`-backed mock.
   */
  readonly keyboard: KeyboardSource;

  /**
   * Source of the per-player {@link PlayerBindings} profile. See
   * {@link KeyboardBindingsProvider} for the accepted shapes.
   */
  readonly bindings: KeyboardBindingsProvider;

  /**
   * Which player profile this provider drives. The adapter resolves
   * the slot's `bindings[action]` array on every `sample()` so a
   * rebind committed via {@link BindingsStore.setAction} takes effect
   * on the very next read with no explicit reload.
   */
  readonly playerSlot: PlayerBindingsIndex;

  /**
   * The match-level slot index (`0..3`) the keyboard player occupies.
   * Defaults to `playerSlot - 1` (P1 → slot 0, P2 → slot 1, …) which
   * is the common case; pass an explicit value for custom slot
   * layouts (e.g. P1 in slot 0, P2 in slot 2 with bots in slots 1 + 3).
   */
  readonly slotIndex?: PlayerSlotIndex;

  /**
   * Optional debug label. Defaults to `"keyboard.bindings.P{n}"` so
   * production logs distinguish the BindingsStore-driven adapter from
   * the legacy `LocalInputHandler`-backed one (`"keyboard.P{n}"`)
   * during the migration window.
   */
  readonly label?: string;
}

/**
 * Build a slot-scoped {@link PlayerInputProvider} that resolves
 * keyboard input through the per-player {@link BindingsStore} lookup.
 * Replaces the hardcoded `DEFAULT_P1_BINDINGS` / `DEFAULT_P2_BINDINGS`
 * tables baked into {@link createKeyboardInputProvider} — every
 * keyCode the adapter inspects comes from the live binding profile.
 *
 * Lifecycle:
 *
 *     const store = createBindingsStore({ hydrateOnConstruct: true }).store;
 *     const keyboard = createPhaserKeyboardSource(scene);
 *     const p1 = createBindingsKeyboardInputProvider({
 *       keyboard,
 *       bindings: store,
 *       playerSlot: 1,
 *     });
 *     const p2 = createBindingsKeyboardInputProvider({
 *       keyboard,
 *       bindings: store,
 *       playerSlot: 2,
 *     });
 *
 *     // Per fixed step, before applyInput:
 *     wolf.applyInput(p1.sample(frame));
 *     cat.applyInput(p2.sample(frame));
 *
 *     // Mid-match rebind — the very next sample picks up the new key.
 *     store.setAction(1, 'jump', [{ kind: 'keyboard', keyCode: KEY_CODE.SPACE }]);
 *
 * The returned `CharacterInput` mirrors the legacy
 * `LocalInputHandler.sample()` shape (`moveX` ∈ {-1, 0, +1},
 * `dropThrough = down && jump`) so the gameplay scene can swap
 * adapters without a downstream edit. Multi-bind OR semantics: a
 * player who has bound both `up` and `jump` to W (the canonical
 * default) jumps either way; an action with an empty binding list
 * stays released.
 */
export function createBindingsKeyboardInputProvider(
  options: BindingsKeyboardInputProviderOptions,
): PlayerInputProvider {
  const { keyboard, playerSlot, label } = options;
  const bindings = normaliseKeyboardBindings(options.bindings);
  const resolvedSlotIndex: PlayerSlotIndex =
    options.slotIndex ?? ((playerSlot - 1) as PlayerSlotIndex);

  // Convenience closure — re-reads the live profile every call so a
  // mid-session rebind via `BindingsStore.setAction` (or any direct
  // mutation of the underlying store) is observed on the very next
  // sample. The bindings are NEVER cached on the adapter.
  function held(profile: PlayerBindings, action: LogicalAction): boolean {
    return isKeyboardActionHeld(profile.bindings[action], keyboard);
  }

  return {
    slotIndex: resolvedSlotIndex,
    label: label ?? `keyboard.bindings.P${playerSlot}`,
    sample(_frame: number): CharacterInput {
      const profile = bindings.get(playerSlot);
      const left = held(profile, 'left');
      const right = held(profile, 'right');
      const down = held(profile, 'down');
      const jump = held(profile, 'jump');
      const attack = held(profile, 'attack');
      // AC 60301 Sub-AC 1 — held shield flag flows through; the
      // runtime owns the cooldown / stun / break gating.
      const shield = held(profile, 'shield');

      let moveX = 0;
      if (left) moveX -= 1;
      if (right) moveX += 1;
      // Digital vertical axis — up/down keys cancel out. Down-positive
      // (canvas Y) so the fast-fall latch reads it directly.
      const up = held(profile, 'up');
      let moveY = 0;
      if (up) moveY -= 1;
      if (down) moveY += 1;

      return {
        moveX,
        moveY,
        jump,
        attack,
        shield,
        // Smash-style drop-through: down + jump pressed together. The
        // platform layer decides whether the fighter is actually on a
        // pass-through platform; the adapter only forwards the intent.
        dropThrough: down && jump,
      };
    },
    // No reset() — the adapter holds no per-match state (the
    // BindingsStore is shared across matches; the KeyboardSource is
    // ambient hardware).
  };
}

/**
 * Shorthand: build BindingsStore-driven providers for both keyboard
 * players in one call. Mirrors {@link createBothKeyboardInputProviders}
 * but routes through the rebinding-aware adapter. The returned tuple
 * is `[p1Provider, p2Provider]` so callers can spread it into a
 * mixed-source provider array.
 *
 * Use this from match boot when both keyboard slots are filled by
 * humans and the gameplay scene wants live rebind behaviour without
 * wiring a {@link DeviceInputDispatcher}. Slot 1 + 2 of the
 * {@link BindingsStore} drive the two keyboard players; the rest of
 * the store (slots 3 + 4) is left for gamepad / AI sources.
 */
export function createBothBindingsKeyboardInputProviders(
  options: {
    readonly keyboard: KeyboardSource;
    readonly bindings: KeyboardBindingsProvider;
    readonly p1Slot?: PlayerSlotIndex;
    readonly p2Slot?: PlayerSlotIndex;
    readonly p1Label?: string;
    readonly p2Label?: string;
  },
): readonly [PlayerInputProvider, PlayerInputProvider] {
  const { keyboard, bindings, p1Slot, p2Slot, p1Label, p2Label } = options;
  return [
    createBindingsKeyboardInputProvider({
      keyboard,
      bindings,
      playerSlot: 1,
      slotIndex: p1Slot ?? 0,
      label: p1Label,
    }),
    createBindingsKeyboardInputProvider({
      keyboard,
      bindings,
      playerSlot: 2,
      slotIndex: p2Slot ?? 1,
      label: p2Label,
    }),
  ];
}

// ---------------------------------------------------------------------------
// Bindings-aware gamepad device adapter — AC 40103 Sub-AC 3
// ---------------------------------------------------------------------------
//
// Why a parallel gamepad adapter
// ------------------------------
//
// Sub-AC 2 ({@link createBindingsKeyboardInputProvider}) gave keyboard
// slots a slot-scoped {@link PlayerInputProvider} that resolves every
// `KeyboardEvent.keyCode` through the live {@link BindingsStore} per
// player — no hardcoded WASD / arrow constants in the read path. Sub-AC
// 3 closes the same gap on the gamepad side: previously, P3 / P4 either
// went through the higher-level {@link DeviceInputDispatcher} (which is
// a *combined* keyboard + gamepad reader) or through ad-hoc paths that
// hardcoded the W3C "standard mapping" button indices (0 = jump, 2 =
// attack, …). Either approach made it impossible for a gamepad-only
// slot to honour a rebind without rebuilding scene state, and it kept
// the canonical button layout duplicated in two places.
//
// {@link createBindingsGamepadInputProvider} replaces both. It is the
// gamepad-equivalent of the keyboard adapter:
//
//   • Slot-scoped — one provider drives one player slot. The match
//     scene can mix-and-match keyboard adapters, gamepad adapters, AI
//     providers, and replay providers in one uniform array.
//   • {@link BindingsStore}-driven — every button index / axis index
//     the adapter samples is read from `bindings.get(playerSlot)
//     .bindings[action]` on every {@link PlayerInputProvider.sample}
//     call. There is no hardcoded button-index constant anywhere in
//     the adapter's read path; pointing the store at button 7 makes
//     the adapter listen on button 7, period.
//   • Keyboard-skipping — keyboard bindings under the same action are
//     silently ignored. Mixing keyboard + gamepad in the same slot is
//     the {@link DeviceInputDispatcher}'s job; the gamepad adapter is
//     intentionally device-scoped so a keyboard tap on a P3 slot can
//     never bleed into gameplay.
//   • Multi-bind OR semantics — each {@link LogicalAction} carries an
//     array of {@link InputBinding}s; the action is held iff *any* of
//     its gamepad bindings reports held this frame. Empty lists read
//     as "deliberately unbound" (the schema doc's contract).
//   • Disconnect-safe — a missing or disconnected pad surfaces as
//     "every action released" (per the {@link GamepadSource} contract).
//     A player who unplugs their pad mid-match can't crash the scene;
//     the disconnect-pause controller picks up the connection event
//     separately.
//
// Determinism
// -----------
//
//   • Stateless by design — every `sample()` re-reads the bindings
//     provider and the gamepad source. A rebind committed mid-match
//     via {@link BindingsStore.setAction} takes effect on the very
//     next sample with no explicit reload.
//   • No `Math.random()`, no wall-clock reads, no Phaser. The adapter
//     ignores its `_frame` argument (kept for shape uniformity with AI
//     / replay providers).
//   • Analog magnitude is preserved on `moveX` so a half-pushed stick
//     produces `~0.6` and `Character.applyInput` walks instead of
//     dashing — matches the dispatcher's `sampleMoveX` semantics.
//   • `gamepadIndex === null` ("any pad") fires when *any* of the
//     iterated pads (0..3) has the source held — consistent with the
//     dispatcher's same-named convention so a binding moves between
//     adapters interchangeably.
//
// Strict TypeScript
// -----------------
//
// Compiled under `noUncheckedIndexedAccess + strict`. The adapter
// switches exhaustively on `binding.kind` (skipping `'keyboard'`) so a
// future device family added to the schema fails to compile here
// until the adapter learns to handle it (or explicitly skip it).

/**
 * Pluggable bindings reader for the gamepad device adapter. Mirrors
 * {@link KeyboardBindingsProvider} — the adapter only needs a per-slot
 * read, so any of the three concrete shapes (the {@link BindingsStore}
 * facade, the bare {@link InputBindingsStore} data model, or any
 * {@link PlayerBindingsProvider}) is accepted. Re-using the same alias
 * keeps the keyboard and gamepad adapters interchangeable from the
 * call-site perspective: a caller that already holds a
 * {@link BindingsStore} for the keyboard adapter can pass the *same*
 * reference straight to this adapter.
 */
export type GamepadBindingsProvider =
  | BindingsStore
  | InputBindingsStore
  | PlayerBindingsProvider;

/**
 * Maximum number of pads scanned when a gamepad binding sets
 * `gamepadIndex = null` ("any pad"). Mirrors the dispatcher's same
 * iteration window — the Seed allows up to 4 active gamepad slots so
 * 0..3 covers every plausible pad index without paying for a full
 * `navigator.getGamepads()` length lookup. Exposed as a constant so
 * the unit tests can assert against the same value the production
 * adapter uses.
 */
export const GAMEPAD_ANY_PAD_SCAN_RANGE = 4;

/**
 * Internal: collapse the {@link GamepadBindingsProvider} union to a
 * uniform {@link PlayerBindingsProvider}. Mirrors
 * {@link normaliseKeyboardBindings} above. The {@link BindingsStore}
 * facade exposes `getRawStore()` returning the inner data model; the
 * data model itself already implements `get(slot)`. Any other object
 * that implements `get(slot)` is accepted as-is.
 *
 * Defensive runtime check: a caller that passes `null` / `undefined`
 * gets a clear error rather than a generic "cannot read property"
 * deep inside the adapter on the first sample.
 */
function normaliseGamepadBindings(
  source: GamepadBindingsProvider,
): PlayerBindingsProvider {
  if (source === null || source === undefined) {
    throw new Error(
      'createBindingsGamepadInputProvider: bindings must be a BindingsStore, InputBindingsStore, or PlayerBindingsProvider — got null/undefined.',
    );
  }
  // BindingsStore facade — unwrap to the inner store.
  if (typeof (source as BindingsStore).getRawStore === 'function') {
    return (source as BindingsStore).getRawStore();
  }
  if (typeof (source as PlayerBindingsProvider).get === 'function') {
    return source as PlayerBindingsProvider;
  }
  throw new Error(
    'createBindingsGamepadInputProvider: bindings does not implement get(slot) — supplied object is not a valid bindings source.',
  );
}

/**
 * Internal: true iff a single gamepad source (button or half-axis) is
 * held on the named pad. Mirrors the dispatcher's
 * `isGamepadSourceHeld` so the two layers agree byte-for-byte on what
 * "held" means — a rebind that fires on the dispatcher fires here too.
 */
function isGamepadSourceHeldOnPad(
  binding: GamepadBinding,
  gamepadIndex: number,
  gamepad: GamepadSource,
): boolean {
  const source = binding.source;
  if (source.type === 'button') {
    return gamepad.getButton(gamepadIndex, source.buttonIndex).pressed;
  }
  // Half-axis: axis * direction must clear the per-binding threshold.
  const axisValue = gamepad.getAxis(gamepadIndex, source.axisIndex);
  return axisValue * source.direction >= source.threshold;
}

/**
 * Internal: true iff a single {@link GamepadBinding} reports held this
 * frame. Handles the `gamepadIndex === null` ("any pad") convention by
 * iterating every plausible pad index and returning on the first match.
 *
 * The lookup is **per-call**: the `binding.source` descriptor is read
 * fresh from the bindings provider every invocation — no button index
 * is ever cached or hardcoded inside the adapter.
 */
function isGamepadBindingHeld(
  binding: GamepadBinding,
  gamepad: GamepadSource,
): boolean {
  if (binding.gamepadIndex === null) {
    for (let i = 0; i < GAMEPAD_ANY_PAD_SCAN_RANGE; i += 1) {
      if (gamepad.isConnected(i) && isGamepadSourceHeldOnPad(binding, i, gamepad)) {
        return true;
      }
    }
    return false;
  }
  if (!gamepad.isConnected(binding.gamepadIndex)) return false;
  return isGamepadSourceHeldOnPad(binding, binding.gamepadIndex, gamepad);
}

/**
 * Internal: read the held-state of a single {@link LogicalAction} for
 * a slot by OR-ing its gamepad bindings against the live
 * {@link GamepadSource}. Keyboard bindings under the same action are
 * skipped — the gamepad adapter is intentionally device-scoped (a
 * keyboard tap on a P3 slot can never bleed into gameplay).
 */
function isGamepadActionHeld(
  bindings: ReadonlyArray<InputBinding>,
  gamepad: GamepadSource,
): boolean {
  for (let i = 0; i < bindings.length; i += 1) {
    const binding = bindings[i];
    if (binding === undefined) continue;
    if (binding.kind !== 'gamepad') continue;
    if (isGamepadBindingHeld(binding, gamepad)) return true;
  }
  return false;
}

/**
 * Internal: magnitude in [0, 1] for a single gamepad binding —
 *   • Buttons report `1` when `pressed`, scaled to `value` if the pad
 *     surfaces an analog reading (triggers). `0` when released.
 *   • Half-axes report the absolute axis value once it crosses the
 *     per-binding threshold, clamped to `[0, 1]`. `0` below the
 *     threshold or for the wrong direction.
 *
 * Mirrors the dispatcher's `gamepadBindingMagnitude` so a rebind
 * shared between the two layers produces identical analog magnitudes.
 */
function gamepadBindingMagnitudeOnPad(
  binding: GamepadBinding,
  gamepadIndex: number,
  gamepad: GamepadSource,
): number {
  const source = binding.source;
  if (source.type === 'button') {
    const btn = gamepad.getButton(gamepadIndex, source.buttonIndex);
    if (!btn.pressed) return 0;
    // Trigger value lives in [0, 1] per the spec; some pads only
    // report 0/1 for digital buttons. Either way, a held button
    // contributes a full magnitude unless the device exposed an
    // analog value — in which case use that.
    return btn.value > 0 ? Math.min(1, btn.value) : 1;
  }
  const axisValue = gamepad.getAxis(gamepadIndex, source.axisIndex);
  const signed = axisValue * source.direction;
  if (signed < source.threshold) return 0;
  return Math.min(1, Math.max(0, signed));
}

function gamepadBindingMagnitude(
  binding: GamepadBinding,
  gamepad: GamepadSource,
): number {
  if (binding.gamepadIndex === null) {
    let best = 0;
    for (let i = 0; i < GAMEPAD_ANY_PAD_SCAN_RANGE; i += 1) {
      if (!gamepad.isConnected(i)) continue;
      const mag = gamepadBindingMagnitudeOnPad(binding, i, gamepad);
      if (mag > best) best = mag;
    }
    return best;
  }
  if (!gamepad.isConnected(binding.gamepadIndex)) return 0;
  return gamepadBindingMagnitudeOnPad(binding, binding.gamepadIndex, gamepad);
}

/**
 * Internal: largest magnitude across every gamepad binding under one
 * action. Used to derive analog `moveX` magnitude for the `left` /
 * `right` half-axes — a half-pushed stick produces `~0.6` and the
 * downstream `Character.applyInput` walks instead of dashing.
 *
 * Keyboard bindings under the same action are skipped (mirrors the
 * `isGamepadActionHeld` policy).
 */
function gamepadActionMagnitude(
  bindings: ReadonlyArray<InputBinding>,
  gamepad: GamepadSource,
): number {
  let best = 0;
  for (let i = 0; i < bindings.length; i += 1) {
    const binding = bindings[i];
    if (binding === undefined) continue;
    if (binding.kind !== 'gamepad') continue;
    const mag = gamepadBindingMagnitude(binding, gamepad);
    if (mag > best) best = mag;
  }
  return best;
}

/** Constructor options for {@link createBindingsGamepadInputProvider}. */
export interface BindingsGamepadInputProviderOptions {
  /**
   * Live gamepad hardware abstraction — the same minimal
   * `isConnected / getButton / getAxis` shape the polling layer
   * accepts. Production passes {@link createBrowserGamepadSource};
   * tests pass a `Map`-backed mock.
   */
  readonly gamepad: GamepadSource;

  /**
   * Source of the per-player {@link PlayerBindings} profile. See
   * {@link GamepadBindingsProvider} for the accepted shapes.
   */
  readonly bindings: GamepadBindingsProvider;

  /**
   * Which player profile this provider drives. The adapter resolves
   * the slot's `bindings[action]` array on every `sample()` so a
   * rebind committed via {@link BindingsStore.setAction} takes effect
   * on the very next read with no explicit reload.
   */
  readonly playerSlot: PlayerBindingsIndex;

  /**
   * The match-level slot index (`0..3`) the gamepad player occupies.
   * Defaults to `playerSlot - 1` (P1 → slot 0, P2 → slot 1, P3 → slot
   * 2, P4 → slot 3). The Seed canonically reserves slots 3 + 4 for
   * gamepads, so the typical wiring is `playerSlot: 3 → slotIndex: 2`
   * and `playerSlot: 4 → slotIndex: 3`; pass an explicit value for
   * custom layouts (e.g. P3 in slot 0 with the keyboard players in
   * slots 1 + 2).
   */
  readonly slotIndex?: PlayerSlotIndex;

  /**
   * Optional debug label. Defaults to `"gamepad.bindings.P{n}"` so
   * production logs distinguish the BindingsStore-driven adapter from
   * the dispatcher-backed combined path during the migration window.
   */
  readonly label?: string;
}

/**
 * Build a slot-scoped {@link PlayerInputProvider} that resolves
 * gamepad input through the per-player {@link BindingsStore} lookup.
 * Replaces the W3C "standard mapping" button-index constants
 * previously baked into the per-slot wiring — every button or axis
 * the adapter inspects comes from the live binding profile.
 *
 * Lifecycle:
 *
 *     const store = createBindingsStore({ hydrateOnConstruct: true }).store;
 *     const gamepad = createBrowserGamepadSource();
 *     const p3 = createBindingsGamepadInputProvider({
 *       gamepad,
 *       bindings: store,
 *       playerSlot: 3,
 *     });
 *     const p4 = createBindingsGamepadInputProvider({
 *       gamepad,
 *       bindings: store,
 *       playerSlot: 4,
 *     });
 *
 *     // Per fixed step, before applyInput:
 *     wolf.applyInput(p3.sample(frame));
 *     cat.applyInput(p4.sample(frame));
 *
 *     // Mid-match rebind — the very next sample picks up the new button.
 *     store.setAction(3, 'shield', [
 *       { kind: 'gamepad', gamepadIndex: 0, source: { type: 'button', buttonIndex: 7 } },
 *     ]);
 *
 * The returned `CharacterInput` mirrors the dispatcher's
 * `sampleCharacterInput` shape (`moveX` ∈ `[-1, 1]` with analog
 * magnitude preserved, `dropThrough = down && jump`) so the gameplay
 * scene can swap providers without a downstream edit. Multi-bind OR
 * semantics: a player who has bound both face-button `A` and shoulder
 * `LB` to jump jumps from either; an action with an empty binding
 * list stays released.
 *
 * Disconnect handling: a disconnected pad reads as "every action
 * released" — the adapter never throws if the pad is yanked
 * mid-match. The {@link GamepadConnectionMonitor} surfaces the
 * disconnect event separately so the scene can drive the
 * disconnect-pause controller.
 */
export function createBindingsGamepadInputProvider(
  options: BindingsGamepadInputProviderOptions,
): PlayerInputProvider {
  const { gamepad, playerSlot, label } = options;
  const bindings = normaliseGamepadBindings(options.bindings);
  const resolvedSlotIndex: PlayerSlotIndex =
    options.slotIndex ?? ((playerSlot - 1) as PlayerSlotIndex);

  // Convenience closures — re-read the live profile every call so a
  // mid-session rebind via `BindingsStore.setAction` (or any direct
  // mutation of the underlying store) is observed on the very next
  // sample. Bindings are NEVER cached on the adapter.
  function held(profile: PlayerBindings, action: LogicalAction): boolean {
    return isGamepadActionHeld(profile.bindings[action], gamepad);
  }
  function magnitude(profile: PlayerBindings, action: LogicalAction): number {
    return gamepadActionMagnitude(profile.bindings[action], gamepad);
  }

  return {
    slotIndex: resolvedSlotIndex,
    label: label ?? `gamepad.bindings.P${playerSlot}`,
    sample(_frame: number): CharacterInput {
      const profile = bindings.get(playerSlot);
      // Analog moveX: take the larger magnitude of `left` vs `right`
      // half-axes so a stick at half-deflection produces `~0.6`. The
      // sign tracks whichever side is pushed harder; equal magnitudes
      // cancel to zero (stick truly centred).
      const leftMag = magnitude(profile, 'left');
      const rightMag = magnitude(profile, 'right');
      const moveX = rightMag - leftMag;

      const down = held(profile, 'down');
      const jump = held(profile, 'jump');
      const attack = held(profile, 'attack');
      // AC 60301 Sub-AC 1 — held shield flag flows through; the
      // runtime owns the cooldown / stun / break gating.
      const shield = held(profile, 'shield');
      // Analog vertical axis — down minus up magnitudes, down-positive
      // (canvas Y) so the fast-fall latch reads it directly.
      const moveY = magnitude(profile, 'down') - magnitude(profile, 'up');

      return {
        moveX,
        moveY,
        jump,
        attack,
        shield,
        // Smash-style drop-through: down + jump pressed together. The
        // platform layer decides whether the fighter is actually on a
        // pass-through platform; the adapter only forwards the intent.
        dropThrough: down && jump,
      };
    },
    // No reset() — the adapter holds no per-match state (the
    // BindingsStore is shared across matches; the GamepadSource is
    // ambient hardware).
  };
}

/**
 * Shorthand: build BindingsStore-driven providers for both gamepad
 * players in one call. Mirrors {@link createBothBindingsKeyboardInputProviders}
 * but routes through the gamepad adapter. The returned tuple is
 * `[p3Provider, p4Provider]` so callers can spread it into a
 * mixed-source provider array.
 *
 * Use this from match boot when both gamepad slots are filled by
 * humans and the gameplay scene wants live rebind behaviour without
 * wiring a {@link DeviceInputDispatcher}. Slot 3 + 4 of the
 * {@link BindingsStore} drive the two gamepad players by default;
 * pass `p3Slot` / `p4Slot` for custom layouts (e.g. a 1-keyboard
 * 1-gamepad match where the gamepad sits in slot 1).
 */
export function createBothBindingsGamepadInputProviders(
  options: {
    readonly gamepad: GamepadSource;
    readonly bindings: GamepadBindingsProvider;
    readonly p3Slot?: PlayerSlotIndex;
    readonly p4Slot?: PlayerSlotIndex;
    readonly p3Label?: string;
    readonly p4Label?: string;
  },
): readonly [PlayerInputProvider, PlayerInputProvider] {
  const { gamepad, bindings, p3Slot, p4Slot, p3Label, p4Label } = options;
  return [
    createBindingsGamepadInputProvider({
      gamepad,
      bindings,
      playerSlot: 3,
      slotIndex: p3Slot ?? 2,
      label: p3Label,
    }),
    createBindingsGamepadInputProvider({
      gamepad,
      bindings,
      playerSlot: 4,
      slotIndex: p4Slot ?? 3,
      label: p4Label,
    }),
  ];
}
