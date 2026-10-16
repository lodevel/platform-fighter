import { describe, expect, it } from 'vitest';
import {
  DEFAULT_KEYBOARD_P1_BINDINGS,
  DEFAULT_KEYBOARD_P2_BINDINGS,
  assertValidPlayerBindings,
  buildDefaultGamepadBindings,
} from './InputBindingsStore';
import { KEY_CODE } from './keyCodes';
import {
  defaultSmashKeyBindings,
  defaultSmashStickBindings,
  fillMissingSmash,
  fillMissingSmashInPlayerBindings,
  fillMissingSmashInSnapshot,
  keyboardHalfForProfileBase,
  keyboardHalfForSlot,
  type SmashFillHint,
} from './smashBindingDefaults';
import {
  LOGICAL_ACTIONS,
  type ActionBindings,
  type GamepadBinding,
  type InputBinding,
} from '../types/inputBindings';

/** A pre-`smash` save: the set as older builds wrote it, without the key. */
function withoutSmash(bindings: ActionBindings): Record<string, unknown> {
  const { smash: _smash, ...rest } = JSON.parse(JSON.stringify(bindings)) as Record<string, unknown>;
  return rest;
}

function axis(pad: number | null, axisIndex: number, direction: -1 | 1): GamepadBinding {
  return { kind: 'gamepad', gamepadIndex: pad, source: { type: 'axis', axisIndex, direction, threshold: 0.5 } };
}

function key(keyCode: number): InputBinding {
  return { kind: 'keyboard', keyCode };
}

const P1 = DEFAULT_KEYBOARD_P1_BINDINGS;
const P2 = DEFAULT_KEYBOARD_P2_BINDINGS;
const PAD0 = buildDefaultGamepadBindings(0);
const H1: SmashFillHint = { keyboardHalf: 'keyboard_p1' };
const H2: SmashFillHint = { keyboardHalf: 'keyboard_p2' };

/** A P2 layout moved off the arrows/numpad onto IJKL + letters (no V). */
function p2OnLetters(): Record<string, unknown> {
  return {
    left: [key(74)], right: [key(76)], up: [key(73)], down: [key(75)], jump: [key(73)],
    attack: [key(85)], special: [key(79)], shield: [key(80)], grab: [key(89)], taunt: [key(78)],
  };
}

