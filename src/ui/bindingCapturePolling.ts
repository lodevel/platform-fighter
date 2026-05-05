/**
 * Phaser-free gamepad rising-edge poller for the M5 capture flow —
 * AC 40102 Sub-AC 2.
 *
 * Why this module exists
 * ----------------------
 *
 * The "press any key/button" capture flow has three signal sources:
 *
 *   1. Keyboard `keydown` events (one event per key press) — already
 *      handled directly by {@link RebindingScene} as a single
 *      `keydown` listener forwarding to `RebindingScreen.submitKeyboardCapture`.
 *      No state machine needed; the browser fires one event per press.
 *
 *   2. Gamepad button `pressed` flags — the W3C Gamepad API does NOT fire
 *      events for button transitions. Instead we have to poll
 *      `navigator.getGamepads()[i].buttons[b].pressed` every frame and
 *      detect the released → pressed *rising edge* ourselves. Without
 *      that latch, a player who happens to be holding any button when
 *      they click a row would instantly bind that button.
 *
 *   3. Gamepad axis deflections — same poll-only model. We compare each
 *      axis's sign-past-threshold this frame to the latched sign from
 *      last frame and only fire on a fresh deflection.
 *
 * The rising-edge logic ((1) requires no state, (2) and (3) require
 * per-pad latch maps) lives here as pure functions so it can be:
 *
 *   • Unit-tested under plain Node + vitest (no Phaser, no jsdom, no
 *     real Gamepad API).
 *   • Re-used by the eventual lobby "press any button to join" flow
 *     without forking the rising-edge implementation.
 *   • Independently audited — every decision (threshold value, "ignore
 *     null pads", "drop latches for missing pads") is explicit in pure
 *     code rather than buried inside a Phaser `update()` loop.
 *
 * The scene's `update()` becomes a thin two-call orchestration:
 *
 *   const events = pollGamepadCaptureEvents(snapshot, this.latches);
 *   for (const event of events) { … submit to screen … }
 *
 * This module deliberately speaks in primitives only — it never imports
 * Phaser and never reaches for the live `navigator`. Callers pass in the
 * snapshot they want polled and the latches they want maintained.
 *
 * Strict TypeScript: compiles under `noUncheckedIndexedAccess + strict`.
 */

import { CAPTURE_AXIS_TRIGGER_THRESHOLD } from './bindingCapture';

// ---------------------------------------------------------------------------
// Snapshot shape — the minimum subset of the W3C Gamepad object we read
// ---------------------------------------------------------------------------

/**
 * Minimal gamepad shape the poller consumes. The real `Gamepad` object
 * structurally satisfies this; tests build plain objects so they don't
 * need a real `navigator`.
 *
 * `buttons` and `axes` are required because every poll touches both.
 * `connected` is required so the poller can drop latches on a removed
 * pad without false-firing on the missing-pad slot.
 */
export interface PolledGamepadButton {
  readonly pressed: boolean;
}

export interface PolledGamepad {
  readonly connected: boolean;
  readonly buttons: ReadonlyArray<PolledGamepadButton>;
  readonly axes: ReadonlyArray<number>;
}

/**
 * Live snapshot returned by `navigator.getGamepads()`. The runtime
 * passes the array straight through; tests pass a hand-crafted array.
 * `null` slots are tolerated (a typical browser quirk on a freshly
 * connected pad).
 */
export type GamepadSnapshot = ReadonlyArray<PolledGamepad | null>;

// ---------------------------------------------------------------------------
// Latch shape — the rising-edge state we carry between polls
// ---------------------------------------------------------------------------

/**
 * Mutable latch maps the poller maintains across frames. The scene
 * owns one of these and reuses it every `update()`; the poller mutates
 * it in place so the cost per frame is one Map lookup per pad-button
 * and one Map lookup per pad-axis.
 *
 * Why a single struct rather than two top-level fields: the scene
 * teardown calls `clearLatches(this.latches)` once instead of two
 * `.clear()` calls. Tests build a fresh struct per case and assert
 * against it after each poll.
 */
export interface GamepadCaptureLatches {
  /**
   * Per-pad set of button indices that were `pressed === true` last
   * frame. The poller reads it to detect "newly pressed" buttons
   * (released → pressed rising edge) and writes the new set after
   * each poll.
   */
  buttons: Map<number, Set<number>>;
  /**
   * Per-pad map of axis-index → latched sign last frame. -1 / 0 / +1.
   * The poller treats |value| ≥ {@link CAPTURE_AXIS_TRIGGER_THRESHOLD}
   * as "deflected", anything else as "neutral". A fresh deflection
   * (sign now ≠ sign last AND sign now ≠ 0) fires a rising-edge event.
   */
  axes: Map<number, Map<number, -1 | 0 | 1>>;
}

/** Build a fresh, empty latches struct. */
export function createGamepadCaptureLatches(): GamepadCaptureLatches {
  return {
    buttons: new Map(),
    axes: new Map(),
  };
}

/** Drop every entry from the latches struct. Idempotent. */
export function clearGamepadCaptureLatches(latches: GamepadCaptureLatches): void {
  latches.buttons.clear();
  latches.axes.clear();
}

// ---------------------------------------------------------------------------
// Event shape — one entry per rising edge detected this poll
// ---------------------------------------------------------------------------

/**
 * Discriminated-union event the poller emits. The scene maps each
 * event to a single `RebindingScreen.submitGamepad*Capture(...)` call.
 *
 * Why a tagged union rather than two parallel arrays: callers iterate
 * the events in a single loop and the discriminant tells them which
 * submit method to call. A single loop also preserves event order
 * (button-first within a pad; pads in snapshot order) so the "first
 * input wins" capture semantics are deterministic.
 */
