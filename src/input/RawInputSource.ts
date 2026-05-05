/**
 * Raw input source — AC 50101 Sub-AC 1.
 *
 * Purpose
 * -------
 *
 * The M5 input stack is layered:
 *
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │  Gameplay scenes / menus / rebinding UI / replay tagger          │
 *   └────────────────────▲─────────────────────────────────────────────┘
 *                        │  unified action events / per-frame held maps
 *   ┌────────────────────┴─────────────────────────────────────────────┐
 *   │  InputBindingManager — diff-and-emit press / release / hold      │
 *   └────────────────────▲─────────────────────────────────────────────┘
 *                        │  per-slot ActionHeldMap
 *   ┌────────────────────┴─────────────────────────────────────────────┐
 *   │  DeviceInputDispatcher — maps held device state → logical action │
 *   └────────────────────▲─────────────────────────────────────────────┘
 *                        │  KeyboardSource.isDown / GamepadSource.get*
 *   ┌────────────────────┴─────────────────────────────────────────────┐
 *   │  RawInputSource    — THIS FILE                                   │
 *   │  • subscribes to browser / Phaser keyboard events                │
 *   │  • polls navigator.getGamepads() for button / axis deltas        │
 *   │  • emits normalised RawInputEvents with player-source attribution│
 *   └──────────────────────────────────────────────────────────────────┘
 *
 * Everything above this file consumes a *uniform* event vocabulary
 * (keydown / keyup / buttondown / buttonup / axischange). Everything
 * below this file is browser-specific. The split lets the unit suite
 * substitute a mock event target + mock gamepad snapshot and exercise
 * the entire pipeline without a real DOM.
 *
 * What "raw" means here
 * ---------------------
 *
 * Raw events carry the *physical* identifiers (keyCode, button index,
 * axis index, axis value) and the source they came from (keyboard, or
 * gamepad #N). They explicitly do *not* know about logical actions like
 * "jump" or "attack" — that translation happens one layer up in
 * {@link DeviceInputDispatcher} / {@link InputBindingManager}, which
 * read the active `PlayerBindings` and project the raw stream into
 * logical action edges.
 *
 * Player-source attribution
 * -------------------------
 *
 * Every emitted event carries a {@link RawInputDeviceSource} discriminator:
 *
 *   • `{ kind: 'keyboard' }`            — comes from the shared keyboard.
 *   • `{ kind: 'gamepad'; index: N }`   — comes from gamepad #N (per the
 *                                          W3C Gamepad API `Gamepad.index`).
 *
 * Higher layers consult the active {@link PlayerBindings} to map the
 * physical source onto a player slot (P1/P2 share the keyboard with
 * adjacent key clusters; P3/P4 typically each own a gamepad). The raw
 * source intentionally stays slot-agnostic so:
 *
 *   • A single keyboard event can fan out to both keyboard players' edge
 *     detectors — neither slot is privileged at the event-emission layer.
 *   • A pad reconnected at a different `Gamepad.index` doesn't require
 *     re-emission of past events; the layer above remaps via the binding
 *     store and the new attribution flows through automatically.
 *
 * Determinism
 * -----------
 *
 *   • The source is push-driven for keyboard (DOM events) and
 *     poll-driven for gamepads (`poll()` is called once per fixed step).
 *     The replay layer records the live `ActionHeldMap` derived above
 *     this module, not the raw event stream itself, so deterministic
 *     replay is unaffected by the absolute timing of DOM keydown calls.
 *   • No `Math.random()`, no wall-clock derived state inside the source.
 *     `timestamp` is read from `performance.now()` *only* when the
 *     adapter doesn't already provide one (`KeyboardEvent.timeStamp` and
 *     the poll's externally-supplied frame counter are preferred). The
 *     timestamp is a debug / UX field — replay determinism never reads
 *     it.
 *   • Phaser-decoupled. The browser adapter wraps DOM `addEventListener`
 *     calls; a Phaser-aware adapter in {@link createPhaserKeyboardEventTarget}
 *     wraps `scene.input.keyboard.on('keydown', ...)` so a scene that
 *     wants Phaser's keyboard capture (preventing arrow-key page scroll)
 *     can plug in without changing the source itself.
 *
 * Strict TypeScript
 * -----------------
 *
 * Compiled under `noUncheckedIndexedAccess + strict`. The emitted event
 * union is a discriminated union on `kind` so subscribers must handle
 * every event family or trip the exhaustiveness check.
 */

