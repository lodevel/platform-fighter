import { describe, it, expect } from 'vitest';
import {
  ALL_BINDING_PROFILE_SLOTS,
  canonicalDeviceTypeForSlot,
  conventionalPadIndexForSlot,
  InputBindingProfileManager,
} from './InputBindingProfileManager';
import {
  BINDING_ACTIONS,
  BINDINGS_SCHEMA_VERSION,
  buildDefaultGamepadBindings,
  DEFAULT_PLAYER_PROFILES,
  type BindingAction,
  type GamepadBinding,
  type KeyboardBinding,
  type PlayerBinding,
  type PlayerBindingIndex,
  type PlayerProfile,
} from '../types/bindings';
import {
  gamepadDefaults,
  keyboardDefaultsBySlot,
  keyboardDefaultsP1,
  keyboardDefaultsP2,
} from './defaultBindingProfiles';
import { KEY_CODE } from './keyCodes';

/**
 * AC 50003 Sub-AC 3 — InputBindingProfileManager.
 *
 * Locks down:
 *
 *   1. Get/set bindings per slot — `getProfile / setProfile / setBinding /
 *      setActionBindings` round-trip cleanly with frozen, deep-cloned values.
 *   2. Action-to-input lookup — `resolveAction` returns the bound input list
 *      for any (slot, action) pair, including the `keyboard` / `gamepad`
 *      filtered variants.
 *   3. Device-type defaults — `initializeSlotWithDefaults` seeds the slot
 *      with the right default profile for the requested device type, and
 *      the constructor applies the canonical Seed slot policy when no hints
 *      are supplied (P1/P2 keyboard, P3/P4 gamepad).
 *   4. Determinism — two managers built with the same options are
 *      structurally identical; reads hand back deeply-frozen values that
 *      cannot mutate the manager's internal state.
 *   5. Invariants — playerIndex / deviceType / bindings shape are
 *      validated on every write; mismatches throw eagerly.
 */

// ---------------------------------------------------------------------------
// Constructor — defaults
// ---------------------------------------------------------------------------

describe('InputBindingProfileManager — default construction', () => {
  it('seeds every slot with the canonical Seed-policy default profile', () => {
    const m = new InputBindingProfileManager();
    expect(m.getProfile(1)).toBe(DEFAULT_PLAYER_PROFILES[1]);
    expect(m.getProfile(2)).toBe(DEFAULT_PLAYER_PROFILES[2]);
    expect(m.getProfile(3)).toBe(DEFAULT_PLAYER_PROFILES[3]);
    expect(m.getProfile(4)).toBe(DEFAULT_PLAYER_PROFILES[4]);
  });

  it('reports the canonical device type per slot', () => {
    const m = new InputBindingProfileManager();
    expect(m.getDeviceType(1)).toBe('keyboard');
    expect(m.getDeviceType(2)).toBe('keyboard');
    expect(m.getDeviceType(3)).toBe('gamepad');
    expect(m.getDeviceType(4)).toBe('gamepad');
  });

  it('exposes the four-slot snapshot in slot order', () => {
    const m = new InputBindingProfileManager();
    const snap = m.snapshot();
    expect(Object.keys(snap).map(Number).sort()).toEqual([1, 2, 3, 4]);
    for (const slot of ALL_BINDING_PROFILE_SLOTS) {
      expect(snap[slot]).toBe(m.getProfile(slot));
    }
  });

  it('two default-built managers hold structurally-identical state', () => {
    const a = new InputBindingProfileManager();
    const b = new InputBindingProfileManager();
    for (const slot of ALL_BINDING_PROFILE_SLOTS) {
      expect(a.getProfile(slot)).toBe(b.getProfile(slot));
    }
  });
});

// ---------------------------------------------------------------------------
// Constructor — overrides
// ---------------------------------------------------------------------------

