/**
 * Next-input capture mechanism — AC 50003 Sub-AC 3.
 *
 * Purpose
 * -------
 *
 * The M5 rebinding milestone needs a single, named service that listens
 * for the *next* physical input (key press, gamepad button, or stick
 * deflection) after the player picks an action to remap, then writes
 * the captured input through to that (slot, action) binding entry.
 *
 * The rebinding UI in `src/ui/RebindingScreen.ts` already implements a
 * presentation-layer capture flow that paints `Press input…` into the
 * row and forwards `submitKeyboardCapture` / `submitGamepadButtonCapture` /
 * `submitGamepadAxisCapture` calls when the scene's input bridges fire.
 * That flow is great for the screen, but the screen owns Phaser text
 * objects, scene lifecycle, conflict-detection, and other concerns that
 * a non-UI consumer doesn't want to drag in.
 *
 * `NextInputCaptureController` is the *service-layer* equivalent:
 *
 *   • Subscribes to a {@link RawInputSource} and watches every emitted
 *     {@link RawInputEvent}.
 *   • When `start(slot, action)` is called, the *next* eligible event
 *     (a fresh keydown that isn't auto-repeat, a gamepad buttondown, or
 *     an axis deflection past threshold) is converted into the
 *     appropriate {@link InputBinding} and committed to a
 *     {@link NextInputCaptureTarget} (typically an
 *     {@link InputBindingProfileManager.setActionBindings} bound method).
 *   • The session resolves with a {@link NextInputCaptureResult} that
 *     describes which event was committed (or why capture was cancelled).
 *
 * The controller is deliberately Phaser-free, scene-free, and DOM-free.
 * It speaks only in `RawInputEvent`s and pure data. Anything that can
 * supply a {@link RawInputSource}-shaped emitter (the production browser
 * / Phaser source, the lobby's "press any button to join" flow, a unit
 * test driving synthetic events) can drive it.
 *
 * Architecture
 * ------------
 *
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │  RebindingScene / Lobby / Settings UI / unit tests              │
 *   │     ↓ start(slot, action) / cancel()                            │
 *   └────────────────────▲─────────────────────────────────────────────┘
 *                        │  NextInputCaptureResult callbacks
 *   ┌────────────────────┴─────────────────────────────────────────────┐
 *   │  NextInputCaptureController — THIS FILE                          │
 *   │  • subscribes to RawInputSource while a session is open          │
 *   │  • converts the first eligible event → InputBinding              │
 *   │  • writes through NextInputCaptureTarget.setActionBindings(...)  │
 *   │  • emits a result + tears down the subscription                  │
 *   └────────────────────▲─────────────────────────────────────────────┘
 *                        │  RawInputEvent
 *   ┌────────────────────┴─────────────────────────────────────────────┐
 *   │  RawInputSource (AC 50101 Sub-AC 1)                              │
 *   └──────────────────────────────────────────────────────────────────┘
 *
 * Why a dedicated module rather than fold-in to `RebindingScreen`
 * --------------------------------------------------------------
 *
 *   • Re-use — the lobby's "press any button to join Player N" flow is
 *     exactly the same shape (wait for next press, attribute it to a
 *     slot, write a binding). The lobby has no rebinding screen.
 *   • Testability — the controller exercises end-to-end without a Phaser
 *     scene, without jsdom, without a real `navigator.getGamepads()` —
 *     just a `RawInputSource` shim and a callback target.
 *   • Determinism — no `Math.random()`, no wall-clock reads, no closures
 *     captured into stored data. Two controllers driven with identical
 *     event streams produce identical commits in identical order.
 *
 * Strict TypeScript
 * -----------------
 *
 * Compiled under `noUncheckedIndexedAccess + strict`. The session result
 * is a discriminated union on `kind` so callers must handle every result
 * family or trip the exhaustiveness check.
 */

import {
  CAPTURE_AXIS_TRIGGER_THRESHOLD,
  CAPTURE_CANCEL_GAMEPAD_BUTTON,
  CAPTURE_CANCEL_KEYCODE,
} from '../ui/bindingCapture';
import type {
  BindingAction,
  GamepadBinding,
  InputBinding,
  KeyboardBinding,
  PlayerBindingIndex,
} from '../types/bindings';
import { DEFAULT_GAMEPAD_AXIS_THRESHOLD } from './InputBindingsStore';
import type {
  RawInputEvent,
  RawInputListener,
  RawInputUnsubscribe,
} from './RawInputSource';

