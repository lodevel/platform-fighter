import { describe, expect, it } from 'vitest';

import {
  BindingMapResolver,
  type SemanticActionEvent,
} from './BindingMapResolver';
import {
  BINDING_ACTIONS,
  DEFAULT_GAMEPAD_AXIS_THRESHOLD,
  DEFAULT_KEYBOARD_P1_BINDINGS,
  DEFAULT_PLAYER_BINDINGS,
  type ActionMap,
  type GamepadBinding,
  type InputBinding,
  type KeyboardBinding,
} from '../types/bindings';
import type {
  RawGamepadAxisChangeEvent,
  RawGamepadButtonDownEvent,
  RawGamepadButtonUpEvent,
  RawInputEvent,
  RawKeyDownEvent,
  RawKeyUpEvent,
} from './RawInputSource';

/**
 * AC 50102 Sub-AC 2 — binding map resolver.
 *
 * Locks down the contract:
 *
 *   1. A `keydown` for a key bound to an action emits a `press` for that
 *      action; the matching `keyup` emits a `release`.
 *   2. Auto-repeat keydown emits `hold` (and is suppressible via
 *      `emitHold: false`).
 *   3. A single raw event for a key bound to multiple actions
 *      (defaults: W → moveUp + jump) emits one event per action.
 *   4. Multi-bind actions stay held while ANY binding remains held —
 *      releasing one binding while another is still held emits `hold`,
 *      not `release`.
 *   5. Gamepad button events translate to press/release on the action
 *      bound to that (padIndex, buttonIndex).
 *   6. Half-axis transitions: crossing the threshold emits `press`;
 *      dropping back under emits `release`. A sign flip in one event
 *      emits both a release for the formerly-held direction and a
 *      press for the newly-held direction.
 *   7. Pad-index attribution: events from a pad whose index doesn't
 *      match any binding emit nothing. `gamepadIndex: null` ("any pad")
 *      bindings fire on whichever pad sent the event.
 *   8. `setBindings()` swaps the active map without spurious press /
 *      release; the next event evaluates against the new map.
 *   9. `forceRelease()` emits a `release` for every still-held action
 *      and clears internal state so subsequent events re-establish
 *      from a clean baseline.
 *  10. `dispose()` makes `resolve()` a no-op.
 *  11. Events follow `BINDING_ACTIONS` declaration order regardless of
 *      which action(s) the raw event affected.
 *  12. Frame and timestamp are forwarded verbatim from the raw event.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const KC_W = 87;
const KC_A = 65;
const KC_F = 70;
const KC_SPACE = 32;

function keyDown(keyCode: number, frame = 0, timestamp = 0, repeat = false): RawKeyDownEvent {
  return Object.freeze({
    kind: 'keydown',
    source: { kind: 'keyboard' },
    keyCode,
    repeat,
    frame,
    timestamp,
  } as const);
}

function keyUp(keyCode: number, frame = 0, timestamp = 0): RawKeyUpEvent {
  return Object.freeze({
    kind: 'keyup',
    source: { kind: 'keyboard' },
    keyCode,
    frame,
    timestamp,
  } as const);
}

function buttonDown(
  padIndex: number,
  buttonIndex: number,
  frame = 0,
  value = 1,
): RawGamepadButtonDownEvent {
  return Object.freeze({
    kind: 'buttondown',
    source: { kind: 'gamepad', index: padIndex },
    buttonIndex,
    value,
    frame,
    timestamp: 0,
  } as const);
}

function buttonUp(
  padIndex: number,
  buttonIndex: number,
  frame = 0,
): RawGamepadButtonUpEvent {
  return Object.freeze({
    kind: 'buttonup',
    source: { kind: 'gamepad', index: padIndex },
    buttonIndex,
    value: 0,
    frame,
    timestamp: 0,
  } as const);
}

function axisChange(
  padIndex: number,
  axisIndex: number,
  value: number,
  previousValue: number,
  frame = 0,
): RawGamepadAxisChangeEvent {
  return Object.freeze({
    kind: 'axischange',
    source: { kind: 'gamepad', index: padIndex },
    axisIndex,
    value,
    previousValue,
    frame,
    timestamp: 0,
  } as const);
}

function bindingsFromKeys(map: Partial<Record<keyof ActionMap, number>>): ActionMap {
  const out: Record<keyof ActionMap, ReadonlyArray<InputBinding>> = {
    moveLeft: [],
    moveRight: [],
    moveUp: [],
    moveDown: [],
    jump: [],
    attack: [],
    special: [],
    shield: [],
    grab: [],
    dodge: [],
  };
  for (const action of BINDING_ACTIONS) {
    const keyCode = map[action];
    if (keyCode !== undefined) {
      const kb: KeyboardBinding = { kind: 'keyboard', keyCode };
      out[action] = Object.freeze([kb]);
    }
  }
  return Object.freeze(out);
}

function summarise(events: ReadonlyArray<SemanticActionEvent>): string[] {
  return events.map((e) => `${e.kind}:${e.action}`);
}

// ---------------------------------------------------------------------------
// Keyboard: press / release / hold
// ---------------------------------------------------------------------------

describe('BindingMapResolver — keyboard press / release / hold', () => {
  it('emits press on keydown for a bound action and release on keyup', () => {
    const r = new BindingMapResolver({
      playerIndex: 1,
      bindings: bindingsFromKeys({ jump: KC_SPACE }),
    });

    const press = r.resolve(keyDown(KC_SPACE, 1, 1000));
    expect(summarise(press)).toEqual(['press:jump']);
    expect(press[0]!.playerIndex).toBe(1);
    expect(press[0]!.frame).toBe(1);
    expect(press[0]!.timestamp).toBe(1000);
    expect(press[0]!.rawKind).toBe('keydown');
    expect(r.isActionHeld('jump')).toBe(true);

    const release = r.resolve(keyUp(KC_SPACE, 2, 2000));
    expect(summarise(release)).toEqual(['release:jump']);
    expect(release[0]!.frame).toBe(2);
    expect(release[0]!.timestamp).toBe(2000);
    expect(r.isActionHeld('jump')).toBe(false);
  });

  it('emits hold on auto-repeat keydown when emitHold is true (default)', () => {
    const r = new BindingMapResolver({
      playerIndex: 1,
      bindings: bindingsFromKeys({ attack: KC_F }),
    });

    const press = r.resolve(keyDown(KC_F, 1));
    expect(summarise(press)).toEqual(['press:attack']);

    const repeat1 = r.resolve(keyDown(KC_F, 2, 0, true));
    expect(summarise(repeat1)).toEqual(['hold:attack']);

    const repeat2 = r.resolve(keyDown(KC_F, 3, 0, true));
    expect(summarise(repeat2)).toEqual(['hold:attack']);

    const release = r.resolve(keyUp(KC_F, 4));
    expect(summarise(release)).toEqual(['release:attack']);
  });

  it('suppresses hold events when emitHold is false', () => {
    const r = new BindingMapResolver({
      playerIndex: 2,
      bindings: bindingsFromKeys({ attack: KC_F }),
      emitHold: false,
    });

    expect(summarise(r.resolve(keyDown(KC_F)))).toEqual(['press:attack']);
    expect(summarise(r.resolve(keyDown(KC_F, 1, 0, true)))).toEqual([]);
    expect(summarise(r.resolve(keyDown(KC_F, 2, 0, true)))).toEqual([]);
    expect(summarise(r.resolve(keyUp(KC_F)))).toEqual(['release:attack']);
  });

  it('emits zero events for a key not bound to any action', () => {
    const r = new BindingMapResolver({
      playerIndex: 1,
      bindings: bindingsFromKeys({ jump: KC_SPACE }),
    });
    expect(r.resolve(keyDown(99 /* unbound key */))).toEqual([]);
    expect(r.resolve(keyUp(99))).toEqual([]);
  });

  it('emits zero events on keyup for a key that was never pressed', () => {
    const r = new BindingMapResolver({
      playerIndex: 1,
      bindings: bindingsFromKeys({ jump: KC_SPACE }),
    });
    expect(r.resolve(keyUp(KC_SPACE))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Multi-action binding (single key → multiple actions)
// ---------------------------------------------------------------------------

describe('BindingMapResolver — one key bound to multiple actions', () => {
  it('emits one press per bound action when the shared key goes down', () => {
    // Default P1 keyboard: W binds both moveUp and jump.
    const r = new BindingMapResolver({
      playerIndex: 1,
      bindings: DEFAULT_KEYBOARD_P1_BINDINGS,
    });
    const events = r.resolve(keyDown(KC_W));
    // Order follows BINDING_ACTIONS — moveUp before jump.
    expect(summarise(events)).toEqual(['press:moveUp', 'press:jump']);
  });

  it('emits one release per bound action when the shared key goes up', () => {
    const r = new BindingMapResolver({
      playerIndex: 1,
      bindings: DEFAULT_KEYBOARD_P1_BINDINGS,
    });
    r.resolve(keyDown(KC_W));
    const events = r.resolve(keyUp(KC_W));
    expect(summarise(events)).toEqual(['release:moveUp', 'release:jump']);
  });

  it('emits hold for every shared action on auto-repeat', () => {
    const r = new BindingMapResolver({
      playerIndex: 1,
      bindings: DEFAULT_KEYBOARD_P1_BINDINGS,
    });
    r.resolve(keyDown(KC_W));
    const events = r.resolve(keyDown(KC_W, 1, 0, true));
    expect(summarise(events)).toEqual(['hold:moveUp', 'hold:jump']);
  });
});

// ---------------------------------------------------------------------------
// Multi-binding action (one action → multiple keys/buttons)
// ---------------------------------------------------------------------------

describe('BindingMapResolver — one action bound to multiple inputs', () => {
  it('stays held across a binding handoff (W down, A down, W up, A up)', () => {
    // Action `moveLeft` is multi-bound to W AND A here purely as a
    // test fixture — the schema explicitly supports per-action multi-
    // bind and the AC 50102 Sub-AC 2 contract demands the resolver
    // OR-s the bindings.
    const bindings: ActionMap = Object.freeze({
      moveLeft: Object.freeze([
        { kind: 'keyboard', keyCode: KC_W } satisfies KeyboardBinding,
        { kind: 'keyboard', keyCode: KC_A } satisfies KeyboardBinding,
      ]),
      moveRight: [],
      moveUp: [],
      moveDown: [],
      jump: [],
      attack: [],
      special: [],
      shield: [],
      grab: [],
      dodge: [],
    });
    const r = new BindingMapResolver({ playerIndex: 1, bindings, emitHold: false });

    // W down → press
    expect(summarise(r.resolve(keyDown(KC_W)))).toEqual(['press:moveLeft']);
    // A down → already held → no event (emitHold=false)
    expect(summarise(r.resolve(keyDown(KC_A)))).toEqual([]);
    // W up → A still held → no release
    expect(summarise(r.resolve(keyUp(KC_W)))).toEqual([]);
    // A up → fully released → release
    expect(summarise(r.resolve(keyUp(KC_A)))).toEqual(['release:moveLeft']);
  });

  it('emits hold (with emitHold true) when a second binding presses while one is held', () => {
    const bindings: ActionMap = Object.freeze({
      moveLeft: Object.freeze([
        { kind: 'keyboard', keyCode: KC_W } satisfies KeyboardBinding,
        { kind: 'keyboard', keyCode: KC_A } satisfies KeyboardBinding,
      ]),
      moveRight: [],
      moveUp: [],
      moveDown: [],
      jump: [],
      attack: [],
      special: [],
      shield: [],
      grab: [],
      dodge: [],
    });
    const r = new BindingMapResolver({ playerIndex: 1, bindings });

    expect(summarise(r.resolve(keyDown(KC_W)))).toEqual(['press:moveLeft']);
    expect(summarise(r.resolve(keyDown(KC_A)))).toEqual(['hold:moveLeft']);
  });

  it('keyboard + gamepad multi-bind: gamepad press while keyboard held emits hold', () => {
    const bindings: ActionMap = Object.freeze({
      moveLeft: [],
      moveRight: [],
      moveUp: [],
      moveDown: [],
      jump: Object.freeze([
        { kind: 'keyboard', keyCode: KC_SPACE } satisfies KeyboardBinding,
        {
          kind: 'gamepad',
          gamepadIndex: 0,
          source: { type: 'button', buttonIndex: 0 },
        } satisfies GamepadBinding,
      ]),
      attack: [],
      special: [],
      shield: [],
      grab: [],
      dodge: [],
    });
    const r = new BindingMapResolver({ playerIndex: 1, bindings });

    expect(summarise(r.resolve(keyDown(KC_SPACE)))).toEqual(['press:jump']);
    expect(summarise(r.resolve(buttonDown(0, 0)))).toEqual(['hold:jump']);
    expect(summarise(r.resolve(keyUp(KC_SPACE)))).toEqual(['hold:jump']);
    expect(summarise(r.resolve(buttonUp(0, 0)))).toEqual(['release:jump']);
  });
});

// ---------------------------------------------------------------------------
// Gamepad button bindings
// ---------------------------------------------------------------------------

describe('BindingMapResolver — gamepad buttons', () => {
  it('translates buttondown / buttonup into press / release for a pad-pinned binding', () => {
    const bindings: ActionMap = Object.freeze({
      moveLeft: [],
      moveRight: [],
      moveUp: [],
      moveDown: [],
      jump: Object.freeze([
        {
          kind: 'gamepad',
          gamepadIndex: 0,
          source: { type: 'button', buttonIndex: 0 },
        } satisfies GamepadBinding,
      ]),
      attack: [],
      special: [],
      shield: [],
      grab: [],
      dodge: [],
    });
    const r = new BindingMapResolver({ playerIndex: 3, bindings, emitHold: false });

    expect(summarise(r.resolve(buttonDown(0, 0, 5)))).toEqual(['press:jump']);
    expect(summarise(r.resolve(buttonUp(0, 0, 6)))).toEqual(['release:jump']);
  });

  it('ignores button events from a different pad index', () => {
    const bindings: ActionMap = Object.freeze({
      moveLeft: [],
      moveRight: [],
      moveUp: [],
      moveDown: [],
      jump: Object.freeze([
        {
          kind: 'gamepad',
          gamepadIndex: 0,
          source: { type: 'button', buttonIndex: 0 },
        } satisfies GamepadBinding,
      ]),
      attack: [],
      special: [],
      shield: [],
      grab: [],
      dodge: [],
    });
    const r = new BindingMapResolver({ playerIndex: 3, bindings });

    expect(r.resolve(buttonDown(1, 0))).toEqual([]); // wrong pad
    expect(r.isActionHeld('jump')).toBe(false);
  });

  it('any-pad bindings (gamepadIndex: null) fire on whichever pad sent the event', () => {
    const bindings: ActionMap = Object.freeze({
      moveLeft: [],
      moveRight: [],
      moveUp: [],
      moveDown: [],
      jump: Object.freeze([
        {
          kind: 'gamepad',
          gamepadIndex: null,
          source: { type: 'button', buttonIndex: 0 },
        } satisfies GamepadBinding,
      ]),
      attack: [],
      special: [],
      shield: [],
      grab: [],
      dodge: [],
    });
    const r = new BindingMapResolver({ playerIndex: 1, bindings, emitHold: false });

    expect(summarise(r.resolve(buttonDown(2, 0)))).toEqual(['press:jump']);
    expect(summarise(r.resolve(buttonUp(2, 0)))).toEqual(['release:jump']);
    // And on a different pad too:
    expect(summarise(r.resolve(buttonDown(3, 0)))).toEqual(['press:jump']);
    expect(summarise(r.resolve(buttonUp(3, 0)))).toEqual(['release:jump']);
  });
});

// ---------------------------------------------------------------------------
// Gamepad axes — half-axis press / release / sign flip
// ---------------------------------------------------------------------------

describe('BindingMapResolver — gamepad axes', () => {
  function leftRightBindings(): ActionMap {
    const left: GamepadBinding = {
      kind: 'gamepad',
      gamepadIndex: 0,
      source: {
        type: 'axis',
        axisIndex: 0,
        direction: -1,
        threshold: DEFAULT_GAMEPAD_AXIS_THRESHOLD,
      },
    };
    const right: GamepadBinding = {
      kind: 'gamepad',
      gamepadIndex: 0,
      source: {
        type: 'axis',
        axisIndex: 0,
        direction: +1,
        threshold: DEFAULT_GAMEPAD_AXIS_THRESHOLD,
      },
    };
    return Object.freeze({
      moveLeft: Object.freeze([left]),
      moveRight: Object.freeze([right]),
      moveUp: [],
      moveDown: [],
      jump: [],
      attack: [],
      special: [],
      shield: [],
      grab: [],
      dodge: [],
    });
  }

  it('crosses threshold positive: emits press for the +direction action only', () => {
    const r = new BindingMapResolver({
      playerIndex: 3,
      bindings: leftRightBindings(),
      emitHold: false,
    });

    // 0 → +0.7 — clears +threshold
    expect(summarise(r.resolve(axisChange(0, 0, 0.7, 0)))).toEqual(['press:moveRight']);
    expect(r.isActionHeld('moveRight')).toBe(true);
    expect(r.isActionHeld('moveLeft')).toBe(false);
  });

  it('returning under threshold emits release', () => {
    const r = new BindingMapResolver({
      playerIndex: 3,
      bindings: leftRightBindings(),
      emitHold: false,
    });

    r.resolve(axisChange(0, 0, 0.7, 0));
    expect(summarise(r.resolve(axisChange(0, 0, 0.2, 0.7)))).toEqual(['release:moveRight']);
    expect(r.isActionHeld('moveRight')).toBe(false);
  });

  it('sign flip emits release for the formerly-held direction AND press for the new one', () => {
    const r = new BindingMapResolver({
      playerIndex: 3,
      bindings: leftRightBindings(),
      emitHold: false,
    });

    // Push right
    r.resolve(axisChange(0, 0, 0.7, 0));
    expect(r.isActionHeld('moveRight')).toBe(true);

    // Whip to left in one event
    const flipped = r.resolve(axisChange(0, 0, -0.7, 0.7));
    // Order follows BINDING_ACTIONS — moveLeft before moveRight.
    expect(summarise(flipped)).toEqual(['press:moveLeft', 'release:moveRight']);
    expect(r.isActionHeld('moveLeft')).toBe(true);
    expect(r.isActionHeld('moveRight')).toBe(false);
  });

  it('axis movement under the threshold emits no events', () => {
    const r = new BindingMapResolver({
      playerIndex: 3,
      bindings: leftRightBindings(),
    });

    expect(r.resolve(axisChange(0, 0, 0.3, 0))).toEqual([]);
    expect(r.resolve(axisChange(0, 0, -0.3, 0.3))).toEqual([]);
    expect(r.isActionHeld('moveLeft')).toBe(false);
    expect(r.isActionHeld('moveRight')).toBe(false);
  });

  it('emits hold while the axis remains past threshold', () => {
    const r = new BindingMapResolver({
      playerIndex: 3,
      bindings: leftRightBindings(),
    });

    expect(summarise(r.resolve(axisChange(0, 0, 0.7, 0)))).toEqual(['press:moveRight']);
    expect(summarise(r.resolve(axisChange(0, 0, 0.85, 0.7)))).toEqual(['hold:moveRight']);
    expect(summarise(r.resolve(axisChange(0, 0, 1.0, 0.85)))).toEqual(['hold:moveRight']);
  });
});

// ---------------------------------------------------------------------------
// setBindings — live mid-session rebind
// ---------------------------------------------------------------------------

describe('BindingMapResolver — live rebind', () => {
  it('setBindings without emitting synthetic transitions', () => {
    const r = new BindingMapResolver({
      playerIndex: 1,
      bindings: bindingsFromKeys({ attack: KC_F }),
    });

    r.resolve(keyDown(KC_F));
    expect(r.isActionHeld('attack')).toBe(true);

    // Rebind attack from F → SPACE while F is still physically held.
    r.setBindings(bindingsFromKeys({ attack: KC_SPACE }));

    // No synthetic events on the swap itself — assert by inspection of
    // the held-action state: the F key is still in heldKeys but the new
    // bindings don't include F anywhere, so the action collapses to
    // "released" silently.
    expect(r.isActionHeld('attack')).toBe(false);

    // Now SPACE down emits a fresh press against the new map.
    expect(summarise(r.resolve(keyDown(KC_SPACE)))).toEqual(['press:attack']);
  });

  it('rebind that includes the still-pressed key keeps the action held', () => {
    // F bound to attack; player rebinds so F now also binds to special
    // (we'll model this by rebinding `special` to F while attack stays
    // bound to F). Both should be considered held immediately, with no
    // synthetic press.
    const r = new BindingMapResolver({
      playerIndex: 1,
      bindings: bindingsFromKeys({ attack: KC_F }),
    });

    r.resolve(keyDown(KC_F));
    expect(r.isActionHeld('attack')).toBe(true);

    r.setBindings(bindingsFromKeys({ attack: KC_F, special: KC_F }));

    expect(r.isActionHeld('attack')).toBe(true);
    expect(r.isActionHeld('special')).toBe(true);

    // Subsequent keyup releases both, and the events come in
    // BINDING_ACTIONS declaration order.
    expect(summarise(r.resolve(keyUp(KC_F)))).toEqual([
      'release:attack',
      'release:special',
    ]);
  });
});

// ---------------------------------------------------------------------------
// forceRelease / dispose / batch
// ---------------------------------------------------------------------------

describe('BindingMapResolver — lifecycle helpers', () => {
  it('forceRelease emits a release per held action and clears state', () => {
    const r = new BindingMapResolver({
      playerIndex: 1,
      bindings: DEFAULT_KEYBOARD_P1_BINDINGS,
    });

    // Hold W (jump + moveUp) and F (attack).
    r.resolve(keyDown(KC_W));
    r.resolve(keyDown(KC_F));

    const released = r.forceRelease(99, 12345);
    // Order follows BINDING_ACTIONS — moveUp first, then jump, then attack.
    expect(summarise(released)).toEqual(['release:moveUp', 'release:jump', 'release:attack']);
    for (const e of released) {
      expect(e.frame).toBe(99);
      expect(e.timestamp).toBe(12345);
    }

    expect(r.isActionHeld('jump')).toBe(false);
    expect(r.isActionHeld('moveUp')).toBe(false);
    expect(r.isActionHeld('attack')).toBe(false);

    // After forceRelease, a fresh keydown reads as a clean baseline
    // — no spurious hold from the cleared key memory.
    expect(summarise(r.resolve(keyDown(KC_F)))).toEqual(['press:attack']);
  });

  it('forceRelease defaults frame to -1 and supplies a numeric timestamp', () => {
    const r = new BindingMapResolver({
      playerIndex: 1,
      bindings: bindingsFromKeys({ jump: KC_SPACE }),
    });
    r.resolve(keyDown(KC_SPACE));
    const released = r.forceRelease();
    expect(released).toHaveLength(1);
    expect(released[0]!.frame).toBe(-1);
    expect(typeof released[0]!.timestamp).toBe('number');
    expect(Number.isFinite(released[0]!.timestamp)).toBe(true);
  });

  it('dispose makes resolve a no-op and clears held state', () => {
    const r = new BindingMapResolver({
      playerIndex: 1,
      bindings: bindingsFromKeys({ jump: KC_SPACE }),
    });
    r.resolve(keyDown(KC_SPACE));
    expect(r.isActionHeld('jump')).toBe(true);

    r.dispose();
    expect(r.isDisposed()).toBe(true);
    expect(r.isActionHeld('jump')).toBe(false);
    expect(r.resolve(keyUp(KC_SPACE))).toEqual([]);
    expect(r.forceRelease(0)).toEqual([]);

    // Idempotent.
    r.dispose();
    expect(r.isDisposed()).toBe(true);
  });

  it('resolveBatch concatenates events from a sequence of raw events', () => {
    const r = new BindingMapResolver({
      playerIndex: 1,
      bindings: bindingsFromKeys({ jump: KC_SPACE, attack: KC_F }),
      emitHold: false,
    });

    const events: RawInputEvent[] = [
      keyDown(KC_SPACE, 1),
      keyDown(KC_F, 1),
      keyUp(KC_SPACE, 2),
      keyUp(KC_F, 2),
    ];
    const semantic = r.resolveBatch(events);
    expect(summarise(semantic)).toEqual([
      'press:jump',
      'press:attack',
      'release:jump',
      'release:attack',
    ]);
  });
});

// ---------------------------------------------------------------------------
// PlayerBinding wrapper acceptance
// ---------------------------------------------------------------------------

describe('BindingMapResolver — accepts PlayerBinding wrapper', () => {
  it('unwraps the .bindings ActionMap from a PlayerBinding', () => {
    const profile = DEFAULT_PLAYER_BINDINGS[1];
    const r = new BindingMapResolver({ playerIndex: 1, bindings: profile });
    // Default P1: W binds to moveUp + jump.
    expect(summarise(r.resolve(keyDown(KC_W)))).toEqual(['press:moveUp', 'press:jump']);
  });
});

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

describe('BindingMapResolver — snapshotHeldActions', () => {
  it('returns a frozen copy of the latest held bitmap', () => {
    const r = new BindingMapResolver({
      playerIndex: 1,
      bindings: bindingsFromKeys({ jump: KC_SPACE, attack: KC_F }),
    });

    const empty = r.snapshotHeldActions();
    expect(Object.isFrozen(empty)).toBe(true);
    for (const action of BINDING_ACTIONS) expect(empty[action]).toBe(false);

    r.resolve(keyDown(KC_SPACE));
    const oneHeld = r.snapshotHeldActions();
    expect(oneHeld.jump).toBe(true);
    expect(oneHeld.attack).toBe(false);

    // The previous snapshot must NOT have mutated.
    expect(empty.jump).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// playerIndex stamping + rawKind forwarding
// ---------------------------------------------------------------------------

describe('BindingMapResolver — output event metadata', () => {
  it('stamps every event with the configured playerIndex', () => {
    const r = new BindingMapResolver({
      playerIndex: 4,
      bindings: bindingsFromKeys({ jump: KC_SPACE }),
    });
    const events = r.resolve(keyDown(KC_SPACE));
    expect(events[0]!.playerIndex).toBe(4);
    expect(r.getPlayerIndex()).toBe(4);
  });

  it('forwards the raw event kind verbatim onto rawKind', () => {
    const r = new BindingMapResolver({
      playerIndex: 1,
      bindings: bindingsFromKeys({ jump: KC_SPACE }),
    });
    const press = r.resolve(keyDown(KC_SPACE));
    expect(press[0]!.rawKind).toBe('keydown');

    const release = r.resolve(keyUp(KC_SPACE));
    expect(release[0]!.rawKind).toBe('keyup');
  });

  it('produces frozen events suitable for replay round-trip', () => {
    const r = new BindingMapResolver({
      playerIndex: 1,
      bindings: bindingsFromKeys({ jump: KC_SPACE }),
    });
    const press = r.resolve(keyDown(KC_SPACE));
    expect(press).toHaveLength(1);
    expect(Object.isFrozen(press[0])).toBe(true);
    // JSON-serialisable.
    const json = JSON.stringify(press[0]);
    const parsed = JSON.parse(json) as SemanticActionEvent;
    expect(parsed.kind).toBe('press');
    expect(parsed.action).toBe('jump');
    expect(parsed.playerIndex).toBe(1);
  });
});
