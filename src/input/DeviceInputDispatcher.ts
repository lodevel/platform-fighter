/**
 * Device abstraction layer — AC 40003 Sub-AC 3.
 *
 * Purpose
 * -------
 *
 * The M5 rebinding system has two halves:
 *
 *   1. **Schema + store** (Sub-ACs 1 + 2 — `src/types/inputBindings.ts` and
 *      `InputBindingsStore`). A frozen, JSON-serialisable description of
 *      "for player N, what physical input fires action X?" — but with no
 *      idea how a key is held or how a stick is pushed.
 *   2. **Device abstraction** (this file). Takes the schema + the live
 *      keyboard / gamepad state and produces a per-action held-bitmap
 *      that the gameplay scene, replay layer, and rebinding UI can all
 *      read without caring whether the player is using a keyboard or a
 *      DualShock.
 *
 * `DeviceInputDispatcher` is the glue. It owns no input state of its own
 * — it queries two pluggable hardware abstractions ({@link KeyboardSource}
 * from the M1 handler, {@link GamepadSource} introduced here) and a
 * {@link InputBindingsStore}, and exposes:
 *
 *   • `isActionHeld(slot, action) -> boolean` — single-action read used
 *     by the rebinding UI ("is the player pressing the key I'm waiting
 *     for?") and by AI override paths.
 *   • `sampleActions(slot) -> Record<LogicalAction, boolean>` — full
 *     per-slot held bitmap. The replay logger records this directly, the
 *     gameplay loop converts it into a {@link CharacterInput}.
 *   • `sampleCharacterInput(slot) -> CharacterInput` — convenience
 *     adapter that mirrors the M1 `LocalInputHandler.sample()` shape,
 *     so existing scene wiring can swap in the dispatcher without a
 *     downstream edit. Analog stick magnitude is preserved on gamepad
 *     `left`/`right` so a half-pushed stick walks instead of dashing.
 *
 * Multi-bind semantics
 * --------------------
 *
 * Each {@link LogicalAction} carries an *array* of {@link InputBinding}s.
 * The dispatcher OR-s them: an action is held iff **any** of its bindings
 * report held this frame. An empty array means "deliberately unbound" —
 * the action is always released for that slot. This satisfies the schema
 * doc's "empty arrays are legal" promise and gives the rebinding UI a
 * cheap way to disable an action without dropping it from the table.
 *
 * Half-axes
 * ---------
 *
 * A gamepad `axis` source carries a `direction` (-1 or +1) and a
 * `threshold` in (0, 1]. The dispatcher reports the source as held iff
 * `axisValue * direction >= threshold`. Two opposite half-axes (e.g.
 * `left = axis 0 / -1`, `right = axis 0 / +1`) are therefore mutually
 * exclusive at any given stick position, which matches what a player
 * expects from a single stick.
 *
 * Determinism
 * -----------
 *
 *   • The dispatcher is stateless — every read recomputes from the live
 *     source state. The replay layer records the per-frame action map at
 *     fixed-step time, so a recorded match plays back identically as
 *     long as the binding schema and the source state at each frame
 *     match (the existing replay-snapshot system handles state drift).
 *   • No `Math.random()`, no wall-clock reads, no Phaser. The unit tests
 *     pass mock `KeyboardSource` and `GamepadSource` instances backed by
 *     plain `Map`/`Set`s; the production runtime uses the Phaser
 *     keyboard adapter (`createPhaserKeyboardSource`) and a `navigator
 *     .getGamepads()` adapter (`createBrowserGamepadSource`).
 *
 * Strict TypeScript
 * -----------------
 *
 * Compiled under `noUncheckedIndexedAccess + strict`. Every binding kind
 * is exhaustively switched so adding a new device family in the schema
 * fails to compile until the dispatcher learns to sample it — the
 * exhaustiveness pattern from the schema doc is enforced here.
 */

import type { CharacterInput } from '../characters/Character';
import {
  LOGICAL_ACTIONS,
  type GamepadBinding,
  type GamepadBindingSource,
  type InputBinding,
  type KeyboardBinding,
  type LogicalAction,
  type PlayerBindings,
  type PlayerBindingsIndex,
} from '../types/inputBindings';
import type { InputBindingsStore } from './InputBindingsStore';
import type { KeyboardSource } from './LocalInputHandler';

