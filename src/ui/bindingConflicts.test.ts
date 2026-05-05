import { describe, it, expect } from 'vitest';
import {
  ALLOWED_OVERLAP_PAIRS,
  bindingIdentity,
  bindingsConflict,
  conflictTintHexString,
  CONFLICT_TINT,
  detectAllConflicts,
  detectInterPlayerKeyboardConflicts,
  detectInterPlayerKeyboardConflictsForSlots,
  detectIntraPlayerConflicts,
  formatConflictBannerLines,
  formatConflictResolutionPrompt,
  isAllowedOverlap,
  type BindingConflict,
} from './bindingConflicts';
import {
  DEFAULT_KEYBOARD_P1_BINDINGS,
  DEFAULT_PLAYER_BINDINGS,
  InputBindingsStore,
} from '../input/InputBindingsStore';
import { KEY_CODE } from '../input/keyCodes';
import {
  LOGICAL_ACTIONS,
  type ActionBindings,
  type GamepadBinding,
  type KeyboardBinding,
  type LogicalAction,
  type PlayerBindings,
  type PlayerBindingsIndex,
} from '../types/inputBindings';

/**
 * AC 40103 Sub-AC 3 — pure conflict-detection helpers.
 *
 * What this suite locks down:
 *
 *   1. {@link bindingIdentity} produces a stable identity for every
 *      device family (keyboard, gamepad button, gamepad half-axis) such
 *      that "same physical input" ⇒ identical strings, "different input"
 *      ⇒ different strings.
 *   2. {@link detectIntraPlayerConflicts} returns:
 *      • An empty list for a freshly defaulted keyboard slot (default
 *        `up + jump` overlap is allowed, no other duplicates).
 *      • A single conflict when two unrelated actions share a key.
 *      • A multi-action conflict when 3+ actions share a key, even if
 *        two of them are in the allowed-overlap pair (the third action
 *        breaks the exemption).
 *      • Locations sorted by slot, action, then binding index.
 *   3. {@link detectInterPlayerKeyboardConflicts} flags duplicates
 *      between slots 1 and 2 only — gamepad bindings are never flagged
 *      regardless of `gamepadIndex`.
 *   4. {@link detectAllConflicts} composes the per-player and the
 *      cross-player passes into a single deterministically-ordered
 *      report.
 *   5. The {@link ConflictReport.hasConflict}, `conflictsAt`, and
 *      `severityAt` lookup helpers return the right answer for both
 *      conflicted and clean (slot, action) pairs.
 *   6. The resolution-prompt formatters produce stable strings for the
 *      banner line and per-conflict detail lines.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function kbBinding(keyCode: number): KeyboardBinding {
  return { kind: 'keyboard', keyCode };
}

function gpButtonBinding(padIdx: number, btn: number): GamepadBinding {
  return {
    kind: 'gamepad',
    gamepadIndex: padIdx,
    source: { type: 'button', buttonIndex: btn },
  };
}

function gpAxisBinding(
  padIdx: number,
  axis: number,
  direction: -1 | 1,
): GamepadBinding {
  return {
    kind: 'gamepad',
    gamepadIndex: padIdx,
    source: { type: 'axis', axisIndex: axis, direction, threshold: 0.5 },
  };
}

/**
 * Slot-aware defaults — slot 2 returns the arrow-key preset so a fresh
 * snapshot does NOT show every WASD key as a cross-slot conflict.
 */
