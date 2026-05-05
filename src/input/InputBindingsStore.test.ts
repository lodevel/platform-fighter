import { describe, it, expect } from 'vitest';
import {
  DEFAULT_GAMEPAD_AXIS_THRESHOLD,
  DEFAULT_GAMEPAD_P3_BINDINGS,
  DEFAULT_GAMEPAD_P4_BINDINGS,
  DEFAULT_KEYBOARD_P1_BINDINGS,
  DEFAULT_KEYBOARD_P2_BINDINGS,
  DEFAULT_PLAYER_BINDINGS,
  InputBindingsStore,
  assertValidPlayerBindings,
  buildDefaultGamepadBindings,
  mergeBindingsWithDefaults,
} from './InputBindingsStore';
import type { PartialPlayerBindings } from './InputBindingsStore';
import { KEY_CODE } from './keyCodes';
import { LOGICAL_ACTIONS } from '../types/inputBindings';
import type {
  GamepadBinding,
  KeyboardBinding,
  PlayerBindings,
  PlayerBindingsIndex,
} from '../types/inputBindings';

/**
 * AC 40002 Sub-AC 2 — per-player input bindings store.
 *
 * Locks down:
 *
 *   1. Default presets — slots 1/2 carry the M1 keyboard layouts
 *      (WASD + arrows/numpad); slots 3/4 carry the standard-layout
 *      gamepad preset on pad index 0 / 1.
 *   2. Coverage — every {@link LogicalAction} has at least one binding
 *      in every default; the rebinding UI can render a complete row
 *      list out of the box without needing to invent fallbacks.
 *   3. Get / set / reset accessors — value is round-tripped through
 *      `set` losslessly, single-action writes leave siblings alone,
 *      `reset` and `resetAll` restore defaults verbatim.
 *   4. Validation — corrupted payloads (wrong slot, missing actions,
 *      bad keyCode, bad axis threshold, unknown kind) throw with a
 *      descriptive error.
 *   5. Immutability — `get` returns frozen objects so a caller can't
 *      mutate the store from the outside.
 *   6. Determinism — defaults are stable, so two stores built at
 *      different times produce identical snapshots; `JSON.stringify`
 *      of a snapshot is byte-stable across instances.
 */

// ---------------------------------------------------------------------------
// Default presets
// ---------------------------------------------------------------------------

describe('Default keyboard presets', () => {
  it('P1 keyboard preset binds movement to WASD', () => {
    const kbBinding = (action: keyof typeof DEFAULT_KEYBOARD_P1_BINDINGS) =>
      DEFAULT_KEYBOARD_P1_BINDINGS[action][0] as KeyboardBinding;
    expect(kbBinding('left').keyCode).toBe(KEY_CODE.A);
    expect(kbBinding('right').keyCode).toBe(KEY_CODE.D);
    expect(kbBinding('up').keyCode).toBe(KEY_CODE.W);
    expect(kbBinding('down').keyCode).toBe(KEY_CODE.S);
    expect(kbBinding('jump').keyCode).toBe(KEY_CODE.W);
  });

  it('P1 keyboard preset puts attacks on the F/G/H/T/R cluster', () => {
    const kbBinding = (action: keyof typeof DEFAULT_KEYBOARD_P1_BINDINGS) =>
      DEFAULT_KEYBOARD_P1_BINDINGS[action][0] as KeyboardBinding;
    expect(kbBinding('attack').keyCode).toBe(KEY_CODE.F);
    expect(kbBinding('special').keyCode).toBe(KEY_CODE.G);
    expect(kbBinding('shield').keyCode).toBe(KEY_CODE.H);
    expect(kbBinding('grab').keyCode).toBe(KEY_CODE.T);
    expect(kbBinding('taunt').keyCode).toBe(KEY_CODE.R);
  });

  it('P2 keyboard preset binds movement to arrow keys', () => {
    const kbBinding = (action: keyof typeof DEFAULT_KEYBOARD_P2_BINDINGS) =>
      DEFAULT_KEYBOARD_P2_BINDINGS[action][0] as KeyboardBinding;
    expect(kbBinding('left').keyCode).toBe(KEY_CODE.ARROW_LEFT);
    expect(kbBinding('right').keyCode).toBe(KEY_CODE.ARROW_RIGHT);
    expect(kbBinding('up').keyCode).toBe(KEY_CODE.ARROW_UP);
    expect(kbBinding('down').keyCode).toBe(KEY_CODE.ARROW_DOWN);
    expect(kbBinding('jump').keyCode).toBe(KEY_CODE.ARROW_UP);
  });

  it('P2 keyboard preset puts attacks on the Numpad cluster', () => {
    const kbBinding = (action: keyof typeof DEFAULT_KEYBOARD_P2_BINDINGS) =>
      DEFAULT_KEYBOARD_P2_BINDINGS[action][0] as KeyboardBinding;
    expect(kbBinding('attack').keyCode).toBe(KEY_CODE.NUMPAD_1);
    expect(kbBinding('special').keyCode).toBe(KEY_CODE.NUMPAD_2);
    expect(kbBinding('shield').keyCode).toBe(KEY_CODE.NUMPAD_3);
    expect(kbBinding('grab').keyCode).toBe(KEY_CODE.NUMPAD_4);
    expect(kbBinding('taunt').keyCode).toBe(KEY_CODE.NUMPAD_5);
  });

  it('every keyboard preset action has at least one binding entry', () => {
    for (const action of LOGICAL_ACTIONS) {
      expect(DEFAULT_KEYBOARD_P1_BINDINGS[action].length).toBeGreaterThanOrEqual(1);
      expect(DEFAULT_KEYBOARD_P2_BINDINGS[action].length).toBeGreaterThanOrEqual(1);
    }
  });

  it('keyboard presets carry kind = "keyboard" on every binding', () => {
    for (const action of LOGICAL_ACTIONS) {
      for (const b of DEFAULT_KEYBOARD_P1_BINDINGS[action]) expect(b.kind).toBe('keyboard');
      for (const b of DEFAULT_KEYBOARD_P2_BINDINGS[action]) expect(b.kind).toBe('keyboard');
    }
  });

  it('P1 and P2 keyboard presets do not collide on movement keys', () => {
    const p1Move = new Set([
      (DEFAULT_KEYBOARD_P1_BINDINGS.left[0] as KeyboardBinding).keyCode,
      (DEFAULT_KEYBOARD_P1_BINDINGS.right[0] as KeyboardBinding).keyCode,
      (DEFAULT_KEYBOARD_P1_BINDINGS.up[0] as KeyboardBinding).keyCode,
      (DEFAULT_KEYBOARD_P1_BINDINGS.down[0] as KeyboardBinding).keyCode,
    ]);
    const p2Move = [
      (DEFAULT_KEYBOARD_P2_BINDINGS.left[0] as KeyboardBinding).keyCode,
      (DEFAULT_KEYBOARD_P2_BINDINGS.right[0] as KeyboardBinding).keyCode,
      (DEFAULT_KEYBOARD_P2_BINDINGS.up[0] as KeyboardBinding).keyCode,
      (DEFAULT_KEYBOARD_P2_BINDINGS.down[0] as KeyboardBinding).keyCode,
    ];
    for (const code of p2Move) expect(p1Move.has(code)).toBe(false);
  });
});

