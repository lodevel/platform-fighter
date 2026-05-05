import { describe, it, expect } from 'vitest';
import {
  clearGamepadCaptureLatches,
  createGamepadCaptureLatches,
  pollGamepadCaptureEvents,
  refreshGamepadCaptureLatches,
  type GamepadCaptureEvent,
  type GamepadSnapshot,
  type PolledGamepad,
} from './bindingCapturePolling';
import { CAPTURE_AXIS_TRIGGER_THRESHOLD } from './bindingCapture';

/**
 * AC 40102 Sub-AC 2 — gamepad rising-edge poller.
 *
 * Locks down the "press any key/button" capture flow's gamepad half:
 *
 *   1. A button that was NOT pressed last frame and IS pressed this
 *      frame fires exactly one `button` event.
 *   2. A button held across multiple polls fires once on the first
 *      transition then nothing on subsequent polls — it never rebinds
 *      twice.
 *   3. An axis that crosses the capture threshold for the first time
 *      fires one `axis` event with the captured value (sign tells the
 *      caller which half-axis to bind).
 *   4. An axis already past threshold when polling begins (e.g. stick-
 *      drift) does NOT fire after the first idle refresh.
 *   5. A disconnected / null pad's latches are dropped so a re-plug
 *      doesn't fire phantom events.
 *   6. NaN / Infinity axis values are treated as neutral.
 *   7. The `refreshGamepadCaptureLatches` (idle) path mirrors the latch
 *      mutations of the active poll without emitting any events.
 *
 * Pure helpers, plain vitest — no Phaser, no real Gamepad API.
 */

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function buildPad(opts: {
  connected?: boolean;
  buttons?: ReadonlyArray<{ pressed: boolean }>;
  axes?: ReadonlyArray<number>;
}): PolledGamepad {
  return {
    connected: opts.connected ?? true,
    buttons: opts.buttons ?? [],
    axes: opts.axes ?? [],
  };
}

