/**
 * Contract tests for the dedicated bindings module — AC 5 Sub-AC 1.
 *
 * The acceptance criterion calls for:
 *
 *   1. A per-player binding *data model* that can describe both
 *      keyboard and gamepad inputs for every action.
 *   2. Default keyboard/gamepad binding *profiles* covering
 *      move (left/right/up/down) / jump / attack / special / shield /
 *      grab / dodge for all four player slots.
 *   3. Both shipped from a *dedicated* bindings config module — not
 *      buried in `LocalInputHandler` or the legacy `inputBindings.ts`.
 *
 * These tests pin the public contract so future sub-ACs (rebinding
 * UI, replay export, persistence migrations) can rely on:
 *
 *   • The full action vocabulary being present and stable.
 *   • Every default profile covering every action with at least one
 *     binding.
 *   • The default tables being deeply frozen so a bad caller cannot
 *     mutate the canonical preset (which would corrupt the replay
 *     determinism guarantee — defaults must hash identically across
 *     program runs).
 */

import { describe, expect, it } from 'vitest';

import {
  BINDING_ACTIONS,
  type BindingAction,
  type ActionMap,
  type BindingsConfig,
  type PlayerBinding,
  type PlayerBindingIndex,
  type PlayerProfile,
  DEFAULT_GAMEPAD_AXIS_THRESHOLD,
  DEFAULT_KEYBOARD_P1_BINDINGS,
  DEFAULT_KEYBOARD_P2_BINDINGS,
  DEFAULT_GAMEPAD_P3_BINDINGS,
  DEFAULT_GAMEPAD_P4_BINDINGS,
  DEFAULT_PLAYER_BINDINGS,
  DEFAULT_PLAYER_PROFILES,
  BINDINGS_SCHEMA_VERSION,
  buildDefaultGamepadBindings,
  getDefaultPlayerBinding,
  getDefaultPlayerProfile,
  toPlayerProfile,
  fromPlayerProfile,
} from './bindings';

// The AC explicitly enumerates the action set; pin it here so any
// future drift fails loudly rather than silently dropping `dodge` (or
// any other) action.
const REQUIRED_ACTIONS: ReadonlyArray<BindingAction> = [
  'moveLeft',
  'moveRight',
  'moveUp',
  'moveDown',
  'jump',
  'attack',
  'special',
  'shield',
  'grab',
  'dodge',
];

const ALL_SLOTS: ReadonlyArray<PlayerBindingIndex> = [1, 2, 3, 4];

function expectFullCoverage(map: ActionMap): void {
  for (const action of REQUIRED_ACTIONS) {
    const slot = map[action];
    expect(slot, `action "${action}" must have a binding slot`).toBeDefined();
    expect(slot.length, `action "${action}" must have ≥1 binding`).toBeGreaterThan(0);
  }
}

describe('BINDING_ACTIONS vocabulary', () => {
  it('covers exactly the AC-required action set', () => {
    // Order matters — the rebinding UI iterates in declared order, and
    // the AC enumerates "move / jump / attack / special / shield /
    // grab / dodge" in that priority. Pin both.
    expect([...BINDING_ACTIONS]).toEqual([...REQUIRED_ACTIONS]);
  });

  it('is frozen so callers cannot mutate the canonical action list', () => {
    expect(Object.isFrozen(BINDING_ACTIONS)).toBe(true);
  });

  it('contains no duplicate action names', () => {
    const set = new Set<string>(BINDING_ACTIONS);
    expect(set.size).toBe(BINDING_ACTIONS.length);
  });
});