// ---------------------------------------------------------------------------
// Public API surface
// ---------------------------------------------------------------------------

/**
 * Minimal target the controller writes captured bindings to. Production
 * code passes an {@link InputBindingProfileManager} (its
 * `setActionBindings.bind(manager)` satisfies the shape directly); tests
 * pass a recording stub.
 *
 * `resolveAction` is optional — supplied by the profile manager — and is
 * consulted only when the `mode: 'append'` option is used so the existing
 * binding list survives the capture commit.
 */
export interface NextInputCaptureTarget {
  /**
   * Replace the binding list for `(slot, action)` with the supplied
   * array. The same shape as
   * {@link InputBindingProfileManager.setActionBindings}.
   */
  setActionBindings(
    slot: PlayerBindingIndex,
    action: BindingAction,
    bindings: ReadonlyArray<InputBinding>,
  ): void;

  /**
   * Read the current bindings for `(slot, action)`. Used by `mode:
   * 'append'` to extend the list rather than replacing. Optional — the
   * controller falls back to a zero-length prefix when the target does
   * not implement it (so `append` degenerates to `replace` for callers
   * that supply a write-only target).
   */
  resolveAction?(
    slot: PlayerBindingIndex,
    action: BindingAction,
  ): ReadonlyArray<InputBinding>;
}

/**
 * Write semantics for a successful capture.
 *
 *   • `replace` (default) — discards the current binding list for the
 *     slot+action and writes a single-element list of the captured
 *     binding. Matches the rebinding screen's "this row is now ONLY this
 *     key" UX.
 *   • `append` — appends the captured binding to the existing list,
 *     preserving prior entries. Used by an "Add another binding for this
 *     action" UI variant. Falls back to `replace` semantics when the
 *     target does not implement {@link NextInputCaptureTarget.resolveAction}.
 */
export type NextInputCaptureMode = 'replace' | 'append';

/** Configuration for a single capture session. */
export interface NextInputCaptureOptions {
  /** Replace vs. append. Default `replace`. */
  readonly mode?: NextInputCaptureMode;

  /**
   * Keyboard keyCode that cancels the session. Defaults to ESC (27) —
   * the same constant the UI-layer capture flow uses. Pass any positive
   * integer to override (e.g. a "back to settings" button on a custom
   * input device); pass `null` to disable the keyboard cancel entirely.
   */
  readonly cancelKeyCode?: number | null;

  /**
   * Gamepad button index that cancels the session. Defaults to button 1
   * (B / Circle on the standard layout) — same as the UI-layer flow.
   * Pass any non-negative integer to override; pass `null` to disable
   * the gamepad cancel.
   */
  readonly cancelGamepadButton?: number | null;

  /**
   * Magnitude past which a gamepad axis movement counts as a fresh
   * deflection. Defaults to {@link CAPTURE_AXIS_TRIGGER_THRESHOLD}
   * (0.7) — slightly higher than the per-binding "is held" threshold
   * so stick-drift on a worn pad doesn't false-trigger a rebind.
   */
  readonly axisCaptureThreshold?: number;

  /**
   * Threshold baked into the *committed* gamepad axis binding. Defaults
   * to {@link DEFAULT_GAMEPAD_AXIS_THRESHOLD} (matches the shipped
   * preset's "is held" feel). Distinct from
   * {@link axisCaptureThreshold} which is the one-shot "did the player
   * just push it?" gate.
   */
  readonly axisBindingThreshold?: number;

  /**
   * When `true` (default), keyboard events flagged with `repeat: true`
   * (the OS auto-repeating a held key) are ignored so a player who
   * happens to be holding any key when they click an action row doesn't
   * instantly bind that key. Set to `false` for tests that want to
   * exercise the repeat path.
   */
  readonly ignoreKeyRepeat?: boolean;

  /**
   * When `true` (default), the session ignores `keyup` / `buttonup` /
   * "axis returned to neutral" events. Capture commits on the
   * *down*-edge / fresh-deflection only — a player intentionally
   * pressing the input they want bound, not the release that follows.
   * Set to `false` to capture release edges (no current consumer; kept
   * for future symmetry with edge-detection callers).
   */
  readonly ignoreReleaseEvents?: boolean;
}