function defaultsForSlot(
  slot: PlayerBindingsIndex,
): Record<LogicalAction, ReadonlyArray<unknown>> {
  if (slot === 1) {
    return {
      left: [kbBinding(KEY_CODE.A)],
      right: [kbBinding(KEY_CODE.D)],
      up: [kbBinding(KEY_CODE.W)],
      down: [kbBinding(KEY_CODE.S)],
      jump: [kbBinding(KEY_CODE.W)],
      attack: [kbBinding(KEY_CODE.F)],
      special: [kbBinding(KEY_CODE.G)],
      shield: [kbBinding(KEY_CODE.H)],
      grab: [kbBinding(KEY_CODE.T)],
      taunt: [kbBinding(KEY_CODE.R)],
    };
  }
  if (slot === 2) {
    return {
      left: [kbBinding(KEY_CODE.ARROW_LEFT)],
      right: [kbBinding(KEY_CODE.ARROW_RIGHT)],
      up: [kbBinding(KEY_CODE.ARROW_UP)],
      down: [kbBinding(KEY_CODE.ARROW_DOWN)],
      jump: [kbBinding(KEY_CODE.ARROW_UP)],
      attack: [kbBinding(KEY_CODE.NUMPAD_1)],
      special: [kbBinding(KEY_CODE.NUMPAD_2)],
      shield: [kbBinding(KEY_CODE.NUMPAD_3)],
      grab: [kbBinding(KEY_CODE.NUMPAD_4)],
      taunt: [kbBinding(KEY_CODE.NUMPAD_5)],
    };
  }
  // Slots 3+4 default to gamepad — pinned to pad 0 / pad 1.
  const padIdx = slot === 3 ? 0 : 1;
  return {
    left: [gpAxisBinding(padIdx, 0, -1)],
    right: [gpAxisBinding(padIdx, 0, 1)],
    up: [gpAxisBinding(padIdx, 1, -1)],
    down: [gpAxisBinding(padIdx, 1, 1)],
    jump: [gpButtonBinding(padIdx, 0)],
    attack: [gpButtonBinding(padIdx, 2)],
    special: [gpButtonBinding(padIdx, 3)],
    shield: [gpButtonBinding(padIdx, 5)],
    grab: [gpButtonBinding(padIdx, 4)],
    taunt: [gpButtonBinding(padIdx, 1)],
  };
}

function buildBindings(
  slot: PlayerBindingsIndex,
  overrides: Partial<Record<LogicalAction, ReadonlyArray<unknown>>> = {},
): ActionBindings {
  return Object.freeze({ ...defaultsForSlot(slot), ...overrides }) as ActionBindings;
}

function buildPlayerBindings(
  slot: PlayerBindingsIndex,
  overrides: Partial<Record<LogicalAction, ReadonlyArray<unknown>>> = {},
): PlayerBindings {
  return { playerIndex: slot, bindings: buildBindings(slot, overrides) };
}

function buildSnapshot(
  perSlot: Partial<
    Record<PlayerBindingsIndex, Partial<Record<LogicalAction, ReadonlyArray<unknown>>>>
  > = {},
): Record<PlayerBindingsIndex, PlayerBindings> {
  return {
    1: buildPlayerBindings(1, perSlot[1]),
    2: buildPlayerBindings(2, perSlot[2]),
    3: buildPlayerBindings(3, perSlot[3]),
    4: buildPlayerBindings(4, perSlot[4]),
  };
}

// ---------------------------------------------------------------------------

describe('bindingIdentity', () => {
  it('keyboard bindings collide iff their keyCode matches', () => {
    expect(bindingIdentity(kbBinding(KEY_CODE.W))).toBe(
      bindingIdentity(kbBinding(KEY_CODE.W)),
    );
    expect(bindingIdentity(kbBinding(KEY_CODE.W))).not.toBe(
      bindingIdentity(kbBinding(KEY_CODE.A)),
    );
  });

  it('gamepad button identities include pad index', () => {
    expect(bindingIdentity(gpButtonBinding(0, 0))).not.toBe(
      bindingIdentity(gpButtonBinding(1, 0)),
    );
    expect(bindingIdentity(gpButtonBinding(0, 0))).toBe(
      bindingIdentity(gpButtonBinding(0, 0)),
    );
  });

  it('gamepad half-axes with different signs do not collide', () => {
    expect(bindingIdentity(gpAxisBinding(0, 0, -1))).not.toBe(
      bindingIdentity(gpAxisBinding(0, 0, 1)),
    );
  });

  it('gamepad half-axes with same sign collide regardless of threshold', () => {
    const a: GamepadBinding = {
      kind: 'gamepad',
      gamepadIndex: 0,
      source: { type: 'axis', axisIndex: 0, direction: -1, threshold: 0.3 },
    };
    const b: GamepadBinding = {
      kind: 'gamepad',
      gamepadIndex: 0,
      source: { type: 'axis', axisIndex: 0, direction: -1, threshold: 0.9 },
    };
    expect(bindingIdentity(a)).toBe(bindingIdentity(b));
  });

  it('keyboard and gamepad bindings never share an identity', () => {
    expect(bindingIdentity(kbBinding(0))).not.toBe(
      bindingIdentity(gpButtonBinding(0, 0)),
    );
  });

  it('gamepadIndex null binds to "any" — overlaps every per-pad binding', () => {
    const any: GamepadBinding = {
      kind: 'gamepad',
      gamepadIndex: null,
      source: { type: 'button', buttonIndex: 0 },
    };
    expect(bindingIdentity(any)).toContain('any');
  });
});