import type Phaser from 'phaser';

import type { GamepadSource } from './DeviceInputDispatcher';

// ---------------------------------------------------------------------------
// Player-source attribution
// ---------------------------------------------------------------------------

/**
 * Discriminator identifying the *physical* device that produced an event.
 *
 * Keyboard events do not carry a hardware index — the shared keyboard is
 * a single device split between two players via key clusters at the
 * binding layer. Gamepad events carry the W3C `Gamepad.index` of the
 * pad that produced them so the binding layer can route the event to
 * exactly the slot whose gamepad bindings reference that index.
 */
export type RawInputDeviceSource =
  | { readonly kind: 'keyboard' }
  | { readonly kind: 'gamepad'; readonly index: number };

/** Frozen sentinel for the keyboard source — avoids per-event allocation. */
export const KEYBOARD_DEVICE_SOURCE: RawInputDeviceSource = Object.freeze({
  kind: 'keyboard',
});

/**
 * Cached gamepad source descriptor for one physical pad index. The cache
 * is keyed by index so repeated polls of the same pad reuse the same
 * frozen object — the source is high-volume (one event per axis change
 * per frame is plausible) so allocating a new descriptor per emission
 * would noticeably churn the GC during a 4-player match.
 */
const GAMEPAD_DEVICE_SOURCE_CACHE = new Map<number, RawInputDeviceSource>();

/** Look up (or memoise) the frozen source descriptor for one pad index. */
export function gamepadDeviceSource(index: number): RawInputDeviceSource {
  let descriptor = GAMEPAD_DEVICE_SOURCE_CACHE.get(index);
  if (descriptor === undefined) {
    descriptor = Object.freeze({ kind: 'gamepad', index } as const);
    GAMEPAD_DEVICE_SOURCE_CACHE.set(index, descriptor);
  }
  return descriptor;
}

// ---------------------------------------------------------------------------
// Event shapes
// ---------------------------------------------------------------------------

/**
 * Event-kind discriminator. Three families reflect the three things the
 * runtime cares about:
 *
 *   • `keydown` / `keyup` — keyboard transitions.
 *   • `buttondown` / `buttonup` — gamepad button transitions.
 *   • `axischange` — gamepad analog axis crossed any deadzone OR moved
 *     more than a configurable epsilon since the last poll.
 *
 * Axis events do *not* carry a press / release sense — the per-binding
 * threshold logic (half-axes mapped to logical `left` / `right` etc.)
 * lives in {@link DeviceInputDispatcher}. Surfacing every axis movement
 * here lets the rebinding UI's "press an input…" capture window see and
 * record the exact axis + direction the player flicked.
 */
export type RawInputEventKind =
  | 'keydown'
  | 'keyup'
  | 'buttondown'
  | 'buttonup'
  | 'axischange';

/** Common header on every raw event. */
interface RawInputEventBase {
  readonly source: RawInputDeviceSource;
  /**
   * Frame counter at the time of emission. The runtime fixed-step loop
   * calls {@link RawInputSource.poll} with the current frame number;
   * keyboard events fired between polls are stamped with the most
   * recent frame. Replay tagging consumes this.
   */
  readonly frame: number;
  /**
   * Wall-clock timestamp (ms). Diagnostic only — replay determinism
   * never reads it. Defaults to the DOM event's `timeStamp` when one
   * is available, falling back to `performance.now()` so headless
   * tests stay deterministic without monkey-patching the global.
   */
  readonly timestamp: number;
}

/** Keyboard key transitioned to held this frame. */
export interface RawKeyDownEvent extends RawInputEventBase {
  readonly kind: 'keydown';
  readonly source: { readonly kind: 'keyboard' };
  readonly keyCode: number;
  /**
   * `true` when the OS is auto-repeating a held key. The runtime
   * filters auto-repeat events out of the press/release diff (held
   * state was already true), but exposes the flag for menus that want
   * key-repeat for navigation.
   */
  readonly repeat: boolean;
}