// ---------------------------------------------------------------------------
// Gamepad hardware abstraction
// ---------------------------------------------------------------------------

/**
 * Snapshot of one gamepad button at one moment. Mirrors the subset of
 * `GamepadButton` the dispatcher actually consumes — a held boolean and
 * an optional analog value (for triggers).
 *
 * `value` is intentionally separate from `pressed`: the W3C Gamepad spec
 * lets a UA report either form depending on whether the button is digital
 * or analog. The dispatcher itself uses only `pressed` (a button is
 * either held or it isn't), but exposing `value` lets the rebinding UI
 * render trigger fill bars without re-querying the raw API.
 */
export interface GamepadButtonState {
  readonly pressed: boolean;
  readonly value: number;
}

/**
 * Minimal gamepad hardware abstraction. The dispatcher reads the world
 * through exactly this surface so:
 *
 *   • The unit-test suite can supply a `Map`-backed mock without dragging
 *     in jsdom or the real `navigator.getGamepads()`.
 *   • The gameplay loop can poll an adapter that snapshots
 *     `navigator.getGamepads()` once per fixed step (browsers re-issue
 *     the snapshot lazily — calling `getGamepads()` mid-step is allowed
 *     but wasteful).
 *
 * Indexing follows the W3C Gamepad API: `gamepadIndex` is the value of
 * `Gamepad.index` (0 = first connected pad). Returning `null` for a
 * disconnected pad lets the dispatcher treat that slot's gamepad
 * bindings as released without throwing — a player who unplugs their
 * controller mid-match should not crash the scene.
 */
export interface GamepadSource {
  /**
   * True iff a pad is currently connected at the given index. Used by
   * the dispatcher to short-circuit binding lookups for a missing pad
   * (every gamepad binding for that index resolves to "released").
   */
  isConnected(gamepadIndex: number): boolean;

  /**
   * Read a button's current state. Implementations should return a
   * sentinel `{ pressed: false, value: 0 }` for disconnected pads and
   * out-of-range button indices so the dispatcher can OR results across
   * bindings without per-binding null checks.
   */
  getButton(gamepadIndex: number, buttonIndex: number): GamepadButtonState;

  /**
   * Read an axis value in the standard [-1, +1] range. As above, return
   * `0` (neutral) for disconnected pads or out-of-range axes.
   */
  getAxis(gamepadIndex: number, axisIndex: number): number;
}

/**
 * Browser adapter for {@link GamepadSource}. Wraps `navigator.getGamepads()`
 * with the same lazy / sentinel-on-miss conventions described on the
 * interface.
 *
 * Why a fresh `getGamepads()` call on every read instead of caching a
 * snapshot: most browsers (Chrome, Firefox, Safari) treat the returned
 * array as a *live* view that already reflects the latest poll. Caching
 * it across the dispatcher's per-frame read window risks a stale read
 * if the adapter outlives a single fixed step, and the call itself is
 * cheap (an internal copy of a fixed-size struct). Adapters can layer a
 * per-frame cache on top by wrapping this source if profiling shows it
 * matters.
 *
 * The adapter is exported for the gameplay scene to use; tests use a
 * mock implementation directly.
 */
