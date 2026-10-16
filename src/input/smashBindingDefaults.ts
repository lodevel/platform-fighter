/**
 * Back-fill for `smash` and distinct real-taunt `appeal` on bindings saved before either
 * channel existed. The historical helper name remains stable. Older Dodge
 * bindings named `taunt` keep their meaning.
 *
 * Back-fill for the `smash` logical action on bindings saved before it
 * existed.
 *
 * Saved bindings (the legacy four-slot snapshot, per-player exports and
 * named custom profiles) are validated strictly: every LOGICAL_ACTIONS
 * key must be an array. Without this fill, adding `smash` would make
 * every pre-existing save fail validation and silently fall back to
 * defaults. The fill runs before validation and keeps schema version 1
 * and the storage keys unchanged: older builds ignore the extra `smash`
 * key, so the data stays readable both ways.
 *
 * Rules:
 *   • Only a *missing* `smash` key is filled; a present one (even `[]`,
 *     a deliberate unbind) is kept.
 *   • Keyboard default follows the keyboard half the caller names in
 *     the hint (P1 half → V, P2 half → Numpad 0): the legacy snapshot's
 *     slot 1 is P1 and slot 2 is P2; a custom profile follows its base
 *     preset (keyboard-wasd → P1, keyboard-arrows → P2). Only when the
 *     hint names no half (slots 3/4, a profile without a known base) is
 *     the half a vote over the set's keys, P1 on a tie. A layout moved
 *     off its half keeps its slot's key, so a P2 layout moved to
 *     letters never inherits P1's V.
 *   • Gamepad default is the right stick as four half-axes, pinned to
 *     the pad index the set's first gamepad binding uses (or null).
 *   • A default is only added when free: the key must not be bound to
 *     another action, nor listed in the hint's `reservedKeyCodes` (the
 *     keys other players already use, so the fill never creates a
 *     cross-player clash — except for a legacy snapshot slot still on
 *     its defaults, which gets exactly the new defaults; see
 *     {@link fillMissingSmashInSnapshot}), and the stick only when no binding in the
 *     set reads axis 2 or 3 on that pad (a saved layout that moves on
 *     the right stick must not start smashing while walking). Filling a
 *     taken input would create a conflict that blocks saving the
 *     profile. If nothing is free, `smash` is `[]`.
 *   • The result lists LOGICAL_ACTIONS keys in canonical order, because
 *     several call sites compare JSON.stringify output against the
 *     default literals.
 *
 * Pure and Phaser-free.
 */

import {
  LOGICAL_ACTIONS,
  type InputBinding,
} from '../types/inputBindings';
import {
  DEFAULT_KEYBOARD_P1_BINDINGS,
  DEFAULT_KEYBOARD_P2_BINDINGS,
  DEFAULT_PLAYER_BINDINGS,
  RIGHT_STICK_X_AXIS,
  SMASH_STICK_THRESHOLD,
  buildStickHalfAxisBindings,
} from './InputBindingsStore';
import { isP2KeyboardHalfKey } from './keyCodes';

export type KeyboardHalf = 'keyboard_p1' | 'keyboard_p2';

/** Default smash binding list for one keyboard half. */
export function defaultSmashKeyBindings(half: KeyboardHalf): ReadonlyArray<InputBinding> {
  return (half === 'keyboard_p2' ? DEFAULT_KEYBOARD_P2_BINDINGS : DEFAULT_KEYBOARD_P1_BINDINGS)
    .smash;
}

/** Default smash binding list for a pad: the right stick as four half-axes. */
export function defaultSmashStickBindings(
  gamepadIndex: number | null,
): ReadonlyArray<InputBinding> {
  return buildStickHalfAxisBindings(gamepadIndex, RIGHT_STICK_X_AXIS, SMASH_STICK_THRESHOLD);
}

interface LooseBinding {
  readonly kind?: unknown;
  readonly keyCode?: unknown;
  readonly gamepadIndex?: unknown;
  readonly source?: { readonly type?: unknown; readonly axisIndex?: unknown } | null;
}

/** Every well-shaped-enough binding in the set, skipping malformed entries. */
function collectBindings(bindings: Readonly<Record<string, unknown>>): LooseBinding[] {
  const out: LooseBinding[] = [];
  for (const action of LOGICAL_ACTIONS) {
    const list = bindings[action];
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      if (typeof entry === 'object' && entry !== null) out.push(entry as LooseBinding);
    }
  }
  return out;
}

/**
 * Where the fill takes its keyboard half from, and which keys other
 * players already hold. Every field is optional: an empty hint votes
 * the half from the set's own keys and reserves nothing.
 */