/**
 * Reason a capture session ended without committing a binding. Mirrors
 * the existing {@link RebindingCaptureResult} reason vocabulary so the
 * UI screen and the controller speak the same words.
 */
export type NextInputCaptureCancelReason =
  | 'user_cancelled'
  | 'session_replaced'
  | 'controller_destroyed';

/**
 * Outcome of a capture session — either a committed binding or a reason
 * the session ended without one. Returned by the resolved promise from
 * {@link NextInputCaptureController.start} and by every listener
 * registered through {@link NextInputCaptureController.onResult}.
 */
export type NextInputCaptureResult =
  | {
      readonly kind: 'committed';
      readonly slot: PlayerBindingIndex;
      readonly action: BindingAction;
      readonly binding: InputBinding;
      readonly priorBindings: ReadonlyArray<InputBinding>;
      readonly nextBindings: ReadonlyArray<InputBinding>;
    }
  | {
      readonly kind: 'cancelled';
      readonly slot: PlayerBindingIndex;
      readonly action: BindingAction;
      readonly reason: NextInputCaptureCancelReason;
    };

/** Listener signature for capture results. */
export type NextInputCaptureListener = (result: NextInputCaptureResult) => void;

/** Snapshot of the active capture session, if any. */
export interface NextInputCaptureSession {
  readonly slot: PlayerBindingIndex;
  readonly action: BindingAction;
  readonly mode: NextInputCaptureMode;
}

/**
 * Constructor options for {@link NextInputCaptureController}. The
 * `source` field is the only required parameter — the controller defers
 * actually subscribing until {@link NextInputCaptureController.start}
 * is called, so a long-lived controller doesn't burn listener slots
 * while idle.
 */
export interface NextInputCaptureControllerOptions {
  /**
   * Raw input emitter the controller subscribes to while a session is
   * open. The controller calls `addListener` on `start()` and invokes
   * the returned unsubscribe on session end (commit / cancel / destroy).
   */
  readonly source: NextInputCaptureSourceLike;

  /**
   * Default capture target. May be omitted when every `start()` call
   * supplies its own `target` argument; supplied here so production
   * code can wire the {@link InputBindingProfileManager} once at
   * controller construction and reuse it for every session.
   */
  readonly target?: NextInputCaptureTarget;

  /**
   * Default options applied to every session. Per-call options on
   * {@link NextInputCaptureController.start} override these field-by-
   * field — both records are stripped of `undefined` before merging so
   * a per-call `mode: undefined` does NOT clobber a sensible default.
   */
  readonly defaults?: NextInputCaptureOptions;
}

/**
 * Minimal subset of {@link RawInputSource} the controller consumes —
 * just `addListener`. Pulled into an interface so tests can drive
 * synthetic event streams without instantiating a real source.
 */
export interface NextInputCaptureSourceLike {
  addListener(listener: RawInputListener): RawInputUnsubscribe;
}

// ---------------------------------------------------------------------------
// Internal session state
// ---------------------------------------------------------------------------

interface ActiveSession {
  readonly slot: PlayerBindingIndex;
  readonly action: BindingAction;
  readonly mode: NextInputCaptureMode;
  readonly target: NextInputCaptureTarget;
  readonly cancelKeyCode: number | null;
  readonly cancelGamepadButton: number | null;
  readonly axisCaptureThreshold: number;
  readonly axisBindingThreshold: number;
  readonly ignoreKeyRepeat: boolean;
  readonly ignoreReleaseEvents: boolean;
  /** Promise resolver fired when the session ends (commit or cancel). */
  readonly resolve: (result: NextInputCaptureResult) => void;
  /** Detach the raw-source listener bound to THIS session. */
  unsubscribe: RawInputUnsubscribe | null;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const VALID_SLOTS: ReadonlySet<PlayerBindingIndex> = new Set([1, 2, 3, 4]);

function assertValidSlot(slot: PlayerBindingIndex): void {
  if (!VALID_SLOTS.has(slot)) {
    throw new Error(
      `NextInputCaptureController: slot must be 1, 2, 3 or 4 (got ${String(slot)}).`,
    );
  }
}

function assertValidAction(action: BindingAction): void {
  if (typeof action !== 'string' || action.length === 0) {
    throw new Error(
      `NextInputCaptureController: action must be a non-empty string (got ${String(action)}).`,
    );
  }
}

function assertValidThreshold(value: number, label: string): void {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value <= 0 ||
    value > 1
  ) {
    throw new Error(
      `NextInputCaptureController: ${label} must be in (0, 1] (got ${String(value)}).`,
    );
  }
}