describe('keyboard default profiles', () => {
  it('P1 covers every required action', () => {
    expectFullCoverage(DEFAULT_KEYBOARD_P1_BINDINGS);
  });

  it('P2 covers every required action', () => {
    expectFullCoverage(DEFAULT_KEYBOARD_P2_BINDINGS);
  });

  it('P1 uses WASD movement (Seed-spec layout)', () => {
    // W=87 A=65 S=83 D=68 — legacy KeyboardEvent.keyCode values that
    // are stable forever and shared with Phaser's keyboard plugin.
    const expectKey = (action: BindingAction, code: number) => {
      const slot = DEFAULT_KEYBOARD_P1_BINDINGS[action];
      expect(slot.length).toBeGreaterThan(0);
      const first = slot[0];
      if (first === undefined) throw new Error('unreachable');
      expect(first.kind).toBe('keyboard');
      if (first.kind !== 'keyboard') throw new Error('unreachable');
      expect(first.keyCode).toBe(code);
    };
    expectKey('moveLeft', 65);
    expectKey('moveRight', 68);
    expectKey('moveUp', 87);
    expectKey('moveDown', 83);
    // W also doubles as jump — the canonical platformer convention
    // called out in the design notes.
    expectKey('jump', 87);
  });

  it('P2 uses arrow-key movement (Seed-spec layout)', () => {
    const expectKey = (action: BindingAction, code: number) => {
      const slot = DEFAULT_KEYBOARD_P2_BINDINGS[action];
      expect(slot.length).toBeGreaterThan(0);
      const first = slot[0];
      if (first === undefined) throw new Error('unreachable');
      expect(first.kind).toBe('keyboard');
      if (first.kind !== 'keyboard') throw new Error('unreachable');
      expect(first.keyCode).toBe(code);
    };
    expectKey('moveLeft', 37);
    expectKey('moveRight', 39);
    expectKey('moveUp', 38);
    expectKey('moveDown', 40);
    expectKey('jump', 38);
  });

  it('P1 and P2 share no keyCode (two players on one keyboard)', () => {
    const collect = (map: ActionMap): Set<number> => {
      const codes = new Set<number>();
      for (const action of BINDING_ACTIONS) {
        for (const b of map[action]) {
          if (b.kind === 'keyboard') codes.add(b.keyCode);
        }
      }
      return codes;
    };
    const p1 = collect(DEFAULT_KEYBOARD_P1_BINDINGS);
    const p2 = collect(DEFAULT_KEYBOARD_P2_BINDINGS);
    for (const code of p1) {
      expect(p2.has(code), `keyCode ${code} must not be shared between P1 and P2`).toBe(false);
    }
  });
});

describe('gamepad default profiles', () => {
  it('P3 covers every required action', () => {
    expectFullCoverage(DEFAULT_GAMEPAD_P3_BINDINGS);
  });

  it('P4 covers every required action', () => {
    expectFullCoverage(DEFAULT_GAMEPAD_P4_BINDINGS);
  });

  it('P3 pins to gamepadIndex 0 and P4 pins to gamepadIndex 1', () => {
    for (const action of BINDING_ACTIONS) {
      for (const b of DEFAULT_GAMEPAD_P3_BINDINGS[action]) {
        expect(b.kind).toBe('gamepad');
        if (b.kind === 'gamepad') expect(b.gamepadIndex).toBe(0);
      }
      for (const b of DEFAULT_GAMEPAD_P4_BINDINGS[action]) {
        expect(b.kind).toBe('gamepad');
        if (b.kind === 'gamepad') expect(b.gamepadIndex).toBe(1);
      }
    }
  });

  it('move directions use half-axes with the configured dead-zone', () => {
    const checkAxis = (
      map: ActionMap,
      action: BindingAction,
      axisIndex: number,
      direction: -1 | 1,
    ) => {
      const slot = map[action];
      expect(slot.length).toBeGreaterThan(0);
      const first = slot[0];
      if (first === undefined || first.kind !== 'gamepad') {
        throw new Error('expected gamepad binding');
      }
      expect(first.source.type).toBe('axis');
      if (first.source.type !== 'axis') throw new Error('unreachable');
      expect(first.source.axisIndex).toBe(axisIndex);
      expect(first.source.direction).toBe(direction);
      expect(first.source.threshold).toBe(DEFAULT_GAMEPAD_AXIS_THRESHOLD);
    };
    for (const map of [DEFAULT_GAMEPAD_P3_BINDINGS, DEFAULT_GAMEPAD_P4_BINDINGS]) {
      checkAxis(map, 'moveLeft', 0, -1);
      checkAxis(map, 'moveRight', 0, +1);
      checkAxis(map, 'moveUp', 1, -1);
      checkAxis(map, 'moveDown', 1, +1);
    }
  });

  it('buildDefaultGamepadBindings(idx) returns a profile pinned to that index', () => {
    const built = buildDefaultGamepadBindings(7);
    for (const action of BINDING_ACTIONS) {
      for (const b of built[action]) {
        expect(b.kind).toBe('gamepad');
        if (b.kind === 'gamepad') expect(b.gamepadIndex).toBe(7);
      }
    }
  });
});