export interface SmashFillHint {
  /** Keyboard half whose default smash key the set gets; omitted or null → vote. */
  readonly keyboardHalf?: KeyboardHalf | null;
  /** Keys another player's bindings already use; the fill never picks one. */
  readonly reservedKeyCodes?: ReadonlySet<number>;
}

/** Keyboard half of a legacy snapshot slot: slot 1 is WASD, slot 2 is arrows, 3/4 have none. */
export function keyboardHalfForSlot(slot: number): KeyboardHalf | null {
  return slot === 1 ? 'keyboard_p1' : slot === 2 ? 'keyboard_p2' : null;
}

/** Keyboard half of a built-in keyboard profile id; null for anything else. */
export function keyboardHalfForProfileBase(baseId: unknown): KeyboardHalf | null {
  return baseId === 'keyboard-wasd' ? 'keyboard_p1' : baseId === 'keyboard-arrows' ? 'keyboard_p2' : null;
}

/** Every keyboard keyCode bound anywhere in a raw (parsed JSON) binding set. */
function collectKeyCodes(bindings: unknown): Set<number> {
  const codes = new Set<number>();
  if (typeof bindings !== 'object' || bindings === null || Array.isArray(bindings)) return codes;
  for (const entry of collectBindings(bindings as Record<string, unknown>)) {
    if (entry.kind === 'keyboard' && typeof entry.keyCode === 'number') codes.add(entry.keyCode);
  }
  return codes;
}

/**
 * Keyboard half the set uses, by majority of its keys (P1 on a tie);
 * `null` when the set has no keyboard binding.
 */
function voteKeyboardHalf(entries: ReadonlyArray<LooseBinding>): KeyboardHalf | null {
  let p1 = 0;
  let p2 = 0;
  for (const entry of entries) {
    if (entry.kind !== 'keyboard' || typeof entry.keyCode !== 'number') continue;
    if (isP2KeyboardHalfKey(entry.keyCode)) p2 += 1;
    else p1 += 1;
  }
  if (p1 === 0 && p2 === 0) return null;
  return p2 > p1 ? 'keyboard_p2' : 'keyboard_p1';
}

function copyBindings(list: ReadonlyArray<InputBinding>): InputBinding[] {
  return JSON.parse(JSON.stringify(list)) as InputBinding[];
}

/** Default smash bindings for the set, keeping only inputs nothing else uses. */
function freeSmashDefaults(
  bindings: Readonly<Record<string, unknown>>,
  hint: SmashFillHint,
): InputBinding[] {
  // New appeal and walk defaults must not change an older layout's smash half vote.
  const entries = collectBindings({...bindings, appeal: [], walk: []});
  const result: InputBinding[] = [];

  // A key only for a set that already plays on the keyboard.
  const hasKeyboard = entries.some(
    (entry) => entry.kind === 'keyboard' && typeof entry.keyCode === 'number',
  );
  if (hasKeyboard) {
    const half = hint.keyboardHalf ?? voteKeyboardHalf(entries) ?? 'keyboard_p1';
    for (const binding of defaultSmashKeyBindings(half)) {
      if (binding.kind !== 'keyboard') continue;
      const taken = hint.reservedKeyCodes?.has(binding.keyCode) === true || entries.some(
        (entry) => entry.kind === 'keyboard' && entry.keyCode === binding.keyCode,
      );
      if (!taken) result.push(...copyBindings([binding]));
    }
  }

  const firstPad = entries.find((entry) => entry.kind === 'gamepad');
  if (firstPad !== undefined) {
    const pad = typeof firstPad.gamepadIndex === 'number' ? firstPad.gamepadIndex : null;
    const stick = defaultSmashStickBindings(pad);
    const stickAxes = new Set<number>();
    for (const binding of stick) {
      if (binding.kind === 'gamepad' && binding.source.type === 'axis') {
        stickAxes.add(binding.source.axisIndex);
      }
    }
    // A null pad matches any pad, so treat it as overlapping either way.
    const stickTaken = entries.some(
      (entry) =>
        entry.kind === 'gamepad' &&
        entry.source?.type === 'axis' &&
        typeof entry.source.axisIndex === 'number' &&
        stickAxes.has(entry.source.axisIndex) &&
        (entry.gamepadIndex === pad || entry.gamepadIndex === null || pad === null),
    );
    if (!stickTaken) result.push(...copyBindings(stick));
  }

  return result;
}

/**
 * Return `bindings` with a missing `smash` filled from the defaults (see
 * the module doc), keys in LOGICAL_ACTIONS order. `hint` names the
 * keyboard half the set belongs to (its slot or base profile) and the
 * keys other players already use.
 *
 * Accepts raw parsed JSON: other missing or malformed actions are left
 * as they are so the strict validator still reports them. Keys that are
 * not logical actions are dropped, as the serializer does on save.
 */