describe('fillMissingSmash', () => {
  it('restores the exact default layouts, byte for byte, when smash is missing', () => {
    expect(JSON.stringify(fillMissingSmash(withoutSmash(P1), H1))).toBe(JSON.stringify(P1));
    expect(JSON.stringify(fillMissingSmash(withoutSmash(P2), H2))).toBe(JSON.stringify(P2));
    for (const pad of [0, 1, 3]) {
      const defaults = buildDefaultGamepadBindings(pad);
      expect(JSON.stringify(fillMissingSmash(withoutSmash(defaults), {}))).toBe(JSON.stringify(defaults));
    }
  });

  it('defaults P2 to Numpad 0 (Insert with NumLock off), not a key that doubles as an arrow', () => {
    expect(defaultSmashKeyBindings('keyboard_p2')).toEqual([key(KEY_CODE.NUMPAD_0)]);
    expect(defaultSmashKeyBindings('keyboard_p1')).toEqual([key(KEY_CODE.V)]);
  });

  it('takes the key from the hinted half even when the layout moved to the other half', () => {
    // P2 moved onto letters keeps P2's key: it never inherits P1's V.
    expect(fillMissingSmash(p2OnLetters(), H2)['smash']).toEqual([key(KEY_CODE.NUMPAD_0)]);
    // P1 moved wholesale onto the arrow/numpad half keeps V.
    expect(fillMissingSmash(withoutSmash(P2), H1)['smash']).toEqual([key(KEY_CODE.V)]);
  });

  it('votes the half from the set’s own keys only when the hint names none, P1 on a tie', () => {
    expect(fillMissingSmash(withoutSmash(P2), {})['smash']).toEqual([key(KEY_CODE.NUMPAD_0)]);
    expect(fillMissingSmash(withoutSmash(P1), { keyboardHalf: null })['smash']).toEqual([key(KEY_CODE.V)]);
    expect(fillMissingSmash(p2OnLetters(), {})['smash']).toEqual([key(KEY_CODE.V)]);
    const split = {
      ...withoutSmash(P2),
      // Arrows (5 bindings incl. up+jump) vs five P1-half attack keys.
      attack: [key(74)], special: [key(75)], shield: [key(76)], grab: [key(73)], taunt: [key(79)],
    };
    expect(fillMissingSmash(split, {})['smash']).toEqual([key(KEY_CODE.V)]);
  });

  it('never picks a key another player already holds', () => {
    expect(fillMissingSmash(withoutSmash(P1), { ...H1, reservedKeyCodes: new Set([KEY_CODE.V]) })['smash']).toEqual([]);
    expect(fillMissingSmash(withoutSmash(P2), { ...H2, reservedKeyCodes: new Set([KEY_CODE.NUMPAD_0]) })['smash'])
      .toEqual([]);
    // Reserved keys do not block the stick of a mixed set.
    const mixed = { ...withoutSmash(P1), special: [key(KEY_CODE.G), axis(1, 0, -1)] };
    expect(fillMissingSmash(mixed, { ...H1, reservedKeyCodes: new Set([KEY_CODE.V]) })['smash'])
      .toEqual(defaultSmashStickBindings(1));
  });

  it('pins the stick to the pad the set already uses, or null for a profile', () => {
    expect(fillMissingSmash(withoutSmash(buildDefaultGamepadBindings(2)))['smash'])
      .toEqual(defaultSmashStickBindings(2));
    const profile = JSON.parse(JSON.stringify(withoutSmash(PAD0)).replace(/"gamepadIndex":0/g, '"gamepadIndex":null'));
    const filled = fillMissingSmash(profile)['smash'] as GamepadBinding[];
    expect(filled).toHaveLength(4);
    expect(filled.every(binding => binding.gamepadIndex === null)).toBe(true);
  });

  it('leaves smash unbound when its default key is already used by another action', () => {
    const p1 = { ...withoutSmash(P1), attack: [key(KEY_CODE.V)] };
    expect(fillMissingSmash(p1, H1)['smash']).toEqual([]);
    const p2 = { ...withoutSmash(P2), grab: [key(KEY_CODE.NUMPAD_0)] };
    expect(fillMissingSmash(p2, H2)['smash']).toEqual([]);
    // The result is still a valid set without intra-player duplicates.
    expect(() => assertValidPlayerBindings({ playerIndex: 1, bindings: fillMissingSmash(p1, H1) })).not.toThrow();
  });

  it('leaves smash unbound when the set already reads the right stick on that pad', () => {
    // A saved layout that walks on the right stick must not start smashing while walking.
    const walksOnRightStick = { ...withoutSmash(PAD0), left: [axis(0, 2, -1)], right: [axis(0, 2, 1)] };
    expect(fillMissingSmash(walksOnRightStick)['smash']).toEqual([]);
    const aimsWithY = { ...withoutSmash(PAD0), up: [axis(0, 3, -1)] };
    expect(fillMissingSmash(aimsWithY)['smash']).toEqual([]);
    // An "any pad" axis 2/3 binding overlaps every pad.
    const anyPad = { ...withoutSmash(PAD0), taunt: [axis(null, 3, 1)] };
    expect(fillMissingSmash(anyPad)['smash']).toEqual([]);
  });

  it('still fills the stick when axes 2/3 are only used on a different pad', () => {
    const otherPad = { ...withoutSmash(PAD0), taunt: [axis(1, 2, 1)] };
    expect(fillMissingSmash(otherPad)['smash']).toEqual(defaultSmashStickBindings(0));
  });

  it('fills both the key and the stick for a mixed keyboard + pad set, each only when free', () => {
    const mixed = { ...withoutSmash(P1), special: [key(KEY_CODE.G), axis(1, 0, -1)] };
    expect(fillMissingSmash(mixed, H1)['smash']).toEqual([key(KEY_CODE.V), ...defaultSmashStickBindings(1)]);
    const keyTaken = { ...mixed, grab: [key(KEY_CODE.V)] };
    expect(fillMissingSmash(keyTaken, H1)['smash']).toEqual(defaultSmashStickBindings(1));
    const stickTaken = { ...mixed, shield: [axis(1, 2, 1)] };
    expect(fillMissingSmash(stickTaken, H1)['smash']).toEqual([key(KEY_CODE.V)]);
  });

  it('gives a fully unbound set no smash binding, even with a hinted half', () => {
    const empty = Object.fromEntries(LOGICAL_ACTIONS.filter(action => action !== 'smash').map(action => [action, []]));
    expect(fillMissingSmash(empty, H1)['smash']).toEqual([]);
    expect(fillMissingSmash(empty, H2)['smash']).toEqual([]);
  });

  it('keeps a saved smash (including a deliberate unbind) and only reorders keys', () => {
    const shuffled = { smash: [], ...withoutSmash(P1) };
    const out = fillMissingSmash(shuffled, H1);
    expect(out['smash']).toEqual([]);
    expect(Object.keys(out)).toEqual([...LOGICAL_ACTIONS]);
    const custom = { ...withoutSmash(P1), smash: [key(KEY_CODE.SPACE)] };
    expect(fillMissingSmash(custom, H1)['smash']).toEqual([key(KEY_CODE.SPACE)]);
  });

  it('writes keys in LOGICAL_ACTIONS order and drops keys that are not actions', () => {
    const reversed = Object.fromEntries(Object.entries(withoutSmash(P2)).reverse());
    const out = fillMissingSmash({ ...reversed, dash: [key(1)] }, H2);
    expect(Object.keys(out)).toEqual([...LOGICAL_ACTIONS]);
  });

  it('leaves other missing or malformed actions for the validator to reject', () => {
    const { taunt: _taunt, ...missingTaunt } = withoutSmash(P1);
    const out = fillMissingSmash(missingTaunt, H1);
    expect('taunt' in out).toBe(false);
    expect(() => assertValidPlayerBindings({ playerIndex: 1, bindings: out })).toThrow(/taunt/);
    const malformed = fillMissingSmash({ ...withoutSmash(P1), attack: 'F' }, H1);
    expect(malformed['attack']).toBe('F');
    expect(malformed['smash']).toEqual([key(KEY_CODE.V)]);
  });

  it('does not mutate its input or share the frozen default objects', () => {
    const input = withoutSmash(P1);
    const before = JSON.stringify(input);
    const out = fillMissingSmash(input, H1);
    expect(JSON.stringify(input)).toBe(before);
    expect(out['smash']).not.toBe(defaultSmashKeyBindings('keyboard_p1'));
    expect(Object.isFrozen((out['smash'] as InputBinding[])[0])).toBe(false);
  });
});

