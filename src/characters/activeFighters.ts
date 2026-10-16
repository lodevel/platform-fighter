import { CHARACTER_IDS, type CharacterId, type PlayerSlot } from '../types';

/**
 * Roster mask: only these fighters are selectable, picked by default, listed in the Lab,
 * or allowed to spawn from a saved config (see docs/review/2026-10-11/ultimate-items/roster-mask.md).
 * Every fighter is active now that Link's art is installed; Donkey Kong stays the default pick.
 */
export const ACTIVE_FIGHTER_IDS: ReadonlyArray<CharacterId> = ['donkeykong', 'pikachu', 'link'];

/** Fighter used wherever a masked or unknown id must be replaced. */
export const FALLBACK_FIGHTER_ID: CharacterId = ACTIVE_FIGHTER_IDS[0] ?? CHARACTER_IDS[0];

export function isActiveFighter(id: string): id is CharacterId {
  return (ACTIVE_FIGHTER_IDS as ReadonlyArray<string>).includes(id);
}

/** `id` if active, else the active fighter at `slotIndex` (1-based, wrapping). */
export function toActiveFighterId(id: string, slotIndex = 1): CharacterId {
  if (isActiveFighter(id)) return id;
  return ACTIVE_FIGHTER_IDS[(slotIndex - 1) % ACTIVE_FIGHTER_IDS.length] ?? FALLBACK_FIGHTER_ID;
}

/** Re-point any masked fighter in a player list (saved/last configs) to an active one. */
export function maskPlayerSlots(players: ReadonlyArray<PlayerSlot>): ReadonlyArray<PlayerSlot> {
  return Object.freeze(
    players.map((p) =>
      isActiveFighter(p.characterId)
        ? p
        : Object.freeze({ ...p, characterId: toActiveFighterId(p.characterId, p.index) }),
    ),
  );
}