/** Keyboard key transitioned to released this frame. */
export interface RawKeyUpEvent extends RawInputEventBase {
  readonly kind: 'keyup';
  readonly source: { readonly kind: 'keyboard' };
  readonly keyCode: number;
}

/** Gamepad button transitioned from released → held this poll. */
export interface RawGamepadButtonDownEvent extends RawInputEventBase {
  readonly kind: 'buttondown';
  readonly source: { readonly kind: 'gamepad'; readonly index: number };
  readonly buttonIndex: number;
  /**
   * Trigger fill in [0, 1] at the moment of the down edge. Digital
   * buttons report `1`. Carrying the analog value here lets the
   * rebinding UI distinguish "trigger fully depressed" from "trigger
   * grazed past threshold".
   */
  readonly value: number;
}

/** Gamepad button transitioned from held → released this poll. */
export interface RawGamepadButtonUpEvent extends RawInputEventBase {
  readonly kind: 'buttonup';
  readonly source: { readonly kind: 'gamepad'; readonly index: number };
  readonly buttonIndex: number;
  /** Analog value at the release edge (typically 0 but not guaranteed). */
  readonly value: number;
}

/** Gamepad analog axis moved meaningfully since the previous poll. */
export interface RawGamepadAxisChangeEvent extends RawInputEventBase {
  readonly kind: 'axischange';
  readonly source: { readonly kind: 'gamepad'; readonly index: number };
  readonly axisIndex: number;
  /** Latest reported axis value in [-1, +1]. */
  readonly value: number;
  /** Previous polled value — useful for direction / delta diagnostics. */
  readonly previousValue: number;
}

/** Discriminated union of every emitted raw event. */
export type RawInputEvent =
  | RawKeyDownEvent
  | RawKeyUpEvent
  | RawGamepadButtonDownEvent
  | RawGamepadButtonUpEvent
  | RawGamepadAxisChangeEvent;

/** Listener signature for raw events. */
export type RawInputListener = (event: RawInputEvent) => void;

/** Returned from `addListener` — calling it deregisters the listener. */
export type RawInputUnsubscribe = () => void;

// ---------------------------------------------------------------------------
// Keyboard event-target abstraction
// ---------------------------------------------------------------------------

/**
 * Minimal subset of `EventTarget` the raw source listens on. Pulled into
 * an interface so the unit tests can hand in a hand-rolled mock without
 * touching the global DOM (and so a Phaser-aware adapter can wrap
 * `scene.input.keyboard.on(...)` instead of `document.addEventListener`).
 *
 * The surface is deliberately minimal — `keydown` and `keyup`. The
 * browser fires both reliably even with focus inside an `<iframe>` as
 * long as the iframe holds focus, which matches Phaser's expectations.
 */
export interface RawKeyboardEventTarget {
  addEventListener(
    type: 'keydown' | 'keyup',
    listener: (event: KeyboardEventLike) => void,
  ): void;
  removeEventListener(
    type: 'keydown' | 'keyup',
    listener: (event: KeyboardEventLike) => void,
  ): void;
}

/**
 * Subset of {@link KeyboardEvent} the raw source consumes. Allows the
 * test suite to dispatch a plain object literal as the event payload
 * without instantiating a real `KeyboardEvent` (which jsdom supports
 * but headless Vitest in node mode does not).
 *
 * `keyCode` is the legacy numeric identifier — same value the M1
 * binding store and `KEY_CODE` table reference. The DOM has been
 * deprecating `keyCode` for years but every supported browser still
 * fires it, and Phaser's keyboard plugin still surfaces it; we keep
 * using it for binding stability across milestones.
 */
export interface KeyboardEventLike {
  readonly keyCode: number;
  readonly repeat?: boolean;
  readonly timeStamp?: number;
  /**
   * Optional `preventDefault` for Phaser-style capture. The raw source
   * never calls this itself — that's the adapter's call (the Phaser
   * adapter relies on `addKey` / `enableCapture` to consume keys before
   * the page sees them).
   */
  preventDefault?(): void;
}

// ---------------------------------------------------------------------------
// Browser adapters
// ---------------------------------------------------------------------------