function stripUndefined<T extends object>(obj: T | undefined): Partial<T> {
  if (obj === undefined) return {};
  const out: Partial<T> = {};
  for (const key of Object.keys(obj) as Array<keyof T>) {
    const v = obj[key];
    if (v !== undefined) {
      out[key] = v;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Event → InputBinding conversion
// ---------------------------------------------------------------------------

/**
 * Build a {@link KeyboardBinding} from a captured `keydown` event.
 * Returns `null` when the event's keyCode is invalid (zero, NaN, non-
 * integer, negative) — the caller treats `null` as "ignore this event,
 * keep the session open" so a malformed event from a buggy adapter
 * doesn't permanently break a player's capture.
 */
function keyboardBindingFromKeyCode(keyCode: number): KeyboardBinding | null {
  if (
    typeof keyCode !== 'number' ||
    !Number.isFinite(keyCode) ||
    !Number.isInteger(keyCode) ||
    keyCode <= 0
  ) {
    return null;
  }
  return Object.freeze({ kind: 'keyboard', keyCode });
}

/**
 * Build a {@link GamepadBinding} for a captured button press. Returns
 * `null` when the button index is invalid (negative or non-integer).
 */
function gamepadButtonBinding(
  gamepadIndex: number,
  buttonIndex: number,
): GamepadBinding | null {
  if (
    typeof gamepadIndex !== 'number' ||
    !Number.isInteger(gamepadIndex) ||
    gamepadIndex < 0
  ) {
    return null;
  }
  if (
    typeof buttonIndex !== 'number' ||
    !Number.isInteger(buttonIndex) ||
    buttonIndex < 0
  ) {
    return null;
  }
  return Object.freeze({
    kind: 'gamepad',
    gamepadIndex,
    source: Object.freeze({ type: 'button', buttonIndex }),
  });
}

/**
 * Build a {@link GamepadBinding} for a captured half-axis deflection.
 * `axisValue` sign picks the half-axis direction; `threshold` is the
 * "is held" threshold baked into the binding.
 */
function gamepadAxisBinding(
  gamepadIndex: number,
  axisIndex: number,
  axisValue: number,
  threshold: number,
): GamepadBinding | null {
  if (
    typeof gamepadIndex !== 'number' ||
    !Number.isInteger(gamepadIndex) ||
    gamepadIndex < 0
  ) {
    return null;
  }
  if (
    typeof axisIndex !== 'number' ||
    !Number.isInteger(axisIndex) ||
    axisIndex < 0
  ) {
    return null;
  }
  if (
    typeof axisValue !== 'number' ||
    !Number.isFinite(axisValue) ||
    axisValue === 0
  ) {
    return null;
  }
  const direction: -1 | 1 = axisValue > 0 ? 1 : -1;
  return Object.freeze({
    kind: 'gamepad',
    gamepadIndex,
    source: Object.freeze({
      type: 'axis',
      axisIndex,
      direction,
      threshold,
    }),
  });
}

// ---------------------------------------------------------------------------
// NextInputCaptureController
// ---------------------------------------------------------------------------

/**
 * Service-layer next-input capture controller.
 *
 * Lifecycle:
 *
 *   const ctrl = new NextInputCaptureController({ source, target: manager });
 *   const result = await ctrl.start(1, 'jump');
 *   if (result.kind === 'committed') {
 *     console.log('player 1 jump bound to', result.binding);
 *   }
 *   ctrl.destroy();
 */
export class NextInputCaptureController {
  private readonly source: NextInputCaptureSourceLike;
  private readonly defaultTarget: NextInputCaptureTarget | null;
  private readonly defaults: NextInputCaptureOptions;
  private readonly resultListeners: NextInputCaptureListener[] = [];
  private active: ActiveSession | null = null;
  private destroyed = false;

  constructor(options: NextInputCaptureControllerOptions) {
    if (options.source === null || typeof options.source !== 'object') {
      throw new Error(
        'NextInputCaptureController: options.source is required and must implement addListener(...).',
      );
    }
    this.source = options.source;
    this.defaultTarget = options.target ?? null;
    this.defaults = stripUndefined(options.defaults) as NextInputCaptureOptions;
  }

  // -------------------------------------------------------------------------
  // Public read API
  // -------------------------------------------------------------------------

  /**
   * Active session metadata, or `null` when idle. Mirrors
   * {@link RebindingScreen.getActiveCapture} so the lobby / settings UI
   * can render a "Press input… for P{N} {action}" caption without a
   * direct dependency on the controller's private state.
   */
  getActiveSession(): NextInputCaptureSession | null {
    if (this.active === null) return null;
    return Object.freeze({
      slot: this.active.slot,
      action: this.active.action,
      mode: this.active.mode,
    });
  }

  /** True iff a session is currently waiting for an event. */
  isCapturing(): boolean {
    return this.active !== null;
  }

  /** True iff the controller has been disposed. */
  isDestroyed(): boolean {
    return this.destroyed;
  }

  // -------------------------------------------------------------------------
  // Listener subscription (broadcast)
  // -------------------------------------------------------------------------

  /**
   * Subscribe to every capture result emitted by this controller. The
   * returned function deregisters the listener; the controller also
   * clears every listener at {@link destroy}-time so listener closures
   * don't outlive the controller.
   *
   * Each listener receives the same {@link NextInputCaptureResult}
   * the matching `start()` promise resolves with, in registration
   * order. Useful for a sticky "last rebind: P1 jump → W" status
   * indicator that doesn't have to await the start promise itself.
   */
  onResult(listener: NextInputCaptureListener): () => void {
    this.resultListeners.push(listener);
    return () => {
      const i = this.resultListeners.indexOf(listener);
      if (i >= 0) this.resultListeners.splice(i, 1);
    };
  }

  // -------------------------------------------------------------------------
  // Session control
  // -------------------------------------------------------------------------

  /**
   * Begin a capture session for `(slot, action)`. Returns a promise that
   * resolves when the session ends — either a committed binding or a
   * cancellation result. The promise NEVER rejects: every outcome maps
   * to a {@link NextInputCaptureResult} variant so callers can use a
   * single `await` + discriminated-switch pattern instead of a
   * try/catch.
   *
   * Behaviour:
   *
   *   • If a session is already active when `start()` is called, the
   *     prior session is cancelled with reason `session_replaced` and
   *     its promise resolves before the new session opens.
   *   • The controller subscribes to the raw input source for the
   *     duration of the session. The subscription is dropped when the
   *     session ends — the source sees no listener while the controller
   *     is idle.
   *   • The first eligible event commits the session via
   *     `target.setActionBindings(...)`. "Eligible" means a fresh
   *     keydown (not auto-repeat unless `ignoreKeyRepeat: false`), a
   *     fresh gamepad buttondown, or an axischange past
   *     `axisCaptureThreshold`. Cancel events (ESC keydown, button 1
   *     down by default) end the session with `user_cancelled`.
   */
  start(
    slot: PlayerBindingIndex,
    action: BindingAction,
    options: NextInputCaptureOptions & { readonly target?: NextInputCaptureTarget } = {},
  ): Promise<NextInputCaptureResult> {
    if (this.destroyed) {
      throw new Error(
        'NextInputCaptureController.start: controller has been destroyed.',
      );
    }
    assertValidSlot(slot);
    assertValidAction(action);

    // Cancel any in-flight session BEFORE we read merged options — the
    // replaced session would otherwise see the new options and write
    // through the wrong target.
    if (this.active !== null) {
      this.cancelInternal(this.active, 'session_replaced');
    }

    const merged: NextInputCaptureOptions = {
      ...this.defaults,
      ...stripUndefined(options),
    };
    const target = options.target ?? this.defaultTarget;
    if (target === null) {
      throw new Error(
        'NextInputCaptureController.start: no target supplied and no default target was configured.',
      );
    }

    const axisCaptureThreshold =
      merged.axisCaptureThreshold ?? CAPTURE_AXIS_TRIGGER_THRESHOLD;
    assertValidThreshold(axisCaptureThreshold, 'axisCaptureThreshold');
    const axisBindingThreshold =
      merged.axisBindingThreshold ?? DEFAULT_GAMEPAD_AXIS_THRESHOLD;
    assertValidThreshold(axisBindingThreshold, 'axisBindingThreshold');

    return new Promise<NextInputCaptureResult>((resolve) => {
      const session: ActiveSession = {
        slot,
        action,
        mode: merged.mode ?? 'replace',
        target,
        cancelKeyCode:
          merged.cancelKeyCode === null
            ? null
            : merged.cancelKeyCode ?? CAPTURE_CANCEL_KEYCODE,
        cancelGamepadButton:
          merged.cancelGamepadButton === null
            ? null
            : merged.cancelGamepadButton ?? CAPTURE_CANCEL_GAMEPAD_BUTTON,
        axisCaptureThreshold,
        axisBindingThreshold,
        ignoreKeyRepeat: merged.ignoreKeyRepeat ?? true,
        ignoreReleaseEvents: merged.ignoreReleaseEvents ?? true,
        resolve,
        unsubscribe: null,
      };
      this.active = session;
      // Subscribe AFTER session is set so `handleEvent` sees the live
      // `this.active` field on the very first event (the source may
      // synchronously replay a buffered event when `addListener` is
      // called by some implementations).
      session.unsubscribe = this.source.addListener((event) =>
        this.handleEvent(event),
      );
    });
  }

  /**
   * Cancel the active session, resolving its promise with
   * `kind: 'cancelled', reason: 'user_cancelled'`. Idempotent — calling
   * while idle is a no-op. Returns the result that was emitted (or
   * `null` when there was nothing to cancel) so callers can route the
   * result through their own logic without subscribing.
   */
  cancel(): NextInputCaptureResult | null {
    if (this.active === null) return null;
    return this.cancelInternal(this.active, 'user_cancelled');
  }

  /**
   * Tear down the controller. Cancels any in-flight session with reason
   * `controller_destroyed`, clears every listener, and rejects future
   * `start()` calls. Idempotent.
   */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.active !== null) {
      this.cancelInternal(this.active, 'controller_destroyed');
    }
    this.resultListeners.length = 0;
  }

  // -------------------------------------------------------------------------
  // Event routing
  // -------------------------------------------------------------------------

  private handleEvent(event: RawInputEvent): void {
    const session = this.active;
    if (session === null) return;

    switch (event.kind) {
      case 'keydown':
        this.handleKeyDown(session, event.keyCode, event.repeat === true);
        return;
      case 'keyup':
        // Release edge — ignored under default `ignoreReleaseEvents:
        // true`. When disabled, treat the keyup as a generic event we
        // can build a binding from (rare; kept for symmetry).
        if (!session.ignoreReleaseEvents) {
          this.handleKeyDown(session, event.keyCode, false);
        }
        return;
      case 'buttondown':
        this.handleButtonDown(session, event.source.index, event.buttonIndex);
        return;
      case 'buttonup':
        if (!session.ignoreReleaseEvents) {
          this.handleButtonDown(session, event.source.index, event.buttonIndex);
        }
        return;
      case 'axischange':
        this.handleAxisChange(
          session,
          event.source.index,
          event.axisIndex,
          event.value,
        );
        return;
      /* istanbul ignore next — exhaustiveness check */
      default: {
        const _never: never = event;
        void _never;
        return;
      }
    }
  }

  private handleKeyDown(
    session: ActiveSession,
    keyCode: number,
    isRepeat: boolean,
  ): void {
    if (isRepeat && session.ignoreKeyRepeat) return;
    if (
      session.cancelKeyCode !== null &&
      keyCode === session.cancelKeyCode
    ) {
      this.cancelInternal(session, 'user_cancelled');
      return;
    }
    const binding = keyboardBindingFromKeyCode(keyCode);
    if (binding === null) return; // ignore invalid event, keep waiting
    this.commit(session, binding);
  }

  private handleButtonDown(
    session: ActiveSession,
    gamepadIndex: number,
    buttonIndex: number,
  ): void {
    if (
      session.cancelGamepadButton !== null &&
      buttonIndex === session.cancelGamepadButton
    ) {
      this.cancelInternal(session, 'user_cancelled');
      return;
    }
    const binding = gamepadButtonBinding(gamepadIndex, buttonIndex);
    if (binding === null) return;
    this.commit(session, binding);
  }

  private handleAxisChange(
    session: ActiveSession,
    gamepadIndex: number,
    axisIndex: number,
    axisValue: number,
  ): void {
    if (Math.abs(axisValue) < session.axisCaptureThreshold) return;
    const binding = gamepadAxisBinding(
      gamepadIndex,
      axisIndex,
      axisValue,
      session.axisBindingThreshold,
    );
    if (binding === null) return;
    this.commit(session, binding);
  }

  // -------------------------------------------------------------------------
  // Commit / cancel
  // -------------------------------------------------------------------------

  private commit(session: ActiveSession, binding: InputBinding): void {
    // Detach the listener BEFORE writing through the target so the
    // target's setActionBindings cannot synchronously trigger a new
    // event that re-enters this controller (e.g. a target that emits
    // a synthetic key event in tests).
    this.detach(session);

    const priorBindings = this.readPriorBindings(session);
    const nextBindings: ReadonlyArray<InputBinding> =
      session.mode === 'append'
        ? Object.freeze([...priorBindings, binding])
        : Object.freeze([binding]);

    session.target.setActionBindings(session.slot, session.action, nextBindings);

    const result: NextInputCaptureResult = Object.freeze({
      kind: 'committed',
      slot: session.slot,
      action: session.action,
      binding,
      priorBindings: Object.freeze([...priorBindings]),
      nextBindings,
    });
    // Clear `active` BEFORE resolving so a synchronous resolver can
    // call `start()` again without seeing the just-committed session.
    this.active = null;
    this.fanOut(result);
    session.resolve(result);
  }

  private cancelInternal(
    session: ActiveSession,
    reason: NextInputCaptureCancelReason,
  ): NextInputCaptureResult {
    this.detach(session);
    const result: NextInputCaptureResult = Object.freeze({
      kind: 'cancelled',
      slot: session.slot,
      action: session.action,
      reason,
    });
    if (this.active === session) {
      this.active = null;
    }
    this.fanOut(result);
    session.resolve(result);
    return result;
  }

  private detach(session: ActiveSession): void {
    const unsub = session.unsubscribe;
    session.unsubscribe = null;
    if (unsub !== null) {
      unsub();
    }
  }

  private readPriorBindings(
    session: ActiveSession,
  ): ReadonlyArray<InputBinding> {
    if (session.mode !== 'append') return [];
    const fn = session.target.resolveAction;
    if (typeof fn !== 'function') return [];
    return fn.call(session.target, session.slot, session.action);
  }

  private fanOut(result: NextInputCaptureResult): void {
    if (this.resultListeners.length === 0) return;
    // Snapshot so a listener that unsubscribes in its own callback
    // does not skip a sibling listener at index i+1.
    const listeners = [...this.resultListeners];
    for (const listener of listeners) {
      try {
        listener(result);
      } catch {
        // Swallow listener errors so one bad subscriber cannot break
        // the rest. Listeners are diagnostic / UI-glue only — the
        // promise resolution path is the source of truth.
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Convenience constructors
// ---------------------------------------------------------------------------

/**
 * Build a {@link NextInputCaptureController} that writes through an
 * {@link InputBindingProfileManager}. Convenience over the more general
 * constructor — the manager already implements the
 * {@link NextInputCaptureTarget} shape via its `setActionBindings`
 * method.
 *
 * Why a top-level helper rather than a static factory: keeps the
 * controller's constructor target-shape-agnostic (a future "settings
 * staging area" could implement the same write surface without being a
 * profile manager) while still letting common callers wire up in one
 * line.
 */
export function createNextInputCaptureForProfileManager(
  source: NextInputCaptureSourceLike,
  manager: NextInputCaptureTarget,
  defaults?: NextInputCaptureOptions,
): NextInputCaptureController {
  return new NextInputCaptureController({
    source,
    target: manager,
    ...(defaults !== undefined ? { defaults } : {}),
  });
}