describe('smash fill hints', () => {
  it('maps legacy slots and built-in keyboard profiles to their keyboard half', () => {
    expect([1, 2, 3, 4].map(keyboardHalfForSlot)).toEqual(['keyboard_p1', 'keyboard_p2', null, null]);
    expect(keyboardHalfForProfileBase('keyboard-wasd')).toBe('keyboard_p1');
    expect(keyboardHalfForProfileBase('keyboard-arrows')).toBe('keyboard_p2');
    expect(keyboardHalfForProfileBase('gamepad-standard')).toBeNull();
    expect(keyboardHalfForProfileBase(undefined)).toBeNull();
  });
});

describe('fillMissingSmashInPlayerBindings', () => {
  it('fills the bindings field and keeps playerIndex first', () => {
    const out = fillMissingSmashInPlayerBindings({ playerIndex: 2, bindings: withoutSmash(P2) }, H2) as {
      playerIndex: number; bindings: ActionBindings;
    };
    expect(Object.keys(out)).toEqual(['playerIndex', 'bindings']);
    expect(out.bindings.smash).toEqual([key(KEY_CODE.NUMPAD_0)]);
  });

  it('passes shapes it cannot read through unchanged', () => {
    for (const value of [null, 3, 'x', [], { playerIndex: 1 }, { playerIndex: 1, bindings: [] }]) {
      expect(fillMissingSmashInPlayerBindings(value, H1)).toBe(value);
    }
  });
});

