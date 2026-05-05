import { describe, it, expect } from 'vitest';
import {
  BINDINGS_SCHEMA_VERSION,
  detectSerializedKind,
  deserializeBindingsSnapshot,
  deserializePlayerBindings,
  safeDeserializeBindingsSnapshot,
  safeDeserializePlayerBindings,
  serializeBindingsSnapshot,
  serializePlayerBindings,
} from './InputBindingsSerializer';
import {
  DEFAULT_GAMEPAD_P3_BINDINGS,
  DEFAULT_KEYBOARD_P1_BINDINGS,
  DEFAULT_PLAYER_BINDINGS,
  InputBindingsStore,
} from './InputBindingsStore';
import { KEY_CODE } from './keyCodes';
import { LOGICAL_ACTIONS } from '../types/inputBindings';
import type {
  GamepadBinding,
  KeyboardBinding,
  PlayerBindings,
  PlayerBindingsIndex,
} from '../types/inputBindings';

/**
 * AC 40004 Sub-AC 4 — JSON serialisation / deserialisation + validation
 * for binding configurations.
 *
 * Locks down:
 *
 *   1. Round-trip — every default profile (and a custom one) survives
 *      `serialize → deserialize` with byte-stable output and
 *      structurally-equal input.
 *   2. Envelope shape — output declares `schemaVersion`, `kind`, `data`;
 *      malformed envelopes (wrong kind, wrong version, missing data)
 *      are rejected with descriptive errors.
 *   3. Determinism — two identical stores produce byte-identical JSON
 *      strings; key order in the canonical output is fixed regardless
 *      of input field order.
 *   4. Validation — corrupted bodies (missing actions, bad keyCode,
 *      bad axis threshold, unknown discriminator kind, mismatched
 *      slot key) throw on the strict path and surface as
 *      `{ ok: false, error }` on the safe path.
 *   5. Cross-shape rejection — a `playerBindings` envelope cannot be
 *      loaded as a snapshot and vice versa.
 *   6. Forward compatibility — a future schemaVersion is rejected so a
 *      newer save file cannot silently corrupt a current-version
 *      session.
 */

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const customP1: PlayerBindings = {
  playerIndex: 1,
  bindings: {
    ...DEFAULT_KEYBOARD_P1_BINDINGS,
    jump: [{ kind: 'keyboard', keyCode: KEY_CODE.SPACE }],
    attack: [
      { kind: 'keyboard', keyCode: KEY_CODE.F },
      { kind: 'keyboard', keyCode: KEY_CODE.ENTER },
    ],
  },
};

// ---------------------------------------------------------------------------
// Round-trip — playerBindings
// ---------------------------------------------------------------------------

