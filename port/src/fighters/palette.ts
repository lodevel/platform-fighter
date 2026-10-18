import { getCharacterPalettes } from '../../../src/characters/palettes';
import type { CharacterId } from '../../../src/types';
import { PALETTE_ART_KEYS } from '../../../src/characters/paletteArtKeys';
import type { Costumes } from '../../../character/package/types';
import { costumeShifts, type HsvShift } from '../../../character/render/recolor';

const hex = (color: number) => `#${color.toString(16).padStart(6, '0')}`;

/**
 * A fighter's costumes in package terms: its art regions (PALETTE_ART_KEYS) and
 * its eight palettes' colours for the slots those regions use. Undefined for a fighter
 * without art keys, which is drawn as is in every costume.
 */
export function characterCostumes(characterId: CharacterId): Costumes | undefined {
  const keys = PALETTE_ART_KEYS[characterId];
  if (!keys) return undefined;
  const slots = [...new Set(keys.map((k) => k.slot))];
  return {
    regions: keys.map((k) => ({ slot: k.slot, color: hex(k.color), tolerance: k.tolerance })),
    list: getCharacterPalettes(characterId).map((p) => ({
      name: p.displayName,
      slots: Object.fromEntries(slots.map((slot) => [slot, hex(slot === 'primary' ? p.primaryColor : p.accentColor)])),
    })),
  };
}

const COSTUMES = new Map<CharacterId, Costumes | undefined>();

/** The colour shifts that dress a fighter in costume `paletteIndex` (see `costumeShifts`). */
export function costumeRecolor(characterId: CharacterId, paletteIndex: number): HsvShift[] {
  if (!COSTUMES.has(characterId)) COSTUMES.set(characterId, characterCostumes(characterId));
  return costumeShifts(COSTUMES.get(characterId), paletteIndex);
}