function snapshotOf(...pads: ReadonlyArray<PolledGamepad | null>): GamepadSnapshot {
  return pads;
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

describe('bindingCapturePolling — button rising-edge', () => {
  it('emits one event the frame a button transitions released → pressed', () => {
    const latches = createGamepadCaptureLatches();
    // Frame 0: nothing held.
    const snap0 = snapshotOf(
      buildPad({ buttons: [{ pressed: false }, { pressed: false }, { pressed: false }] }),
    );
    expect(pollGamepadCaptureEvents(snap0, latches)).toEqual([]);

    // Frame 1: button index 2 just pressed.
    const snap1 = snapshotOf(
      buildPad({ buttons: [{ pressed: false }, { pressed: false }, { pressed: true }] }),
    );
    const events = pollGamepadCaptureEvents(snap1, latches);
    expect(events).toEqual<GamepadCaptureEvent[]>([
      { kind: 'button', gamepadIndex: 0, buttonIndex: 2 },
    ]);
  });

  it('does not refire while a button is held across multiple polls', () => {
    const latches = createGamepadCaptureLatches();
    const heldPad = buildPad({ buttons: [{ pressed: true }] });
    // First press: one event.
    expect(pollGamepadCaptureEvents(snapshotOf(heldPad), latches)).toHaveLength(1);
    // Subsequent frames with the same held state: no events.
    expect(pollGamepadCaptureEvents(snapshotOf(heldPad), latches)).toEqual([]);
    expect(pollGamepadCaptureEvents(snapshotOf(heldPad), latches)).toEqual([]);
  });

  it('refires after a release-then-press cycle', () => {
    const latches = createGamepadCaptureLatches();
    const pressed = buildPad({ buttons: [{ pressed: true }] });
    const released = buildPad({ buttons: [{ pressed: false }] });
    expect(pollGamepadCaptureEvents(snapshotOf(pressed), latches)).toHaveLength(1);
    expect(pollGamepadCaptureEvents(snapshotOf(released), latches)).toEqual([]);
    expect(pollGamepadCaptureEvents(snapshotOf(pressed), latches)).toHaveLength(1);
  });

  it('emits events in (pad, button) snapshot order on simultaneous presses', () => {
    const latches = createGamepadCaptureLatches();
    const padA = buildPad({ buttons: [{ pressed: true }, { pressed: true }] });
    const padB = buildPad({ buttons: [{ pressed: true }] });
    const events = pollGamepadCaptureEvents(snapshotOf(padA, padB), latches);
    expect(events).toEqual<GamepadCaptureEvent[]>([
      { kind: 'button', gamepadIndex: 0, buttonIndex: 0 },
      { kind: 'button', gamepadIndex: 0, buttonIndex: 1 },
      { kind: 'button', gamepadIndex: 1, buttonIndex: 0 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Axes
// ---------------------------------------------------------------------------

describe('bindingCapturePolling — axis rising-edge', () => {
  it('emits a +1 axis event on a fresh positive deflection past threshold', () => {
    const latches = createGamepadCaptureLatches();
    const snap = snapshotOf(buildPad({ axes: [0.0, 0.95] }));
    const events = pollGamepadCaptureEvents(snap, latches);
    expect(events).toEqual<GamepadCaptureEvent[]>([
      { kind: 'axis', gamepadIndex: 0, axisIndex: 1, axisValue: 0.95 },
    ]);
  });

  it('emits a -1 axis event on a fresh negative deflection past threshold', () => {
    const latches = createGamepadCaptureLatches();
    const snap = snapshotOf(buildPad({ axes: [-0.9] }));
    const events = pollGamepadCaptureEvents(snap, latches);
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe('axis');
    if (events[0]?.kind === 'axis') {
      expect(events[0].axisValue).toBe(-0.9);
    }
  });

  it('does not refire while the stick stays past threshold in the same direction', () => {
    const latches = createGamepadCaptureLatches();
    const held = buildPad({ axes: [0.95] });
    expect(pollGamepadCaptureEvents(snapshotOf(held), latches)).toHaveLength(1);
    expect(pollGamepadCaptureEvents(snapshotOf(held), latches)).toEqual([]);
    expect(pollGamepadCaptureEvents(snapshotOf(held), latches)).toEqual([]);
  });

  it('refires when the stick returns through neutral and re-deflects', () => {
    const latches = createGamepadCaptureLatches();
    expect(
      pollGamepadCaptureEvents(snapshotOf(buildPad({ axes: [0.95] })), latches),
    ).toHaveLength(1);
    expect(
      pollGamepadCaptureEvents(snapshotOf(buildPad({ axes: [0] })), latches),
    ).toEqual([]);
    expect(
      pollGamepadCaptureEvents(snapshotOf(buildPad({ axes: [0.95] })), latches),
    ).toHaveLength(1);
  });

  it('refires when the stick crosses zero and deflects to the OPPOSITE direction', () => {
    const latches = createGamepadCaptureLatches();
    // First push +.
    expect(
      pollGamepadCaptureEvents(snapshotOf(buildPad({ axes: [0.95] })), latches),
    ).toHaveLength(1);
    // Snap to -0.9 (skipping a neutral frame). Sign changed → new event.
    const events = pollGamepadCaptureEvents(
      snapshotOf(buildPad({ axes: [-0.9] })),
      latches,
    );
    expect(events).toHaveLength(1);
    if (events[0]?.kind === 'axis') {
      expect(events[0].axisValue).toBe(-0.9);
    }
  });

  it('does NOT fire when the deflection is below the capture threshold', () => {
    const latches = createGamepadCaptureLatches();
    const events = pollGamepadCaptureEvents(
      snapshotOf(buildPad({ axes: [0.5, -0.6] })),
      latches,
    );
    expect(events).toEqual([]);
  });

  it('treats NaN / Infinity axis values as neutral', () => {
    const latches = createGamepadCaptureLatches();
    const events = pollGamepadCaptureEvents(
      snapshotOf(
        buildPad({
          axes: [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY],
        }),
      ),
      latches,
    );
    expect(events).toEqual([]);
  });

  it('uses the published trigger threshold constant', () => {
    const latches = createGamepadCaptureLatches();
    // Exactly at the threshold: trips.
    const eventsAt = pollGamepadCaptureEvents(
      snapshotOf(buildPad({ axes: [CAPTURE_AXIS_TRIGGER_THRESHOLD] })),
      latches,
    );
    expect(eventsAt).toHaveLength(1);
    // Reset and try just below: doesn't trip.
    clearGamepadCaptureLatches(latches);
    const eventsBelow = pollGamepadCaptureEvents(
      snapshotOf(
        buildPad({ axes: [CAPTURE_AXIS_TRIGGER_THRESHOLD - 0.001] }),
      ),
      latches,
    );
    expect(eventsBelow).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Disconnect / re-plug semantics
// ---------------------------------------------------------------------------

describe('bindingCapturePolling — disconnect handling', () => {
  it('drops latches for a pad that disappears (null slot)', () => {
    const latches = createGamepadCaptureLatches();
    const pad = buildPad({ buttons: [{ pressed: true }] });
    pollGamepadCaptureEvents(snapshotOf(pad), latches);
    expect(latches.buttons.has(0)).toBe(true);

    pollGamepadCaptureEvents(snapshotOf(null), latches);
    expect(latches.buttons.has(0)).toBe(false);
  });

  it('drops latches for a pad with connected=false', () => {
    const latches = createGamepadCaptureLatches();
    const onPad = buildPad({ buttons: [{ pressed: true }] });
    pollGamepadCaptureEvents(snapshotOf(onPad), latches);
    expect(latches.buttons.has(0)).toBe(true);

    const offPad = buildPad({
      connected: false,
      buttons: [{ pressed: true }],
    });
    const events = pollGamepadCaptureEvents(snapshotOf(offPad), latches);
    expect(events).toEqual([]);
    expect(latches.buttons.has(0)).toBe(false);
  });

  it('a re-plug after a disconnect emits a fresh rising-edge event', () => {
    const latches = createGamepadCaptureLatches();
    // Initial press, then disconnect → latches dropped.
    pollGamepadCaptureEvents(
      snapshotOf(buildPad({ buttons: [{ pressed: true }] })),
      latches,
    );
    pollGamepadCaptureEvents(snapshotOf(null), latches);
    // Re-plug with the button pressed: counts as a fresh edge because
    // we have no prior latch for this slot.
    const events = pollGamepadCaptureEvents(
      snapshotOf(buildPad({ buttons: [{ pressed: true }] })),
      latches,
    );
    expect(events).toEqual<GamepadCaptureEvent[]>([
      { kind: 'button', gamepadIndex: 0, buttonIndex: 0 },
    ]);
  });

  it('handles an empty / undefined snapshot without throwing', () => {
    const latches = createGamepadCaptureLatches();
    expect(pollGamepadCaptureEvents([], latches)).toEqual([]);
    expect(latches.buttons.size).toBe(0);
    expect(latches.axes.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Idle refresh
// ---------------------------------------------------------------------------

describe('bindingCapturePolling — idle latch refresh', () => {
  it('seeding a held button via refresh prevents a spurious rebind on next poll', () => {
    const latches = createGamepadCaptureLatches();
    // Idle frame: player is holding A while clicking the row.
    const heldPad = buildPad({ buttons: [{ pressed: true }] });
    refreshGamepadCaptureLatches(snapshotOf(heldPad), latches);
    // First active poll with the same state: no event (button was
    // already in the latched held-set).
    const events = pollGamepadCaptureEvents(snapshotOf(heldPad), latches);
    expect(events).toEqual([]);
  });

  it('seeding a deflected stick via refresh prevents axis false-fire on next poll', () => {
    const latches = createGamepadCaptureLatches();
    const driftPad = buildPad({ axes: [0.95] });
    refreshGamepadCaptureLatches(snapshotOf(driftPad), latches);
    const events = pollGamepadCaptureEvents(snapshotOf(driftPad), latches);
    expect(events).toEqual([]);
  });

  it('a button released between refresh and poll fires on the NEXT press', () => {
    const latches = createGamepadCaptureLatches();
    refreshGamepadCaptureLatches(
      snapshotOf(buildPad({ buttons: [{ pressed: true }] })),
      latches,
    );
    // Release: latch updates to "not held".
    refreshGamepadCaptureLatches(
      snapshotOf(buildPad({ buttons: [{ pressed: false }] })),
      latches,
    );
    // Press again: rising edge fires.
    const events = pollGamepadCaptureEvents(
      snapshotOf(buildPad({ buttons: [{ pressed: true }] })),
      latches,
    );
    expect(events).toHaveLength(1);
  });

  it('refresh drops latches for null/disconnected pads exactly like poll', () => {
    const latches = createGamepadCaptureLatches();
    refreshGamepadCaptureLatches(
      snapshotOf(buildPad({ buttons: [{ pressed: true }] })),
      latches,
    );
    refreshGamepadCaptureLatches(snapshotOf(null), latches);
    expect(latches.buttons.has(0)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Latches API
// ---------------------------------------------------------------------------

describe('bindingCapturePolling — latches struct', () => {
  it('createGamepadCaptureLatches returns empty maps', () => {
    const l = createGamepadCaptureLatches();
    expect(l.buttons.size).toBe(0);
    expect(l.axes.size).toBe(0);
  });

  it('clearGamepadCaptureLatches empties both maps and is idempotent', () => {
    const l = createGamepadCaptureLatches();
    pollGamepadCaptureEvents(
      snapshotOf(buildPad({ buttons: [{ pressed: true }], axes: [0.95] })),
      l,
    );
    expect(l.buttons.size).toBeGreaterThan(0);
    expect(l.axes.size).toBeGreaterThan(0);
    clearGamepadCaptureLatches(l);
    expect(l.buttons.size).toBe(0);
    expect(l.axes.size).toBe(0);
    // Calling it again on an already-empty struct is fine.
    clearGamepadCaptureLatches(l);
    expect(l.buttons.size).toBe(0);
  });
});