export type GamepadCaptureEvent =
  | {
      readonly kind: 'button';
      readonly gamepadIndex: number;
      readonly buttonIndex: number;
    }
  | {
      readonly kind: 'axis';
      readonly gamepadIndex: number;
      readonly axisIndex: number;
      readonly axisValue: number;
    };

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Poll the snapshot for new button presses and axis deflections, update
 * the latches in-place, and return every rising-edge event detected
 * this frame. The scene forwards the events to the screen one-by-one,
 * stopping on the first accepted commit (a single press should never
 * rebind two slots in a row).
 *
 * Behaviour contract:
 *
 *   • Buttons: a button fires iff `pressed === true` this frame and
 *     was not in the per-pad held-set last frame. The latch is updated
 *     to the new held-set regardless of whether any event fired.
 *   • Axes: an axis fires iff |value| ≥ threshold this frame and the
 *     latched sign for that axis was either 0 or the opposite sign
 *     last frame. The latch is updated to the new sign regardless of
 *     whether any event fired.
 *   • Disconnected / null pads: their latches are dropped so a re-plug
 *     doesn't see stale state. No events are emitted for them.
 *   • Snapshot order: pads are visited in `snapshot[0..N-1]` order,
 *     buttons in `pad.buttons[0..N-1]` order, axes in `pad.axes[0..N-1]`
 *     order. This is deterministic — the same snapshot + latches
 *     always produces the same event sequence.
 */
export function pollGamepadCaptureEvents(
  snapshot: GamepadSnapshot,
  latches: GamepadCaptureLatches,
): ReadonlyArray<GamepadCaptureEvent> {
  const events: GamepadCaptureEvent[] = [];

  for (let padIdx = 0; padIdx < snapshot.length; padIdx += 1) {
    const pad = snapshot[padIdx];
    if (!pad || pad.connected !== true) {
      // Pad gone — drop its latches so a future re-plug rebuilds them
      // from scratch on the next poll/idle refresh.
      latches.buttons.delete(padIdx);
      latches.axes.delete(padIdx);
      continue;
    }

    // ---- Buttons ---------------------------------------------------------
    const heldNow = new Set<number>();
    const heldPrev = latches.buttons.get(padIdx) ?? new Set<number>();
    for (let b = 0; b < pad.buttons.length; b += 1) {
      const btn = pad.buttons[b];
      if (btn && btn.pressed === true) {
        heldNow.add(b);
        if (!heldPrev.has(b)) {
          events.push({
            kind: 'button',
            gamepadIndex: padIdx,
            buttonIndex: b,
          });
        }
      }
    }
    latches.buttons.set(padIdx, heldNow);

    // ---- Axes ------------------------------------------------------------
    const axisLatchPrev = latches.axes.get(padIdx) ?? new Map<number, -1 | 0 | 1>();
    const axisLatchNow = new Map<number, -1 | 0 | 1>();
    for (let a = 0; a < pad.axes.length; a += 1) {
      const value = pad.axes[a] ?? 0;
      const signNow = axisSign(value);
      axisLatchNow.set(a, signNow);
      const signPrev = axisLatchPrev.get(a) ?? 0;
      // Rising edge: a non-neutral sign that differs from the latched
      // one (which can be 0 = neutral or the opposite sign).
      if (signNow !== 0 && signNow !== signPrev) {
        events.push({
          kind: 'axis',
          gamepadIndex: padIdx,
          axisIndex: a,
          axisValue: value,
        });
      }
    }
    latches.axes.set(padIdx, axisLatchNow);
  }

  return events;
}

/**
 * Refresh the latches from the snapshot WITHOUT emitting any events.
 * Called by the scene every frame while no capture session is active so
 * the next capture's first poll doesn't see a button that was already
 * held as a fresh rising edge.
 *
 * Behaviour mirrors {@link pollGamepadCaptureEvents} — the latches end
 * in the same state — but the event list is suppressed.
 */
export function refreshGamepadCaptureLatches(
  snapshot: GamepadSnapshot,
  latches: GamepadCaptureLatches,
): void {
  for (let padIdx = 0; padIdx < snapshot.length; padIdx += 1) {
    const pad = snapshot[padIdx];
    if (!pad || pad.connected !== true) {
      latches.buttons.delete(padIdx);
      latches.axes.delete(padIdx);
      continue;
    }
    const buttonsHeld = new Set<number>();
    for (let b = 0; b < pad.buttons.length; b += 1) {
      const btn = pad.buttons[b];
      if (btn && btn.pressed === true) buttonsHeld.add(b);
    }
    latches.buttons.set(padIdx, buttonsHeld);

    const axisLatch = new Map<number, -1 | 0 | 1>();
    for (let a = 0; a < pad.axes.length; a += 1) {
      const value = pad.axes[a] ?? 0;
      axisLatch.set(a, axisSign(value));
    }
    latches.axes.set(padIdx, axisLatch);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Bucket an axis value into `-1` / `0` / `+1` based on whether it is
 * past the capture threshold. Non-finite values (NaN, ±Infinity) are
 * treated as neutral so a misbehaving driver never fires a phantom
 * rebind.
 */
function axisSign(value: number): -1 | 0 | 1 {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  if (value >= CAPTURE_AXIS_TRIGGER_THRESHOLD) return 1;
  if (value <= -CAPTURE_AXIS_TRIGGER_THRESHOLD) return -1;
  return 0;
}