describe('InputBindingProfileManager — constructor overrides', () => {
  it('honours an explicit `profiles` override per slot', () => {
    const customP3: PlayerProfile = {
      schemaVersion: BINDINGS_SCHEMA_VERSION,
      playerIndex: 3,
      deviceType: 'keyboard',
      bindings: keyboardDefaultsBySlot[3],
    };
    const m = new InputBindingProfileManager({ profiles: { 3: customP3 } });
    expect(m.getDeviceType(3)).toBe('keyboard');
    // Other slots remain canonical defaults.
    expect(m.getProfile(1)).toBe(DEFAULT_PLAYER_PROFILES[1]);
  });

  it('honours a `deviceTypes` override and seeds the matching default profile', () => {
    const m = new InputBindingProfileManager({ deviceTypes: { 3: 'keyboard' } });
    expect(m.getDeviceType(3)).toBe('keyboard');
    // The slot's bindings should be the keyboard defaults for slot 3.
    expect(m.getProfile(3).bindings).toBe(keyboardDefaultsBySlot[3]);
  });

  it('`profiles` wins over `deviceTypes` when both are supplied for a slot', () => {
    const customP1: PlayerProfile = {
      schemaVersion: BINDINGS_SCHEMA_VERSION,
      playerIndex: 1,
      deviceType: 'gamepad',
      bindings: buildDefaultGamepadBindings(7),
    };
    const m = new InputBindingProfileManager({
      profiles: { 1: customP1 },
      deviceTypes: { 1: 'keyboard' },
    });
    expect(m.getDeviceType(1)).toBe('gamepad');
    const jump = m.resolveAction(1, 'jump')[0] as GamepadBinding | undefined;
    expect(jump?.gamepadIndex).toBe(7);
  });

  it('rejects an explicit profile whose playerIndex disagrees with the slot', () => {
    const wrong: PlayerProfile = {
      schemaVersion: BINDINGS_SCHEMA_VERSION,
      playerIndex: 2,
      deviceType: 'keyboard',
      bindings: keyboardDefaultsP1,
    };
    expect(() => new InputBindingProfileManager({ profiles: { 1: wrong } })).toThrow(
      /playerIndex \(2\) does not match destination slot 1/,
    );
  });

  it('deep-clones an explicit profile so external mutation cannot leak', () => {
    type MutableMap = { [K in BindingAction]?: ReadonlyArray<KeyboardBinding> };
    const mutableBindings: MutableMap = {};
    for (const action of BINDING_ACTIONS) {
      mutableBindings[action] = [{ kind: 'keyboard', keyCode: KEY_CODE.W }];
    }
    const customP1: PlayerProfile = {
      schemaVersion: BINDINGS_SCHEMA_VERSION,
      playerIndex: 1,
      deviceType: 'keyboard',
      bindings: mutableBindings as PlayerProfile['bindings'],
    };
    const m = new InputBindingProfileManager({ profiles: { 1: customP1 } });
    // Mutate the source; manager must remain unaffected.
    const newJump: KeyboardBinding[] = [{ kind: 'keyboard', keyCode: KEY_CODE.SPACE }];
    (mutableBindings as Record<BindingAction, ReadonlyArray<KeyboardBinding>>).jump =
      newJump;
    const stored = m.resolveAction(1, 'jump')[0] as KeyboardBinding | undefined;
    expect(stored?.keyCode).toBe(KEY_CODE.W);
  });
});

// ---------------------------------------------------------------------------
// Get
// ---------------------------------------------------------------------------