export function createBrowserGamepadSource(): GamepadSource {
  const NEUTRAL_BUTTON: GamepadButtonState = Object.freeze({ pressed: false, value: 0 });

  function getPad(gamepadIndex: number): Gamepad | null {
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') {
      return null;
    }
    const pads = navigator.getGamepads();
    if (!pads || gamepadIndex < 0 || gamepadIndex >= pads.length) {
      return null;
    }
    return pads[gamepadIndex] ?? null;
  }

  return {
    isConnected(gamepadIndex: number): boolean {
      const pad = getPad(gamepadIndex);
      return pad !== null && pad.connected === true;
    },
    getButton(gamepadIndex: number, buttonIndex: number): GamepadButtonState {
      const pad = getPad(gamepadIndex);
      if (!pad || !pad.connected) return NEUTRAL_BUTTON;
      if (buttonIndex < 0 || buttonIndex >= pad.buttons.length) return NEUTRAL_BUTTON;
      const btn = pad.buttons[buttonIndex];
      if (!btn) return NEUTRAL_BUTTON;
      // Defensive copy — Gamepad spec says the array is live, but some
      // engines return live `GamepadButton` instances whose flags update
      // mid-frame. Copying into a plain frozen record gives the rest of
      // the dispatcher a stable read.
      return Object.freeze({ pressed: btn.pressed === true, value: Number(btn.value) || 0 });
    },
    getAxis(gamepadIndex: number, axisIndex: number): number {
      const pad = getPad(gamepadIndex);
      if (!pad || !pad.connected) return 0;
      if (axisIndex < 0 || axisIndex >= pad.axes.length) return 0;
      const v = pad.axes[axisIndex];
      return Number.isFinite(v) ? Number(v) : 0;
    },
  };
}

// ---------------------------------------------------------------------------
// Bindings provider abstraction
// ---------------------------------------------------------------------------

/**
 * Pluggable bindings reader. The dispatcher does not need the full
 * mutation surface of {@link InputBindingsStore} — only the per-slot
 * read. Accepting a narrow interface lets the test suite hand in a
 * frozen `PlayerBindings` map directly and the rebinding-screen preview
 * pass a transient store-like object without copying state into the real
 * store.
 */
export interface PlayerBindingsProvider {
  get(slot: PlayerBindingsIndex): PlayerBindings;
}

// ---------------------------------------------------------------------------
// Sample shape
// ---------------------------------------------------------------------------

/**
 * Per-slot held-action bitmap. Every {@link LogicalAction} key is
 * present with a `boolean`; this is the intermediate shape the gameplay
 * loop, replay logger, and AI override compare against.
 */
export type ActionHeldMap = Readonly<Record<LogicalAction, boolean>>;

// ---------------------------------------------------------------------------
// DeviceInputDispatcher
// ---------------------------------------------------------------------------

/** Constructor options. */
export interface DeviceInputDispatcherOptions {
  readonly keyboard: KeyboardSource;
  readonly gamepad: GamepadSource;
  readonly bindings: PlayerBindingsProvider | InputBindingsStore;
}

/**
 * Glue between binding schema, hardware sources, and per-frame action
 * reads. Stateless by design — every read recomputes from the live
 * source state, so a rebinding committed mid-match takes effect on the
 * very next sample without an explicit "reload" call. The Sub-AC 2 store
 * already exposes mutation accessors; the dispatcher reads the latest
 * value directly.
 *
 * Lifecycle:
 *
 *   const dispatcher = new DeviceInputDispatcher({
 *     keyboard: createPhaserKeyboardSource(scene),
 *     gamepad:  createBrowserGamepadSource(),
 *     bindings: store,           // an InputBindingsStore
 *   });
 *
 *   // every fixed step, before character.applyInput:
 *   const input = dispatcher.sampleCharacterInput(1);
 *   wolf.applyInput(input);
 */
/**
 * Per-slot edge-history used by the double-tap-down drop-through
 * detector. The dispatcher is otherwise stateless across calls; this
 * tiny slice tracks (a) whether down was held last frame, so we can
 * detect a rising edge, and (b) when the previous rising edge fired,
 * so we can decide if the current press counts as the second tap of
 * a double-tap.
 */
interface DropThroughLatch {
  prevDown: boolean;
  lastDownPressFrame: number;
  frameCounter: number;
}

/**
 * Maximum frames between two `down` rising-edges that still counts
 * as a double-tap (≈ 200 ms at 60 Hz). Tight enough that a held
 * down doesn't degenerate into a fall-through, loose enough for a
 * comfortable two-finger tap on a directional-pad.
 */
const DOUBLE_TAP_DOWN_WINDOW_FRAMES = 12;

export class DeviceInputDispatcher {
  private readonly keyboard: KeyboardSource;
  private readonly gamepad: GamepadSource;
  private readonly bindings: PlayerBindingsProvider;
  private readonly dropThroughLatches: Map<number, DropThroughLatch> = new Map();