describe('serializePlayerBindings + deserializePlayerBindings', () => {
  it('round-trips every default keyboard profile losslessly', () => {
    const slots: ReadonlyArray<PlayerBindingsIndex> = [1, 2];
    for (const slot of slots) {
      const json = serializePlayerBindings(DEFAULT_PLAYER_BINDINGS[slot]);
      const back = deserializePlayerBindings(json, slot);
      expect(back).toEqual(DEFAULT_PLAYER_BINDINGS[slot]);
    }
  });

  it('round-trips every default gamepad profile losslessly', () => {
    const slots: ReadonlyArray<PlayerBindingsIndex> = [3, 4];
    for (const slot of slots) {
      const json = serializePlayerBindings(DEFAULT_PLAYER_BINDINGS[slot]);
      const back = deserializePlayerBindings(json, slot);
      expect(back).toEqual(DEFAULT_PLAYER_BINDINGS[slot]);
    }
  });

  it('round-trips a customised profile with multi-bind entries', () => {
    const json = serializePlayerBindings(customP1);
    const back = deserializePlayerBindings(json, 1);
    expect(back).toEqual(customP1);
  });

  it('produces JSON whose envelope carries schemaVersion + kind', () => {
    const json = serializePlayerBindings(DEFAULT_PLAYER_BINDINGS[1]);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(parsed['schemaVersion']).toBe(BINDINGS_SCHEMA_VERSION);
    expect(parsed['kind']).toBe('playerBindings');
    expect(typeof parsed['data']).toBe('object');
  });

  it('validates the input before writing — a malformed profile throws', () => {
    const broken = {
      playerIndex: 1,
      bindings: { ...DEFAULT_KEYBOARD_P1_BINDINGS, jump: 'oops' },
    } as unknown as PlayerBindings;
    expect(() => serializePlayerBindings(broken)).toThrow();
  });

  it('round-trips an empty action list (deliberately unbound)', () => {
    const unbound: PlayerBindings = {
      playerIndex: 1,
      bindings: { ...DEFAULT_KEYBOARD_P1_BINDINGS, taunt: [] },
    };
    const back = deserializePlayerBindings(serializePlayerBindings(unbound), 1);
    expect(back.bindings.taunt).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Round-trip — bindingsSnapshot
// ---------------------------------------------------------------------------

describe('serializeBindingsSnapshot + deserializeBindingsSnapshot', () => {
  it('round-trips a fresh store snapshot losslessly', () => {
    const store = new InputBindingsStore();
    const snap = store.snapshot();
    const json = serializeBindingsSnapshot(snap);
    const back = deserializeBindingsSnapshot(json);
    const slots: ReadonlyArray<PlayerBindingsIndex> = [1, 2, 3, 4];
    for (const slot of slots) {
      expect(back[slot]).toEqual(DEFAULT_PLAYER_BINDINGS[slot]);
    }
  });

  it('round-trips a customised store snapshot', () => {
    const store = new InputBindingsStore();
    store.setAction(1, 'jump', [{ kind: 'keyboard', keyCode: KEY_CODE.SPACE }]);
    store.setAction(3, 'attack', [
      {
        kind: 'gamepad',
        gamepadIndex: 0,
        source: { type: 'button', buttonIndex: 7 },
      },
    ]);
    const json = serializeBindingsSnapshot(store.snapshot());
    const back = deserializeBindingsSnapshot(json);
    expect((back[1].bindings.jump[0] as KeyboardBinding).keyCode).toBe(KEY_CODE.SPACE);
    expect(((back[3].bindings.attack[0] as GamepadBinding).source as { buttonIndex: number }).buttonIndex).toBe(7);
    // Untouched slots remain at default.
    expect(back[2]).toEqual(DEFAULT_PLAYER_BINDINGS[2]);
    expect(back[4]).toEqual(DEFAULT_PLAYER_BINDINGS[4]);
  });

  it('produces JSON whose envelope carries schemaVersion + kind', () => {
    const json = serializeBindingsSnapshot(new InputBindingsStore().snapshot());
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(parsed['schemaVersion']).toBe(BINDINGS_SCHEMA_VERSION);
    expect(parsed['kind']).toBe('bindingsSnapshot');
    expect(typeof parsed['data']).toBe('object');
  });

  it('validates every slot before writing — a malformed slot throws', () => {
    const broken = {
      ...new InputBindingsStore().snapshot(),
      3: { playerIndex: 99, bindings: DEFAULT_GAMEPAD_P3_BINDINGS },
    } as unknown as Record<PlayerBindingsIndex, PlayerBindings>;
    expect(() => serializeBindingsSnapshot(broken)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Determinism — byte-stable canonical output
// ---------------------------------------------------------------------------

describe('serialize* — determinism', () => {
  it('two identical stores produce byte-identical snapshot JSON', () => {
    const a = serializeBindingsSnapshot(new InputBindingsStore().snapshot());
    const b = serializeBindingsSnapshot(new InputBindingsStore().snapshot());
    expect(a).toBe(b);
  });

  it('canonical output orders actions by LOGICAL_ACTIONS regardless of input order', () => {
    // Build a profile whose `bindings` object is enumerated in reverse
    // action order. The serializer must rewrite the keys so the output
    // still matches the canonical form.
    const reverseBindings: Record<string, unknown> = {};
    const reversedActions = [...LOGICAL_ACTIONS].reverse();
    for (const action of reversedActions) {
      reverseBindings[action] = DEFAULT_KEYBOARD_P1_BINDINGS[action];
    }
    const reversed = {
      playerIndex: 1 as const,
      bindings: reverseBindings,
    } as unknown as PlayerBindings;
    const reversedJson = serializePlayerBindings(reversed);
    const canonicalJson = serializePlayerBindings(DEFAULT_PLAYER_BINDINGS[1]);
    expect(reversedJson).toBe(canonicalJson);
  });

  it('canonical output orders binding fields with kind first', () => {
    // Even if the caller's binding lists fields in a different order,
    // the canonicalised output must put `kind` first. This matters for
    // diffing across game sessions / replay payload hashing.
    const oddOrdered: PlayerBindings = {
      playerIndex: 1,
      bindings: {
        ...DEFAULT_KEYBOARD_P1_BINDINGS,
        jump: [{ keyCode: KEY_CODE.SPACE, kind: 'keyboard' } as KeyboardBinding],
      },
    };
    const json = serializePlayerBindings(oddOrdered);
    const data = (JSON.parse(json) as { data: { bindings: Record<string, unknown[]> } }).data;
    const jumpEntries = data.bindings['jump'];
    if (!Array.isArray(jumpEntries) || jumpEntries.length === 0) {
      throw new Error('expected jump array to round-trip');
    }
    const firstKey = Object.keys(jumpEntries[0] as object)[0];
    expect(firstKey).toBe('kind');
  });

  it('snapshot keys are written in 1, 2, 3, 4 order', () => {
    const json = serializeBindingsSnapshot(new InputBindingsStore().snapshot());
    const data = (JSON.parse(json) as { data: Record<string, unknown> }).data;
    expect(Object.keys(data)).toEqual(['1', '2', '3', '4']);
  });
});

// ---------------------------------------------------------------------------
// Envelope validation
// ---------------------------------------------------------------------------

describe('deserializePlayerBindings — envelope validation', () => {
  it('rejects non-JSON input', () => {
    expect(() => deserializePlayerBindings('this is not JSON {')).toThrow();
  });

  it('rejects an envelope with the wrong kind', () => {
    const wrongKind = JSON.stringify({
      schemaVersion: BINDINGS_SCHEMA_VERSION,
      kind: 'bindingsSnapshot',
      data: DEFAULT_PLAYER_BINDINGS[1],
    });
    expect(() => deserializePlayerBindings(wrongKind)).toThrow();
  });

  it('rejects a future schemaVersion', () => {
    const future = JSON.stringify({
      schemaVersion: BINDINGS_SCHEMA_VERSION + 1,
      kind: 'playerBindings',
      data: DEFAULT_PLAYER_BINDINGS[1],
    });
    expect(() => deserializePlayerBindings(future)).toThrow();
  });

  it('rejects a non-integer schemaVersion', () => {
    const bad = JSON.stringify({
      schemaVersion: '1',
      kind: 'playerBindings',
      data: DEFAULT_PLAYER_BINDINGS[1],
    });
    expect(() => deserializePlayerBindings(bad)).toThrow();
  });

  it('rejects an envelope without data', () => {
    const noData = JSON.stringify({
      schemaVersion: BINDINGS_SCHEMA_VERSION,
      kind: 'playerBindings',
    });
    expect(() => deserializePlayerBindings(noData)).toThrow();
  });

  it('rejects when expectedSlot disagrees with payload playerIndex', () => {
    const json = serializePlayerBindings(DEFAULT_PLAYER_BINDINGS[1]);
    expect(() => deserializePlayerBindings(json, 2)).toThrow();
  });

  it('rejects a non-object envelope', () => {
    expect(() => deserializePlayerBindings('null')).toThrow();
    expect(() => deserializePlayerBindings('42')).toThrow();
    expect(() => deserializePlayerBindings('"hi"')).toThrow();
    expect(() => deserializePlayerBindings('[]')).toThrow();
  });
});

describe('deserializeBindingsSnapshot — envelope validation', () => {
  it('rejects an envelope with the wrong kind', () => {
    const wrongKind = serializePlayerBindings(DEFAULT_PLAYER_BINDINGS[1]);
    expect(() => deserializeBindingsSnapshot(wrongKind)).toThrow();
  });

  it('rejects a snapshot missing a slot', () => {
    const partial = JSON.stringify({
      schemaVersion: BINDINGS_SCHEMA_VERSION,
      kind: 'bindingsSnapshot',
      data: {
        '1': DEFAULT_PLAYER_BINDINGS[1],
        '2': DEFAULT_PLAYER_BINDINGS[2],
        '3': DEFAULT_PLAYER_BINDINGS[3],
        // slot 4 absent
      },
    });
    expect(() => deserializeBindingsSnapshot(partial)).toThrow();
  });

  it('rejects a snapshot with extra slot keys', () => {
    const tooMany = JSON.stringify({
      schemaVersion: BINDINGS_SCHEMA_VERSION,
      kind: 'bindingsSnapshot',
      data: {
        '1': DEFAULT_PLAYER_BINDINGS[1],
        '2': DEFAULT_PLAYER_BINDINGS[2],
        '3': DEFAULT_PLAYER_BINDINGS[3],
        '4': DEFAULT_PLAYER_BINDINGS[4],
        '5': DEFAULT_PLAYER_BINDINGS[1], // bogus extra slot
      },
    });
    expect(() => deserializeBindingsSnapshot(tooMany)).toThrow();
  });

  it('rejects a snapshot whose slot keys disagree with their playerIndex', () => {
    // Slot key '3' but the payload claims playerIndex 1 — copy/paste bug.
    const mismatched = JSON.stringify({
      schemaVersion: BINDINGS_SCHEMA_VERSION,
      kind: 'bindingsSnapshot',
      data: {
        '1': DEFAULT_PLAYER_BINDINGS[1],
        '2': DEFAULT_PLAYER_BINDINGS[2],
        '3': DEFAULT_PLAYER_BINDINGS[1], // playerIndex 1 in slot 3
        '4': DEFAULT_PLAYER_BINDINGS[4],
      },
    });
    expect(() => deserializeBindingsSnapshot(mismatched)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Body-level validation (rules from assertValidPlayerBindings)
// ---------------------------------------------------------------------------

describe('deserializePlayerBindings — body validation', () => {
  it('rejects a payload missing an action', () => {
    const partial = { ...DEFAULT_KEYBOARD_P1_BINDINGS } as Record<string, unknown>;
    delete partial['jump'];
    const json = JSON.stringify({
      schemaVersion: BINDINGS_SCHEMA_VERSION,
      kind: 'playerBindings',
      data: { playerIndex: 1, bindings: partial },
    });
    expect(() => deserializePlayerBindings(json)).toThrow();
  });

  it('rejects a binding with an invalid keyCode', () => {
    const json = JSON.stringify({
      schemaVersion: BINDINGS_SCHEMA_VERSION,
      kind: 'playerBindings',
      data: {
        playerIndex: 1,
        bindings: {
          ...DEFAULT_KEYBOARD_P1_BINDINGS,
          jump: [{ kind: 'keyboard', keyCode: -1 }],
        },
      },
    });
    expect(() => deserializePlayerBindings(json)).toThrow();
  });

  it('rejects an axis binding with bad threshold', () => {
    const json = JSON.stringify({
      schemaVersion: BINDINGS_SCHEMA_VERSION,
      kind: 'playerBindings',
      data: {
        playerIndex: 3,
        bindings: {
          ...DEFAULT_GAMEPAD_P3_BINDINGS,
          left: [
            {
              kind: 'gamepad',
              gamepadIndex: 0,
              source: { type: 'axis', axisIndex: 0, direction: -1, threshold: 1.5 },
            },
          ],
        },
      },
    });
    expect(() => deserializePlayerBindings(json)).toThrow();
  });

  it('rejects an unknown discriminator kind', () => {
    const json = JSON.stringify({
      schemaVersion: BINDINGS_SCHEMA_VERSION,
      kind: 'playerBindings',
      data: {
        playerIndex: 1,
        bindings: {
          ...DEFAULT_KEYBOARD_P1_BINDINGS,
          jump: [{ kind: 'midi', noteNumber: 60 }],
        },
      },
    });
    expect(() => deserializePlayerBindings(json)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Safe (non-throwing) variants
// ---------------------------------------------------------------------------

describe('safeDeserializePlayerBindings', () => {
  it('returns ok for valid input', () => {
    const json = serializePlayerBindings(DEFAULT_PLAYER_BINDINGS[1]);
    const result = safeDeserializePlayerBindings(json, 1);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(DEFAULT_PLAYER_BINDINGS[1]);
    }
  });

  it('returns { ok: false, error } for malformed JSON', () => {
    const result = safeDeserializePlayerBindings('not JSON');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(typeof result.error).toBe('string');
      expect(result.error.length).toBeGreaterThan(0);
    }
  });

  it('returns { ok: false, error } for a wrong-kind envelope', () => {
    const json = serializeBindingsSnapshot(new InputBindingsStore().snapshot());
    const result = safeDeserializePlayerBindings(json);
    expect(result.ok).toBe(false);
  });

  it('returns { ok: false, error } when slot mismatch is requested', () => {
    const json = serializePlayerBindings(DEFAULT_PLAYER_BINDINGS[1]);
    const result = safeDeserializePlayerBindings(json, 4);
    expect(result.ok).toBe(false);
  });
});

describe('safeDeserializeBindingsSnapshot', () => {
  it('returns ok for valid input', () => {
    const json = serializeBindingsSnapshot(new InputBindingsStore().snapshot());
    const result = safeDeserializeBindingsSnapshot(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value[1]).toEqual(DEFAULT_PLAYER_BINDINGS[1]);
    }
  });

  it('returns { ok: false, error } for malformed JSON', () => {
    const result = safeDeserializeBindingsSnapshot('{');
    expect(result.ok).toBe(false);
  });

  it('returns { ok: false, error } for a future schemaVersion', () => {
    const future = JSON.stringify({
      schemaVersion: BINDINGS_SCHEMA_VERSION + 1,
      kind: 'bindingsSnapshot',
      data: { '1': DEFAULT_PLAYER_BINDINGS[1], '2': DEFAULT_PLAYER_BINDINGS[2], '3': DEFAULT_PLAYER_BINDINGS[3], '4': DEFAULT_PLAYER_BINDINGS[4] },
    });
    const result = safeDeserializeBindingsSnapshot(future);
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// detectSerializedKind
// ---------------------------------------------------------------------------

describe('detectSerializedKind', () => {
  it('identifies a playerBindings envelope', () => {
    const json = serializePlayerBindings(DEFAULT_PLAYER_BINDINGS[1]);
    expect(detectSerializedKind(json)).toBe('playerBindings');
  });

  it('identifies a bindingsSnapshot envelope', () => {
    const json = serializeBindingsSnapshot(new InputBindingsStore().snapshot());
    expect(detectSerializedKind(json)).toBe('bindingsSnapshot');
  });

  it('returns null for invalid JSON', () => {
    expect(detectSerializedKind('not JSON')).toBeNull();
  });

  it('returns null for an unrecognised kind', () => {
    const odd = JSON.stringify({ schemaVersion: BINDINGS_SCHEMA_VERSION, kind: 'matchReplay', data: {} });
    expect(detectSerializedKind(odd)).toBeNull();
  });

  it('returns null for a future schemaVersion', () => {
    const future = JSON.stringify({
      schemaVersion: BINDINGS_SCHEMA_VERSION + 1,
      kind: 'playerBindings',
      data: {},
    });
    expect(detectSerializedKind(future)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Persistence story (sanity)
// ---------------------------------------------------------------------------

describe('Persistence workflow — store → JSON → store', () => {
  it('a customised store can be serialised and rehydrated via overrides', () => {
    const original = new InputBindingsStore();
    original.setAction(1, 'jump', [{ kind: 'keyboard', keyCode: KEY_CODE.SPACE }]);
    original.setAction(2, 'taunt', []);
    const json = serializeBindingsSnapshot(original.snapshot());

    const parsed = deserializeBindingsSnapshot(json);
    const rehydrated = new InputBindingsStore({
      overrides: { 1: parsed[1], 2: parsed[2], 3: parsed[3], 4: parsed[4] },
    });

    expect(rehydrated.snapshot()).toEqual(original.snapshot());
  });

  it('round-tripping a store through JSON yields byte-identical snapshots', () => {
    const original = new InputBindingsStore();
    original.setAction(3, 'attack', [
      {
        kind: 'gamepad',
        gamepadIndex: 0,
        source: { type: 'button', buttonIndex: 9 },
      },
    ]);
    const firstJson = serializeBindingsSnapshot(original.snapshot());
    const parsed = deserializeBindingsSnapshot(firstJson);
    const rehydrated = new InputBindingsStore({
      overrides: { 1: parsed[1], 2: parsed[2], 3: parsed[3], 4: parsed[4] },
    });
    const secondJson = serializeBindingsSnapshot(rehydrated.snapshot());
    expect(secondJson).toBe(firstJson);
  });
});