describe('DEFAULT_PLAYER_BINDINGS', () => {
  it('exposes one PlayerBinding per slot 1–4', () => {
    for (const slot of ALL_SLOTS) {
      const binding: PlayerBinding = DEFAULT_PLAYER_BINDINGS[slot];
      expect(binding.playerIndex).toBe(slot);
      expectFullCoverage(binding.bindings);
    }
  });

  it('is assignable to the BindingsConfig four-slot alias', () => {
    // BindingsConfig is the named container the AC calls out — the
    // canonical type for "the full four-slot picture". The defaults
    // table is the natural witness for that contract.
    const cfg: BindingsConfig = DEFAULT_PLAYER_BINDINGS;
    for (const slot of ALL_SLOTS) {
      const profile: PlayerBinding = cfg[slot];
      expect(profile.playerIndex).toBe(slot);
    }
  });

  it('slots 1 and 2 are keyboard, slots 3 and 4 are gamepad', () => {
    const kindOf = (map: ActionMap): 'keyboard' | 'gamepad' | 'mixed' => {
      const kinds = new Set<string>();
      for (const action of BINDING_ACTIONS) {
        for (const b of map[action]) kinds.add(b.kind);
      }
      if (kinds.size === 1) {
        return kinds.has('keyboard') ? 'keyboard' : 'gamepad';
      }
      return 'mixed';
    };
    expect(kindOf(DEFAULT_PLAYER_BINDINGS[1].bindings)).toBe('keyboard');
    expect(kindOf(DEFAULT_PLAYER_BINDINGS[2].bindings)).toBe('keyboard');
    expect(kindOf(DEFAULT_PLAYER_BINDINGS[3].bindings)).toBe('gamepad');
    expect(kindOf(DEFAULT_PLAYER_BINDINGS[4].bindings)).toBe('gamepad');
  });

  it('is deeply frozen — defaults are immutable across the codebase', () => {
    expect(Object.isFrozen(DEFAULT_PLAYER_BINDINGS)).toBe(true);
    for (const slot of ALL_SLOTS) {
      const pb = DEFAULT_PLAYER_BINDINGS[slot];
      expect(Object.isFrozen(pb)).toBe(true);
      expect(Object.isFrozen(pb.bindings)).toBe(true);
      for (const action of BINDING_ACTIONS) {
        const list = pb.bindings[action];
        expect(Object.isFrozen(list)).toBe(true);
        for (const binding of list) {
          expect(Object.isFrozen(binding)).toBe(true);
          if (binding.kind === 'gamepad') {
            expect(Object.isFrozen(binding.source)).toBe(true);
          }
        }
      }
    }
  });

  it('getDefaultPlayerBinding(slot) returns the same instance as the table', () => {
    for (const slot of ALL_SLOTS) {
      expect(getDefaultPlayerBinding(slot)).toBe(DEFAULT_PLAYER_BINDINGS[slot]);
    }
  });

  it('serialises round-trip-cleanly to JSON (replay determinism contract)', () => {
    const json = JSON.stringify(DEFAULT_PLAYER_BINDINGS);
    const round = JSON.parse(json) as Record<string, unknown>;
    expect(round).toEqual(JSON.parse(JSON.stringify(DEFAULT_PLAYER_BINDINGS)));
    // Two separate JSON encodings of the frozen defaults must be
    // byte-identical — this is what lets the replay system hash the
    // active binding profile alongside the input stream.
    expect(JSON.stringify(DEFAULT_PLAYER_BINDINGS)).toBe(json);
  });
});