describe('bindingsConflict', () => {
  it('returns true for two equal keyboard bindings', () => {
    expect(bindingsConflict(kbBinding(KEY_CODE.W), kbBinding(KEY_CODE.W))).toBe(true);
  });

  it('returns false for two different keys', () => {
    expect(bindingsConflict(kbBinding(KEY_CODE.W), kbBinding(KEY_CODE.A))).toBe(false);
  });
});

describe('isAllowedOverlap', () => {
  it('accepts the canonical up + jump pair', () => {
    expect(isAllowedOverlap(new Set(['up', 'jump']))).toBe(true);
  });

  it('rejects pairs not in the allow-list', () => {
    expect(isAllowedOverlap(new Set(['attack', 'shield']))).toBe(false);
  });

  it('rejects supersets of an allowed pair', () => {
    expect(isAllowedOverlap(new Set(['up', 'jump', 'attack']))).toBe(false);
  });

  it('rejects single-action sets', () => {
    expect(isAllowedOverlap(new Set(['jump']))).toBe(false);
  });
});

describe('ALLOWED_OVERLAP_PAIRS', () => {
  it('contains exactly one pair (up+jump) today', () => {
    expect(ALLOWED_OVERLAP_PAIRS.length).toBe(1);
    expect(ALLOWED_OVERLAP_PAIRS[0]).toEqual(['up', 'jump']);
  });

  it('is frozen so callers cannot mutate the allow-list at runtime', () => {
    expect(Object.isFrozen(ALLOWED_OVERLAP_PAIRS)).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('detectIntraPlayerConflicts', () => {
  it('returns an empty list for the default P1 keyboard preset (up+jump allowed)', () => {
    const pb: PlayerBindings = {
      playerIndex: 1,
      bindings: DEFAULT_KEYBOARD_P1_BINDINGS,
    };
    const conflicts = detectIntraPlayerConflicts(pb);
    expect(conflicts).toEqual([]);
  });

  it('returns one conflict when two unrelated actions share a key', () => {
    const pb = buildPlayerBindings(1, {
      shield: [kbBinding(KEY_CODE.F)],   // F now conflicts with attack=F
    });
    const conflicts = detectIntraPlayerConflicts(pb);
    expect(conflicts.length).toBe(1);
    const c = conflicts[0]!;
    expect(c.kind).toBe('intra_player');
    expect(c.severity).toBe('error');
    expect(c.bindingLabel).toBe('F');
    const actions = c.locations.map((l) => l.action).sort();
    expect(actions).toEqual(['attack', 'shield']);
    for (const loc of c.locations) {
      expect(loc.slot).toBe(1);
    }
  });

  it('flags 3-way overlap that includes up+jump (the third action breaks exemption)', () => {
    const pb = buildPlayerBindings(1, {
      attack: [kbBinding(KEY_CODE.W)], // attack now overlaps the default up+jump=W
    });
    const conflicts = detectIntraPlayerConflicts(pb);
    expect(conflicts.length).toBe(1);
    const actions = new Set(conflicts[0]!.locations.map((l) => l.action));
    expect(actions).toEqual(new Set(['up', 'jump', 'attack']));
  });

  it('does not flag duplicate bindings inside a single action list', () => {
    const pb = buildPlayerBindings(1, {
      jump: [kbBinding(KEY_CODE.W), kbBinding(KEY_CODE.W)],
      up: [kbBinding(KEY_CODE.W)], // up+jump still allowed-overlap
    });
    const conflicts = detectIntraPlayerConflicts(pb);
    expect(conflicts).toEqual([]);
  });

  it('flags multiple separate conflicts on the same slot', () => {
    const pb = buildPlayerBindings(1, {
      shield: [kbBinding(KEY_CODE.F)],   // collides with attack=F
      grab: [kbBinding(KEY_CODE.G)],     // collides with special=G
    });
    const conflicts = detectIntraPlayerConflicts(pb);
    expect(conflicts.length).toBe(2);
    const labels = conflicts.map((c) => c.bindingLabel).sort();
    expect(labels).toEqual(['F', 'G']);
  });

  it('flags gamepad-source duplicates within one slot', () => {
    const pb = buildPlayerBindings(3, {
      attack: [gpButtonBinding(0, 0)],
      special: [gpButtonBinding(0, 0)],
    });
    const conflicts = detectIntraPlayerConflicts(pb);
    expect(conflicts.length).toBe(1);
    expect(conflicts[0]!.kind).toBe('intra_player');
    expect(conflicts[0]!.bindingLabel).toContain('A'); // standard btn 0 = "A"
  });

  it('does not collide gamepad bindings on different pads', () => {
    // Build a slot 3 profile with no other gamepad bindings on btn 0/btn 7.
    const pb: PlayerBindings = {
      playerIndex: 3,
      bindings: Object.freeze({
        left: [gpAxisBinding(0, 0, -1)],
        right: [gpAxisBinding(0, 0, 1)],
        up: [gpAxisBinding(0, 1, -1)],
        down: [gpAxisBinding(0, 1, 1)],
        jump: [gpButtonBinding(0, 6)],   // unique button on pad 0
        attack: [gpButtonBinding(0, 7)], // unique button on pad 0
        special: [gpButtonBinding(1, 7)], // *same button index* but on pad 1
        shield: [gpButtonBinding(0, 5)],
        grab: [gpButtonBinding(0, 4)],
        taunt: [gpButtonBinding(0, 8)],
      }),
    };
    const conflicts = detectIntraPlayerConflicts(pb);
    expect(conflicts).toEqual([]);
  });

  it('locations are sorted by action name within a conflict', () => {
    const pb = buildPlayerBindings(1, {
      shield: [kbBinding(KEY_CODE.F)],
    });
    const c = detectIntraPlayerConflicts(pb)[0]!;
    const sorted = c.locations.map((l) => l.action);
    expect(sorted).toEqual([...sorted].sort());
  });

  it('returned conflicts list is frozen', () => {
    const pb = buildPlayerBindings(1, {
      shield: [kbBinding(KEY_CODE.F)],
    });
    const conflicts = detectIntraPlayerConflicts(pb);
    expect(Object.isFrozen(conflicts)).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('detectInterPlayerKeyboardConflicts', () => {
  it('returns an empty list for a fresh default snapshot', () => {
    const snapshot = DEFAULT_PLAYER_BINDINGS;
    expect(detectInterPlayerKeyboardConflicts(snapshot)).toEqual([]);
  });

  it('flags a key that appears on both slot 1 and slot 2', () => {
    const snapshot = buildSnapshot({
      2: { jump: [kbBinding(KEY_CODE.W)], up: [kbBinding(KEY_CODE.W)] },
    });
    const conflicts = detectInterPlayerKeyboardConflicts(snapshot);
    expect(conflicts.length).toBe(1);
    const c = conflicts[0]!;
    expect(c.kind).toBe('inter_player_keyboard');
    expect(c.severity).toBe('error');
    expect(c.bindingLabel).toBe('W');
    const slots = c.locations.map((l) => l.slot).sort();
    expect(slots).toContain(1);
    expect(slots).toContain(2);
  });

  it('does not flag a single-slot duplicate as inter-player', () => {
    const snapshot = buildSnapshot({
      1: { shield: [kbBinding(KEY_CODE.F)] }, // intra-player only
    });
    const conflicts = detectInterPlayerKeyboardConflicts(snapshot);
    expect(conflicts).toEqual([]);
  });

  it('does not flag gamepad-only duplicates regardless of pad index', () => {
    const snapshot = buildSnapshot({
      1: { attack: [gpButtonBinding(0, 0)] }, // weird but valid
      2: { attack: [gpButtonBinding(0, 0)] }, // same pad
    });
    const conflicts = detectInterPlayerKeyboardConflicts(snapshot);
    expect(conflicts).toEqual([]);
  });

  it('flags multiple distinct cross-slot keyboard duplicates', () => {
    const snapshot = buildSnapshot({
      2: {
        left: [kbBinding(KEY_CODE.A)],   // collides with P1 left=A
        right: [kbBinding(KEY_CODE.D)],  // collides with P1 right=D
      },
    });
    const conflicts = detectInterPlayerKeyboardConflicts(snapshot);
    expect(conflicts.length).toBe(2);
    const labels = conflicts.map((c) => c.bindingLabel).sort();
    expect(labels).toEqual(['A', 'D']);
  });

  it('detectInterPlayerKeyboardConflictsForSlots(1,1) returns nothing', () => {
    const snapshot = buildSnapshot();
    expect(detectInterPlayerKeyboardConflictsForSlots(snapshot, 1, 1)).toEqual([]);
  });

  it('every conflict location is on slot A or slot B (no other slots leak in)', () => {
    const snapshot = buildSnapshot({
      2: { jump: [kbBinding(KEY_CODE.W)], up: [kbBinding(KEY_CODE.W)] },
    });
    const conflicts = detectInterPlayerKeyboardConflicts(snapshot);
    for (const c of conflicts) {
      for (const loc of c.locations) {
        expect([1, 2]).toContain(loc.slot);
      }
    }
  });
});

// ---------------------------------------------------------------------------

describe('detectAllConflicts', () => {
  it('returns an empty report for a freshly-defaulted store', () => {
    const store = new InputBindingsStore();
    const report = detectAllConflicts(store.snapshot());
    expect(report.conflicts).toEqual([]);
    expect(report.hasConflict(1, 'jump')).toBe(false);
    expect(report.severityAt(1, 'jump')).toBeNull();
  });

  it('combines intra-player and inter-player conflicts in one report', () => {
    const snapshot = buildSnapshot({
      1: { shield: [kbBinding(KEY_CODE.F)] }, // intra: attack/shield = F
      2: { jump: [kbBinding(KEY_CODE.W)], up: [kbBinding(KEY_CODE.W)] }, // inter: P1+P2 share W
    });
    const report = detectAllConflicts(snapshot);
    const kinds = report.conflicts.map((c) => c.kind);
    expect(kinds).toContain('intra_player');
    expect(kinds).toContain('inter_player_keyboard');
  });

  it('hasConflict / conflictsAt / severityAt agree on conflicted rows', () => {
    const snapshot = buildSnapshot({
      1: { shield: [kbBinding(KEY_CODE.F)] },
    });
    const report = detectAllConflicts(snapshot);
    expect(report.hasConflict(1, 'attack')).toBe(true);
    expect(report.hasConflict(1, 'shield')).toBe(true);
    expect(report.hasConflict(1, 'jump')).toBe(false);
    expect(report.conflictsAt(1, 'attack').length).toBeGreaterThan(0);
    expect(report.severityAt(1, 'attack')).toBe('error');
    expect(report.severityAt(1, 'jump')).toBeNull();
  });

  it('produces deterministic ordering across re-detection', () => {
    const snapshot = buildSnapshot({
      1: { shield: [kbBinding(KEY_CODE.F)] },
      2: { jump: [kbBinding(KEY_CODE.W)], up: [kbBinding(KEY_CODE.W)] },
    });
    const r1 = detectAllConflicts(snapshot);
    const r2 = detectAllConflicts(snapshot);
    expect(r1.conflicts.map((c) => c.identity)).toEqual(
      r2.conflicts.map((c) => c.identity),
    );
  });

  it('inter-player conflicts sort before intra-player conflicts', () => {
    const snapshot = buildSnapshot({
      1: { shield: [kbBinding(KEY_CODE.F)] }, // intra
      2: { jump: [kbBinding(KEY_CODE.W)], up: [kbBinding(KEY_CODE.W)] }, // inter
    });
    const report = detectAllConflicts(snapshot);
    const firstKind = report.conflicts[0]?.kind;
    expect(firstKind).toBe('inter_player_keyboard');
  });

  it('the report and conflict list are frozen', () => {
    const store = new InputBindingsStore();
    store.setAction(1, 'shield', [kbBinding(KEY_CODE.F)]);
    const report = detectAllConflicts(store.snapshot());
    expect(Object.isFrozen(report)).toBe(true);
    expect(Object.isFrozen(report.conflicts)).toBe(true);
  });

  it('iterates every logical action so no slot/action pair is missed', () => {
    const snapshot = buildSnapshot();
    const report = detectAllConflicts(snapshot);
    for (const slot of [1, 2, 3, 4] as const) {
      for (const action of LOGICAL_ACTIONS) {
        // No throws — just confirm the queries run.
        expect(report.hasConflict(slot, action)).toBe(false);
      }
    }
  });
});

// ---------------------------------------------------------------------------

describe('formatConflictResolutionPrompt', () => {
  it('describes intra-player conflicts as "unbind one"', () => {
    const conflict: BindingConflict = {
      kind: 'intra_player',
      severity: 'error',
      identity: 'kb:70',
      bindingLabel: 'F',
      locations: Object.freeze([
        { slot: 1 as const, action: 'attack', bindingIndex: 0 },
        { slot: 1 as const, action: 'shield', bindingIndex: 0 },
      ]),
    };
    const line = formatConflictResolutionPrompt(conflict);
    expect(line).toContain('F');
    expect(line).toContain('P1 Attack');
    expect(line).toContain('P1 Shield');
    expect(line.toLowerCase()).toContain('unbind');
  });

  it('describes inter-player keyboard conflicts as "give one a different key"', () => {
    const conflict: BindingConflict = {
      kind: 'inter_player_keyboard',
      severity: 'error',
      identity: 'kb:87',
      bindingLabel: 'W',
      locations: Object.freeze([
        { slot: 1 as const, action: 'jump', bindingIndex: 0 },
        { slot: 2 as const, action: 'jump', bindingIndex: 0 },
      ]),
    };
    const line = formatConflictResolutionPrompt(conflict);
    expect(line).toContain('W');
    expect(line.toLowerCase()).toContain('different key');
  });
});

describe('formatConflictBannerLines', () => {
  it('returns an empty array when no conflicts', () => {
    const store = new InputBindingsStore();
    const report = detectAllConflicts(store.snapshot());
    const lines = formatConflictBannerLines(report);
    expect(lines).toEqual([]);
  });

  it('includes a count headline + per-conflict prompt for small reports', () => {
    const store = new InputBindingsStore();
    store.setAction(1, 'shield', [kbBinding(KEY_CODE.F)]);
    const report = detectAllConflicts(store.snapshot());
    const lines = formatConflictBannerLines(report);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines[0]).toContain('1 binding conflict');
  });

  it('truncates the detail list with a "more" footer', () => {
    const store = new InputBindingsStore();
    // Cause many conflicts at once on slot 1.
    store.setAction(1, 'attack', [kbBinding(KEY_CODE.W)]);
    store.setAction(1, 'shield', [kbBinding(KEY_CODE.A)]);
    store.setAction(1, 'special', [kbBinding(KEY_CODE.D)]);
    store.setAction(1, 'grab', [kbBinding(KEY_CODE.S)]);
    const report = detectAllConflicts(store.snapshot());
    const lines = formatConflictBannerLines(report, 1);
    // headline + 1 detail + "and N more"
    expect(lines.length).toBe(3);
    expect(lines[lines.length - 1]).toContain('more');
  });

  it('is deterministic for the same report', () => {
    const store = new InputBindingsStore();
    store.setAction(1, 'shield', [kbBinding(KEY_CODE.F)]);
    const r1 = detectAllConflicts(store.snapshot());
    const r2 = detectAllConflicts(store.snapshot());
    expect(formatConflictBannerLines(r1)).toEqual(formatConflictBannerLines(r2));
  });
});

describe('CONFLICT_TINT / conflictTintHexString', () => {
  it('returns a 7-char "#rrggbb" string', () => {
    const s = conflictTintHexString('error');
    expect(s.startsWith('#')).toBe(true);
    expect(s.length).toBe(7);
  });

  it('error is more red than warning is more red', () => {
    expect(CONFLICT_TINT.error).not.toBe(CONFLICT_TINT.warning);
  });
});