describe('Default gamepad presets', () => {
  it('slot 3 default pins to gamepad index 0', () => {
    for (const action of LOGICAL_ACTIONS) {
      for (const b of DEFAULT_GAMEPAD_P3_BINDINGS[action]) {
        expect(b.kind).toBe('gamepad');
        expect((b as GamepadBinding).gamepadIndex).toBe(0);
      }
    }
  });

  it('slot 4 default pins to gamepad index 1', () => {
    for (const action of LOGICAL_ACTIONS) {
      for (const b of DEFAULT_GAMEPAD_P4_BINDINGS[action]) {
        expect(b.kind).toBe('gamepad');
        expect((b as GamepadBinding).gamepadIndex).toBe(1);
      }
    }
  });

  it('movement actions use the left stick (axes 0 + 1)', () => {
    const preset = DEFAULT_GAMEPAD_P3_BINDINGS;
    const left = preset.left[0] as GamepadBinding;
    const right = preset.right[0] as GamepadBinding;
    const up = preset.up[0] as GamepadBinding;
    const down = preset.down[0] as GamepadBinding;
    expect(left.source.type).toBe('axis');
    expect(right.source.type).toBe('axis');
    expect(up.source.type).toBe('axis');
    expect(down.source.type).toBe('axis');
    if (left.source.type !== 'axis') throw new Error('unreachable');
    if (right.source.type !== 'axis') throw new Error('unreachable');
    if (up.source.type !== 'axis') throw new Error('unreachable');
    if (down.source.type !== 'axis') throw new Error('unreachable');
    expect(left.source.axisIndex).toBe(0);
    expect(left.source.direction).toBe(-1);
    expect(right.source.axisIndex).toBe(0);
    expect(right.source.direction).toBe(1);
    expect(up.source.axisIndex).toBe(1);
    expect(up.source.direction).toBe(-1);
    expect(down.source.axisIndex).toBe(1);
    expect(down.source.direction).toBe(1);
  });

  it('uses the canonical 0.5 axis dead-zone threshold', () => {
    const preset = DEFAULT_GAMEPAD_P3_BINDINGS;
    const left = preset.left[0] as GamepadBinding;
    if (left.source.type !== 'axis') throw new Error('unreachable');
    expect(left.source.threshold).toBe(DEFAULT_GAMEPAD_AXIS_THRESHOLD);
    expect(DEFAULT_GAMEPAD_AXIS_THRESHOLD).toBe(0.5);
  });

  it('jump / attack / special map to face buttons 0 / 2 / 3', () => {
    const preset = DEFAULT_GAMEPAD_P3_BINDINGS;
    const jump = preset.jump[0] as GamepadBinding;
    const attack = preset.attack[0] as GamepadBinding;
    const special = preset.special[0] as GamepadBinding;
    if (jump.source.type !== 'button') throw new Error('unreachable');
    if (attack.source.type !== 'button') throw new Error('unreachable');
    if (special.source.type !== 'button') throw new Error('unreachable');
    expect(jump.source.buttonIndex).toBe(0);
    expect(attack.source.buttonIndex).toBe(2);
    expect(special.source.buttonIndex).toBe(3);
  });

  it('grab / shield map to shoulder buttons 4 / 5', () => {
    const preset = DEFAULT_GAMEPAD_P3_BINDINGS;
    const grab = preset.grab[0] as GamepadBinding;
    const shield = preset.shield[0] as GamepadBinding;
    if (grab.source.type !== 'button') throw new Error('unreachable');
    if (shield.source.type !== 'button') throw new Error('unreachable');
    expect(grab.source.buttonIndex).toBe(4);
    expect(shield.source.buttonIndex).toBe(5);
  });

  it('buildDefaultGamepadBindings(n) pins every binding to pad index n', () => {
    const preset = buildDefaultGamepadBindings(3);
    for (const action of LOGICAL_ACTIONS) {
      for (const b of preset[action]) {
        expect((b as GamepadBinding).gamepadIndex).toBe(3);
      }
    }
  });

  it('every gamepad preset action has at least one binding entry', () => {
    for (const action of LOGICAL_ACTIONS) {
      expect(DEFAULT_GAMEPAD_P3_BINDINGS[action].length).toBeGreaterThanOrEqual(1);
      expect(DEFAULT_GAMEPAD_P4_BINDINGS[action].length).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('DEFAULT_PLAYER_BINDINGS', () => {
  it('assigns keyboard layouts to slots 1 + 2 and gamepad layouts to slots 3 + 4', () => {
    expect(DEFAULT_PLAYER_BINDINGS[1].playerIndex).toBe(1);
    expect(DEFAULT_PLAYER_BINDINGS[2].playerIndex).toBe(2);
    expect(DEFAULT_PLAYER_BINDINGS[3].playerIndex).toBe(3);
    expect(DEFAULT_PLAYER_BINDINGS[4].playerIndex).toBe(4);
    // sample one binding per slot to confirm device family
    expect((DEFAULT_PLAYER_BINDINGS[1].bindings.jump[0] as KeyboardBinding).kind).toBe('keyboard');
    expect((DEFAULT_PLAYER_BINDINGS[2].bindings.jump[0] as KeyboardBinding).kind).toBe('keyboard');
    expect((DEFAULT_PLAYER_BINDINGS[3].bindings.jump[0] as GamepadBinding).kind).toBe('gamepad');
    expect((DEFAULT_PLAYER_BINDINGS[4].bindings.jump[0] as GamepadBinding).kind).toBe('gamepad');
  });
});

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

describe('InputBindingsStore — construction', () => {
  it('initialises every slot 1–4 with the matching default profile', () => {
    const store = new InputBindingsStore();
    expect(store.get(1)).toEqual(DEFAULT_PLAYER_BINDINGS[1]);
    expect(store.get(2)).toEqual(DEFAULT_PLAYER_BINDINGS[2]);
    expect(store.get(3)).toEqual(DEFAULT_PLAYER_BINDINGS[3]);
    expect(store.get(4)).toEqual(DEFAULT_PLAYER_BINDINGS[4]);
  });

  it('snapshot() returns all four slots as a single record', () => {
    const store = new InputBindingsStore();
    const snap = store.snapshot();
    const slots: ReadonlyArray<PlayerBindingsIndex> = [1, 2, 3, 4];
    for (const slot of slots) {
      expect(snap[slot]).toEqual(DEFAULT_PLAYER_BINDINGS[slot]);
    }
  });

  it('accepts overrides for individual slots without touching the others', () => {
    const customP1: PlayerBindings = {
      playerIndex: 1,
      bindings: {
        ...DEFAULT_KEYBOARD_P1_BINDINGS,
        jump: [{ kind: 'keyboard', keyCode: KEY_CODE.SPACE }],
      },
    };
    const store = new InputBindingsStore({ overrides: { 1: customP1 } });
    expect((store.get(1).bindings.jump[0] as KeyboardBinding).keyCode).toBe(KEY_CODE.SPACE);
    // Other slots untouched.
    expect(store.get(2)).toEqual(DEFAULT_PLAYER_BINDINGS[2]);
    expect(store.get(3)).toEqual(DEFAULT_PLAYER_BINDINGS[3]);
    expect(store.get(4)).toEqual(DEFAULT_PLAYER_BINDINGS[4]);
  });

  it('rejects an override whose playerIndex does not match its slot key', () => {
    const wrong: PlayerBindings = { playerIndex: 2, bindings: DEFAULT_KEYBOARD_P1_BINDINGS };
    expect(() => new InputBindingsStore({ overrides: { 1: wrong } })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Get / set / reset
// ---------------------------------------------------------------------------

describe('InputBindingsStore.set', () => {
  it('replaces a slot’s full profile losslessly', () => {
    const store = new InputBindingsStore();
    const next: PlayerBindings = {
      playerIndex: 3,
      bindings: {
        ...DEFAULT_GAMEPAD_P3_BINDINGS,
        jump: [{ kind: 'keyboard', keyCode: KEY_CODE.SPACE }],
      },
    };
    store.set(3, next);
    expect((store.get(3).bindings.jump[0] as KeyboardBinding).keyCode).toBe(KEY_CODE.SPACE);
    // Sibling action unchanged.
    expect(store.get(3).bindings.attack).toEqual(DEFAULT_GAMEPAD_P3_BINDINGS.attack);
  });

  it('throws when set() is called with a mismatched playerIndex', () => {
    const store = new InputBindingsStore();
    const wrong: PlayerBindings = { playerIndex: 1, bindings: DEFAULT_GAMEPAD_P3_BINDINGS };
    expect(() => store.set(3, wrong)).toThrow();
  });

  it('does not retain a reference to the caller’s mutable input', () => {
    const store = new InputBindingsStore();
    // Build a deliberately-mutable JSON-shaped clone of the default profile
    // so we can mutate it after handing it to the store.
    const mutableJump: KeyboardBinding[] = [{ kind: 'keyboard', keyCode: KEY_CODE.SPACE }];
    const mutableBindings = JSON.parse(
      JSON.stringify(DEFAULT_KEYBOARD_P1_BINDINGS),
    ) as Record<string, KeyboardBinding[]>;
    mutableBindings['jump'] = mutableJump;
    const next = {
      playerIndex: 1 as const,
      bindings: mutableBindings,
    } as unknown as PlayerBindings;
    store.set(1, next);
    // Mutate the caller's array post-hoc — store snapshot must remain unchanged.
    mutableJump.length = 0;
    mutableJump.push({ kind: 'keyboard', keyCode: KEY_CODE.ENTER });
    expect(store.get(1).bindings.jump.length).toBe(1);
    expect((store.get(1).bindings.jump[0] as KeyboardBinding).keyCode).toBe(KEY_CODE.SPACE);
  });

  it('returns frozen profiles that callers cannot mutate', () => {
    const store = new InputBindingsStore();
    const got = store.get(1);
    expect(Object.isFrozen(got)).toBe(true);
    expect(Object.isFrozen(got.bindings)).toBe(true);
    expect(Object.isFrozen(got.bindings.jump)).toBe(true);
    // Reassigning a frozen object's property in strict mode throws.
    expect(() => {
      (got as unknown as { playerIndex: number }).playerIndex = 99;
    }).toThrow();
  });
});

describe('InputBindingsStore.setAction', () => {
  it('rebinds a single action without disturbing the rest', () => {
    const store = new InputBindingsStore();
    const before = store.get(1);
    store.setAction(1, 'attack', [{ kind: 'keyboard', keyCode: KEY_CODE.SPACE }]);
    const after = store.get(1);
    expect((after.bindings.attack[0] as KeyboardBinding).keyCode).toBe(KEY_CODE.SPACE);
    // Every other action is byte-identical.
    for (const action of LOGICAL_ACTIONS) {
      if (action === 'attack') continue;
      expect(after.bindings[action]).toEqual(before.bindings[action]);
    }
  });

  it('accepts an empty list (deliberately unbinding the action)', () => {
    const store = new InputBindingsStore();
    store.setAction(1, 'taunt', []);
    expect(store.get(1).bindings.taunt).toEqual([]);
  });

  it('rejects an entry with an invalid keyCode', () => {
    const store = new InputBindingsStore();
    expect(() =>
      store.setAction(1, 'jump', [{ kind: 'keyboard', keyCode: 0 } as KeyboardBinding]),
    ).toThrow();
    expect(() =>
      store.setAction(1, 'jump', [{ kind: 'keyboard', keyCode: -1 } as KeyboardBinding]),
    ).toThrow();
    expect(() =>
      store.setAction(1, 'jump', [
        { kind: 'keyboard', keyCode: NaN } as KeyboardBinding,
      ]),
    ).toThrow();
  });

  it('rejects an axis binding outside the (0, 1] threshold range', () => {
    const store = new InputBindingsStore();
    expect(() =>
      store.setAction(3, 'left', [
        {
          kind: 'gamepad',
          gamepadIndex: 0,
          source: { type: 'axis', axisIndex: 0, direction: -1, threshold: 0 },
        } as GamepadBinding,
      ]),
    ).toThrow();
    expect(() =>
      store.setAction(3, 'left', [
        {
          kind: 'gamepad',
          gamepadIndex: 0,
          source: { type: 'axis', axisIndex: 0, direction: -1, threshold: 1.5 },
        } as GamepadBinding,
      ]),
    ).toThrow();
  });

  it('rejects an unknown discriminator kind', () => {
    const store = new InputBindingsStore();
    expect(() =>
      store.setAction(1, 'jump', [
        { kind: 'midi', noteNumber: 60 } as unknown as KeyboardBinding,
      ]),
    ).toThrow();
  });
});

describe('InputBindingsStore.reset', () => {
  it('reset(slot) restores a customised slot to its default', () => {
    const store = new InputBindingsStore();
    store.setAction(1, 'jump', [{ kind: 'keyboard', keyCode: KEY_CODE.SPACE }]);
    expect(store.get(1)).not.toEqual(DEFAULT_PLAYER_BINDINGS[1]);
    store.reset(1);
    expect(store.get(1)).toEqual(DEFAULT_PLAYER_BINDINGS[1]);
  });

  it('reset(slot) does not touch any other slot', () => {
    const store = new InputBindingsStore();
    store.setAction(1, 'jump', [{ kind: 'keyboard', keyCode: KEY_CODE.SPACE }]);
    store.setAction(2, 'attack', [{ kind: 'keyboard', keyCode: KEY_CODE.ENTER }]);
    store.reset(1);
    // P2's customisation survives.
    expect((store.get(2).bindings.attack[0] as KeyboardBinding).keyCode).toBe(KEY_CODE.ENTER);
  });

  it('resetAction(slot, action) restores only one action', () => {
    const store = new InputBindingsStore();
    store.setAction(1, 'jump', [{ kind: 'keyboard', keyCode: KEY_CODE.SPACE }]);
    store.setAction(1, 'attack', [{ kind: 'keyboard', keyCode: KEY_CODE.ENTER }]);
    store.resetAction(1, 'jump');
    expect(store.get(1).bindings.jump).toEqual(DEFAULT_KEYBOARD_P1_BINDINGS.jump);
    // Attack rebind survives.
    expect((store.get(1).bindings.attack[0] as KeyboardBinding).keyCode).toBe(KEY_CODE.ENTER);
  });

  it('resetAll() restores every slot to its default', () => {
    const store = new InputBindingsStore();
    store.setAction(1, 'jump', [{ kind: 'keyboard', keyCode: KEY_CODE.SPACE }]);
    store.setAction(3, 'attack', [{ kind: 'keyboard', keyCode: KEY_CODE.ENTER }]);
    store.resetAll();
    const slots: ReadonlyArray<PlayerBindingsIndex> = [1, 2, 3, 4];
    for (const slot of slots) {
      expect(store.get(slot)).toEqual(DEFAULT_PLAYER_BINDINGS[slot]);
    }
  });
});

describe('InputBindingsStore.getDefault / getAction', () => {
  it('getDefault(slot) returns the canonical default profile for the slot', () => {
    const store = new InputBindingsStore();
    expect(store.getDefault(1)).toEqual(DEFAULT_PLAYER_BINDINGS[1]);
    expect(store.getDefault(4)).toEqual(DEFAULT_PLAYER_BINDINGS[4]);
  });

  it('getAction(slot, action) returns the live binding list for one action', () => {
    const store = new InputBindingsStore();
    expect(store.getAction(1, 'jump')).toEqual(DEFAULT_KEYBOARD_P1_BINDINGS.jump);
    store.setAction(1, 'jump', [{ kind: 'keyboard', keyCode: KEY_CODE.SPACE }]);
    expect((store.getAction(1, 'jump')[0] as KeyboardBinding).keyCode).toBe(KEY_CODE.SPACE);
  });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe('assertValidPlayerBindings', () => {
  it('accepts a well-formed default profile', () => {
    expect(() => assertValidPlayerBindings(DEFAULT_PLAYER_BINDINGS[1], 1)).not.toThrow();
    expect(() => assertValidPlayerBindings(DEFAULT_PLAYER_BINDINGS[3], 3)).not.toThrow();
  });

  it('rejects a non-object payload', () => {
    expect(() => assertValidPlayerBindings(null)).toThrow();
    expect(() => assertValidPlayerBindings(42)).toThrow();
    expect(() => assertValidPlayerBindings('hi')).toThrow();
  });

  it('rejects a payload missing an action', () => {
    const partial = {
      playerIndex: 1,
      bindings: { ...DEFAULT_KEYBOARD_P1_BINDINGS } as Record<string, unknown>,
    };
    delete partial.bindings['jump'];
    expect(() => assertValidPlayerBindings(partial)).toThrow();
  });

  it('rejects a payload whose playerIndex is out of range', () => {
    const wrong = { playerIndex: 5, bindings: DEFAULT_KEYBOARD_P1_BINDINGS };
    expect(() => assertValidPlayerBindings(wrong)).toThrow();
  });

  it('rejects a binding with non-finite keyCode', () => {
    const broken = {
      playerIndex: 1,
      bindings: {
        ...DEFAULT_KEYBOARD_P1_BINDINGS,
        jump: [{ kind: 'keyboard', keyCode: Infinity }],
      },
    };
    expect(() => assertValidPlayerBindings(broken)).toThrow();
  });

  it('rejects a gamepad axis binding with bad direction', () => {
    const broken = {
      playerIndex: 3,
      bindings: {
        ...DEFAULT_GAMEPAD_P3_BINDINGS,
        left: [
          {
            kind: 'gamepad',
            gamepadIndex: 0,
            source: { type: 'axis', axisIndex: 0, direction: 0, threshold: 0.5 },
          },
        ],
      },
    };
    expect(() => assertValidPlayerBindings(broken)).toThrow();
  });

  it('accepts an empty action array (deliberately unbound)', () => {
    const ok = {
      playerIndex: 1,
      bindings: {
        ...DEFAULT_KEYBOARD_P1_BINDINGS,
        taunt: [],
      },
    };
    expect(() => assertValidPlayerBindings(ok, 1)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Determinism / serialisation
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Default-merge behaviour
// ---------------------------------------------------------------------------

describe('mergeBindingsWithDefaults', () => {
  it('returns a deep copy of the slot defaults when partial is undefined', () => {
    const merged = mergeBindingsWithDefaults(1, undefined);
    expect(merged).toEqual(DEFAULT_PLAYER_BINDINGS[1]);
    // Deep clone — not the same frozen reference (but structurally equal).
    expect(Object.isFrozen(merged)).toBe(true);
    expect(Object.isFrozen(merged.bindings)).toBe(true);
  });

  it('returns a deep copy of the slot defaults when partial.bindings is omitted', () => {
    const merged = mergeBindingsWithDefaults(2, { playerIndex: 2 });
    expect(merged).toEqual(DEFAULT_PLAYER_BINDINGS[2]);
  });

  it('returns a deep copy of the slot defaults when partial.bindings is empty', () => {
    const merged = mergeBindingsWithDefaults(3, { bindings: {} });
    expect(merged).toEqual(DEFAULT_PLAYER_BINDINGS[3]);
  });

  it('overlays a single customised action, leaving siblings on defaults', () => {
    const partial: PartialPlayerBindings = {
      bindings: {
        jump: [{ kind: 'keyboard', keyCode: KEY_CODE.SPACE }],
      },
    };
    const merged = mergeBindingsWithDefaults(1, partial);
    expect((merged.bindings.jump[0] as KeyboardBinding).keyCode).toBe(KEY_CODE.SPACE);
    // Every other action falls back to defaults.
    for (const action of LOGICAL_ACTIONS) {
      if (action === 'jump') continue;
      expect(merged.bindings[action]).toEqual(DEFAULT_KEYBOARD_P1_BINDINGS[action]);
    }
    // playerIndex is stamped from the slot argument when omitted.
    expect(merged.playerIndex).toBe(1);
  });

  it('honours an explicit playerIndex that matches the slot', () => {
    const merged = mergeBindingsWithDefaults(2, {
      playerIndex: 2,
      bindings: { attack: [{ kind: 'keyboard', keyCode: KEY_CODE.NUMPAD_0 }] },
    });
    expect(merged.playerIndex).toBe(2);
    expect((merged.bindings.attack[0] as KeyboardBinding).keyCode).toBe(KEY_CODE.NUMPAD_0);
  });

  it('throws when partial.playerIndex disagrees with the target slot', () => {
    expect(() =>
      mergeBindingsWithDefaults(1, {
        playerIndex: 2 as PlayerBindingsIndex,
        bindings: {},
      }),
    ).toThrow();
  });

  it('rejects a malformed binding inside an otherwise-partial payload', () => {
    expect(() =>
      mergeBindingsWithDefaults(1, {
        bindings: {
          // keyCode 0 is invalid per the validator.
          jump: [{ kind: 'keyboard', keyCode: 0 } as KeyboardBinding],
        },
      }),
    ).toThrow();
  });

  it('rejects a non-array action value inside the partial', () => {
    expect(() =>
      mergeBindingsWithDefaults(1, {
        bindings: {
          // Wrong shape: not an array.
          jump: 'space' as unknown as ReadonlyArray<KeyboardBinding>,
        },
      }),
    ).toThrow();
  });

  it('accepts an empty action array as a deliberate unbind on a partial payload', () => {
    const merged = mergeBindingsWithDefaults(1, {
      bindings: { taunt: [] },
    });
    expect(merged.bindings.taunt).toEqual([]);
    // The other defaults remain intact.
    expect(merged.bindings.jump).toEqual(DEFAULT_KEYBOARD_P1_BINDINGS.jump);
  });

  it('returns a structurally-frozen tree the caller cannot mutate', () => {
    const merged = mergeBindingsWithDefaults(1, {
      bindings: { jump: [{ kind: 'keyboard', keyCode: KEY_CODE.SPACE }] },
    });
    expect(Object.isFrozen(merged)).toBe(true);
    expect(Object.isFrozen(merged.bindings)).toBe(true);
    expect(Object.isFrozen(merged.bindings.jump)).toBe(true);
    expect(() => {
      (merged as unknown as { playerIndex: number }).playerIndex = 99;
    }).toThrow();
  });

  it('is deterministic — same (slot, partial) inputs produce equal outputs', () => {
    const partial: PartialPlayerBindings = {
      bindings: { jump: [{ kind: 'keyboard', keyCode: KEY_CODE.SPACE }] },
    };
    const a = mergeBindingsWithDefaults(1, partial);
    const b = mergeBindingsWithDefaults(1, partial);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('does not retain a reference to the caller’s mutable input', () => {
    const mutableJumpList: KeyboardBinding[] = [
      { kind: 'keyboard', keyCode: KEY_CODE.SPACE },
    ];
    const merged = mergeBindingsWithDefaults(1, {
      bindings: { jump: mutableJumpList },
    });
    // Mutate the caller's array post-hoc — store snapshot must remain unchanged.
    mutableJumpList.length = 0;
    mutableJumpList.push({ kind: 'keyboard', keyCode: KEY_CODE.ENTER });
    expect(merged.bindings.jump.length).toBe(1);
    expect((merged.bindings.jump[0] as KeyboardBinding).keyCode).toBe(KEY_CODE.SPACE);
  });

  it('merges defaults for *every* missing action when given a single override', () => {
    const merged = mergeBindingsWithDefaults(3, {
      bindings: {
        attack: [{ kind: 'keyboard', keyCode: KEY_CODE.SPACE }],
      },
    });
    // Every action present and accounted for.
    for (const action of LOGICAL_ACTIONS) {
      expect(merged.bindings[action]).toBeDefined();
      expect(Array.isArray(merged.bindings[action])).toBe(true);
    }
    // The override slot has the override.
    expect((merged.bindings.attack[0] as KeyboardBinding).keyCode).toBe(KEY_CODE.SPACE);
    // All other slots come from the slot 3 defaults (gamepad).
    for (const action of LOGICAL_ACTIONS) {
      if (action === 'attack') continue;
      expect(merged.bindings[action]).toEqual(DEFAULT_GAMEPAD_P3_BINDINGS[action]);
    }
  });
});

describe('InputBindingsStore — partialOverrides constructor option', () => {
  it('uses defaults for slots without a partial override', () => {
    const store = new InputBindingsStore({
      partialOverrides: {
        1: { bindings: { jump: [{ kind: 'keyboard', keyCode: KEY_CODE.SPACE }] } },
      },
    });
    // Slot 1 has its merged customisation.
    expect((store.get(1).bindings.jump[0] as KeyboardBinding).keyCode).toBe(KEY_CODE.SPACE);
    // Slots 2-4 fall back to their defaults entirely.
    expect(store.get(2)).toEqual(DEFAULT_PLAYER_BINDINGS[2]);
    expect(store.get(3)).toEqual(DEFAULT_PLAYER_BINDINGS[3]);
    expect(store.get(4)).toEqual(DEFAULT_PLAYER_BINDINGS[4]);
  });

  it('fills missing per-action entries from defaults inside a partial-override slot', () => {
    const store = new InputBindingsStore({
      partialOverrides: {
        1: {
          bindings: {
            attack: [{ kind: 'keyboard', keyCode: KEY_CODE.SPACE }],
            // Note: jump, special, shield, grab, taunt, and movement
            // actions are intentionally omitted — they should fill from
            // the slot 1 defaults.
          },
        },
      },
    });
    const p1 = store.get(1);
    expect((p1.bindings.attack[0] as KeyboardBinding).keyCode).toBe(KEY_CODE.SPACE);
    // Every other action survived from the defaults.
    for (const action of LOGICAL_ACTIONS) {
      if (action === 'attack') continue;
      expect(p1.bindings[action]).toEqual(DEFAULT_KEYBOARD_P1_BINDINGS[action]);
    }
  });

  it('partialOverrides wins when both `overrides` and `partialOverrides` reference the same slot', () => {
    const store = new InputBindingsStore({
      overrides: {
        1: {
          playerIndex: 1,
          bindings: {
            ...DEFAULT_KEYBOARD_P1_BINDINGS,
            // Strict override: ENTER on jump.
            jump: [{ kind: 'keyboard', keyCode: KEY_CODE.ENTER }],
          },
        },
      },
      partialOverrides: {
        1: {
          // Partial override: SPACE on jump — wins.
          bindings: { jump: [{ kind: 'keyboard', keyCode: KEY_CODE.SPACE }] },
        },
      },
    });
    expect((store.get(1).bindings.jump[0] as KeyboardBinding).keyCode).toBe(KEY_CODE.SPACE);
  });

  it('throws if a partialOverride’s playerIndex disagrees with its slot key', () => {
    expect(
      () =>
        new InputBindingsStore({
          partialOverrides: {
            1: {
              playerIndex: 2 as PlayerBindingsIndex,
              bindings: {},
            },
          },
        }),
    ).toThrow();
  });

  it('rejects a malformed binding inside a partial override', () => {
    expect(
      () =>
        new InputBindingsStore({
          partialOverrides: {
            1: {
              bindings: {
                jump: [{ kind: 'keyboard', keyCode: -1 } as KeyboardBinding],
              },
            },
          },
        }),
    ).toThrow();
  });

  it('passes assertValidPlayerBindings on every merged slot', () => {
    const store = new InputBindingsStore({
      partialOverrides: {
        1: { bindings: { jump: [{ kind: 'keyboard', keyCode: KEY_CODE.SPACE }] } },
        4: { bindings: { taunt: [] } },
      },
    });
    const slots: ReadonlyArray<PlayerBindingsIndex> = [1, 2, 3, 4];
    for (const slot of slots) {
      expect(() => assertValidPlayerBindings(store.get(slot), slot)).not.toThrow();
    }
  });
});

describe('InputBindingsStore.setMerged', () => {
  it('overlays a single action change while leaving siblings intact', () => {
    const store = new InputBindingsStore();
    store.setMerged(1, {
      bindings: { jump: [{ kind: 'keyboard', keyCode: KEY_CODE.SPACE }] },
    });
    const p1 = store.get(1);
    expect((p1.bindings.jump[0] as KeyboardBinding).keyCode).toBe(KEY_CODE.SPACE);
    for (const action of LOGICAL_ACTIONS) {
      if (action === 'jump') continue;
      expect(p1.bindings[action]).toEqual(DEFAULT_KEYBOARD_P1_BINDINGS[action]);
    }
  });

  it('replaces multiple actions atomically in one call', () => {
    const store = new InputBindingsStore();
    store.setMerged(1, {
      bindings: {
        jump: [{ kind: 'keyboard', keyCode: KEY_CODE.SPACE }],
        attack: [{ kind: 'keyboard', keyCode: KEY_CODE.ENTER }],
      },
    });
    const p1 = store.get(1);
    expect((p1.bindings.jump[0] as KeyboardBinding).keyCode).toBe(KEY_CODE.SPACE);
    expect((p1.bindings.attack[0] as KeyboardBinding).keyCode).toBe(KEY_CODE.ENTER);
    expect(p1.bindings.shield).toEqual(DEFAULT_KEYBOARD_P1_BINDINGS.shield);
  });

  it('replaces (does not merge into) the *previous* customised state — defaults fill the gaps', () => {
    const store = new InputBindingsStore();
    // Customise jump to ENTER first.
    store.setAction(1, 'jump', [{ kind: 'keyboard', keyCode: KEY_CODE.ENTER }]);
    // Now setMerged with only attack — jump should fall back to its
    // *default* (W), not stay on ENTER, because setMerged is the
    // replace-with-merge path, not an append path.
    store.setMerged(1, {
      bindings: { attack: [{ kind: 'keyboard', keyCode: KEY_CODE.SPACE }] },
    });
    expect(store.get(1).bindings.jump).toEqual(DEFAULT_KEYBOARD_P1_BINDINGS.jump);
    expect((store.get(1).bindings.attack[0] as KeyboardBinding).keyCode).toBe(KEY_CODE.SPACE);
  });

  it('honours playerIndex stamping when omitted', () => {
    const store = new InputBindingsStore();
    store.setMerged(3, {
      bindings: { attack: [{ kind: 'gamepad', gamepadIndex: 0, source: { type: 'button', buttonIndex: 7 } }] },
    });
    expect(store.get(3).playerIndex).toBe(3);
  });

  it('throws on slot/playerIndex disagreement', () => {
    const store = new InputBindingsStore();
    expect(() =>
      store.setMerged(1, { playerIndex: 2 as PlayerBindingsIndex, bindings: {} }),
    ).toThrow();
  });

  it('does not mutate the store on a malformed payload (atomic write)', () => {
    const store = new InputBindingsStore();
    const before = JSON.stringify(store.snapshot());
    expect(() =>
      store.setMerged(1, {
        bindings: { jump: [{ kind: 'keyboard', keyCode: 0 } as KeyboardBinding] },
      }),
    ).toThrow();
    expect(JSON.stringify(store.snapshot())).toBe(before);
  });

  it('returns frozen profiles after setMerged', () => {
    const store = new InputBindingsStore();
    store.setMerged(2, {
      bindings: { jump: [{ kind: 'keyboard', keyCode: KEY_CODE.SPACE }] },
    });
    const p2 = store.get(2);
    expect(Object.isFrozen(p2)).toBe(true);
    expect(Object.isFrozen(p2.bindings)).toBe(true);
    expect(Object.isFrozen(p2.bindings.jump)).toBe(true);
  });
});

describe('InputBindingsStore — determinism', () => {
  it('two stores built with identical options produce identical snapshots', () => {
    const a = new InputBindingsStore();
    const b = new InputBindingsStore();
    expect(JSON.stringify(a.snapshot())).toBe(JSON.stringify(b.snapshot()));
  });

  it('a JSON round-trip of a snapshot validates as PlayerBindings', () => {
    const store = new InputBindingsStore();
    const snap = store.snapshot();
    const json = JSON.stringify(snap);
    const parsed = JSON.parse(json) as Record<PlayerBindingsIndex, unknown>;
    const slots: ReadonlyArray<PlayerBindingsIndex> = [1, 2, 3, 4];
    for (const slot of slots) {
      expect(() => assertValidPlayerBindings(parsed[slot], slot)).not.toThrow();
    }
  });

  it('reset(slot) is a no-op on a freshly-constructed store', () => {
    const store = new InputBindingsStore();
    const before = JSON.stringify(store.snapshot());
    store.reset(1);
    store.reset(2);
    store.reset(3);
    store.reset(4);
    expect(JSON.stringify(store.snapshot())).toBe(before);
  });
});