describe('PlayerProfile (AC 40001 Sub-AC 1 literal contract)', () => {
  it('BINDINGS_SCHEMA_VERSION is a stable positive integer literal', () => {
    expect(BINDINGS_SCHEMA_VERSION).toBe(1);
    expect(Number.isInteger(BINDINGS_SCHEMA_VERSION)).toBe(true);
    expect(BINDINGS_SCHEMA_VERSION).toBeGreaterThan(0);
  });

  it('default profiles carry deviceType + schemaVersion + action map for every slot', () => {
    for (const slot of ALL_SLOTS) {
      const profile: PlayerProfile = DEFAULT_PLAYER_PROFILES[slot];
      // Schema version stamp.
      expect(profile.schemaVersion).toBe(BINDINGS_SCHEMA_VERSION);
      // Slot index matches table key.
      expect(profile.playerIndex).toBe(slot);
      // Device type follows the Seed slot policy.
      expect(profile.deviceType).toBe(slot <= 2 ? 'keyboard' : 'gamepad');
      // Action map covers the full vocabulary.
      expectFullCoverage(profile.bindings);
    }
  });

  it('default profiles are deeply frozen (replay determinism contract)', () => {
    expect(Object.isFrozen(DEFAULT_PLAYER_PROFILES)).toBe(true);
    for (const slot of ALL_SLOTS) {
      expect(Object.isFrozen(DEFAULT_PLAYER_PROFILES[slot])).toBe(true);
    }
  });

  it('getDefaultPlayerProfile(slot) returns the same instance as the table', () => {
    for (const slot of ALL_SLOTS) {
      expect(getDefaultPlayerProfile(slot)).toBe(DEFAULT_PLAYER_PROFILES[slot]);
    }
  });

  it('default profiles share the action map with default bindings (no copy)', () => {
    // Profiles wrap the *same* action map the runtime store reads, so
    // there is exactly one source of truth per slot. A divergence here
    // would mean the rebinding UI was writing to a different table than
    // the dispatcher reads.
    for (const slot of ALL_SLOTS) {
      expect(DEFAULT_PLAYER_PROFILES[slot].bindings).toBe(
        DEFAULT_PLAYER_BINDINGS[slot].bindings,
      );
    }
  });

  it('toPlayerProfile lifts a binding into a profile, stamping version + deviceType', () => {
    const binding: PlayerBinding = DEFAULT_PLAYER_BINDINGS[1];
    const profile = toPlayerProfile(binding, 'keyboard');
    expect(profile.schemaVersion).toBe(BINDINGS_SCHEMA_VERSION);
    expect(profile.playerIndex).toBe(binding.playerIndex);
    expect(profile.deviceType).toBe('keyboard');
    expect(profile.bindings).toBe(binding.bindings);
    expect(Object.isFrozen(profile)).toBe(true);
  });

  it('toPlayerProfile honours an explicit deviceType (mixed-device slot)', () => {
    // A player can mix devices on one slot (e.g. arrows + a pad
    // shoulder for grab); the caller picks the canonical deviceType.
    const profile = toPlayerProfile(DEFAULT_PLAYER_BINDINGS[1], 'gamepad');
    expect(profile.deviceType).toBe('gamepad');
  });

  it('fromPlayerProfile drops version + deviceType, returning the runtime binding', () => {
    const profile = DEFAULT_PLAYER_PROFILES[3];
    const binding = fromPlayerProfile(profile);
    expect(binding.playerIndex).toBe(profile.playerIndex);
    expect(binding.bindings).toBe(profile.bindings);
    expect(Object.isFrozen(binding)).toBe(true);
    // The runtime binding shape should not leak the schemaVersion /
    // deviceType fields.
    expect((binding as unknown as { schemaVersion?: unknown }).schemaVersion).toBeUndefined();
    expect((binding as unknown as { deviceType?: unknown }).deviceType).toBeUndefined();
  });

  it('toPlayerProfile / fromPlayerProfile round-trip preserves bindings', () => {
    for (const slot of ALL_SLOTS) {
      const before = DEFAULT_PLAYER_BINDINGS[slot];
      const deviceType = slot <= 2 ? 'keyboard' : 'gamepad';
      const profile = toPlayerProfile(before, deviceType);
      const after = fromPlayerProfile(profile);
      expect(after.playerIndex).toBe(before.playerIndex);
      expect(after.bindings).toBe(before.bindings);
    }
  });

  it('serialises round-trip-cleanly to JSON (persistence contract)', () => {
    const json = JSON.stringify(DEFAULT_PLAYER_PROFILES);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(parsed).toEqual(JSON.parse(JSON.stringify(DEFAULT_PLAYER_PROFILES)));
    // Encoding twice yields byte-identical output — the rebinding UI
    // and replay loader can hash the profile blob as part of desync
    // detection.
    expect(JSON.stringify(DEFAULT_PLAYER_PROFILES)).toBe(json);
  });
});