describe('InputBindingProfileManager — get bindings per player slot', () => {
  it('getBinding strips the schema-version + device-type metadata', () => {
    const m = new InputBindingProfileManager();
    const binding: PlayerBinding = m.getBinding(1);
    expect(binding.playerIndex).toBe(1);
    expect(binding.bindings).toBe(DEFAULT_PLAYER_PROFILES[1].bindings);
    expect((binding as object as Record<string, unknown>).schemaVersion).toBeUndefined();
    expect((binding as object as Record<string, unknown>).deviceType).toBeUndefined();
  });

  it('returns a frozen profile that cannot be mutated', () => {
    const m = new InputBindingProfileManager();
    const profile = m.getProfile(1);
    expect(Object.isFrozen(profile)).toBe(true);
    expect(Object.isFrozen(profile.bindings)).toBe(true);
    expect(() => {
      // @ts-expect-error — runtime-frozen.
      profile.deviceType = 'gamepad';
    }).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Resolve — action-to-input lookup
// ---------------------------------------------------------------------------

describe('InputBindingProfileManager — resolve action-to-input lookup', () => {
  it('returns the keyboard binding for default P1 jump = W', () => {
    const m = new InputBindingProfileManager();
    const inputs = m.resolveAction(1, 'jump');
    expect(inputs).toHaveLength(1);
    const kb = inputs[0] as KeyboardBinding;
    expect(kb.kind).toBe('keyboard');
    expect(kb.keyCode).toBe(KEY_CODE.W);
  });

  it('returns the gamepad binding for default P3 attack = button 2 on pad 0', () => {
    const m = new InputBindingProfileManager();
    const inputs = m.resolveAction(3, 'attack');
    expect(inputs).toHaveLength(1);
    const gp = inputs[0] as GamepadBinding;
    expect(gp.kind).toBe('gamepad');
    expect(gp.gamepadIndex).toBe(0);
    expect(gp.source).toEqual({ type: 'button', buttonIndex: 2 });
  });

  it('returns an empty array for an action the player has cleared', () => {
    const m = new InputBindingProfileManager();
    m.setActionBindings(1, 'dodge', []);
    expect(m.resolveAction(1, 'dodge')).toEqual([]);
  });

  it('resolveKeyboardBindings returns only keyboard entries from a multi-bind slot', () => {
    const m = new InputBindingProfileManager();
    m.setActionBindings(1, 'jump', [
      { kind: 'keyboard', keyCode: KEY_CODE.SPACE },
      { kind: 'gamepad', gamepadIndex: 0, source: { type: 'button', buttonIndex: 0 } },
    ]);
    const kb = m.resolveKeyboardBindings(1, 'jump');
    expect(kb).toHaveLength(1);
    expect(kb[0]?.keyCode).toBe(KEY_CODE.SPACE);
  });

  it('resolveGamepadBindings returns only gamepad entries from a multi-bind slot', () => {
    const m = new InputBindingProfileManager();
    m.setActionBindings(1, 'jump', [
      { kind: 'keyboard', keyCode: KEY_CODE.SPACE },
      { kind: 'gamepad', gamepadIndex: 0, source: { type: 'button', buttonIndex: 0 } },
    ]);
    const gp = m.resolveGamepadBindings(1, 'jump');
    expect(gp).toHaveLength(1);
    expect(gp[0]?.gamepadIndex).toBe(0);
  });

  it('every action on every slot resolves to a non-undefined list by default', () => {
    const m = new InputBindingProfileManager();
    for (const slot of ALL_BINDING_PROFILE_SLOTS) {
      for (const action of BINDING_ACTIONS) {
        const inputs = m.resolveAction(slot, action);
        expect(Array.isArray(inputs)).toBe(true);
        expect(inputs.length).toBeGreaterThan(0);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Set
// ---------------------------------------------------------------------------

describe('InputBindingProfileManager — set bindings per player slot', () => {
  it('setProfile replaces the slot atomically', () => {
    const m = new InputBindingProfileManager();
    const next: PlayerProfile = {
      schemaVersion: BINDINGS_SCHEMA_VERSION,
      playerIndex: 2,
      deviceType: 'gamepad',
      bindings: buildDefaultGamepadBindings(3),
    };
    m.setProfile(2, next);
    expect(m.getDeviceType(2)).toBe('gamepad');
    expect(
      (m.resolveAction(2, 'jump')[0] as GamepadBinding | undefined)?.gamepadIndex,
    ).toBe(3);
  });

  it('setProfile rejects a profile whose playerIndex disagrees with the slot', () => {
    const m = new InputBindingProfileManager();
    const wrong: PlayerProfile = {
      schemaVersion: BINDINGS_SCHEMA_VERSION,
      playerIndex: 4,
      deviceType: 'gamepad',
      bindings: buildDefaultGamepadBindings(0),
    };
    expect(() => m.setProfile(2, wrong)).toThrow(
      /playerIndex \(4\) does not match destination slot 2/,
    );
  });

  it('setBinding preserves the existing deviceType', () => {
    const m = new InputBindingProfileManager();
    const newBinding: PlayerBinding = {
      playerIndex: 1,
      bindings: keyboardDefaultsP2,
    };
    m.setBinding(1, newBinding);
    expect(m.getDeviceType(1)).toBe('keyboard');
    expect(
      (m.resolveAction(1, 'attack')[0] as KeyboardBinding | undefined)?.keyCode,
    ).toBe(KEY_CODE.NUMPAD_1);
  });

  it('setBinding throws on a slot mismatch', () => {
    const m = new InputBindingProfileManager();
    expect(() =>
      m.setBinding(2, { playerIndex: 1, bindings: keyboardDefaultsP1 }),
    ).toThrow(/does not match destination slot 2/);
  });

  it('setActionBindings replaces only the targeted action', () => {
    const m = new InputBindingProfileManager();
    const beforeAttack = m.resolveAction(1, 'attack');
    m.setActionBindings(1, 'jump', [{ kind: 'keyboard', keyCode: KEY_CODE.SPACE }]);
    const afterAttack = m.resolveAction(1, 'attack');
    expect(afterAttack).toEqual(beforeAttack);
    const jump = m.resolveAction(1, 'jump');
    expect(jump).toHaveLength(1);
    expect((jump[0] as KeyboardBinding).keyCode).toBe(KEY_CODE.SPACE);
  });

  it('setActionBindings accepts an empty array (deliberate unbind)', () => {
    const m = new InputBindingProfileManager();
    // 'dodge' is the canonical M5 unbind candidate (the legacy schema's
    // 'taunt' action does not exist in `BINDING_ACTIONS`).
    m.setActionBindings(1, 'dodge', []);
    expect(m.resolveAction(1, 'dodge')).toEqual([]);
  });

  it('setActionBindings rejects a non-array payload', () => {
    const m = new InputBindingProfileManager();
    expect(() =>
      m.setActionBindings(
        1,
        'jump',
        // @ts-expect-error — runtime check for non-array.
        { kind: 'keyboard', keyCode: KEY_CODE.SPACE },
      ),
    ).toThrow(/must be an array/);
  });

  it('written values are deeply frozen so callers cannot mutate stored state', () => {
    const m = new InputBindingProfileManager();
    const list: KeyboardBinding[] = [{ kind: 'keyboard', keyCode: KEY_CODE.SPACE }];
    m.setActionBindings(1, 'jump', list);
    const stored = m.resolveAction(1, 'jump');
    expect(Object.isFrozen(stored)).toBe(true);
    expect(() => {
      (stored as KeyboardBinding[]).push({ kind: 'keyboard', keyCode: KEY_CODE.W });
    }).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Initialise / reset
// ---------------------------------------------------------------------------

describe('InputBindingProfileManager — initialize slots with device-type defaults', () => {
  it('seeds slot 3 with the canonical default-keyboard layout when re-initialised to keyboard', () => {
    const m = new InputBindingProfileManager();
    expect(m.getDeviceType(3)).toBe('gamepad');
    m.initializeSlotWithDefaults(3, 'keyboard');
    expect(m.getDeviceType(3)).toBe('keyboard');
    expect(m.getProfile(3).bindings).toBe(keyboardDefaultsBySlot[3]);
  });

  it('seeds slot 1 with the canonical gamepad preset pinned to pad 0 when re-initialised to gamepad', () => {
    const m = new InputBindingProfileManager();
    m.initializeSlotWithDefaults(1, 'gamepad');
    expect(m.getDeviceType(1)).toBe('gamepad');
    const jump = m.resolveAction(1, 'jump')[0] as GamepadBinding;
    expect(jump.gamepadIndex).toBe(conventionalPadIndexForSlot(1));
    expect(jump.source).toEqual({ type: 'button', buttonIndex: 0 });
  });

  it('default device-type argument falls back to the canonical Seed slot policy', () => {
    const m = new InputBindingProfileManager({
      deviceTypes: { 1: 'gamepad', 2: 'gamepad', 3: 'keyboard', 4: 'keyboard' },
    });
    // Re-initialise without a deviceType arg — expect the canonical default
    // for each slot (1/2 keyboard, 3/4 gamepad).
    for (const slot of ALL_BINDING_PROFILE_SLOTS) {
      m.initializeSlotWithDefaults(slot);
    }
    expect(m.getDeviceType(1)).toBe('keyboard');
    expect(m.getDeviceType(2)).toBe('keyboard');
    expect(m.getDeviceType(3)).toBe('gamepad');
    expect(m.getDeviceType(4)).toBe('gamepad');
  });

  it('idempotent — re-initialising with the same args is a no-op state-wise', () => {
    const m = new InputBindingProfileManager();
    const before = m.getProfile(2);
    m.initializeSlotWithDefaults(2, 'keyboard');
    m.initializeSlotWithDefaults(2, 'keyboard');
    expect(m.getProfile(2)).toBe(before);
  });

  it('resetSlot wipes per-slot customisation back to the canonical default', () => {
    const m = new InputBindingProfileManager();
    m.setActionBindings(1, 'jump', [{ kind: 'keyboard', keyCode: KEY_CODE.SPACE }]);
    expect((m.resolveAction(1, 'jump')[0] as KeyboardBinding).keyCode).toBe(
      KEY_CODE.SPACE,
    );
    m.resetSlot(1);
    expect(m.getProfile(1)).toBe(DEFAULT_PLAYER_PROFILES[1]);
  });

  it('resetAll wipes every slot', () => {
    const m = new InputBindingProfileManager();
    m.setActionBindings(1, 'jump', [{ kind: 'keyboard', keyCode: KEY_CODE.SPACE }]);
    m.setActionBindings(3, 'attack', []);
    m.resetAll();
    for (const slot of ALL_BINDING_PROFILE_SLOTS) {
      expect(m.getProfile(slot)).toBe(DEFAULT_PLAYER_PROFILES[slot]);
    }
  });

  it('resetAction restores a single action without disturbing the rest of the slot', () => {
    const m = new InputBindingProfileManager();
    const beforeAttack = m.resolveAction(1, 'attack');
    m.setActionBindings(1, 'jump', [{ kind: 'keyboard', keyCode: KEY_CODE.SPACE }]);
    m.setActionBindings(1, 'attack', [{ kind: 'keyboard', keyCode: KEY_CODE.SPACE }]);
    m.resetAction(1, 'jump');
    // Jump back to default (W).
    expect((m.resolveAction(1, 'jump')[0] as KeyboardBinding).keyCode).toBe(KEY_CODE.W);
    // Attack still customised.
    expect((m.resolveAction(1, 'attack')[0] as KeyboardBinding).keyCode).toBe(
      KEY_CODE.SPACE,
    );
    // resetAction(1, 'attack') restores it.
    m.resetAction(1, 'attack');
    expect(m.resolveAction(1, 'attack')).toEqual(beforeAttack);
  });
});

// ---------------------------------------------------------------------------
// Diagnostic accessors
// ---------------------------------------------------------------------------

describe('InputBindingProfileManager — diagnostic accessors', () => {
  it('keyboardSlots / gamepadSlots reflect the canonical Seed policy by default', () => {
    const m = new InputBindingProfileManager();
    expect(m.keyboardSlots()).toEqual([1, 2]);
    expect(m.gamepadSlots()).toEqual([3, 4]);
  });

  it('keyboardSlots / gamepadSlots respect runtime re-initialisation', () => {
    const m = new InputBindingProfileManager();
    m.initializeSlotWithDefaults(3, 'keyboard');
    m.initializeSlotWithDefaults(1, 'gamepad');
    expect(m.keyboardSlots()).toEqual([2, 3]);
    expect(m.gamepadSlots()).toEqual([1, 4]);
  });

  it('canonicalDeviceTypeForSlot matches the Seed slot policy', () => {
    expect(canonicalDeviceTypeForSlot(1)).toBe('keyboard');
    expect(canonicalDeviceTypeForSlot(2)).toBe('keyboard');
    expect(canonicalDeviceTypeForSlot(3)).toBe('gamepad');
    expect(canonicalDeviceTypeForSlot(4)).toBe('gamepad');
  });

  it('conventionalPadIndexForSlot maps slot 3 → pad 0, slot 4 → pad 1', () => {
    expect(conventionalPadIndexForSlot(3)).toBe(0);
    expect(conventionalPadIndexForSlot(4)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Determinism + identity-equality fast path
// ---------------------------------------------------------------------------

describe('InputBindingProfileManager — determinism', () => {
  it('default-built manager shares its default profiles with module-level frozen constants', () => {
    const m = new InputBindingProfileManager();
    for (const slot of ALL_BINDING_PROFILE_SLOTS) {
      expect(m.getProfile(slot)).toBe(DEFAULT_PLAYER_PROFILES[slot]);
    }
  });

  it('snapshot is structurally stable across construction passes (deep equal)', () => {
    const a = new InputBindingProfileManager().snapshot();
    const b = new InputBindingProfileManager().snapshot();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('gamepadDefaults template uses gamepadIndex: null (untouched by manager init)', () => {
    // Sanity check that the manager's per-slot default does NOT use the
    // pad-agnostic template — it should be pinned via
    // `buildDefaultGamepadBindings(<padIndex>)`.
    const m = new InputBindingProfileManager();
    expect((m.resolveAction(3, 'jump')[0] as GamepadBinding).gamepadIndex).toBe(0);
    expect((gamepadDefaults['jump'][0] as GamepadBinding).gamepadIndex).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Slot enumeration constant
// ---------------------------------------------------------------------------

describe('InputBindingProfileManager — slot enumeration', () => {
  it('ALL_BINDING_PROFILE_SLOTS is frozen and ascending 1..4', () => {
    expect(ALL_BINDING_PROFILE_SLOTS).toEqual([1, 2, 3, 4]);
    expect(Object.isFrozen(ALL_BINDING_PROFILE_SLOTS)).toBe(true);
  });

  it('enumerable for-of yields slot indices in deterministic order', () => {
    const seen: PlayerBindingIndex[] = [];
    for (const slot of ALL_BINDING_PROFILE_SLOTS) {
      seen.push(slot);
    }
    expect(seen).toEqual([1, 2, 3, 4]);
  });
});

// ---------------------------------------------------------------------------
// Conflict detection — AC 50004 Sub-AC 4
// ---------------------------------------------------------------------------

describe('InputBindingProfileManager — intra-player conflict detection (AC 50004 Sub-AC 4)', () => {
  it('reports clean state for a freshly-defaulted manager', () => {
    const m = new InputBindingProfileManager();
    expect(m.hasIntraPlayerConflicts()).toBe(false);
    const report = m.detectIntraPlayerConflicts();
    expect(report.conflicts).toEqual([]);
    expect(report.hasConflicts).toBe(false);
  });

  it('flags a conflict after a duplicate-key write through setActionBindings', () => {
    const m = new InputBindingProfileManager();
    // Default P1 keyboard binds attack=F, shield=H. Re-binding shield to F
    // creates an intra-player conflict on (attack, shield).
    m.setActionBindings(1, 'shield', [{ kind: 'keyboard', keyCode: KEY_CODE.F }]);
    expect(m.hasIntraPlayerConflicts()).toBe(true);
    expect(m.hasIntraPlayerConflictsForSlot(1)).toBe(true);
    expect(m.hasIntraPlayerConflictsForSlot(2)).toBe(false);
    const slotConflicts = m.detectIntraPlayerConflictsForSlot(1);
    expect(slotConflicts.length).toBe(1);
    const c = slotConflicts[0]!;
    expect(c.identity).toBe('kb:70');
    expect(new Set(c.actions)).toEqual(new Set(['attack', 'shield']));
  });

  it('does not flag the canonical moveUp+jump overlap on default P1', () => {
    // Default keyboard P1 binds moveUp=W and jump=W; the allowed-overlap
    // exemption keeps the report clean.
    const m = new InputBindingProfileManager();
    expect(m.detectIntraPlayerConflictsForSlot(1)).toEqual([]);
    expect(m.hasIntraPlayerConflictsForSlot(1)).toBe(false);
  });

  it('checkActionBindingsProposal returns accepted: true for a unique key', () => {
    const m = new InputBindingProfileManager();
    const result = m.checkActionBindingsProposal(1, 'dodge', [
      { kind: 'keyboard', keyCode: 0xfe },
    ]);
    expect(result.accepted).toBe(true);
  });

  it('checkActionBindingsProposal returns accepted: false with warning lines on conflict', () => {
    const m = new InputBindingProfileManager();
    const result = m.checkActionBindingsProposal(1, 'shield', [
      { kind: 'keyboard', keyCode: KEY_CODE.F }, // conflicts with attack=F
    ]);
    expect(result.accepted).toBe(false);
    if (result.accepted === false) {
      expect(result.reason).toBe('intra_player_conflict');
      expect(result.conflicts.length).toBe(1);
      expect(result.warningLines.length).toBeGreaterThanOrEqual(2);
      expect(result.warningLines[0]!).toContain('binding conflict');
    }
  });

  it('checkActionBindingsProposal does not mutate the manager', () => {
    const m = new InputBindingProfileManager();
    const beforeShield = JSON.stringify(m.resolveAction(1, 'shield'));
    m.checkActionBindingsProposal(1, 'shield', [
      { kind: 'keyboard', keyCode: KEY_CODE.F },
    ]);
    expect(JSON.stringify(m.resolveAction(1, 'shield'))).toBe(beforeShield);
  });

  it('setActionBindingsChecked commits when the proposal is conflict-free', () => {
    const m = new InputBindingProfileManager();
    const result = m.setActionBindingsChecked(1, 'dodge', [
      { kind: 'keyboard', keyCode: 0xfe },
    ]);
    expect(result.accepted).toBe(true);
    const after = m.resolveAction(1, 'dodge');
    expect(after.length).toBe(1);
    expect((after[0] as KeyboardBinding).keyCode).toBe(0xfe);
  });

  it('setActionBindingsChecked refuses to commit when the proposal would conflict', () => {
    const m = new InputBindingProfileManager();
    const beforeShield = m.resolveAction(1, 'shield');
    const result = m.setActionBindingsChecked(1, 'shield', [
      { kind: 'keyboard', keyCode: KEY_CODE.F },
    ]);
    expect(result.accepted).toBe(false);
    // The previous binding for shield is preserved.
    const afterShield = m.resolveAction(1, 'shield');
    expect(afterShield).toEqual(beforeShield);
  });

  it('detectIntraPlayerConflicts surfaces conflicts on multiple slots independently', () => {
    const m = new InputBindingProfileManager();
    // Cause a conflict on slot 1 and a conflict on slot 3.
    m.setActionBindings(1, 'shield', [{ kind: 'keyboard', keyCode: KEY_CODE.F }]);
    m.setActionBindings(3, 'special', [
      { kind: 'gamepad', gamepadIndex: 0, source: { type: 'button', buttonIndex: 0 } },
    ]); // pad 0 btn 0 already bound to jump on slot 3 default
    const report = m.detectIntraPlayerConflicts();
    expect(report.conflicts.length).toBe(2);
    expect(report.conflictsForSlot(1).length).toBe(1);
    expect(report.conflictsForSlot(3).length).toBe(1);
    expect(report.hasConflictAt(1, 'attack')).toBe(true);
    expect(report.hasConflictAt(3, 'special')).toBe(true);
    expect(report.severityAt(1, 'attack')).toBe('error');
  });

  it('hasIntraPlayerConflicts returns false again after the conflict is resolved', () => {
    const m = new InputBindingProfileManager();
    m.setActionBindings(1, 'shield', [{ kind: 'keyboard', keyCode: KEY_CODE.F }]);
    expect(m.hasIntraPlayerConflicts()).toBe(true);
    // Resolve by re-binding shield to a unique key.
    m.setActionBindings(1, 'shield', [{ kind: 'keyboard', keyCode: 0xfe }]);
    expect(m.hasIntraPlayerConflicts()).toBe(false);
  });

  it('resetSlot clears all conflicts on the slot (defaults are conflict-free)', () => {
    const m = new InputBindingProfileManager();
    m.setActionBindings(1, 'shield', [{ kind: 'keyboard', keyCode: KEY_CODE.F }]);
    expect(m.hasIntraPlayerConflictsForSlot(1)).toBe(true);
    m.resetSlot(1);
    expect(m.hasIntraPlayerConflictsForSlot(1)).toBe(false);
  });
});