describe('fillMissingSmashInSnapshot', () => {
  type Slot = { playerIndex: number; bindings: Record<string, unknown> };
  function legacySnapshot(overrides: Partial<Record<1 | 2 | 3 | 4, Record<string, unknown>>> = {}) {
    const defaults = [P1, P2, buildDefaultGamepadBindings(0), buildDefaultGamepadBindings(1)];
    return Object.fromEntries(defaults.map((bindings, i) => {
      const slot = (i + 1) as 1 | 2 | 3 | 4;
      return [String(slot), { playerIndex: slot, bindings: overrides[slot] ?? withoutSmash(bindings) }];
    })) as Record<string, Slot>;
  }
  const smashOf = (data: Record<string, unknown>, slot: string) => (data[slot] as Slot).bindings['smash'];

  it('restores every default slot byte for byte', () => {
    const out = fillMissingSmashInSnapshot(legacySnapshot());
    const defaults = [P1, P2, buildDefaultGamepadBindings(0), buildDefaultGamepadBindings(1)];
    defaults.forEach((bindings, i) => {
      expect(JSON.stringify((out[String(i + 1)] as Slot).bindings)).toBe(JSON.stringify(bindings));
    });
  });

  it('gives a P2 layout moved off the numpad Numpad 0, never P1’s V', () => {
    const out = fillMissingSmashInSnapshot(legacySnapshot({ 2: p2OnLetters() }));
    expect(smashOf(out, '1')).toEqual([key(KEY_CODE.V)]);
    expect(smashOf(out, '2')).toEqual([key(KEY_CODE.NUMPAD_0)]);
  });

  it('leaves a customised slot unbound when the other keyboard slot already uses its default key', () => {
    // P2 took V for attack: a customised P1 (grab moved to Y) must not get V too.
    const p2WithV = { ...withoutSmash(P2), attack: [key(KEY_CODE.V)] };
    const p1Custom = { ...withoutSmash(P1), grab: [key(89 /* Y */)] };
    let out = fillMissingSmashInSnapshot(legacySnapshot({ 1: p1Custom, 2: p2WithV }));
    expect(smashOf(out, '1')).toEqual([]);
    expect(smashOf(out, '2')).toEqual([key(KEY_CODE.NUMPAD_0)]);
    // P1 took Numpad 0: a customised P2 (grab moved to Numpad 7) must not get Numpad 0 too.
    const p1WithNumpad0 = { ...withoutSmash(P1), taunt: [key(KEY_CODE.NUMPAD_0)] };
    const p2Custom = { ...withoutSmash(P2), grab: [key(103 /* Numpad 7 */)] };
    out = fillMissingSmashInSnapshot(legacySnapshot({ 1: p1WithNumpad0, 2: p2Custom }));
    expect(smashOf(out, '1')).toEqual([key(KEY_CODE.V)]);
    expect(smashOf(out, '2')).toEqual([]);
  });

  it('an untouched default slot comes back byte-identical to the new defaults even when another slot took its key', () => {
    // P2 took V for attack; P1 is untouched. Leaving P1 with smash [] would
    // read as a customised layout (the profile library would import it).
    const p2WithV = { ...withoutSmash(P2), attack: [key(KEY_CODE.V)] };
    let out = fillMissingSmashInSnapshot(legacySnapshot({ 2: p2WithV }));
    expect(JSON.stringify((out['1'] as Slot).bindings)).toBe(JSON.stringify(P1));
    expect(smashOf(out, '2')).toEqual([key(KEY_CODE.NUMPAD_0)]);
    // Mirror: P1 took Numpad 0, P2 untouched.
    const p1WithNumpad0 = { ...withoutSmash(P1), taunt: [key(KEY_CODE.NUMPAD_0)] };
    out = fillMissingSmashInSnapshot(legacySnapshot({ 1: p1WithNumpad0 }));
    expect(smashOf(out, '1')).toEqual([key(KEY_CODE.V)]);
    expect(JSON.stringify((out['2'] as Slot).bindings)).toBe(JSON.stringify(P2));
  });

  it('does not hand a keyboard slot 3 the smash key an earlier slot was just given', () => {
    // Slot 3 moved to letters votes the P1 half, but slot 1 now owns V.
    const out = fillMissingSmashInSnapshot(legacySnapshot({ 3: p2OnLetters() }));
    expect(smashOf(out, '1')).toEqual([key(KEY_CODE.V)]);
    expect(smashOf(out, '3')).toEqual([]);
  });

  it('keeps a saved smash, passes malformed slots and extra keys through for the validator', () => {
    const data: Record<string, unknown> = { ...legacySnapshot(), '5': 'junk' };
    (data['1'] as Slot).bindings = { ...withoutSmash(P1), smash: [key(KEY_CODE.SPACE)] };
    data['4'] = null;
    const out = fillMissingSmashInSnapshot(data);
    expect(smashOf(out, '1')).toEqual([key(KEY_CODE.SPACE)]);
    expect(out['4']).toBeNull();
    expect(out['5']).toBe('junk');
    expect(data['2']).not.toBe(out['2']);
    expect('smash' in (data['2'] as Slot).bindings).toBe(false);
  });
});