/**
 * Wrap `window` (or any `EventTarget`) into the {@link RawKeyboardEventTarget}
 * shape. Defaults to the browser `window` when called without an argument
 * so production code reads as `createBrowserKeyboardEventTarget()`.
 *
 * Why `window` and not `document`: focus-driven keyboard events bubble
 * to `window` reliably, even through Phaser's `<canvas>` — `document`
 * sees the same events but does not forward them when an `<iframe>`
 * sits in between, which is the GitHub Pages embed scenario.
 */
export function createBrowserKeyboardEventTarget(
  target: EventTarget | null = typeof window !== 'undefined' ? window : null,
): RawKeyboardEventTarget {
  if (target === null) {
    throw new Error(
      'createBrowserKeyboardEventTarget: no EventTarget available — pass an explicit target in headless test environments.',
    );
  }
  // The DOM signature accepts `(EventListener | EventListenerObject)`. We
  // narrow to a single-argument function and let the runtime cast handle
  // the variance — every supported engine treats the listener as a
  // function exactly equivalent to our typed interface.
  const adapt = (
    listener: (event: KeyboardEventLike) => void,
  ): EventListener => (ev) => listener(ev as unknown as KeyboardEventLike);
  const adapterCache = new WeakMap<
    (event: KeyboardEventLike) => void,
    EventListener
  >();
  return {
    addEventListener(type, listener): void {
      let bound = adapterCache.get(listener);
      if (bound === undefined) {
        bound = adapt(listener);
        adapterCache.set(listener, bound);
      }
      target.addEventListener(type, bound);
    },
    removeEventListener(type, listener): void {
      const bound = adapterCache.get(listener);
      if (bound !== undefined) target.removeEventListener(type, bound);
    },
  };
}

/**
 * Wrap a Phaser scene's keyboard plugin so the raw source can subscribe
 * via `scene.input.keyboard.on('keydown', ...)` — preserving Phaser's
 * key-capture semantics (no arrow-key page scroll, no Tab focus moves)
 * which a plain `window.addEventListener` would not get.
 *
 * The adapter is intentionally thin: Phaser's `KeyboardPlugin` already
 * exposes an `'keydown'` / `'keyup'` event whose payload matches the
 * legacy `KeyboardEvent` shape (it forwards the original DOM event),
 * so we only need a tiny on/off bridge.
 */
export function createPhaserKeyboardEventTarget(
  scene: Phaser.Scene,
): RawKeyboardEventTarget {
  const keyboard = scene.input.keyboard;
  if (!keyboard) {
    throw new Error(
      'createPhaserKeyboardEventTarget: scene.input.keyboard is unavailable — did the game config disable keyboard input?',
    );
  }
  return {
    addEventListener(type, listener): void {
      keyboard.on(type, listener as (event: KeyboardEventLike) => void);
    },
    removeEventListener(type, listener): void {
      keyboard.off(type, listener as (event: KeyboardEventLike) => void);
    },
  };
}

// ---------------------------------------------------------------------------
// RawInputSource
// ---------------------------------------------------------------------------

/**
 * Thresholds and limits the source uses while diffing gamepad state.
 *
 * `axisDeadzone` governs whether an axis change is loud enough to
 * publish — most pads idle with ±0.005 jitter on every axis, so a
 * tight epsilon is essential to avoid spamming subscribers with
 * meaningless events. The default (~3% of full deflection) is the
 * threshold used by the W3C input-mapping note and the existing
 * `DEFAULT_GAMEPAD_AXIS_THRESHOLD`'s sibling default.
 *
 * `maxGamepadIndex` caps how many pad slots we poll. Four covers the
 * full Seed roster (P3 + P4 + headroom for hot-swap). Polling beyond
 * the cap is a wasted `getGamepads()[i]` lookup.
 */
export interface RawInputSourceOptions {
  readonly keyboardTarget?: RawKeyboardEventTarget | null;
  readonly gamepad?: GamepadSource | null;
  readonly axisDeadzone?: number;
  readonly maxGamepadIndex?: number;
  /** Initial frame counter (defaults to 0 — first poll bumps this). */
  readonly initialFrame?: number;
}

/** Default deadzone — see {@link RawInputSourceOptions}. */
export const DEFAULT_AXIS_DEADZONE = 0.03;

