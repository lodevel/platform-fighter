import { DEFAULT_HAND_CURSOR_STATE, type HandCursorState } from '../../../../src/scenes/handCursorState';
import type { PlayerSlot } from '../../../../src/types';
import type { SelectionOwner } from '../shell/input';
export type { SelectionOwner } from '../shell/input';

export type SelectionSlot = 1 | 2 | 3 | 4;
export interface SelectionPad { readonly index: number; readonly id: string }

/** The match may have changed profiles or rebound a pad while paused. Keep its
 * current participants, while retaining each selection hand's position. */
export function restoreSelectionHand(saved: HandCursorState | undefined, players: readonly PlayerSlot[] = []): HandCursorState {
  const hand = saved ?? DEFAULT_HAND_CURSOR_STATE;
  if (!players.length) return hand;
  return { slots: hand.slots.map(slot => {
    const player = players.find(entry => entry.index === slot.index);
    if (!player) return saved ? slot : { ...slot, mode: 'empty' as const };
    return { ...slot, mode: player.inputType === 'ai' ? 'bot' as const : 'human' as const,
      inputType: player.inputType, pickedCharacterId: player.characterId, paletteIndex: player.paletteIndex,
      aiDifficulty: player.aiDifficulty, bindingProfileIndex: player.bindingProfileIndex,
      bindingProfileId: player.bindingProfileId, customCharacter: player.customCharacter };
  }) };
}

/** Ownership is session data, not a control profile. Restore it before accepting
 * join input so returning players cannot accidentally occupy an extra card. */
export function restoreSelectionOwners(hand: HandCursorState, players: readonly PlayerSlot[] = [],
  saved: readonly SelectionOwner[] = [], pads: readonly SelectionPad[] = []): SelectionOwner[] {
  const result: SelectionOwner[] = [];
  const human = (slot: SelectionSlot) => hand.slots.find(entry => entry.index === slot && entry.mode === 'human');
  const add = (owner: SelectionOwner) => {
    const slot = human(owner.slot);
    if (!slot || (owner.device === 'keyboard') === (slot.inputType === 'gamepad')
      || result.some(entry => entry.device === owner.device || entry.slot === owner.slot)) return;
    result.push(owner);
  };
  // A match's live assignments win over an older selection snapshot (including
  // an index changed by the match's reconnect/rebind UI).
  for (const player of players) {
    const device = player.inputDevice;
    if (device?.kind === 'gamepad' && device.gamepadIndex >= 0) {
      const pad = pads.find(entry => entry.index === device.gamepadIndex);
      const prior = saved.find(entry => entry.slot === player.index);
      add({ device: `pad${device.gamepadIndex}`, slot: player.index, padId: pad?.id ?? device.gamepadId ?? prior?.padId });
    }
  }
  // Preserve which keyboard card was being edited; a keyboard can play both
  // layouts but has only one selection hand at a time.
  for (const owner of saved) {
    if (owner.device === 'keyboard') { add(owner); continue; }
    // Two identical controllers commonly report the same id. An unchanged
    // browser index wins before attempting an identity-based relocation.
    const samePad = owner.padId && (pads.find(pad => `pad${pad.index}` === owner.device && pad.id === owner.padId)
      ?? pads.find(pad => pad.id === owner.padId && !result.some(entry => entry.device === `pad${pad.index}`)));
    add(samePad ? { ...owner, device: `pad${samePad.index}` } : owner);
  }
  for (const slot of hand.slots) {
    if (slot.mode === 'human' && slot.inputType !== 'gamepad') add({ device: 'keyboard', slot: slot.index });
  }
  return result;
}