export function fillMissingSmash(
  bindings: Readonly<Record<string, unknown>>,
  hint: SmashFillHint = {},
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const action of LOGICAL_ACTIONS) {
    if (action in bindings) {
      out[action] = bindings[action];
    } else if (action === 'smash') {
      out[action] = freeSmashDefaults(bindings, hint);
    } else if (action === 'appeal') {
      out[action] = freeAppealDefaults(bindings, hint);
    } else if (action === 'walk') {
      // Never bind a new modifier into an older saved control layout.
      out[action] = [];
    }
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Fill the distinct taunt channel only when its default input is free. */
function freeAppealDefaults(bindings: Readonly<Record<string, unknown>>, hint: SmashFillHint): InputBinding[] {
  const entries = collectBindings(bindings);
  const result: InputBinding[] = [];
  if (entries.some(e => e.kind === 'keyboard')) {
    const half = hint.keyboardHalf ?? voteKeyboardHalf(entries) ?? 'keyboard_p1';
    const keyCode = half === 'keyboard_p2' ? 103 : 66;
    if (!hint.reservedKeyCodes?.has(keyCode) && !entries.some(e => e.kind === 'keyboard' && e.keyCode === keyCode)) {
      result.push({kind: 'keyboard', keyCode});
    }
  }
  const pad = entries.find(e => e.kind === 'gamepad');
  if (pad && !entries.some(e => e.kind === 'gamepad' && e.gamepadIndex === pad.gamepadIndex &&
      e.source?.type === 'button' && (e.source as {buttonIndex?: unknown}).buttonIndex === 8)) {
    result.push({kind: 'gamepad', gamepadIndex: typeof pad.gamepadIndex === 'number' ? pad.gamepadIndex : null,
      source: {type: 'button', buttonIndex: 8}});
  }
  return result;
}

/**
 * Apply {@link fillMissingSmash} to the `bindings` field of a raw
 * `{ playerIndex, bindings }` payload. Anything that is not an object
 * with an object `bindings` field is returned unchanged for the
 * validator to reject.
 */
export function fillMissingSmashInPlayerBindings(candidate: unknown, hint: SmashFillHint = {}): unknown {
  if (!isRecord(candidate)) return candidate;
  const bindings = candidate['bindings'];
  if (!isRecord(bindings)) return candidate;
  return {
    ...candidate,
    bindings: fillMissingSmash(bindings, hint),
  };
}

const SNAPSHOT_SLOT_KEYS = ['1', '2', '3', '4'] as const;

/**
 * Fill every slot of a raw legacy four-slot snapshot (`data` keyed
 * '1'..'4'). Each slot takes its keyboard half from its number (see
 * {@link keyboardHalfForSlot}).
 *
 * A slot still on its old defaults comes back byte-identical to the new
 * defaults (smash included), so everything that asks "is this slot on
 * its defaults?" — the profile library's legacy import above all — keeps
 * answering yes. That holds even when another slot already binds the
 * default smash key; the match drops such a shared key from a smash
 * binding (`dropSharedKeyboardSmashKeys` in match/matchParticipants).
 *
 * A customised slot never gets a key another slot already binds —
 * including a smash key filled into an earlier slot. Other keys and
 * malformed slots pass through for the validator.
 */
export function fillMissingSmashInSnapshot(
  data: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data };
  for (const slot of SNAPSHOT_SLOT_KEYS) {
    if (!(slot in out)) continue;
    const asDefault = fillMissingSmashInPlayerBindings(out[slot], {
      keyboardHalf: keyboardHalfForSlot(Number(slot)),
    });
    const defaults = DEFAULT_PLAYER_BINDINGS[Number(slot) as 1 | 2 | 3 | 4].bindings;
    if (isRecord(asDefault) && JSON.stringify(asDefault['bindings']) === JSON.stringify(defaults)) {
      out[slot] = asDefault;
      continue;
    }
    const reservedKeyCodes = new Set<number>();
    for (const other of SNAPSHOT_SLOT_KEYS) {
      if (other === slot) continue;
      const entry = out[other];
      if (!isRecord(entry)) continue;
      for (const keyCode of collectKeyCodes(entry['bindings'])) reservedKeyCodes.add(keyCode);
    }
    out[slot] = fillMissingSmashInPlayerBindings(out[slot], {
      keyboardHalf: keyboardHalfForSlot(Number(slot)),
      reservedKeyCodes,
    });
  }
  return out;
}