/**
 * Capacity of the gamepad polling array. Four pads cover the Seed roster
 * (two keyboard + up to four pads, with the pad index space starting at
 * 0). Adjustable via {@link RawInputSourceOptions.maxGamepadIndex} so
 * tests can shrink the loop or future hot-swap UX can grow it.
 */
export const DEFAULT_MAX_GAMEPAD_INDEX = 4;

/**
 * Captured browser / Phaser keyboard + gamepad input source. Subscribes
 * to keyboard transitions on construction, polls gamepad state on every
 * `poll()` call, emits {@link RawInputEvent}s to listeners.
 *
 * The source owns:
 *
 *   • A subscription to the configured keyboard target (auto-removed on
 *     `destroy()`).
 *   • A snapshot of the last polled gamepad state per `(index, button)`
 *     and `(index, axis)` so deltas can be computed.
 *   • The current frame counter (advanced by `poll()`, defaults to 0).
 *
 * The source does NOT own:
 *
 *   • Held-state querying. That's the {@link KeyboardSource} /
 *     {@link GamepadSource} surface used by {@link DeviceInputDispatcher}.
 *     Split-stream design — the upper layers consume held state, this
 *     layer surfaces edges.
 *   • Logical action mapping. Raw events carry physical identifiers
 *     only (keyCode, button index, axis index).
 */
export class RawInputSource {
  private readonly keyboardTarget: RawKeyboardEventTarget | null;
  private readonly gamepad: GamepadSource | null;
  private readonly axisDeadzone: number;
  private readonly maxGamepadIndex: number;

  private readonly listeners = new Set<RawInputListener>();
  private frame: number;
  private destroyed = false;

  /** Last polled `pressed` flag for `(index, button)` — undefined when never seen. */
  private readonly buttonState = new Map<string, boolean>();
  /** Last polled axis value for `(index, axis)`. */
  private readonly axisState = new Map<string, number>();

  /** Bound keyboard handlers — kept on the instance so `destroy()` can detach them. */
  private readonly onKeyDown = (event: KeyboardEventLike): void => {
    if (this.destroyed) return;
    this.emit({
      kind: 'keydown',
      source: KEYBOARD_DEVICE_SOURCE as { readonly kind: 'keyboard' },
      keyCode: event.keyCode,
      repeat: event.repeat === true,
      frame: this.frame,
      timestamp: extractTimestamp(event),
    });
  };

  private readonly onKeyUp = (event: KeyboardEventLike): void => {
    if (this.destroyed) return;
    this.emit({
      kind: 'keyup',
      source: KEYBOARD_DEVICE_SOURCE as { readonly kind: 'keyboard' },
      keyCode: event.keyCode,
      frame: this.frame,
      timestamp: extractTimestamp(event),
    });
  };

  constructor(options: RawInputSourceOptions = {}) {
    this.keyboardTarget = options.keyboardTarget ?? null;
    this.gamepad = options.gamepad ?? null;
    const dz = options.axisDeadzone ?? DEFAULT_AXIS_DEADZONE;
    if (!Number.isFinite(dz) || dz < 0 || dz > 1) {
      throw new Error(
        `RawInputSource: axisDeadzone must be a finite number in [0, 1] (got ${String(dz)})`,
      );
    }
    this.axisDeadzone = dz;
    const cap = options.maxGamepadIndex ?? DEFAULT_MAX_GAMEPAD_INDEX;
    if (!Number.isInteger(cap) || cap < 0 || cap > 32) {
      throw new Error(
        `RawInputSource: maxGamepadIndex must be an integer in [0, 32] (got ${String(cap)})`,
      );
    }
    this.maxGamepadIndex = cap;
    this.frame = options.initialFrame ?? 0;

    if (this.keyboardTarget !== null) {
      this.keyboardTarget.addEventListener('keydown', this.onKeyDown);
      this.keyboardTarget.addEventListener('keyup', this.onKeyUp);
    }
  }

  // -------------------------------------------------------------------------
  // Subscription
  // -------------------------------------------------------------------------

  /**
   * Subscribe to every emitted {@link RawInputEvent}. Returns an
   * unsubscribe function — the caller must invoke it when the listener
   * is no longer needed (scene shutdown, manager disposal). Multiple
   * subscriptions are independent; each receives every event.
   */
  addListener(listener: RawInputListener): RawInputUnsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** True iff `addListener` was called and the unsubscribe wasn't yet. */
  hasListener(listener: RawInputListener): boolean {
    return this.listeners.has(listener);
  }

