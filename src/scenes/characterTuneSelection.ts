import type { CharacterRecord } from '../characterBuilder/characterStorage';
import type { CharacterId } from '../types';
import { snapshotCustomCharacter } from '../match/characterSnapshot';
import type { HandCursorState } from './handCursorState';

/** Storage order is the visible cycle order, with the shipped fighter first. */
export function compatibleCharacterTunes(
  characterId: CharacterId,
  records: ReadonlyArray<CharacterRecord>,
): ReadonlyArray<CharacterRecord> {
  const seen = new Set<string>();
  return records.filter((record) => {
    if (record.spec.id !== characterId || seen.has(record.slotId)) return false;
    seen.add(record.slotId);
    return true;
  });
}

/** Changing fighter or leaving a slot releases its tune; palette/device edits do not. */
export function reconcileCharacterTunes(state: HandCursorState): HandCursorState {
  let changed = false;
  const slots = state.slots.map((slot) => {
    if (!slot.customCharacter || (slot.mode !== 'empty'
      && slot.customCharacter.spec.id === slot.pickedCharacterId)) return slot;
    const { customCharacter: _discarded, ...base } = slot;
    changed = true;
    return Object.freeze(base);
  });
  return changed ? Object.freeze({ slots: Object.freeze(slots) }) : state;
}

/** Copy at selection time. Launch and rematch must never reload this storage slot. */
export function cycleCharacterTune(
  state: HandCursorState,
  slotIndex: 1 | 2 | 3 | 4,
  records: ReadonlyArray<CharacterRecord>,
  direction: 1 | -1 = 1,
): HandCursorState {
  const current = reconcileCharacterTunes(state);
  const slot = current.slots.find((candidate) => candidate.index === slotIndex);
  if (!slot || slot.mode === 'empty' || slot.pickedCharacterId === null) return current;
  const options = compatibleCharacterTunes(slot.pickedCharacterId, records);
  const selectedIndex = slot.customCharacter
    ? options.findIndex((option) => option.slotId === slot.customCharacter?.slotId) + 1
    : 0;
  // A detached snapshot remains playable, but an explicit cycle returns to base.
  const nextIndex = slot.customCharacter && selectedIndex === 0 ? 0
    : (selectedIndex + direction + options.length + 1) % (options.length + 1);
  const next = options[nextIndex - 1];
  const { customCharacter: _previous, ...base } = slot;
  const customCharacter = next
    ? snapshotCustomCharacter({ slotId: next.slotId, spec: next.spec }, slot.pickedCharacterId)
    : undefined;
  if (!customCharacter && !slot.customCharacter) return current;
  const replacement = Object.freeze({ ...base, ...(customCharacter ? { customCharacter } : {}) });
  return Object.freeze({
    slots: Object.freeze(current.slots.map((candidate) => candidate.index === slotIndex ? replacement : candidate)),
  });
}
