import { describe, expect, it } from 'vitest';

import {
  ALLOWED_OVERLAP_PAIRS,
  bindingIdentity,
  bindingsConflict,
  checkProposedBindingForConflicts,
  detectAllIntraPlayerConflicts,
  detectIntraPlayerConflicts,
  detectIntraPlayerConflictsForProposal,
  formatIntraPlayerConflictPrompt,
  formatIntraPlayerWarningLines,
  intraPlayerConflictTintHex,
  INTRA_PLAYER_CONFLICT_TINT,
  isAllowedOverlap,
  type IntraPlayerBindingConflict,
} from './BindingConflictDetector';
import {
  BINDING_ACTIONS,
  DEFAULT_KEYBOARD_P1_BINDINGS,
  DEFAULT_KEYBOARD_P2_BINDINGS,
  DEFAULT_PLAYER_PROFILES,
  type ActionMap,
  type BindingAction,
  type GamepadBinding,
  type InputBinding,
  type KeyboardBinding,
  type PlayerBindingIndex,
  type PlayerProfile,
} from '../types/bindings';

/**
 * AC 50004 Sub-AC 4 — pure conflict-detection helpers (canonical
 * vocabulary).
 *
 * What this suite locks down:
 *
 *   1. {@link bindingIdentity} produces a stable identity for every
 *      device family (keyboard, gamepad button, gamepad half-axis) so
 *      "same physical input" ⇒ identical strings, "different input"
 *      ⇒ different strings.
 *   2. {@link detectIntraPlayerConflicts} returns:
 *      • Empty list for the freshly-defaulted P1 and P2 keyboard
 *        presets (canonical `moveUp` + `jump` overlap is allowed).
 *      • One conflict when two unrelated actions share a key.
 *      • A multi-action conflict when 3+ actions share a key, even if
 *        two of them are in the allowed-overlap pair (the third action
 *        breaks the exemption).
 *      • Conflicts on gamepad bindings as well, with pad index
 *        respected.
 *      • Locations sorted deterministically.
 *   3. {@link detectAllIntraPlayerConflicts} returns a frozen report
 *      with working `hasConflictAt` / `conflictsAt` / `conflictsForSlot`
 *      / `severityAt` indexes.
 *   4. {@link detectIntraPlayerConflictsForProposal} reports the
 *      conflict that *would* exist after a proposed write without
 *      mutating the supplied profile.
 *   5. {@link checkProposedBindingForConflicts} returns the
 *      `accepted: true` / `accepted: false` rejection result the
 *      rebinding UI consumes.
 *   6. {@link formatIntraPlayerWarningLines} +
 *      {@link formatIntraPlayerConflictPrompt} produce stable strings
 *      for the warning banner.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const KC = {
  W: 87,
  A: 65,
  S: 83,
  D: 68,
  F: 70,
  G: 71,
  H: 72,
  T: 84,
  R: 82,
  ARROW_UP: 38,
} as const;

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
  threshold = 0.5,
): GamepadBinding {
  return {
    kind: 'gamepad',
    gamepadIndex: padIdx,
    source: { type: 'axis', axisIndex: axis, direction, threshold },
  };
}

function buildProfile(
  slot: PlayerBindingIndex,
  overrides: Partial<Record<BindingAction, ReadonlyArray<InputBinding>>> = {},
): PlayerProfile {
  const base =
    slot === 1
      ? DEFAULT_KEYBOARD_P1_BINDINGS
      : slot === 2
        ? DEFAULT_KEYBOARD_P2_BINDINGS
        : DEFAULT_PLAYER_PROFILES[slot].bindings;
  const bindings: ActionMap = Object.freeze({
    ...base,
    ...overrides,
  }) as ActionMap;
  return Object.freeze<PlayerProfile>({
    schemaVersion: 1,
    playerIndex: slot,
    deviceType: slot <= 2 ? 'keyboard' : 'gamepad',
    bindings,
  });
}

function defaultSnapshot(): Record<PlayerBindingIndex, PlayerProfile> {
  return {
    1: DEFAULT_PLAYER_PROFILES[1],
    2: DEFAULT_PLAYER_PROFILES[2],
    3: DEFAULT_PLAYER_PROFILES[3],
    4: DEFAULT_PLAYER_PROFILES[4],
  };
}

// ---------------------------------------------------------------------------

describe('bindingIdentity', () => {
  it('keyboard bindings collide iff their keyCode matches', () => {
    expect(bindingIdentity(kbBinding(KC.W))).toBe(bindingIdentity(kbBinding(KC.W)));
    expect(bindingIdentity(kbBinding(KC.W))).not.toBe(bindingIdentity(kbBinding(KC.A)));
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
    expect(bindingIdentity(gpAxisBinding(0, 0, -1, 0.3))).toBe(
      bindingIdentity(gpAxisBinding(0, 0, -1, 0.9)),
    );
  });

  it('keyboard and gamepad bindings never share an identity', () => {
    expect(bindingIdentity(kbBinding(0))).not.toBe(
      bindingIdentity(gpButtonBinding(0, 0)),
    );
  });

  it('gamepadIndex null encodes as "any"', () => {
    const any: GamepadBinding = {
      kind: 'gamepad',
      gamepadIndex: null,
      source: { type: 'button', buttonIndex: 0 },
    };
    expect(bindingIdentity(any)).toContain('any');
  });
});

describe('bindingsConflict', () => {
  it('returns true for two identical keyboard bindings', () => {
    expect(bindingsConflict(kbBinding(KC.W), kbBinding(KC.W))).toBe(true);
  });

  it('returns false for two different keys', () => {
    expect(bindingsConflict(kbBinding(KC.W), kbBinding(KC.A))).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('isAllowedOverlap', () => {
  it('accepts the canonical moveUp + jump pair', () => {
    expect(isAllowedOverlap(new Set(['moveUp', 'jump']))).toBe(true);
  });

  it('rejects pairs not in the allow-list', () => {
    expect(isAllowedOverlap(new Set(['attack', 'shield']))).toBe(false);
  });

  it('rejects supersets of an allowed pair', () => {
    expect(isAllowedOverlap(new Set(['moveUp', 'jump', 'attack']))).toBe(false);
  });

  it('rejects single-action sets', () => {
    expect(isAllowedOverlap(new Set(['jump']))).toBe(false);
  });
});

describe('ALLOWED_OVERLAP_PAIRS', () => {
  it('contains exactly one pair (moveUp+jump) today', () => {
    expect(ALLOWED_OVERLAP_PAIRS.length).toBe(1);
    expect(ALLOWED_OVERLAP_PAIRS[0]).toEqual(['moveUp', 'jump']);
  });

  it('is frozen so callers cannot mutate the allow-list at runtime', () => {
    expect(Object.isFrozen(ALLOWED_OVERLAP_PAIRS)).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('detectIntraPlayerConflicts', () => {
  it('returns empty for the freshly-defaulted P1 keyboard preset', () => {
    expect(detectIntraPlayerConflicts(DEFAULT_PLAYER_PROFILES[1])).toEqual([]);
  });

  it('returns empty for the freshly-defaulted P2 keyboard preset', () => {
    expect(detectIntraPlayerConflicts(DEFAULT_PLAYER_PROFILES[2])).toEqual([]);
  });

  it('returns empty for the freshly-defaulted P3 / P4 gamepad presets', () => {
    expect(detectIntraPlayerConflicts(DEFAULT_PLAYER_PROFILES[3])).toEqual([]);
    expect(detectIntraPlayerConflicts(DEFAULT_PLAYER_PROFILES[4])).toEqual([]);
  });

  it('flags one conflict when two unrelated actions share a key', () => {
    const profile = buildProfile(1, {
      shield: [kbBinding(KC.F)], // F now conflicts with attack=F
    });
    const conflicts = detectIntraPlayerConflicts(profile);
    expect(conflicts.length).toBe(1);
    const c = conflicts[0]!;
    expect(c.slot).toBe(1);
    expect(c.severity).toBe('error');
    expect(c.identity).toBe('kb:70');
    expect(new Set(c.actions)).toEqual(new Set(['attack', 'shield']));
    for (const loc of c.locations) {
      expect(loc.slot).toBe(1);
    }
  });

  it('flags 3-way overlap that includes moveUp+jump (the 3rd action breaks exemption)', () => {
    const profile = buildProfile(1, {
      // attack now overlaps the default moveUp+jump=W
      attack: [kbBinding(KC.W)],
    });
    const conflicts = detectIntraPlayerConflicts(profile);
    expect(conflicts.length).toBe(1);
    const actions = new Set(conflicts[0]!.actions);
    expect(actions).toEqual(new Set(['moveUp', 'jump', 'attack']));
  });

  it('does not flag duplicate bindings inside a single action list', () => {
    const profile = buildProfile(1, {
      jump: [kbBinding(KC.W), kbBinding(KC.W)],
      moveUp: [kbBinding(KC.W)],
    });
    expect(detectIntraPlayerConflicts(profile)).toEqual([]);
  });

  it('flags multiple separate conflicts on the same slot', () => {
    const profile = buildProfile(1, {
      shield: [kbBinding(KC.F)], // collides with attack=F
      grab: [kbBinding(KC.G)], // collides with special=G
    });
    const conflicts = detectIntraPlayerConflicts(profile);
    expect(conflicts.length).toBe(2);
    const ids = conflicts.map((c) => c.identity).sort();
    expect(ids).toEqual(['kb:70', 'kb:71']);
  });

  it('flags gamepad-button duplicates within one slot', () => {
    // Default slot 3 binds `jump` to button 0; move it elsewhere so the
    // intentional collision under test (attack+special on btn 0) reads
    // as exactly two-action.
    const profile = buildProfile(3, {
      jump: [gpButtonBinding(0, 9)],
      attack: [gpButtonBinding(0, 0)],
      special: [gpButtonBinding(0, 0)],
    });
    const conflicts = detectIntraPlayerConflicts(profile);
    expect(conflicts.length).toBe(1);
    expect(conflicts[0]!.identity).toBe('gp:0:btn:0');
    expect(new Set(conflicts[0]!.actions)).toEqual(new Set(['attack', 'special']));
  });

  it('does not flag gamepad bindings on different pads', () => {
    const profile: PlayerProfile = Object.freeze({
      schemaVersion: 1,
      playerIndex: 3,
      deviceType: 'gamepad',
      bindings: Object.freeze({
        moveLeft: [gpAxisBinding(0, 0, -1)],
        moveRight: [gpAxisBinding(0, 0, 1)],
        moveUp: [gpAxisBinding(0, 1, -1)],
        moveDown: [gpAxisBinding(0, 1, 1)],
        jump: [gpButtonBinding(0, 6)],
        attack: [gpButtonBinding(0, 7)],
        special: [gpButtonBinding(1, 7)], // same button index but different pad
        shield: [gpButtonBinding(0, 5)],
        grab: [gpButtonBinding(0, 4)],
        dodge: [gpButtonBinding(0, 8)],
      }),
    });
    expect(detectIntraPlayerConflicts(profile)).toEqual([]);
  });

  it('locations are sorted by canonical action order within a conflict', () => {
    // grab=F, attack=F → action order is attack (rank 5) before grab (rank 8)
    const profile = buildProfile(1, {
      grab: [kbBinding(KC.F)],
    });
    const c = detectIntraPlayerConflicts(profile)[0]!;
    expect(c.actions).toEqual(['attack', 'grab']);
  });

  it('the returned conflicts list is frozen', () => {
    const profile = buildProfile(1, {
      shield: [kbBinding(KC.F)],
    });
    const conflicts = detectIntraPlayerConflicts(profile);
    expect(Object.isFrozen(conflicts)).toBe(true);
    expect(Object.isFrozen(conflicts[0])).toBe(true);
    expect(Object.isFrozen(conflicts[0]!.actions)).toBe(true);
    expect(Object.isFrozen(conflicts[0]!.locations)).toBe(true);
  });

  it('accepts the runtime PlayerBinding shape (no schemaVersion / deviceType)', () => {
    const runtime = {
      playerIndex: 1 as PlayerBindingIndex,
      bindings: {
        ...DEFAULT_PLAYER_PROFILES[1].bindings,
        shield: [kbBinding(KC.F)] as ReadonlyArray<InputBinding>,
      },
    };
    const conflicts = detectIntraPlayerConflicts(runtime);
    expect(conflicts.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------

describe('detectAllIntraPlayerConflicts', () => {
  it('returns an empty report for a freshly-defaulted snapshot', () => {
    const report = detectAllIntraPlayerConflicts(defaultSnapshot());
    expect(report.conflicts).toEqual([]);
    expect(report.hasConflicts).toBe(false);
    expect(report.hasConflictAt(1, 'jump')).toBe(false);
    expect(report.severityAt(1, 'jump')).toBeNull();
    expect(report.conflictsAt(1, 'jump')).toEqual([]);
    expect(report.conflictsForSlot(1)).toEqual([]);
  });

  it('combines per-slot conflicts in one frozen report', () => {
    const snapshot: Record<PlayerBindingIndex, PlayerProfile> = {
      ...defaultSnapshot(),
      1: buildProfile(1, { shield: [kbBinding(KC.F)] }),
      3: buildProfile(3, {
        attack: [gpButtonBinding(0, 0)],
        special: [gpButtonBinding(0, 0)],
      }),
    };
    const report = detectAllIntraPlayerConflicts(snapshot);
    expect(report.conflicts.length).toBe(2);
    expect(report.hasConflicts).toBe(true);
    const slots = new Set(report.conflicts.map((c) => c.slot));
    expect(slots).toEqual(new Set([1, 3]));
  });

  it('hasConflictAt / conflictsAt / severityAt agree on conflicted rows', () => {
    const snapshot: Record<PlayerBindingIndex, PlayerProfile> = {
      ...defaultSnapshot(),
      1: buildProfile(1, { shield: [kbBinding(KC.F)] }),
    };
    const report = detectAllIntraPlayerConflicts(snapshot);
    expect(report.hasConflictAt(1, 'attack')).toBe(true);
    expect(report.hasConflictAt(1, 'shield')).toBe(true);
    expect(report.hasConflictAt(1, 'jump')).toBe(false);
    expect(report.conflictsAt(1, 'attack').length).toBeGreaterThan(0);
    expect(report.severityAt(1, 'attack')).toBe('error');
    expect(report.severityAt(1, 'jump')).toBeNull();
  });

  it('conflictsForSlot returns only the specified slot', () => {
    const snapshot: Record<PlayerBindingIndex, PlayerProfile> = {
      ...defaultSnapshot(),
      1: buildProfile(1, { shield: [kbBinding(KC.F)] }),
      3: buildProfile(3, {
        attack: [gpButtonBinding(0, 0)],
        special: [gpButtonBinding(0, 0)],
      }),
    };
    const report = detectAllIntraPlayerConflicts(snapshot);
    expect(report.conflictsForSlot(1).length).toBe(1);
    expect(report.conflictsForSlot(3).length).toBe(1);
    expect(report.conflictsForSlot(2).length).toBe(0);
    expect(report.conflictsForSlot(4).length).toBe(0);
  });

  it('produces deterministic ordering across re-detection', () => {
    const snapshot: Record<PlayerBindingIndex, PlayerProfile> = {
      ...defaultSnapshot(),
      1: buildProfile(1, { shield: [kbBinding(KC.F)] }),
      2: buildProfile(2, { grab: [kbBinding(KC.ARROW_UP)] }),
    };
    const r1 = detectAllIntraPlayerConflicts(snapshot);
    const r2 = detectAllIntraPlayerConflicts(snapshot);
    expect(r1.conflicts.map((c) => c.identity)).toEqual(
      r2.conflicts.map((c) => c.identity),
    );
  });

  it('the report and conflict list are frozen', () => {
    const snapshot: Record<PlayerBindingIndex, PlayerProfile> = {
      ...defaultSnapshot(),
      1: buildProfile(1, { shield: [kbBinding(KC.F)] }),
    };
    const report = detectAllIntraPlayerConflicts(snapshot);
    expect(Object.isFrozen(report)).toBe(true);
    expect(Object.isFrozen(report.conflicts)).toBe(true);
  });

  it('iterates every binding action so no slot/action pair is missed', () => {
    const snapshot = defaultSnapshot();
    const report = detectAllIntraPlayerConflicts(snapshot);
    for (const slot of [1, 2, 3, 4] as const) {
      for (const action of BINDING_ACTIONS) {
        expect(report.hasConflictAt(slot, action)).toBe(false);
      }
    }
  });
});

// ---------------------------------------------------------------------------

describe('detectIntraPlayerConflictsForProposal', () => {
  it('returns empty when proposed binding does not collide with anything', () => {
    const conflicts = detectIntraPlayerConflictsForProposal(
      DEFAULT_PLAYER_PROFILES[1],
      'taunt' as BindingAction, // not actually a binding action — typed as BindingAction in test
      // ↑ guard against the test typo: use `dodge` (an actual action)
      [kbBinding(0xfe)],
    ).filter(() => true);
    // Re-do with a real action and a unique key:
    const real = detectIntraPlayerConflictsForProposal(
      DEFAULT_PLAYER_PROFILES[1],
      'dodge',
      [kbBinding(0xfe)],
    );
    expect(real).toEqual([]);
    // The first call's result should also be empty (same physical key, no collision).
    expect(conflicts).toEqual([]);
  });

  it('reports the conflict that would arise after the proposed write', () => {
    // Propose binding `shield` to F, where attack already binds F.
    const conflicts = detectIntraPlayerConflictsForProposal(
      DEFAULT_PLAYER_PROFILES[1],
      'shield',
      [kbBinding(KC.F)],
    );
    expect(conflicts.length).toBe(1);
    expect(new Set(conflicts[0]!.actions)).toEqual(new Set(['attack', 'shield']));
  });

  it('does not mutate the supplied profile', () => {
    const profile = DEFAULT_PLAYER_PROFILES[1];
    const before = JSON.stringify(profile);
    detectIntraPlayerConflictsForProposal(profile, 'shield', [kbBinding(KC.F)]);
    expect(JSON.stringify(profile)).toBe(before);
  });

  it('respects allowed-overlap exemption (binding moveUp to W when jump=W is fine)', () => {
    // Jump is bound to W by default. Re-binding moveUp to W stays allowed.
    const profile = buildProfile(1, { moveUp: [kbBinding(KC.A)] }); // first move it away
    const conflicts = detectIntraPlayerConflictsForProposal(
      profile,
      'moveUp',
      [kbBinding(KC.W)], // back to overlapping with jump=W
    );
    expect(conflicts).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe('checkProposedBindingForConflicts', () => {
  it('returns accepted: true when proposal is conflict-free', () => {
    const result = checkProposedBindingForConflicts(
      DEFAULT_PLAYER_PROFILES[1],
      'dodge',
      [kbBinding(0xfe)],
    );
    expect(result.accepted).toBe(true);
  });

  it('returns accepted: false with conflicts + warning lines on conflict', () => {
    const result = checkProposedBindingForConflicts(
      DEFAULT_PLAYER_PROFILES[1],
      'shield',
      [kbBinding(KC.F)],
    );
    expect(result.accepted).toBe(false);
    if (result.accepted === false) {
      expect(result.reason).toBe('intra_player_conflict');
      expect(result.conflicts.length).toBe(1);
      expect(result.warningLines.length).toBeGreaterThanOrEqual(2);
      expect(result.warningLines[0]!).toContain('binding conflict');
      expect(result.warningLines[1]!).toContain('Attack');
      expect(result.warningLines[1]!).toContain('Shield');
    }
  });

  it('rejection result is frozen so consumers cannot mutate it', () => {
    const result = checkProposedBindingForConflicts(
      DEFAULT_PLAYER_PROFILES[1],
      'shield',
      [kbBinding(KC.F)],
    );
    expect(Object.isFrozen(result)).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('formatIntraPlayerConflictPrompt', () => {
  it('describes the conflict with player tag, identity, and actions', () => {
    const conflict: IntraPlayerBindingConflict = Object.freeze({
      slot: 1 as PlayerBindingIndex,
      severity: 'error' as const,
      identity: 'kb:70',
      locations: Object.freeze([
        { slot: 1 as PlayerBindingIndex, action: 'attack' as BindingAction, bindingIndex: 0 },
        { slot: 1 as PlayerBindingIndex, action: 'shield' as BindingAction, bindingIndex: 0 },
      ]),
      actions: Object.freeze(['attack', 'shield'] as BindingAction[]),
    });
    const line = formatIntraPlayerConflictPrompt(conflict);
    expect(line).toContain('P1');
    expect(line).toContain('kb:70');
    expect(line).toContain('Attack');
    expect(line).toContain('Shield');
    expect(line.toLowerCase()).toContain('unbind');
  });

  it('uses Title-Case labels for compound action names', () => {
    const conflict: IntraPlayerBindingConflict = Object.freeze({
      slot: 2 as PlayerBindingIndex,
      severity: 'error' as const,
      identity: 'kb:38',
      locations: Object.freeze([
        { slot: 2 as PlayerBindingIndex, action: 'moveUp' as BindingAction, bindingIndex: 0 },
        { slot: 2 as PlayerBindingIndex, action: 'jump' as BindingAction, bindingIndex: 0 },
        { slot: 2 as PlayerBindingIndex, action: 'attack' as BindingAction, bindingIndex: 0 },
      ]),
      actions: Object.freeze(['moveUp', 'jump', 'attack'] as BindingAction[]),
    });
    const line = formatIntraPlayerConflictPrompt(conflict);
    expect(line).toContain('Move Up');
    expect(line).toContain('Jump');
    expect(line).toContain('Attack');
  });
});

describe('formatIntraPlayerWarningLines', () => {
  it('returns an empty array when no conflicts', () => {
    const report = detectAllIntraPlayerConflicts(defaultSnapshot());
    expect(formatIntraPlayerWarningLines(report)).toEqual([]);
  });

  it('includes a count headline + per-conflict prompt', () => {
    const snapshot: Record<PlayerBindingIndex, PlayerProfile> = {
      ...defaultSnapshot(),
      1: buildProfile(1, { shield: [kbBinding(KC.F)] }),
    };
    const report = detectAllIntraPlayerConflicts(snapshot);
    const lines = formatIntraPlayerWarningLines(report);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines[0]!).toContain('1 binding conflict');
  });

  it('truncates the detail list with a "more" footer', () => {
    const snapshot: Record<PlayerBindingIndex, PlayerProfile> = {
      ...defaultSnapshot(),
      1: buildProfile(1, {
        // Cause four conflicts at once on slot 1.
        attack: [kbBinding(KC.A)],
        shield: [kbBinding(KC.D)],
        special: [kbBinding(KC.S)],
        grab: [kbBinding(KC.W)],
      }),
    };
    const report = detectAllIntraPlayerConflicts(snapshot);
    const lines = formatIntraPlayerWarningLines(report, 1);
    // headline + 1 detail + "and N more"
    expect(lines.length).toBe(3);
    expect(lines[lines.length - 1]!).toContain('more');
  });

  it('is deterministic for the same report', () => {
    const snapshot: Record<PlayerBindingIndex, PlayerProfile> = {
      ...defaultSnapshot(),
      1: buildProfile(1, { shield: [kbBinding(KC.F)] }),
    };
    const r1 = detectAllIntraPlayerConflicts(snapshot);
    const r2 = detectAllIntraPlayerConflicts(snapshot);
    expect(formatIntraPlayerWarningLines(r1)).toEqual(formatIntraPlayerWarningLines(r2));
  });

  it('caps detail lines via maxDetailLines parameter', () => {
    const snapshot: Record<PlayerBindingIndex, PlayerProfile> = {
      ...defaultSnapshot(),
      1: buildProfile(1, {
        attack: [kbBinding(KC.A)],
        shield: [kbBinding(KC.D)],
      }),
    };
    const report = detectAllIntraPlayerConflicts(snapshot);
    const lines = formatIntraPlayerWarningLines(report, 0);
    // headline + 0 details + "and N more"
    expect(lines.length).toBe(2);
    expect(lines[1]!).toContain('more');
  });
});

describe('INTRA_PLAYER_CONFLICT_TINT / intraPlayerConflictTintHex', () => {
  it('returns a 7-char "#rrggbb" string', () => {
    const s = intraPlayerConflictTintHex('error');
    expect(s.startsWith('#')).toBe(true);
    expect(s.length).toBe(7);
  });

  it('error and warning tints are distinct', () => {
    expect(INTRA_PLAYER_CONFLICT_TINT.error).not.toBe(
      INTRA_PLAYER_CONFLICT_TINT.warning,
    );
  });

  it('hex aligns with the legacy detector palette (red error / yellow warning)', () => {
    expect(INTRA_PLAYER_CONFLICT_TINT.error).toBe(0xff5b5b);
    expect(INTRA_PLAYER_CONFLICT_TINT.warning).toBe(0xffd166);
  });
});