  /** Number of currently subscribed listeners — diagnostic only. */
  get listenerCount(): number {
    return this.listeners.size;
  }

  // -------------------------------------------------------------------------
  // Frame counter
  // -------------------------------------------------------------------------

  /** Read the most recent frame number stamped on emitted events. */
  getFrame(): number {
    return this.frame;
  }

  /** Manually update the frame counter — useful when running ahead of `poll()`. */
  setFrame(frame: number): void {
    if (!Number.isFinite(frame)) {
      throw new Error(`RawInputSource.setFrame: frame must be finite (got ${String(frame)})`);
    }
    this.frame = frame;
  }

  // -------------------------------------------------------------------------
  // Polling
  // -------------------------------------------------------------------------

  /**
   * Advance the frame counter and diff gamepad state. Keyboard events
   * are push-driven (DOM `keydown`/`keyup` listeners) and don't need
   * a poll; gamepads are inherently poll-driven (the W3C API does not
   * expose connect-or-button events with usable timing) so the runtime
   * loop calls `poll()` once per fixed step.
   *
   * The frame argument is forwarded onto every emitted event so replay
   * tagging can correlate raw activity with simulation frames. Passing
   * `undefined` keeps the previous frame number — useful when the
   * runtime polls without advancing simulation state (e.g. while paused).
   */
  poll(frame?: number): void {
    if (this.destroyed) return;
    if (frame !== undefined) {
      if (!Number.isFinite(frame)) {
        throw new Error(`RawInputSource.poll: frame must be finite (got ${String(frame)})`);
      }
      this.frame = frame;
    }
    if (this.gamepad === null) return;
    this.pollGamepads();
  }

  private pollGamepads(): void {
    const source = this.gamepad;
    if (source === null) return;
    for (let index = 0; index < this.maxGamepadIndex; index += 1) {
      if (!source.isConnected(index)) {
        // A pad that just disconnected leaves stale entries in our
        // snapshot maps. Clearing them ensures that on reconnect the
        // first observed state is treated as the baseline rather than
        // generating spurious "released" edges from a phantom held
        // button. We don't emit events for the disconnect itself —
        // that's the GamepadConnectionMonitor's job.
        this.discardSnapshotsForPad(index);
        continue;
      }
      // Buttons — iterate up to a generous cap. Most pads expose 12-17
      // buttons; the standard mapping reaches 16. A loose 32-button cap
      // covers extended pads (e.g. flight sticks repurposed as pads)
      // without paying for an unbounded scan.
      this.pollPadButtons(index);
      // Axes — same loose cap; the standard mapping uses 4 (two sticks).
      this.pollPadAxes(index);
    }
  }

  private pollPadButtons(index: number): void {
    const source = this.gamepad;
    if (source === null) return;
    for (let button = 0; button < BUTTON_SCAN_LIMIT; button += 1) {
      const state = source.getButton(index, button);
      const key = buttonKey(index, button);
      // Baseline: an unobserved button is treated as released so the
      // first poll only fires a `buttondown` if the pad genuinely
      // *starts* with a held button. A pad sitting at rest produces
      // zero events on the first poll because every released-and-still-
      // released slot collapses to the no-change branch below.
      const previous = this.buttonState.get(key) ?? false;
      const pressed = state.pressed === true;
      if (previous === pressed) continue;
      this.buttonState.set(key, pressed);
      const padSource = gamepadDeviceSource(index) as {
        readonly kind: 'gamepad';
        readonly index: number;
      };
      if (pressed) {
        this.emit({
          kind: 'buttondown',
          source: padSource,
          buttonIndex: button,
          value: state.value,
          frame: this.frame,
          timestamp: nowTimestamp(),
        });
      } else {
        this.emit({
          kind: 'buttonup',
          source: padSource,
          buttonIndex: button,
          value: state.value,
          frame: this.frame,
          timestamp: nowTimestamp(),
        });
      }
    }
  }