  constructor(options: DeviceInputDispatcherOptions) {
    this.keyboard = options.keyboard;
    this.gamepad = options.gamepad;
    this.bindings = options.bindings;
  }

  // -------------------------------------------------------------------------
  // Action reads
  // -------------------------------------------------------------------------

  /**
   * True iff *any* binding in the slot's `bindings[action]` array reports
   * held this frame. An empty binding list returns `false`. Out-of-range
   * gamepad indices, disconnected pads, and bad source descriptors all
   * resolve to `false` (per the {@link GamepadSource} contract) — a
   * crashed pad cannot brick a player.
   */
  isActionHeld(slot: PlayerBindingsIndex, action: LogicalAction): boolean {
    const list = this.bindings.get(slot).bindings[action];
    for (let i = 0; i < list.length; i += 1) {
      const binding = list[i];
      if (binding !== undefined && this.isBindingHeld(binding)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Build the full per-slot held bitmap in one call. The replay logger
   * records this directly so a recorded match's per-frame action state
   * is byte-stable across runs.
   */
  sampleActions(slot: PlayerBindingsIndex): ActionHeldMap {
    const profile = this.bindings.get(slot);
    // Build a mutable record and freeze on return so the caller can't
    // accidentally mutate a future sample's storage.
    const map: Record<LogicalAction, boolean> = {
      left: false,
      right: false,
      up: false,
      down: false,
      jump: false,
      attack: false,
      special: false,
      shield: false,
      grab: false,
      taunt: false,
    };
    for (const action of LOGICAL_ACTIONS) {
      const list = profile.bindings[action];
      let held = false;
      for (let i = 0; i < list.length; i += 1) {
        const binding = list[i];
        if (binding !== undefined && this.isBindingHeld(binding)) {
          held = true;
          break;
        }
      }
      map[action] = held;
    }
    return Object.freeze(map);
  }

  /**
   * Sample one slot's analog horizontal axis. For keyboard players this
   * is always -1 / 0 / +1 (left and right cancel). For gamepad players
   * the dispatcher returns the larger-magnitude axis value across the
   * `left`/`right` half-axis bindings — so a half-pushed stick produces
   * `moveX ≈ 0.6` and `Character.applyInput` walks instead of dashing.
   *
   * The two paths converge when no analog binding is held: a digital
   * keyboard binding for `left`/`right` contributes -1 / +1.
   */
  sampleMoveX(slot: PlayerBindingsIndex): number {
    const profile = this.bindings.get(slot);
    let moveLeft = 0;
    let moveRight = 0;
    for (let i = 0; i < profile.bindings.left.length; i += 1) {
      const binding = profile.bindings.left[i];
      if (binding === undefined) continue;
      const magnitude = this.bindingMagnitude(binding);
      if (magnitude > moveLeft) moveLeft = magnitude;
    }
    for (let i = 0; i < profile.bindings.right.length; i += 1) {
      const binding = profile.bindings.right[i];
      if (binding === undefined) continue;
      const magnitude = this.bindingMagnitude(binding);
      if (magnitude > moveRight) moveRight = magnitude;
    }
    // Cancel — left and right at equal magnitudes produce neutral. Net
    // sign tracks whichever side is pushed harder, magnitude is the
    // delta. This matches the Sub-AC 3 sample()/CharacterInput contract.
    return moveRight - moveLeft;
  }

  /**
   * Vertical equivalent of {@link sampleMoveX}. For keyboard players
   * the result is `-1 | 0 | +1` (up and down cancel out). For gamepad
   * players the dispatcher returns the larger-magnitude analog value
   * across the `up`/`down` half-axis bindings.
   *
   * Sign convention matches the rest of the engine and the W3C Gamepad
   * API: `y < 0` means up (matching the canvas Y axis), `y > 0` means
   * down. This is the same direction `Gamepad.axes[1]` reports under
   * the standard mapping. Added in AC 40101 Sub-AC 1 so the unified
   * {@link InputService} can build a 2D `move` vector from one
   * dispatcher per fixed step instead of duplicating the analog
   * derivation in a parallel module.
   */
  sampleMoveY(slot: PlayerBindingsIndex): number {
    const profile = this.bindings.get(slot);
    let moveUp = 0;
    let moveDown = 0;
    for (let i = 0; i < profile.bindings.up.length; i += 1) {
      const binding = profile.bindings.up[i];
      if (binding === undefined) continue;
      const magnitude = this.bindingMagnitude(binding);
      if (magnitude > moveUp) moveUp = magnitude;
    }
    for (let i = 0; i < profile.bindings.down.length; i += 1) {
      const binding = profile.bindings.down[i];
      if (binding === undefined) continue;
      const magnitude = this.bindingMagnitude(binding);
      if (magnitude > moveDown) moveDown = magnitude;
    }
    // Symmetric to sampleMoveX — net sign tracks the harder-pushed
    // half-axis, magnitude is the delta. `down - up` keeps `y > 0`
    // pointing down, matching the canvas + Gamepad-API convention.
    return moveDown - moveUp;
  }

  /**
   * Build a {@link CharacterInput} record for one slot. Mirrors the M1
   * `LocalInputHandler.sample()` output so existing gameplay wiring can
   * swap in the dispatcher without any downstream edit.
   *
   * Drop-through gesture: a **rapid double-tap of the `down` action**
   * within {@link DOUBLE_TAP_DOWN_WINDOW_FRAMES}. Replaces the prior
   * `down + jump` chord per the user's spec ("a rapid double down
   * press makes us fall through the platforms"). The chord version
   * was clobbering ordinary fast-falls.
   */
  sampleCharacterInput(slot: PlayerBindingsIndex): CharacterInput {
    const moveX = this.sampleMoveX(slot);
    const jump = this.isActionHeld(slot, 'jump');
    const attack = this.isActionHeld(slot, 'attack');
    const down = this.isActionHeld(slot, 'down');
    // AC 60301 Sub-AC 1 — shield held flag flows through to the
    // runtime; whether the press is honoured this frame (cooldowns,
    // stun, broken state) is the `Character` layer's call.
    const shield = this.isActionHeld(slot, 'shield');
    const dropThrough = this.detectDoubleTapDown(slot, down);
    const moveY = this.sampleMoveY(slot);
    return {
      moveX,
      moveY,
      jump,
      attack,
      shield,
      dropThrough,
    };
  }

  /**
   * Per-slot rising-edge detector for the down action, with a window
   * latch so two rising edges within {@link DOUBLE_TAP_DOWN_WINDOW_FRAMES}
   * fire `dropThrough` for one frame. The frame counter is internal —
   * one tick per `sampleCharacterInput` call per slot — so the window
   * is measured in "input samples", which equals fixed-step frames in
   * production. A held-down (no rising edge) never fires the latch,
   * so a player holding crouch can never accidentally drop through.
   */
  private detectDoubleTapDown(slot: PlayerBindingsIndex, down: boolean): boolean {
    const latch: DropThroughLatch =
      this.dropThroughLatches.get(slot) ??
      { prevDown: false, lastDownPressFrame: -Infinity, frameCounter: 0 };
    const risingEdge = down && !latch.prevDown;
    const sinceLastPress = latch.frameCounter - latch.lastDownPressFrame;
    const isDoubleTap = risingEdge && sinceLastPress <= DOUBLE_TAP_DOWN_WINDOW_FRAMES;
    if (risingEdge) {
      // Reset the window on every rising edge — a triple-tap counts as
      // (single, double, single) so the player can't queue an
      // accidental third-tap drop after the second tap fired.
      latch.lastDownPressFrame = isDoubleTap ? -Infinity : latch.frameCounter;
    }
    latch.prevDown = down;
    latch.frameCounter += 1;
    this.dropThroughLatches.set(slot, latch);
    return isDoubleTap;
  }

  // -------------------------------------------------------------------------
  // Internals — binding evaluation
  // -------------------------------------------------------------------------

  /**
   * True iff a single {@link InputBinding} reports held this frame.
   * Exhaustively switches on `kind` so adding a new device family to
   * the schema fails to compile here until the dispatcher learns to
   * sample it. (TypeScript's `never` exhaustiveness check.)
   */
  private isBindingHeld(binding: InputBinding): boolean {
    switch (binding.kind) {
      case 'keyboard':
        return this.isKeyboardHeld(binding);
      case 'gamepad':
        return this.isGamepadHeld(binding);
      /* istanbul ignore next — exhaustiveness sentinel. */
      default: {
        const _exhaustive: never = binding;
        return _exhaustive;
      }
    }
  }

  private isKeyboardHeld(binding: KeyboardBinding): boolean {
    return this.keyboard.isDown(binding.keyCode);
  }

  private isGamepadHeld(binding: GamepadBinding): boolean {
    // `gamepadIndex === null` means "any pad" — used for menu confirms.
    // The dispatcher iterates every plausible index (0..3 covers slots
    // P3 + P4 plus a small buffer) and returns true on the first match.
    if (binding.gamepadIndex === null) {
      for (let i = 0; i < 4; i += 1) {
        if (this.gamepad.isConnected(i) && this.isGamepadSourceHeld(i, binding.source)) {
          return true;
        }
      }
      return false;
    }
    if (!this.gamepad.isConnected(binding.gamepadIndex)) return false;
    return this.isGamepadSourceHeld(binding.gamepadIndex, binding.source);
  }

  private isGamepadSourceHeld(gamepadIndex: number, source: GamepadBindingSource): boolean {
    if (source.type === 'button') {
      return this.gamepad.getButton(gamepadIndex, source.buttonIndex).pressed;
    }
    // Half-axis: axis * direction must clear the per-binding threshold.
    const axisValue = this.gamepad.getAxis(gamepadIndex, source.axisIndex);
    return axisValue * source.direction >= source.threshold;
  }

  /**
   * Magnitude in [0, 1] for a binding — `1` for a held digital input,
   * the analog axis value (clamped to [0, 1]) for a half-axis binding
   * once it crosses its threshold, `0` if released. Used by
   * {@link sampleMoveX} to preserve analog stick magnitude on `moveX`
   * for gamepad players.
   */
  private bindingMagnitude(binding: InputBinding): number {
    switch (binding.kind) {
      case 'keyboard':
        return this.isKeyboardHeld(binding) ? 1 : 0;
      case 'gamepad':
        return this.gamepadBindingMagnitude(binding);
      /* istanbul ignore next */
      default: {
        const _exhaustive: never = binding;
        return _exhaustive;
      }
    }
  }

  private gamepadBindingMagnitude(binding: GamepadBinding): number {
    const indices: number[] = [];
    if (binding.gamepadIndex === null) {
      for (let i = 0; i < 4; i += 1) {
        if (this.gamepad.isConnected(i)) indices.push(i);
      }
    } else if (this.gamepad.isConnected(binding.gamepadIndex)) {
      indices.push(binding.gamepadIndex);
    }
    let best = 0;
    for (const idx of indices) {
      if (binding.source.type === 'button') {
        const btn = this.gamepad.getButton(idx, binding.source.buttonIndex);
        if (btn.pressed) {
          // Trigger value lives in [0, 1] per the spec; some pads only
          // report 0/1 for digital buttons. Either way, a held button
          // contributes a full magnitude unless the device exposed an
          // analog value — in which case use that.
          const v = btn.value > 0 ? Math.min(1, btn.value) : 1;
          if (v > best) best = v;
        }
      } else {
        const axisValue = this.gamepad.getAxis(idx, binding.source.axisIndex);
        const signed = axisValue * binding.source.direction;
        if (signed >= binding.source.threshold) {
          const clamped = Math.min(1, Math.max(0, signed));
          if (clamped > best) best = clamped;
        }
      }
    }
    return best;
  }
}

// ---------------------------------------------------------------------------
// Test helpers — exported so the unit tests don't have to re-derive the
// neutral sentinel structure on every fixture.
// ---------------------------------------------------------------------------

/**
 * Frozen "all released" {@link ActionHeldMap}. Useful for assertions that
 * compare a slot's sample against a clean baseline.
 */
export const NEUTRAL_ACTION_MAP: ActionHeldMap = Object.freeze({
  left: false,
  right: false,
  up: false,
  down: false,
  jump: false,
  attack: false,
  special: false,
  shield: false,
  grab: false,
  taunt: false,
});
