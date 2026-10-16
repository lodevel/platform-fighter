import { getCharacterPalette } from '../../../src/characters/palettes';
import type { CharacterId } from '../../../src/types';
import type { HsvShift } from '../engine/sprites/spriteLayer';
import { PALETTE_ART_KEYS } from '../../../src/characters/paletteArtKeys';

function hsv(color: number): [number, number, number] {
  const r = (color >> 16 & 255) / 255, g = (color >> 8 & 255) / 255, b = (color & 255) / 255;
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  const h = d === 0 ? 0 : max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, max === 0 ? 0 : d / max, max];
}

/**
 * The colour shifts that dress a fighter in costume `paletteIndex`: each art
 * region (PALETTE_ART_KEYS) moves by palette N relative to palette 0, so a
 * region keeps its light and shadow. Costume 0 (or a fighter without keys)
 * draws the art unchanged.
 */
export function costumeRecolor(characterId: CharacterId, paletteIndex: number): HsvShift[] {
  const keys = PALETTE_ART_KEYS[characterId];
  if (!keys || paletteIndex === 0) return [];
  const base = getCharacterPalette(characterId, 0), alt = getCharacterPalette(characterId, paletteIndex);
  return keys.map((k) => {
    const field = k.slot === 'primary' ? 'primaryColor' : 'accentColor';
    const [h0, s0, v0] = hsv(base[field]), [h1, s1, v1] = hsv(alt[field]);
    return {
      key: hsv(k.color), tolerance: k.tolerance,
      hueShift: h1 - h0, saturationRatio: s0 > 0 ? s1 / s0 : 1, valueRatio: v0 > 0 ? v1 / v0 : 1,
    };
  });
}