  private pollPadAxes(index: number): void {
    const source = this.gamepad;
    if (source === null) return;
    for (let axis = 0; axis < AXIS_SCAN_LIMIT; axis += 1) {
      const value = source.getAxis(index, axis);
      const key = axisKey(index, axis);
      // Baseline 0 — a never-observed axis is treated as resting at
      // neutral. An axis that *starts* deflected on the first poll
      // therefore generates exactly one `axischange` event with
      // `previousValue = 0`, which is the rebinding-UI-friendly shape
      // (the player flicked the stick from "neutral" before we were
      // listening, and we emit the implied edge as soon as we see it).
      const previous = this.axisState.get(key) ?? 0;
      const delta = Math.abs(value - previous);
      // Pure delta-based filtering. Crossing the deadzone in either
      // direction is captured by the `|delta|` check: a stick going
      // from `+0.6` to `0.0` produces a `0.6` delta which clears any
      // sane deadzone. Tiny idle jitter never crosses, so subscribers
      // aren't spammed when the player isn't touching the stick.
      if (delta < this.axisDeadzone) continue;
      this.axisState.set(key, value);
      const padSource = gamepadDeviceSource(index) as {
        readonly kind: 'gamepad';
        readonly index: number;
      };
      this.emit({
        kind: 'axischange',
        source: padSource,
        axisIndex: axis,
        value,
        previousValue: previous,
        frame: this.frame,
        timestamp: nowTimestamp(),
      });
    }
  }

  private discardSnapshotsForPad(index: number): void {
    const buttonPrefix = `b:${index}:`;
    for (const key of Array.from(this.buttonState.keys())) {
      if (key.startsWith(buttonPrefix)) this.buttonState.delete(key);
    }
    const axisPrefix = `a:${index}:`;
    for (const key of Array.from(this.axisState.keys())) {
      if (key.startsWith(axisPrefix)) this.axisState.delete(key);
    }
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Detach keyboard listeners and drop subscribers. Idempotent. After
   * `destroy()` further `poll()` calls are no-ops and emitted events
   * stop reaching listeners — the matched scene-shutdown semantics for
   * Phaser's plugin teardown.
   */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.keyboardTarget !== null) {
      this.keyboardTarget.removeEventListener('keydown', this.onKeyDown);
      this.keyboardTarget.removeEventListener('keyup', this.onKeyUp);
    }
    this.listeners.clear();
    this.buttonState.clear();
    this.axisState.clear();
  }

  /** True after {@link destroy} has been called. */
  isDestroyed(): boolean {
    return this.destroyed;
  }

  // -------------------------------------------------------------------------
  // Internal — emission
  // -------------------------------------------------------------------------

  private emit(event: RawInputEvent): void {
    if (this.listeners.size === 0) return;
    // Snapshot to a local array so a listener that adds / removes
    // subscribers mid-emit doesn't perturb the iteration order.
    const subscribers = Array.from(this.listeners);
    for (let i = 0; i < subscribers.length; i += 1) {
      const fn = subscribers[i];
      if (fn === undefined) continue;
      try {
        fn(event);
      } catch (err) {
        // Listener errors must not break the emission loop — a single
        // misbehaving subscriber shouldn't starve the others. We log
        // and continue. The logger is gated through `console.error`
        // exactly because the codebase already accepts that surface
        // for runtime input diagnostics (see RuntimeInputPipeline).
        // eslint-disable-next-line no-console
        console.error('RawInputSource: listener threw', err);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Maximum button index polled per pad. The W3C standard mapping spec
 * defines 17 buttons; 32 covers extended layouts without unbounded
 * iteration cost.
 */
const BUTTON_SCAN_LIMIT = 32;

/**
 * Maximum axis index polled per pad. Standard mapping uses 4 (two
 * sticks). 8 covers extended layouts (e.g. additional triggers reported
 * as axes on some pads) without churn.
 */
const AXIS_SCAN_LIMIT = 8;

function buttonKey(padIndex: number, buttonIndex: number): string {
  return `b:${padIndex}:${buttonIndex}`;
}

function axisKey(padIndex: number, axisIndex: number): string {
  return `a:${padIndex}:${axisIndex}`;
}

function extractTimestamp(event: KeyboardEventLike): number {
  const ts = event.timeStamp;
  if (typeof ts === 'number' && Number.isFinite(ts)) return ts;
  return nowTimestamp();
}

function nowTimestamp(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}
